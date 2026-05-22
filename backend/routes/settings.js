const express = require('express');
const router = express.Router();
const { Settings } = require('../models/index');
const { adminAuth } = require('../middleware/auth');

// Get all settings as a flat key→value object (public — needed for store name etc.)
router.get('/', async (req, res) => {
  try {
    const settings = await Settings.find();
    const obj = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    res.json(obj);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Save settings (admin) — pass an object of key:value pairs
router.put('/', adminAuth, async (req, res) => {
  try {
    const updates = Object.entries(req.body);
    for (const [key, value] of updates) {
      await Settings.findOneAndUpdate(
        { key },
        { key, value, updatedAt: Date.now() },
        { upsert: true, new: true }
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
