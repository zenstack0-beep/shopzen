/**
 * ─── ShopZen Product URL Scraper ─────────────────────────────────────────────
 * routes/scrape.js
 *
 * POST /api/scrape/product
 *   Body: { url: "https://example.com/some-product" }
 *   Returns: { name, price, salePrice, description, images[], brand, sku }
 *
 * HOW IT WORKS:
 *  1. Fetch the remote page HTML via axios with full browser-like headers and
 *     UA rotation to avoid 403 bot-blocks in production environments.
 *  2. Falls back to Google Cache if direct fetch is blocked (403/429).
 *  3. Parse with regex + JSON-LD / Open Graph extraction (no headless browser).
 *  4. For each image URL found, download and upload to Cloudinary.
 *  5. All fields returned as suggestions — admin reviews before saving.
 *
 * SECURITY:
 *  • Only adminAuth users can call this endpoint.
 *  • SSRF protection: blocks requests to private/internal IP ranges.
 *  • Hard 15-second timeout on remote fetches.
 *  • Max 20 images extracted; each image download has a 15s timeout.
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

// ─── User-Agent Pool ──────────────────────────────────────────────────────────
// Rotate through realistic desktop UAs to avoid single-UA fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/** Build full browser-like headers that pass most bot-detection checks */
function buildHeaders(pageUrl, ua) {
  const origin = new URL(pageUrl).origin;
  return {
    'User-Agent': ua,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Upgrade-Insecure-Requests': '1',
    'Referer': 'https://www.google.com/',
    'Origin': origin,
    'DNT': '1',
    'Connection': 'keep-alive',
  };
}

// ─── Axios instance with shared TLS config ────────────────────────────────────
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

/** Attempt to fetch HTML from a URL, returns { html, finalUrl } or throws */
async function fetchHtml(pageUrl, ua) {
  const { data: html, request } = await axios.get(pageUrl, {
    timeout: 15000,
    headers: buildHeaders(pageUrl, ua),
    httpsAgent,
    maxRedirects: 10,
    maxContentLength: 5 * 1024 * 1024, // 5 MB cap
    decompress: true,
    // Return actual response even on 4xx so we can check status
    validateStatus: status => status < 500,
  });

  return {
    html: typeof html === 'string' ? html : JSON.stringify(html),
    finalUrl: request?.res?.responseUrl || pageUrl,
  };
}

/**
 * Fetch with retry + Google Cache fallback.
 * Strategy:
 *   1. Try direct fetch with random UA
 *   2. If 403/429: retry once with a different UA
 *   3. If still blocked: try Google Cache version
 *   4. If Google Cache also fails: throw with informative message
 */
async function fetchWithFallback(pageUrl) {
  const ua1 = randomUA();

  // Attempt 1 — direct
  try {
    const result = await fetchHtml(pageUrl, ua1);
    // axios with validateStatus passes 4xx through; check manually
    if (typeof result.html === 'string' && result.html.length > 500) {
      return result;
    }
  } catch (err) {
    // network error — fall through to retry
    console.warn('[Scraper] Attempt 1 network error:', err.message);
  }

  // Attempt 2 — direct with a different UA (brief pause to avoid rate limits)
  await new Promise(r => setTimeout(r, 800));
  const ua2 = USER_AGENTS.find(u => u !== ua1) || USER_AGENTS[1];
  try {
    const result = await fetchHtml(pageUrl, ua2);
    if (typeof result.html === 'string' && result.html.length > 500) {
      return result;
    }
  } catch (err) {
    console.warn('[Scraper] Attempt 2 network error:', err.message);
  }

  // Attempt 3 — Google Cache
  const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(pageUrl)}`;
  try {
    const result = await fetchHtml(cacheUrl, randomUA());
    if (typeof result.html === 'string' && result.html.length > 500) {
      console.info('[Scraper] Serving from Google Cache for:', pageUrl);
      return { ...result, finalUrl: pageUrl };
    }
  } catch (err) {
    console.warn('[Scraper] Google Cache also failed:', err.message);
  }

  // All attempts exhausted
  throw Object.assign(
    new Error(`Could not fetch page — the site blocked automated access (403/429). Try a different product page or paste the details manually.`),
    { code: 'BLOCKED' }
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    try {
      const data = JSON.parse(raw.trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product') return item;
        if (item['@graph']) {
          const p = item['@graph'].find(n => n['@type'] === 'Product');
          if (p) return p;
        }
      }
    } catch { /* ignore bad JSON */ }
  }
  return null;
}

function parsePrice(str = '') {
  const cleaned = str.replace(/[^\d.,]/g, '').replace(',', '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function resolveUrl(base, src) {
  try { return new URL(src, base).href; } catch { return null; }
}

function looksLikeProductImage(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (/\.(svg|gif|ico|webfont|font)/.test(lower)) return false;
  if (/sprite|icon|logo|placeholder|blank|pixel|tracking|beacon/.test(lower)) return false;
  return true;
}

function unique(arr) {
  return [...new Set(arr)];
}

// ─── Cloudinary upload from URL ───────────────────────────────────────────────
async function uploadImageFromUrl(imageUrl) {
  try {
    const ua = randomUA();
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': ua,
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': new URL(imageUrl).origin + '/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'same-site',
      },
      httpsAgent,
      maxRedirects: 5,
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;

    const b64 = Buffer.from(response.data).toString('base64');
    const dataUri = `data:${contentType};base64,${b64}`;

    const result = await cloudinary.uploader.upload(dataUri, {
      folder: 'shopzen/scraped',
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
  const { html, finalUrl } = await fetchWithFallback(pageUrl);
  const baseUrl = finalUrl || pageUrl;

  const result = {
    name: null,
    price: null,
    salePrice: null,
    description: null,
    shortDescription: null,
    brand: null,
    sku: null,
    imageUrls: [],
  };

  // 1. JSON-LD (most reliable)
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
      const src = typeof img === 'string' ? img : img.url;
      const resolved = resolveUrl(baseUrl, src);
      if (resolved && looksLikeProductImage(resolved)) result.imageUrls.push(resolved);
    });
  }

  // 2. Open Graph / Twitter meta tags
  result.name        = result.name  || metaContent(html, 'og:title')         || metaContent(html, 'twitter:title');
  result.description = result.description || metaContent(html, 'og:description') || metaContent(html, 'twitter:description') || metaContent(html, 'description');

  const ogImage = metaContent(html, 'og:image') || metaContent(html, 'twitter:image');
  if (ogImage) {
    const resolved = resolveUrl(baseUrl, ogImage);
    if (resolved) result.imageUrls.push(resolved);
  }

  // 3. <title> tag fallback
  if (!result.name) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) result.name = stripHtml(titleMatch[1]).split('|')[0].split(' - ')[0].trim();
  }

  // 4. Scrape <img> tags
  const imgRe = /<img[^>]+>/gi;
  let imgMatch;
  // eslint-disable-next-line no-cond-assign
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag = imgMatch[0];
    const srcAttr = tag.match(/data-(?:lazy-)?src=["']([^"']+)["']/i)
                 || tag.match(/data-original=["']([^"']+)["']/i)
                 || tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcAttr) continue;
    const resolved = resolveUrl(baseUrl, srcAttr[1]);
    if (resolved && looksLikeProductImage(resolved)) result.imageUrls.push(resolved);
    if (result.imageUrls.length >= 40) break;
  }

  // 5. Price fallback patterns
  if (!result.price) {
    const shopifyMatch = html.match(/"price":\s*(\d+)/);
    if (shopifyMatch) result.price = parseInt(shopifyMatch[1], 10) / 100;

    if (!result.price) {
      const priceRe = /class=["'][^"']*(?:price|amount)[^"']*["'][^>]*>\s*(?:<[^>]+>)*\s*(?:[A-Z$£€₹Rs.]*\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i;
      const priceMatch = html.match(priceRe);
      if (priceMatch) result.price = parsePrice(priceMatch[1]);
    }
  }

  // 6. Deduplicate and cap images
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

  if (!rawUrl) return res.status(400).json({ message: 'url is required' });
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
      name:             scraped.name        || '',
      price:            scraped.price       || '',
      salePrice:        scraped.salePrice   || '',
      description:      scraped.description || '',
      shortDescription: scraped.shortDescription || '',
      brand:            scraped.brand       || '',
      sku:              scraped.sku         || '',
      images: finalImages,
    });

  } catch (err) {
    console.error('[Scraper] Error:', err.message);
    if (err.code === 'BLOCKED') {
      return res.status(422).json({ message: err.message });
    }
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      return res.status(422).json({ message: `Could not fetch page: ${err.message}` });
    }
    return res.status(500).json({ message: 'Scraping failed: ' + err.message });
  }
});

module.exports = router;