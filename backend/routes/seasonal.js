const express = require('express');
const router = express.Router();
const { SeasonalCampaign, Coupon } = require('../models/index');
const { adminAuth } = require('../middleware/auth');

// Public - Get active campaign
router.get('/active', async (req, res) => {
  try {
    const now = new Date();
    const campaign = await SeasonalCampaign.findOne({
      isActive: true,
      $and: [
        { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: now } }] }
      ]
    }).sort({ createdAt: -1 });
    res.json(campaign || null);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Public - Get campaign by slug (for dynamic campaign pages)
router.get('/page/:slug', async (req, res) => {
  try {
    const now = new Date();
    const campaign = await SeasonalCampaign.findOne({
      pageSlug: req.params.slug,
      $and: [
        { $or: [{ startDate: { $exists: false } }, { startDate: null }, { startDate: { $lte: now } }] },
        { $or: [{ endDate: { $exists: false } }, { endDate: null }, { endDate: { $gte: now } }] }
      ]
    });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    res.json(campaign);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Deactivate ALL — must be BEFORE /:id routes
router.put('/admin/deactivate-all', adminAuth, async (req, res) => {
  try {
    await SeasonalCampaign.updateMany({}, { isActive: false });
    res.json({ message: 'All campaigns deactivated' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Get all campaigns
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const campaigns = await SeasonalCampaign.find().sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Create campaign
router.post('/admin', adminAuth, async (req, res) => {
  try {
    const data = { ...req.body };
    // Auto-create coupon if requested
    if (data.couponAutoCreate && data.couponCode && data.couponValue > 0) {
      try {
        await Coupon.findOneAndUpdate(
          { code: data.couponCode.toUpperCase() },
          {
            code: data.couponCode.toUpperCase(),
            description: data.couponDescription || data.name,
            type: data.couponType || 'percentage',
            value: data.couponValue,
            minOrderAmount: data.couponMinOrder || 0,
            validFrom: data.startDate || new Date(),
            validUntil: data.endDate || new Date(Date.now() + 30 * 86400000),
            isActive: true
          },
          { upsert: true, new: true }
        );
      } catch (couponErr) { console.warn('Coupon auto-create warning:', couponErr.message); }
    }
    const campaign = await SeasonalCampaign.create(data);
    res.status(201).json(campaign);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Toggle activate (deactivates all others first) — BEFORE /:id
router.put('/admin/:id/toggle', adminAuth, async (req, res) => {
  try {
    await SeasonalCampaign.updateMany({}, { isActive: false });
    const campaign = await SeasonalCampaign.findByIdAndUpdate(
      req.params.id, { isActive: true }, { new: true }
    );
    res.json(campaign);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Update campaign
router.put('/admin/:id', adminAuth, async (req, res) => {
  try {
    const data = { ...req.body };
    if (data.couponAutoCreate && data.couponCode && data.couponValue > 0) {
      try {
        await Coupon.findOneAndUpdate(
          { code: data.couponCode.toUpperCase() },
          {
            code: data.couponCode.toUpperCase(),
            description: data.couponDescription || data.name,
            type: data.couponType || 'percentage',
            value: data.couponValue,
            minOrderAmount: data.couponMinOrder || 0,
            validFrom: data.startDate || new Date(),
            validUntil: data.endDate || new Date(Date.now() + 30 * 86400000),
            isActive: true
          },
          { upsert: true, new: true }
        );
      } catch (couponErr) { console.warn('Coupon auto-create warning:', couponErr.message); }
    }
    const campaign = await SeasonalCampaign.findByIdAndUpdate(req.params.id, data, { new: true });
    res.json(campaign);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Delete campaign
router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    await SeasonalCampaign.findByIdAndDelete(req.params.id);
    res.json({ message: 'Campaign deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
