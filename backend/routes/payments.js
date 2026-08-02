const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');
const { PaymentGateway } = require('../models/index');
const { adminAuth } = require('../middleware/auth');

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Prevent brute-force / enumeration attacks on payment endpoints
const paymentInitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,                    // max 20 payment init attempts per IP
  message: { message: 'Too many payment requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,   // 1 minute
  max: 100,                   // webhooks can be high-volume
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Security helpers ──────────────────────────────────────────────────────────

// Constant-time string comparison — prevents timing attacks on signature checks
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still do comparison to avoid timing leak on length
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Validate amount — must be a positive number with max 2 decimal places
function validateAmount(amount) {
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0 || n > 10000000) return null; // max Rs. 10M sanity cap
  return n.toFixed(2);
}

// Sanitise string fields coming from user input before sending to gateways
function sanitise(str, maxLen = 100) {
  if (str == null) return '';
  return String(str).replace(/[<>"']/g, '').trim().slice(0, maxLen);
}

// Verify the request comes from an authenticated user (not just any visitor)
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authentication required to initiate payment' });
  }
  try {
    const jwt = require('jsonwebtoken');
    req.user = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired session. Please log in again.' });
  }
}

// ── Public: get enabled gateways (no secrets ever exposed) ───────────────────
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
      // Only expose the public/non-secret key
      publicKey: g.config?.publicKey || g.config?.merchantId || g.config?.clientId || null,
      providerLogo: g.config?.logoUrl || g.logo || null,
      installmentPlans: g.config?.installmentPlans ? g.config.installmentPlans.filter(p => p.active !== false).map(p => ({ ...p, provider: p.provider || g.gateway, providerLogo: p.providerLogo || g.config?.logoUrl || g.logo || null })) : undefined,
      // NEVER include: secretKey, merchantSecret, clientSecret, webhookSecret
    }));
    res.json(safe);
  } catch (err) {
    console.error('[gateways]', err);
    res.status(500).json({ message: 'Could not load payment methods' });
  }
});

// Public installment quote for a product. Uses the same public coupon rules
// as the Google feed, then lets the client display each configured plan using
//: (discounted product price × (1 + interest%)) ÷ months.
router.get('/installment-quote/:productId', async (req, res) => {
  try {
    const Product = require('../models/Product');
    const { Coupon } = require('../models/index');
    const { publicGooglePrice } = require('../services/publicGooglePricing');
    if (!require('mongoose').isValidObjectId(req.params.productId)) return res.status(400).json({ message: 'Invalid product' });
    const product = await Product.findOne({ _id: req.params.productId, isActive: true }).populate('category', '_id').lean();
    if (!product) return res.status(404).json({ message: 'Product not found' });
    const [coupons, gateways] = await Promise.all([
      Coupon.find({ isActive: true }).lean(),
      PaymentGateway.find({ isEnabled: true }).lean(),
    ]);
    const quote = publicGooglePrice(product, coupons);
    const plans = gateways.flatMap(g => (g.config?.installmentPlans || [])
      .filter(p => p.active !== false)
      .map(p => {
        const plan = { ...(p.toObject ? p.toObject() : p), provider: p.provider || g.gateway, providerLogo: p.providerLogo || g.config?.logoUrl || g.logo || null };
        const months = Math.max(1, Number(plan.months) || 1);
        const interestRate = Number(plan.interestRate || 0);
        const totalPayable = Math.round((Number(quote.publicSalePrice || quote.price) * (1 + interestRate / 100)) * 100) / 100;
        return { ...plan, months, interestRate, totalPayable, monthlyAmount: Math.round((totalPayable / months) * 100) / 100 };
      }));
    res.json({ amount: quote.publicSalePrice || quote.price, originalAmount: quote.price, discounted: Boolean(quote.publicSalePrice), plans });
  } catch (err) {
    console.error('[installment quote]', err.message);
    res.status(500).json({ message: 'Could not calculate installment quote' });
  }
});

// Payzy uses a signed server-to-server initiation and callback verification.
const PAYZY_FIELDS = ['x_test_mode','x_shopid','x_amount','x_order_id','x_response_url','x_first_name','x_last_name','x_company','x_address','x_country','x_state','x_city','x_zip','x_phone','x_email','x_ship_to_first_name','x_ship_to_last_name','x_ship_to_company','x_ship_to_address','x_ship_to_country','x_ship_to_state','x_ship_to_city','x_ship_to_zip','x_freight','x_platform','x_version','signed_field_names'];
const payzyValue = v => String(v ?? '').replace(/[\r\n]/g, ' ').trim();
function payzySignature(data, secret, responseCode) {
  const names = responseCode !== undefined ? ['response_code', ...PAYZY_FIELDS] : PAYZY_FIELDS;
  const values = names.map(name => `${name}=${payzyValue(name === 'response_code' ? responseCode : data[name])}`);
  return crypto.createHmac('sha256', secret).update(values.join(',')).digest('base64');
}
// Payzy's supplied custom-web sample uses a legacy request-signature format:
// the x_version segment is `,x_version1.0` (without `=`). The callback sample
// uses the normal `x_version=1.0` format, so only initiation uses this helper.
function payzyInitSignature(data, secret) {
  const names = PAYZY_FIELDS;
  const values = names.map(name => name === 'x_version'
    ? `${name}${payzyValue(data[name])}`
    : `${name}=${payzyValue(data[name])}`);
  return crypto.createHmac('sha256', secret).update(values.join(',')).digest('base64');
}
router.post('/payzy/init', requireAuth, paymentInitLimiter, async (req,res) => {
  let order;
  let upstreamEndpoint = '';
  let rolledBack = false;
  const rollbackOrder = async () => {
    if (!order || rolledBack) return;
    rolledBack = true;
    const Product = require('../models/Product');
    for (const item of order.items || []) {
      await Product.findByIdAndUpdate(item.product, { $inc: { stock: Number(item.quantity) || 0, soldCount: -(Number(item.quantity) || 0) } });
    }
    await require('../models/Order').findByIdAndDelete(order._id);
    const { Notification } = require('../models/index');
    await Notification.deleteMany({ 'data.orderId': order._id });
  };
  try {
    const { orderId } = req.body; order = await require('../models/Order').findById(orderId);
    const gw = await PaymentGateway.findOne({gateway:'payzy',isEnabled:true});
    if (!order || order.paymentMethod !== 'payzy' || (order.customer && String(order.customer) !== String(req.user.id))) return res.status(404).json({message:'Payzy order not found'});
    if (!gw?.config?.shopId || !gw?.config?.secretKey) return res.status(503).json({message:'Payzy is not fully configured.'});
    const base = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'https://shopzen.lk';
    const b = order.billing || {}, s = order.shipping || b, company = sanitise(gw.config.companyName || 'ShopZen');
    const data={x_test_mode:gw.isLive?'off':'on',x_shopid:payzyValue(gw.config.shopId),x_amount:Number(order.total).toFixed(2),x_order_id:payzyValue(order.orderNumber),x_response_url:`${base}/api/payments/payzy/response`,x_first_name:sanitise(b.firstName),x_last_name:sanitise(b.lastName),x_company:company,x_address:sanitise(b.street),x_country:sanitise(b.country),x_state:sanitise(b.state),x_city:sanitise(b.city),x_zip:sanitise(b.zip),x_phone:sanitise(b.phone),x_email:sanitise(b.email),x_ship_to_first_name:sanitise(s.firstName||b.firstName),x_ship_to_last_name:sanitise(s.lastName||b.lastName),x_ship_to_company:company,x_ship_to_address:sanitise(s.street||b.street),x_ship_to_country:sanitise(s.country||b.country),x_ship_to_state:sanitise(s.state||b.state),x_ship_to_city:sanitise(s.city||b.city),x_ship_to_zip:sanitise(s.zip||b.zip),x_freight:Number(order.shippingCost||0).toFixed(2),x_platform:'custom',x_version:'1.0'};
    data.signed_field_names=PAYZY_FIELDS.join(','); data.signature=payzyInitSignature(data,gw.config.secretKey); await require('../models/Order').findByIdAndUpdate(order._id,{paymentMetadata:data}); const payzyBaseUrl=gw.isLive?'https://api.payzy.lk':'https://api.payzypay.xyz'; upstreamEndpoint=`${payzyBaseUrl}/checkout/custom-checkout`; const response=await fetch(upstreamEndpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}); const raw=await response.text(); let json={}; try{json=JSON.parse(raw)}catch{} const checkoutUrl=(typeof json==='string'?json:'')||json?.data?.url||json?.data?.redirect_url||json?.data?.checkout_url||json?.data?.data?.url||json?.response?.data?.url||json?.url||json?.redirect_url||json?.checkout_url||(raw.match(/https?:\/\/[^\s"'<>]+/i)||[])[0]; if(!response.ok||!checkoutUrl) { console.error('[Payzy init] Unexpected response',{endpoint:upstreamEndpoint,status:response.status,body:raw.slice(0,1000)}); await rollbackOrder(); return res.status(502).json({message:`Payzy production API returned HTTP ${response.status} without a checkout URL. The order was cancelled.`}); } res.json({url:checkoutUrl});
  } catch(e){console.error('[Payzy init]',{endpoint:upstreamEndpoint,error:e.message}); try { await rollbackOrder(); } catch (rollbackError) { console.error('[Payzy rollback]', rollbackError.message); } res.status(502).json({message:`Could not connect to Payzy${upstreamEndpoint ? ` (${upstreamEndpoint})` : ''}. The order was cancelled.`});}
});
router.post('/payzy/abort', requireAuth, async (req,res) => { try { const Order=require('../models/Order'); const Product=require('../models/Product'); const order=await Order.findOne({_id:req.body.orderId,customer:req.user.id,paymentMethod:'payzy',paymentStatus:'pending'}); if(order){for(const item of order.items||[]) await Product.findByIdAndUpdate(item.product,{$inc:{stock:Number(item.quantity)||0,soldCount:-(Number(item.quantity)||0)}}); await Order.deleteOne({_id:order._id});} res.json({success:true}); } catch(e){res.status(500).json({message:'Could not cancel Payzy draft order'});} });
async function handlePayzyResponse(req, res) {
  const params = { ...(req.query || {}), ...(req.body || {}) };
  const frontendUrl = (process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || 'https://shopzen.lk').replace(/\/$/, '');
  try {
    const Order = require('../models/Order');
    const order = await Order.findOne({ orderNumber: params.x_order_id, paymentMethod: 'payzy' });
    const gw = await PaymentGateway.findOne({ gateway: 'payzy' });
    const suppliedSignature = String(params.signature || '').replace(/ /g, '+');
    const signedData = order?.paymentMetadata || (order ? orderToPayzy(order, params) : params);
    const valid = Boolean(order && gw?.config?.secretKey && String(params.response_code) === '00' && suppliedSignature && safeEqual(
      payzySignature(signedData, gw.config.secretKey, params.response_code), suppliedSignature
    ));

    let confirmed = false;
    if (valid) {
      // Idempotent transition: repeated Payzy redirects cannot duplicate the
      // payment reference or status history.
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, paymentMethod: 'payzy', paymentStatus: { $ne: 'paid' } },
        { $set: { paymentStatus: 'paid', orderStatus: 'confirmed', paymentReference: String(params.x_order_id) }, $push: { statusHistory: { status: 'confirmed', note: 'Payment confirmed via Payzy', updatedBy: 'payzy' } } },
        { new: true }
      );
      confirmed = Boolean(updated) || order.paymentStatus === 'paid';
      console.log(`[PAYZY CALLBACK] ${order.orderNumber} signature verified; order ${confirmed ? 'confirmed' : 'already confirmed'}`);
    } else {
      console.error('[PAYZY CALLBACK] Verification failed', { orderId: params.x_order_id, responseCode: params.response_code, hasSignature: Boolean(suppliedSignature) });
    }

    return res.redirect(`${frontendUrl}/my-orders?new=${order?._id || ''}&payment=payzy&status=${confirmed ? 'success' : 'failed'}`);
  } catch (error) {
    console.error('[PAYZY CALLBACK]', error.message);
    return res.redirect(`${frontendUrl}/checkout?payment=failed`);
  }
}
router.get('/payzy/response', handlePayzyResponse);
router.post('/payzy/response', handlePayzyResponse);
function orderToPayzy(order,q){const b=order.billing||{},s=order.shipping||b;return {x_test_mode:q.x_test_mode||'off',x_shopid:q.x_shopid||'',x_amount:Number(order.total).toFixed(2),x_order_id:order.orderNumber,x_response_url:q.x_response_url||'',x_first_name:b.firstName,x_last_name:b.lastName,x_company:'ShopZen',x_address:b.street,x_country:b.country,x_state:'',x_city:b.city,x_zip:'',x_phone:b.phone,x_email:b.email,x_ship_to_first_name:s.firstName,x_ship_to_last_name:s.lastName,x_ship_to_company:'ShopZen',x_ship_to_address:s.street,x_ship_to_country:s.country,x_ship_to_state:'',x_ship_to_city:s.city,x_ship_to_zip:'',x_freight:Number(order.shippingCost||0).toFixed(2),x_platform:'custom',x_version:'1.0',signed_field_names:PAYZY_FIELDS.join(',')};}

// ── Admin: get all gateways with full config ──────────────────────────────────
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const gateways = await PaymentGateway.find().sort({ gateway: 1 });
    res.json(gateways);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

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

router.put('/admin/:gateway/toggle', adminAuth, async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: req.params.gateway });
    if (!gw) return res.status(404).json({ message: 'Gateway not found' });
    gw.isEnabled = !gw.isEnabled;
    await gw.save();
    res.json(gw);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// ── PayHere: hash builder (server-side only, never sent with merchantSecret) ──
function buildPayHereHash(merchantId, orderId, amount, currency, merchantSecret) {
  const amountFormatted = parseFloat(amount).toFixed(2);
  const hashedSecret    = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
  const hashInput       = merchantId + orderId + amountFormatted + currency + hashedSecret;
  const hash            = crypto.createHash('md5').update(hashInput).digest('hex').toUpperCase();
  // Log only non-sensitive fields
  console.log('[PayHere] orderId:', orderId, '| amount:', amountFormatted, '| currency:', currency);
  return { hash, amountFormatted };
}

// ── PayHere Preflight ─────────────────────────────────────────────────────────
// Generates hash only. No order created. Requires authentication.
// Rate limited to prevent hash-fishing attacks.
router.post('/payhere/preflight', requireAuth, paymentInitLimiter, async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: 'payhere', isEnabled: true });
    if (!gw?.config?.merchantId) return res.status(400).json({ message: 'PayHere not configured' });

    const { amount, currency = 'LKR', customerName, email, phone, address, city, country } = req.body;

    // Validate amount server-side — never trust the client value
    const amountValidated = validateAmount(amount);
    if (!amountValidated) return res.status(400).json({ message: 'Invalid payment amount' });

    // Validate currency whitelist
    const allowedCurrencies = ['LKR', 'USD', 'GBP', 'EUR', 'AUD'];
    const safeCurrency = allowedCurrencies.includes(currency) ? currency : 'LKR';

    const merchantId     = (gw.config.merchantId     || '').trim();
    const merchantSecret = (gw.config.merchantSecret || '').trim();
    if (!merchantId || !merchantSecret) {
      return res.status(400).json({ message: 'PayHere merchant credentials are incomplete' });
    }

    // Cryptographically random order id — not guessable or sequential
    const randomPart     = crypto.randomBytes(6).toString('hex').toUpperCase();
    const payhereOrderId = 'ORD' + randomPart;

    const { hash, amountFormatted } = buildPayHereHash(merchantId, payhereOrderId, amountValidated, safeCurrency, merchantSecret);
    const backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;

    res.json({
      sandbox:    !gw.isLive,
      merchantId,
      orderId:    payhereOrderId,
      items:      'Order Payment',
      amount:     amountFormatted,
      currency:   safeCurrency,
      hash,
      // Sanitise all user-supplied strings before passing to PayHere
      firstName:  sanitise((customerName || '').split(' ')[0], 50),
      lastName:   sanitise((customerName || '').split(' ').slice(1).join(' '), 50),
      email:      sanitise(email, 100),
      phone:      sanitise(phone, 20),
      address:    sanitise(address, 200),
      city:       sanitise(city, 100),
      country:    sanitise(country, 100) || 'Sri Lanka',
      notifyUrl:  `${backendUrl}/api/payments/payhere/notify`,
    });
  } catch (err) {
    console.error('[PayHere preflight]', err.message);
    res.status(500).json({ message: 'Payment initialisation failed' }); // no internal detail
  }
});

// ── PayHere Return ────────────────────────────────────────────────────────────
router.get('/payhere/return', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Payment Complete</title>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">
    </head><body>
    <p style="font-family:sans-serif;text-align:center;margin-top:40px">Payment complete. This window will close shortly…</p>
    <script>try{window.close();}catch(e){} setTimeout(function(){window.close();},1000);</script>
  </body></html>`);
});

// ── PayHere Notify (webhook — called by PayHere servers, NOT the browser) ────
// SECURITY: This endpoint is called by PayHere's servers, not by the customer.
// We verify the MD5 signature using constant-time comparison before trusting it.
// No authentication header is possible here (PayHere calls it server-to-server).
router.post('/payhere/notify', webhookLimiter, async (req, res) => {
  try {
    const Order            = require('../models/Order');
    const { Notification } = require('../models/index');

    const {
      merchant_id, order_id, payment_id,
      payhere_amount, payhere_currency,
      status_code, md5sig,
    } = req.body;

    // Reject if required fields are missing
    if (!merchant_id || !order_id || !status_code || !md5sig) {
      return res.sendStatus(400);
    }

    const gw = await PaymentGateway.findOne({ gateway: 'payhere' });
    if (!gw) return res.sendStatus(400);

    // Verify merchant_id matches ours — prevents spoofed webhooks for other merchants
    if (!safeEqual(merchant_id.trim(), (gw.config.merchantId || '').trim())) {
      console.warn('[PayHere notify] merchant_id mismatch');
      return res.sendStatus(400);
    }

    const merchantSecret = (gw.config.merchantSecret || '').trim();
    const hashedSecret   = crypto.createHash('md5').update(merchantSecret).digest('hex').toUpperCase();
    const localMd5       = crypto.createHash('md5')
      .update(`${merchant_id}${order_id}${payhere_amount}${payhere_currency}${status_code}${hashedSecret}`)
      .digest('hex').toUpperCase();

    // Constant-time comparison — prevents timing attacks
    if (!safeEqual(localMd5, (md5sig || '').toUpperCase())) {
      console.warn('[PayHere notify] Signature mismatch for order:', order_id);
      return res.sendStatus(400);
    }

    // Validate status_code is a known value
    const validCodes = ['2', '0', '-1', '-2', '-3'];
    if (!validCodes.includes(status_code)) {
      console.warn('[PayHere notify] Unknown status_code:', status_code);
      return res.sendStatus(400);
    }

    const query = { payhereOrderId: order_id };

    if (status_code === '2') {
      // PAID — only update if currently not already paid (idempotent)
      const order = await Order.findOneAndUpdate(
        { ...query, paymentStatus: { $ne: 'paid' } },
        {
          paymentStatus: 'paid',
          orderStatus:   'confirmed',
          paymentReference: payment_id,
          $push: { statusHistory: { status: 'confirmed', note: `PayHere payment confirmed (${payment_id})`, updatedBy: 'payhere-webhook' } }
        },
        { new: true }
      );
      if (order) {
        await Notification.create({
          type: 'new_order', title: '✅ PayHere Payment Confirmed',
          message: `Order ${order.orderNumber} — Rs. ${order.total?.toLocaleString()}`,
          link: `/admin/orders/${order._id}`,
        });
      }
    } else if (status_code === '0') {
      // Pending / processing
      await Order.findOneAndUpdate(query, {
        paymentStatus: 'pending',
        $push: { statusHistory: { status: 'pending', note: 'PayHere payment pending', updatedBy: 'payhere-webhook' } }
      });
    } else {
      // Failed / cancelled / chargebacked (-1, -2, -3)
      await Order.findOneAndUpdate(
        { ...query, paymentStatus: { $ne: 'paid' } }, // never downgrade a confirmed payment
        {
          paymentStatus: 'failed',
          orderStatus:   'cancelled',
          $push: { statusHistory: { status: 'cancelled', note: `PayHere payment failed/cancelled (code ${status_code})`, updatedBy: 'payhere-webhook' } }
        }
      );
    }

    // Always respond 200 to PayHere — otherwise they retry indefinitely
    res.sendStatus(200);
  } catch (err) {
    console.error('[PayHere notify]', err.message);
    res.sendStatus(500);
  }
});

// ── Stripe: create payment intent ─────────────────────────────────────────────
// Requires auth — prevents anonymous users from creating intents
router.post('/stripe/create-intent', requireAuth, paymentInitLimiter, async (req, res) => {
  try {
    const gw = await PaymentGateway.findOne({ gateway: 'stripe', isEnabled: true });
    if (!gw?.config?.secretKey) return res.status(400).json({ message: 'Stripe not configured' });

    const { amount, currency = 'usd' } = req.body;

    const amountValidated = validateAmount(amount);
    if (!amountValidated) return res.status(400).json({ message: 'Invalid payment amount' });

    const allowedCurrencies = ['lkr', 'usd', 'gbp', 'eur', 'aud', 'sgd'];
    const safeCurrency = allowedCurrencies.includes(currency.toLowerCase()) ? currency.toLowerCase() : 'usd';

    const stripe = require('stripe')(gw.config.secretKey);
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(parseFloat(amountValidated) * 100), // cents
      currency: safeCurrency,
      // No orderId in metadata — order doesn't exist yet at this point
      metadata: { userId: req.user.id, initiatedAt: new Date().toISOString() },
    });

    res.json({ clientSecret: paymentIntent.client_secret, publicKey: gw.config.publicKey });
  } catch (err) {
    console.error('[Stripe create-intent]', err.message);
    res.status(500).json({ message: 'Could not initialise payment' });
  }
});

// ── Stripe webhook ────────────────────────────────────────────────────────────
// Raw body required for Stripe signature verification
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), webhookLimiter, async (req, res) => {
  try {
    const Order            = require('../models/Order');
    const { Notification } = require('../models/index');
    const gw = await PaymentGateway.findOne({ gateway: 'stripe' });
    if (!gw) return res.sendStatus(400);

    const stripe = require('stripe')(gw.config.secretKey);
    let event;
    try {
      // Stripe's own signature verification — cryptographically secure
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        gw.config.webhookSecret
      );
    } catch (err) {
      console.warn('[Stripe webhook] signature failed:', err.message);
      return res.status(400).send(`Webhook signature verification failed`);
    }

    if (event.type === 'payment_intent.succeeded') {
      const orderId = event.data.object.metadata?.orderId;
      if (orderId) {
        const order = await Order.findByIdAndUpdate(
          orderId,
          {
            paymentStatus:    'paid',
            orderStatus:      'confirmed',
            paymentReference: event.data.object.id,
            $push: { statusHistory: { status: 'confirmed', note: 'Stripe payment confirmed via webhook', updatedBy: 'stripe-webhook' } }
          },
          { new: true }
        );
        if (order) {
          await Notification.create({
            type: 'new_order', title: '✅ Stripe Payment Confirmed',
            message: `Order ${order.orderNumber}`, link: `/admin/orders/${order._id}`,
          });
        }
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const orderId = event.data.object.metadata?.orderId;
      if (orderId) {
        await Order.findByIdAndUpdate(orderId, {
          paymentStatus: 'failed',
          $push: { statusHistory: { status: 'cancelled', note: 'Stripe payment failed via webhook', updatedBy: 'stripe-webhook' } }
        });
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[Stripe webhook]', err.message);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
});

// ── PayPal: server-side capture verification ──────────────────────────────────
// Verifies the capture with PayPal's API before trusting it.
// Requires auth — only the paying customer can trigger this.
router.post('/paypal/capture', requireAuth, paymentInitLimiter, async (req, res) => {
  try {
    const Order            = require('../models/Order');
    const { Notification } = require('../models/index');
    const gw = await PaymentGateway.findOne({ gateway: 'paypal', isEnabled: true });
    if (!gw?.config?.clientId || !gw?.config?.clientSecret) {
      return res.status(400).json({ message: 'PayPal not configured' });
    }

    const { captureId } = req.body;
    if (!captureId || typeof captureId !== 'string' || captureId.length > 50) {
      return res.status(400).json({ message: 'Invalid capture ID' });
    }

    const baseUrl = gw.isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

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
      console.error('[PayPal capture] token error:', await tokenRes.text());
      return res.status(400).json({ message: 'Could not authenticate with PayPal' });
    }
    const { access_token } = await tokenRes.json();

    // Verify the capture with PayPal
    const captureRes = await fetch(`${baseUrl}/v2/payments/captures/${captureId}`, {
      headers: { 'Authorization': `Bearer ${access_token}`, 'Content-Type': 'application/json' },
    });
    if (!captureRes.ok) {
      console.error('[PayPal capture] verify error:', await captureRes.text());
      return res.status(400).json({ message: 'Could not verify PayPal payment' });
    }
    const capture = await captureRes.json();

    // Only accept COMPLETED status
    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ message: `Payment not completed (status: ${capture.status})` });
    }

    // Return verified capture details — frontend will use these to create the order
    res.json({
      verified:  true,
      captureId: capture.id,
      amount:    capture.amount?.value,
      currency:  capture.amount?.currency_code,
    });
  } catch (err) {
    console.error('[PayPal capture]', err.message);
    res.status(500).json({ message: 'Payment verification failed' });
  }
});

module.exports = router;
