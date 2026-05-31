const express = require('express');
const router = express.Router();
const { Notification } = require('../models/index');
const { adminAuth } = require('../middleware/auth');

// ── Get all notifications + unread count ──────────────────────────────────────
router.get('/', adminAuth, async (req, res) => {
  try {
    const notifications = await Notification.find().sort({ createdAt: -1 }).limit(100);
    const unreadCount = await Notification.countDocuments({ isRead: false });
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Mark all as read ──────────────────────────────────────────────────────────
router.put('/read-all', adminAuth, async (req, res) => {
  try {
    await Notification.updateMany({}, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Delete all READ notifications ─────────────────────────────────────────────
// FIX: This route MUST be declared BEFORE /:id routes, otherwise Express
//      matches "clear-read" as the :id parameter and this endpoint is never reached.
router.delete('/clear-read', adminAuth, async (req, res) => {
  try {
    const result = await Notification.deleteMany({ isRead: true });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Delete ALL notifications ──────────────────────────────────────────────────
router.delete('/clear-all', adminAuth, async (req, res) => {
  try {
    const result = await Notification.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Mark single as read ───────────────────────────────────────────────────────
router.put('/:id/read', adminAuth, async (req, res) => {
  try {
    const notif = await Notification.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );
    if (!notif) return res.status(404).json({ message: 'Notification not found' });
    res.json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Delete single notification ────────────────────────────────────────────────
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;