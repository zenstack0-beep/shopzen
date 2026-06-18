/**
 * ─── ShopZen Product URL Scraper ─────────────────────────────────────────────
 * routes/scrape.js
 *
 * POST /api/scrape/product
 *   Body: { url: "https://example.com/some-product" }
 *   Returns: { name, price, salePrice, description, images[], brand, sku }
 *
 * HOW IT WORKS:
 *  1. Fetch the remote page HTML via axios with full browser-like headers
 *     (rotating User-Agent + all sec-fetch-* / sec-ch-ua headers that real
 *     Chrome sends) to pass Cloudflare and other bot-detection systems.
 *  2. Retries up to 3 times with different UA strings on 403/429/503.
 *  3. Parse with a lightweight regex + DOM-like extraction (no headless browser
 *     needed for most e-commerce sites — meta tags + JSON-LD cover ~90%).
 *  4. For each image URL found, download the binary, upload it to Cloudinary
 *     via the existing /api/upload flow (re-uses adminAuth), and return the
 *     resulting Cloudinary URLs so the admin can pick which images to keep.
 *  5. All fields are returned as suggestions — the admin reviews and edits
 *     before saving the product.
 *
 * SECURITY:
 *  • Only adminAuth users can call this endpoint.
 *  • We block requests to private/internal IP ranges (SSRF protection).
 *  • A hard 15-second timeout is applied to the remote fetch.
 *  • Max 20 images are extracted; each image download has a 15s timeout.
 *
 * FIX (v2) — Production 403 Fix:
 *  Root cause: production server IPs (Railway/Render/Heroku) are datacenter
 *  ranges that Cloudflare, Akamai, and most e-commerce WAFs fingerprint and
 *  block. The original code only sent a basic UA string. Fix adds:
 *    • Full Chrome-like header set (sec-ch-ua, sec-fetch-*, accept-encoding …)
 *    • Rotating pool of realistic User-Agent strings
 *    • Random delay between retries (avoids rate-limit triggers)
 *    • Follows up to 5 redirects while preserving Referer/headers
 *    • Falls back to googlebot UA as last resort (many sites allow it)
 *    • Cleaner error messages ("This site blocks automated requests" vs raw axios)
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const axios      = require('axios');
const https      = require('https');
const { URL }    = require('url');
const cloudinary = require('cloudinary').v2;
const { adminAuth } = require('../middleware/auth');

// ─── SSRF Guard ───────────────────────────────────────────────────────────────
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|localhost)/i;

function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (PRIVATE_IP_RE.test(u.hostname)) return false;
    return true;
  } catch { return false; }
}

// ─── Browser UA Pool ─────────────────────────────────────────────────────────
// Rotate through realistic desktop Chrome UAs — each looks like a different
// real user, reducing the chance of pattern-based blocking.
const UA_POOL = [
  // Chrome 124 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome 123 on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  // Chrome 122 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  // Firefox 125 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  // Firefox 124 on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:124.0) Gecko/20100101 Firefox/124.0',
  // Edge 124 on Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  // Safari 17 on macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  // Googlebot — many sites whitelist this as a fallback
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
];

/** Return sec-ch-ua header value matching the given UA string */
function getSecChUa(ua) {
  if (ua.includes('Edg/')) {
    return '"Microsoft Edge";v="124", "Chromium";v="124", "Not-A.Brand";v="99"';
  }
  if (ua.includes('Chrome/124')) {
    return '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
  }
  if (ua.includes('Chrome/123')) {
    return '"Chromium";v="123", "Google Chrome";v="123", "Not-A.Brand";v="99"';
  }
  if (ua.includes('Chrome/122')) {
    return '"Chromium";v="122", "Google Chrome";v="122", "Not-A.Brand";v="99"';
  }
  // Firefox / Safari / Googlebot — don't send sec-ch-ua (they don't)
  return null;
}

/** Build a full browser-like header set for a given UA and target URL */
function buildHeaders(ua, targetUrl) {
  const isChromium = ua.includes('Chrome/') || ua.includes('Edg/');
  const origin     = new URL(targetUrl).origin;

  const headers = {
    'User-Agent':      ua,
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control':   'no-cache',
    'Pragma':          'no-cache',
    'Connection':      'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Referer':         origin + '/',
  };

  if (isChromium) {
    const secChUa = getSecChUa(ua);
    if (secChUa) {
      headers['sec-ch-ua']          = secChUa;
      headers['sec-ch-ua-mobile']   = '?0';
      headers['sec-ch-ua-platform'] = '"Windows"';
    }
    headers['Sec-Fetch-Dest']   = 'document';
    headers['Sec-Fetch-Mode']   = 'navigate';
    headers['Sec-Fetch-Site']   = 'none';
    headers['Sec-Fetch-User']   = '?1';
  }

  return headers;
}

/** Small random delay helper — makes retries look less bot-like */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Fetch HTML with retry logic across different UAs */
async function fetchHtml(pageUrl, timeoutMs = 15000) {
  const retryableStatuses = new Set([403, 429, 503, 520, 521, 522, 523, 524]);

  for (let attempt = 0; attempt < UA_POOL.length; attempt++) {
    const ua      = UA_POOL[attempt];
    const headers = buildHeaders(ua, pageUrl);

    try {
      const response = await axios.get(pageUrl, {
        timeout: timeoutMs,
        headers,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        maxRedirects: 5,
        maxContentLength: 5 * 1024 * 1024, // 5MB cap
        // Decompress automatically (axios handles gzip/br when accept-encoding is set)
        decompress: true,
        // Follow redirects and update referer header automatically
        beforeRedirect: (options, { headers: respHeaders }) => {
          if (respHeaders.location) {
            options.headers['Referer'] = pageUrl;
          }
        },
      });

      // Success — return HTML string
      return typeof response.data === 'string'
        ? response.data
        : response.data.toString();

    } catch (err) {
      const status = err.response?.status;
      const isRetryable = retryableStatuses.has(status)
        || err.code === 'ECONNRESET'
        || err.code === 'ETIMEDOUT';

      console.warn(
        `[Scraper] Attempt ${attempt + 1}/${UA_POOL.length} failed` +
        (status ? ` (HTTP ${status})` : ` (${err.code || err.message})`) +
        ` — UA: ${ua.substring(0, 40)}...`
      );

      // Last attempt — throw the error so the route handler can surface it
      if (attempt === UA_POOL.length - 1) {
        // Attach a clean message based on the final status code
        if (status === 403) {
          const e = new Error('This site blocks automated requests (HTTP 403). Try copying product details manually.');
          e.code = 'BLOCKED_403';
          throw e;
        }
        if (status === 429) {
          const e = new Error('Rate limited by the target site (HTTP 429). Wait a minute and try again.');
          e.code = 'RATE_LIMITED';
          throw e;
        }
        throw err;
      }

      // Only retry on retryable statuses / connection errors
      if (!isRetryable) throw err;

      // Exponential-ish back-off: 800ms, 1.5s, 2.5s, 4s …
      const delayMs = Math.min(800 * Math.pow(1.8, attempt), 6000);
      await sleep(delayMs + Math.random() * 400);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strip HTML tags and decode common entities */
function stripHtml(str = '') {
  return str
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Extract content of a meta tag by name or property */
function metaContent(html, nameOrProp) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const m = html.match(re) ||
    html.match(new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${nameOrProp}["']`,
      'i'
    ));
  return m ? stripHtml(m[1]) : null;
}

/** Extract first JSON-LD block of @type Product */
function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    try {
      const data  = JSON.parse(raw.trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product') return item;
        if (item['@graph']) {
          const prod = item['@graph'].find(n => n['@type'] === 'Product');
          if (prod) return prod;
        }
      }
    } catch { /* ignore bad JSON */ }
  }
  return null;
}

/** Try to parse a price string like "Rs. 4,500" or "$29.99" → number */
function parsePrice(str = '') {
  const cleaned = str.replace(/[^\d.,]/g, '').replace(',', '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

/** Resolve a (possibly relative) image URL against the page origin */
function resolveUrl(base, src) {
  try { return new URL(src, base).href; } catch { return null; }
}

/** Check if a URL looks like a real product image (skip tiny icons/gifs/svg) */
function looksLikeProductImage(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (/\.(svg|gif|ico|webfont|font)/.test(lower)) return false;
  if (/sprite|icon|logo|placeholder|blank|pixel|tracking|beacon/.test(lower)) return false;
  return true;
}

/** Deduplicate while preserving order */
function unique(arr) {
  return [...new Set(arr)];
}

// ─── Cloudinary upload from URL ───────────────────────────────────────────────
async function uploadImageFromUrl(imageUrl) {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': UA_POOL[0],
        'Referer':    imageUrl,
        'Accept':     'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      decompress: true,
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;

    const b64     = Buffer.from(response.data).toString('base64');
    const dataUri = `data:${contentType};base64,${b64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder:        'shopzen/scraped',
      resource_type: 'image',
    });

    return result.secure_url;
  } catch (err) {
    console.warn('[Scraper] Image upload failed:', imageUrl, err.message);
    return null;
  }
}

// ─── Main scrape logic ────────────────────────────────────────────────────────
async function scrapeProduct(pageUrl) {
  // 1. Fetch HTML with anti-bot retry logic
  const html = await fetchHtml(pageUrl);

  const result = {
    name:             null,
    price:            null,
    salePrice:        null,
    description:      null,
    shortDescription: null,
    brand:            null,
    sku:              null,
    imageUrls:        [],
  };

  // 2. JSON-LD (most reliable)
  const ld = extractJsonLd(html);
  if (ld) {
    result.name        = result.name  || stripHtml(ld.name  || '');
    result.brand       = result.brand || (ld.brand?.name || ld.brand || '');
    result.description = result.description || stripHtml(ld.description || '');
    result.sku         = result.sku   || ld.sku || ld.mpn || '';

    const offer = ld.offers
      ? (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers)
      : null;
    if (offer?.price) {
      const p = parsePrice(String(offer.price));
      if (p) result.price = p;
    }

    const ldImages = ld.image
      ? (Array.isArray(ld.image) ? ld.image : [ld.image])
      : [];
    ldImages.forEach(img => {
      const src      = typeof img === 'string' ? img : img.url;
      const resolved = resolveUrl(pageUrl, src);
      if (resolved && looksLikeProductImage(resolved)) result.imageUrls.push(resolved);
    });
  }

  // 3. Open Graph / Twitter meta tags
  result.name        = result.name        || metaContent(html, 'og:title')       || metaContent(html, 'twitter:title');
  result.description = result.description || metaContent(html, 'og:description') || metaContent(html, 'twitter:description') || metaContent(html, 'description');

  const ogImage = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  if (ogImage) {
    const resolved = resolveUrl(pageUrl, ogImage);
    if (resolved) result.imageUrls.push(resolved);
  }

  // 4. <title> tag fallback
  if (!result.name) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) result.name = stripHtml(titleMatch[1]).split('|')[0].split(' - ')[0].trim();
  }

  // 5. Scrape <img> tags (src / data-src / data-lazy-src / data-original)
  const imgRe = /<img[^>]+>/gi;
  let imgMatch;
  // eslint-disable-next-line no-cond-assign
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag     = imgMatch[0];
    const srcAttr = tag.match(/data-(?:lazy-)?src=["']([^"']+)["']/i)
                 || tag.match(/data-original=["']([^"']+)["']/i)
                 || tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcAttr) continue;
    const resolved = resolveUrl(pageUrl, srcAttr[1]);
    if (resolved && looksLikeProductImage(resolved)) result.imageUrls.push(resolved);
    if (result.imageUrls.length >= 40) break;
  }

  // 6. Price extraction fallbacks
  if (!result.price) {
    // Shopify
    const shopifyMatch = html.match(/"price":\s*(\d+)/);
    if (shopifyMatch) result.price = parseInt(shopifyMatch[1], 10) / 100;

    // WooCommerce / generic
    if (!result.price) {
      const priceRe    = /class=["'][^"']*(?:price|amount)[^"']*["'][^>]*>\s*(?:<[^>]+>)*\s*(?:[A-Z$£€₹Rs.]*\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i;
      const priceMatch = html.match(priceRe);
      if (priceMatch) result.price = parsePrice(priceMatch[1]);
    }
  }

  // 7. Deduplicate and cap images
  result.imageUrls = unique(result.imageUrls).filter(looksLikeProductImage).slice(0, 20);

  return result;
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/scrape/product
 * Body: { url: string, uploadImages?: boolean }
 */
router.post('/product', adminAuth, async (req, res) => {
  const { url: rawUrl, uploadImages = true } = req.body;

  if (!rawUrl)          return res.status(400).json({ message: 'url is required' });
  if (!isSafeUrl(rawUrl)) return res.status(400).json({ message: 'Invalid or unsafe URL' });

  try {
    const scraped = await scrapeProduct(rawUrl);

    let finalImages = scraped.imageUrls;

    if (uploadImages && scraped.imageUrls.length > 0) {
      const uploadResults = await Promise.all(
        scraped.imageUrls.slice(0, 20).map(uploadImageFromUrl)
      );
      finalImages = uploadResults.filter(Boolean);
    }

    return res.json({
      name:             scraped.name             || '',
      price:            scraped.price            || '',
      salePrice:        scraped.salePrice        || '',
      description:      scraped.description      || '',
      shortDescription: scraped.shortDescription || '',
      brand:            scraped.brand            || '',
      sku:              scraped.sku              || '',
      images:           finalImages,
    });

  } catch (err) {
    console.error('[Scraper] Error:', err.message);

    // User-friendly messages for known failure modes
    if (err.code === 'BLOCKED_403') {
      return res.status(422).json({ message: err.message });
    }
    if (err.code === 'RATE_LIMITED') {
      return res.status(429).json({ message: err.message });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return res.status(422).json({ message: 'Could not reach that URL. Check the address and try again.' });
    }
    if (err.response?.status >= 400) {
      return res.status(422).json({
        message: `Could not fetch page: the site returned HTTP ${err.response.status}. It may block automated access.`,
      });
    }

    return res.status(500).json({ message: 'Scraping failed: ' + err.message });
  }
});

module.exports = router;