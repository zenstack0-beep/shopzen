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

// Save settings (admin) — pass an object of key:value pairs.
// Uses bulkWrite so all keys are saved in ONE round-trip to MongoDB instead of
// one sequential await per key. This prevents axios timeout errors on large
// settings objects and eliminates the false "Failed to save settings" toast.
router.put('/', adminAuth, async (req, res) => {
  try {
    const entries = Object.entries(req.body);
    if (entries.length === 0) return res.json({ success: true });

    const ops = entries.map(([key, value]) => ({
      updateOne: {
        filter: { key },
        update: { $set: { key, value, updatedAt: new Date() } },
        upsert: true,
      },
    }));

    await Settings.bulkWrite(ops, { ordered: false });
    res.json({ success: true });
  } catch (err) {
    console.error('Settings save error:', err);
    res.status(500).json({ message: err.message || 'Failed to save settings' });
  }
});

module.exports = router;