const express = require('express');
const router = express.Router();
const { Settings } = require('../models/index');
const { adminAuth } = require('../middleware/auth');
const { clearThemeCache } = require('../utils/mailer');
const https = require('https');
const http = require('http');

// ── Helper: proxy an image URL to the response ────────────────────────────────
function proxyImage(imageUrl, res, fallbackContentType = 'image/png') {
  try {
    const parsed = new URL(imageUrl);
    const lib = parsed.protocol === 'https:' ? https : http;
    lib.get(imageUrl, (imgRes) => {
      const ct = imgRes.headers['content-type'] || fallbackContentType;
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.setHeader('Access-Control-Allow-Origin', '*');
      imgRes.pipe(res);
    }).on('error', () => res.status(502).send('Could not fetch image'));
  } catch {
    res.status(400).send('Invalid image URL');
  }
}

// ── Favicon proxy — served from shopzen.lk/api/settings/favicon.ico ──────────
// vercel.json rewrites /favicon.ico → /api/settings/favicon.ico
// so Google always gets the current logo as a proper ICO/PNG
router.get('/favicon.ico', async (req, res) => {
  try {
    const logoUrl = await getLogoUrl();
    if (!logoUrl) return res.status(404).send('No favicon configured');
    // Ask Cloudinary for a 48x48 ICO (covers 16, 32, 48 sizes)
    const url = logoUrl.replace('/upload/', '/upload/w_48,h_48,c_fit,f_ico/');
    proxyImage(url, res, 'image/x-icon');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Helper to get logo URL from DB
async function getLogoUrl() {
  const row = await Settings.findOne({ key: 'faviconUrl' }) || await Settings.findOne({ key: 'logoUrl' });
  return row?.value || null;
}

// /favicon.png → 192x192 (Google search result icon)
router.get('/favicon.png', async (req, res) => {
  try {
    const logoUrl = await getLogoUrl();
    if (!logoUrl) return res.status(404).send('No favicon configured');
    const url = logoUrl.replace('/upload/', '/upload/w_192,h_192,c_fit,f_png/');
    proxyImage(url, res, 'image/png');
  } catch (err) { res.status(500).send(err.message); }
});

// /favicon-96x96.png → exactly 96x96
router.get('/favicon-96x96.png', async (req, res) => {
  try {
    const logoUrl = await getLogoUrl();
    if (!logoUrl) return res.status(404).send('No favicon configured');
    const url = logoUrl.replace('/upload/', '/upload/w_96,h_96,c_fit,f_png/');
    proxyImage(url, res, 'image/png');
  } catch (err) { res.status(500).send(err.message); }
});

// /favicon-32x32.png → exactly 32x32
router.get('/favicon-32x32.png', async (req, res) => {
  try {
    const logoUrl = await getLogoUrl();
    if (!logoUrl) return res.status(404).send('No favicon configured');
    const url = logoUrl.replace('/upload/', '/upload/w_32,h_32,c_fit,f_png/');
    proxyImage(url, res, 'image/png');
  } catch (err) { res.status(500).send(err.message); }
});

// /apple-touch-icon.png → 180x180
router.get('/apple-touch-icon.png', async (req, res) => {
  try {
    const logoUrl = await getLogoUrl();
    if (!logoUrl) return res.status(404).send('No favicon configured');
    const url = logoUrl.replace('/upload/', '/upload/w_180,h_180,c_fit,f_png/');
    proxyImage(url, res, 'image/png');
  } catch (err) { res.status(500).send(err.message); }
});

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
    clearThemeCache(); // invalidate email theme cache so next mail uses new colours
    res.json({ success: true });
  } catch (err) {
    console.error('Settings save error:', err);
    res.status(500).json({ message: err.message || 'Failed to save settings' });
  }
});

module.exports = router;