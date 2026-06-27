/**
 * metaPixelHelpers.js
 *
 * Shared utilities for Meta Pixel + Conversions API integration.
 *
 * Responsibilities:
 *  1. generateEventId()  — deterministic UUID for browser↔server deduplication
 *  2. getFbCookies()     — reads _fbp / _fbc from document.cookie
 *  3. getAdvancedMatchingData() — collects & hashes PII for the browser pixel
 *  4. sendCapiRequest()  — fires the same event server-side via /api/meta/capi
 *
 * Deduplication flow:
 *  Browser pixel fires event with eventId X
 *  → Frontend immediately calls sendCapiRequest with the same eventId X
 *  → Backend hashes PII and POSTs to Meta Graph API with eventId X
 *  → Meta sees two events with the same eventId and counts only ONE conversion
 */

import API from './api';

// ── 1. Event ID ───────────────────────────────────────────────────────────────
/**
 * Generate a unique event ID that links the browser pixel event to the
 * server-side CAPI event. Must be the same string in both calls.
 * Format: {eventName}-{orderId|randomHex}-{timestamp}
 */
export function generateEventId(eventName, uniquePart) {
  const ts   = Date.now().toString(36);
  const rand = uniquePart
    ? String(uniquePart).replace(/[^a-zA-Z0-9]/g, '').slice(0, 20)
    : Math.random().toString(36).slice(2, 10);
  return `${eventName}-${rand}-${ts}`;
}

// ── 2. FB cookies ─────────────────────────────────────────────────────────────
/**
 * Read _fbp and _fbc cookies. Meta uses these for audience matching
 * and attribution — always pass them through to CAPI.
 */
export function getFbCookies() {
  const cookies = {};
  document.cookie.split(';').forEach(c => {
    const [k, v] = c.trim().split('=');
    if (k === '_fbp' || k === '_fbc') cookies[k] = decodeURIComponent(v || '');
  });
  return { fbp: cookies._fbp || '', fbc: cookies._fbc || '' };
}

// ── 3. Advanced Matching data ─────────────────────────────────────────────────
/**
 * Collect PII from the billing object / logged-in user for Advanced Matching.
 * This improves audience match rate from ~40% to ~80%+.
 *
 * The browser pixel accepts raw (unhashed) values — fbevents.js hashes them
 * client-side before sending. The CAPI endpoint receives raw values too and
 * the backend hashes them before sending to Meta Graph API.
 *
 * @param {object} billing — { firstName, lastName, email, phone, city, country }
 * @returns {object}       — matching fields, undefined if empty
 */
export function getAdvancedMatchingData(billing = {}) {
  const data = {};
  if (billing.email)     data.em  = billing.email.toLowerCase().trim();
  if (billing.phone)     data.ph  = billing.phone.replace(/[^0-9]/g, '');
  if (billing.firstName) data.fn  = billing.firstName.toLowerCase().trim();
  if (billing.lastName)  data.ln  = billing.lastName.toLowerCase().trim();
  if (billing.city)      data.ct  = billing.city.toLowerCase().trim();
  if (billing.country)   data.country = billing.country.toLowerCase().trim().slice(0, 2); // 2-letter ISO
  return Object.keys(data).length ? data : undefined;
}

// ── 4. Server-side CAPI relay ─────────────────────────────────────────────────
/**
 * Fire a Conversions API event via the ShopZen backend.
 * Never throws — a CAPI failure must never break the checkout flow.
 *
 * @param {string} eventName      — 'Purchase' | 'AddToCart' | 'InitiateCheckout' | 'ViewContent'
 * @param {object} payload        — event-specific data (value, currency, contentIds, etc.)
 * @param {string} eventId        — same ID used in the browser pixel call
 * @param {object} [billing]      — raw PII for Advanced Matching (hashed server-side)
 */
export async function sendCapiRequest(eventName, payload, eventId, billing = {}) {
  try {
    const { fbp, fbc } = getFbCookies();
    await API.post('/meta/capi', {
      eventName,
      eventId,
      eventSourceUrl: window.location.href,
      fbp,
      fbc,
      userAgent: navigator.userAgent,
      // PII — hashed on the backend, never logged
      email:     billing.email,
      phone:     billing.phone,
      firstName: billing.firstName,
      lastName:  billing.lastName,
      city:      billing.city,
      country:   billing.country,
      // Event data
      ...payload,
    });
  } catch (err) {
    // Silently swallow — CAPI is supplemental, never mission-critical
    console.warn('[CAPI relay] failed:', err.message);
  }
}