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
router.get('/product-meta/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
      .populate('category', 'name slug')
      .lean();

    if (!product) return res.status(404).json({ message: 'Product not found' });

    const siteUrl    = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const productUrl = `${siteUrl}/product/${product.slug}`;
    const storeName  = 'ShopZen';

    const metaTitle = buildProductTitle(product, storeName);

    const plainDesc  = String(product.shortDescription || product.description || '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const priceText  = product.salePrice
      ? `Rs.${product.salePrice.toLocaleString()} (was Rs.${product.price.toLocaleString()})`
      : `Rs.${product.price.toLocaleString()}`;
    const catName    = product.category?.name || '';
    const baseDesc   = plainDesc.slice(0, 100) || `${product.name} available online`;
    const metaDesc   = `${baseDesc}. Buy ${product.name} for ${priceText}. Fast delivery across Sri Lanka. Shop at ${storeName}.`.slice(0, 165);

    const ogImage = product.thumbnail || (product.images?.[0]) || `${siteUrl}/og-default.png`;
    const canonical = productUrl;

    const keywords = [
      product.name,
      product.brand,
      catName,
      ...(product.tags || []),
      'buy in sri lanka',
      'online shopping sri lanka',
    ].filter(Boolean).join(', ');

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

    if (!product.brand) delete schema.brand;

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
// ══════════════════════════════════════════════════════════════════════════════

let _htmlTemplate    = null;
let _htmlTemplateFetchedAt = 0;
const HTML_CACHE_TTL = 6 * 60 * 60 * 1000;

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
  (function(){
    var dest = '${frontendUrl}' + window.location.pathname + window.location.search;
    if (window.location.href.indexOf('${frontendUrl}') !== 0) window.location.replace(dest);
  })();
</script>
</body></html>`;
}

async function getHtmlTemplate() {
  const now = Date.now();

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

  if (_htmlTemplate && (now - _htmlTemplateFetchedAt) < HTML_CACHE_TTL) {
    return _htmlTemplate;
  }

  const fetched = await fetchAndCacheTemplate();
  if (fetched) return fetched;

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


function buildProductTitle(product, storeName) {
  const name  = (product.name  || '').trim();
  const brand = (product.brand || '').trim();
  const sku   = (product.sku   || '').trim();

  const modelRe = /\b([A-Z]{1,5}-?[A-Z0-9]{2,}(?:-[A-Z0-9]+)*)\b/g;
  const nameModels = [...name.matchAll(modelRe)].map(m => m[1]);

  let model = nameModels.length ? nameModels[0] : null;
  if (sku && !name.includes(sku) && !nameModels.some(m => sku.includes(m) || m.includes(sku))) {
    model = sku;
  }

  const suffix = ' Price in Sri Lanka | ' + storeName;

  let core = name;
  if (brand) {
    const eb = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    core = core.replace(new RegExp('\\s*-\\s*' + eb + '(\\s+\\S+)*\\s*$', 'i'), '').trim();
  }
  core = core.replace(/\s+-\s+\S+\s*$/, '').trim();

  if (model && !core.includes(model)) {
    if (brand && core.toLowerCase().startsWith(brand.toLowerCase())) {
      core = core.slice(0, brand.length) + ' ' + model + core.slice(brand.length);
    } else {
      core = model + ' ' + core;
    }
  }

  const maxCore = 75 - suffix.length;
  if (core.length > maxCore) core = core.slice(0, maxCore - 1).trim();

  return core + suffix;
}

// ── injectMeta: replace all standard meta tags in the HTML template ───────────
function injectMeta(html, { title, desc, canonical, ogTitle, ogDesc, ogImage, ogUrl, ogType, keywords, schemas, verification }) {
  let out = (html.includes('__META_INJECT__') ? html.replace('__META_INJECT__', '') : html)
    .replace(/<title>[^<]*<\/title>/, `<title>${xe(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/,    `$1${xe(desc)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/,          `$1${xe(canonical)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/,   `$1${xe(ogTitle || title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${xe(ogDesc || desc)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/,   `$1${xe(ogImage)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/,     `$1${xe(ogUrl || canonical)}$2`)
    .replace(/(<meta property="og:type" content=")[^"]*(")/,    `$1${xe(ogType || 'website')}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/,  `$1${xe(ogTitle || title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${xe(ogDesc || desc)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/,  `$1${xe(ogImage)}$2`)
    .replace(/yourstore\.com/g, 'shopzen.lk');

  if (keywords) {
    if (!out.includes('name="keywords"')) {
      out = out.replace('</head>', `<meta name="keywords" content="${xe(keywords)}"/>\n</head>`);
    } else {
      out = out.replace(/(<meta name="keywords" content=")[^"]*(")/i, `$1${xe(keywords)}$2`);
    }
  }

  if (verification) {
    out = out.replace('</head>', `<meta name="google-site-verification" content="${xe(verification)}"/>\n</head>`);
  }

  if (schemas && schemas.length) {
    const schemaBlock = schemas
      .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
      .join('\n');
    out = out.replace('</head>', schemaBlock + '\n</head>');
  }

  return out;
}

// ── SSR: /shop and /shop?category=slug pages ──────────────────────────────────
async function renderShopPage(req, html, siteUrl, storeName, defaultOgImage) {
  const categorySlug = req.query.category || null;
  const searchQ      = req.query.search   || null;

  if (categorySlug) {
    // Category landing page
    try {
      const cat = await Category.findOne({ slug: categorySlug, isActive: true }).lean();
      if (cat) {
        const catUrl  = `${siteUrl}/shop?category=${cat.slug}`;
        const title   = `${cat.name} — Shop Online in Sri Lanka | ${storeName}`;
        const desc    = `Browse ${cat.name} products online in Sri Lanka. Fast delivery and best prices at ${storeName}.`;
        const keywords = `${cat.name}, buy ${cat.name} online, ${cat.name} price sri lanka, online shopping sri lanka, ${storeName}`;

        // Grab a few product thumbnails for the category OG image
        const featuredProduct = await Product.findOne({ category: cat._id, isActive: true, thumbnail: { $exists: true, $ne: '' } }).lean();
        const ogImage = featuredProduct?.thumbnail || defaultOgImage;

        const breadcrumb = {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
            { '@type': 'ListItem', position: 3, name: cat.name, item: catUrl },
          ],
        };

        return injectMeta(html, {
          title, desc, canonical: catUrl, ogImage, ogType: 'website', keywords,
          schemas: [breadcrumb],
        });
      }
    } catch (err) {
      console.error('[SSR shop/category]', err.message);
    }
  }

  if (searchQ) {
    const title   = `Search: "${searchQ}" — ${storeName} Sri Lanka`;
    const desc    = `Search results for "${searchQ}" at ${storeName}. Find the best deals on electronics, fashion and more in Sri Lanka.`;
    return injectMeta(html, {
      title, desc, canonical: `${siteUrl}/shop?search=${encodeURIComponent(searchQ)}`,
      ogImage: defaultOgImage, ogType: 'website',
      keywords: `${searchQ}, buy ${searchQ} sri lanka, ${storeName}`,
    });
  }

  // Generic /shop page
  const title   = `Shop All Products — ${storeName} Sri Lanka`;
  const desc    = `Browse all products at ${storeName}. Electronics, fashion, home & more. Fast delivery, best prices in Sri Lanka.`;
  const keywords = `online shopping sri lanka, buy online sri lanka, best prices sri lanka, ${storeName}`;

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
    ],
  };

  return injectMeta(html, {
    title, desc, canonical: `${siteUrl}/shop`, ogImage: defaultOgImage,
    ogType: 'website', keywords, schemas: [breadcrumb],
  });
}

const seoRenderMiddleware = async (req, res) => {
  if (req.path.startsWith('/api/') || req.path.match(/\.(js|css|png|jpg|ico|svg|json|xml|txt|woff2?)$/))
    return res.status(404).send('Not found');

  // Always set CORS header for Vercel server-to-server proxying
  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://shopzen.lk');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  const html = await getHtmlTemplate();
  if (!html) return res.status(500).send('Frontend build not found.');

  const siteUrl        = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
  const storeName      = 'ShopZen';
  const defaultOgImage = `${siteUrl}/og-default.png`;

  // ── /product/:slug ─────────────────────────────────────────────────────────
  const productMatch = req.path.match(/^\/product\/([^/]+)$/);
  if (productMatch) {
    try {
      const slug    = productMatch[1];
      const product = await Product.findOne({ slug, isActive: true })
        .populate('category', 'name slug').lean();

      if (product) {
        const productUrl = `${siteUrl}/product/${product.slug}`;
        const metaTitle  = buildProductTitle(product, storeName);
        const plainDesc  = String(product.shortDescription || product.description || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const priceText  = product.salePrice ? `Rs.${product.salePrice.toLocaleString()} (was Rs.${product.price.toLocaleString()})` : `Rs.${product.price.toLocaleString()}`;
        const metaDesc   = `${(plainDesc.slice(0,100) || product.name)}. Buy for ${priceText}. Fast delivery across Sri Lanka. Shop at ${storeName}.`.slice(0, 165);
        const ogImage    = product.thumbnail || product.images?.[0] || defaultOgImage;
        const keywords   = [product.name, product.brand, product.category?.name, ...(product.tags||[]), 'sri lanka'].filter(Boolean).join(', ');

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

        const out = injectMeta(html, {
          title: metaTitle, desc: metaDesc, canonical: productUrl,
          ogImage, ogType: 'product', keywords, schemas: [schema, breadcrumb],
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.send(out);
      }
    } catch (err) {
      console.error('[SSR product]', err.message);
    }
  }

  // ── /shop (with optional ?category= or ?search=) ──────────────────────────
  if (req.path === '/shop' || req.path === '/shop/') {
    try {
      const out = await renderShopPage(req, html, siteUrl, storeName, defaultOgImage);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return res.send(out);
    } catch (err) {
      console.error('[SSR shop]', err.message);
    }
  }

  // ── / (homepage) ──────────────────────────────────────────────────────────
  if (req.path === '/' || req.path === '') {
    try {
      const meta = await getSeoMeta();
      if (meta) {
        const websiteSchema = {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: storeName,
          url: siteUrl,
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/shop?search={search_term_string}` },
            'query-input': 'required name=search_term_string',
          },
        };

        const orgSchema = {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: storeName,
          url: siteUrl,
          logo: { '@type': 'ImageObject', url: meta.ogImage },
        };

        const out = injectMeta(html, {
          title: meta.metaTitle, desc: meta.metaDesc, canonical: siteUrl,
          ogImage: meta.ogImage, ogType: 'website',
          verification: meta.verification,
          schemas: [websiteSchema, orgSchema],
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.send(out);
      }
    } catch (err) {
      console.error('[SSR home]', err.message);
    }
  }

  // ── Generic page fallback ─────────────────────────────────────────────────
  const meta = await getSeoMeta();
  if (!meta) return res.send(html);

  const out = injectMeta(html, {
    title: meta.metaTitle, desc: meta.metaDesc, canonical: siteUrl,
    ogImage: meta.ogImage, ogType: 'website', verification: meta.verification,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.send(out);
};

module.exports = router;
module.exports.seoRenderMiddleware = seoRenderMiddleware;