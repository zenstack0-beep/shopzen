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

// ── Embedded build template (real index.html from frontend/build) ─────────────
// This is the actual compiled React app HTML, embedded so Railway always has
// the correct template with JS/CSS bundles — no fetching required.
const BUILT_HTML_TEMPLATE = "<!doctype html><html lang=\"en-LK\"><head><meta charset=\"utf-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=5,viewport-fit=cover\"/><link rel=\"icon\" href=\"/favicon.ico\"/><link rel=\"icon\" href=\"/favicon-32x32.png\" sizes=\"32x32\" type=\"image/png\"/><link rel=\"icon\" href=\"/favicon-16x16.png\" sizes=\"16x16\" type=\"image/png\"/><link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\"/><link rel=\"manifest\" href=\"/manifest.json\"/><meta name=\"theme-color\" content=\"#b5451b\" id=\"meta-theme-color\"/><meta name=\"mobile-web-app-capable\" content=\"yes\"/><meta name=\"apple-mobile-web-app-capable\" content=\"yes\"/><meta name=\"apple-mobile-web-app-status-bar-style\" content=\"default\"/><meta name=\"apple-mobile-web-app-title\" content=\"ShopZen\"/><meta name=\"format-detection\" content=\"telephone=no\"/><title>ShopZen \u2014 Premium Online Store Sri Lanka</title><meta name=\"description\" content=\"Shop the best products online in Sri Lanka. Fast delivery, guaranteed best prices on electronics, fashion and more at ShopZen.\"/><meta name=\"robots\" content=\"index,follow,max-image-preview:large\"/><link rel=\"canonical\" href=\"https://shopzen.lk\"/><meta property=\"og:type\" content=\"website\"/><meta property=\"og:title\" content=\"ShopZen \u2014 Premium Online Store Sri Lanka\"/><meta property=\"og:description\" content=\"Shop the best products online in Sri Lanka. Fast delivery, guaranteed best prices on electronics, fashion and more at ShopZen.\"/><meta property=\"og:image\" content=\"https://shopzen.lk/og-default.png\"/><meta property=\"og:url\" content=\"https://shopzen.lk\"/><meta property=\"og:site_name\" content=\"ShopZen\"/><meta property=\"og:locale\" content=\"en_US\"/><meta name=\"twitter:card\" content=\"summary_large_image\"/><meta name=\"twitter:title\" content=\"ShopZen \u2014 Premium Online Store Sri Lanka\"/><meta name=\"twitter:description\" content=\"Shop the best products online in Sri Lanka. Fast delivery, guaranteed best prices on electronics, fashion and more at ShopZen.\"/><meta name=\"twitter:image\" content=\"https://shopzen.lk/og-default.png\"/><link rel=\"preconnect\" href=\"https://fonts.googleapis.com\"/><link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin/><link rel=\"dns-prefetch\" href=\"https://res.cloudinary.com\"/><link rel=\"dns-prefetch\" href=\"https://www.googletagmanager.com\"/><link rel=\"dns-prefetch\" href=\"https://connect.facebook.net\"/><script>!function(){var e={default:{p:\"#b5451b\",pd:\"#8b3214\",pl:\"#e8643c\",a:\"#f0a500\",d:\"#0f172a\",s:\"#1e293b\",g:\"linear-gradient(135deg,#b5451b 0%,#e8643c 50%,#f0a500 100%)\",hg:\"linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#b5451b 100%)\",cb:\"#ffffff\",bb:\"#fafaf8\"},ocean:{p:\"#0369a1\",pd:\"#024f7a\",pl:\"#0ea5e9\",a:\"#06b6d4\",d:\"#0c1a2e\",s:\"#0f2744\",g:\"linear-gradient(135deg,#0369a1 0%,#0ea5e9 50%,#06b6d4 100%)\",hg:\"linear-gradient(135deg,#0c1a2e 0%,#0f2744 50%,#0369a1 100%)\",cb:\"#ffffff\",bb:\"#f0f9ff\"},forest:{p:\"#15803d\",pd:\"#0f5f2e\",pl:\"#22c55e\",a:\"#84cc16\",d:\"#052e16\",s:\"#0a3d20\",g:\"linear-gradient(135deg,#15803d 0%,#22c55e 50%,#84cc16 100%)\",hg:\"linear-gradient(135deg,#052e16 0%,#0a3d20 50%,#15803d 100%)\",cb:\"#ffffff\",bb:\"#f0fdf4\"},royal:{p:\"#7c3aed\",pd:\"#5b21b6\",pl:\"#a78bfa\",a:\"#f59e0b\",d:\"#1e1b4b\",s:\"#2e1065\",g:\"linear-gradient(135deg,#7c3aed 0%,#a78bfa 50%,#f59e0b 100%)\",hg:\"linear-gradient(135deg,#1e1b4b 0%,#2e1065 50%,#7c3aed 100%)\",cb:\"#ffffff\",bb:\"#faf5ff\"},rose:{p:\"#be185d\",pd:\"#9d174d\",pl:\"#f43f5e\",a:\"#fb7185\",d:\"#1f0a14\",s:\"#3b0a20\",g:\"linear-gradient(135deg,#be185d 0%,#f43f5e 50%,#fb7185 100%)\",hg:\"linear-gradient(135deg,#1f0a14 0%,#3b0a20 50%,#be185d 100%)\",cb:\"#ffffff\",bb:\"#fff1f2\"},amber:{p:\"#b45309\",pd:\"#92400e\",pl:\"#f59e0b\",a:\"#fbbf24\",d:\"#1c0a00\",s:\"#451a03\",g:\"linear-gradient(135deg,#b45309 0%,#f59e0b 50%,#fbbf24 100%)\",hg:\"linear-gradient(135deg,#1c0a00 0%,#451a03 50%,#b45309 100%)\",cb:\"#ffffff\",bb:\"#fffbeb\"},midnight:{p:\"#6366f1\",pd:\"#4338ca\",pl:\"#818cf8\",a:\"#38bdf8\",d:\"#0a0a0f\",s:\"#111120\",g:\"linear-gradient(135deg,#4338ca 0%,#6366f1 50%,#38bdf8 100%)\",hg:\"linear-gradient(135deg,#0a0a0f 0%,#111120 50%,#4338ca 100%)\",cb:\"#1a1a2e\",bb:\"#0d0d1a\"},coral:{p:\"#f97316\",pd:\"#ea580c\",pl:\"#fb923c\",a:\"#fcd34d\",d:\"#1c0a00\",s:\"#431407\",g:\"linear-gradient(135deg,#ea580c 0%,#f97316 50%,#fcd34d 100%)\",hg:\"linear-gradient(135deg,#1c0a00 0%,#431407 50%,#ea580c 100%)\",cb:\"#ffffff\",bb:\"#fff7ed\"},slate:{p:\"#334155\",pd:\"#1e293b\",pl:\"#475569\",a:\"#38bdf8\",d:\"#0f172a\",s:\"#1e293b\",g:\"linear-gradient(135deg,#1e293b 0%,#334155 50%,#38bdf8 100%)\",hg:\"linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#334155 100%)\",cb:\"#ffffff\",bb:\"#f8fafc\"},sakura:{p:\"#db2777\",pd:\"#be185d\",pl:\"#f472b6\",a:\"#a78bfa\",d:\"#1a0a14\",s:\"#2d1020\",g:\"linear-gradient(135deg,#be185d 0%,#db2777 50%,#a78bfa 100%)\",hg:\"linear-gradient(135deg,#1a0a14 0%,#2d1020 50%,#db2777 100%)\",cb:\"#ffffff\",bb:\"#fdf2f8\"},emerald:{p:\"#059669\",pd:\"#047857\",pl:\"#34d399\",a:\"#6ee7b7\",d:\"#022c22\",s:\"#064e3b\",g:\"linear-gradient(135deg,#047857 0%,#059669 50%,#34d399 100%)\",hg:\"linear-gradient(135deg,#022c22 0%,#064e3b 50%,#047857 100%)\",cb:\"#ffffff\",bb:\"#ecfdf5\"},neon:{p:\"#a855f7\",pd:\"#7c3aed\",pl:\"#c084fc\",a:\"#22d3ee\",d:\"#050010\",s:\"#0d001a\",g:\"linear-gradient(135deg,#7c3aed 0%,#a855f7 50%,#22d3ee 100%)\",hg:\"linear-gradient(135deg,#050010 0%,#0d001a 50%,#7c3aed 100%)\",cb:\"#0d001a\",bb:\"#080010\"}},a={default:{fd:\"'Playfair Display',serif\",fb:\"'DM Sans',sans-serif\",u:\"https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=DM+Sans:wght@300;400;500;600;700&display=swap\"},modern:{fd:\"'Poppins',sans-serif\",fb:\"'Inter',sans-serif\",u:\"https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&family=Inter:wght@300;400;500;600&display=swap\"},elegant:{fd:\"'Cormorant Garamond',serif\",fb:\"'Raleway',sans-serif\",u:\"https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Raleway:wght@300;400;500;600;700&display=swap\"},bold:{fd:\"'Syne',sans-serif\",fb:\"'Work Sans',sans-serif\",u:\"https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Work+Sans:wght@300;400;500;600&display=swap\"},luxury:{fd:\"'Bodoni Moda',serif\",fb:\"'Jost',sans-serif\",u:\"https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@400;600;700&family=Jost:wght@300;400;500;600&display=swap\"},tech:{fd:\"'Space Grotesk',sans-serif\",fb:\"'IBM Plex Sans',sans-serif\",u:\"https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap\"},minimal:{fd:\"'Outfit',sans-serif\",fb:\"'Nunito',sans-serif\",u:\"https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Nunito:wght@300;400;500;600&display=swap\"},classic:{fd:\"'Libre Baskerville',serif\",fb:\"'Source Sans 3',sans-serif\",u:\"https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Source+Sans+3:wght@300;400;500;600&display=swap\"}},f=null;try{var t=localStorage.getItem(\"shopzen_theme_v1\");t&&(f=JSON.parse(t))}catch(e){}var d=e[f&&f.theme||\"default\"]||e.default,r=f&&f.primaryColor||d.p,s=f&&f.primaryDarkColor||d.pd,l=f&&f.primaryLightColor||d.pl,i=f&&f.secondaryColor||d.a,n=f&&f.darkBgColor||d.d,o=document.documentElement;o.style.setProperty(\"--color-primary\",r),o.style.setProperty(\"--color-primary-dark\",s),o.style.setProperty(\"--color-primary-light\",l),o.style.setProperty(\"--color-accent\",i),o.style.setProperty(\"--color-dark\",n),o.style.setProperty(\"--color-surface\",d.s),o.style.setProperty(\"--theme-gradient\",d.g),o.style.setProperty(\"--hero-gradient\",d.hg),o.style.setProperty(\"--card-bg\",d.cb),o.style.setProperty(\"--body-bg\",d.bb),o.style.setProperty(\"--glow-primary\",r+\"66\"),o.style.setProperty(\"--glow-accent\",i+\"4d\");var g=document.createElement(\"style\");g.id=\"theme-bootstrap-bg\",g.textContent=\"html,body{background:\"+d.bb+\" !important}\",document.head.appendChild(g);var b=a[f&&f.fontStyle||\"default\"]||a.default;o.style.setProperty(\"--font-display\",b.fd),o.style.setProperty(\"--font-body\",b.fb);var p=document.createElement(\"link\");if(p.id=\"theme-font\",p.rel=\"stylesheet\",p.href=b.u,document.head.appendChild(p),f&&f.customCSS){var c=document.createElement(\"style\");c.id=\"theme-custom-css\",c.textContent=f.customCSS,document.head.appendChild(c)}var y=document.getElementById(\"meta-theme-color\");y&&(y.content=r)}()</script><script defer=\"defer\" src=\"/static/js/main.5d4ddad7.js\"></script><link href=\"/static/css/main.1a2ef7b8.css\" rel=\"stylesheet\"></head><body><noscript>You need to enable JavaScript to run this app.</noscript><div id=\"root\"></div></body></html>";

let _fetchedTemplate = null;
let _fetchedAt = 0;
const HTML_CACHE_TTL = 6 * 60 * 60 * 1000;

// Try to fetch fresher build from Vercel (updates after each deploy)
// Falls back to embedded template if fetch fails
async function tryFetchFreshTemplate() {
  const now = Date.now();
  if (_fetchedTemplate && (now - _fetchedAt) < HTML_CACHE_TTL) {
    return _fetchedTemplate;
  }
  const frontendUrl = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
  try {
    const https = require('https');
    const html = await new Promise((resolve, reject) => {
      const req = https.get(frontendUrl, { timeout: 5000 }, (res) => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    // Only use if it looks like the real React build (has JS bundle)
    if (html.includes('id="root"') && html.includes('/static/js/') && html.includes('shopzen')) {
      _fetchedTemplate = html;
      _fetchedAt = now;
      console.log('[SSR] Fetched fresh template from Vercel (' + html.length + ' bytes)');
      return _fetchedTemplate;
    }
  } catch (err) {
    console.log('[SSR] Could not fetch fresh template, using embedded build:', err.message);
  }
  return null;
}

async function getHtmlTemplate() {
  // 1. Check local filesystem (monorepo / self-hosted)
  const candidates = [
    require('path').join(__dirname, '..', 'frontend', 'build', 'index.html'),
    require('path').join(__dirname, '..', 'public', 'index.html'),
    require('path').join(process.cwd(), 'frontend', 'build', 'index.html'),
  ];
  for (const p of candidates) {
    if (require('fs').existsSync(p)) {
      const html = require('fs').readFileSync(p, 'utf8');
      if (html.includes('/static/js/')) {
        console.log('[SSR] Using local build:', p);
        return html;
      }
    }
  }

  // 2. Try fetching fresh from Vercel
  const fresh = await tryFetchFreshTemplate();
  if (fresh) return fresh;

  // 3. Always-available fallback: embedded compiled build
  console.log('[SSR] Using embedded build template');
  return BUILT_HTML_TEMPLATE;
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
  // Remove __META_INJECT__ placeholder if present
  let out = html.includes('__META_INJECT__') ? html.replace('__META_INJECT__', '') : html;

  // ── Strip any existing JSON-LD to prevent duplicates on repeat renders ─────
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g, '');

  // ── Replace standard meta tags ─────────────────────────────────────────────
  out = out
    .replace(/<title>[^<]*<\/title>/, `<title>${xe(title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/,         `$1${xe(desc)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/,               `$1${xe(canonical)}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/,        `$1${xe(ogTitle || title)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/,  `$1${xe(ogDesc || desc)}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/,        `$1${xe(ogImage)}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/,          `$1${xe(ogUrl || canonical)}$2`)
    .replace(/(<meta property="og:type" content=")[^"]*(")/,         `$1${xe(ogType || 'website')}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/,       `$1${xe(ogTitle || title)}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/,  `$1${xe(ogDesc || desc)}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/,       `$1${xe(ogImage)}$2`)
    .replace(/yourstore\.com/g, 'shopzen.lk');

  // ── Insert OG/Twitter tags if missing in template ──────────────────────────
  const missing = [
    !out.includes('property="og:type"')         ? `<meta property="og:type" content="${xe(ogType || 'website')}"/>` : '',
    !out.includes('property="og:title"')        ? `<meta property="og:title" content="${xe(ogTitle || title)}"/>` : '',
    !out.includes('property="og:description"')  ? `<meta property="og:description" content="${xe(ogDesc || desc)}"/>` : '',
    !out.includes('property="og:image"')        ? `<meta property="og:image" content="${xe(ogImage)}"/>` : '',
    !out.includes('property="og:url"')          ? `<meta property="og:url" content="${xe(ogUrl || canonical)}"/>` : '',
    !out.includes('property="og:site_name"')    ? `<meta property="og:site_name" content="ShopZen"/>` : '',
    !out.includes('name="twitter:card"')        ? `<meta name="twitter:card" content="summary_large_image"/>` : '',
    !out.includes('name="twitter:title"')       ? `<meta name="twitter:title" content="${xe(ogTitle || title)}"/>` : '',
    !out.includes('name="twitter:description"') ? `<meta name="twitter:description" content="${xe(ogDesc || desc)}"/>` : '',
    !out.includes('name="twitter:image"')       ? `<meta name="twitter:image" content="${xe(ogImage)}"/>` : '',
  ].filter(Boolean).join('\n');
  if (missing) out = out.replace('</head>', missing + '\n</head>');

  // ── Keywords ───────────────────────────────────────────────────────────────
  if (keywords) {
    if (!out.includes('name="keywords"')) {
      out = out.replace('</head>', `<meta name="keywords" content="${xe(keywords)}"/>\n</head>`);
    } else {
      out = out.replace(/(<meta name="keywords" content=")[^"]*(")/i, `$1${xe(keywords)}$2`);
    }
  }

  // ── Google verification ────────────────────────────────────────────────────
  if (verification && !out.includes('google-site-verification')) {
    out = out.replace('</head>', `<meta name="google-site-verification" content="${xe(verification)}"/>\n</head>`);
  }

  // ── JSON-LD schemas ────────────────────────────────────────────────────────
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

  // ── /cart ─────────────────────────────────────────────────────────────────
  if (req.path === '/cart') {
    const meta = await getSeoMeta();
    const out = injectMeta(html, {
      title: `Your Cart | ${storeName}`,
      desc: `Review your cart and checkout. Fast delivery across Sri Lanka at ${storeName}.`,
      canonical: `${siteUrl}/cart`, ogImage: defaultOgImage, ogType: 'website',
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.send(out);
  }

  // ── /wishlist ──────────────────────────────────────────────────────────────
  if (req.path === '/wishlist') {
    const out = injectMeta(html, {
      title: `Wishlist | ${storeName}`,
      desc: `Your saved products at ${storeName}. Shop online in Sri Lanka.`,
      canonical: `${siteUrl}/wishlist`, ogImage: defaultOgImage, ogType: 'website',
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.send(out);
  }

  // ── /gift-cards ────────────────────────────────────────────────────────────
  if (req.path === '/gift-cards') {
    const out = injectMeta(html, {
      title: `Gift Cards | ${storeName} Sri Lanka`,
      desc: `Buy ${storeName} gift cards online. Perfect gift for anyone in Sri Lanka.`,
      canonical: `${siteUrl}/gift-cards`, ogImage: defaultOgImage, ogType: 'website',
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.send(out);
  }

  // ── /page/:slug (business/static pages) ───────────────────────────────────
  const pageMatch = req.path.match(/^\/page\/([^/]+)$/);
  if (pageMatch) {
    const out = injectMeta(html, {
      title: `${pageMatch[1].replace(/-/g, ' ').replace(/\w/g, c => c.toUpperCase())} | ${storeName}`,
      desc: `Learn more at ${storeName}. Shop online in Sri Lanka.`,
      canonical: `${siteUrl}/page/${pageMatch[1]}`, ogImage: defaultOgImage, ogType: 'website',
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.send(out);
  }

  // ── /campaign/:slug ────────────────────────────────────────────────────────
  const campaignMatch = req.path.match(/^\/campaign\/([^/]+)$/);
  if (campaignMatch) {
    const out = injectMeta(html, {
      title: `${campaignMatch[1].replace(/-/g, ' ').replace(/\w/g, c => c.toUpperCase())} | ${storeName}`,
      desc: `Special campaign at ${storeName}. Best deals in Sri Lanka.`,
      canonical: `${siteUrl}/campaign/${campaignMatch[1]}`, ogImage: defaultOgImage, ogType: 'website',
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.send(out);
  }

  // ── Generic page fallback ──────────────────────────────────────────────────
  const meta = await getSeoMeta();
  const fallbackMeta = meta || { metaTitle: `${storeName} — Shop Online in Sri Lanka`, metaDesc: 'Shop the best products online in Sri Lanka.', ogImage: defaultOgImage };

  const out = injectMeta(html, {
    title: fallbackMeta.metaTitle,
    desc: fallbackMeta.metaDesc,
    canonical: `${siteUrl}${req.path}`,
    ogImage: fallbackMeta.ogImage,
    ogType: 'website',
    verification: meta ? meta.verification : undefined,
  });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.send(out);
};

module.exports = router;
module.exports.seoRenderMiddleware = seoRenderMiddleware;