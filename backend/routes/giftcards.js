const express = require('express');
const router = express.Router();
const { GiftCard, Notification } = require('../models/index');
const { auth, adminAuth } = require('../middleware/auth');

// ── Code generator ────────────────────────────────────────────────────────────
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateCode = () => {
  let code = 'GC';
  for (let i = 0; i < 4; i++) {
    code += '-';
    for (let j = 0; j < 4; j++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
};
const ensureUniqueCode = async () => {
  let code, exists = true;
  while (exists) { code = generateCode(); exists = await GiftCard.findOne({ code }); }
  return code;
};

// ── Public: browse available gift card templates (no real balance, just designs) ──
router.get('/templates', async (req, res) => {
  try {
    // Return unique designs that admin has created as templates
    const DESIGNS = [
      { id:'default',     emoji:'🎁', label:'Classic Gift',  bg:'#b5451b', price: null },
      { id:'birthday',    emoji:'🎂', label:'Birthday',      bg:'#7c3aed', price: null },
      { id:'christmas',   emoji:'🎄', label:'Christmas',     bg:'#15803d', price: null },
      { id:'anniversary', emoji:'💝', label:'Anniversary',   bg:'#be185d', price: null },
      { id:'thankyou',    emoji:'💙', label:'Thank You',     bg:'#0369a1', price: null },
    ];
    res.json(DESIGNS);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Public: validate a gift card code ─────────────────────────────────────────
router.post('/validate', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Code required' });
    const card = await GiftCard.findOne({ code: code.toUpperCase().trim() });
    if (!card) return res.status(404).json({ message: 'Gift card not found' });
    if (!card.isActive) return res.status(400).json({ message: 'This gift card has not been activated yet' });
    if (card.balance <= 0) return res.status(400).json({ message: 'This gift card has no remaining balance' });
    if (card.expiresAt && new Date() > card.expiresAt) return res.status(400).json({ message: 'This gift card has expired' });
    res.json({ valid: true, balance: card.balance, code: card.code, initialValue: card.initialValue });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Public: check balance by code ────────────────────────────────────────────
router.get('/balance/:code', async (req, res) => {
  try {
    const card = await GiftCard.findOne({ code: req.params.code.toUpperCase() });
    if (!card) return res.status(404).json({ message: 'Gift card not found' });
    res.json({
      code: card.code, balance: card.balance, initialValue: card.initialValue,
      isActive: card.isActive, expiresAt: card.expiresAt,
      design: card.design,
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Customer: purchase a gift card ───────────────────────────────────────────
// Customer selects amount + design, pays, then gets activated code
router.post('/purchase', auth, async (req, res) => {
  try {
    const { amount, design, recipientName, recipientEmail, message, paymentMethod } = req.body;
    if (!amount || amount < 100) return res.status(400).json({ message: 'Minimum gift card value is Rs. 100' });
    const code = await ensureUniqueCode();
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year

    const giftCard = await GiftCard.create({
      code,
      initialValue: Number(amount),
      balance: Number(amount),
      purchasedBy: req.user._id,
      purchaserEmail: req.user.email,
      purchaserName: `${req.user.firstName} ${req.user.lastName}`,
      recipientName: recipientName || req.user.firstName,
      recipientEmail: recipientEmail || req.user.email,
      message: message || '',
      design: design || 'default',
      paymentMethod: paymentMethod || 'bank_transfer',
      paymentStatus: 'pending',
      isActive: false, // activated after admin confirms payment
      expiresAt,
    });

    await Notification.create({
      type: 'gift_card',
      title: '🎁 New Gift Card Purchase',
      message: `${req.user.firstName} purchased a Rs. ${amount} gift card`,
      link: '/admin/gift-cards',
    });

    res.status(201).json({ success: true, giftCard, message: 'Gift card order placed! It will be activated after payment confirmation.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Customer: my purchased gift cards ────────────────────────────────────────
router.get('/my-cards', auth, async (req, res) => {
  try {
    const cards = await GiftCard.find({ purchasedBy: req.user._id }).sort({ createdAt: -1 });
    res.json(cards);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin: get all gift cards ─────────────────────────────────────────────────
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status === 'pending') filter.paymentStatus = 'pending';
    if (status === 'active') filter.isActive = true;
    if (status === 'used') filter.balance = 0;
    const total = await GiftCard.countDocuments(filter);
    const cards = await GiftCard.find(filter)
      .populate('purchasedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ cards, total, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin: create gift card (no recipient, just amount + design) ──────────────
router.post('/admin/create', adminAuth, async (req, res) => {
  try {
    const { amount, design, expiryDays, isActive, adminNote } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ message: 'Amount required' });
    const code = await ensureUniqueCode();
    const expiresAt = new Date(Date.now() + (Number(expiryDays) || 365) * 24 * 60 * 60 * 1000);

    const giftCard = await GiftCard.create({
      code,
      initialValue: Number(amount),
      balance: Number(amount),
      design: design || 'default',
      paymentStatus: 'paid',
      isActive: isActive !== false,
      activatedAt: isActive !== false ? new Date() : undefined,
      adminNote: adminNote || 'Created by admin',
      expiresAt,
    });
    res.status(201).json(giftCard);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin: activate gift card ─────────────────────────────────────────────────
router.put('/admin/:id/activate', adminAuth, async (req, res) => {
  try {
    const card = await GiftCard.findByIdAndUpdate(
      req.params.id,
      { isActive: true, paymentStatus: 'paid', activatedAt: new Date() },
      { new: true }
    ).populate('purchasedBy', 'firstName lastName email');
    if (!card) return res.status(404).json({ message: 'Not found' });
    res.json(card);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin: deactivate ─────────────────────────────────────────────────────────
router.put('/admin/:id/deactivate', adminAuth, async (req, res) => {
  try {
    const card = await GiftCard.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    res.json(card);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin: update (adjust balance, note etc.) ─────────────────────────────────
router.put('/admin/:id', adminAuth, async (req, res) => {
  try {
    const card = await GiftCard.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(card);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
