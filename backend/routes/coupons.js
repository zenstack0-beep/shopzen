const express = require('express');
const router = express.Router();
const { Coupon } = require('../models/index');
const { adminAuth, auth } = require('../middleware/auth');

// Validate coupon (public)
router.post('/validate', async (req, res) => {
  try {
    const { code, orderAmount, userId, categoryIds, productIds, brands } = req.body;
    const coupon = await Coupon.findOne({ code: code.toUpperCase(), isActive: true, validUntil: { $gte: new Date() } });
    if (!coupon) return res.status(404).json({ message: 'Invalid or expired coupon code' });
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return res.status(400).json({ message: 'Coupon usage limit reached' });
    if (orderAmount < coupon.minOrderAmount) return res.status(400).json({ message: `Minimum order Rs. ${coupon.minOrderAmount} required` });
    if (coupon.isNewUserOnly && userId) {
      const Order = require('../models/Order');
      const prevOrders = await Order.countDocuments({ customer: userId });
      if (prevOrders > 0) return res.status(400).json({ message: 'This coupon is for new customers only' });
    }
    // Check if user already used this coupon
    if (userId && coupon.usedBy.includes(userId)) return res.status(400).json({ message: 'You have already used this coupon' });
    // Check eligibility restrictions
    const hasCategRestriction = coupon.applicableCategories?.length > 0;
    const hasProdRestriction = coupon.applicableProducts?.length > 0;
    const hasBrandRestriction = coupon.applicableBrands?.length > 0;
    if (hasCategRestriction || hasProdRestriction || hasBrandRestriction) {
      const catMatch = !hasCategRestriction || (categoryIds || []).some(id => coupon.applicableCategories.map(c=>c.toString()).includes(id));
      const prodMatch = !hasProdRestriction || (productIds || []).some(id => coupon.applicableProducts.map(p=>p.toString()).includes(id));
      const brandMatch = !hasBrandRestriction || (brands || []).some(b => coupon.applicableBrands.includes(b));
      if (!catMatch && !prodMatch && !brandMatch) return res.status(400).json({ message: 'This coupon is not applicable to your cart items' });
    }
    let discount = coupon.type === 'percentage'
      ? Math.min((orderAmount * coupon.value) / 100, coupon.maxDiscount || Infinity)
      : coupon.value;
    discount = Math.round(discount);
    res.json({ valid: true, discount, coupon: { code: coupon.code, type: coupon.type, value: coupon.value, description: coupon.description } });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Get all coupons
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate('applicableCategories', 'name')
      .populate('applicableProducts', 'name')
      .sort({ createdAt: -1 });
    res.json(coupons);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Get all active coupons (for display)
router.get('/', adminAuth, async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.json(coupons);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Create coupon
router.post('/', adminAuth, async (req, res) => {
  try {
    const coupon = await Coupon.create(req.body);
    res.status(201).json(coupon);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Update coupon
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(coupon);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Delete coupon
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await Coupon.findByIdAndDelete(req.params.id);
    res.json({ message: 'Coupon deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
