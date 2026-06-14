const express = require('express');
const router = express.Router();
const { PaymentGateway } = require('../models/index');
const { adminAuth } = require('../middleware/auth');

// Public - Get enabled gateways (no secrets exposed)
router.get('/gateways', async (req, res) => {
  try {
    const gateways = await PaymentGateway.find({ isEnabled: true });
    const safe = gateways.map(g => ({
      _id: g._id,
      gateway: g.gateway,
      displayName: g.displayName,
      description: g.description,
      logo: g.logo,
      isLive: g.isLive,
      supportedCurrencies: g.supportedCurrencies,
      // Only expose public/non-secret keys
      publicKey: g.config?.publicKey || g.config?.merchantId || g.config?.clientId || null
    }));
    res.json(safe);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Get all gateways with full config
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const gateways = await PaymentGateway.find().sort({ gateway: 1 });
    res.json(gateways);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Save/update a gateway config
router.put('/admin/:gateway', adminAuth, async (req, res) => {
  try {
    const { gateway } = req.params;
    const { isEnabled, isLive, displayName, description, logo, config } = req.body;
    const result = await PaymentGateway.findOneAndUpdate(
      { gateway },
      { gateway, isEnabled, isLive, displayName, description, logo, config, updatedAt: Date.now() },
      { upsert: true, new: true }
    );
    res.json(result);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Toggle gateway enabled/disabled
router.put('/admin/:gateway/toggle', adminAuth, async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: req.params.gateway });
    if (!gw) return res.status(404).json({ message: 'Gateway not found' });
    gw.isEnabled = !gw.isEnabled;
    await gw.save();
    res.json(gw);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PayHere Init ────────────────────────────────────────────────────────────
router.post('/payhere/init', async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: 'payhere', isEnabled: true });
    if (!gw || !gw.config?.merchantId) return res.status(400).json({ message: 'PayHere not configured' });

    const crypto = require('crypto');
    const { orderId, amount, currency = 'LKR', customerName, email, phone, address, city, country } = req.body;
    const merchantId = gw.config.merchantId;
    const merchantSecret = gw.config.merchantSecret;
    const amountFormatted = parseFloat(amount).toFixed(2);
    const hashedSecret = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const hash = crypto.createHash('md5').update(`${merchantId}${orderId}${amountFormatted}${currency}${hashedSecret}`).digest('hex').toUpperCase();

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3001';
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;

    res.json({
      merchantId,
      orderId,
      items: `Order ${orderId}`,
      amount: amountFormatted,
      currency,
      hash,
      firstName: customerName?.split(' ')[0] || '',
      lastName: customerName?.split(' ').slice(1).join(' ') || '',
      email: email || '',
      phone: phone || '',
      address: address || '',
      city: city || '',
      country: country || 'Sri Lanka',
      returnUrl: `${frontendUrl}/order-success/${orderId}?gateway=payhere`,
      cancelUrl: `${frontendUrl}/checkout`,
      notifyUrl: `${backendUrl}/api/payments/payhere/notify`,
      checkoutUrl: gw.isLive
        ? 'https://www.payhere.lk/pay/checkout'
        : 'https://sandbox.payhere.lk/pay/checkout'
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PayHere Notify (webhook from PayHere server) ────────────────────────────
router.post('/payhere/notify', async (req, res) => {
  try {
    const Order = require('../models/Order');
    const { Notification } = require('../models/index');
    const { merchant_id, order_id, payment_id, payhere_amount, payhere_currency, status_code, md5sig } = req.body;

    const gw = await PaymentGateway.findOne({ gateway: 'payhere' });
    if (!gw) return res.sendStatus(400);

    const crypto = require('crypto');
    const hashedSecret = crypto.createHash('md5').update(gw.config.merchantSecret).digest('hex').toUpperCase();
    const localMd5 = crypto.createHash('md5')
      .update(`${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${hashedSecret}`)
      .digest('hex').toUpperCase();

    if (localMd5 !== md5sig) {
      console.error('PayHere signature mismatch');
      return res.sendStatus(400);
    }

    if (status_code === '2') { // Success
      const order = await Order.findByIdAndUpdate(order_id, {
        paymentStatus: 'paid',
        orderStatus: 'confirmed',
        paymentReference: payment_id,
        $push: { statusHistory: { status: 'confirmed', note: `Payment confirmed via PayHere (${payment_id})`, updatedBy: 'payhere' } }
      }, { new: true });

      if (order) {
        await Notification.create({
          type: 'new_order', title: '✅ PayHere Payment Confirmed',
          message: `Order ${order.orderNumber} — Rs. ${order.total?.toLocaleString()}`,
          link: `/admin/orders/${order._id}`
        });
      }
    } else if (status_code === '0') {
      await Order.findByIdAndUpdate(order_id, { paymentStatus: 'pending' });
    } else if (status_code === '-1' || status_code === '-2' || status_code === '-3') {
      await Order.findByIdAndUpdate(order_id, {
        paymentStatus: 'failed',
        orderStatus: 'cancelled',
        $push: { statusHistory: { status: 'cancelled', note: `Payment failed/cancelled via PayHere`, updatedBy: 'payhere' } }
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('PayHere notify error:', err);
    res.sendStatus(500);
  }
});

// ── Stripe Payment Intent ───────────────────────────────────────────────────
router.post('/stripe/create-intent', async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: 'stripe', isEnabled: true });
    if (!gw || !gw.config?.secretKey) return res.status(400).json({ message: 'Stripe not configured' });

    const stripe = require('stripe')(gw.config.secretKey);
    const { amount, currency = 'usd', orderId } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency,
      metadata: { orderId }
    });

    res.json({ clientSecret: paymentIntent.client_secret, publicKey: gw.config.publicKey });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Stripe Webhook ──────────────────────────────────────────────────────────
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const Order = require('../models/Order');
    const { Notification } = require('../models/index');
    const gw = await PaymentGateway.findOne({ gateway: 'stripe' });
    if (!gw) return res.sendStatus(400);

    const stripe = require('stripe')(gw.config.secretKey);
    const sig = req.headers['stripe-signature'];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, gw.config.webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const orderId = event.data.object.metadata?.orderId;
      if (orderId) {
        const order = await Order.findByIdAndUpdate(orderId, {
          paymentStatus: 'paid', orderStatus: 'confirmed',
          paymentReference: event.data.object.id,
          $push: { statusHistory: { status: 'confirmed', note: `Payment confirmed via Stripe`, updatedBy: 'stripe' } }
        }, { new: true });
        if (order) {
          await Notification.create({
            type: 'new_order', title: '✅ Stripe Payment Confirmed',
            message: `Order ${order.orderNumber}`, link: `/admin/orders/${order._id}`
          });
        }
      }
    }

    res.json({ received: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PayPal Capture ──────────────────────────────────────────────────────────
// Called by frontend after PayPal JS SDK approves the order, to verify
// the capture server-side and mark the order as paid.
router.post('/paypal/capture', async (req, res) => {
  try {
    const Order = require('../models/Order');
    const { Notification } = require('../models/index');
    const gw = await PaymentGateway.findOne({ gateway: 'paypal', isEnabled: true });
    if (!gw || !gw.config?.clientId || !gw.config?.clientSecret) {
      return res.status(400).json({ message: 'PayPal not configured' });
    }

    const { captureId, orderId } = req.body;
    if (!captureId || !orderId) {
      return res.status(400).json({ message: 'captureId and orderId are required' });
    }

    // Verify the capture with PayPal REST API
    const baseUrl = gw.isLive
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    // Get PayPal access token
    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${gw.config.clientId}:${gw.config.clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) {
      const tokenErr = await tokenRes.text();
      console.error('PayPal token error:', tokenErr);
      return res.status(400).json({ message: 'Could not authenticate with PayPal' });
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Verify the capture
    const captureRes = await fetch(`${baseUrl}/v2/payments/captures/${captureId}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!captureRes.ok) {
      const captureErr = await captureRes.text();
      console.error('PayPal capture verify error:', captureErr);
      return res.status(400).json({ message: 'Could not verify PayPal capture' });
    }
    const capture = await captureRes.json();

    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ message: `PayPal capture status: ${capture.status}` });
    }

    // Mark order as paid
    const order = await Order.findByIdAndUpdate(orderId, {
      paymentStatus: 'paid',
      orderStatus: 'confirmed',
      paymentReference: captureId,
      $push: {
        statusHistory: {
          status: 'confirmed',
          note: `Payment confirmed via PayPal (${captureId})`,
          updatedBy: 'paypal',
        }
      }
    }, { new: true });

    if (order) {
      await Notification.create({
        type: 'new_order',
        title: '✅ PayPal Payment Confirmed',
        message: `Order ${order.orderNumber}`,
        link: `/admin/orders/${order._id}`,
      });
    }

    res.json({ success: true, orderId });
  } catch (err) {
    console.error('PayPal capture error:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;