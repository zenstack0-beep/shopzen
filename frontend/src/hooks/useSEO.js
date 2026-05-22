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
  breadcrumbs,
  noindex = false,
} = {}) {
  const location = useLocation();
  const cfg = getSeoConfig();

  const siteName      = cfg.siteName       || 'ShopZen';
  const siteUrl       = cfg.siteUrl        || window.location.origin;
  const twitterHandle = cfg.twitterHandle  || '';
  const defaultImage  = cfg.defaultOgImage || `${siteUrl}/og-default.png`;
  const defaultDesc   = cfg.defaultDescription || 'Premium online store — quality products, delivered fast.';

  const finalTitle = title       ? `${title} | ${siteName}` : siteName;
  const finalDesc   = description || defaultDesc;
  const finalImage  = image       || defaultImage;
  const finalUrl    = url         || `${siteUrl}${location.pathname}`;

  useEffect(() => {
    document.title = finalTitle;

    setMeta('description', finalDesc);
    setMeta('robots', noindex ? 'noindex,nofollow' : 'index,follow,max-image-preview:large');
    setLink('canonical', finalUrl);

    // Open Graph
    setMeta('og:type',        type,       'property');
    setMeta('og:title',       finalTitle, 'property');
    setMeta('og:description', finalDesc,  'property');
    setMeta('og:image',       finalImage, 'property');
    setMeta('og:url',         finalUrl,   'property');
    setMeta('og:site_name',   siteName,   'property');
    setMeta('og:locale',      'en_US',    'property');

    // Twitter Cards
    setMeta('twitter:card',        finalImage ? 'summary_large_image' : 'summary');
    setMeta('twitter:title',       finalTitle);
    setMeta('twitter:description', finalDesc);
    setMeta('twitter:image',       finalImage);
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
        sameAs: [cfg.facebookUrl, cfg.instagramUrl, cfg.twitterUrl, cfg.linkedinUrl, cfg.youtubeUrl].filter(Boolean),
      });
    }

    // JSON-LD: Product
    if (product) {
      const price = product.salePrice || product.price;
      const availability = product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';
      const productSchema = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: product.name,
        description: product.shortDescription || product.description,
        image: product.images?.length ? product.images : [product.thumbnail],
        sku: product.sku || product._id,
        brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
        offers: {
          '@type': 'Offer',
          url: finalUrl,
          priceCurrency: cfg.currencyCode || 'LKR',
          price,
          availability,
          priceValidUntil: product.saleEndsAt ? new Date(product.saleEndsAt).toISOString().split('T')[0] : undefined,
          seller: { '@type': 'Organization', name: siteName },
        },
      };
      if (product.ratings?.count > 0) {
        productSchema.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: product.ratings.average.toFixed(1),
          reviewCount: product.ratings.count,
          bestRating: '5',
          worstRating: '1',
        };
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
  }, [finalTitle, finalDesc, finalImage, finalUrl, type, noindex, location.pathname]);
}
