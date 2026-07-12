'use strict';

const crypto = require('crypto');
const Product = require('../models/Product');
const Order = require('../models/Order');
const User = require('../models/User');
const { sendMail } = require('../utils/mailer');
const { CustomerBehaviorEvent, CustomerMarketingPreference, ProductInterestScore, MarketingRecommendation, MarketingSettings, MarketingAuditLog } = require('../models/Marketing');

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max = 5000) => String(v == null ? '' : v).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const hashEmail = email => crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex');
const effectivePrice = p => p.isOnSale && Number(p.salePrice) > 0 && Number(p.salePrice) < Number(p.price) ? Number(p.salePrice) : Number(p.price);

async function getSettings() {
  return MarketingSettings.findOneAndUpdate({ singletonKey: 'default' }, { $setOnInsert: { singletonKey: 'default' } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

function decay(createdAt, now = new Date()) {
  const days = (now - new Date(createdAt)) / 86400000;
  if (days <= 7) return 1;
  if (days <= 14) return 0.7;
  if (days <= 30) return 0.4;
  return 0;
}

function calculateInterest(events, weights, now = new Date()) {
  const signals = {};
  let score = 0;
  const views = events.filter(e => e.eventType === 'product_viewed').length;
  for (const event of events) {
    if (event.eventType === 'purchase_completed') return { score: 0, signals, excluded: true };
    const weight = Number(weights[event.eventType] || 0) * decay(event.createdAt, now);
    score += weight;
    signals[event.eventType] = (signals[event.eventType] || 0) + 1;
  }
  if (views > 1) score += Number(weights.repeated_product_view || 4) * decay(events[events.length - 1]?.createdAt, now);
  return { score: Math.round(score * 100) / 100, signals, excluded: false };
}

async function validateEligibility({ customerId, productId, settings, recommendation }) {
  const [user, product, preference, purchased, recentWeek, recentMonth, sameProduct] = await Promise.all([
    User.findById(customerId).lean(), Product.findById(productId).lean(),
    CustomerMarketingPreference.findOne({ customerId }).lean(),
    Order.exists({ customer: customerId, 'items.product': productId, orderStatus: { $nin: ['cancelled','refunded'] }, paymentStatus: { $ne: 'failed' } }),
    MarketingRecommendation.countDocuments({ customerId, sentAt: { $gte: new Date(Date.now() - 7 * 86400000) }, status: { $in: ['sent','converted'] }, _id: { $ne: recommendation?._id } }),
    MarketingRecommendation.countDocuments({ customerId, sentAt: { $gte: new Date(Date.now() - 30 * 86400000) }, status: { $in: ['sent','converted'] }, _id: { $ne: recommendation?._id } }),
    MarketingRecommendation.exists({ customerId, productId, sentAt: { $gte: new Date(Date.now() - settings.sameProductCooldownDays * 86400000) }, status: { $in: ['sent','converted'] }, _id: { $ne: recommendation?._id } }),
  ]);
  if (!settings.enabled) return { eligible: false, reason: 'Retargeting is disabled' };
  if ((settings.excludedCustomers || []).some(id => String(id) === String(customerId))) return { eligible: false, reason: 'Customer is excluded by marketing settings' };
  if ((settings.excludedProducts || []).some(id => String(id) === String(productId))) return { eligible: false, reason: 'Product is excluded by marketing settings' };
  if (!user || !user.isActive) return { eligible: false, reason: 'Customer is inactive or missing' };
  if (!preference || !preference.marketingConsent || preference.unsubscribedAt || preference.suppressionReason || preference.complaintAt || preference.deletionRequestedAt) return { eligible: false, reason: 'Marketing consent is unavailable or suppressed' };
  if (!emailRe.test(preference.email)) return { eligible: false, reason: 'Customer email is invalid' };
  if (!product || !product.isActive) return { eligible: false, reason: 'Product is inactive or missing' };
  if ((settings.allowedProductCategories || []).length && !(settings.allowedProductCategories || []).some(id => String(id) === String(product.category))) return { eligible: false, reason: 'Product category is not allowed for retargeting' };
  if (!product.thumbnail && !(product.images || []).some(Boolean)) return { eligible: false, reason: 'Product has no image' };
  if (!(effectivePrice(product) > 0)) return { eligible: false, reason: 'Product price is invalid' };
  if (!(Number(product.stock) > 0)) return { eligible: false, reason: 'Product is out of stock' };
  if (purchased) return { eligible: false, reason: 'Customer already purchased this product' };
  if (recentWeek >= settings.maximumEmailsPerWeek || recentMonth >= settings.maximumEmailsPerMonth) return { eligible: false, reason: 'Customer email frequency limit reached' };
  if (sameProduct) return { eligible: false, reason: 'Same-product cooldown is active' };
  return { eligible: true, user, product, preference };
}

function fallbackContent(product, signals) {
  const reasonParts = Object.entries(signals || {}).map(([key, count]) => `${count} ${key.replace(/_/g, ' ')}`);
  return {
    subject: `Still considering ${clean(product.name, 100)}?`,
    previewText: 'Take another look at a product you recently explored.',
    headline: 'A product you may still be considering',
    body: `${clean(product.name, 180)} is currently available at ShopZen. You can review the latest product details and current price on the product page.`,
    ctaText: 'View Product', reason: reasonParts.join(', ') || 'Recent product interest', confidence: 0.7,
  };
}

function safeContent(input, product) {
  const fallback = fallbackContent(product, {});
  return {
    subject: clean(input?.subject || fallback.subject, 150), previewText: clean(input?.previewText || fallback.previewText, 220),
    headline: clean(input?.headline || fallback.headline, 180), body: clean(input?.body || fallback.body, 5000),
    ctaText: clean(input?.ctaText || fallback.ctaText, 60), reason: clean(input?.reason || '', 1000),
    confidence: Math.max(0, Math.min(1, Number(input?.confidence) || 0.7)),
  };
}

async function generateContent(product, signals, settings) {
  const fallback = fallbackContent(product, signals);
  if (!settings.aiEnabled || process.env.MARKETING_AI_ENABLED !== 'true') return { ...safeContent(fallback, product), source: 'fallback' };
  const provider = process.env.MARKETING_AI_PROVIDER || 'openrouter';
  const apiKey = process.env.MARKETING_AI_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey || provider !== 'openrouter') return { ...safeContent(fallback, product), source: 'fallback' };
  const prompt = {
    product: { name: clean(product.name,150), brand: clean(product.brand,80), category: clean(product.category?.name,100), price: effectivePrice(product), inStock: Number(product.stock)>0 },
    interestSignals: signals,
  };
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`,'HTTP-Referer':process.env.FRONTEND_URL||'https://shopzen.lk','X-Title':'ShopZen Marketing'}, body:JSON.stringify({ model:process.env.MARKETING_AI_MODEL||'meta-llama/llama-3.1-8b-instruct', temperature:0.3, max_tokens:500, response_format:{type:'json_object'}, messages:[{role:'system',content:'Return JSON only with subject, previewText, headline, body, ctaText, reason, confidence. Be polite and non-intrusive. Never invent urgency, stock, reviews, discounts, prices, links, HTML, or customer facts.'},{role:'user',content:JSON.stringify(prompt)}] }) });
    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const data=await response.json(); const raw=data.choices?.[0]?.message?.content||''; const start=raw.indexOf('{'); const end=raw.lastIndexOf('}');
    if(start<0||end<=start)throw new Error('AI response was not JSON');
    return { ...safeContent(JSON.parse(raw.slice(start,end+1)),product), source:'ai' };
  } catch (error) {
    console.warn('[Marketing AI] fallback used:', clean(error.message,160));
    return { ...safeContent(fallback,product), source:'fallback' };
  }
}

function signToken(payload, expiresInDays = 30) {
  const secret = process.env.MARKETING_SIGNING_SECRET;
  if (!secret) throw new Error('MARKETING_SIGNING_SECRET is not configured');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + expiresInDays * 86400000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !process.env.MARKETING_SIGNING_SECRET) throw new Error('Invalid token');
  const expected = crypto.createHmac('sha256', process.env.MARKETING_SIGNING_SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('Invalid token');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp < Date.now()) throw new Error('Expired token');
  return payload;
}

function renderEmail(rec, product, preference) {
  const base = (process.env.MARKETING_BASE_URL || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
  const token = signToken({ recommendationId: rec._id, customerId: rec.customerId, emailHash: hashEmail(preference.email) });
  const click = `${base}/api/marketing/click/${encodeURIComponent(token)}`;
  const unsubscribe = `${base}/api/marketing/unsubscribe?token=${encodeURIComponent(token)}`;
  const preferences = `${base}/api/marketing/preferences?token=${encodeURIComponent(token)}`;
  const image = clean(product.thumbnail || product.images?.[0], 1000);
  const price = effectivePrice(product).toLocaleString('en-LK');
  const esc = v => clean(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:600px;margin:auto;padding:24px"><div style="background:white;border-radius:16px;padding:28px"><p style="font-weight:800;color:#15803d">ShopZen</p><h1 style="font-size:24px">${esc(rec.headline)}</h1><p>${esc(rec.emailBody)}</p>${image ? `<img src="${esc(image)}" alt="${esc(product.name)}" style="width:100%;max-height:360px;object-fit:contain">` : ''}<h2>${esc(product.name)}</h2><p style="font-size:20px;font-weight:700">Rs. ${price}</p><a href="${click}" style="display:inline-block;background:#15803d;color:white;padding:12px 20px;border-radius:10px;text-decoration:none">${esc(rec.ctaText)}</a><p style="margin-top:28px;font-size:12px;color:#64748b">You receive this because you opted in to ShopZen marketing. ShopZen, Sri Lanka. Reply to ${esc(process.env.MARKETING_REPLY_TO || process.env.ADMIN_EMAIL || 'support@shopzen.lk')} for help.</p><p style="font-size:12px"><a href="${unsubscribe}">Unsubscribe</a> · <a href="${preferences}">Marketing preferences</a></p></div></div></body></html>`;
}

async function sendRecommendation(id) {
  const settings = await getSettings();
  if (!settings.automaticSendingEnabled) throw new Error('Automatic marketing sending is disabled');
  const rec = await MarketingRecommendation.findOneAndUpdate({ _id: id, status: { $in: ['approved','scheduled'] } }, { $set: { status: 'sending' } }, { new: true });
  if (!rec) return null;
  const validation = await validateEligibility({ customerId: rec.customerId, productId: rec.productId, settings, recommendation: rec });
  if (!validation.eligible) {
    rec.status = 'cancelled'; rec.cancelledAt = new Date(); rec.cancellationReason = validation.reason; await rec.save(); return rec;
  }
  try {
    rec.priceSnapshot = effectivePrice(validation.product);
    rec.stockSnapshot = validation.product.stock;
    rec.productSnapshot = { name: validation.product.name, slug: validation.product.slug, image: validation.product.thumbnail || validation.product.images?.[0] };
    const base = (process.env.MARKETING_BASE_URL || process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const data = await sendMail({
      to: validation.preference.email,
      subject: rec.subject,
      html: renderEmail(rec, validation.product, validation.preference),
      text: `${rec.headline}\n\n${rec.emailBody}\n\n${validation.product.name} — Rs. ${effectivePrice(validation.product).toLocaleString('en-LK')}\n${base}/product/${validation.product.slug}\n\nShopZen, Sri Lanka. You opted in to ShopZen marketing; use the unsubscribe or preference link in the HTML email to change your choices.`,
    });
    rec.status = 'sent'; rec.sentAt = new Date(); rec.emailProviderMessageId = data?.id; await rec.save();
    await MarketingAuditLog.create({ action: 'sent', entityId: rec._id, previousStatus: 'sending', newStatus: 'sent' });
    return rec;
  } catch (error) {
    rec.status = 'failed'; rec.failureReason = clean(error.message, 500); await rec.save(); throw error;
  }
}

async function generateRecommendations() {
  const settings = await getSettings();
  if (!settings.enabled) return { created: 0, skipped: 0 };
  const cutoff = new Date(Date.now() - 30 * 86400000);
  const waitingBefore = new Date(Date.now() - settings.waitingPeriodDays * 86400000);
  const groups = await CustomerBehaviorEvent.aggregate([
    { $match: { customerId: { $exists: true }, productId: { $exists: true }, createdAt: { $gte: cutoff, $lte: waitingBefore } } },
    { $group: { _id: { customerId: '$customerId', productId: '$productId' }, events: { $push: { eventType: '$eventType', createdAt: '$createdAt' } }, lastInteractionAt: { $max: '$createdAt' } } },
  ]);
  groups.forEach(group => { group.result = calculateInterest(group.events, settings.weights || {}); });
  groups.sort((a, b) => b.result.score - a.result.score);
  const selectedCustomers = new Set();
  let created = 0; let skipped = 0;
  for (const group of groups) {
    const result = group.result;
    await ProductInterestScore.findOneAndUpdate(group._id, { score: result.score, signals: result.signals, lastInteractionAt: group.lastInteractionAt, calculatedAt: new Date(), status: result.excluded ? 'excluded' : 'active' }, { upsert: true });
    if (result.excluded || result.score < settings.minimumInterestScore) { skipped++; continue; }
    const customerKey = String(group._id.customerId);
    if (selectedCustomers.has(customerKey)) { skipped++; continue; }
    if (await CustomerBehaviorEvent.exists({ ...group._id, createdAt: { $gt: waitingBefore } })) { skipped++; continue; }
    const existing = await MarketingRecommendation.exists({ ...group._id, status: { $in: ['pending_approval','approved','scheduled','sending','sent'] }, createdAt: { $gte: new Date(Date.now() - settings.sameProductCooldownDays * 86400000) } });
    if (existing) { skipped++; continue; }
    const eligibility = await validateEligibility({ ...group._id, settings });
    if (!eligibility.eligible) { skipped++; continue; }
    selectedCustomers.add(customerKey);
    const content = await generateContent(eligibility.product, result.signals, settings);
    const base = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
    const auto = settings.autoApprovalEnabled && content.confidence >= settings.minimumAutoApprovalConfidence;
    const rec = await MarketingRecommendation.create({
      ...group._id, customerEmail: eligibility.preference.email, interestScore: result.score,
      confidence: content.confidence, recommendationReason: content.reason, subject: content.subject,
      previewText: content.previewText, headline: content.headline, emailBody: content.body,
      ctaText: content.ctaText, ctaUrl: `${base}/product/${eligibility.product.slug}`,
      productSnapshot: { name: eligibility.product.name, slug: eligibility.product.slug, image: eligibility.product.thumbnail || eligibility.product.images?.[0] },
      priceSnapshot: effectivePrice(eligibility.product), stockSnapshot: eligibility.product.stock,
      status: auto ? 'approved' : 'pending_approval', approvalMode: auto ? 'automatic' : 'manual',
      approvedAt: auto ? new Date() : undefined, contentSource: content.source,
    });
    await MarketingAuditLog.create({ action: auto ? 'auto_approved' : 'recommendation_created', entityId: rec._id, newStatus: rec.status, metadata: { interestScore: result.score } });
    created++;
  }
  return { created, skipped };
}

module.exports = { calculateInterest, clean, decay, effectivePrice, fallbackContent, generateContent, generateRecommendations, getSettings, hashEmail, renderEmail, safeContent, sendRecommendation, signToken, validateEligibility, verifyToken };
