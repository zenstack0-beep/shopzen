const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { Coupon, GiftCard, Notification, Settings, DeliveryService } = require('../models/index');
const { auth, adminAuth } = require('../middleware/auth');

// ── IMPORTANT: All named routes BEFORE /:id wildcard ──────────────────────────

// Admin - Get all orders
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.orderStatus = status;
    if (search) filter.$or = [
      { orderNumber: new RegExp(search, 'i') },
      { 'billing.email': new RegExp(search, 'i') },
      { 'billing.firstName': new RegExp(search, 'i') }
    ];
    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .populate('customer', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ orders, total, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Update order status
router.put('/admin/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, note, trackingNumber, deliveryPartner } = req.body;
    const update = { orderStatus: status, updatedAt: Date.now() };
    if (trackingNumber) update.trackingNumber = trackingNumber;
    if (deliveryPartner) update.deliveryPartner = deliveryPartner;
    if (status === 'delivered') update.deliveredAt = Date.now();
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { ...update, $push: { statusHistory: { status, note: note || `Status updated to ${status}`, updatedBy: req.user.email } } },
      { new: true }
    );
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Mark order as read
router.put('/admin/:id/read', adminAuth, async (req, res) => {
  try {
    await Order.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Confirm payment (manual gateway confirmation)
router.put('/admin/:id/confirm-payment', adminAuth, async (req, res) => {
  try {
    const { paymentReference } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        paymentStatus: 'paid',
        orderStatus: 'confirmed',
        paymentReference,
        updatedAt: Date.now(),
        $push: { statusHistory: { status: 'confirmed', note: 'Payment confirmed by admin', updatedBy: req.user.email } }
      },
      { new: true }
    );
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Customer - Get my orders
router.get('/my-orders', auth, async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .populate('items.product', 'name thumbnail');
    res.json(orders);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Place order (public — guest + logged in)
router.post('/', async (req, res) => {
  try {
    const { items, billing, shipping, shipToDifferentAddress, paymentMethod, couponCode, giftCard, notes, deliveryService } = req.body;

    if (!items || items.length === 0) return res.status(400).json({ message: 'No items in order' });

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product || !product.isActive) return res.status(400).json({ message: `Product not available: ${item.name}` });
      if (product.stock < item.quantity) return res.status(400).json({ message: `Insufficient stock for ${product.name}` });
      const price = product.salePrice || product.price;
      const itemSubtotal = price * item.quantity;
      subtotal += itemSubtotal;
      orderItems.push({ product: product._id, name: product.name, image: product.thumbnail, price, quantity: item.quantity, subtotal: itemSubtotal });
      await Product.findByIdAndUpdate(product._id, { $inc: { stock: -item.quantity, soldCount: item.quantity } });
    }

    // Coupon discount
    let couponDiscount = 0;
    if (couponCode) {
      const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true, validUntil: { $gte: new Date() } });
      if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
        couponDiscount = coupon.type === 'percentage'
          ? Math.min((subtotal * coupon.value) / 100, coupon.maxDiscount || Infinity)
          : coupon.value;
        coupon.usedCount += 1;
        await coupon.save();
      }
    }

    // Gift card discount
    let giftCardDiscount = 0;
    let giftCardDoc = null;
    if (giftCard) {
      giftCardDoc = await GiftCard.findOne({ code: giftCard.toUpperCase(), isActive: true, expiresAt: { $gte: new Date() } });
      if (giftCardDoc && giftCardDoc.balance > 0) {
        giftCardDiscount = Math.min(giftCardDoc.balance, subtotal - couponDiscount);
      }
    }

    // Shipping cost — use delivery service if specified
    let shippingCost = 0;
    let deliveryServiceName = 'Standard Delivery';
    if (deliveryService) {
      const svc = await DeliveryService.findOne({ code: deliveryService, isEnabled: true });
      if (svc && svc.rates && svc.rates.length > 0) {
        const rate = svc.rates[0];
        shippingCost = (rate.freeAbove && subtotal >= rate.freeAbove) ? 0 : rate.price;
        deliveryServiceName = svc.name;
      }
    } else {
      // Fallback to settings
      const settingsMap = {};
      const allSettings = await Settings.find({ key: { $in: ['standardDelivery', 'freeDeliveryThreshold'] } });
      allSettings.forEach(s => settingsMap[s.key] = s.value);
      const freeThreshold = settingsMap.freeDeliveryThreshold || 5000;
      shippingCost = subtotal >= freeThreshold ? 0 : (settingsMap.standardDelivery || 600);
    }

    const total = Math.max(0, subtotal - couponDiscount - giftCardDiscount + shippingCost);

    // Determine initial payment status
    const isGatewayPayment = ['payhere', 'stripe', 'paypal', 'razorpay'].includes(paymentMethod);
    const initialPaymentStatus = isGatewayPayment ? 'pending' : 'pending';
    const initialOrderStatus = 'pending';

    const orderData = {
      items: orderItems,
      billing,
      shipping: shipToDifferentAddress ? shipping : billing,
      shipToDifferentAddress,
      paymentMethod,
      paymentStatus: initialPaymentStatus,
      orderStatus: initialOrderStatus,
      couponCode,
      couponDiscount,
      giftCard,
      giftCardDiscount,
      subtotal,
      shippingCost,
      discount: couponDiscount + giftCardDiscount,
      total,
      notes,
      deliveryService: deliveryService || 'standard',
      deliveryServiceName,
      statusHistory: [{ status: 'pending', note: 'Order placed', updatedBy: billing.email }]
    };

    // Attach customer if logged in
    if (req.headers.authorization) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(req.headers.authorization.replace('Bearer ', ''), process.env.JWT_SECRET);
        orderData.customer = decoded.id;
      } catch {}
    }

    const order = await Order.create(orderData);

    // Deduct gift card balance
    if (giftCardDoc && giftCardDiscount > 0) {
      giftCardDoc.balance -= giftCardDiscount;
      giftCardDoc.usageHistory.push({ orderId: order._id, amount: giftCardDiscount });
      if (giftCardDoc.balance <= 0) giftCardDoc.isActive = false;
      await giftCardDoc.save();
    }

    await Notification.create({
      type: 'new_order',
      title: '🛒 New Order Received!',
      message: `Order ${order.orderNumber} from ${billing.firstName} ${billing.lastName} — Rs. ${total.toLocaleString()}`,
      link: `/admin/orders/${order._id}`,
      data: { orderId: order._id, total, paymentMethod }
    });

    res.status(201).json({ orderId: order._id, orderNumber: order.orderNumber, total, paymentMethod });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Payment gateway webhook — auto-confirm order after successful payment
router.post('/payment-success', async (req, res) => {
  try {
    const { orderId, paymentReference, gateway } = req.body;
    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    order.paymentStatus = 'paid';
    order.orderStatus = 'confirmed';
    order.paymentReference = paymentReference;
    order.statusHistory.push({ status: 'confirmed', note: `Payment confirmed via ${gateway}`, updatedBy: 'system' });
    await order.save();
    await Notification.create({
      type: 'new_order',
      title: '✅ Payment Confirmed',
      message: `Order ${order.orderNumber} payment received via ${gateway}`,
      link: `/admin/orders/${order._id}`
    });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Get single order by ID — MUST be LAST
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name thumbnail slug')
      .populate('customer', 'firstName lastName email');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Claim a guest order after registration — links order to the logged-in user
// Called immediately after register() on the OrderSuccess page
router.patch('/:id/claim', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    // Only claim if still a guest order (no customer attached)
    if (order.customer) return res.json({ message: 'Already linked' });
    // Extra safety: billing email must match the logged-in user
    if (order.billing?.email && order.billing.email.toLowerCase() !== req.user.email.toLowerCase()) {
      return res.status(403).json({ message: 'Email does not match order' });
    }
    order.customer = req.user._id;
    await order.save();
    res.json({ message: 'Order linked to account' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;