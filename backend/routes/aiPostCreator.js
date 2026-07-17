/**
 * routes/aiPostCreator.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AI POST CREATOR — standalone marketing module
 * ─────────────────────────────────────────────────────────────────────────────
 * NEW, independent feature. Does not modify any existing route, model,
 * controller, or service. Everything below either:
 *   (a) reads existing data through existing, untouched models (Product,
 *       SocialMedia), or
 *   (b) calls existing, untouched service functions
 *       (services/socialMediaService.js, services/publishers/*) exactly the
 *       way services/publisherService.js already does.
 *
 * Endpoints:
 *   GET  /api/ai-post-creator/products          → product list for the picker
 *                                                  (thin wrapper around the
 *                                                  same query shape already
 *                                                  used by /api/products/admin/lookup)
 *   POST /api/ai-post-creator/generate-copy      → { headline, caption, cta, hashtags[] }
 *                                                  Low-token AI call — only
 *                                                  name/category/brand/price/
 *                                                  discount are sent, reusing
 *                                                  the same OpenRouter-only
 *                                                  caller pattern as routes/ai.js.
 *   POST /api/ai-post-creator/upload-creative    → uploads a generated PNG/JPG/
 *                                                  WEBP (base64 data URL) and
 *                                                  returns a public URL, reusing
 *                                                  the existing local/Cloudinary
 *                                                  storage strategy from
 *                                                  routes/upload.js.
 *   GET  /api/ai-post-creator/connected-platforms → which of the 5 existing
 *                                                  social platforms are
 *                                                  connected + enabled (for
 *                                                  the publish dropdown)
 *   POST /api/ai-post-creator/publish            → publish a generated
 *                                                  creative + caption to one
 *                                                  of the existing connected
 *                                                  platforms, using the same
 *                                                  PUBLISHERS[platform].publish()
 *                                                  call publisherService.js uses
 *                                                  — no new credential storage,
 *                                                  no new OAuth, nothing
 *                                                  duplicated.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPLATE MODE (generationMode: "template") — added without modifying any
 * of the above. Server-side background removal and PNG-template compositing
 * via Sharp, isolated in services/templateRenderer.js and this route.
 * ─────────────────────────────────────────────────────────────────────────────
 *   GET  /api/ai-post-creator/templates           → list available PNG
 *                                                  templates (id, label,
 *                                                  thumbnail URL)
 *   GET  /api/ai-post-creator/templates/:id/thumbnail
 *                                                → raw template PNG
 *   POST /api/ai-post-creator/generate-template   → { dataUrl } final
 *                                                  1080x1080 composited PNG
 *                                                  (template + product
 *                                                  cutout + name/price/
 *                                                  discount/CTA/description)
 *
 * All routes require adminAuth, identical to every other admin-only route file.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');

const { adminAuth }  = require('../middleware/auth');
const Product         = require('../models/Product');
const PublishLog       = require('../models/PublishLog');
const AIPostPreset     = require('../models/AIPostPreset');
const { Settings, Coupon } = require('../models/index');
const { DiscountEngine } = require('../services/discountEngine');
const { getOrCreate, decryptPlatformFields } = require('../services/socialMediaService');

router.use(adminAuth);

const cleanText = (value, max=5000) => String(value == null ? '' : value)
  .replace(/<[^>]*>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);
const formatLkr = value => Number(value || 0).toLocaleString('en-LK', { maximumFractionDigits: 2 });
const hashtag = value => cleanText(value, 80).replace(/[^a-z0-9]/gi, '');

function getAuthoritativeProductPricing(product) {
  const regularPrice = Number(product?.price) || 0;
  const sellingPrice = Number(DiscountEngine.effectivePrice(product)) || regularPrice;
  const isProductSale = regularPrice > 0 && sellingPrice > 0 && sellingPrice < regularPrice;
  return {
    regularPrice,
    sellingPrice,
    isProductSale,
    productSalePercent: isProductSale
      ? Math.round(((regularPrice - sellingPrice) / regularPrice) * 100)
      : 0,
  };
}

function publicVoucherDetails(coupon, validation, pricing, quantity=1) {
  const discountAmount = quantity === 1 ? Number(validation?.discount) || 0 : 0;
  const priceAfterVoucher = discountAmount > 0
    ? Math.max(0, pricing.sellingPrice - discountAmount)
    : null;
  const percentageLabel = `${Number(coupon.value) || 0}% OFF${Number(coupon.maxDiscount) > 0 ? ` (MAX RS. ${formatLkr(coupon.maxDiscount)})` : ''}`;
  return {
    code: cleanText(coupon.code, 80).toUpperCase(),
    type: coupon.type,
    value: Number(coupon.value) || 0,
    minOrderAmount: Number(coupon.minOrderAmount) || 0,
    maxDiscount: Number(coupon.maxDiscount) || 0,
    userLimit: Number(coupon.userLimit) || 1,
    discountAmount,
    priceAfterVoucher,
    requiresMultipleItems: quantity > 1,
    minimumProductQuantity: quantity,
    label: coupon.type === 'percentage'
      ? percentageLabel
      : `Rs. ${formatLkr(coupon.value)} OFF`,
  };
}

// Return only vouchers that are safe to advertise publicly for this exact
// product. Checkout's DiscountEngine remains the authority for scope, minimum
// spend, sale-item exclusions, usage limits, caps and profit protection.
async function getAdvertisableProductVouchers(product, requestedCode='') {
  const now = new Date();
  const normalizedCode = cleanText(requestedCode, 80).toUpperCase();
  const query = {
    isActive: true,
    isNewUserOnly: { $ne: true },
    validFrom: { $lte: now },
    validUntil: { $gte: now },
  };
  if (normalizedCode && normalizedCode !== 'AUTO') query.code = normalizedCode;

  const coupons = await Coupon.find(query).sort({ value: -1, createdAt: -1 }).lean();
  const pricing = getAuthoritativeProductPricing(product);
  if (!pricing.sellingPrice) return [];

  const canonicalProduct = {
    ...product,
    category: product.category?._id || product.category,
  };
  const results = [];
  for (const coupon of coupons) {
    if (coupon.usageLimit && Number(coupon.usedCount) >= Number(coupon.usageLimit)) continue;

    // A minimum order can still make a product eligible even when one unit is
    // below the threshold. Validate the smallest qualifying quantity and state
    // that minimum clearly instead of inventing a one-item after-voucher price.
    const quantity = coupon.minOrderAmount > pricing.sellingPrice
      ? Math.max(1, Math.ceil(Number(coupon.minOrderAmount) / pricing.sellingPrice))
      : 1;
    const lineItem = DiscountEngine.buildLineItem(canonicalProduct, quantity);
    const validation = await DiscountEngine.validateCoupon(coupon.code, lineItem.subtotal, {
      lineItems: [lineItem],
    });
    if (validation.error || !(Number(validation.discount) > 0)) continue;
    const configuredDiscount = Math.round(coupon.type === 'percentage'
      ? Math.min((lineItem.subtotal * Number(coupon.value || 0)) / 100, Number(coupon.maxDiscount) || Infinity)
      : Math.min(Number(coupon.value || 0), lineItem.subtotal));
    // A hidden profit-protection reduction can make the public voucher value
    // differ from checkout. Do not advertise that coupon for this product.
    if (Number(validation.discount) !== configuredDiscount) continue;
    results.push(publicVoucherDetails(coupon, validation, pricing, quantity));
  }

  return results.sort((a, b) => {
    if (a.requiresMultipleItems !== b.requiresMultipleItems) return a.requiresMultipleItems ? 1 : -1;
    if (b.discountAmount !== a.discountAmount) return b.discountAmount - a.discountAmount;
    return b.value - a.value;
  });
}

// Marketing features must come from data an admin has explicitly verified or
// configured on the product. This deliberately excludes free-form product
// descriptions, tags and AI guesses.
function getConfiguredMarketingFeatures(product, limit=6) {
  const features = [];
  const seenKeys = new Set();
  const seenValues = new Set();
  const normalize = value => cleanText(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const excludedKey = /(^|\b)(sku|stock|price|cost|brand|category|mpn|part\s*(number|no)|barcode|gtin|condition|certifications?|dimensions?|weight|country\s+of\s+origin|model(\s+number)?)(\b|$)/i;
  const priority = key => {
    const value = normalize(key);
    if (/warranty|guarantee/.test(value)) return 100;
    if (/charging|power|output|watt|voltage/.test(value)) return 95;
    if (/battery|capacity|runtime|playtime/.test(value)) return 92;
    if (/compatib|support/.test(value)) return 90;
    if (/connect|bluetooth|wifi|wireless/.test(value)) return 88;
    if (/technology|standard|protocol/.test(value)) return 86;
    if (/protection|waterproof|resistance|durability|safety/.test(value)) return 84;
    if (/speed|performance|resolution|pressure|range/.test(value)) return 82;
    if (/material|display|port|interface/.test(value)) return 78;
    return 50;
  };
  const add = (key, value) => {
    const cleanKey = cleanText(key, 80);
    const cleanValue = cleanText(value, 180);
    if (!cleanKey || !cleanValue || excludedKey.test(cleanKey)) return;
    const keyFingerprint = normalize(cleanKey)
      .replace(/\b(product|available|supported|support|feature|details?|specifications?|option)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const valueFingerprint = normalize(cleanValue).replace(/\s+/g, '');
    if (!keyFingerprint || !valueFingerprint || seenKeys.has(keyFingerprint) || seenValues.has(valueFingerprint) || features.length >= limit) return;
    seenKeys.add(keyFingerprint);
    seenValues.add(valueFingerprint);
    features.push({ key: cleanKey, value: cleanValue });
  };

  (product.specifications || [])
    .filter(spec => spec.verified === true)
    .sort((a, b) => priority(b.key) - priority(a.key))
    .forEach(spec => add(spec.key, spec.value));

  (product.variants || []).forEach(variant => {
    const values = [...new Set((variant.values || [])
      .filter(value => value.isAvailable !== false)
      .map(value => cleanText(value.label || value.value, 60))
      .filter(Boolean))];
    if (!values.length) return;
    const visible = values.slice(0, 4).join(', ');
    add(variant.name || 'Options', values.length > 4 ? `${visible} +${values.length - 4} more` : visible);
  });

  return features.slice(0, limit);
}

function decodeLogoDataUrl(dataUrl) {
  if (!dataUrl) return null;
  const match = String(dataUrl).match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error('Logo must be a PNG, JPG, or WEBP image');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) {
    throw new Error('Logo image is empty or larger than 2MB');
  }
  return buffer;
}

async function getPublicStoreContact() {
  const rows = await Settings.find({ key: { $in: ['seo_config', 'whatsappNumber', 'storeName'] } }).lean();
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const candidates = [process.env.PUBLIC_STORE_URL, values.seo_config?.siteUrl, process.env.FRONTEND_URL, 'https://shopzen.lk'];
  const siteUrl = String(candidates.find(url => /^https:\/\//i.test(String(url || '')) && !/localhost|127\.0\.0\.1/i.test(String(url))) || 'https://shopzen.lk').replace(/\/$/, '');
  const whatsappNumber = String(values.whatsappNumber || process.env.WHATSAPP_NUMBER || '94775474001').replace(/[^0-9]/g, '').replace(/^0/, '94');
  return { siteUrl, whatsappNumber, storeName: cleanText(values.storeName || 'ShopZen', 80) };
}

function localPhone(number) {
  const digits = String(number || '').replace(/\D/g, '');
  const local = digits.startsWith('94') && digits.length === 11 ? `0${digits.slice(2)}` : digits;
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : local;
}

function missingOfferFactsFromCaption(caption, pricing, voucher) {
  const text = String(caption || '');
  const compact = text.replace(/,/g, '').toUpperCase();
  const hasMoney = value => compact.includes(formatLkr(value).replace(/,/g, '').toUpperCase());
  const missing = [];

  if (pricing.isProductSale) {
    if (!hasMoney(pricing.sellingPrice)) missing.push(`sale price Rs. ${formatLkr(pricing.sellingPrice)}`);
    if (!hasMoney(pricing.regularPrice)) missing.push(`regular price Rs. ${formatLkr(pricing.regularPrice)}`);
  } else if (!hasMoney(pricing.sellingPrice)) {
    missing.push(`price Rs. ${formatLkr(pricing.sellingPrice)}`);
  }

  if (voucher) {
    if (!compact.includes(voucher.code.toUpperCase())) missing.push(`voucher code ${voucher.code}`);
    if (voucher.type === 'percentage' && !compact.includes(`${voucher.value}%`)) missing.push(`${voucher.value}% voucher benefit`);
    if (voucher.type === 'fixed' && !hasMoney(voucher.value)) missing.push(`voucher benefit Rs. ${formatLkr(voucher.value)}`);
    if (voucher.priceAfterVoucher != null && !hasMoney(voucher.priceAfterVoucher)) missing.push(`after-voucher price Rs. ${formatLkr(voucher.priceAfterVoucher)}`);
    if (voucher.minOrderAmount > 0 && (!/MINIMUM\s+ELIGIBLE\s+ORDER/i.test(text) || !hasMoney(voucher.minOrderAmount))) {
      missing.push(`minimum eligible order Rs. ${formatLkr(voucher.minOrderAmount)}`);
    }
    if (voucher.maxDiscount > 0 && voucher.type === 'percentage'
      && (!/MAXIMUM\s+VOUCHER\s+DISCOUNT/i.test(text) || !hasMoney(voucher.maxDiscount))) {
      missing.push(`maximum voucher discount Rs. ${formatLkr(voucher.maxDiscount)}`);
    }
    if (voucher.userLimit > 0 && !/USAGE\s+LIMIT/i.test(text)) missing.push('voucher usage limit');
  }
  return missing;
}

/* ══════════════════════════════════════════════════════════════════════════
   GET /api/ai-post-creator/products
   Thin product list for the picker. Reuses the Product model only —
   no schema changes. Mirrors the field selection already used by
   GET /api/products/admin/lookup so behaviour stays consistent.
══════════════════════════════════════════════════════════════════════════ */
router.get('/products', async (req, res) => {
  try {
    const { search = '', page = 1, limit = 24 } = req.query;
    const filter = { isActive: true };
    if (search.trim()) {
      filter.$or = [
        { name:  new RegExp(search.trim(), 'i') },
        { brand: new RegExp(search.trim(), 'i') },
        { sku:   new RegExp(search.trim(), 'i') },
      ];
    }
    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .select('name price salePrice thumbnail images brand sku mpn subCategory category slug isOnSale specifications variants')
      .populate('category', 'name')
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();

    res.json({
      products: products.map(p => {
        const pricing = getAuthoritativeProductPricing(p);
        return {
          _id:        p._id,
          name:       p.name,
          price:      pricing.regularPrice,
          salePrice:  pricing.isProductSale ? pricing.sellingPrice : null,
          discount:   pricing.productSalePercent,
          thumbnail:  p.thumbnail || p.images?.[0] || '',
          images:     p.images || [],
          brand:      p.brand || '',
          sku:        p.sku || '',
          category:   p.category?.name || p.subCategory || '',
          slug:       p.slug,
          isOnSale:   pricing.isProductSale,
          marketingFeatures: getConfiguredMarketingFeatures(p).map(feature => `${feature.key}: ${feature.value}`),
        };
      }),
      total,
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   AI CALLERS — copied pattern (not a shared import) from routes/ai.js so
   this module stays fully standalone and a future change to routes/ai.js
   can never break post creation, or vice versa.
══════════════════════════════════════════════════════════════════════════ */
async function callOpenRouter(systemMsg, userMsg, maxTokens) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer':  process.env.FRONTEND_URL || 'https://shopzen.lk',
      'X-Title':       'ShopZen AI Post Creator',
    },
    body: JSON.stringify({
      model:       'meta-llama/llama-3.1-8b-instruct',
      max_tokens:  maxTokens,
      temperature: 0.6,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg   },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callAI(systemMsg, userMsg, maxTokens = 220) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('No AI key configured. Set OPENROUTER_API_KEY in your .env');
  return callOpenRouter(systemMsg, userMsg, maxTokens);
}

function extractJSON(raw, type = 'object') {
  const open  = type === 'array' ? '[' : '{';
  const close = type === 'array' ? ']' : '}';
  const start = raw.indexOf(open);
  const end   = raw.lastIndexOf(close);
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON in AI response: ' + raw.slice(0, 120));
  return JSON.parse(raw.slice(start, end + 1));
}

/* ══════════════════════════════════════════════════════════════════════════
   POST /api/ai-post-creator/generate-copy
   LOW-TOKEN BY DESIGN:
     - Only 5 scalar fields are ever sent to the model (name, category,
       brand, price, discount) — no description, no specs, no images.
     - max_tokens capped at 220 (vs 500-1200 used elsewhere in routes/ai.js).
     - One AI call generates headline + caption + CTA + hashtags together,
       instead of 4 separate calls.
══════════════════════════════════════════════════════════════════════════ */
router.post('/generate-copy', async (req, res) => {
  const { name, category, brand, price, discount, template } = req.body || {};
  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ message: 'Product name is required' });
  }

  // Hard cap on what reaches the model — essential fields only.
  const essential = {
    name:     String(name).trim().slice(0, 120),
    category: category ? String(category).trim().slice(0, 60) : '',
    brand:    brand    ? String(brand).trim().slice(0, 60)    : '',
    price:    Number(price)    || 0,
    discount: Number(discount) || 0,
  };

  const templateTone = {
    sale:        'urgent savings, money-conscious shoppers',
    new_arrival: 'fresh, exciting, "just dropped" energy',
    best_seller: 'social proof, trusted, popular choice',
    flash_sale:  'extreme urgency, countdown, limited time',
  }[template] || 'engaging, professional e-commerce marketing';

  const systemMsg = 'You are a social media marketing copywriter for an e-commerce store. You output ONLY valid JSON. No markdown. No explanation.';
  const userMsg = [
    `Write social media post copy for this product. Tone: ${templateTone}.`,
    `Product: ${essential.name}`,
    essential.brand    ? `Brand: ${essential.brand}` : '',
    essential.category ? `Category: ${essential.category}` : '',
    essential.price    ? `Price: LKR ${essential.price}` : '',
    essential.discount > 0 ? `Discount: ${essential.discount}% off` : '',
    '',
    'Reply ONLY with this JSON:',
    '{"headline":"...","caption":"...","cta":"...","hashtags":["...","..."]}',
    '',
    'Rules:',
    '- headline: max 8 words, punchy, no emoji spam (1 emoji max)',
    '- caption: 1-2 short sentences, max 160 characters, conversational',
    '- cta: 2-4 words, action phrase (e.g. "Shop Now", "Grab the Deal")',
    '- hashtags: exactly 6 lowercase hashtags WITHOUT the # symbol, mix of product/brand/category/generic shopping tags',
    '- No markdown, no asterisks, plain text only',
  ].filter(Boolean).join('\n');

  try {
    const raw = await callAI(systemMsg, userMsg, 220);
    const parsed = extractJSON(raw, 'object');
    res.json({
      headline: (parsed.headline || essential.name).toString().slice(0, 80),
      caption:  (parsed.caption  || '').toString().slice(0, 200),
      cta:      (parsed.cta      || 'Shop Now').toString().slice(0, 30),
      hashtags: Array.isArray(parsed.hashtags)
        ? parsed.hashtags.map(t => String(t).replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean).slice(0, 6)
        : [],
    });
  } catch (err) {
    console.error('[AI Post Creator /generate-copy]', err.message);
    res.status(500).json({ message: 'AI copy generation failed: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   POST /api/ai-post-creator/upload-creative
   Accepts a generated creative as a base64 data URL (produced client-side
   by <canvas>.toDataURL()) and stores it using the SAME storage strategy
   routes/upload.js already uses (Cloudinary if configured, else local disk
   under /uploads). No new storage system introduced.
══════════════════════════════════════════════════════════════════════════ */
const USE_CLOUDINARY =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY    &&
  process.env.CLOUDINARY_API_SECRET;

let cloudinary;
if (USE_CLOUDINARY) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

function localUrl(req, filename) {
  if (process.env.BACKEND_URL) {
    let base = process.env.BACKEND_URL.trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(base)) base = 'https://' + base;
    return `${base}/uploads/${filename}`;
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return `${proto}://${host}/uploads/${filename}`;
}

router.post('/upload-creative', async (req, res) => {
  try {
    const { dataUrl, format = 'png' } = req.body || {};
    if (!dataUrl || !/^data:image\/(png|jpe?g|webp);base64,/.test(dataUrl)) {
      return res.status(400).json({ message: 'A valid base64 image data URL is required' });
    }
    const safeFormat = ['png', 'jpg', 'jpeg', 'webp'].includes(format) ? format : 'png';
    const base64Data = dataUrl.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');

    // 10MB ceiling — same limit as routes/upload.js
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Creative is too large (max 10MB)' });
    }

    if (USE_CLOUDINARY) {
      const result = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'shopzen/ai-post-creator', public_id: `creative-${Date.now()}-${Math.round(Math.random() * 1e9)}`, format: safeFormat },
          (err, r) => (err ? reject(err) : resolve(r))
        );
        const { Readable } = require('stream');
        Readable.from(buffer).pipe(stream);
      });
      return res.json({ url: result.secure_url });
    }

    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `aipc-${Date.now()}-${Math.round(Math.random() * 1e9)}.${safeFormat}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    res.json({ url: localUrl(req, filename) });
  } catch (err) {
    console.error('[AI Post Creator /upload-creative]', err.message);
    res.status(500).json({ message: 'Failed to store creative: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   POST /api/ai-post-creator/generate-photoreal
   "Photoreal" template mode — OPT-IN, separate from the default flat-design
   canvas templates above. Uses image-to-image generation (the real product
   thumbnail is sent as an input image, not regenerated from scratch) via
   OpenRouter's Gemini "Nano Banana" image models, reusing the SAME
   OPENROUTER_API_KEY already configured for text generation. No new
   credential, no new SDK dependency — plain fetch, same as callOpenRouter()
   above.

   This is intentionally a SEPARATE, explicitly-triggered endpoint (not bundled
   into /generate-copy) because image generation has meaningfully higher cost
   and latency than the text endpoints — the frontend only calls this when the
   admin opts into "Photoreal" mode, never automatically.

   Returns a base64 PNG data URL the frontend can preview immediately and
   upload via the existing /upload-creative endpoint if the admin keeps it.
══════════════════════════════════════════════════════════════════════════ */
// Primary + fallback image models. OpenRouter periodically retires/renames
// model slugs (this is exactly what caused the original 404 — the
// "-preview" variant was promoted to GA and the preview slug removed from
// the catalog). If the primary slug ever 404s again, automatically retry
// once against the fallback rather than failing outright.
const PHOTOREAL_IMAGE_MODEL          = 'google/gemini-2.5-flash-image';
const PHOTOREAL_IMAGE_MODEL_FALLBACK = 'google/gemini-3.1-flash-image-preview';

const PHOTOREAL_TEMPLATE_BRIEF = {
  sale:        'a bold seasonal SALE promotion, energetic and value-focused',
  new_arrival: 'a premium NEW ARRIVAL launch moment, fresh and exciting',
  best_seller: 'a trusted BEST SELLER showcase, confident and popular',
  flash_sale:  'an urgent FLASH SALE countdown moment, high energy and time-pressured',
};

async function requestImageFromModel(model, { prompt, productImageUrl }) {
  const content = [{ type: 'text', text: prompt }];
  if (productImageUrl) {
    content.push({ type: 'image_url', image_url: { url: productImageUrl } });
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer':  process.env.FRONTEND_URL || 'https://shopzen.lk',
      'X-Title':       'ShopZen AI Post Creator - Photoreal',
    },
    body: JSON.stringify({
      model,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content }],
      image_config: { aspect_ratio: '4:5', image_size: '1K' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    const err = new Error(`Image model error ${res.status}: ${errText}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const images = data.choices?.[0]?.message?.images;
  const dataUrl = images?.[0]?.image_url?.url;
  if (!dataUrl) throw new Error('Image model returned no image — try again or adjust the prompt');
  return dataUrl;
}

async function callOpenRouterImage({ prompt, productImageUrl }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('Photoreal generation requires OPENROUTER_API_KEY to be set in your .env');
  }
  try {
    return await requestImageFromModel(PHOTOREAL_IMAGE_MODEL, { prompt, productImageUrl });
  } catch (err) {
    // Only fall back on "model unavailable"-type errors (404), not on
    // content/validation errors (4xx from a bad prompt) or auth errors.
    if (err.status === 404) {
      console.warn(`[AI Post Creator] "${PHOTOREAL_IMAGE_MODEL}" unavailable, retrying with fallback model`);
      return await requestImageFromModel(PHOTOREAL_IMAGE_MODEL_FALLBACK, { prompt, productImageUrl });
    }
    throw err;
  }
}

router.post('/generate-photoreal', async (req, res) => {
  const { name, category, brand, price, discount, template, badgeLabel, headline, productImageUrl, storeName } = req.body || {};

  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ message: 'Product name is required' });
  }
  if (!productImageUrl) {
    return res.status(400).json({ message: 'A product image is required for photoreal generation' });
  }

  const brief = PHOTOREAL_TEMPLATE_BRIEF[template] || 'a clean, professional e-commerce promotion';
  const discountLine = Number(discount) > 0 ? `Show a discount callout of "${Number(discount)}% OFF" as a bold tag/sticker in the scene.` : '';
  const priceLine = price ? `The product price (Rs. ${Number(price).toLocaleString()}) may appear as small text near the product, styled like premium packaging signage.` : '';

  const prompt = [
    `Create a professional, photorealistic e-commerce social media advertisement for this exact product (use the attached product photo as the real product — keep it recognizable and unaltered in shape/branding, only change the surrounding scene, lighting and composition).`,
    `Scene: ${brief}.`,
    `Style: realistic studio product photography, dramatic soft lighting, dark moody background with subtle depth-of-field bokeh, the product placed on a pedestal or clean surface, premium and modern, similar to a high-end e-commerce marketing banner.`,
    `Include bold, legible display typography for the headline "${headline || name}" integrated tastefully into the composition (not overlapping the product), and a small badge/sticker reading "${(badgeLabel || template || 'OFFER').toString().toUpperCase()}".`,
    discountLine,
    priceLine,
    `Include the store name "${storeName || 'ShopZen'}" somewhere subtle in the composition, styled like a logo wordmark.`,
    `Product: ${name}. ${brand ? `Brand: ${brand}.` : ''} ${category ? `Category: ${category}.` : ''}`,
    `Do not distort, mislabel, or alter the actual product packaging text — only the surrounding scene and added marketing text should be generated.`,
    `Vertical social-media-ready composition, high resolution, no watermarks.`,
  ].filter(Boolean).join(' ');

  try {
    const dataUrl = await callOpenRouterImage({ prompt, productImageUrl });
    res.json({ dataUrl });
  } catch (err) {
    console.error('[AI Post Creator /generate-photoreal]', err.message);
    res.status(500).json({ message: 'Photoreal generation failed: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   ████████████████████████████████████████████████████████████████████████
   TEMPLATE MODE — standalone, server-side PNG-template generation flow
   ████████████████████████████████████████████████████████████████████████

   generationMode: "template" (vs the existing "ai" flow above, which is
   left completely untouched). This section:
     - never imports from, calls, or mutates anything in the AI flow above
       (callAI / callOpenRouter / generate-photoreal / etc.)
     - uses its own isolated rendering engine: services/templateRenderer.js
       (Sharp-based compositing, no node-canvas dependency)
     - background removal happens CLIENT-SIDE in the browser via
       @imgly/background-removal (WASM) — the frontend sends the already
       background-removed PNG cutout here as a base64 data URL; this
       endpoint never calls any background-removal library itself
     - template backgrounds + position configs live in
       backend/templates/assets/*.png and backend/templates/configs/*.json,
       loaded via templateRenderer.listTemplates()/getTemplateConfig()

   Endpoints:
     GET  /api/ai-post-creator/templates              → list available
                                                          templates (id,
                                                          label, thumbnail)
     GET  /api/ai-post-creator/templates/:id/thumbnail → serves the raw
                                                          template PNG so
                                                          the picker UI can
                                                          show real previews
     POST /api/ai-post-creator/generate-template       → { dataUrl } a
                                                          rendered 1080x1080
                                                          PNG composited from
                                                          the chosen template
                                                          + product cutout +
                                                          form data
══════════════════════════════════════════════════════════════════════════ */
const {
  renderTemplate: renderTemplateMode,
  listTemplates: listTemplateModeTemplates,
  getTemplateAssetPath: getTemplateModeAssetPath,
} = require('../services/templateRenderer');

/* ══════════════════════════════════════════════════════════════════════════
   POST /api/ai-post-creator/remove-background
   Server-side background removal using sharp — no external API needed.
   Accepts: { imageUrl } — relative (/uploads/...) or absolute Cloudinary URL.
   Returns: { dataUrl } — PNG with transparent background as base64 data URL.

   Algorithm: border-colour flood-fill masking
     1. Sample all border pixels to estimate the background colour.
     2. Remove only similar pixels connected to the image border.
     3. Protect the main subject's enclosed light/white surfaces.
     4. Keep the main opaque component and encode a transparent PNG.
══════════════════════════════════════════════════════════════════════════ */
router.post('/remove-background', async (req, res) => {
  try {
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ message: 'imageUrl is required' });

    let inputBuffer;

    // Detect URLs that point back at OUR OWN server (e.g.
    // https://<this-backend>.up.railway.app/uploads/xyz.jpg). In production
    // these used to be re-fetched over the public internet, which can come
    // back as "HTTP 403 fetching image" depending on the platform's edge/
    // proxy behaviour. Since these files live on our own disk, read them
    // directly — same as the existing local /uploads/... branch — and skip
    // the network round-trip entirely. Only genuinely external URLs (e.g.
    // Cloudinary) go over HTTP.
    const path = require('path');
    const fs = require('fs');
    const uploadsDir = path.join(__dirname, '../uploads');

    function localUploadsPathFor(url) {
      try {
        const u = new URL(url, 'http://placeholder.local');
        if (!u.pathname.startsWith('/uploads/')) return null;
        const filename = u.pathname.replace(/^\/uploads\//, '');
        return path.join(uploadsDir, filename);
      } catch {
        return null;
      }
    }

    const isAbsoluteUrl = imageUrl.startsWith('http://') || imageUrl.startsWith('https://');
    const ownServerPath = isAbsoluteUrl ? localUploadsPathFor(imageUrl) : null;

    // TEMP DIAGNOSTIC LOGGING — remove once the 403 cause is confirmed.
    console.log(`[remove-background] imageUrl received: ${imageUrl}`);
    console.log(`[remove-background] branch: ${ownServerPath ? 'own-server-disk' : isAbsoluteUrl ? 'external-http' : 'relative-disk'}`);

    if (ownServerPath) {
      // Absolute URL, but it's our own /uploads/... file — read from disk.
      if (!fs.existsSync(ownServerPath)) {
        return res.status(404).json({ message: `Image file not found: ${path.basename(ownServerPath)}` });
      }
      inputBuffer = fs.readFileSync(ownServerPath);
    } else if (isAbsoluteUrl) {
      // Genuinely external URL (e.g. Cloudinary) — fetch with Node built-in
      // https, following redirects (Cloudinary can redirect between hosts).
      inputBuffer = await new Promise((resolve, reject) => {
        function doFetch(url, redirectsLeft) {
          const mod = url.startsWith('https') ? require('https') : require('http');
          const req = mod.get(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ShopzenBot/1.0; +backend-image-fetch)',
              'Accept': 'image/*'
            }
          }, resp => {
            console.log(`[remove-background] fetch status ${resp.statusCode} for ${url}`);
            if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location && redirectsLeft > 0) {
              resp.resume(); // discard body
              const nextUrl = new URL(resp.headers.location, url).toString();
              console.log(`[remove-background] following redirect to ${nextUrl}`);
              return doFetch(nextUrl, redirectsLeft - 1);
            }
            if (resp.statusCode !== 200) {
              console.log(`[remove-background] non-200 response headers:`, resp.headers);
              return reject(new Error(`HTTP ${resp.statusCode} fetching image`));
            }
            const chunks = [];
            resp.on('data', c => chunks.push(c));
            resp.on('end', () => resolve(Buffer.concat(chunks)));
            resp.on('error', reject);
          });
          req.on('error', err => {
            console.log(`[remove-background] request error:`, err.message);
            reject(err);
          });
        }
        doFetch(imageUrl, 5);
      });
    } else {
      // Relative /uploads/... — read directly from disk, no HTTP round-trip
      const rel = imageUrl.startsWith('/') ? imageUrl : '/' + imageUrl;
      const filename = rel.replace(/^\/uploads\//, '');
      const localPath = path.join(uploadsDir, filename);
      if (!fs.existsSync(localPath)) {
        return res.status(404).json({ message: `Image file not found: ${filename}` });
      }
      inputBuffer = fs.readFileSync(localPath);
    }

    // Decode to raw RGBA
    const pipeline = sharp(inputBuffer).ensureAlpha();
    const { width, height } = await pipeline.clone().metadata();
    const rawBuf = await pipeline.raw().toBuffer();

    const stride = 4; // RGBA bytes per pixel
    const out = Buffer.from(rawBuf);

    // ── Helpers ────────────────────────────────────────────────────────────
    function getPixel(x, y) {
      const o = (y * width + x) * stride;
      return { r: out[o], g: out[o + 1], b: out[o + 2], a: out[o + 3] };
    }
    function colorDist(a, b) {
      return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
    }

    // ── Step 1: determine background colour from ALL border pixels (median) ─
    // Sampling the entire border (not just 4 corners) gives a much more
    // reliable background estimate, especially when a product touches a corner.
    const borderSamples = [];
    for (let x = 0; x < width; x++) {
      borderSamples.push(getPixel(x, 0));
      borderSamples.push(getPixel(x, height - 1));
    }
    for (let y = 1; y < height - 1; y++) {
      borderSamples.push(getPixel(0, y));
      borderSamples.push(getPixel(width - 1, y));
    }
    const sortedR = borderSamples.map(p => p.r).sort((a, b) => a - b);
    const sortedG = borderSamples.map(p => p.g).sort((a, b) => a - b);
    const sortedB = borderSamples.map(p => p.b).sort((a, b) => a - b);
    const mid = Math.floor(borderSamples.length / 2);
    const bg = { r: sortedR[mid], g: sortedG[mid], b: sortedB[mid] };

    // ── Step 2: BFS flood-fill from ALL border pixels ─────────────────────
    // Only pixels reachable FROM THE BORDER that are within TOLERANCE of the
    // bg colour are marked as background. This is the critical difference vs
    // the old per-pixel scan:
    //   • Product text/labels in the centre of the image: NOT reached by the
    //     flood-fill → preserved, even if they happen to be a similar colour.
    //   • Text printed on the background region (e.g. captions around the
    //     product): IS reached because BFS walks through surrounding bg pixels
    //     and text pixels close to bg colour are included in the removal zone.
    const TOLERANCE = 55; // colour distance 0–441; handles anti-aliased edges
    const visited = new Uint8Array(width * height); // 1 = background pixel
    const queue   = [];

    function tryEnqueue(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const idx = y * width + x;
      if (visited[idx]) return;
      const p = getPixel(x, y);
      if (colorDist(p, bg) < TOLERANCE) {
        visited[idx] = 1;
        queue.push(idx);
      }
    }

    for (let x = 0; x < width; x++) { tryEnqueue(x, 0); tryEnqueue(x, height - 1); }
    for (let y = 1; y < height - 1; y++) { tryEnqueue(0, y); tryEnqueue(width - 1, y); }

    // BFS — 4-connected neighbours
    let qi = 0;
    while (qi < queue.length) {
      const idx = queue[qi++];
      const x = idx % width;
      const y = (idx / width) | 0;
      tryEnqueue(x - 1, y); tryEnqueue(x + 1, y);
      tryEnqueue(x, y - 1); tryEnqueue(x, y + 1);
    }

    // White products photographed on white backgrounds need one extra guard:
    // a colour-only flood can leak through a tiny anti-aliased opening and
    // erase a white panel inside the subject. Restore background-coloured
    // pixels that are enclosed by foreground on both axes. This preserves the
    // white body of phones, chargers and appliances while edge-connected
    // studio background remains removable.
    // Identify the largest non-background component first, so unrelated text
    // or offer badges cannot create a protected rectangle across the image.
    const subjectLabels = new Int32Array(width * height).fill(-1);
    let subjectLabel = 0;
    let largestSubjectLabel = -2;
    let largestSubjectSize = 0;
    for (let start = 0; start < width * height; start++) {
      if (visited[start] || subjectLabels[start] !== -1) continue;
      const componentQueue = [start];
      subjectLabels[start] = subjectLabel;
      let componentIndex = 0;
      while (componentIndex < componentQueue.length) {
        const idx = componentQueue[componentIndex++];
        const x = idx % width;
        const y = (idx / width) | 0;
        const neighbours = [x - 1, y, x + 1, y, x, y - 1, x, y + 1];
        for (let n = 0; n < neighbours.length; n += 2) {
          const nx = neighbours[n], ny = neighbours[n + 1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (visited[next] || subjectLabels[next] !== -1) continue;
          subjectLabels[next] = subjectLabel;
          componentQueue.push(next);
        }
      }
      if (componentQueue.length > largestSubjectSize) {
        largestSubjectSize = componentQueue.length;
        largestSubjectLabel = subjectLabel;
      }
      subjectLabel++;
    }

    const rowLeft = new Int32Array(height).fill(width);
    const rowRight = new Int32Array(height).fill(-1);
    const colTop = new Int32Array(width).fill(height);
    const colBottom = new Int32Array(width).fill(-1);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (subjectLabels[idx] !== largestSubjectLabel) continue;
        if (x < rowLeft[y]) rowLeft[y] = x;
        if (x > rowRight[y]) rowRight[y] = x;
        if (y < colTop[x]) colTop[x] = y;
        if (y > colBottom[x]) colBottom[x] = y;
      }
    }

    // Bridge only small breaks in the subject outline (camera notches,
    // handles, anti-aliased seams). This prevents a narrow opening from
    // invalidating an otherwise enclosed white surface without allowing
    // distant badges or text to influence the mask.
    const bridgeRadius = Math.max(8, Math.min(18, Math.round(Math.min(width, height) / 55)));
    const protectedRowLeft = new Int32Array(rowLeft);
    const protectedRowRight = new Int32Array(rowRight);
    const protectedColTop = new Int32Array(colTop);
    const protectedColBottom = new Int32Array(colBottom);
    for (let y = 0; y < height; y++) {
      for (let offset = -bridgeRadius; offset <= bridgeRadius; offset++) {
        const sourceY = y + offset;
        if (sourceY < 0 || sourceY >= height) continue;
        protectedRowLeft[y] = Math.min(protectedRowLeft[y], rowLeft[sourceY]);
        protectedRowRight[y] = Math.max(protectedRowRight[y], rowRight[sourceY]);
      }
    }
    for (let x = 0; x < width; x++) {
      for (let offset = -bridgeRadius; offset <= bridgeRadius; offset++) {
        const sourceX = x + offset;
        if (sourceX < 0 || sourceX >= width) continue;
        protectedColTop[x] = Math.min(protectedColTop[x], colTop[sourceX]);
        protectedColBottom[x] = Math.max(protectedColBottom[x], colBottom[sourceX]);
      }
    }
    for (let y = 1; y < height - 1; y++) {
      if (protectedRowRight[y] - protectedRowLeft[y] < 4) continue;
      for (let x = protectedRowLeft[y] + 1; x < protectedRowRight[y]; x++) {
        const idx = y * width + x;
        if (!visited[idx]) continue;
        if (protectedColBottom[x] - protectedColTop[x] < 4) continue;
        if (y > protectedColTop[x] && y < protectedColBottom[x]) visited[idx] = 0;
      }
    }

    // ── Step 3: apply transparency to flood-filled (background) pixels ─────
    // Smooth alpha fade at the colour-distance boundary = anti-aliased edges.
    for (let i = 0; i < width * height; i++) {
      if (!visited[i]) continue;
      const o = i * stride;
      const p = { r: out[o], g: out[o + 1], b: out[o + 2] };
      const d = colorDist(p, bg);
      const alpha = Math.round((d / TOLERANCE) * 255);
      out[o + 3] = Math.min(out[o + 3], alpha);
    }

    // ── Step 4: keep ONLY the largest opaque blob (main product) ──────────
    // After flood-fill, badges, logos, and other elements that were enclosed
    // by background pixels remain as isolated opaque islands (e.g. a Qi2
    // badge, a brand badge, shadow ellipses). We find every connected
    // component of still-opaque pixels, identify the LARGEST one (which is
    // always the main product silhouette), and erase everything else.
    // No arbitrary size threshold needed — largest-wins is reliable.

    const labeled = new Int32Array(width * height).fill(-1);
    let   label   = 0;
    const compPixels = []; // compPixels[label] = array of pixel indices in that component

    for (let start = 0; start < width * height; start++) {
      const so = start * stride;
      if (out[so + 3] < 20)       continue; // already transparent — skip
      if (labeled[start] !== -1) continue; // already part of a component

      // BFS for this opaque component
      const comp = [start];
      labeled[start] = label;
      let ci = 0;
      while (ci < comp.length) {
        const idx = comp[ci++];
        const cx  = idx % width;
        const cy  = (idx / width) | 0;
        const neighbours = [cx - 1, cy, cx + 1, cy, cx, cy - 1, cx, cy + 1];
        for (let ni = 0; ni < neighbours.length; ni += 2) {
          const nx = neighbours[ni], ny = neighbours[ni + 1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nidx = ny * width + nx;
          if (labeled[nidx] !== -1) continue;
          const no = nidx * stride;
          if (out[no + 3] < 20) continue; // transparent — not in this component
          labeled[nidx] = label;
          comp.push(nidx);
        }
      }
      compPixels[label] = comp;
      label++;
    }

    // Find the label with the most pixels = main product
    let largestLabel = -1;
    let largestSize  = 0;
    for (let l = 0; l < label; l++) {
      if (compPixels[l].length > largestSize) {
        largestSize  = compPixels[l].length;
        largestLabel = l;
      }
    }

    // Erase every component that is NOT the main product (badges, logos, shadows)
    for (let i = 0; i < width * height; i++) {
      const lbl = labeled[i];
      if (lbl === -1) continue;           // already transparent
      if (lbl === largestLabel) continue; // main product — keep
      const o = i * stride;
      out[o + 3] = 0;
    }

    // ── Step 5: encode and return ──────────────────────────────────────────
    const resultBuf = await sharp(out, { raw: { width, height, channels: 4 } })
      .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
      .png({ compressionLevel: 6 })
      .toBuffer();

    res.json({ dataUrl: `data:image/png;base64,${resultBuf.toString('base64')}` });

  } catch (err) {
    console.error('[remove-background]', err.message, '| imageUrl:', req.body?.imageUrl);
    res.status(500).json({ message: err.message });
  }
});

router.get('/templates', (req, res) => {
  try {
    res.json({ templates: listTemplateModeTemplates() });
  } catch (err) {
    console.error('[AI Post Creator /templates]', err.message);
    res.status(500).json({ message: err.message });
  }
});

router.get('/templates/:id/thumbnail', (req, res) => {
  try {
    const assetPath = getTemplateModeAssetPath(req.params.id);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    require('fs').createReadStream(assetPath).pipe(res);
  } catch (err) {
    res.status(404).json({ message: err.message });
  }
});

router.get('/product-offers/:productId', async (req, res) => {
  try {
    const product = await Product.findOne({ _id: req.params.productId, isActive: true })
      .populate('category', 'name')
      .lean();
    if (!product) return res.status(404).json({ message: 'Product not found or inactive' });

    const pricing = getAuthoritativeProductPricing(product);
    const vouchers = await getAdvertisableProductVouchers(product);
    res.json({ pricing, vouchers, recommendedVoucherCode: vouchers[0]?.code || '' });
  } catch (err) {
    console.error('[AI Post Creator /product-offers]', err.message);
    res.status(500).json({ message: 'Product offers could not be loaded: ' + err.message });
  }
});

// Deterministic product-aware copy for Template Mode. Only exact product
// fields, specifications marked Verified for marketing, and configured
// available variants are included, so captions cannot invent details.
router.post('/generate-template-copy', async (req, res) => {
  try {
    const { productId, ctaType='shop_now', voucherCode='auto' } = req.body || {};
    if (!productId) return res.status(400).json({ message: 'Select a product first' });
    if (!['none', 'shop_now', 'whatsapp'].includes(ctaType)) return res.status(400).json({ message: 'Choose a valid action button' });

    const product = await Product.findOne({ _id: productId, isActive: true }).populate('category', 'name').lean();
    if (!product) return res.status(404).json({ message: 'Product not found or inactive' });

    const contact = await getPublicStoreContact();
    const productUrl = `${contact.siteUrl}/product/${product.slug}`;
    const whatsappUrl = `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent(`Hi ${contact.storeName}, I am interested in ${product.name}. ${productUrl}`)}`;
    const pricing = getAuthoritativeProductPricing(product);
    const requestedVoucher = cleanText(voucherCode, 80).toUpperCase();
    const availableVouchers = requestedVoucher === 'NONE'
      ? await getAdvertisableProductVouchers(product)
      : await getAdvertisableProductVouchers(product, requestedVoucher === 'AUTO' ? '' : requestedVoucher);
    if (requestedVoucher && !['AUTO', 'NONE'].includes(requestedVoucher) && !availableVouchers.length) {
      return res.status(400).json({ message: `Voucher ${requestedVoucher} is no longer valid for this product.` });
    }
    const selectedVoucher = requestedVoucher === 'NONE' ? null : availableVouchers[0] || null;
    const verifiedSpecs = getConfiguredMarketingFeatures(product);
    const category = cleanText(product.category?.name || product.subCategory, 80);
    // Keep the small creative subtitle distinct from the feature bullets.
    // Repeating the first specification here made otherwise polished layouts
    // look like duplicated catalog data.
    const shortDescription = category
      ? `Explore ${category} at ${contact.storeName}`.slice(0, 140)
      : '';
    const tags = [...new Set([
      hashtag(product.brand), hashtag(category), hashtag(product.name.split(/\s+/).slice(0, 2).join(' ')),
      'ShopZenLK', 'SriLanka', 'OnlineShopping',
    ].filter(Boolean))].slice(0, 6);

    const lines = [];
    if (selectedVoucher) lines.push(`🎉🔥 ${selectedVoucher.label} WITH VOUCHER! 🔥🎉`, '');
    else if (pricing.isProductSale) lines.push(`🎉🔥 ${pricing.productSalePercent}% OFF SALE! 🔥🎉`, '');
    lines.push(`⚡ ${cleanText(product.name, 220)}`);
    if (selectedVoucher?.priceAfterVoucher != null) {
      lines.push(`💥 Price After Voucher: Rs. ${formatLkr(selectedVoucher.priceAfterVoucher)}`);
      if (pricing.isProductSale) lines.push(`🏷️ Current Sale Price: Rs. ${formatLkr(pricing.sellingPrice)}`);
      else lines.push(`🏷️ Current Price: Rs. ${formatLkr(pricing.sellingPrice)}`);
      if (pricing.isProductSale) lines.push(`Regular Price: Rs. ${formatLkr(pricing.regularPrice)}`);
    } else if (pricing.isProductSale) {
      lines.push(`💥 Now Only: Rs. ${formatLkr(pricing.sellingPrice)}`, `Regular Price: Rs. ${formatLkr(pricing.regularPrice)}`);
    } else {
      lines.push(`💰 Price: Rs. ${formatLkr(pricing.sellingPrice)}`);
    }
    if (product.brand) lines.push('', `🏷️ Brand: ${cleanText(product.brand, 80)}`);
    if (verifiedSpecs.length) {
      lines.push('', '✅ Verified Product Details:');
      verifiedSpecs.forEach(spec => lines.push(`✅ ${spec.key}: ${spec.value}`));
    }
    if (selectedVoucher) {
      lines.push('', '🎟️ Use Voucher Code:', selectedVoucher.code, `🎁 Voucher Benefit: ${selectedVoucher.label}`);
      if (selectedVoucher.minOrderAmount > 0) lines.push(`🧾 Minimum Eligible Order: Rs. ${formatLkr(selectedVoucher.minOrderAmount)}`);
      if (selectedVoucher.maxDiscount > 0 && selectedVoucher.type === 'percentage') lines.push(`ℹ️ Maximum Voucher Discount: Rs. ${formatLkr(selectedVoucher.maxDiscount)}`);
      if (selectedVoucher.userLimit > 0) lines.push(`👤 Usage Limit: ${selectedVoucher.userLimit} time${selectedVoucher.userLimit === 1 ? '' : 's'} per customer`);
      if (selectedVoucher.requiresMultipleItems) lines.push(`ℹ️ This voucher requires an eligible order of at least Rs. ${formatLkr(selectedVoucher.minOrderAmount)}; no one-item after-voucher price is claimed.`);
    }
    lines.push('', ctaType === 'whatsapp' ? '📲 Order via WhatsApp' : '🛒 Shop Now', ctaType === 'whatsapp' ? whatsappUrl : productUrl);
    if (ctaType !== 'whatsapp') lines.push('', '📲 WhatsApp Orders', whatsappUrl);
    lines.push(`☎️ ${localPhone(contact.whatsappNumber)}`, '', '🚚 Islandwide Delivery', '🔒 Secure Checkout', '', tags.map(tag => `#${tag}`).join(' '));

    res.json({
      description: shortDescription,
      caption: lines.join('\n'),
      features: verifiedSpecs.map(spec => `${spec.key}: ${spec.value}`).slice(0, 6),
      hashtags: tags,
      productUrl,
      whatsappUrl,
      pricing,
      availableVouchers,
      selectedVoucher,
      offerSnapshot: {
        regularPrice: pricing.regularPrice,
        sellingPrice: pricing.sellingPrice,
        productSalePercent: pricing.productSalePercent,
        voucherCode: selectedVoucher?.code || '',
        voucherDiscountAmount: selectedVoucher?.discountAmount || 0,
      },
    });
  } catch (err) {
    console.error('[AI Post Creator /generate-template-copy]', err.message);
    res.status(500).json({ message: 'Product description could not be generated: ' + err.message });
  }
});

router.post('/generate-template', async (req, res) => {
  try {
    const {
      templateId,
      productImageDataUrl, // background-removed PNG cutout from /remove-background
      name, price, originalPrice, discount, cta, description,
      badge, brand, productBrand, category, whatsapp, website, features,
      logoImageDataUrl, logoText, tagline, layout,
    } = req.body || {};

    if (!templateId) {
      return res.status(400).json({ message: 'templateId is required' });
    }
    if (!name || String(name).trim().length < 2) {
      return res.status(400).json({ message: 'Product name is required' });
    }
    if (!productImageDataUrl || !/^data:image\/png;base64,/.test(productImageDataUrl)) {
      return res.status(400).json({ message: 'A background-removed product image (PNG data URL) is required' });
    }

    const base64Data = productImageDataUrl.split(',')[1];
    const productImageBuffer = Buffer.from(base64Data, 'base64');

    // 10MB ceiling — consistent with /upload-creative below
    if (productImageBuffer.length > 10 * 1024 * 1024) {
      return res.status(400).json({ message: 'Product image is too large (max 10MB)' });
    }
    if (layout && JSON.stringify(layout).length > 200000) {
      return res.status(400).json({ message: 'Customized template layout is too large' });
    }

    const logoImageBuffer = decodeLogoDataUrl(logoImageDataUrl);
    const pngBuffer = await renderTemplateMode(templateId, {
      productImageBuffer,
      logoImageBuffer,
      layout,
      logoText: logoText ? String(logoText).trim().slice(0, 30) : '',
      tagline: tagline ? String(tagline).trim().slice(0, 50) : '',
      name: String(name).trim().slice(0, 120),
      price: Number(price) || 0,
      originalPrice: Number(originalPrice) || 0,
      discount: Number(discount) || 0,
      cta: cta ? String(cta).trim().slice(0, 30) : 'Shop Now',
      description: description ? String(description).trim().slice(0, 140) : '',
      badge: badge ? String(badge).trim().slice(0, 30) : '',
      brand: brand ? String(brand).trim().slice(0, 60) : '',
      productBrand: productBrand ? String(productBrand).trim().slice(0, 60) : '',
      category: category ? String(category).trim().slice(0, 80) : '',
      whatsapp: whatsapp ? String(whatsapp).trim().slice(0, 30) : '',
      website: website ? String(website).trim().slice(0, 60) : '',
      features: Array.isArray(features) ? features.map(value => String(value).trim().slice(0, 80)).filter(Boolean).slice(0, 6) : [],
    });

    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    res.json({ dataUrl });
  } catch (err) {
    console.error('[AI Post Creator /generate-template]', err.message);
    res.status(500).json({ message: 'Template generation failed: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   GET /api/ai-post-creator/connected-platforms
   Reads the EXISTING SocialMedia settings document (no new collection) and
   returns only which of the 5 already-integrated platforms are connected +
   enabled, so the publish dropdown only ever shows real, usable options.
   Shared by BOTH AI Mode and Template Mode — read-only, no mode-specific
   logic, so isolation between the two flows is unaffected.
══════════════════════════════════════════════════════════════════════════ */
const SUPPORTED_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'telegram'];

router.get('/connected-platforms', async (req, res) => {
  try {
    const doc = await getOrCreate();
    const plain = doc.toObject ? doc.toObject() : doc;
    const platforms = SUPPORTED_PLATFORMS
      .map(p => ({
        platform:    p,
        connected:   !!plain[p]?.connected,
        enabled:     !!plain[p]?.enabled,
        accountName: plain[p]?.accountName || '',
      }))
      .filter(p => p.connected && p.enabled);
    res.json({ platforms });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   POST /api/ai-post-creator/publish
   Publishes a generated creative directly, using the SAME platform
   publisher modules (services/publishers/*) that services/publisherService.js
   already uses for every other publish flow. Bypasses postComposer.js on
   purpose — the creative + caption are already fully composed client-side
   by the AI Post Creator UI, so we hand the publisher exactly the payload
   shape it already expects: { text, imageUrl, imageUrls, productUrl }.
   Every publish attempt is logged into the SAME PublishLog collection used
   elsewhere, with entityType 'custom' so it's clearly distinguishable in
   existing publish-history views without altering their query logic.
══════════════════════════════════════════════════════════════════════════ */
const PUBLISHERS = {
  facebook:  require('../services/publishers/facebook'),
  instagram: require('../services/publishers/instagram'),
  tiktok:    require('../services/publishers/tiktok'),
  whatsapp:  require('../services/publishers/whatsapp'),
  telegram:  require('../services/publishers/telegram'),
};

async function publishCreativeToPlatform({ platform, imageUrl, caption, productUrl, productName, productId, ctaType, ctaUrl, adminId }) {
  const t0 = Date.now();
  const base = {
    trigger:     'manual',
    triggeredBy: `admin:${adminId || 'unknown'}`,
    platform,
    entityType:  'custom',
    entityId:    productId || null,
    entityName:  productName || 'AI Post Creator creative',
    ctaType,
    ctaUrl,
    attemptNumber: 1,
    isRetry: false,
  };

  try {
    const doc = await getOrCreate();
    const raw = JSON.parse(JSON.stringify(doc[platform]?.toObject?.({ virtuals: false }) ?? doc[platform] ?? {}));
    const creds = decryptPlatformFields(raw);
    if (!creds.connected) throw new Error(`${platform} is not connected. Connect it in Social Media settings first.`);
    if (!creds.enabled)   throw new Error(`${platform} is currently disabled in Social Media settings.`);

    const payload = {
      text:       caption || '',
      imageUrl,
      imageUrls:  [imageUrl],
      productUrl: productUrl || '',
      ctaType,
      ctaUrl,
    };

    const result = await PUBLISHERS[platform].publish(creds, payload);

    const log = await PublishLog.create({
      ...base,
      postText:       payload.text,
      imageUrl:       payload.imageUrl,
      status:         'success',
      platformPostId: result.platformPostId || '',
      durationMs:     Date.now() - t0,
    });

    return { platform, success: true, platformPostId: result.platformPostId || '', logId: log._id };
  } catch (err) {
    console.error(`[AI Post Creator /publish] ${platform} error:`, err.message);
    await PublishLog.create({
      ...base,
      postText:     caption || '',
      imageUrl:     imageUrl || '',
      status:       'failed',
      errorMessage: err.message,
      errorCode:    'AI_POST_CREATOR_ERROR',
      durationMs:   Date.now() - t0,
    });
    return { platform, success: false, message: err.message };
  }
}

router.post('/publish', async (req, res) => {
  const { platform, platforms, imageUrl, caption, productUrl: suppliedProductUrl, productName, productId } = req.body || {};
  const requested = [...new Set((Array.isArray(platforms) ? platforms : [platform]).filter(Boolean))];
  const ctaType = String(req.body?.ctaType || 'none').toLowerCase();
  const voucherCode = cleanText(req.body?.voucherCode, 80).toUpperCase();
  const offerSnapshot = req.body?.offerSnapshot && typeof req.body.offerSnapshot === 'object'
    ? req.body.offerSnapshot
    : null;

  if (!requested.length || requested.some(value => !SUPPORTED_PLATFORMS.includes(value))) {
    return res.status(400).json({ message: 'Select one or more supported platforms' });
  }
  if (!['none', 'shop_now', 'whatsapp'].includes(ctaType)) {
    return res.status(400).json({ message: 'Choose a valid Shop Now or WhatsApp action' });
  }
  if (!imageUrl) {
    return res.status(400).json({ message: 'imageUrl is required — generate and upload the creative first' });
  }

  try {
    const contact = await getPublicStoreContact();
    const product = productId ? await Product.findOne({ _id: productId, isActive: true })
      .select('name slug price salePrice costPrice category subCategory brand thumbnail')
      .lean() : null;
    if (productId && !product) return res.status(404).json({ message: 'Selected product was not found or is inactive' });
    let currentPricing = null;
    let currentVoucher = null;
    if (product && offerSnapshot) {
      currentPricing = getAuthoritativeProductPricing(product);
      const samePrice = Math.abs(Number(offerSnapshot.regularPrice) - currentPricing.regularPrice) < 0.01
        && Math.abs(Number(offerSnapshot.sellingPrice) - currentPricing.sellingPrice) < 0.01;
      if (!samePrice) {
        return res.status(409).json({ message: 'The product price changed after this description was generated. Generate the Social Media Description again before publishing.' });
      }
      if (voucherCode) {
        const currentVouchers = await getAdvertisableProductVouchers(product, voucherCode);
        currentVoucher = currentVouchers[0];
        if (!currentVoucher) {
          return res.status(409).json({ message: `Voucher ${voucherCode} is no longer valid for this product. Generate the Social Media Description again.` });
        }
        if (String(offerSnapshot.voucherCode || '').toUpperCase() !== currentVoucher.code
          || Math.abs(Number(offerSnapshot.voucherDiscountAmount || 0) - Number(currentVoucher.discountAmount || 0)) >= 0.01) {
          return res.status(409).json({ message: `Voucher ${voucherCode} changed after this description was generated. Generate it again before publishing.` });
        }
        if (!String(caption || '').toUpperCase().includes(currentVoucher.code)) {
          return res.status(400).json({ message: `The Social Media Description must include voucher code ${currentVoucher.code}.` });
        }
      }
      const missingOfferFacts = missingOfferFactsFromCaption(caption, currentPricing, currentVoucher);
      if (missingOfferFacts.length) {
        return res.status(400).json({
          message: `The Social Media Description is missing verified offer details: ${missingOfferFacts.join(', ')}. Generate it again before publishing.`,
        });
      }
    }
    const productUrl = product?.slug ? `${contact.siteUrl}/product/${product.slug}` : String(suppliedProductUrl || '');
    if (ctaType === 'shop_now' && !/^https:\/\//i.test(productUrl)) return res.status(400).json({ message: 'Shop Now requires a public product URL' });
    const whatsappUrl = `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent(`Hi ${contact.storeName}, I am interested in ${product?.name || productName || 'this product'}. ${productUrl}`)}`;
    const ctaUrl = ctaType === 'shop_now' ? productUrl : ctaType === 'whatsapp' ? whatsappUrl : '';
    let finalCaption = String(caption || '').trim().slice(0, 5000);
    if (productUrl && !finalCaption.includes(productUrl)) finalCaption += `${finalCaption ? '\n\n' : ''}🛒 ${productUrl}`;
    if (ctaType === 'whatsapp' && !finalCaption.includes('wa.me/')) finalCaption += `${finalCaption ? '\n\n' : ''}📲 ${whatsappUrl}`;

    const args = { imageUrl, caption: finalCaption, productUrl, productName: product?.name || productName, productId: product?._id || null, ctaType, ctaUrl, adminId: req.user?._id || req.user?.id };
    const results = await Promise.all(requested.map(selectedPlatform =>
      publishCreativeToPlatform({ ...args, platform: selectedPlatform })
    ));
    const succeeded = results.filter(result => result.success).length;
    const failed = results.length - succeeded;
    if (requested.length === 1 && failed) return res.status(500).json({ success: false, message: results[0].message, results, succeeded, failed });
    res.json({ success: failed === 0, results, succeeded, failed });
  } catch (err) {
    console.error('[AI Post Creator /publish]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


/* ══════════════════════════════════════════════════════════════════════════
   SAVED PRESETS — localStorage-synced on the client and persistently stored
   in MongoDB per admin, so customized layouts survive browser clears,
   deployments and device changes.
══════════════════════════════════════════════════════════════════════════ */
/**
 * GET /api/ai-post-creator/presets
 * Returns all saved presets for the current admin.
 */
router.get('/presets', async (req, res) => {
  try {
    const userId  = req.user?._id || req.user?.id || 'default';
    const presets = await AIPostPreset.find({ userId: String(userId) }).sort({ updatedAt: -1 }).limit(30).lean();
    res.json({ presets });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * POST /api/ai-post-creator/presets
 * Body: { name: string, data: object }
 * Saves a new named preset. Returns the full updated list.
 */
router.post('/presets', async (req, res) => {
  try {
    const userId  = req.user?._id || req.user?.id || 'default';
    const { name, data } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ message: 'Preset name is required' });
    }
    const cleanName = String(name).trim().slice(0, 60);
    if (JSON.stringify(data || {}).length > 3 * 1024 * 1024) return res.status(400).json({ message: 'Preset data is too large' });
    const preset = await AIPostPreset.findOneAndUpdate(
      { userId: String(userId), name: cleanName },
      { $set: { data: data || {}, id: Date.now() } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    const presets = await AIPostPreset.find({ userId: String(userId) }).sort({ updatedAt: -1 }).limit(30).lean();
    res.json({ preset, presets });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * DELETE /api/ai-post-creator/presets/:id
 * Deletes a preset by its numeric id.
 */
router.delete('/presets/:id', async (req, res) => {
  try {
    const userId  = req.user?._id || req.user?.id || 'default';
    const id = Number(req.params.id);
    await AIPostPreset.deleteOne({ userId: String(userId), id });
    const presets = await AIPostPreset.find({ userId: String(userId) }).sort({ updatedAt: -1 }).limit(30).lean();
    res.json({ deleted: true, presets });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
