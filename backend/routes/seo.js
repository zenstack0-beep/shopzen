/**
 * seo.js — SEO backend routes
 *
 * GET /api/seo/sitemap.xml   — Dynamic XML sitemap
 * GET /api/seo/robots.txt    — Dynamic robots.txt
 *
 * Mount in server.js:  app.use('/api/seo', require('./routes/seo'));
 *
 * Vercel serves the frontend, so the frontend must proxy these:
 *   /sitemap.xml  → <BACKEND_URL>/api/seo/sitemap.xml  (via vercel.json rewrite)
 *   /robots.txt   → <BACKEND_URL>/api/seo/robots.txt
 *
 * The sitemap is cached 1 hour in memory (configurable).
 */

const express = require('express');
const router  = express.Router();
const Product    = require('../models/Product');
const { Category, Settings } = require('../models/index');

// ── helpers ───────────────────────────────────────────────────────────────────
function xmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function urlEntry(loc, lastmod, changefreq = 'weekly', priority = '0.7') {
  return `  <url>
    <loc>${xmlEscape(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}

// ── In-memory cache ───────────────────────────────────────────────────────────
let sitemapCache    = null;
let sitemapCachedAt = 0;
const CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hour

async function getSiteUrl() {
  const s = await Settings.findOne({ key: 'seo_config' });
  return (s?.value?.siteUrl || process.env.FRONTEND_URL || 'https://yourstore.com').replace(/\/$/, '');
}

// ── GET /api/seo/sitemap.xml ──────────────────────────────────────────────────
router.get('/sitemap.xml', async (req, res) => {
  try {
    const now = Date.now();
    if (sitemapCache && now - sitemapCachedAt < CACHE_TTL_MS) {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(sitemapCache);
    }

    const [siteUrl, products, categories] = await Promise.all([
      getSiteUrl(),
      Product.find({ isActive: true }, 'slug updatedAt').lean(),
      Category.find({ isActive: true }, 'slug updatedAt').lean(),
    ]);

    const today = new Date().toISOString().split('T')[0];

    const staticPages = [
      { path: '/',           freq: 'daily',   pri: '1.0' },
      { path: '/shop',       freq: 'daily',   pri: '0.9' },
      { path: '/gift-cards', freq: 'monthly', pri: '0.5' },
    ];

    const entries = [
      ...staticPages.map(p => urlEntry(`${siteUrl}${p.path}`, today, p.freq, p.pri)),
      ...categories.map(c => urlEntry(
        `${siteUrl}/shop?category=${c.slug}`,
        c.updatedAt ? new Date(c.updatedAt).toISOString().split('T')[0] : today,
        'weekly', '0.8'
      )),
      ...products.map(p => urlEntry(
        `${siteUrl}/product/${p.slug}`,
        p.updatedAt ? new Date(p.updatedAt).toISOString().split('T')[0] : today,
        'weekly', '0.9'
      )),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>`;

    sitemapCache    = xml;
    sitemapCachedAt = now;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('Sitemap error:', err);
    res.status(500).send('<?xml version="1.0"?><error>Sitemap generation failed</error>');
  }
});

// ── GET /api/seo/robots.txt ───────────────────────────────────────────────────
router.get('/robots.txt', async (req, res) => {
  try {
    const siteUrl = await getSiteUrl();
    const noindex = (await Settings.findOne({ key: 'seo_noindex' }))?.value === true;

    let txt;
    if (noindex) {
      txt = `User-agent: *\nDisallow: /\n\n# Sitemap\nSitemap: ${siteUrl}/sitemap.xml\n`;
    } else {
      txt = `# ShopZen robots.txt — auto-generated
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /api/
Disallow: /checkout/
Disallow: /account/
Disallow: /cart/
Disallow: /login
Disallow: /register
Disallow: /forgot-password
Disallow: /*?*sort=
Disallow: /*?*page=

# Crawl-delay for well-behaved bots
Crawl-delay: 1

# Sitemap
Sitemap: ${siteUrl}/sitemap.xml
`;
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(txt);
  } catch (err) {
    console.error('robots.txt error:', err);
    res.status(500).send('User-agent: *\nAllow: /\n');
  }
});

// ── Bust sitemap cache (called after product/category save) ───────────────────
router.post('/bust-cache', (req, res) => {
  sitemapCache    = null;
  sitemapCachedAt = 0;
  res.json({ success: true, message: 'Sitemap cache cleared' });
});

module.exports = router;
