/**
 * routes/socialMedia.js
 * All routes are protected by adminAuth — credentials never leave the server.
 */

const express    = require('express');
const router     = express.Router();
const { adminAuth } = require('../middleware/auth');
const ctrl       = require('../controllers/socialMediaController');
const { refreshPlatformNow } = require('../services/tokenRefreshScheduler');
const { getOrCreate, decryptPlatformFields } = require('../services/socialMediaService');
const { inspectToken } = require('../services/facebookTokenRefresh');

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

// Manual token refresh (Facebook / Instagram only)
// POST /api/social-media/platform/:platform/refresh-token
router.post('/platform/:platform/refresh-token', async (req, res) => {
  const { platform } = req.params;
  if (!['facebook', 'instagram'].includes(platform)) {
    return res.status(400).json({ message: 'Token refresh is only available for Facebook and Instagram' });
  }
  try {
    const result = await refreshPlatformNow(platform);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Token status — returns expiry info for the admin UI
// GET /api/social-media/platform/:platform/token-status
router.get('/platform/:platform/token-status', async (req, res) => {
  const { platform } = req.params;
  try {
    const doc = await getOrCreate();
    const raw = doc[platform]?.toObject ? doc[platform].toObject() : (doc[platform] || {});

    if (!raw.connected) return res.json({ connected: false });

    const creds = decryptPlatformFields(raw);
    let inspection = { valid: null, expiresAt: raw.tokenExpiresAt, scopes: [], error: null };

    // Optionally do a live inspection if App credentials exist
    if (['facebook', 'instagram'].includes(platform) && creds.appId && creds.appSecret && creds.accessToken) {
      inspection = await inspectToken(creds.accessToken, creds.appId, creds.appSecret);
      // If live inspection gives us a better expiry, persist it
      if (inspection.expiresAt && String(inspection.expiresAt) !== String(raw.tokenExpiresAt)) {
        await doc.constructor.updateOne({}, {
          $set: { [`${platform}.tokenExpiresAt`]: inspection.expiresAt, updatedAt: new Date() },
        });
      }
    }

    res.json({
      connected:            raw.connected,
      tokenExpiresAt:       inspection.expiresAt || raw.tokenExpiresAt,
      tokenLastRefreshedAt: raw.tokenLastRefreshedAt,
      tokenRefreshError:    raw.tokenRefreshError,
      reconnectNeeded:      raw.reconnectNeeded,
      tokenValid:           inspection.valid,
      scopes:               inspection.scopes,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;