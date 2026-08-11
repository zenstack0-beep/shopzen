'use strict';

const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const whatsappHubAuth = require('../middleware/whatsappHubAuth');
const WhatsAppHubCheckout = require('../models/WhatsAppHubCheckout');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { DiscountEngine } = require('../services/discountEngine');
const crypto = require('crypto');
const WhatsAppHubInbound = require('../models/WhatsAppHubInbound');
const { getWhatsAppCredentials, sendWhatsAppMessage } = require('../services/whatsappCloudService');

// Bound connector execution time independently of the public IP limiter.
// The timer is always cleared and never logs request bodies or credentials.
router.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    return res.status(415).json({ message: 'WhatsApp Hub requests must use application/json' });
  }
  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(503).json({ message: 'WhatsApp Hub request timed out' });
  }, 25_000);
  const clear = () => clearTimeout(timer);
  res.once('finish', clear);
  res.once('close', clear);
  next();
});

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Meta webhook verification and reception remain in ShopZen. These two routes
// intentionally precede Hub HMAC auth because Meta, not the Hub, calls them.
router.get('/webhook', async (req, res) => {
  try {
    const credentials = await getWhatsAppCredentials();
    const mode = String(req.query['hub.mode'] || '');
    const token = String(req.query['hub.verify_token'] || '');
    const challenge = String(req.query['hub.challenge'] || '');
    if (mode !== 'subscribe' || !credentials.webhookVerifyToken || !constantTimeEqual(token, credentials.webhookVerifyToken)) {
      return res.sendStatus(403);
    }
    return res.status(200).type('text/plain').send(challenge);
  } catch {
    return res.sendStatus(503);
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const credentials = await getWhatsAppCredentials();
    const supplied = String(req.get('X-Hub-Signature-256') || '').replace(/^sha256=/i, '').toLowerCase();
    const expected = credentials.appSecret
      ? crypto.createHmac('sha256', credentials.appSecret).update(req.rawBody || '').digest('hex')
      : '';
    if (!credentials.appSecret || !/^[a-f0-9]{64}$/.test(supplied) || !constantTimeEqual(supplied, expected)) {
      return res.sendStatus(401);
    }

    const writes = [];
    for (const entry of req.body?.entry || []) {
      for (const change of entry?.changes || []) {
        const contacts = new Map((change?.value?.contacts || []).map(contact => [String(contact.wa_id || ''), contact]));
        for (const message of change?.value?.messages || []) {
          const metaMessageId = String(message.id || '').slice(0, 255);
          const from = String(message.from || '').replace(/[^0-9]/g, '').slice(0, 32);
          if (!metaMessageId || !from) continue;
          const contact = contacts.get(from);
          writes.push(WhatsAppHubInbound.updateOne(
            { metaMessageId },
            { $setOnInsert: {
              metaMessageId,
              from,
              customerName: String(contact?.profile?.name || '').slice(0, 160),
              messageType: String(message.type || 'unknown').slice(0, 40),
              message,
              receivedAt: new Date((Number(message.timestamp) || Math.floor(Date.now() / 1000)) * 1000),
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            } },
            { upsert: true }
          ));
        }
      }
    }
    await Promise.all(writes);
    return res.sendStatus(200);
  } catch {
    // Meta retries non-2xx deliveries; no payload or credentials are logged.
    return res.sendStatus(500);
  }
});

// One-time bootstrap endpoint. It is intentionally outside HMAC auth because
// the pasted setup code is the initial high-entropy bearer credential. Codes
// are hashed in the database, expire after ten minutes, and are consumed with
// one atomic update before credentials are returned exactly once.
router.post('/setup/redeem', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const credentials = await require('../services/socialMediaService').redeemWhatsappHubSetupCode(req.body?.setupCode);
    return res.status(200).json({
      shopzenHubKey: credentials.key,
      shopzenHubSecret: credentials.secret,
    });
  } catch (error) {
    return res.status(401).json({ message: error.message || 'Setup code could not be redeemed' });
  }
});

router.use(whatsappHubAuth);

const money = value => Math.round(Number(value || 0) * 100) / 100;
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function publicProduct(product) {
  return {
    id: product._id,
    name: product.name,
    slug: product.slug,
    sku: product.sku || '',
    brand: product.brand || '',
    description: product.shortDescription || product.description || '',
    price: money(product.price),
    salePrice: product.salePrice > 0 && product.salePrice < product.price ? money(product.salePrice) : null,
    effectivePrice: money(DiscountEngine.effectivePrice(product)),
    stock: Number(product.stock || 0),
    available: product.isActive && Number(product.stock || 0) > 0,
    image: product.thumbnail || product.images?.[0] || '',
    images: product.images || [],
  };
}

function hubOrder(order) {
  return {
    id: order._id,
    orderNumber: order.orderNumber,
    orderStatus: order.orderStatus,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    subtotal: money(order.subtotal),
    shippingCost: money(order.shippingCost),
    couponDiscount: money(order.couponDiscount),
    total: money(order.total),
    deliveryServiceName: order.deliveryServiceName || '',
    createdAt: order.createdAt,
    items: (order.items || []).map(item => ({
      productId: item.product?._id || item.product,
      name: item.name,
      quantity: item.quantity,
      unitPrice: money(item.price),
      subtotal: money(item.subtotal),
      image: item.image || '',
    })),
  };
}

router.get('/health', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ ok: true, service: 'shopzen-whatsapp-hub-connector' });
});

router.get('/connection/health', async (_req, res) => {
  try {
    const credentials = await getWhatsAppCredentials();
    return res.status(200).json({
      ok: Boolean(credentials.connected && credentials.accessToken && credentials.phoneNumberId),
      service: 'shopzen-whatsapp-hub-connector',
      shopzenOwnsMeta: true,
      whatsappConfigured: Boolean(credentials.accessToken && credentials.phoneNumberId),
    });
  } catch {
    return res.status(503).json({ ok: false, service: 'shopzen-whatsapp-hub-connector' });
  }
});

router.get('/messages/inbound', async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const rows = await WhatsAppHubInbound.find({ status: 'pending' }).sort({ receivedAt: 1 }).limit(limit).lean();
    return res.json({ messages: rows.map(row => ({
      id: row._id,
      metaMessageId: row.metaMessageId,
      from: row.from,
      customerName: row.customerName,
      type: row.messageType,
      message: row.message,
      receivedAt: row.receivedAt,
    })) });
  } catch {
    return res.status(500).json({ message: 'Could not load inbound messages' });
  }
});

router.post('/messages/inbound/:messageId/acknowledge', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ message: 'Invalid message ID' });
  const row = await WhatsAppHubInbound.findOneAndUpdate(
    { _id: req.params.messageId, status: 'pending' },
    { $set: { status: 'acknowledged', acknowledgedAt: new Date() } },
    { new: true }
  ).lean();
  if (!row) return res.status(404).json({ message: 'Inbound message is unavailable or already acknowledged' });
  return res.json({ acknowledged: true, id: row._id });
});

router.post('/messages/send', async (req, res) => {
  try {
    const result = await sendWhatsAppMessage(req.body || {});
    return res.status(200).json({ messageId: result.messageId });
  } catch (error) {
    if (error.internalMeta) console.error('[WhatsApp Hub send] Meta API failure', error.internalMeta);
    const status = error.status || 400;
    const message = status === 400 ? String(error.message || 'Invalid WhatsApp message') : 'WhatsApp message could not be sent';
    return res.status(status).json({ message });
  }
});

router.get('/products/search', async (req, res) => {
  try {
    const query = String(req.query.q || '').trim().slice(0, 100);
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
    if (query.length < 2) return res.status(400).json({ message: 'Search query must contain at least 2 characters' });
    const pattern = new RegExp(escapeRegex(query), 'i');
    const products = await Product.find({
      isActive: true,
      $or: [{ name: pattern }, { sku: pattern }, { brand: pattern }, { tags: pattern }],
    }).sort({ stock: -1, soldCount: -1 }).limit(limit).lean();
    return res.json({ products: products.map(publicProduct) });
  } catch {
    return res.status(500).json({ message: 'Product search failed' });
  }
});

router.get('/products/:productId', async (req, res) => {
  try {
    const identifier = String(req.params.productId || '');
    const filter = mongoose.isValidObjectId(identifier) ? { _id: identifier } : { slug: identifier };
    const product = await Product.findOne({ ...filter, isActive: true }).lean();
    if (!product) return res.status(404).json({ message: 'Product not found' });
    return res.json({ product: publicProduct(product) });
  } catch {
    return res.status(500).json({ message: 'Could not load product' });
  }
});

router.post('/orders/prepare', async (req, res) => {
  try {
    const {
      items, billing, shipping, shipToDifferentAddress = false,
      paymentMethod, couponCode, giftCard, notes, deliveryService,
      externalReference,
    } = req.body || {};
    if (!['cod', 'bank_transfer'].includes(paymentMethod)) {
      return res.status(400).json({ message: 'WhatsApp Hub supports COD and bank transfer orders only' });
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
      return res.status(400).json({ message: 'Order must contain 1–50 items' });
    }
    const requiredBilling = ['firstName', 'lastName', 'street', 'city', 'phone', 'email'];
    if (!billing || requiredBilling.some(field => !String(billing[field] || '').trim())) {
      return res.status(400).json({ message: 'Complete customer billing details are required' });
    }
    const canonicalItems = [];
    const lineItems = [];
    for (const requested of items) {
      const quantity = Number(requested.quantity);
      if (!mongoose.isValidObjectId(requested.productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
        return res.status(400).json({ message: 'Invalid product or quantity' });
      }
      const product = await Product.findOne({ _id: requested.productId, isActive: true });
      if (!product) return res.status(404).json({ message: 'Product not found' });
      if (product.stock < quantity) return res.status(409).json({ message: `Insufficient stock for ${product.name}` });
      const line = DiscountEngine.buildLineItem(product, quantity);
      lineItems.push(line);
      canonicalItems.push({ productId: product._id, name: product.name, quantity });
    }

    const subtotal = DiscountEngine.computeSubtotal(lineItems);
    const delivery = await DiscountEngine.resolveDeliveryFee(deliveryService || null, billing.city, subtotal, {});
    const benefit = await DiscountEngine.resolveBenefit({
      couponCode: couponCode || null,
      giftCardCode: giftCard || null,
      subtotal,
      deliveryFee: delivery.fee,
      email: billing.email,
      categoryIds: [...new Set(lineItems.flatMap(item => [item.category?.toString(), item.subCategory?.toString()]).filter(Boolean))],
      productIds: lineItems.map(item => item.product.toString()),
      brands: [...new Set(lineItems.map(item => item.brand).filter(Boolean))],
      lineItems,
    });
    if (benefit.errorCoupon || benefit.errorGiftCard) {
      return res.status(400).json({ message: benefit.errorCoupon || benefit.errorGiftCard });
    }
    const totals = DiscountEngine.computeTotals({ subtotal, deliveryFee: delivery.fee, benefit });
    const cleanReference = String(externalReference || '').trim().slice(0, 120) || undefined;
    const payload = {
      items: canonicalItems,
      billing,
      shipping: shipToDifferentAddress ? shipping : billing,
      shipToDifferentAddress: Boolean(shipToDifferentAddress),
      paymentMethod,
      couponCode: couponCode || undefined,
      giftCard: giftCard || undefined,
      notes: String(notes || '').slice(0, 1000),
      deliveryService: deliveryService || undefined,
    };
    const checkout = await WhatsAppHubCheckout.create({
      externalReference: cleanReference,
      orderPayload: payload,
      quote: {
        subtotal: totals.subtotal,
        couponDiscount: totals.couponDiscount,
        giftCardDeduction: totals.giftCardDeduction,
        shippingCost: totals.deliveryFee,
        total: totals.total,
        deliveryServiceName: delivery.serviceName,
        items: lineItems.map(item => ({ productId: item.product, name: item.name, quantity: item.quantity, unitPrice: item.price, subtotal: item.subtotal })),
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    return res.status(201).json({ checkoutId: checkout._id, status: checkout.status, expiresAt: checkout.expiresAt, quote: checkout.quote });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: 'External reference already exists' });
    return res.status(500).json({ message: 'Could not prepare order' });
  }
});

async function createThroughExistingOrderWorkflow(checkout) {
  const metaEventId = `Hub-${checkout._id}`;
  const existing = await Order.findOne({ metaEventId });
  if (existing) return existing;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 5001}/api/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...checkout.orderPayload, metaEventId }),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(result.message || `Order API returned HTTP ${response.status}`).slice(0, 300));
    const order = await Order.findById(result.orderId);
    if (!order) throw new Error('Order was created but could not be loaded');
    return order;
  } finally {
    clearTimeout(timeout);
  }
}

router.post('/orders/:checkoutId/confirm', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.checkoutId)) return res.status(400).json({ message: 'Invalid checkout ID' });
    let checkout = await WhatsAppHubCheckout.findById(req.params.checkoutId);
    if (!checkout) return res.status(404).json({ message: 'Prepared checkout not found or expired' });
    if (checkout.status === 'confirmed' && checkout.order) {
      const existingOrder = await Order.findById(checkout.order);
      return existingOrder ? res.json({ status: 'confirmed', order: hubOrder(existingOrder) }) : res.status(409).json({ message: 'Confirmed order is unavailable' });
    }
    if (checkout.expiresAt <= new Date()) return res.status(410).json({ message: 'Prepared checkout has expired' });
    checkout = await WhatsAppHubCheckout.findOneAndUpdate(
      { _id: checkout._id, status: { $in: ['prepared', 'failed'] } },
      { $set: { status: 'confirming', lastError: '' } },
      { new: true }
    );
    if (!checkout) return res.status(409).json({ message: 'Checkout confirmation is already in progress' });
    try {
      const order = await createThroughExistingOrderWorkflow(checkout);
      await WhatsAppHubCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'confirmed', order: order._id, orderNumber: order.orderNumber, lastError: '' } });
      return res.status(201).json({ status: 'confirmed', order: hubOrder(order) });
    } catch (error) {
      const recovered = await Order.findOne({ metaEventId: `Hub-${checkout._id}` });
      if (recovered) {
        await WhatsAppHubCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'confirmed', order: recovered._id, orderNumber: recovered.orderNumber, lastError: '' } });
        return res.status(201).json({ status: 'confirmed', order: hubOrder(recovered) });
      }
      await WhatsAppHubCheckout.updateOne({ _id: checkout._id }, { $set: { status: 'failed', lastError: String(error.message || 'Order confirmation failed').slice(0, 300) } });
      return res.status(422).json({ message: String(error.message || 'Order confirmation failed').slice(0, 300) });
    }
  } catch {
    return res.status(500).json({ message: 'Could not confirm order' });
  }
});

router.get('/orders/lookup', async (req, res) => {
  try {
    const orderNumber = String(req.query.orderNumber || '').trim().slice(0, 80);
    const email = String(req.query.email || '').trim().toLowerCase().slice(0, 254);
    const phone = String(req.query.phone || '').replace(/[^+0-9]/g, '').slice(0, 20);
    if (!orderNumber && !email && !phone) return res.status(400).json({ message: 'Provide an order number, email, or phone number' });
    const filter = {};
    if (orderNumber) filter.orderNumber = orderNumber;
    if (email) filter['billing.email'] = new RegExp(`^${escapeRegex(email)}$`, 'i');
    if (phone) filter['billing.phone'] = phone;
    filter.$or = [{ paymentMethod: { $nin: ['payzy', 'koko'] } }, { paymentStatus: 'paid' }];
    const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(10).lean();
    return res.json({ orders: orders.map(hubOrder) });
  } catch {
    return res.status(500).json({ message: 'Could not look up customer orders' });
  }
});

module.exports = router;
