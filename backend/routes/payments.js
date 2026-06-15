const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { PaymentGateway } = require('../models/index');
const { adminAuth } = require('../middleware/auth');

// ── Public: get enabled gateways (no secrets) ────────────────────────────────
router.get('/gateways', async (req, res) => {
  try {
    const gateways = await PaymentGateway.find({ isEnabled: true });
    const safe = gateways.map(g => ({
      _id:                 g._id,
      gateway:             g.gateway,
      displayName:         g.displayName,
      description:         g.description,
      logo:                g.logo,
      isLive:              g.isLive,
      supportedCurrencies: g.supportedCurrencies,
      publicKey:           g.config?.publicKey || g.config?.merchantId || g.config?.clientId || null,
    }));
    res.json(safe);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin: get all gateways with full config ──────────────────────────────────
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const gateways = await PaymentGateway.find().sort({ gateway: 1 });
    res.json(gateways);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Admin: save/update a gateway config ──────────────────────────────────────
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

// ── Admin: toggle gateway on/off ──────────────────────────────────────────────
router.put('/admin/:gateway/toggle', adminAuth, async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: req.params.gateway });
    if (!gw) return res.status(404).json({ message: 'Gateway not found' });
    gw.isEnabled = !gw.isEnabled;
    await gw.save();
    res.json(gw);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PayHere: helper to build hash ────────────────────────────────────────────
function buildPayHereHash(merchantId, orderId, amount, currency, merchantSecret) {
  const amountFormatted = parseFloat(amount).toFixed(2);
  const hashedSecret    = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
  const hashInput       = merchantId + orderId + amountFormatted + currency + hashedSecret;
  const hash            = crypto.createHash('md5').update(hashInput).digest('hex').toUpperCase();
  console.log('[PayHere] merchantId :', JSON.stringify(merchantId));
  console.log('[PayHere] orderId    :', JSON.stringify(orderId));
  console.log('[PayHere] amount     :', amountFormatted);
  console.log('[PayHere] currency   :', currency);
  console.log('[PayHere] hashInput  :', hashInput);
  console.log('[PayHere] hash       :', hash);
  return { hash, amountFormatted };
}

// ── PayHere Preflight — generate hash WITHOUT creating an order ───────────────
// Frontend calls this first. Order is only created in /orders AFTER onCompleted.
router.post('/payhere/preflight', async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: 'payhere', isEnabled: true });
    if (!gw?.config?.merchantId) return res.status(400).json({ message: 'PayHere not configured' });

    const { amount, currency = 'LKR', customerName, email, phone, address, city, country } = req.body;

    const merchantId     = (gw.config.merchantId     || '').trim();
    const merchantSecret = (gw.config.merchantSecret || '').trim();
    if (!merchantId || !merchantSecret) {
      return res.status(400).json({ message: 'PayHere merchant credentials are incomplete' });
    }

    // Timestamp-based id — unique, short, alphanumeric
    const payhereOrderId          = 'ORD' + Date.now().toString().slice(-12);
    const { hash, amountFormatted } = buildPayHereHash(merchantId, payhereOrderId, amount, currency, merchantSecret);
    const backendUrl              = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;

    res.json({
      sandbox:    !gw.isLive,
      merchantId,
      orderId:    payhereOrderId,
      items:      'Order Payment',
      amount:     amountFormatted,
      currency,
      hash,
      firstName:  (customerName || '').split(' ')[0] || '',
      lastName:   (customerName || '').split(' ').slice(1).join(' ') || '',
      email:      email   || '',
      phone:      phone   || '',
      address:    address || '',
      city:       city    || '',
      country:    country || 'Sri Lanka',
      notifyUrl:  `${backendUrl}/api/payments/payhere/notify`,
    });
  } catch (err) {
    console.error('[PayHere preflight] error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── PayHere Init (legacy — order already created, just get hash) ──────────────
router.post('/payhere/init', async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: 'payhere', isEnabled: true });
    if (!gw?.config?.merchantId) return res.status(400).json({ message: 'PayHere not configured' });

    const Order = require('../models/Order');
    const { orderId, amount, currency = 'LKR', customerName, email, phone, address, city, country } = req.body;

    const merchantId     = (gw.config.merchantId     || '').trim();
    const merchantSecret = (gw.config.merchantSecret || '').trim();
    if (!merchantId || !merchantSecret) {
      return res.status(400).json({ message: 'PayHere merchant credentials are incomplete' });
    }

    const payhereOrderId            = 'ORD' + String(orderId).slice(-12);
    const { hash, amountFormatted } = buildPayHereHash(merchantId, payhereOrderId, amount, currency, merchantSecret);
    const backendUrl                = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;

    await Order.findByIdAndUpdate(orderId, { payhereOrderId }).catch(() => {});

    res.json({
      sandbox:      !gw.isLive,
      merchantId,
      orderId:      payhereOrderId,
      _shopOrderId: orderId,
      items:        `Order ${payhereOrderId}`,
      amount:       amountFormatted,
      currency,
      hash,
      firstName:    (customerName || '').split(' ')[0] || '',
      lastName:     (customerName || '').split(' ').slice(1).join(' ') || '',
      email:        email   || '',
      phone:        phone   || '',
      address:      address || '',
      city:         city    || '',
      country:      country || 'Sri Lanka',
      notifyUrl:    `${backendUrl}/api/payments/payhere/notify`,
    });
  } catch (err) {
    console.error('[PayHere init] error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── PayHere Return (closes popup if used) ────────────────────────────────────
router.get('/payhere/return', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Payment Complete</title></head><body>
    <p style="font-family:sans-serif;text-align:center;margin-top:40px">Payment complete. This window will close shortly…</p>
    <script>try{window.close();}catch(e){} setTimeout(function(){window.close();},1000);</script>
  </body></html>`);
});

// ── PayHere Notify (webhook from PayHere server) ──────────────────────────────
router.post('/payhere/notify', async (req, res) => {
  try {
    const Order        = require('../models/Order');
    const { Notification } = require('../models/index');
    const { merchant_id, order_id, payment_id, payhere_amount, payhere_currency, status_code, md5sig } = req.body;

    const gw = await PaymentGateway.findOne({ gateway: 'payhere' });
    if (!gw) return res.sendStatus(400);

    const merchantSecret = (gw.config.merchantSecret || '').trim();
    const hashedSecret   = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const localMd5       = crypto.createHash('md5')
      .update(`${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${hashedSecret}`)
      .digest('hex').toUpperCase();

    if (localMd5 !== md5sig) {
      console.error('[PayHere notify] Signature mismatch. local:', localMd5, 'received:', md5sig);
      return res.sendStatus(400);
    }

    const query = { $or: [{ payhereOrderId: order_id }] };

    if (status_code === '2') {
      const order = await Order.findOneAndUpdate(query, {
        paymentStatus: 'paid', orderStatus: 'confirmed', paymentReference: payment_id,
        $push: { statusHistory: { status: 'confirmed', note: `PayHere payment confirmed (${payment_id})`, updatedBy: 'payhere' } }
      }, { new: true });
      if (order) {
        await Notification.create({
          type: 'new_order', title: '✅ PayHere Payment Confirmed',
          message: `Order ${order.orderNumber} — Rs. ${order.total?.toLocaleString()}`,
          link: `/admin/orders/${order._id}`,
        });
      }
    } else if (status_code === '0') {
      await Order.findOneAndUpdate(query, { paymentStatus: 'pending' });
    } else if (['-1', '-2', '-3'].includes(status_code)) {
      await Order.findOneAndUpdate(query, {
        paymentStatus: 'failed', orderStatus: 'cancelled',
        $push: { statusHistory: { status: 'cancelled', note: `PayHere payment failed/cancelled`, updatedBy: 'payhere' } }
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[PayHere notify] error:', err);
    res.sendStatus(500);
  }
});

// ── Stripe: create payment intent ────────────────────────────────────────────
router.post('/stripe/create-intent', async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: 'stripe', isEnabled: true });
    if (!gw?.config?.secretKey) return res.status(400).json({ message: 'Stripe not configured' });

    const stripe = require('stripe')(gw.config.secretKey);
    const { amount, currency = 'usd', orderId } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(parseFloat(amount) * 100),
      currency,
      metadata: orderId ? { orderId } : {},
    });

    res.json({ clientSecret: paymentIntent.client_secret, publicKey: gw.config.publicKey });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── Stripe webhook ────────────────────────────────────────────────────────────
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const Order        = require('../models/Order');
    const { Notification } = require('../models/index');
    const gw = await PaymentGateway.findOne({ gateway: 'stripe' });
    if (!gw) return res.sendStatus(400);

    const stripe = require('stripe')(gw.config.secretKey);
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], gw.config.webhookSecret);
    } catch (err) { return res.status(400).send(`Webhook Error: ${err.message}`); }

    if (event.type === 'payment_intent.succeeded') {
      const orderId = event.data.object.metadata?.orderId;
      if (orderId) {
        const order = await Order.findByIdAndUpdate(orderId, {
          paymentStatus: 'paid', orderStatus: 'confirmed',
          paymentReference: event.data.object.id,
          $push: { statusHistory: { status: 'confirmed', note: 'Stripe payment confirmed', updatedBy: 'stripe' } }
        }, { new: true });
        if (order) {
          await Notification.create({
            type: 'new_order', title: '✅ Stripe Payment Confirmed',
            message: `Order ${order.orderNumber}`, link: `/admin/orders/${order._id}`,
          });
        }
      }
    }
    res.json({ received: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PayPal capture ────────────────────────────────────────────────────────────
router.post('/paypal/capture', async (req, res) => {
  try {
    const Order        = require('../models/Order');
    const { Notification } = require('../models/index');
    const gw = await PaymentGateway.findOne({ gateway: 'paypal', isEnabled: true });
    if (!gw?.config?.clientId || !gw?.config?.clientSecret) {
      return res.status(400).json({ message: 'PayPal not configured' });
    }

    const { captureId, orderId } = req.body;
    if (!captureId || !orderId) return res.status(400).json({ message: 'captureId and orderId are required' });

    const baseUrl = gw.isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

    const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${gw.config.clientId}:${gw.config.clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) return res.status(400).json({ message: 'Could not authenticate with PayPal' });
    const { access_token } = await tokenRes.json();

    const captureRes = await fetch(`${baseUrl}/v2/payments/captures/${captureId}`, {
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    });
    if (!captureRes.ok) return res.status(400).json({ message: 'Could not verify PayPal capture' });
    const capture = await captureRes.json();
    if (capture.status !== 'COMPLETED') return res.status(400).json({ message: `PayPal capture status: ${capture.status}` });

    const order = await Order.findByIdAndUpdate(orderId, {
      paymentStatus: 'paid', orderStatus: 'confirmed', paymentReference: captureId,
      $push: { statusHistory: { status: 'confirmed', note: `PayPal payment confirmed (${captureId})`, updatedBy: 'paypal' } }
    }, { new: true });

    if (order) {
      await Notification.create({
        type: 'new_order', title: '✅ PayPal Payment Confirmed',
        message: `Order ${order.orderNumber}`, link: `/admin/orders/${order._id}`,
      });
    }

    res.json({ success: true, orderId });
  } catch (err) {
    console.error('[PayPal capture] error:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;