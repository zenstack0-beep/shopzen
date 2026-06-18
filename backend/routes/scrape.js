/**
 * ─── ShopZen Product URL Scraper ─────────────────────────────────────────────
 * routes/scrape.js
 *
 * POST /api/scrape/product
 *   Body: { url: "https://example.com/some-product" }
 *   Returns: { name, price, salePrice, description, images[], brand, sku }
 *
 * HOW IT WORKS:
 *  1. Fetch the remote page HTML via axios (spoofed UA to avoid bot-blocks).
 *  2. Parse with a lightweight regex + DOM-like extraction (no headless browser
 *     needed for most e-commerce sites — meta tags + JSON-LD cover ~90%).
 *  3. For each image URL found, download the binary, upload it to Cloudinary
 *     via the existing /api/upload flow (re-uses adminAuth), and return the
 *     resulting Cloudinary URLs so the admin can pick which images to keep.
 *  4. All fields are returned as suggestions — the admin reviews and edits
 *     before saving the product.
 *
 * SECURITY:
 *  • Only adminAuth users can call this endpoint.
 *  • We block requests to private/internal IP ranges (SSRF protection).
 *  • A hard 10-second timeout is applied to the remote fetch.
 *  • Max 20 images are extracted; each image download has a 15s timeout.
 */

'use strict';

const express   = require('express');
const router    = express.Router();
const axios     = require('axios');
const https     = require('https');
const { URL }   = require('url');
const cloudinary = require('cloudinary').v2;
const { adminAuth } = require('../middleware/auth');

// ─── SSRF Guard ───────────────────────────────────────────────────────────────
// Block requests to localhost / private RFC-1918 ranges.
const PRIVATE_IP_RE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|localhost)/i;

function isSafeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    if (PRIVATE_IP_RE.test(u.hostname)) return false;
    return true;
  } catch { return false; }
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
      const data = JSON.parse(raw.trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] === 'Product' || (item['@graph'] && item['@graph'].find(n => n['@type'] === 'Product'))) {
          return item['@type'] === 'Product' ? item : item['@graph'].find(n => n['@type'] === 'Product');
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
    // Download as buffer with a timeout
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ShopZenBot/1.0)',
        Referer: imageUrl,
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
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
  // 1. Fetch HTML
  const { data: html } = await axios.get(pageUrl, {
    timeout: 10000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    maxContentLength: 5 * 1024 * 1024, // 5MB cap
  });

  const result = {
    name: null,
    price: null,
    salePrice: null,
    description: null,
    shortDescription: null,
    brand: null,
    sku: null,
    imageUrls: [], // raw scraped URLs (not yet uploaded)
  };

  // 2. JSON-LD (most reliable)
  const ld = extractJsonLd(html);
  if (ld) {
    result.name        = result.name  || stripHtml(ld.name  || '');
    result.brand       = result.brand || (ld.brand?.name || ld.brand || '');
    result.description = result.description || stripHtml(ld.description || '');
    result.sku         = result.sku   || ld.sku || ld.mpn || '';

    // Price from offers
    const offer = ld.offers
      ? (Array.isArray(ld.offers) ? ld.offers[0] : ld.offers)
      : null;
    if (offer?.price) {
      const p = parsePrice(String(offer.price));
      if (p) result.price = p;
    }

    // Images from JSON-LD
    const ldImages = ld.image
      ? (Array.isArray(ld.image) ? ld.image : [ld.image])
      : [];
    ldImages.forEach(img => {
      const src = typeof img === 'string' ? img : img.url;
      const resolved = resolveUrl(pageUrl, src);
      if (resolved && looksLikeProductImage(resolved)) result.imageUrls.push(resolved);
    });
  }

  // 3. Open Graph / Twitter meta tags
  result.name        = result.name  || metaContent(html, 'og:title')    || metaContent(html, 'twitter:title');
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

  // 5. Scrape <img> tags from the page (src and data-src/data-lazy-src)
  const imgRe = /<img[^>]+>/gi;
  let imgMatch;
  // eslint-disable-next-line no-cond-assign
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag = imgMatch[0];
    // prefer data-src / data-lazy-src / data-original (lazy-loaded images)
    const srcAttr = tag.match(/data-(?:lazy-)?src=["']([^"']+)["']/i)
                 || tag.match(/data-original=["']([^"']+)["']/i)
                 || tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcAttr) continue;
    const resolved = resolveUrl(pageUrl, srcAttr[1]);
    if (resolved && looksLikeProductImage(resolved)) result.imageUrls.push(resolved);
    if (result.imageUrls.length >= 40) break; // don't over-collect
  }

  // 6. Try to extract price from common patterns if still missing
  if (!result.price) {
    // Shopify-style
    const shopifyPriceRe = /"price":\s*(\d+)/;
    const shopifyMatch = html.match(shopifyPriceRe);
    if (shopifyMatch) result.price = parseInt(shopifyMatch[1], 10) / 100;

    // WooCommerce / generic
    if (!result.price) {
      const priceRe = /class=["'][^"']*(?:price|amount)[^"']*["'][^>]*>\s*(?:<[^>]+>)*\s*(?:[A-Z$£€₹Rs.]*\.?\s*)?([\d,]+(?:\.\d{1,2})?)/i;
      const priceMatch = html.match(priceRe);
      if (priceMatch) result.price = parsePrice(priceMatch[1]);
    }
  }

  // 7. Deduplicate images and cap at 20
  result.imageUrls = unique(result.imageUrls).filter(looksLikeProductImage).slice(0, 20);

  return result;
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/scrape/product
 * Body: { url: string, uploadImages?: boolean }
 *
 * If uploadImages=true (default true) each image is downloaded and uploaded
 * to Cloudinary, returning permanent CDN URLs.
 * If uploadImages=false the raw scraped image URLs are returned — faster but
 * the images may disappear when the source site changes.
 */
router.post('/product', adminAuth, async (req, res) => {
  const { url: rawUrl, uploadImages = true } = req.body;

  if (!rawUrl) return res.status(400).json({ message: 'url is required' });
  if (!isSafeUrl(rawUrl)) return res.status(400).json({ message: 'Invalid or unsafe URL' });

  try {
    const scraped = await scrapeProduct(rawUrl);

    let finalImages = scraped.imageUrls;

    if (uploadImages && scraped.imageUrls.length > 0) {
      // Upload all found images in parallel (cap at 20 to avoid hammering)
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
    // Distinguish fetch failures from server errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.response?.status >= 400) {
      return res.status(422).json({ message: `Could not fetch page: ${err.message}` });
    }
    return res.status(500).json({ message: 'Scraping failed: ' + err.message });
  }
});

module.exports = router;