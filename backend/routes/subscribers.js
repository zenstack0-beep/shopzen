const express = require('express');
const router = express.Router();
const { Subscriber } = require('../models/index');
const { adminAuth } = require('../middleware/auth');
const { CustomerMarketingPreference } = require('../models/Marketing');
const User = require('../models/User');

// Subscribe
router.post('/', async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });
    const normalizedEmail = String(email).trim().toLowerCase();
    const matchingCustomer = await User.findOne({ email: normalizedEmail, role: 'customer' }).select('_id').lean();
    const existing = await Subscriber.findOne({ email });
    if (existing) {
      existing.isActive = true; await existing.save();
      await CustomerMarketingPreference.findOneAndUpdate({ email: normalizedEmail }, { $set: { marketingConsent: true, consentSource: 'newsletter', consentTimestamp: new Date(), ...(matchingCustomer ? { customerId: matchingCustomer._id } : {}) }, $unset: { unsubscribedAt: 1, suppressionReason: 1 } }, { upsert: true, setDefaultsOnInsert: true });
      return res.json({ message: 'Already subscribed!' });
    }
    await Subscriber.create({ email, name });
    await CustomerMarketingPreference.findOneAndUpdate({ email: normalizedEmail }, { marketingConsent: true, consentSource: 'newsletter', consentTimestamp: new Date(), ...(matchingCustomer ? { customerId: matchingCustomer._id } : {}) }, { upsert: true, setDefaultsOnInsert: true });
    res.status(201).json({ message: 'Subscribed successfully!' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - All subscribers
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const subscribers = await Subscriber.find().sort({ createdAt: -1 });
    res.json(subscribers);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Export CSV
router.get('/admin/export', adminAuth, async (req, res) => {
  try {
    const subscribers = await Subscriber.find({ isActive: true });
    const csv = 'Email,Name,Date\n' + subscribers.map(s => `${s.email},${s.name || ''},${new Date(s.createdAt).toLocaleDateString()}`).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=subscribers.csv');
    res.send(csv);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
