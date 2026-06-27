/**
 * metaCAPI.js — Meta Conversions API (server-side pixel events)
 *
 * Sends events directly from the backend to Meta's CAPI endpoint so they
 * are never lost to ad blockers, browser privacy settings, or Safari ITP.
 *
 * Architecture:
 *  - Browser pixel fires the event (browser-side deduplication key: eventId)
 *  - CAPI fires the same event with the same eventId
 *  - Meta uses eventId to deduplicate — one conversion is counted, not two
 *  - Advanced Matching: hashed customer data is sent with every event
 *
 * Required env vars:
 *   META_PIXEL_ID         — your pixel ID (e.g. 1764180684568490)
 *   META_CAPI_ACCESS_TOKEN — system user access token from Meta Events Manager
 *
 * Optional:
 *   META_TEST_EVENT_CODE  — e.g. TEST36398  (only set in dev/staging)
 *
 * Reference: https://developers.facebook.com/docs/marketing-api/conversions-api
 */

const crypto = require('crypto');
const https  = require('https');

// ── Hashing ───────────────────────────────────────────────────────────────────
// Meta requires SHA-256 hashed, lowercased, trimmed PII for Advanced Matching.
function hash(value) {
  if (!value && value !== 0) return undefined;
  return crypto
    .createHash('sha256')
    .update(String(value).toLowerCase().trim())
    .digest('hex');
}

// Normalise a phone number to E.164-ish digits only before hashing.
// Meta docs: remove all non-digit chars except leading +.
function hashPhone(phone) {
  if (!phone) return undefined;
  const digits = String(phone).replace(/[^0-9]/g, '');
  return digits ? hash(digits) : undefined;
}

// ── Get config from DB or env ─────────────────────────────────────────────────
let _cfg = null;
async function getCapiCfg() {
  if (_cfg && Date.now() - _cfg._fetchedAt < 5 * 60 * 1000) return _cfg; // cache 5 min

  // Try DB first (admin can set these in Settings → SEO)
  try {
    const { Settings } = require('../models/index');
    const rows = await Settings.find({
      key: { $in: ['seo_fbPixelId', 'meta_capi_token', 'meta_test_event_code'] },
    }).lean();
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });

    _cfg = {
      pixelId:       s.seo_fbPixelId        || process.env.META_PIXEL_ID         || '',
      accessToken:   s.meta_capi_token      || process.env.META_CAPI_ACCESS_TOKEN || '',
      testEventCode: s.meta_test_event_code || process.env.META_TEST_EVENT_CODE   || '',
      _fetchedAt:    Date.now(),
    };
  } catch {
    _cfg = {
      pixelId:       process.env.META_PIXEL_ID         || '',
      accessToken:   process.env.META_CAPI_ACCESS_TOKEN || '',
      testEventCode: process.env.META_TEST_EVENT_CODE   || '',
      _fetchedAt:    Date.now(),
    };
  }
  return _cfg;
}

// ── HTTP POST (no external deps — pure Node https) ───────────────────────────
function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(body);
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(json),
      },
      timeout: 8000,
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('CAPI timeout')); });
    req.write(json);
    req.end();
  });
}

// ── Core send function ────────────────────────────────────────────────────────
/**
 * sendCapiEvent(eventName, payload)
 *
 * @param {string} eventName  — 'Purchase' | 'AddToCart' | 'InitiateCheckout' etc.
 * @param {object} payload
 *   @param {string}  payload.eventId      — UUID used for browser deduplication
 *   @param {string}  payload.eventSourceUrl — page URL where the event occurred
 *   @param {string}  [payload.email]      — raw (will be hashed)
 *   @param {string}  [payload.phone]      — raw (will be hashed)
 *   @param {string}  [payload.firstName]  — raw (will be hashed)
 *   @param {string}  [payload.lastName]   — raw (will be hashed)
 *   @param {string}  [payload.city]       — raw (will be hashed)
 *   @param {string}  [payload.country]    — raw (will be hashed, 2-letter ISO)
 *   @param {string}  [payload.clientIp]   — from req.ip
 *   @param {string}  [payload.userAgent]  — from req.headers['user-agent']
 *   @param {string}  [payload.fbp]        — _fbp cookie value
 *   @param {string}  [payload.fbc]        — _fbc cookie value
 *   @param {number}  [payload.value]      — order total
 *   @param {string}  [payload.currency]   — ISO 4217 (e.g. 'LKR')
 *   @param {Array}   [payload.contentIds] — product IDs
 *   @param {string}  [payload.contentType]— 'product'
 *   @param {number}  [payload.numItems]   — item count
 *   @param {string}  [payload.orderId]    — for Purchase dedup in your DB
 */
async function sendCapiEvent(eventName, payload = {}) {
  const cfg = await getCapiCfg();

  if (!cfg.pixelId || !cfg.accessToken) {
    // Silently skip if not configured — dev environments without CAPI set up
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[META CAPI] Skipped (not configured): ${eventName}`);
    }
    return;
  }

  // ── Build user_data with Advanced Matching ────────────────────────────────
  const userData = {};
  if (payload.email)     userData.em  = hash(payload.email);
  if (payload.phone)     userData.ph  = hashPhone(payload.phone);
  if (payload.firstName) userData.fn  = hash(payload.firstName);
  if (payload.lastName)  userData.ln  = hash(payload.lastName);
  if (payload.city)      userData.ct  = hash(payload.city);
  if (payload.country)   userData.country = hash(payload.country);
  if (payload.clientIp)  userData.client_ip_address = payload.clientIp;
  if (payload.userAgent) userData.client_user_agent  = payload.userAgent;
  if (payload.fbp)       userData.fbp = payload.fbp;
  if (payload.fbc)       userData.fbc = payload.fbc;

  // ── Build custom_data ─────────────────────────────────────────────────────
  const customData = {};
  if (typeof payload.value    === 'number') customData.value     = payload.value;
  if (payload.currency)    customData.currency     = String(payload.currency).toUpperCase();
  if (payload.contentIds)  customData.content_ids  = payload.contentIds.map(String);
  if (payload.contentType) customData.content_type = payload.contentType;
  if (typeof payload.numItems === 'number') customData.num_items = payload.numItems;
  if (payload.orderId)     customData.order_id     = String(payload.orderId);

  // ── Build event object ────────────────────────────────────────────────────
  const event = {
    event_name:        eventName,
    event_time:        Math.floor(Date.now() / 1000),
    event_id:          payload.eventId || require('crypto').randomUUID(),
    action_source:     'website',
    event_source_url:  payload.eventSourceUrl || `https://${process.env.FRONTEND_URL || 'shopzen.lk'}`,
    user_data:         userData,
    ...(Object.keys(customData).length ? { custom_data: customData } : {}),
  };

  const body = { data: [event] };
  if (cfg.testEventCode) body.test_event_code = cfg.testEventCode;

  // ── Send ──────────────────────────────────────────────────────────────────
  const apiVersion = 'v21.0';
  const url = `https://graph.facebook.com/${apiVersion}/${cfg.pixelId}/events?access_token=${cfg.accessToken}`;

  try {
    const result = await postJson(url, body);
    if (result.status !== 200) {
      console.error(`[META CAPI] ${eventName} error ${result.status}:`, JSON.stringify(result.body));
    } else {
      const eventsReceived = result.body?.events_received ?? '?';
      console.log(`[META CAPI] ${eventName} sent — events_received: ${eventsReceived}`);
    }
  } catch (err) {
    // Never crash the order flow over a pixel failure
    console.error(`[META CAPI] ${eventName} failed:`, err.message);
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Send a Purchase event via CAPI after an order is created.
 * @param {object} order   — Mongoose Order document (plain or lean)
 * @param {object} options — { clientIp, userAgent, fbp, fbc, eventId, siteUrl }
 */
async function sendPurchaseEvent(order, options = {}) {
  const billing = order.billing || {};
  const items   = order.items   || [];
  const currency = 'LKR'; // ShopZen sells in LKR

  await sendCapiEvent('Purchase', {
    eventId:         options.eventId || `purchase-${order._id}`,
    eventSourceUrl:  options.siteUrl  || `${process.env.FRONTEND_URL || 'https://shopzen.lk'}/order-success/${order._id}`,
    email:           billing.email,
    phone:           billing.phone,
    firstName:       billing.firstName,
    lastName:        billing.lastName,
    city:            billing.city,
    country:         billing.country || 'LK',
    clientIp:        options.clientIp,
    userAgent:       options.userAgent,
    fbp:             options.fbp,
    fbc:             options.fbc,
    value:           typeof order.total === 'number' ? order.total : 0,
    currency,
    contentIds:      items.map(i => String(i.product?._id || i.product || '')).filter(Boolean),
    contentType:     'product',
    numItems:        items.reduce((s, i) => s + (i.quantity || 1), 0),
    orderId:         String(order._id),
  });
}

/**
 * Send an InitiateCheckout event via CAPI.
 */
async function sendInitiateCheckoutEvent(data, options = {}) {
  await sendCapiEvent('InitiateCheckout', {
    eventId:         options.eventId,
    eventSourceUrl:  options.siteUrl || `${process.env.FRONTEND_URL || 'https://shopzen.lk'}/checkout`,
    email:           data.email,
    phone:           data.phone,
    firstName:       data.firstName,
    lastName:        data.lastName,
    clientIp:        options.clientIp,
    userAgent:       options.userAgent,
    fbp:             options.fbp,
    fbc:             options.fbc,
    value:           data.value,
    currency:        'LKR',
    contentIds:      data.contentIds,
    contentType:     'product',
    numItems:        data.numItems,
  });
}

module.exports = {
  sendCapiEvent,
  sendPurchaseEvent,
  sendInitiateCheckoutEvent,
};