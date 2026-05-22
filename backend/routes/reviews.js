const express = require('express');
const router = express.Router();
const { Review } = require('../models/index');
const Product = require('../models/Product');
const { auth, adminAuth } = require('../middleware/auth');

// ── Admin routes FIRST ────────────────────────────────────────────────────────

router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const reviews = await Review.find()
      .populate('user', 'firstName lastName')
      .populate('product', 'name')
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/admin/:id/approve', adminAuth, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { isApproved: !req.body.approved },
      { new: true }
    );
    res.json(review);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Public routes ─────────────────────────────────────────────────────────────

router.get('/product/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({
      product: req.params.productId,
      isApproved: true
    })
      .populate('user', 'firstName lastName avatar')
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const review = await Review.create({ ...req.body, user: req.user._id });
    const reviews = await Review.find({ product: req.body.product, isApproved: true });
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / (reviews.length || 1);
    await Product.findByIdAndUpdate(req.body.product, {
      'ratings.average': avg,
      'ratings.count': reviews.length
    });
    res.status(201).json(review);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
