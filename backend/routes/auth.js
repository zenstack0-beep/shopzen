const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { Notification, OTP, Coupon } = require('../models/index');
const { sendMail, otpEmailHtml } = require('../utils/mailer');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ─── Register ─────────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password, phone } = req.body;
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(400).json({ message: exists.email === email ? 'Email already registered' : 'Username already taken' });
    const user = await User.create({ firstName, lastName, username, email, password, phone });
    const newUserCoupon = await Coupon.findOne({ isNewUserOnly: true, isActive: true, validUntil: { $gte: new Date() } });
    await Notification.create({ type: 'new_user', title: 'New Customer Registered', message: `${firstName} ${lastName} just created an account`, link: `/admin/customers` });
    const token = generateToken(user._id);
    res.status(201).json({
      token,
      user: { id: user._id, firstName, lastName, username, email, role: user.role },
      newUserCoupon: newUserCoupon ? { code: newUserCoupon.code, value: newUserCoupon.value, type: newUserCoupon.type, description: newUserCoupon.description } : null
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── Login ────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) return res.status(401).json({ message: 'Invalid email or password' });
    if (!user.isActive) return res.status(403).json({ message: 'Your account has been deactivated' });
    user.lastLogin = Date.now();
    await user.save();
    const token = generateToken(user._id);
    res.json({ token, user: { id: user._id, firstName: user.firstName, lastName: user.lastName, username: user.username, email: user.email, role: user.role, avatar: user.avatar } });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── Google OAuth ─────────────────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential is required' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, given_name, family_name, picture, sub: googleId } = payload;

    let user = await User.findOne({ googleId });
    if (!user) user = await User.findOne({ email });

    if (!user) {
      const base = (email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
      let username = base;
      let attempt = 0;
      while (await User.findOne({ username })) {
        attempt++;
        username = `${base}_${attempt}`;
      }

      user = await User.create({
        firstName:  given_name  || 'User',
        lastName:   family_name || '',
        username,
        email,
        password:   crypto.randomBytes(32).toString('hex'),
        googleId,
        avatar:     picture || '',
        isVerified: true,
      });

      await Notification.create({
        type:    'new_user',
        title:   'New Customer (Google)',
        message: `${given_name || email} signed up via Google`,
        link:    '/admin/customers',
      });
    }

    if (!user.isActive) return res.status(403).json({ message: 'Your account has been deactivated' });

    let dirty = false;
    if (!user.googleId) { user.googleId = googleId; dirty = true; }
    if (!user.avatar && picture) { user.avatar = picture; dirty = true; }
    user.lastLogin = Date.now();
    if (dirty) await user.save();
    else await User.findByIdAndUpdate(user._id, { lastLogin: Date.now() });

    const token = generateToken(user._id);
    res.json({
      token,
      user: {
        id:        user._id,
        firstName: user.firstName,
        lastName:  user.lastName,
        username:  user.username,
        email:     user.email,
        role:      user.role,
        avatar:    user.avatar,
      },
    });
  } catch (err) {
    console.error('[GOOGLE AUTH ERROR]', err.message);
    res.status(500).json({ message: 'Google sign-in failed: ' + err.message });
  }
});

// ─── Forgot Password — Send OTP ───────────────────────────────────────────────
// FIX: Previously the catch block returned err.message which could be a raw
//      nodemailer/SMTP error that confused the frontend into showing
//      "Failed to send OTP". Now we:
//      1. Validate email exists before touching SMTP.
//      2. Always delete old OTPs before creating new one (idempotent).
//      3. Return a clear, user-friendly message on SMTP failure while logging
//         the real cause on the server so you can diagnose it in Railway logs.
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({ message: 'Email address is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Don't reveal whether the email exists — just say "if registered…"
      // but for a small internal shop it's fine to be explicit:
      return res.status(404).json({ message: 'No account found with this email address' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Remove any previous unused OTPs for this email
    await OTP.deleteMany({ email: user.email });
    await OTP.create({ email: user.email, otp, expiresAt });

    try {
      await sendMail({
        to: user.email,
        subject: `${otp} — Your ShopZen Password Reset OTP`,
        html: await otpEmailHtml(otp, user.firstName),
      });
    } catch (mailErr) {
      // Log the REAL smtp error in Railway/Render so you can fix it
      console.error('[FORGOT-PASSWORD] SMTP error:', mailErr.message);
      // Clean up the OTP we just created since it can't be delivered
      await OTP.deleteMany({ email: user.email }).catch(() => {});
      // Return a helpful message — NOT the raw nodemailer stack trace
      return res.status(500).json({
        message:
          'Unable to send the OTP email right now. ' +
          'Please check your spam folder or try again in a few minutes. ' +
          'If this keeps happening, contact support.',
      });
    }

    res.json({ message: 'OTP sent to your email address. Please check your inbox (and spam folder).' });
  } catch (err) {
    console.error('[FORGOT-PASSWORD] Unexpected error:', err.message);
    res.status(500).json({ message: 'Something went wrong. Please try again.' });
  }
});

// ─── Verify OTP ───────────────────────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const record = await OTP.findOne({ email, otp, used: false, expiresAt: { $gte: new Date() } });
    if (!record) return res.status(400).json({ message: 'Invalid or expired OTP. Please request a new one.' });
    const resetToken = crypto.randomBytes(32).toString('hex');
    record.used = true;
    await record.save();
    await OTP.create({ email, otp: resetToken, expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
    res.json({ message: 'OTP verified', resetToken });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── Reset Password ───────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;
    const record = await OTP.findOne({ email, otp: resetToken, used: false, expiresAt: { $gte: new Date() } });
    if (!record) return res.status(400).json({ message: 'Invalid or expired reset token. Please restart the password reset process.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.password = newPassword;
    await user.save();
    record.used = true;
    await record.save();
    res.json({ message: 'Password reset successfully' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── Get profile ──────────────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => { res.json(req.user); });

// ─── Update profile ───────────────────────────────────────────────────────────
router.put('/profile', auth, async (req, res) => {
  try {
    const { firstName, lastName, phone, addresses, defaultAddress } = req.body;
    const update = {};
    if (firstName  !== undefined) update.firstName = firstName;
    if (lastName   !== undefined) update.lastName  = lastName;
    if (phone      !== undefined) update.phone     = phone;

    if (defaultAddress) {
      const user = await User.findById(req.user._id);
      const addr = { label: 'Default', country: defaultAddress.country || '', street: defaultAddress.street || '', city: defaultAddress.city || '', isDefault: true };
      const idx = user.addresses.findIndex(a => a.isDefault);
      if (idx > -1) { user.addresses[idx] = addr; } else { user.addresses.push(addr); }
      const defaultIdx = idx > -1 ? idx : user.addresses.length - 1;
      user.addresses.forEach((a, i) => { if (i !== defaultIdx) a.isDefault = false; });
      update.addresses = user.addresses;
    } else if (addresses !== undefined) {
      update.addresses = addresses;
    }

    const updated = await User.findByIdAndUpdate(req.user._id, update, { new: true }).select('-password');
    res.json(updated);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── Change password ──────────────────────────────────────────────────────────
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    if (!(await user.comparePassword(currentPassword))) return res.status(400).json({ message: 'Current password is incorrect' });
    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password updated successfully' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── Get wishlist ─────────────────────────────────────────────────────────────
router.get('/wishlist', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('wishlist');
    res.json(user.wishlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ─── Toggle wishlist ──────────────────────────────────────────────────────────
router.post('/wishlist/:productId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const idx = user.wishlist.indexOf(req.params.productId);
    if (idx > -1) user.wishlist.splice(idx, 1);
    else user.wishlist.push(req.params.productId);
    await user.save();
    res.json({ wishlist: user.wishlist });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;