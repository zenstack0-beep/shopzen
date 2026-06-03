/**
 * routes/socialMedia.js
 * All routes are protected by adminAuth — credentials never leave the server.
 */

const express    = require('express');
const router     = express.Router();
const { adminAuth } = require('../middleware/auth');
const ctrl       = require('../controllers/socialMediaController');

// ─── All routes require admin auth ───────────────────────────────────────────
router.use(adminAuth);

// Settings overview (sanitized — no secrets)
router.get('/', ctrl.getSettings);

// Automation toggle + platform selection
router.put('/automation', ctrl.updateAutomation);

// Post templates
router.put('/templates', ctrl.updateTemplates);

// Per-platform routes
router.put   ('/platform/:platform',          ctrl.updatePlatform);
router.post  ('/platform/:platform/connect',  ctrl.connectPlatform);
router.delete('/platform/:platform',          ctrl.disconnectPlatform);
router.post  ('/platform/:platform/test',     ctrl.testConnection);
router.patch ('/platform/:platform/toggle',   ctrl.togglePlatform);

module.exports = router;