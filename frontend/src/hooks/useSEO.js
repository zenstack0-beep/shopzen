/**
 * useSEO.js — Dynamic SEO hook for ShopZen
 * Manages: <title>, meta description, OG, Twitter Cards, JSON-LD,
 *           canonical URLs, GA4 / GTM / Meta Pixel page-view events.
 */

import { useEffect } from 'react';
import { fbqSafe } from './useAnalytics';
import { useLocation } from 'react-router-dom';

// ─── helpers ──────────────────────────────────────────────────────────────────
function setMeta(name, content, attr = 'name') {
  if (!content) return;
  let el = document.querySelector(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setLink(rel, href) {
  if (!href) return;
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * Checks whether the initial SSR HTML already contains a <script type="application/ld+json">
 * block for the given schema @type AND that block does NOT have one of our
 * client-side IDs (meaning it is a static SSR-rendered block, not one we wrote).
 * If an SSR block exists, we must NOT inject a duplicate — we only manage our
 * own id-tagged scripts.
 */
function ssrSchemaExists(schemaType) {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const s of scripts) {
    // Skip scripts we own (they have an id we set)
    if (s.id && s.id.startsWith('ld-')) continue;
    try {
      const data = JSON.parse(s.textContent);
      // Handle top-level @type match
      if (data['@type'] === schemaType) return true;
      // Handle @graph array (e.g. WebSite embeds Organization inside publisher)
      if (Array.isArray(data['@graph'])) {
        if (data['@graph'].some(node => node['@type'] === schemaType)) return true;
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return false;
}

/**
 * Sets or updates a JSON-LD <script> block identified by `id`.
 * If the same @type is already present in an SSR (non-id-tagged) script, the
 * call is silently skipped to prevent duplicate structured data.
 * For dynamic schemas (Product, BreadcrumbList) that are never in SSR HTML,
 * `bypassSsrCheck` can be set true to skip the SSR guard entirely.
 */
function setJsonLd(id, data, { bypassSsrCheck = false } = {}) {
  if (!bypassSsrCheck && data['@type'] && ssrSchemaExists(data['@type'])) {
    // SSR already has this schema type — do not create a duplicate.
    // Also clean up any previously injected client-side copy (e.g. on re-mount).
    removeJsonLd(id);
    return;
  }
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}

function removeJsonLd(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

export function getSeoConfig() {
  return window.__SHOPZEN_SEO__ || {};
}

/**
 * Returns a Meta Pixel-safe ISO 4217 currency code.
 *
 * Meta Pixel validates the `currency` parameter on Purchase / AddToCart
 * events.  If the code is missing or not a 3-letter ISO 4217 string the
 * event is silently dropped (you see the console warning:
 *   "Parameter 'currency' is invalid for event 'Purchase'").
 *
 * Root cause: getSeoConfig() returns {} when settings have not yet loaded,
 * so currencyCode is undefined and the fallback 'LKR' is correct — but
 * if someone has stored a non-ISO value (e.g. 'Rs.' or empty string) in
 * the DB it would fail the pixel's validation.  This helper normalises it.
 */
export function getPixelCurrency() {
  const raw = getSeoConfig().currencyCode;
  // Accept only exactly 3 uppercase ASCII letters (ISO 4217 format).
  if (raw && /^[A-Z]{3}$/.test(raw.trim().toUpperCase())) {
    return raw.trim().toUpperCase();
  }
  // Fall back to LKR (Sri Lankan Rupee — valid ISO 4217 code accepted by Meta).
  return 'LKR';
}

// ─── GA4 / analytics helpers ──────────────────────────────────────────────────
export function trackPageView(url, title) {
  const { ga4Id } = getSeoConfig();
  if (ga4Id && window.gtag) {
    window.gtag('config', ga4Id, { page_path: url, page_title: title });
  }
}

export function trackEvent(eventName, params = {}) {
  if (window.gtag) window.gtag('event', eventName, params);
  fbqSafe('track', eventName, params);
}

export function trackPurchase(order, items) {
  // Defensive: order.total may be 0 (free order) which is valid, but
  // undefined/null means the API response was incomplete — skip the event
  // rather than sending value: undefined which Meta silently drops.
  const value = typeof order.total === 'number' ? order.total
              : typeof order.grandTotal === 'number' ? order.grandTotal
              : null;
  if (value === null) {
    console.warn('[ShopZen] trackPurchase: order.total is missing, skipping pixel event', order);
    return;
  }

  const currency = getPixelCurrency();
  const transactionId = String(order._id || order.orderNumber || '');
  const contentIds = items.map(i => String(i.product?._id || i.productId || '')).filter(Boolean);

  // GA4
  if (window.gtag) {
    window.gtag('event', 'purchase', {
      transaction_id: transactionId,
      value,
      currency,
      items: items.map(i => ({
        item_id: String(i.product?._id || i.productId || ''),
        item_name: i.name || '',
        price:    typeof i.price === 'number' ? i.price : 0,
        quantity: typeof i.quantity === 'number' ? i.quantity : 1,
      })),
    });
  }

  // Meta Pixel — value must be a number, currency must be ISO 4217 (3 uppercase letters).
  // content_ids must be strings; num_items must be a positive integer.
  // Any of these wrong causes the event to be silently rejected.
  fbqSafe('track', 'Purchase', {
    value,
    currency,
    content_ids:  contentIds,
    content_type: 'product',
    num_items:    items.reduce((sum, i) => sum + (typeof i.quantity === 'number' ? i.quantity : 1), 0),
  });
}

export function trackAddToCart(product, quantity = 1) {
  // Ensure price is a number — Meta drops AddToCart if value is NaN/undefined
  const price    = Number(product.salePrice || product.price) || 0;
  const value    = price * (typeof quantity === 'number' ? quantity : 1);
  const currency = getPixelCurrency();
  const id       = String(product._id || '');

  if (window.gtag) {
    window.gtag('event', 'add_to_cart', {
      currency,
      value,
      items: [{ item_id: id, item_name: product.name || '', price, quantity }],
    });
  }
  fbqSafe('track', 'AddToCart', {
    content_ids:  [id],
    content_name: product.name || '',
    content_type: 'product',
    value,
    currency,
  });
}

export function trackViewItem(product) {
  const price    = Number(product.salePrice || product.price) || 0;
  const currency = getPixelCurrency();
  const id       = String(product._id || '');

  if (window.gtag) {
    window.gtag('event', 'view_item', {
      currency,
      value: price,
      items: [{ item_id: id, item_name: product.name || '', price }],
    });
  }
  fbqSafe('track', 'ViewContent', {
    content_ids:  [id],
    content_name: product.name || '',
    content_type: 'product',
    value:        price,
    currency,
  });
}

export function trackInitiateCheckout(items = [], value = 0) {
  const currency  = getPixelCurrency();
  const safeValue = typeof value === 'number' ? value : 0;
  const contentIds = items.map(i => String(i._id || i.productId || '')).filter(Boolean);

  // GA4
  if (window.gtag) {
    window.gtag('event', 'begin_checkout', {
      currency,
      value: safeValue,
      items: items.map(i => ({
        item_id:   String(i._id || i.productId || ''),
        item_name: i.name || '',
        price:     Number(i.salePrice || i.price) || 0,
        quantity:  typeof i.quantity === 'number' ? i.quantity : 1,
      })),
    });
  }
  fbqSafe('track', 'InitiateCheckout', {
    content_ids: contentIds,
    num_items:   items.reduce((sum, i) => sum + (typeof i.quantity === 'number' ? i.quantity : 1), 0),
    value:       safeValue,
    currency,
  });
}

// ─── main hook ────────────────────────────────────────────────────────────────
export default function useSEO({
  title,
  description,
  image,
  url,
  type = 'website',
  product,
  reviews,
  breadcrumbs,
  noindex = false,
  noindexFollow = false,
  keywords,
} = {}) {
  const location = useLocation();
  const cfg = getSeoConfig();

  const siteName      = cfg.siteName       || 'ShopZen';
  const siteUrl       = cfg.siteUrl        || window.location.origin;
  const twitterHandle = cfg.twitterHandle  || '';
  const defaultImage  = cfg.defaultOgImage || `${siteUrl}/og-default.png`;
  const defaultDesc   = cfg.defaultDescription || 'Premium online store — quality products, delivered fast.';

  // ── Build title ──────────────────────────────────────────────────────────────
  // Product pages: "Product Name Price in Sri Lanka | ShopZen" — captures high-volume
  // "X price in sri lanka" buying-intent queries directly in the <title> tag.
  let finalTitle;
  if (title && type === 'product') {
    const withPriceSuffix = `${title} Price in Sri Lanka | ShopZen`;
    const withShort       = `${title} | ShopZen`;
    finalTitle = withPriceSuffix.length <= 65
      ? withPriceSuffix
      : withShort.length <= 65
        ? withShort
        : title.slice(0, 50) + ' | ShopZen';
  } else {
    finalTitle = title ? `${title} | ${siteName}` : siteName;
  }

  // ── Build description ─────────────────────────────────────────────────────────
  // For products: rich buying-intent description with price and location signals
  let finalDesc;
  if (description) {
    finalDesc = description;
  } else if (type === 'product' && product) {
    const price     = product.salePrice || product.price;
    const origPrice = product.isOnSale && product.price ? product.price : null;
    const priceStr  = price ? `Rs.${price.toLocaleString()}` : '';
    const wasStr    = origPrice && origPrice !== price ? ` (was Rs.${origPrice.toLocaleString()})` : '';
    const brand     = product.brand ? `${product.brand} ` : '';
    const cat       = product.category?.name ? ` ${product.category.name}` : '';
    const plain     = String(product.shortDescription || product.description || '')
                        .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const snippet   = plain.slice(0, 80) || `${brand}${product.name}`;
    finalDesc = priceStr
      ? `${snippet}. ${priceStr}${wasStr}. Fast delivery across Sri Lanka. Shop at ShopZen.`.slice(0, 165)
      : `${snippet}. Shop ${brand}${product.name}${cat} online in Sri Lanka. Fast delivery, best prices at ShopZen.`.slice(0, 165);
  } else {
    finalDesc = defaultDesc;
  }

  // Apply Cloudinary social-card transforms for consistent 1200×630 OG images.
  // c_fill (not c_fit) crops to fully cover the 1200×630 box — no letterboxing
  // on Facebook/LinkedIn/WhatsApp previews. f_jpg + q_auto keeps the social
  // card lightweight vs. f_png.
  function buildOgImage(rawUrl) {
    if (!rawUrl || !rawUrl.includes('res.cloudinary.com')) return rawUrl;
    return rawUrl.replace(/\/upload\/(v\d+\/)?/, '/upload/w_1200,h_630,c_fill,g_auto,f_jpg,q_auto/$1');
  }
  const finalImage  = buildOgImage(image || defaultImage);

  // Build canonical from explicit `url`, or from the current path with
  // tracking params (utm_*, fbclid, gclid, etc.) stripped. Meaningful params
  // like pagination/search/sort are preserved if the caller passes a full
  // `url` themselves.
  function buildCanonical(explicitUrl) {
    if (explicitUrl) return explicitUrl;
    const path = location.pathname;
    const params = new URLSearchParams(location.search);
    [...params.keys()].forEach((key) => {
      if (/^(utm_|fbclid|gclid|msclkid|ref|igshid)/i.test(key)) params.delete(key);
    });
    const query = params.toString();
    return `${siteUrl}${path}${query ? `?${query}` : ''}`;
  }
  const finalUrl = buildCanonical(url);

  useEffect(() => {
    document.title = finalTitle;

    setMeta('description', finalDesc);
    // Private pages (cart/checkout/account) → noindex,nofollow.
    // Faceted/search-result combinations → noindex,follow (keep crawling
    // through to canonical category/product pages without indexing every
    // filter/sort/search permutation as its own page).
    // Everything else → index,follow.
    const robotsValue = noindex
      ? 'noindex,nofollow'
      : noindexFollow
        ? 'noindex,follow'
        : 'index,follow,max-image-preview:large';
    setMeta('robots', robotsValue);

    // Keywords meta — rich buying-intent signals for Google/Bing
    let kwString = keywords;
    if (!kwString && product) {
      const nameLc  = product.name.toLowerCase();
      const slugLc  = (product.slug || product.name).toLowerCase().replace(/[^a-z0-9]+/g, '');
      const brand   = product.brand || '';
      const catName = product.category?.name || '';
      const base    = [product.name, brand, product.sku, catName, ...(product.tags || [])].filter(Boolean);
      const intent  = [
        `${nameLc} price in sri lanka`,
        `buy ${brand} ${product.name}`.trim() + ' online sri lanka',
        `${brand.toLowerCase()} ${slugLc}`.trim(),
        `${nameLc} price`,
        `colombo delivery ${nameLc}`,
        `${nameLc} review`,
        `buy ${brand.toLowerCase()} ${product.name.toLowerCase()} in sri lanka`.trim(),
        `best ${catName.toLowerCase()} for sri lankan`.trim(),
        `${nameLc} features and price`,
        `sri lankan rupee price ${nameLc}`,
        brand ? `${brand.toLowerCase()} products sri lanka` : null,
        'sri lanka',
      ].filter(Boolean);
      kwString = [...base, ...intent].join(', ');
    }
    if (kwString) setMeta('keywords', kwString);
    setLink('canonical', finalUrl);

    // Open Graph
    setMeta('og:type',        type,       'property');
    setMeta('og:title',       finalTitle, 'property');
    setMeta('og:description', finalDesc,  'property');
    setMeta('og:image',       finalImage, 'property');
    setMeta('og:image:width',  '1200',    'property');
    setMeta('og:image:height', '630',     'property');
    setMeta('og:image:alt',   finalTitle, 'property');
    setMeta('og:url',         finalUrl,   'property');
    setMeta('og:site_name',   siteName,   'property');
    setMeta('og:locale', 'en_LK', 'property');

    // Twitter Cards
    setMeta('twitter:card',        finalImage ? 'summary_large_image' : 'summary');
    setMeta('twitter:title',       finalTitle);
    setMeta('twitter:description', finalDesc);
    setMeta('twitter:image',       finalImage);
    setMeta('twitter:image:alt',   finalTitle);
    if (twitterHandle) setMeta('twitter:site', twitterHandle);

    // JSON-LD: WebSite
    // Guarded: skipped if index.html already contains a static WebSite block.
    setJsonLd('ld-website', {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: siteName,
      url: siteUrl,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${siteUrl}/shop?search={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    });

    // JSON-LD: Organization — always emit so Google can show the logo next to
    // the site name in search results. `cfg.logoUrl` must be set in admin
    // Settings (stored in DB as storeLogoUrl, exposed via window.__SHOPZEN_SEO__).
    // Guarded: skipped if index.html already contains a static Organization block.
    {
      const sameAs = [
        cfg.facebookUrl, cfg.instagramUrl, cfg.twitterUrl,
        cfg.linkedinUrl, cfg.youtubeUrl, cfg.tiktokUrl, cfg.whatsappUrl,
      ].filter(Boolean);

      setJsonLd('ld-org', {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: cfg.orgName || siteName,
        url: siteUrl,
        // logoUrl MUST be a direct image URL (Cloudinary or /logo.png).
        // Google uses this for the website logo badge in search results.
        // Width ≥160px, aspect ratio ≤1:1 to 9.6:1, recommended 600×60px.
        logo: cfg.logoUrl
          ? { '@type': 'ImageObject', url: cfg.logoUrl, width: 600, height: 60 }
          : { '@type': 'ImageObject', url: `${siteUrl}/og-default.png` },
        contactPoint: cfg.phone ? [{
          '@type': 'ContactPoint',
          telephone: cfg.phone,
          contactType: 'customer service',
        }] : undefined,
        sameAs: sameAs.length ? sameAs : undefined,
      });
    }

    // JSON-LD: Product (full Google Rich Results schema)
    // Product schema is always dynamic (never in SSR HTML), so bypassSsrCheck is true.
    if (product) {
      const price = product.salePrice || product.price;
      const availability = product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';

      // Build image array — Google requires at least one image
      const imageArr = (product.images?.length ? product.images : [product.thumbnail]).filter(Boolean);

      const productSchema = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: String(product.shortDescription || product.description || '')
                       .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || product.name,
        image: imageArr.length > 0 ? imageArr : undefined,
        sku: product.sku || product._id,
        mpn: product.sku || undefined,
        brand: product.brand
          ? { '@type': 'Brand', name: product.brand }
          : { '@type': 'Brand', name: siteName },
        offers: {
          '@type': 'Offer',
          url: finalUrl,
          priceCurrency: cfg.currencyCode || 'LKR',
          price: price != null ? String(price) : '0',
          availability,
          itemCondition: 'https://schema.org/NewCondition',
          priceValidUntil: product.saleEndsAt
            ? new Date(product.saleEndsAt).toISOString().split('T')[0]
            : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          seller: { '@type': 'Organization', name: siteName },
          shippingDetails: {
            '@type': 'OfferShippingDetails',
            shippingRate: {
              '@type': 'MonetaryAmount',
              value: '0',
              currency: cfg.currencyCode || 'LKR',
            },
            deliveryTime: {
              '@type': 'ShippingDeliveryTime',
              handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
              transitTime: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 5, unitCode: 'DAY' },
            },
            shippingDestination: {
              '@type': 'DefinedRegion',
              addressCountry: cfg.countryCode || 'LK',
            },
          },
          hasMerchantReturnPolicy: {
            '@type': 'MerchantReturnPolicy',
            applicableCountry: cfg.countryCode || 'LK',
            returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
            merchantReturnDays: 14,
            returnMethod: 'https://schema.org/ReturnByMail',
            returnFees: 'https://schema.org/FreeReturn',
          },
        },
      };

      // AggregateRating — required for review stars in Google results
      if (product.ratings?.count >= 1) {
        productSchema.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: Number(product.ratings.average).toFixed(1),
          reviewCount: product.ratings.count,
          bestRating: '5',
          worstRating: '1',
        };
      }

      // Individual Review items — Google uses these to verify star snippets
      if (reviews?.length > 0) {
        productSchema.review = reviews.slice(0, 10).map(r => {
          const schema = {
            '@type': 'Review',
            reviewRating: {
              '@type': 'Rating',
              ratingValue: String(r.rating),
              bestRating: '5',
              worstRating: '1',
            },
            author: {
              '@type': 'Person',
              name: r.user
                ? `${r.user.firstName || ''}${r.user.lastName ? ' ' + r.user.lastName : ''}`.trim() || 'Customer'
                : 'Customer',
            },
            datePublished: r.createdAt
              ? new Date(r.createdAt).toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0],
          };
          if (r.title)   schema.name = r.title;
          if (r.comment) schema.reviewBody = r.comment;
          if (r.isVerifiedPurchase) schema.reviewAspect = 'Verified Purchase';
          return schema;
        });
      }

      setJsonLd('ld-product', productSchema, { bypassSsrCheck: true });
    } else {
      removeJsonLd('ld-product');
    }

    // JSON-LD: BreadcrumbList
    // BreadcrumbList is always dynamic (never in SSR HTML), so bypassSsrCheck is true.
    if (breadcrumbs?.length) {
      setJsonLd('ld-breadcrumb', {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: siteUrl },
          ...breadcrumbs.map((b, i) => ({
            '@type': 'ListItem',
            position: i + 2,
            name: b.name,
            item: b.url.startsWith('http') ? b.url : `${siteUrl}${b.url}`,
          })),
        ],
      }, { bypassSsrCheck: true });
    } else {
      removeJsonLd('ld-breadcrumb');
    }

    // Analytics firing
    trackPageView(location.pathname + location.search, finalTitle);
    fbqSafe('track', 'PageView');
    if (window.dataLayer) {
      window.dataLayer.push({ event: 'pageview', page: { url: finalUrl, title: finalTitle } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalTitle, finalDesc, finalImage, finalUrl, type, noindex, noindexFollow, keywords, location.pathname, reviews]);
}