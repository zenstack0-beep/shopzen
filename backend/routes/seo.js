/**
 * routes/seo.js — Full SEO backend for ShopZen
 *
 * GET  /api/seo/sitemap.xml               — Sitemap index (points to sub-sitemaps)
 * GET  /api/seo/products-sitemap.xml      — All product URLs with ALL images
 * GET  /api/seo/categories-sitemap.xml   — Category + brand landing pages
 * GET  /api/seo/pages-sitemap.xml        — Static + business pages
 * GET  /api/seo/robots.txt              — Dynamic robots.txt
 * GET  /api/seo/meta                    — Store-level meta tags
 * GET  /api/seo/product-meta/:slug      — Per-product meta for SSR injection
 * GET  /api/seo/category-meta/:slug     — Per-category meta for SSR injection
 * GET  /api/seo/brand-meta/:slug        — Per-brand meta for SSR injection
 * POST /api/seo/bust-cache              — Clear sitemap cache
 *
 * SSR middleware exported: seoRenderMiddleware
 */

const express  = require('express');
const router   = express.Router();
const fs       = require('fs');
const path     = require('path');
const Product          = require('../models/Product');
const { Category, Settings, Review } = require('../models/index');
const { buildGoogleMerchantFeed } = require('../services/googleMerchantFeed');

// ── XML helpers ───────────────────────────────────────────────────────────────
function xe(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function productConditionUrl(condition) {
  if (condition === 'used') return 'https://schema.org/UsedCondition';
  if (condition === 'refurbished') return 'https://schema.org/RefurbishedCondition';
  return 'https://schema.org/NewCondition';
}

// ── Logo constant ─────────────────────────────────────────────────────────────
// Google Organization schema logo: square PNG, min 112x112, max 1000x1000.
// This is the Cloudinary URL for your ShopZen logo, padded to 512x512.
// IMPORTANT: After uploading a proper square logo to Cloudinary, update this URL
// in your Admin → Settings → Logo, which will override this fallback automatically.
const SHOPZEN_LOGO_URL = 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_512,h_512,c_pad,b_white,f_png/v1779758903/shopzen/1779758893538-714817024.png';

/** Build a <url> entry with zero or more <image:image> children */
function urlEntry(loc, lastmod, changefreq = 'weekly', priority = '0.7', images = []) {
  const imgXml = images
    .filter(Boolean)
    .map(img => {
      const src = typeof img === 'string' ? { loc: img } : img;
      const titleXml   = src.title   ? `\n      <image:title>${xe(src.title)}</image:title>`     : '';
      const captionXml = src.caption ? `\n      <image:caption>${xe(src.caption)}</image:caption>` : '';
      return `\n    <image:image>\n      <image:loc>${xe(src.loc)}</image:loc>${titleXml}${captionXml}\n    </image:image>`;
    })
    .join('');
  return `  <url>
    <loc>${xe(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>${imgXml}
  </url>`;
}

// ── In-memory cache ───────────────────────────────────────────────────────────
const cache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function cached(key, fn) {
  return async () => {
    const now = Date.now();
    if (cache[key] && now - cache[key].at < CACHE_TTL) return cache[key].data;
    const data = await fn();
    cache[key] = { data, at: now };
    return data;
  };
}

async function getSiteUrl() {
  const s = await Settings.findOne({ key: 'seo_config' });
  return (s?.value?.siteUrl || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
}

// Sub-sitemap <loc> tags must be directly reachable by Google without going
// through Vercel rewrites. Point them straight at the Railway backend.
function getBackendUrl() {
  const raw = process.env.BACKEND_URL || 'https://shopzen-production.up.railway.app';
  const url = raw.startsWith('http') ? raw : `https://${raw}`;
  return url.replace(/\/$/, '');
}

// ── GET /api/seo/sitemap.xml  — Sitemap index ─────────────────────────────────
router.get('/sitemap.xml', async (req, res) => {
  try {
    // Sub-sitemap locs must use the frontend domain (shopzen.lk) so GSC can
    // submit them. Vercel rewrites each /api/seo/*-sitemap.xml → Railway.
    const siteUrl = await getSiteUrl();
    const today   = new Date().toISOString().split('T')[0];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${siteUrl}/api/seo/products-sitemap.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${siteUrl}/api/seo/categories-sitemap.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${siteUrl}/api/seo/brands-sitemap.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
  <sitemap>
    <loc>${siteUrl}/api/seo/pages-sitemap.xml</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
</sitemapindex>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('Sitemap index error:', err);
    res.status(500).send('<?xml version="1.0"?><error>Sitemap generation failed</error>');
  }
});

// ── GET /api/seo/products-sitemap.xml  — All products with ALL images ─────────
router.get('/products-sitemap.xml', async (req, res) => {
  try {
    const [siteUrl, products] = await Promise.all([
      getSiteUrl(),
      Product.find(
        { isActive: true },
        'slug updatedAt thumbnail images name brand'
      ).lean(),
    ]);

    const today = new Date().toISOString().split('T')[0];

    // Include ALL product images (thumbnail + images array) for Google Image Search
    const entries = products.map(p => {
      const allImages = [p.thumbnail, ...(p.images || [])].filter(Boolean);
      const uniqueImages = [...new Set(allImages)].slice(0, 10); // max 10 per Google spec
      const imageObjs = uniqueImages.map((img, i) => ({
        loc: img,
        title: p.brand ? `${p.brand} ${p.name}` : p.name,
        caption: i === 0
          ? `${p.name} — buy online in Sri Lanka at ShopZen`
          : `${p.name} — additional view ${i + 1}`,
      }));
      return urlEntry(
        `${siteUrl}/product/${p.slug}`,
        p.updatedAt ? new Date(p.updatedAt).toISOString().split('T')[0] : today,
        'weekly',
        '0.9',
        imageObjs
      );
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
    res.send(xml);
  } catch (err) {
    console.error('Products sitemap error:', err);
    res.status(500).send('<?xml version="1.0"?><error>Failed</error>');
  }
});

router.get('/product-sitemap.xml', (_req, res) => {
  res.redirect(301, '/api/seo/products-sitemap.xml');
});

// Google Merchant Center RSS feed, generated from the current MongoDB data.
router.get('/google-merchant-feed.xml', async (_req, res) => {
  try {
    const [siteUrl, products] = await Promise.all([
      getSiteUrl(),
      Product.find({ isActive: true }).populate('category', 'name').lean(),
    ]);
    const { xml, etag, diagnostics } = buildGoogleMerchantFeed(products, siteUrl);

    if (process.env.NODE_ENV !== 'production') {
      console.info('[Merchant Feed diagnostics]', diagnostics);
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=60');
    res.setHeader('ETag', etag);
    if (_req.headers['if-none-match'] === etag) return res.status(304).end();
    res.send(xml);
  } catch (err) {
    console.error('Google Merchant feed error:', err.message);
    res.status(500).send('<?xml version="1.0"?><error>Feed generation failed</error>');
  }
});

// ── GET /api/seo/categories-sitemap.xml — Category landing pages ─────────────
router.get('/categories-sitemap.xml', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.categoriesSitemap && now - cache.categoriesSitemap.at < CACHE_TTL) {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(cache.categoriesSitemap.data);
    }

    const [siteUrl, categories] = await Promise.all([
      getSiteUrl(),
      Category.find({ isActive: true }, 'slug name updatedAt').lean(),
    ]);

    const today = new Date().toISOString().split('T')[0];

    const catEntries = categories.map(c => urlEntry(
      `${siteUrl}/category/${c.slug}`,
      c.updatedAt ? new Date(c.updatedAt).toISOString().split('T')[0] : today,
      'weekly', '0.8'
    ));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${catEntries.join('\n')}
</urlset>`;

    cache.categoriesSitemap = { data: xml, at: now };
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('Categories sitemap error:', err);
    res.status(500).send('<?xml version="1.0"?><error>Failed</error>');
  }
});

// ── GET /api/seo/brands-sitemap.xml — Brand landing pages ─────────────────────
router.get('/brands-sitemap.xml', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.brandsSitemap && now - cache.brandsSitemap.at < CACHE_TTL) {
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.send(cache.brandsSitemap.data);
    }

    const siteUrl = await getSiteUrl();
    const today   = new Date().toISOString().split('T')[0];

    // Get unique brands from active products
    const brands = await Product.distinct('brand', { isActive: true, brand: { $ne: '' } });

    // Deduplicate slugs — prevents typo brands (e.g. "phlips", "pilips") from
    // each generating their own sitemap entry and wasting crawl budget.
    // We keep only slugs that have at least 1 active product with that exact brand slug.
    const brandCountAgg = await Product.aggregate([
      { $match: { isActive: true, brand: { $ne: '', $exists: true } } },
      { $group: { _id: { $toLower: '$brand' }, count: { $sum: 1 } } },
      { $match: { count: { $gte: 2 } } }  // only brands with 2+ products
    ]);
    const qualifiedBrands = new Set(brandCountAgg.map(r => r._id));

    const brandSlugs = [...new Set(
      brands
        .filter(Boolean)
        .filter(b => qualifiedBrands.has(b.toLowerCase()))  // skip 1-product typo brands
        .map(b => b.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+$/, '').replace(/^-+/, ''))
        .filter(s => s.length >= 2)  // skip empty or single-char slugs
    )];

    const brandEntries = brandSlugs.map(slug => urlEntry(
      `${siteUrl}/brand/${slug}`,
      today,
      'weekly', '0.7'
    ));

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${brandEntries.join('\n')}
</urlset>`;

    cache.brandsSitemap = { data: xml, at: now };
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (err) {
    console.error('Brands sitemap error:', err);
    res.status(500).send('<?xml version="1.0"?><error>Failed</error>');
  }
});

// ── GET /api/seo/pages-sitemap.xml — Static pages ─────────────────────────────
router.get('/pages-sitemap.xml', async (req, res) => {
  try {
    const siteUrl = await getSiteUrl();
    const today   = new Date().toISOString().split('T')[0];

    const staticPages = [
      { path: '/',           freq: 'daily',   pri: '1.0' },
      { path: '/shop',       freq: 'daily',   pri: '0.9' },
      { path: '/gift-cards', freq: 'monthly', pri: '0.5' },
    ];

    const entries = staticPages.map(p =>
      urlEntry(`${siteUrl}${p.path}`, today, p.freq, p.pri)
    );

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(xml);
  } catch (err) {
    res.status(500).send('<?xml version="1.0"?><error>Failed</error>');
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

# Block private/functional paths — do NOT block pagination (Google crawls it)
Disallow: /admin/
Disallow: /checkout/
Disallow: /account/
Disallow: /cart/
Disallow: /login
Disallow: /register
Disallow: /forgot-password
Disallow: /my-orders
Disallow: /returns
Disallow: /*?*sort=

# Allow paginated product/category/brand pages for crawling
Allow: /shop?page=
Allow: /category/
Allow: /brand/

# Allow product images for Google Image Search
Allow: /images/
Allow: /*.jpg$
Allow: /*.png$
Allow: /*.webp$

Crawl-delay: 1

# Sitemap index
Sitemap: ${siteUrl}/sitemap.xml
Sitemap: ${siteUrl}/product-sitemap.xml
`;
    }

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(txt);
  } catch (err) {
    res.status(500).send('User-agent: *\nAllow: /\n');
  }
});

// ── POST /api/seo/bust-cache ─────────────────────────────────────────────────
router.post('/bust-cache', (req, res) => {
  Object.keys(cache).forEach(k => delete cache[k]);
  res.json({ success: true, message: 'All sitemap caches cleared' });
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
          'storeName', 'storeTagline', 'logoUrl', 'faviconUrl',
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
    const DEFAULT_OG  = 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';
    // LOGO_URL: square logo for Google Knowledge Panel & Organization schema.
    // Google requires min 112x112, max 1000x1000, preferably square PNG.
    // Update this URL after uploading your square logo to Cloudinary.
    const ogImage   = s.seo_ogImage   || DEFAULT_OG;
    const logoUrl   = s.faviconUrl || s.logoUrl || SHOPZEN_LOGO_URL;

    res.json({
      siteUrl, storeName, metaTitle, metaDesc, ogTitle, ogDesc, ogImage,
      logoUrl,
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

// ── FAQ Schema Builder ───────────────────────────────────────────────────────
// Generates FAQPage JSON-LD for product, category, and brand pages.
// Google shows FAQ rich results directly in SERPs — high CTR impact.
function buildProductFAQ(product, siteUrl, storeName) {
  const price    = product.salePrice || product.price;
  const priceStr = price ? `Rs.${price.toLocaleString()}` : 'competitive';
  const name     = product.name;
  const catName  = product.category?.name || 'products';
  const brand    = product.brand || storeName;

  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `What is the price of ${name} in Sri Lanka?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `The current price of ${name} in Sri Lanka is ${priceStr}. You can buy it online at ShopZen (${siteUrl}/product/${product.slug}) with fast island-wide delivery.`,
        },
      },
      {
        '@type': 'Question',
        name: `Is ${name} available for delivery across Sri Lanka?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Yes, ${name} is available for delivery island-wide in Sri Lanka. ShopZen ships to all major cities including Colombo, Kandy, Galle, Jaffna, and more within 1–5 business days.`,
        },
      },
      {
        '@type': 'Question',
        name: `What is the return policy for ${name}?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `ShopZen offers a 14-day hassle-free return policy on ${name}. If you are not satisfied, you can return it by mail at no extra cost.`,
        },
      },
      {
        '@type': 'Question',
        name: `Is the ${name} sold at ShopZen genuine / authentic?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Yes, all ${brand} products sold at ShopZen including ${name} are 100% genuine and sourced from authorised channels, covered by the manufacturer's warranty.`,
        },
      },
    ],
  };
}

function buildCategoryFAQ(catName, siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `Where can I buy ${catName} online in Sri Lanka?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `You can buy ${catName} online in Sri Lanka at ShopZen (${siteUrl}/category/${catName.toLowerCase().replace(/\s+/g, '-')}). ShopZen offers the widest selection of ${catName} at competitive prices with fast island-wide delivery.`,
        },
      },
      {
        '@type': 'Question',
        name: `What is the delivery time for ${catName} in Sri Lanka?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `ShopZen delivers ${catName} across Sri Lanka within 1–5 business days. Orders placed before noon are typically dispatched the same day.`,
        },
      },
      {
        '@type': 'Question',
        name: `Are the ${catName} sold at ShopZen covered by warranty?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Yes, all ${catName} products sold at ShopZen come with the manufacturer's warranty. ShopZen also offers a 14-day hassle-free return policy.`,
        },
      },
      {
        '@type': 'Question',
        name: `What are the best ${catName} brands available in Sri Lanka?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `ShopZen stocks ${catName} from leading global brands including Sony, Philips, Samsung, JBL, and more — all available online in Sri Lanka with fast delivery.`,
        },
      },
    ],
  };
}

function buildBrandFAQ(brandName, siteUrl, slug) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: `Where can I buy genuine ${brandName} products in Sri Lanka?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `You can buy genuine ${brandName} products in Sri Lanka at ShopZen (${siteUrl}/brand/${slug}). All ${brandName} products are authentic and backed by the manufacturer's warranty.`,
        },
      },
      {
        '@type': 'Question',
        name: `Does ShopZen deliver ${brandName} products across Sri Lanka?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `Yes, ShopZen delivers ${brandName} products island-wide across Sri Lanka. Delivery typically takes 1–5 business days to all major cities and towns.`,
        },
      },
      {
        '@type': 'Question',
        name: `What is the return policy for ${brandName} products at ShopZen?`,
        acceptedAnswer: {
          '@type': 'Answer',
          text: `ShopZen offers a 14-day hassle-free return policy on all ${brandName} products. Returns are free and processed promptly.`,
        },
      },
    ],
  };
}

// ── ItemList Schema Builder ──────────────────────────────────────────────────
// CollectionPage + ItemList enables Google to show product carousels in search.
function buildItemListSchema(products, pageUrl, name, siteUrl) {
  if (!products || !products.length) return null;
  const base = siteUrl || pageUrl.split('/category/')[0].split('/brand/')[0].split('/shop')[0];
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    url: pageUrl,
    mainEntity: {
      '@type': 'ItemList',
      name,
      numberOfItems: products.length,
      itemListElement: products.slice(0, 20).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.name,
          url: `${base}/product/${p.slug}`,
          image: p.thumbnail || p.images?.[0] || undefined,
          ...(p.brand ? { brand: { '@type': 'Brand', name: String(p.brand).trim() } } : {}),
          offers: {
            '@type': 'Offer',
            priceCurrency: 'LKR',
            price: String(p.salePrice || p.price || 0),
            availability: (p.stock > 0) ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          },
          ...(p.ratings?.count > 0 ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: Number(p.ratings.average).toFixed(1),
              reviewCount: p.ratings.count,
              bestRating: '5',
              worstRating: '1',
            },
          } : {}),
        },
      })),
    },
  };
}

async function getReviewSchemas(productId) {
  const reviews = await Review.find({ product: productId, isApproved: true })
    .populate('user', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  return reviews.map(r => ({
    '@type': 'Review',
    reviewRating: {
      '@type': 'Rating',
      ratingValue: String(r.rating),
      bestRating: '5',
      worstRating: '1',
    },
    author: {
      '@type': 'Person',
      name: [r.user?.firstName, r.user?.lastName].filter(Boolean).join(' ') || 'ShopZen Customer',
    },
    datePublished: new Date(r.createdAt).toISOString().split('T')[0],
    ...(r.title ? { name: r.title } : {}),
    ...(r.comment ? { reviewBody: String(r.comment).slice(0, 1000) } : {}),
  }));
}

// ── GET /api/seo/product-meta/:slug ──────────────────────────────────────────
router.get('/product-meta/:slug', async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true })
      .populate('category', 'name slug')
      .lean();

    if (!product) return res.status(404).json({ message: 'Product not found' });

    const siteUrl    = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const productUrl = `${siteUrl}/product/${product.slug}`;
    const _pm = await getSeoMeta();
    const storeName  = _pm?.storeName || 'ShopZen';
    const logoUrl    = _pm?.logoUrl   || 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';

    const metaTitle = buildProductTitle(product, storeName);

    const plainDesc  = String(product.shortDescription || product.description || '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const priceText  = product.salePrice
      ? `Rs.${product.salePrice.toLocaleString()} (was Rs.${product.price.toLocaleString()})`
      : `Rs.${product.price.toLocaleString()}`;
    const catName    = product.category?.name || '';
    const _raw1      = (plainDesc.split('.')[0] || plainDesc).trim();
    const baseDesc   = _raw1.length <= 85 ? _raw1 : _raw1.slice(0, _raw1.lastIndexOf(' ', 85));
    const metaDesc   = `${baseDesc || product.name}. ${priceText}. Fast delivery across Sri Lanka. Shop at ${storeName}.`.slice(0, 165);

    // ALL images for rich results
    const allImages  = [product.thumbnail, ...(product.images || [])].filter(Boolean);
    const uniqueImages = [...new Set(allImages)];
    const ogImage = uniqueImages[0] || 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';
    const canonical = productUrl;

    const keywords = [
      product.name, product.brand, catName,
      ...(product.tags || []),
      'buy in sri lanka', 'online shopping sri lanka',
    ].filter(Boolean).join(', ');

    const availability = product.stock > 0
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock';

    const offers = {
      '@type':           'Offer',
      url:               productUrl,
      priceCurrency:     'LKR',
      price:             String(product.salePrice || product.price),
      priceValidUntil:   product.saleEndsAt
        ? new Date(product.saleEndsAt).toISOString().split('T')[0]
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      availability,
      itemCondition: productConditionUrl(product.condition),
      availabilityStarts: product.createdAt ? new Date(product.createdAt).toISOString() : undefined,
      validFrom: product.createdAt ? new Date(product.createdAt).toISOString() : undefined,
      seller: { '@type': 'Organization', name: storeName },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', value: '0', currency: 'LKR' },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime:  { '@type': 'QuantitativeValue', minValue: 1, maxValue: 5, unitCode: 'DAY' },
        },
        shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'LK' },
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'LK',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 14,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn',
      },
    };

    if (product.salePrice) {
      offers.priceSpecification = {
        '@type': 'PriceSpecification',
        price: product.salePrice,
        priceCurrency: 'LKR',
      };
    }

    const reviewSchemas = await getReviewSchemas(product._id);

    const schema = {
      '@context': 'https://schema.org',
      '@type':    'Product',
      name:        product.name,
      description: (plainDesc.slice(0, 500) || (product.brand ? `${product.brand} ${product.name}` : product.name)),
      // ALL images included for rich results eligibility
      image:       uniqueImages.slice(0, 10),
      sku:         product.sku || product._id.toString(),
      mpn:         product.mpn || product.sku || undefined,
      ...(product.gtin ? { gtin: product.gtin } : {}),
      brand:       product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
      category:    catName,
      url:         productUrl,
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
      ...(reviewSchemas.length ? { review: reviewSchemas } : {}),
    };

    if (!product.brand) delete schema.brand;
    if (!product.mpn && !product.sku) delete schema.mpn;

    // Organization schema on every page
    const orgSchema = {
      '@context': 'https://schema.org',
      '@type':    'Organization',
      name:        storeName,
      url:         siteUrl,
      logo: { '@type': 'ImageObject', url: logoUrl || SHOPZEN_LOGO_URL, width: 512, height: 512 },
    };

    // Breadcrumb using SEO-friendly category URL
    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type':    'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
        ...(catName ? [{
          '@type': 'ListItem',
          position: 3,
          name: catName,
          item: `${siteUrl}/category/${product.category?.slug}`,
        }] : []),
        { '@type': 'ListItem', position: catName ? 4 : 3, name: product.name, item: productUrl },
      ],
    };

    res.json({
      metaTitle, metaDesc, canonical, keywords,
      ogTitle: metaTitle, ogDesc: metaDesc, ogImage, ogType: 'product',
      productUrl,
      schema, breadcrumbSchema, orgSchema,
      price:        product.price,
      salePrice:    product.salePrice,
      availability: product.stock > 0 ? 'InStock' : 'OutOfStock',
      brand:        product.brand,
      category:     catName,
    });
  } catch (err) {
    console.error('[SEO /product-meta]', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/seo/category-meta/:slug ─────────────────────────────────────────
router.get('/category-meta/:slug', async (req, res) => {
  try {
    const cat = await Category.findOne({ slug: req.params.slug, isActive: true }).lean();
    if (!cat) return res.status(404).json({ message: 'Category not found' });

    const siteUrl   = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const _cm = await getSeoMeta();
    const storeName = _cm?.storeName || 'ShopZen';
    const logoUrl   = _cm?.logoUrl   || 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';
    const catUrl    = `${siteUrl}/category/${cat.slug}`;

    const metaTitle = `${cat.name} — Buy Online in Sri Lanka | ${storeName}`;
    const plainCatDesc = cat.description
      ? String(cat.description).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      : '';
    const metaDesc = (plainCatDesc.slice(0, 155) || `Shop ${cat.name} online in Sri Lanka. Best prices and fast delivery at ${storeName}.`);

    const featuredProduct = await Product.findOne({
      category: cat._id, isActive: true,
      thumbnail: { $exists: true, $ne: '' },
    }).lean();
    const ogImage = featuredProduct?.thumbnail || 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';

    const keywords = `${cat.name}, buy ${cat.name} online sri lanka, ${cat.name} price sri lanka, online shopping sri lanka, ${storeName}`;

    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type':    'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home',  item: siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Shop',  item: `${siteUrl}/shop` },
        { '@type': 'ListItem', position: 3, name: cat.name, item: catUrl },
      ],
    };

    const orgSchema = {
      '@context': 'https://schema.org',
      '@type':    'Organization',
      name:        storeName,
      url:         siteUrl,
      logo: { '@type': 'ImageObject', url: logoUrl || SHOPZEN_LOGO_URL, width: 512, height: 512 },
    };

    res.json({ metaTitle, metaDesc, canonical: catUrl, ogImage, keywords, breadcrumbSchema, orgSchema });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/seo/brand-meta/:slug ─────────────────────────────────────────────
router.get('/brand-meta/:slug', async (req, res) => {
  try {
    const slug      = req.params.slug;
    const brandName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const siteUrl   = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const _bm = await getSeoMeta();
    const storeName = _bm?.storeName || 'ShopZen';
    const logoUrl   = _bm?.logoUrl   || 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';
    const brandUrl  = `${siteUrl}/brand/${slug}`;

    const metaTitle = `${brandName} Products — Buy Online in Sri Lanka | ${storeName}`;
    const metaDesc  = `Shop genuine ${brandName} products online in Sri Lanka at ${storeName}. Best prices, fast delivery, manufacturer warranty. Browse the full ${brandName} range today.`;
    const keywords  = `${brandName}, buy ${brandName} online sri lanka, ${brandName} price sri lanka, ${brandName} products, ${storeName}`;

    // Grab a featured product image from this brand
    const featuredProduct = await Product.findOne({
      brand: new RegExp(`^${brandName}$`, 'i'),
      isActive: true,
      thumbnail: { $exists: true, $ne: '' },
    }).lean();
    const ogImage = featuredProduct?.thumbnail || 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';

    const breadcrumbSchema = {
      '@context': 'https://schema.org',
      '@type':    'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home',                 item: siteUrl },
        { '@type': 'ListItem', position: 2, name: 'Shop',                 item: `${siteUrl}/shop` },
        { '@type': 'ListItem', position: 3, name: `${brandName} Products`, item: brandUrl },
      ],
    };

    const orgSchema = {
      '@context': 'https://schema.org',
      '@type':    'Organization',
      name:        storeName,
      url:         siteUrl,
      logo: { '@type': 'ImageObject', url: logoUrl || SHOPZEN_LOGO_URL, width: 512, height: 512 },
    };

    res.json({ metaTitle, metaDesc, canonical: brandUrl, ogImage, keywords, breadcrumbSchema, orgSchema });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  Helpers shared by SSR middleware
// ══════════════════════════════════════════════════════════════════════════════

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

  const suffix  = ' Price in Sri Lanka | ' + storeName;
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

function injectMeta(html, { title, desc, canonical, ogTitle, ogDesc, ogImage, ogImageWidth, ogImageHeight, ogUrl, ogType, keywords, schemas, verification, robots }) {
  let out = html.includes('__META_INJECT__') ? html.replace('__META_INJECT__', '') : html;
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g, '');

  out = out
    .replace(/<title>[^<]*<\/title>/,                                       `<title>${xe(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${xe(desc)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${xe(canonical)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${xe(ogTitle || title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${xe(ogDesc || desc)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${xe(ogImage)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${xe(ogUrl || canonical)}$2`)
    .replace(/(<meta property="og:type" content=")[^"]*(")/, `$1${xe(ogType || 'website')}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${xe(ogTitle || title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${xe(ogDesc || desc)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${xe(ogImage)}$2`)
    .replace(/yourstore\.com/g, 'shopzen.lk');

  if (robots) {
    if (out.includes('name="robots"')) {
      out = out.replace(/(<meta name="robots" content=")[^"]*(")/, `$1${xe(robots)}$2`);
    } else {
      out = out.replace('</head>', `<meta name="robots" content="${xe(robots)}"/>\n</head>`);
    }
  }

  const missing = [
    !out.includes('property="og:type"')        ? `<meta property="og:type" content="${xe(ogType || 'website')}"/>` : '',
    !out.includes('property="og:title"')       ? `<meta property="og:title" content="${xe(ogTitle || title)}"/>` : '',
    !out.includes('property="og:description"') ? `<meta property="og:description" content="${xe(ogDesc || desc)}"/>` : '',
    !out.includes('property="og:image"')       ? `<meta property="og:image" content="${xe(ogImage)}"/>` : '',
    (ogImageWidth && !out.includes('property="og:image:width"'))   ? `<meta property="og:image:width" content="${xe(ogImageWidth)}"/>`   : '',
    (ogImageHeight && !out.includes('property="og:image:height"')) ? `<meta property="og:image:height" content="${xe(ogImageHeight)}"/>` : '',
    !out.includes('property="og:url"')         ? `<meta property="og:url" content="${xe(ogUrl || canonical)}"/>` : '',
    !out.includes('property="og:site_name"')   ? `<meta property="og:site_name" content="ShopZen"/>` : '',
    !out.includes('name="twitter:card"')       ? `<meta name="twitter:card" content="summary_large_image"/>` : '',
    !out.includes('name="twitter:title"')      ? `<meta name="twitter:title" content="${xe(ogTitle || title)}"/>` : '',
    !out.includes('name="twitter:description"')? `<meta name="twitter:description" content="${xe(ogDesc || desc)}"/>` : '',
    !out.includes('name="twitter:image"')      ? `<meta name="twitter:image" content="${xe(ogImage)}"/>` : '',
  ].filter(Boolean).join('\n');
  if (missing) out = out.replace('</head>', missing + '\n</head>');

  if (keywords) {
    if (!out.includes('name="keywords"')) {
      out = out.replace('</head>', `<meta name="keywords" content="${xe(keywords)}"/>\n</head>`);
    } else {
      out = out.replace(/(<meta name="keywords" content=")[^"]*(")/, `$1${xe(keywords)}$2`);
    }
  }

  if (verification && !out.includes('google-site-verification')) {
    out = out.replace('</head>', `<meta name="google-site-verification" content="${xe(verification)}"/>\n</head>`);
  }

  // Core Web Vitals: inject preconnect hints for Cloudinary CDN if not already present
  if (!out.includes('res.cloudinary.com') || !out.includes('rel="preconnect"')) {
    const preconnects = [
      '<link rel="preconnect" href="https://res.cloudinary.com" crossorigin/>',
      '<link rel="dns-prefetch" href="https://res.cloudinary.com"/>',
    ].join('\n');
    if (!out.includes('preconnect" href="https://res.cloudinary.com"')) {
      out = out.replace('<link rel="manifest"', preconnects + '\n<link rel="manifest"');
    }
  }

  if (schemas && schemas.length) {
    const schemaBlock = schemas
      .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
      .join('\n');
    out = out.replace('</head>', schemaBlock + '\n</head>');
  }

  return out;
}

// Injects window.__SHOPZEN_SEO__ into the page so the React useSEO hook has
// logoUrl, storeName etc. available on first render, before the Settings API
// call returns. Called once per SSR response after injectMeta.
function injectSeoWindowConfig(html, meta) {
  if (!meta) return html;
  const cfg = {
    siteName:    meta.storeName || 'ShopZen',
    siteUrl:     meta.siteUrl   || 'https://shopzen.lk',
    logoUrl:     meta.logoUrl   || '',
    defaultOgImage: meta.ogImage || '',
    currencyCode: 'LKR',
    countryCode:  'LK',
  };
  const script = `<script>window.__SHOPZEN_SEO__=Object.assign(window.__SHOPZEN_SEO__||{},${JSON.stringify(cfg)});</script>`;
  // Insert just before </head> so it's available before any deferred JS runs.
  if (html.includes('</head>')) {
    return html.replace('</head>', script + '\n</head>');
  }
  return html;
}

// Insert pre-rendered static HTML (H1-H3 + category/bestseller links) into
// <div id="root"> so Google can index meaningful content without executing
// JS. React's render call replaces #root's children on mount, so this does
// not affect the live app UI — it only exists in the initial HTML response.
function injectHomeContent(html, contentHtml) {
  if (!contentHtml) return html;
  // Wrap SSR content in a data-ssr div so the flash-prevention CSS in
  // index.html can hide it instantly before React mounts.
  const wrapped = `<div data-ssr="1" style="display:none" aria-hidden="true">${contentHtml}</div>`;
  if (html.includes('<div id="root"></div>')) {
    return html.replace('<div id="root"></div>', `<div id="root">${wrapped}</div>`);
  }
  return html.replace('<div id="root">', `<div id="root">${wrapped}`);
}

function he(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Builds a semantic, keyword-rich static content block for the homepage:
// H1 (brand intro), H2 category grid, H2 best-sellers grid with H3 product
// names — all real anchor links Googlebot can crawl without JS.
function buildHomeSeoContent({ storeName, siteUrl, categories = [], bestSellers = [] }) {
  const catLinks = categories.map(c =>
    `<li><a href="${he(siteUrl)}/category/${he(c.slug)}">${he(c.name)}</a></li>`
  ).join('');

  const productCards = bestSellers.map((p, idx) => {
    const price = p.salePrice || p.price;
    const img   = p.thumbnail || (p.images && p.images[0]) || '';
    const loadingAttr = idx === 0 ? 'eager' : 'lazy';
    const name  = String(p.name || '').trim();
    const brand = String(p.brand || '').trim();
    return `<li>
      <a href="${he(siteUrl)}/product/${he(p.slug)}">
        ${img ? `<img src="${he(img)}" alt="${he(name)}" width="200" height="200" loading="${loadingAttr}"/>` : ''}
        <h3>${he(name)}</h3>
        <p>${brand ? `${he(brand)} — ` : ''}${price ? `Rs.${Number(price).toLocaleString()}` : ''}</p>
      </a>
    </li>`;
  }).join('');

  return `
<header>
  <h1>${he(storeName)} — Shop Online in Sri Lanka | Electronics, Fashion &amp; More</h1>
  <p>${he(storeName)} is Sri Lanka's online store for genuine electronics, fashion, home appliances and
  more — with fast island-wide delivery, secure payments and the best prices in Colombo and beyond.</p>
</header>
<nav aria-label="Shop by category">
  <h2>Shop by Category</h2>
  <ul>${catLinks}</ul>
</nav>
<section aria-label="Best selling products">
  <h2>Best Selling Products in Sri Lanka</h2>
  <ul>${productCards}</ul>
</section>
<section>
  <h2>Why Shop at ${he(storeName)}?</h2>
  <h3>Island-Wide Fast Delivery</h3>
  <p>Get your orders delivered across Sri Lanka, including Colombo, Kandy, Galle and Jaffna, within 1-5 business days.</p>
  <h3>Genuine Products &amp; Warranty</h3>
  <p>Every product sold at ${he(storeName)} is 100% authentic and backed by manufacturer warranty.</p>
  <h3>Easy 14-Day Returns</h3>
  <p>Not satisfied? Return your order within 14 days for a hassle-free refund.</p>
</section>`;
}

async function getSeoMeta() {
  try {
    const rows = await Settings.find({
      key: { $in: ['seo_config','seo_metaTitle','seo_metaDesc','seo_ogTitle','seo_ogDesc','seo_ogImage','seo_googleVerification','storeName','logoUrl','faviconUrl','facebookUrl','instagramUrl','twitterUrl','linkedinUrl','youtubeUrl','tiktokUrl','whatsappUrl'] },
    }).lean();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });
    const siteUrl   = (s.seo_config?.siteUrl || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const storeName = s.storeName || 'ShopZen';
    const ogImage   = s.seo_ogImage || 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';
    // logoUrl / faviconUrl — set in admin Settings → General → Logo upload.
    // Matches the getLogoUrl() logic in settings.js.
    const logoUrl   = s.faviconUrl || s.logoUrl || SHOPZEN_LOGO_URL;
    return {
      siteUrl,
      storeName,
      logoUrl,
      metaTitle:    s.seo_metaTitle || `${storeName} — Shop Online in Sri Lanka`,
      metaDesc:     s.seo_metaDesc  || 'Shop the best products online in Sri Lanka. Fast delivery, best prices at ShopZen.',
      ogTitle:      s.seo_ogTitle   || s.seo_metaTitle || `${storeName} — Shop Online in Sri Lanka`,
      ogDesc:       s.seo_ogDesc    || s.seo_metaDesc  || 'Shop the best products online in Sri Lanka.',
      ogImage,
      verification: s.seo_googleVerification || '',
      sameAs: [s.facebookUrl, s.instagramUrl, s.twitterUrl, s.linkedinUrl, s.youtubeUrl, s.tiktokUrl, s.whatsappUrl].filter(Boolean),
    };
  } catch { return null; }
}

// ── Embedded build template ───────────────────────────────────────────────────
const BUILT_HTML_TEMPLATE = "<!doctype html><html lang=\"en-LK\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=5,viewport-fit=cover\"/><link rel=\"icon\" href=\"/favicon.ico\"/><link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\"/><link rel=\"manifest\" href=\"/manifest.json\"/><meta name=\"theme-color\" content=\"#15803d\" id=\"meta-theme-color\"/><title>ShopZen \u2014 Premium Online Store Sri Lanka</title><meta name=\"description\" content=\"Shop the best products online in Sri Lanka. Fast delivery, guaranteed best prices on electronics, fashion and more at ShopZen.\"/><meta name=\"robots\" content=\"index,follow,max-image-preview:large\"/><link rel=\"canonical\" href=\"https://shopzen.lk\"/><meta property=\"og:type\" content=\"website\"/><meta property=\"og:title\" content=\"ShopZen \u2014 Premium Online Store Sri Lanka\"/><meta property=\"og:description\" content=\"Shop the best products online in Sri Lanka.\"/><meta property=\"og:image\" content=\"https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png\"/><meta property=\"og:image:width\" content=\"1200\"/><meta property=\"og:image:height\" content=\"630\"/><meta property=\"og:url\" content=\"https://shopzen.lk\"/><meta property=\"og:site_name\" content=\"ShopZen\"/><meta property=\"og:locale\" content=\"en_LK\"/><meta name=\"twitter:card\" content=\"summary_large_image\"/><meta name=\"twitter:title\" content=\"ShopZen \u2014 Premium Online Store Sri Lanka\"/><meta name=\"twitter:description\" content=\"Shop the best products online in Sri Lanka.\"/><meta name=\"twitter:image\" content=\"https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png\"/><script defer=\"defer\" src=\"/static/js/main.5d4ddad7.js\"></script><link href=\"/static/css/main.1a2ef7b8.css\" rel=\"stylesheet\"></head><body><noscript>You need to enable JavaScript to run this app.</noscript><div id=\"root\"></div></body></html>";

let _fetchedTemplate = null;
let _fetchedAt = 0;
const HTML_CACHE_TTL = 6 * 60 * 60 * 1000;

async function tryFetchFreshTemplate() {
  const now = Date.now();
  if (_fetchedTemplate && (now - _fetchedAt) < HTML_CACHE_TTL) return _fetchedTemplate;
  const frontendUrl = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
  // Fetch /index.html (a static asset served directly by Vercel) instead of
  // "/" — fetching "/" would loop back into this same SSR middleware if "/"
  // is proxied to this backend, causing a 5s timeout and falling back to the
  // stale embedded BUILT_HTML_TEMPLATE (with outdated /static/ hashes).
  const templateUrl = `${frontendUrl}/index.html`;
  try {
    const https = require('https');
    const html = await new Promise((resolve, reject) => {
      const req = https.get(templateUrl, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    if (html.includes('id="root"') && html.includes('/static/js/') && html.includes('shopzen')) {
      _fetchedTemplate = html;
      _fetchedAt = now;
      return _fetchedTemplate;
    }
  } catch (err) {
    console.log('[SSR] Could not fetch fresh template:', err.message);
  }
  return null;
}

async function getHtmlTemplate() {
  const candidates = [
    require('path').join(__dirname, '..', 'frontend', 'build', 'index.html'),
    require('path').join(__dirname, '..', 'public', 'index.html'),
    require('path').join(process.cwd(), 'frontend', 'build', 'index.html'),
  ];
  for (const p of candidates) {
    if (require('fs').existsSync(p)) {
      const html = require('fs').readFileSync(p, 'utf8');
      if (html.includes('/static/js/')) return html;
    }
  }
  const fresh = await tryFetchFreshTemplate();
  if (fresh) return fresh;
  return BUILT_HTML_TEMPLATE;
}

// ── SSR: /shop page ───────────────────────────────────────────────────────────
async function renderShopPage(req, html, siteUrl, storeName, defaultOgImage, logoUrl) {
  const categorySlug = req.query.category || null;
  const searchQ      = req.query.search   || null;

  if (categorySlug) {
    try {
      const cat = await Category.findOne({ slug: categorySlug, isActive: true }).lean();
      if (cat) {
        // Canonical points to clean /category/:slug URL
        const catUrl   = `${siteUrl}/category/${cat.slug}`;
        const title    = `${cat.name} — Shop Online in Sri Lanka | ${storeName}`;
        const desc     = `Browse ${cat.name} products online in Sri Lanka. Fast delivery and best prices at ${storeName}.`;
        const keywords = `${cat.name}, buy ${cat.name} online, ${cat.name} price sri lanka, online shopping sri lanka, ${storeName}`;
        const featuredProduct = await Product.findOne({ category: cat._id, isActive: true, thumbnail: { $exists: true, $ne: '' } }).lean();
        const ogImage = featuredProduct?.thumbnail || defaultOgImage;

        const breadcrumb = {
          '@context': 'https://schema.org', '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
            { '@type': 'ListItem', position: 3, name: cat.name, item: catUrl },
          ],
        };
        const orgSchema = { '@context': 'https://schema.org', '@type': 'Organization', name: storeName, url: siteUrl, logo: { '@type': 'ImageObject', url: logoUrl, width: 512, height: 512 } };

        return injectMeta(html, { title, desc, canonical: catUrl, ogImage, ogType: 'website', keywords, robots: 'noindex,follow', schemas: [breadcrumb, orgSchema] });
      }
    } catch (err) {
      console.error('[SSR shop/category]', err.message);
    }
  }

  if (searchQ) {
    return injectMeta(html, {
      title:     `Search: "${searchQ}" — ${storeName} Sri Lanka`,
      desc:      `Search results for "${searchQ}" at ${storeName}. Best deals in Sri Lanka.`,
      canonical: `${siteUrl}/shop`,
      ogImage: defaultOgImage, ogType: 'website',
      robots: 'noindex,follow',
      keywords: `${searchQ}, buy ${searchQ} sri lanka, ${storeName}`,
    });
  }

  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
    ],
  };
  const orgSchema = { '@context': 'https://schema.org', '@type': 'Organization', name: storeName, url: siteUrl };

  return injectMeta(html, {
    title:     `Shop All Products — ${storeName} Sri Lanka`,
    desc:      `Browse all products at ${storeName}. Electronics, fashion, home & more. Fast delivery, best prices in Sri Lanka.`,
    canonical: `${siteUrl}/shop`,
    ogImage: defaultOgImage, ogType: 'website',
    keywords: `online shopping sri lanka, buy online sri lanka, best prices sri lanka, ${storeName}`,
    schemas: [breadcrumb, orgSchema],
  });
}

// ── Main SSR Middleware ───────────────────────────────────────────────────────
const seoRenderMiddleware = async (req, res) => {
  if (req.path.startsWith('/api/') || req.path.match(/\.(js|css|png|jpg|ico|svg|json|xml|txt|woff2?)$/))
    return res.status(404).send('Not found');

  res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://shopzen.lk');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  const html = await getHtmlTemplate();
  if (!html) return res.status(500).send('Frontend build not found.');

  const siteUrl        = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
  // Pull storeName and logoUrl from DB so they stay in sync with admin Settings.
  const _topMeta       = await getSeoMeta();
  const storeName      = _topMeta?.storeName || 'ShopZen';
  const defaultOgImage = _topMeta?.ogImage   || 'https://res.cloudinary.com/dn7tvazaw/image/upload/w_1200,h_630,c_fit,f_png/v1779758903/shopzen/1779758893538-714817024.png';
  // logoUrl = actual store logo (brand image). Google shows this next to your site
  // name in search results. Keep it separate from the social OG card image.
  const logoUrl        = _topMeta?.logoUrl   || defaultOgImage;

  const orgSchema = {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: storeName, url: siteUrl,
    logo: { '@type': 'ImageObject', url: logoUrl, width: 512, height: 512 },
  };

  // ── /product/:slug ──────────────────────────────────────────────────────────
  const productMatch = req.path.match(/^\/product\/([^/]+)$/);
  if (productMatch) {
    try {
      const product = await Product.findOne({ slug: productMatch[1], isActive: true })
        .populate('category', 'name slug').lean();

      if (product) {
        const productUrl   = `${siteUrl}/product/${product.slug}`;
        const metaTitle    = buildProductTitle(product, storeName);
        const plainDesc    = String(product.shortDescription || product.description || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const priceText    = product.salePrice ? `Rs.${product.salePrice.toLocaleString()} (was Rs.${product.price.toLocaleString()})` : `Rs.${product.price.toLocaleString()}`;
        const _raw         = (plainDesc.split('.')[0] || plainDesc).trim();
        const baseDesc     = _raw.length <= 85 ? _raw : _raw.slice(0, _raw.lastIndexOf(' ', 85));
        const metaDesc     = `${baseDesc || product.name}. ${priceText}. Fast delivery across Sri Lanka. Shop at ${storeName}.`.slice(0, 165);
        const allImages    = [product.thumbnail, ...(product.images || [])].filter(Boolean);
        const uniqueImages = [...new Set(allImages)];
        const ogImage      = uniqueImages[0] || defaultOgImage;
        const keywords     = [product.name, product.brand, product.category?.name, ...(product.tags || []), 'sri lanka'].filter(Boolean).join(', ');
        const schemaDesc   = plainDesc.slice(0, 500) || (product.brand ? `${product.brand} ${product.name}` : product.name);

        const reviewSchemas = await getReviewSchemas(product._id);

        const schema = {
          '@context': 'https://schema.org', '@type': 'Product',
          name: product.name, description: schemaDesc,
          // ALL images for rich results
          image: uniqueImages.slice(0, 10),
          sku: product.sku || product._id.toString(),
          mpn: product.mpn || product.sku || undefined,
          ...(product.gtin ? { gtin: product.gtin } : {}),
          category: product.category?.name || undefined,
          url: productUrl,
          ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
          offers: {
            '@type': 'Offer', url: productUrl, priceCurrency: 'LKR',
            price: String(product.salePrice || product.price),
            priceValidUntil: product.saleEndsAt
              ? new Date(product.saleEndsAt).toISOString().split('T')[0]
              : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            availability: product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            itemCondition: productConditionUrl(product.condition),
            availabilityStarts: product.createdAt ? new Date(product.createdAt).toISOString() : undefined,
            validFrom: product.createdAt ? new Date(product.createdAt).toISOString() : undefined,
            seller: { '@type': 'Organization', name: storeName },
            shippingDetails: {
              '@type': 'OfferShippingDetails',
              shippingRate: { '@type': 'MonetaryAmount', value: '0', currency: 'LKR' },
              deliveryTime: {
                '@type': 'ShippingDeliveryTime',
                handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
                transitTime:  { '@type': 'QuantitativeValue', minValue: 1, maxValue: 5, unitCode: 'DAY' },
              },
              shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'LK' },
            },
            hasMerchantReturnPolicy: {
              '@type': 'MerchantReturnPolicy',
              applicableCountry: 'LK',
              returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
              merchantReturnDays: 14, returnMethod: 'https://schema.org/ReturnByMail',
              returnFees: 'https://schema.org/FreeReturn',
            },
          },
          ...(product.ratings?.count > 0 ? {
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: product.ratings.average.toFixed(1),
              reviewCount: product.ratings.count,
              bestRating: '5', worstRating: '1',
            },
          } : {}),
          ...(reviewSchemas.length ? { review: reviewSchemas } : {}),
        };
        if (!product.mpn && !product.sku) delete schema.mpn;

        const breadcrumb = {
          '@context': 'https://schema.org', '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
            ...(product.category ? [{
              '@type': 'ListItem', position: 3,
              name: product.category.name,
              // SEO-friendly canonical category URL
              item: `${siteUrl}/category/${product.category.slug}`,
            }] : []),
            { '@type': 'ListItem', position: product.category ? 4 : 3, name: product.name, item: productUrl },
          ],
        };

        const faqSchema      = buildProductFAQ(product, siteUrl, storeName);
        const out = injectMeta(html, {
          title: metaTitle, desc: metaDesc, canonical: productUrl,
          ogImage, ogType: 'product', keywords,
          schemas: [schema, breadcrumb, orgSchema, faqSchema],
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
      }
    } catch (err) {
      console.error('[SSR product]', err.message);
    }
    const notFound = injectMeta(html, {
      title: `Product Not Found | ${storeName}`,
      desc: 'This product is no longer available. Browse current products at ShopZen.',
      canonical: `${siteUrl}${req.path}`,
      ogImage: defaultOgImage,
      ogType: 'website',
      robots: 'noindex,follow',
      schemas: [orgSchema],
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).send(injectSeoWindowConfig(notFound, _topMeta));
  }

  // ── /category/:slug ─────────────────────────────────────────────────────────
  const categoryMatch = req.path.match(/^\/category\/([^/]+)$/);
  if (categoryMatch) {
    try {
      const slug = categoryMatch[1];
      const cat  = await Category.findOne({ slug, isActive: true }).lean();
      if (cat) {
        const catUrl  = `${siteUrl}/category/${slug}`;
        const title   = `${cat.name} — Buy Online in Sri Lanka | ${storeName}`;
        const plainCatDesc = cat.description ? String(cat.description).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
        const desc    = plainCatDesc.slice(0, 155) || `Shop ${cat.name} online in Sri Lanka. Best prices and fast delivery at ${storeName}.`;
        const keywords = `${cat.name}, buy ${cat.name} online sri lanka, ${cat.name} price sri lanka, best ${cat.name.toLowerCase()} brands sri lanka, ${storeName}`;
        const [featuredProduct, catProducts] = await Promise.all([
          Product.findOne({ category: cat._id, isActive: true, thumbnail: { $exists: true, $ne: '' } }).lean(),
          Product.find({ category: cat._id, isActive: true }, 'name slug thumbnail images brand price salePrice stock ratings').limit(20).lean(),
        ]);
        const ogImage = featuredProduct?.thumbnail || defaultOgImage;

        const breadcrumb = {
          '@context': 'https://schema.org', '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
            { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
            { '@type': 'ListItem', position: 3, name: cat.name, item: catUrl },
          ],
        };

        const faqSchema      = buildCategoryFAQ(cat.name, siteUrl);
        const itemListSchema = buildItemListSchema(catProducts, catUrl, `${cat.name} — Buy Online in Sri Lanka`);
        const schemas = [breadcrumb, orgSchema, faqSchema, itemListSchema].filter(Boolean);

        const out = injectMeta(html, { title, desc, canonical: catUrl, ogImage, ogType: 'website', keywords, schemas });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
      }
    } catch (err) {
      console.error('[SSR category]', err.message);
    }
  }

  // ── /brand/:slug ─────────────────────────────────────────────────────────────
  const brandMatch = req.path.match(/^\/brand\/([^/]+)$/);
  if (brandMatch) {
    try {
      const slug      = brandMatch[1];
      const brandName = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const brandUrl  = `${siteUrl}/brand/${slug}`;
      const title     = `${brandName} Products — Buy Online in Sri Lanka | ${storeName}`;
      const desc      = `Shop genuine ${brandName} products online in Sri Lanka. Best prices, fast delivery, manufacturer warranty at ${storeName}.`;
      const keywords  = `${brandName}, buy ${brandName} online sri lanka, ${brandName} price sri lanka, ${storeName}`;

      const featuredProduct = await Product.findOne({
        brand: new RegExp(`^${brandName}$`, 'i'),
        isActive: true, thumbnail: { $exists: true, $ne: '' },
      }).lean();
      const ogImage = featuredProduct?.thumbnail || defaultOgImage;

      const breadcrumb = {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
          { '@type': 'ListItem', position: 2, name: 'Shop', item: `${siteUrl}/shop` },
          { '@type': 'ListItem', position: 3, name: `${brandName} Products`, item: brandUrl },
        ],
      };

      const [brandProductsForList] = await Promise.all([
        Product.find({ brand: new RegExp(`^${brandName}$`, 'i'), isActive: true }, 'name slug thumbnail images brand price salePrice stock ratings').limit(20).lean(),
      ]);

      const faqSchema      = buildBrandFAQ(brandName, siteUrl, slug);
      const itemListSchema = buildItemListSchema(brandProductsForList, brandUrl, `${brandName} Products in Sri Lanka`);
      const schemas = [breadcrumb, orgSchema, faqSchema, itemListSchema].filter(Boolean);

      const out = injectMeta(html, { title, desc, canonical: brandUrl, ogImage, ogType: 'website', keywords, schemas });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
    } catch (err) {
      console.error('[SSR brand]', err.message);
    }
  }

  // ── /shop ──────────────────────────────────────────────────────────────────
  if (req.path === '/shop' || req.path === '/shop/') {
    try {
      const out = await renderShopPage(req, html, siteUrl, storeName, defaultOgImage);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
    } catch (err) {
      console.error('[SSR shop]', err.message);
    }
  }

  // ── / (homepage) ────────────────────────────────────────────────────────────
  if (req.path === '/' || req.path === '') {
    try {
      const meta = await getSeoMeta();
      if (meta) {
        // WebSite schema with SiteLinksSearchBox — appears in Google's
        // sitelinks search box in SERPs
        const websiteSchema = {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: storeName,
          url: siteUrl,
          potentialAction: {
            '@type': 'SearchAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${siteUrl}/shop?search={search_term_string}`,
            },
            'query-input': 'required name=search_term_string',
          },
        };
        // Store schema for Google Knowledge Panel
        const storeSchema = {
          '@context': 'https://schema.org',
          '@type': 'Store',
          name: storeName,
          url: siteUrl,
          description: meta.metaDesc,
          priceRange: 'Rs.500 - Rs.500,000',
          currenciesAccepted: 'LKR',
          paymentAccepted: 'Cash, Credit Card, Bank Transfer',
          areaServed: { '@type': 'Country', name: 'Sri Lanka' },
          address: { '@type': 'PostalAddress', addressCountry: 'LK' },
          hasMap: `${siteUrl}/page/contact`,
          logo: { '@type': 'ImageObject', url: meta.logoUrl || SHOPZEN_LOGO_URL, width: 512, height: 512 },
        };
        // Fetch categories + best sellers for static, crawlable homepage content
        const [homeCategories, bestSellers] = await Promise.all([
          Category.find({ isActive: true }, 'name slug').limit(12).lean(),
          Product.find({ isActive: true }, 'name slug thumbnail images brand price salePrice stock ratings')
            .sort({ isFeatured: -1, 'ratings.count': -1, createdAt: -1 })
            .limit(12)
            .lean(),
        ]);

        const bestSellersItemListSchema = buildItemListSchema(
          bestSellers, `${siteUrl}/shop`, `Best Selling Products — ${storeName} Sri Lanka`, siteUrl
        );

        const webPageSchema = {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          '@id': siteUrl,
          url: siteUrl,
          name: meta.metaTitle,
          description: meta.metaDesc,
          inLanguage: 'en-LK',
          isPartOf: { '@type': 'WebSite', name: storeName, url: siteUrl },
        };

        if (meta.sameAs && meta.sameAs.length) {
          storeSchema.sameAs = meta.sameAs;
          orgSchema.sameAs = meta.sameAs;
        }

        const homeContentHtml = buildHomeSeoContent({
          storeName, siteUrl, categories: homeCategories, bestSellers,
        });

        const out = injectMeta(injectHomeContent(html, homeContentHtml), {
          title: meta.metaTitle, desc: meta.metaDesc, canonical: siteUrl,
          ogImage: meta.ogImage, ogImageWidth: '1200', ogImageHeight: '630', ogType: 'website',
          verification: meta.verification,
          schemas: [websiteSchema, storeSchema, webPageSchema, orgSchema, bestSellersItemListSchema].filter(Boolean),
        });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
      }
    } catch (err) {
      console.error('[SSR home]', err.message);
    }
  }

  // ── /cart ──────────────────────────────────────────────────────────────────
  if (req.path === '/cart') {
    const out = injectMeta(html, {
      title: `Your Cart | ${storeName}`, desc: `Review your cart and checkout. Fast delivery at ${storeName}.`,
      canonical: `${siteUrl}/cart`, ogImage: defaultOgImage, ogType: 'website',
      schemas: [orgSchema],
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
  }

  // ── /wishlist ──────────────────────────────────────────────────────────────
  if (req.path === '/wishlist') {
    const out = injectMeta(html, {
      title: `Wishlist | ${storeName}`, desc: `Your saved products at ${storeName}.`,
      canonical: `${siteUrl}/wishlist`, ogImage: defaultOgImage, ogType: 'website',
      schemas: [orgSchema],
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
  }

  // ── /gift-cards ────────────────────────────────────────────────────────────
  if (req.path === '/gift-cards') {
    const out = injectMeta(html, {
      title: `Gift Cards | ${storeName} Sri Lanka`,
      desc: `Buy ${storeName} gift cards online. Perfect gift for anyone in Sri Lanka.`,
      canonical: `${siteUrl}/gift-cards`, ogImage: defaultOgImage, ogType: 'website',
      schemas: [orgSchema],
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
  }

  // ── /page/:slug ────────────────────────────────────────────────────────────
  const pageMatch = req.path.match(/^\/page\/([^/]+)$/);
  if (pageMatch) {
    const pageName = pageMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const out = injectMeta(html, {
      title: `${pageName} | ${storeName}`,
      desc: `${pageName} — Learn more at ${storeName}.`,
      canonical: `${siteUrl}/page/${pageMatch[1]}`, ogImage: defaultOgImage, ogType: 'website',
      schemas: [orgSchema],
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
  }

  // ── /campaign/:slug ────────────────────────────────────────────────────────
  const campaignMatch = req.path.match(/^\/campaign\/([^/]+)$/);
  if (campaignMatch) {
    const campName = campaignMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const out = injectMeta(html, {
      title: `${campName} | ${storeName}`,
      desc: `Special campaign at ${storeName}. Best deals in Sri Lanka.`,
      canonical: `${siteUrl}/campaign/${campaignMatch[1]}`, ogImage: defaultOgImage, ogType: 'website',
      schemas: [orgSchema],
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(injectSeoWindowConfig(out, _topMeta));
  }

  // ── Generic fallback — always return HTTP 200 with index.html ──────────────
  const meta = await getSeoMeta();
  const fallbackMeta = meta || {
    metaTitle: `${storeName} — Shop Online in Sri Lanka`,
    metaDesc:  'Shop the best products online in Sri Lanka.',
    ogImage:    defaultOgImage,
  };

  const out = injectMeta(html, {
    title:     fallbackMeta.metaTitle,
    desc:      fallbackMeta.metaDesc,
    canonical: `${siteUrl}${req.path}`,
    ogImage:   fallbackMeta.ogImage,
    ogType:    'website',
    verification: meta ? meta.verification : undefined,
    schemas: [orgSchema],
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  // Always 200 — never 404 for valid public routes (React SPA handles routing)
  res.status(200).send(out);
};

module.exports = router;
module.exports.seoRenderMiddleware = seoRenderMiddleware;
