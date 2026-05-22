const express = require('express');
const router = express.Router();
const { Category } = require('../models/index');
const { adminAuth } = require('../middleware/auth');

// Get all active categories (public)
router.get('/', async (req, res) => {
  try {
    const cats = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
    res.json(cats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create category (admin)
router.post('/', adminAuth, async (req, res) => {
  try {
    const cat = await Category.create(req.body);
    res.status(201).json(cat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Update category (admin)
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const cat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Delete category (admin)
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await Category.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
