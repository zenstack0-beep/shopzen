/**
 * routes/seo.js — Full SEO backend
 *
 * GET  /api/seo/sitemap.xml          — Dynamic XML sitemap (images included)
 * GET  /api/seo/robots.txt           — Dynamic robots.txt
 * GET  /api/seo/meta                 — Store-level meta tags
 * GET  /api/seo/product-meta/:slug   — Per-product meta for SSR injection
 * POST /api/seo/bust-cache           — Clear sitemap cache
 *
 * SSR middleware exported:  seoRenderMiddleware
 * Mount: app.use('/api/seo', require('./routes/seo'));
 * Catch-all: app.get('*', require('./routes/seo').seoRenderMiddleware);
 */

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const Product          = require('../models/Product');
const { Category, Settings } = require('../models/index');

// ── XML helpers ───────────────────────────────────────────────────────────────
function xe(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function urlEntry(loc, lastmod, changefreq = 'weekly', priority = '0.7', imageUrl = null) {
  const img = imageUrl
    ? `\n    <image:image><image:loc>${xe(imageUrl)}</image:loc></image:image>`
    : '';
  return `  <url>
    <loc>${xe(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>${img}
  </url>`;
}

// ── In-memory sitemap cache ───────────────────────────────────────────────────
let sitemapCache    = null;
let sitemapCachedAt = 0;
const CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hour

async function getSiteUrl() {
  const s = await Settings.findOne({ key: 'seo_config' });
  return (s?.value?.siteUrl || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
}

// ── GET /api/seo/sitemap.xml ─────────────────────────────────────────────────
// Now includes product images → Google Image Search visibility
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
      Product.find({ isActive: true }, 'slug updatedAt thumbnail name brand shortDescription').lean(),
      Category.find({ isActive: true }, 'slug name updatedAt').lean(),
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
      // Products — with thumbnail image for Google Image Search
      ...products.map(p => urlEntry(
        `${siteUrl}/product/${p.slug}`,
        p.updatedAt ? new Date(p.updatedAt).toISOString().split('T')[0] : today,
        'weekly', '0.9',
        p.thumbnail || null
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

// ── GET /api/seo/robots.txt ──────────────────────────────────────────────────
router.get('/robots.txt', async (req, res) => {
  try {
    const siteUrl = await getSiteUrl();
    const noindex = (await Settings.findOne({ key: 'seo_noindex' }))?.value === true;

    let txt;
    if (noindex) {
      txt = `User-agent: *\nDisallow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
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

# Allow product images
Allow: /images/
Allow: /*.jpg$
Allow: /*.png$
Allow: /*.webp$

Crawl-delay: 1

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

// ── POST /api/seo/bust-cache ─────────────────────────────────────────────────
router.post('/bust-cache', (req, res) => {
  sitemapCache    = null;
  sitemapCachedAt = 0;
  res.json({ success: true, message: 'Sitemap cache cleared' });
});

// ── GET /api/seo/meta — Store-level meta ─────────────────────────────────────
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

    const siteUrl   = (s.seo_config?.siteUrl || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const storeName = s.storeName  || 'ShopZen';
    const metaTitle = s.seo_metaTitle || `${storeName} — Shop Online in Sri Lanka`;
    const metaDesc  = s.seo_metaDesc  || 'Shop the best products online in Sri Lanka. Fast delivery, best prices guaranteed at ShopZen.';
    const ogTitle   = s.seo_ogTitle   || metaTitle;
    const ogDesc    = s.seo_ogDesc    || metaDesc;
    const ogImage   = s.seo_ogImage   || `${siteUrl}/og-default.png`;

    res.json({
      siteUrl, storeName, metaTitle, metaDesc, ogTitle, ogDesc, ogImage,
      canonicalUrl:       siteUrl,
      googleVerification: s.seo_googleVerification || '',
      ga4Id:              s.seo_ga4Id    || '',
      gtmId:              s.seo_gtmId    || '',
      fbPixelId:          s.seo_fbPixelId || '',
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/seo/product-meta/:slug ──────────────────────────────────────────
// Returns per-product SEO data: meta title, description, OG tags, JSON-LD schema
// Frontend calls this on the product page to set dynamic <head> tags
router.get('/product-meta/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
      .populate('category', 'name slug')
      .lean();

    if (!product) return res.status(404).json({ message: 'Product not found' });

    const siteUrl    = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const productUrl = `${siteUrl}/product/${product.slug}`;
    const storeName  = 'ShopZen';

    // ── Build meta title (50–60 chars ideal) ──────────────────────────────────
    // Format: "Product Name - Brand | ShopZen"  OR  "Product Name | ShopZen"
    const brandPart   = product.brand ? ` - ${product.brand}` : '';
    const rawTitle    = `${product.name}${brandPart} | ${storeName}`;
    const metaTitle   = rawTitle.length > 65
      ? `${product.name.slice(0, 50)} | ${storeName}`
      : rawTitle;

    // ── Build meta description (140–160 chars ideal) ───────────────────────────
    const plainDesc  = String(product.shortDescription || product.description || '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const priceText  = product.salePrice
      ? `Rs.${product.salePrice.toLocaleString()} (was Rs.${product.price.toLocaleString()})`
      : `Rs.${product.price.toLocaleString()}`;
    const catName    = product.category?.name || '';
    const baseDesc   = plainDesc.slice(0, 100) || `${product.name} available online`;
    const metaDesc   = `${baseDesc}. Buy ${product.name} for ${priceText}. Fast delivery across Sri Lanka. Shop at ${storeName}.`.slice(0, 165);

    // ── OG image ──────────────────────────────────────────────────────────────
    const ogImage = product.thumbnail || (product.images?.[0]) || `${siteUrl}/og-default.png`;

    // ── Canonical URL ─────────────────────────────────────────────────────────
    const canonical = productUrl;

    // ── Breadcrumb keywords ───────────────────────────────────────────────────
    const keywords = [
      product.name,
      product.brand,
      catName,
      ...(product.tags || []),
      'buy in sri lanka',
      'online shopping sri lanka',
    ].filter(Boolean).join(', ');

    // ── JSON-LD Product Schema (Google Rich Results) ──────────────────────────
    const availability = product.stock > 0
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock';

    const offers = {
      '@type':           'Offer',
      url:               productUrl,
      priceCurrency:     'LKR',
      price:             product.salePrice || product.price,
      priceValidUntil:   new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      availability,
      seller: { '@type': 'Organization', name: storeName },
    };

    // Add price specification if on sale
    if (product.salePrice) {
      offers.priceSpecification = {
        '@type':         'PriceSpecification',
        price:           product.salePrice,
        priceCurrency:   'LKR',
      };
    }

    const schema = {
      '@context':   'https://schema.org',
      '@type':      'Product',
      name:         product.name,
      description:  plainDesc.slice(0, 500) || product.name,
      image:        [ogImage, ...(product.images || [])].filter(Boolean).slice(0, 5),
      sku:          product.sku || product._id.toString(),
      brand:        product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
      category:     catName,
      url:          productUrl,
      offers,
      ...(product.ratings?.count > 0 ? {
        aggregateRating: {
          '@type':       'AggregateRating',
          ratingValue:   product.ratings.average.toFixed(1),
          reviewCount:   product.ratings.count,
          bestRating:    '5',
          worstRating:   '1',
        },
      } : {}),
    };

    // Remove undefined brand
    if (!product.brand) delete schema.brand;

    // ── Breadcrumb Schema ─────────────────────────────────────────────────────
    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type':    'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home',    item: siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Shop',    item: `${siteUrl}/shop` },
        catName && { '@type': 'ListItem', position: 3, name: catName, item: `${siteUrl}/shop?category=${product.category?.slug}` },
        { '@type': 'ListItem', position: catName ? 4 : 3, name: product.name, item: productUrl },
      ].filter(Boolean),
    };

    res.json({
      metaTitle,
      metaDesc,
      canonical,
      ogTitle:       metaTitle,
      ogDesc:        metaDesc,
      ogImage,
      ogType:        'product',
      productUrl,
      keywords,
      schema,
      breadcrumbSchema,
      // Raw product data the frontend might need
      price:         product.price,
      salePrice:     product.salePrice,
      availability:  product.stock > 0 ? 'InStock' : 'OutOfStock',
      brand:         product.brand,
      category:      catName,
    });
  } catch (err) {
    console.error('[SEO /product-meta]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  SSR-lite middleware — injects correct meta into index.html for Googlebot
//  Usage in server.js:
//    const { seoRenderMiddleware } = require('./routes/seo');
//    app.get('*', seoRenderMiddleware);
// ══════════════════════════════════════════════════════════════════════════════
// ── HTML template cache ───────────────────────────────────────────────────────
// We cache the real index.html fetched from Vercel so SSR pages load the
// actual React app (correct JS/CSS bundles) instead of a blank shell.
// Cache refreshes every 6 hours so new Vercel deploys are picked up automatically.
let _htmlTemplate    = null;
let _htmlTemplateFetchedAt = 0;
const HTML_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

// Fetch the real index.html from the Vercel frontend and cache it.
// Falls back to a minimal shell (meta-tags only) if the fetch fails.
async function fetchAndCacheTemplate() {
  const frontendUrl = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
  try {
    const https = require('https');
    const html = await new Promise((resolve, reject) => {
      const req = https.get(frontendUrl, { timeout: 8000 }, (res) => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    // Only cache if it looks like a real React app (has <div id="root">)
    if (html.includes('id="root"') && html.includes('<script')) {
      _htmlTemplate = html;
      _htmlTemplateFetchedAt = Date.now();
      console.log('[SSR] Fetched and cached real index.html from Vercel (' + html.length + ' bytes)');
      return _htmlTemplate;
    }
    throw new Error('Fetched HTML missing React root or scripts');
  } catch (err) {
    console.warn('[SSR] Could not fetch index.html from Vercel:', err.message);
    return null;
  }
}

// Minimal fallback shell — only used if Vercel fetch fails AND no local build exists.
// Includes a client-side redirect so real browsers are sent to Vercel.
// Crawlers (Googlebot) don't follow JS redirects, so they still see the SSR meta tags.
function getMinimalShell() {
  const frontendUrl = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
  return `<!doctype html><html lang="en-LK"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5,viewport-fit=cover"/>
<link rel="icon" href="/favicon.ico"/>
<title>ShopZen</title>
<meta name="description" content="Shop online in Sri Lanka. Fast delivery, best prices at ShopZen."/>
<meta name="robots" content="index,follow,max-image-preview:large"/>
<link rel="canonical" href="${frontendUrl}"/>
__META_INJECT__
</head>
<body>
<noscript>You need to enable JavaScript to run this app.</noscript>
<div id="root"></div>
<script>
  // Redirect browsers to Vercel (crawlers ignore JS redirects — they see the meta tags above)
  (function(){
    var dest = '${frontendUrl}' + window.location.pathname + window.location.search;
    if (window.location.href.indexOf('${frontendUrl}') !== 0) window.location.replace(dest);
  })();
</script>
</body></html>`;
}

async function getHtmlTemplate() {
  const now = Date.now();

  // 1. Try local build first (Railway monolith deploy)
  const fs   = require('fs');
  const path = require('path');
  const candidates = [
    path.join(__dirname, '..', 'frontend', 'build', 'index.html'),
    path.join(__dirname, '..', 'public',   'index.html'),
    path.join(process.cwd(), 'frontend',   'build', 'index.html'),
    path.join(process.cwd(), 'public',     'index.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const html = fs.readFileSync(p, 'utf8');
      console.log('[SSR] Using local build:', p);
      return html;
    }
  }

  // 2. Use cached Vercel fetch if still fresh
  if (_htmlTemplate && (now - _htmlTemplateFetchedAt) < HTML_CACHE_TTL) {
    return _htmlTemplate;
  }

  // 3. Fetch fresh copy from Vercel (and cache it)
  const fetched = await fetchAndCacheTemplate();
  if (fetched) return fetched;

  // 4. Last resort: minimal shell with browser redirect
  console.log('[SSR] Using minimal shell fallback');
  return getMinimalShell();
}


async function getSeoMeta() {
  try {
    const rows = await Settings.find({
      key: { $in: ['seo_config','seo_metaTitle','seo_metaDesc','seo_ogTitle','seo_ogDesc','seo_ogImage','seo_googleVerification','storeName'] },
    }).lean();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    const siteUrl   = (s.seo_config?.siteUrl || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const storeName = s.storeName || 'ShopZen';
    return {
      siteUrl,
      metaTitle:    s.seo_metaTitle || `${storeName} — Shop Online in Sri Lanka`,
      metaDesc:     s.seo_metaDesc  || 'Shop the best products online in Sri Lanka. Fast delivery, best prices at ShopZen.',
      ogTitle:      s.seo_ogTitle   || s.seo_metaTitle || `${storeName} — Shop Online in Sri Lanka`,
      ogDesc:       s.seo_ogDesc    || s.seo_metaDesc  || 'Shop the best products online in Sri Lanka.',
      ogImage:      s.seo_ogImage   || `${siteUrl}/og-default.png`,
      verification: s.seo_googleVerification || '',
    };
  } catch { return null; }
}

const seoRenderMiddleware = async (req, res) => {
  if (req.path.startsWith('/api/') || req.path.match(/\.(js|css|png|jpg|ico|svg|json|xml|txt|woff2?)$/))
    return res.status(404).send('Not found');

  // Always set CORS header — Vercel proxies product pages here server-to-server
  // (no Origin header on those requests), so we must not gate this on origin.
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://shopzen.lk');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  const html = await getHtmlTemplate();
  if (!html) return res.status(500).send('Frontend build not found.');

  // ── Per-product SSR: inject product-specific meta ──────────────────────────
  const productMatch = req.path.match(/^\/product\/([^/]+)$/);
  if (productMatch) {
    try {
      const slug    = productMatch[1];
      const product = await Product.findOne({ slug, isActive: true })
        .populate('category', 'name slug').lean();

      if (product) {
        const siteUrl    = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
        const productUrl = `${siteUrl}/product/${product.slug}`;
        const storeName  = 'ShopZen';
        const brandPart  = product.brand ? ` - ${product.brand}` : '';
        const rawTitle   = `${product.name}${brandPart} | ${storeName}`;
        const metaTitle  = rawTitle.length > 65 ? `${product.name.slice(0, 50)} | ${storeName}` : rawTitle;
        const plainDesc  = String(product.shortDescription || product.description || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const priceText  = product.salePrice ? `Rs.${product.salePrice.toLocaleString()} (was Rs.${product.price.toLocaleString()})` : `Rs.${product.price.toLocaleString()}`;
        const metaDesc   = `${(plainDesc.slice(0,100) || product.name)}. Buy for ${priceText}. Fast delivery across Sri Lanka. Shop at ${storeName}.`.slice(0, 165);
        const ogImage    = product.thumbnail || product.images?.[0] || `${siteUrl}/og-default.png`;
        const keywords   = [product.name, product.brand, product.category?.name, ...(product.tags||[]), 'sri lanka'].filter(Boolean).join(', ');

        // Build JSON-LD
        const schema = {
          '@context': 'https://schema.org', '@type': 'Product',
          name: product.name, description: plainDesc.slice(0,500) || product.name,
          image: [ogImage, ...(product.images||[])].filter(Boolean).slice(0,5),
          sku: product.sku || product._id.toString(),
          ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
          offers: {
            '@type': 'Offer', url: productUrl, priceCurrency: 'LKR',
            price: product.salePrice || product.price,
            availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            seller: { '@type': 'Organization', name: storeName },
          },
          ...(product.ratings?.count > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: product.ratings.average.toFixed(1), reviewCount: product.ratings.count, bestRating: '5', worstRating: '1' } } : {}),
        };

        const breadcrumb = {
          '@context': 'https://schema.org', '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
            ...(product.category ? [{ '@type': 'ListItem', position: 3, name: product.category.name, item: `${siteUrl}/shop?category=${product.category.slug}` }] : []),
            { '@type': 'ListItem', position: product.category ? 4 : 3, name: product.name, item: productUrl },
          ],
        };

        // Replace __META_INJECT__ placeholder if using minimal shell fallback
        let out = (html.includes('__META_INJECT__') ? html.replace('__META_INJECT__', '') : html)
          .replace(/<title>[^<]*<\/title>/, `<title>${xe(metaTitle)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${xe(metaDesc)}$2`)
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${xe(productUrl)}$2`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${xe(metaTitle)}$2`)
          .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${xe(metaDesc)}$2`)
          .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${xe(ogImage)}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${xe(productUrl)}$2`)
          .replace(/(<meta property="og:type" content=")[^"]*(")/, `$1product$2`)
          .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${xe(metaTitle)}$2`)
          .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${xe(metaDesc)}$2`)
          .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${xe(ogImage)}$2`)
          .replace(/yourstore\.com/g, 'shopzen.lk');

        // Inject keywords meta
        if (!out.includes('name="keywords"')) {
          out = out.replace('</head>', `<meta name="keywords" content="${xe(keywords)}"/>\n</head>`);
        }

        // Inject JSON-LD schemas
        const schemaBlock = `<script type="application/ld+json">${JSON.stringify(schema)}</script>\n<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>\n</head>`;
        out = out.replace('</head>', schemaBlock);

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.send(out);
      }
    } catch (err) {
      console.error('[SSR product]', err.message);
      // fall through to generic render
    }
  }

  // ── Generic page SSR ──────────────────────────────────────────────────────
  const meta = await getSeoMeta();
  if (!meta) return res.send(html);

  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${xe(meta.metaTitle)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${xe(meta.metaDesc)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${xe(meta.siteUrl)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${xe(meta.ogTitle)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${xe(meta.ogDesc)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${xe(meta.ogImage)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${xe(meta.siteUrl)}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${xe(meta.ogTitle)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${xe(meta.ogDesc)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${xe(meta.ogImage)}$2`)
    .replace(/yourstore\.com/g, 'shopzen.lk');

  if (meta.verification)
    out = out.replace('</head>', `<meta name="google-site-verification" content="${xe(meta.verification)}"/>\n</head>`);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.send(out);
};

module.exports = router;
module.exports.seoRenderMiddleware = seoRenderMiddleware;