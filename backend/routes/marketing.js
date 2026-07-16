'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { auth } = require('../middleware/auth');
const Product = require('../models/Product');
const { CustomerBehaviorEvent, CustomerMarketingPreference, MarketingRecommendation, MarketingAuditLog } = require('../models/Marketing');
const { clean, hashEmail, verifyToken } = require('../services/marketingService');

const router = express.Router();
const limiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, legacyHeaders: false });
const allowedEvents = new Set(['product_viewed','product_searched','product_clicked_from_search','category_viewed','brand_viewed','added_to_cart','removed_from_cart','wishlist_added','checkout_started','checkout_abandoned','purchase_completed','email_opened','email_clicked','retargeting_converted']);
function safeMetadata(input) {
  const output = {};
  const allowed = ['quantity','position','resultCount','cartItemCount'];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return output;
  allowed.forEach(key => { if (Number.isFinite(Number(input[key]))) output[key] = Number(input[key]); });
  return output;
}

function safeOccurredAt(value) {
  const parsed = new Date(value);
  const now = Date.now();
  // Accept delayed browser delivery, but reject fabricated/faulty timestamps.
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= now - 24 * 60 * 60 * 1000 && parsed.getTime() <= now + 5 * 60 * 1000
    ? parsed : new Date();
}

router.post('/events', limiter, auth, async (req, res) => {
  try {
    const settings = await require('../services/marketingService').getSettings();
    if (!settings.trackingEnabled) return res.status(202).json({ accepted: false, reason: 'tracking_disabled' });
    const preference = await CustomerMarketingPreference.findOne({ customerId: req.user._id, marketingConsent: true, unsubscribedAt: null, suppressionReason: { $in: [null, ''] } }).lean();
    if (!preference || !allowedEvents.has(req.body.eventType)) return res.status(202).json({ accepted: false });
    const productId = req.body.productId;
    if (productId && !(await Product.exists({ _id: productId }))) return res.status(400).json({ message: 'Invalid product' });
    const eventId = clean(req.body.eventId, 120);
    const event = {
      customerId: req.user._id, emailHash: hashEmail(preference.email), sessionId: clean(req.body.sessionId, 120),
      productId: productId || undefined, categoryId: req.body.categoryId || undefined,
      eventType: req.body.eventType, searchQuery: clean(req.body.searchQuery, 200), source: clean(req.body.source || 'storefront', 80),
      deviceType: ['desktop','mobile','tablet'].includes(req.body.deviceType) ? req.body.deviceType : 'unknown',
      referrer: clean(req.body.referrer, 500), pagePath: clean(req.body.pagePath, 500),
      metadata: safeMetadata(req.body.metadata), occurredAt: safeOccurredAt(req.body.occurredAt),
      ...(eventId ? { eventId } : {}),
    };
    if (eventId) {
      const result = await CustomerBehaviorEvent.updateOne(
        { customerId: req.user._id, eventId }, { $setOnInsert: event }, { upsert: true }
      );
      return res.status(202).json({ accepted: true, duplicate: result.upsertedCount === 0 });
    }
    await CustomerBehaviorEvent.create(event);
    res.status(202).json({ accepted: true, duplicate: false });
  } catch (error) { res.status(400).json({ message: 'Event could not be accepted' }); }
});

function tokenPayload(req) { return verifyToken(req.query.token || req.body.token || req.params.token); }

router.get('/unsubscribe', limiter, async (req, res) => {
  try { tokenPayload(req); res.type('html').send('<!doctype html><html><body><h1>Unsubscribe from ShopZen marketing</h1><form method="post"><input type="hidden" name="token" value="'+clean(req.query.token,2000)+'"><button>Unsubscribe</button></form></body></html>'); }
  catch { res.status(400).send('This link is invalid or expired.'); }
});
router.post('/unsubscribe', limiter, express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const payload = tokenPayload(req);
    const pref = await CustomerMarketingPreference.findOne({ customerId: payload.customerId });
    if (!pref || hashEmail(pref.email) !== payload.emailHash) throw new Error('Invalid token');
    pref.marketingConsent = false; pref.unsubscribedAt = new Date(); pref.suppressionReason = 'unsubscribed'; pref.emailFrequencyPreference = 'none'; await pref.save();
    await MarketingRecommendation.updateMany({ customerId: pref.customerId, status: { $in: ['pending_approval','approved','scheduled'] } }, { status: 'cancelled', cancelledAt: new Date(), cancellationReason: 'Customer unsubscribed' });
    await MarketingAuditLog.create({ action: 'unsubscribed', entityId: pref._id });
    res.type('html').send('<!doctype html><html><body><h1>You have been unsubscribed</h1><p>ShopZen marketing emails have been stopped.</p></body></html>');
  } catch { res.status(400).send('This link is invalid or expired.'); }
});
router.get('/preferences', limiter, async (req, res) => {
  try { const p = tokenPayload(req); const pref = await CustomerMarketingPreference.findOne({ customerId: p.customerId }).select('marketingConsent emailFrequencyPreference'); res.json(pref || {}); }
  catch { res.status(400).json({ message: 'Invalid or expired link' }); }
});
router.put('/preferences', limiter, async (req, res) => {
  try {
    const p = tokenPayload(req); const pref = await CustomerMarketingPreference.findOne({ customerId: p.customerId });
    if (!pref || hashEmail(pref.email) !== p.emailHash) throw new Error('Invalid token');
    const frequency = ['normal','reduced','none'].includes(req.body.emailFrequencyPreference) ? req.body.emailFrequencyPreference : pref.emailFrequencyPreference;
    pref.emailFrequencyPreference = frequency; if (frequency === 'none') { pref.marketingConsent = false; pref.unsubscribedAt = new Date(); pref.suppressionReason = 'preference_opt_out'; } await pref.save();
    res.json({ success: true });
  } catch { res.status(400).json({ message: 'Invalid or expired link' }); }
});
router.get('/click/:token', limiter, async (req, res) => {
  try {
    const payload = tokenPayload(req); const rec = await MarketingRecommendation.findById(payload.recommendationId).populate('productId', 'slug isActive');
    if (!rec || !rec.productId?.isActive) return res.redirect(302, (process.env.FRONTEND_URL || 'https://shopzen.lk') + '/shop');
    rec.clickAt = rec.clickAt || new Date(); await rec.save();
    await CustomerBehaviorEvent.create({ customerId: rec.customerId, productId: rec.productId._id, eventType: 'email_clicked', source: 'retargeting_email' });
    res.redirect(302, `${(process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/,'')}/product/${encodeURIComponent(rec.productId.slug)}`);
  } catch { res.status(400).send('This link is invalid or expired.'); }
});
const transparentGif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
router.get('/open/:token.gif', limiter, async (req, res) => {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  try {
    const settings = await require('../services/marketingService').getSettings();
    if (settings.emailOpenTrackingEnabled) {
      const payload = tokenPayload(req);
      const rec = await MarketingRecommendation.findOneAndUpdate(
        { _id: payload.recommendationId, customerId: payload.customerId, openAt: null },
        { $set: { openAt: new Date() } }, { new: true }
      );
      if (rec) await CustomerBehaviorEvent.create({ customerId:rec.customerId, productId:rec.productId, eventType:'email_opened', source:'retargeting_email' });
    }
  } catch (_) { /* A tracking pixel must never break email rendering. */ }
  res.status(200).end(transparentGif);
});

module.exports = router;
