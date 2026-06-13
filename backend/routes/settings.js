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
// Build a proper multi-size ICO by fetching PNGs and combining manually
async function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const chunks = [];
    lib.get(url, (r) => {
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve(Buffer.concat(chunks)));
      r.on('error', reject);
    }).on('error', reject);
  });
}

router.get('/favicon.ico', async (req, res) => {
  try {
    const logoUrl = await getLogoUrl();
    if (!logoUrl) return res.status(404).send('No favicon configured');

    // Fetch 16, 32, 48 px PNG versions from Cloudinary
    const sizes = [16, 32, 48];
    const pngBuffers = await Promise.all(
      sizes.map(s => fetchBuffer(logoUrl.replace('/upload/', `/upload/w_${s},h_${s},c_fit,f_png/`)))
    );

    // Build ICO manually: ICONDIR + ICONDIRENTRY * n + PNG data
    const num = sizes.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);   // reserved
    header.writeUInt16LE(1, 2);   // type: ICO
    header.writeUInt16LE(num, 4); // count

    let offset = 6 + num * 16;
    const entries = [];
    for (let i = 0; i < num; i++) {
      const s = sizes[i];
      const entry = Buffer.alloc(16);
      entry.writeUInt8(s === 256 ? 0 : s, 0);  // width
      entry.writeUInt8(s === 256 ? 0 : s, 1);  // height
      entry.writeUInt8(0, 2);                   // color count
      entry.writeUInt8(0, 3);                   // reserved
      entry.writeUInt16LE(1, 4);                // planes
      entry.writeUInt16LE(32, 6);               // bit count
      entry.writeUInt32LE(pngBuffers[i].length, 8);  // size
      entry.writeUInt32LE(offset, 12);               // offset
      entries.push(entry);
      offset += pngBuffers[i].length;
    }

    const ico = Buffer.concat([header, ...entries, ...pngBuffers]);

    res.setHeader('Content-Type', 'image/x-icon');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(ico);
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