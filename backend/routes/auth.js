const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { Notification, OTP, Coupon } = require('../models/index');
const { sendMail, otpEmailHtml } = require('../utils/mailer');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// Register
router.post('/register', async (req, res) => {
  try {
    const { firstName, lastName, username, email, password, phone } = req.body;
    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) return res.status(400).json({ message: exists.email === email ? 'Email already registered' : 'Username already taken' });
    const user = await User.create({ firstName, lastName, username, email, password, phone });
    // Auto-apply new user coupon if exists
    const newUserCoupon = await Coupon.findOne({ isNewUserOnly: true, isActive: true, validUntil: { $gte: new Date() } });
    await Notification.create({ type: 'new_user', title: 'New Customer Registered', message: `${firstName} ${lastName} just created an account`, link: `/admin/customers` });
    const token = generateToken(user._id);
    res.status(201).json({ token, user: { id: user._id, firstName, lastName, username, email, role: user.role }, newUserCoupon: newUserCoupon ? { code: newUserCoupon.code, value: newUserCoupon.value, type: newUserCoupon.type, description: newUserCoupon.description } : null });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Login
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

// Forgot Password — Send OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'No account found with this email' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await OTP.deleteMany({ email }); // remove old OTPs
    await OTP.create({ email, otp, expiresAt });
    await sendMail({ to: email, subject: 'ShopZen Password Reset OTP', html: await otpEmailHtml(otp, user.firstName) });
    res.json({ message: 'OTP sent to your email address' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const record = await OTP.findOne({ email, otp, used: false, expiresAt: { $gte: new Date() } });
    if (!record) return res.status(400).json({ message: 'Invalid or expired OTP' });
    const resetToken = crypto.randomBytes(32).toString('hex');
    record.used = true;
    await record.save();
    // Store reset token temporarily
    await OTP.create({ email, otp: resetToken, expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
    res.json({ message: 'OTP verified', resetToken });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, resetToken, newPassword } = req.body;
    const record = await OTP.findOne({ email, otp: resetToken, used: false, expiresAt: { $gte: new Date() } });
    if (!record) return res.status(400).json({ message: 'Invalid or expired reset token' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.password = newPassword;
    await user.save();
    record.used = true;
    await record.save();
    res.json({ message: 'Password reset successfully' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Get profile
router.get('/me', auth, async (req, res) => { res.json(req.user); });

// Update profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { firstName, lastName, phone, addresses, defaultAddress } = req.body;
    const update = {};
    if (firstName !== undefined) update.firstName = firstName;
    if (lastName  !== undefined) update.lastName  = lastName;
    if (phone     !== undefined) update.phone     = phone;

    if (defaultAddress) {
      // Save billing address as the user's default address for checkout pre-fill
      const user = await User.findById(req.user._id);
      const addr = {
        label: 'Default',
        country: defaultAddress.country || '',
        street:  defaultAddress.street  || '',
        city:    defaultAddress.city    || '',
        isDefault: true,
      };
      const idx = user.addresses.findIndex(a => a.isDefault);
      if (idx > -1) {
        user.addresses[idx] = addr;
      } else {
        user.addresses.push(addr);
      }
      // Ensure only one default
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

// Change password
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

// Get wishlist
router.get('/wishlist', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('wishlist');
    res.json(user.wishlist);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Toggle wishlist
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