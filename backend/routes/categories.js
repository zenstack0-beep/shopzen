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

// Get sibling categories (same parent) — used for "Related Categories" on product pages
router.get('/siblings/:categoryId', async (req, res) => {
  try {
    const current = await Category.findById(req.params.categoryId).lean();
    if (!current) return res.json([]);

    // Find all active categories that share the same parent (or are all top-level)
    const siblings = await Category.find({
      isActive: true,
      parent: current.parent || null,   // null means top-level categories
      _id: { $ne: current._id },        // exclude the current one
    })
      .sort({ sortOrder: 1, name: 1 })
      .limit(8)
      .lean();

    // If there's a parent, populate its name so the frontend can render "← All [ParentName]"
    if (current.parent) {
      const parent = await Category.findById(current.parent).lean();
      siblings.forEach(s => {
        s.parent = current.parent;
        s.parentName = parent?.name || '';
      });
    }

    res.json(siblings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;