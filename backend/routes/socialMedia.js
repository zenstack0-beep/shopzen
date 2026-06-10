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

// ─── PUBLIC: storefront footer social links (no secrets) ─────────────────────
// Returns only connected+enabled platforms with safe display fields.
router.get('/public', async (req, res) => {
  try {
    const SocialMedia = require('../models/SocialMedia');
    const PLATFORM_META = {
      facebook:  { label: 'Facebook',  color: '#1877f2', urlPrefix: 'https://facebook.com/' },
      instagram: { label: 'Instagram', color: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', urlPrefix: 'https://instagram.com/' },
      tiktok:    { label: 'TikTok',    color: '#010101', urlPrefix: 'https://tiktok.com/@' },
      whatsapp:  { label: 'WhatsApp',  color: '#25d366', urlPrefix: 'https://wa.me/' },
      telegram:  { label: 'Telegram',  color: '#229ed9', urlPrefix: 'https://t.me/' },
    };
    const doc = await SocialMedia.findOne().lean();
    if (!doc) return res.json([]);

    const platforms = Object.keys(PLATFORM_META);
    const result = platforms
      .filter(p => doc[p]?.connected && doc[p]?.enabled)
      .map(p => {
        const { label, color, urlPrefix } = PLATFORM_META[p];
        const acct = doc[p];
        // Build profile URL from handle, or accountId as fallback
        const handle = acct.accountHandle?.replace(/^@/, '') || acct.accountId || '';
        const url = p === 'whatsapp'
          ? `https://wa.me/${handle.replace(/[^0-9]/g, '')}`
          : handle ? `${urlPrefix}${handle}` : null;
        return {
          platform:    p,
          label,
          color,
          url,
          accountName:   acct.accountName   || label,
          accountHandle: acct.accountHandle  || '',
          accountAvatar: acct.accountAvatar  || '',
        };
      })
      .filter(p => p.url); // only include if we have a usable URL

    res.json(result);
  } catch (err) {
    console.error('social-media/public error:', err);
    res.json([]);
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// ─── TEMP DEBUG — no auth, remove after fixing ───────────────────────────────
router.get('/debug-whatsapp', async (req, res) => {
  const doc = await require('../models/SocialMedia').findOne();
  res.json(doc?.whatsapp?.extraConfig || {});
});

router.get('/fix-whatsapp', async (req, res) => {
  const SocialMedia = require('../models/SocialMedia');
  await SocialMedia.updateOne({}, {
    $set: {
      'whatsapp.extraConfig.templateName': 'hello_world',
      'whatsapp.extraConfig.languageCode': 'en_US',
    }
  });
  const doc = await SocialMedia.findOne();
  res.json(doc?.whatsapp?.extraConfig || {});
});
// ─── END TEMP ─────────────────────────────────────────────────────────────────

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