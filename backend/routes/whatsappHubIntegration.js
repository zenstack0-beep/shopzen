'use strict';

const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const whatsappHubAuth = require('../middleware/whatsappHubAuth');
const WhatsAppHubCheckout = require('../models/WhatsAppHubCheckout');
const Product = require('../models/Product');
const Order = require('../models/Order');
const { DiscountEngine } = require('../services/discountEngine');

// One-time bootstrap endpoint. It is intentionally outside HMAC auth because
// the pasted setup code is the initial high-entropy bearer credential. Codes
// are hashed in the database, expire after ten minutes, and are consumed with
// one atomic update before credentials are returned exactly once.
router.post('/setup/redeem', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many setup attempts' },
}), async (req, res) => {
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
router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many WhatsApp Hub requests' },
}));

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
