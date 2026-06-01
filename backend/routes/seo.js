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

// ── GET /api/seo/meta — Returns all live SEO values from DB ──────────────────
// Frontend calls this on mount to hydrate dynamic meta tags.
// Googlebot also calls this when crawling via the SSR-lite endpoint below.
router.get('/meta', async (req, res) => {
  try {
    const rows = await Settings.find({
      key: {
        $in: [
          'seo_config', 'seo_metaTitle', 'seo_metaDesc', 'seo_ogTitle',
          'seo_ogDesc', 'seo_ogImage', 'seo_googleVerification',
          'seo_ga4Id', 'seo_gtmId', 'seo_fbPixelId',
          'storeName', 'storeTagline',
        ],
      },
    }).lean();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });

    const siteUrl    = (s.seo_config?.siteUrl || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const storeName  = s.storeName  || 'ShopZen';
    const metaTitle  = s.seo_metaTitle || `${storeName} — Premium Online Store`;
    const metaDesc   = s.seo_metaDesc  || 'Shop the best products online in Sri Lanka. Fast delivery, best prices at ShopZen.';
    const ogTitle    = s.seo_ogTitle   || metaTitle;
    const ogDesc     = s.seo_ogDesc    || metaDesc;
    const ogImage    = s.seo_ogImage   || `${siteUrl}/og-default.png`;

    res.json({
      siteUrl,
      storeName,
      metaTitle,
      metaDesc,
      ogTitle,
      ogDesc,
      ogImage,
      canonicalUrl:       siteUrl,
      googleVerification: s.seo_googleVerification || '',
      ga4Id:              s.seo_ga4Id   || '',
      gtmId:              s.seo_gtmId   || '',
      fbPixelId:          s.seo_fbPixelId || '',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/seo/render — SSR-lite: index.html with injected meta tags ────────
// server.js serves ALL non-API routes via this handler so Googlebot gets
// a fully-populated <head> instead of the placeholder-filled static file.
// Usage in server.js:
//   const { seoRenderMiddleware } = require('./routes/seo');
//   app.get('*', seoRenderMiddleware);
const fs   = require('fs');
const pathm = require('path');

// Cache the base HTML template in memory (file read only once)
let _htmlTemplate = null;
function getHtmlTemplate() {
  if (_htmlTemplate) return _htmlTemplate;
  // Walk up from routes/ to find the built frontend
  const candidates = [
    pathm.join(__dirname, '..', 'frontend', 'build', 'index.html'),
    pathm.join(__dirname, '..', 'public', 'index.html'),
    pathm.join(process.cwd(), 'frontend', 'build', 'index.html'),
    pathm.join(process.cwd(), 'public', 'index.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) { _htmlTemplate = fs.readFileSync(p, 'utf8'); return _htmlTemplate; }
  }
  return null;
}

async function getSeoMeta() {
  try {
    const rows = await Settings.find({
      key: {
        $in: [
          'seo_config', 'seo_metaTitle', 'seo_metaDesc', 'seo_ogTitle',
          'seo_ogDesc', 'seo_ogImage', 'seo_googleVerification', 'storeName',
        ],
      },
    }).lean();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    const siteUrl   = (s.seo_config?.siteUrl || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const storeName = s.storeName || 'ShopZen';
    return {
      siteUrl,
      metaTitle:  s.seo_metaTitle || `${storeName} — Premium Online Store`,
      metaDesc:   s.seo_metaDesc  || 'Shop the best products online in Sri Lanka.',
      ogTitle:    s.seo_ogTitle   || s.seo_metaTitle || `${storeName} — Premium Online Store`,
      ogDesc:     s.seo_ogDesc    || s.seo_metaDesc  || 'Shop the best products online in Sri Lanka.',
      ogImage:    s.seo_ogImage   || `${siteUrl}/og-default.png`,
      verification: s.seo_googleVerification || '',
    };
  } catch { return null; }
}

const seoRenderMiddleware = async (req, res) => {
  // Never intercept API or static asset requests
  if (req.path.startsWith('/api/') || req.path.match(/\.(js|css|png|jpg|ico|svg|json|xml|txt|woff2?)$/)) {
    return res.status(404).send('Not found');
  }

  const html = getHtmlTemplate();
  if (!html) return res.status(500).send('Frontend build not found. Run: cd frontend && npm run build');

  const meta = await getSeoMeta();
  if (!meta) return res.send(html); // fallback: serve as-is

  const xe = (s) => String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

  let out = html
    // Fix title
    .replace(/<title>[^<]*<\/title>/, `<title>${xe(meta.metaTitle)}</title>`)
    // Fix meta description
    .replace(/(<meta name="description" content=")[^"]*(")/,  `$1${xe(meta.metaDesc)}$2`)
    // Fix canonical
    .replace(/(<link rel="canonical" href=")[^"]*(")/,        `$1${xe(meta.siteUrl)}$2`)
    // Fix OG title
    .replace(/(<meta property="og:title" content=")[^"]*(")/,       `$1${xe(meta.ogTitle)}$2`)
    // Fix OG description
    .replace(/(<meta property="og:description" content=")[^"]*(")/,`$1${xe(meta.ogDesc)}$2`)
    // Fix OG image
    .replace(/(<meta property="og:image" content=")[^"]*(")/,       `$1${xe(meta.ogImage)}$2`)
    // Fix OG url
    .replace(/(<meta property="og:url" content=")[^"]*(")/,         `$1${xe(meta.siteUrl)}$2`)
    // Fix twitter title
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/,       `$1${xe(meta.ogTitle)}$2`)
    // Fix twitter description
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/,`$1${xe(meta.ogDesc)}$2`)
    // Fix twitter image
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/,       `$1${xe(meta.ogImage)}$2`)
    // Fix yourstore.com placeholders anywhere remaining
    .replace(/yourstore\.com/g, 'shopzen.lk');

  // Inject Google verification tag if set (before </head>)
  if (meta.verification) {
    out = out.replace('</head>', `<meta name="google-site-verification" content="${xe(meta.verification)}"/>\n</head>`);
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate'); // always fresh for crawlers
  res.send(out);
};

module.exports.seoRenderMiddleware = seoRenderMiddleware;