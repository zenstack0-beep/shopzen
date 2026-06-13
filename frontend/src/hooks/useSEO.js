/**
 * useSEO.js — Dynamic SEO hook for ShopZen
 * Manages: <title>, meta description, OG, Twitter Cards, JSON-LD,
 *           canonical URLs, GA4 / GTM / Meta Pixel page-view events.
 */

import { useEffect } from 'react';
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

function setJsonLd(id, data) {
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

// ─── GA4 / analytics helpers ──────────────────────────────────────────────────
export function trackPageView(url, title) {
  const { ga4Id } = getSeoConfig();
  if (ga4Id && window.gtag) {
    window.gtag('config', ga4Id, { page_path: url, page_title: title });
  }
}

export function trackEvent(eventName, params = {}) {
  if (window.gtag) window.gtag('event', eventName, params);
  if (window.fbq) window.fbq('track', eventName, params);
}

export function trackPurchase(order, items) {
  const value = order.total;
  const currency = getSeoConfig().currencyCode || 'LKR';
  // GA4
  if (window.gtag) {
    window.gtag('event', 'purchase', {
      transaction_id: order._id || order.orderNumber,
      value,
      currency,
      items: items.map(i => ({
        item_id: i.product?._id || i.productId,
        item_name: i.name,
        price: i.price,
        quantity: i.quantity,
      })),
    });
  }
  // Meta Pixel
  if (window.fbq) {
    window.fbq('track', 'Purchase', { value, currency });
  }
}

export function trackAddToCart(product, quantity = 1) {
  const price = product.salePrice || product.price;
  if (window.gtag) {
    window.gtag('event', 'add_to_cart', {
      currency: getSeoConfig().currencyCode || 'LKR',
      value: price * quantity,
      items: [{ item_id: product._id, item_name: product.name, price, quantity }],
    });
  }
  if (window.fbq) {
    window.fbq('track', 'AddToCart', {
      content_ids: [product._id],
      content_name: product.name,
      value: price * quantity,
      currency: getSeoConfig().currencyCode || 'LKR',
    });
  }
}

export function trackViewItem(product) {
  const price = product.salePrice || product.price;
  if (window.gtag) {
    window.gtag('event', 'view_item', {
      currency: getSeoConfig().currencyCode || 'LKR',
      value: price,
      items: [{ item_id: product._id, item_name: product.name, price }],
    });
  }
  if (window.fbq) {
    window.fbq('track', 'ViewContent', {
      content_ids: [product._id],
      content_name: product.name,
      value: price,
      currency: getSeoConfig().currencyCode || 'LKR',
    });
  }
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
    setMeta('robots', noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large');

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

    // JSON-LD: Organization
    if (cfg.orgName || cfg.siteName) {
      const sameAs = [
        cfg.facebookUrl, cfg.instagramUrl, cfg.twitterUrl,
        cfg.linkedinUrl, cfg.youtubeUrl, cfg.tiktokUrl, cfg.whatsappUrl,
      ].filter(Boolean);

      setJsonLd('ld-org', {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: cfg.orgName || siteName,
        url: siteUrl,
        logo: cfg.logoUrl ? { '@type': 'ImageObject', url: cfg.logoUrl } : undefined,
        contactPoint: cfg.phone ? [{
          '@type': 'ContactPoint',
          telephone: cfg.phone,
          contactType: 'customer service',
        }] : undefined,
        // Only include sameAs if at least one social profile is configured —
        // an empty array signals "no social presence" to crawlers, which is
        // worse than omitting the field entirely.
        sameAs: sameAs.length ? sameAs : undefined,
      });
    }

    // JSON-LD: Product (full Google Rich Results schema)
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

      setJsonLd('ld-product', productSchema);
    } else {
      removeJsonLd('ld-product');
    }

    // JSON-LD: BreadcrumbList
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
      });
    } else {
      removeJsonLd('ld-breadcrumb');
    }

    // Analytics firing
    trackPageView(location.pathname + location.search, finalTitle);
    if (window.fbq) window.fbq('track', 'PageView');
    if (window.dataLayer) {
      window.dataLayer.push({ event: 'pageview', page: { url: finalUrl, title: finalTitle } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalTitle, finalDesc, finalImage, finalUrl, type, noindex, keywords, location.pathname, reviews]);
}