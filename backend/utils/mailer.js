const nodemailer = require('nodemailer');

// ── Lazy transporter — built fresh per send so DB-saved SMTP settings work ────
// Priority: env vars → DB settings → error
const getTransporter = async () => {
  // Fast path: env vars are set
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    return nodemailer.createTransport({
      host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
      port:   Number(process.env.EMAIL_PORT) || 587,
      secure: process.env.EMAIL_SECURE === 'true' || Number(process.env.EMAIL_PORT) === 465,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });
  }

  // Slow path: try to read SMTP settings from DB
  try {
    const { Settings } = require('../models/index');
    const keys = ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpSecure', 'emailFrom'];
    const rows = await Settings.find({ key: { $in: keys } }).lean();
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.value; });

    if (!cfg.smtpUser || !cfg.smtpPass) {
      throw new Error(
        'Email is not configured. Add EMAIL_USER & EMAIL_PASS to your .env, ' +
        'or set SMTP settings in Admin → Settings.'
      );
    }

    return nodemailer.createTransport({
      host:   cfg.smtpHost   || 'smtp.gmail.com',
      port:   Number(cfg.smtpPort) || 587,
      secure: cfg.smtpSecure === true || cfg.smtpSecure === 'true' || Number(cfg.smtpPort) === 465,
      auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    });
  } catch (err) {
    throw err;
  }
};

// ── From address helper ───────────────────────────────────────────────────────
const getFromAddress = async (theme) => {
  if (process.env.EMAIL_FROM) return process.env.EMAIL_FROM;
  if (process.env.EMAIL_USER) return `${theme?.storeName || 'ShopZen'} <${process.env.EMAIL_USER}>`;
  try {
    const { Settings } = require('../models/index');
    const rows = await Settings.find({ key: { $in: ['emailFrom', 'smtpUser'] } }).lean();
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.value; });
    if (cfg.emailFrom) return cfg.emailFrom;
    if (cfg.smtpUser) return `${theme?.storeName || 'ShopZen'} <${cfg.smtpUser}>`;
  } catch {}
  return 'ShopZen <noreply@shopzen.com>';
};

// ── sendMail — throws on failure so callers can catch and return 500 ──────────
const sendMail = async ({ to, subject, html }) => {
  try {
    const transporter = await getTransporter();
    const theme = await getTheme().catch(() => ({ storeName: 'ShopZen', primary: '#b5451b' }));
    const from = await getFromAddress(theme);
    await transporter.sendMail({ from, to, subject, html });
    console.log(`[MAIL SENT] To:${to} | ${subject}`);
  } catch (e) {
    console.error('[MAIL ERROR]', e.message);
    throw e;
  }
};

// ── Admin email helper — reads ADMIN_EMAIL env or falls back to EMAIL_USER ────
const getAdminEmail = async () => {
  if (process.env.ADMIN_EMAIL) return process.env.ADMIN_EMAIL;
  if (process.env.EMAIL_USER)  return process.env.EMAIL_USER;
  try {
    const { Settings } = require('../models/index');
    const row = await Settings.findOne({ key: 'adminEmail' }).lean();
    if (row?.value) return row.value;
    const smtpRow = await Settings.findOne({ key: 'smtpUser' }).lean();
    if (smtpRow?.value) return smtpRow.value;
  } catch {}
  return null;
};

// ── Theme helper ──────────────────────────────────────────────────────────────
let _themeCache = null;
let _themeCacheAt = 0;
const THEME_TTL_MS = 60_000;

const getTheme = async () => {
  const now = Date.now();
  if (_themeCache && now - _themeCacheAt < THEME_TTL_MS) return _themeCache;
  try {
    const { Settings } = require('../models/index');
    const rows = await Settings.find(
      { key: { $in: ['primaryColor', 'storeName'] } },
      'key value'
    ).lean();
    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });
    _themeCache = {
      primary:   map.primaryColor || '#b5451b',
      storeName: map.storeName    || 'ShopZen',
    };
    _themeCacheAt = now;
  } catch (err) {
    console.warn('[MAIL] Could not load theme from DB, using defaults:', err.message);
    _themeCache = { primary: '#b5451b', storeName: 'ShopZen' };
    _themeCacheAt = now;
  }
  return _themeCache;
};

const clearThemeCache = () => { _themeCache = null; _themeCacheAt = 0; };

// ── Shared layout helpers ─────────────────────────────────────────────────────
const lighten = (hex) => {
  try {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const mix = (c) => Math.min(255, Math.round(c + (255 - c) * 0.35));
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  } catch (_) { return '#e8643c'; }
};

const header = (subtitle, theme) => `
  <div style="background:linear-gradient(135deg,${theme.primary},${lighten(theme.primary)});padding:32px;text-align:center">
    <h1 style="color:white;margin:0;font-size:26px;font-family:sans-serif">${theme.storeName}</h1>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;font-family:sans-serif">${subtitle}</p>
  </div>`;

const footer = (theme) => `
  <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e5e7eb">
    <p style="color:#9ca3af;font-size:12px;margin:0;font-family:sans-serif">© ${new Date().getFullYear()} ${theme.storeName} · All rights reserved</p>
  </div>`;

const wrapper = (content, theme) => `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f1f5f9;padding:40px 20px;margin:0">
  <div style="max-width:560px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.09)">
    ${content}
    ${footer(theme)}
  </div></body></html>`;

// ── OTP email ─────────────────────────────────────────────────────────────────
const otpEmailHtml = async (otp, name) => {
  const t = await getTheme();
  return wrapper(`
    ${header('Password Reset OTP', t)}
    <div style="padding:32px">
      <p style="color:#374151">Hi <strong>${name}</strong>,</p>
      <p style="color:#6b7280;font-size:14px">Your OTP to reset your password:</p>
      <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
        <span style="font-size:40px;font-weight:800;letter-spacing:12px;color:${t.primary};font-family:monospace">${otp}</span>
      </div>
      <p style="color:#9ca3af;font-size:13px">Expires in <strong>10 minutes</strong>. Do not share with anyone.</p>
    </div>`, t);
};

// ── Order placed confirmation email (customer) ────────────────────────────────
const orderConfirmHtml = async (order) => {
  const t = await getTheme();
  const sym = 'Rs.';
  const itemRows = (order.items || []).map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151">${item.name} × ${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;text-align:right;font-weight:600">${sym} ${item.subtotal?.toLocaleString()}</td>
    </tr>`).join('');
  const bankBlock = order.paymentMethod === 'bank_transfer' ? `
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin:20px 0">
      <p style="margin:0 0 8px;font-weight:700;color:#92400e;font-size:14px">⚠️ Action Required — Bank Transfer</p>
      <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6">
        Please transfer <strong>${sym} ${order.total?.toLocaleString()}</strong> to the store bank account and upload your payment slip.<br><br>
        Use <strong>${order.orderNumber}</strong> as the payment reference.
      </p>
    </div>` : '';
  return wrapper(`
    ${header('Order Confirmed! 🎉', t)}
    <div style="padding:32px">
      <p style="color:#374151;margin:0 0 4px">Hi <strong>${order.billing?.firstName}</strong>,</p>
      <p style="color:#6b7280;font-size:14px;margin:0 0 20px">
        ${order.paymentMethod === 'bank_transfer'
          ? 'Your order has been placed! Complete your bank transfer to confirm it.'
          : 'Your order has been received and is being processed.'}
      </p>
      <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:20px;text-align:center">
        <p style="margin:0;font-size:12px;color:#6b7280">Order Number</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:${t.primary};font-family:monospace">${order.orderNumber}</p>
      </div>
      ${bankBlock}
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">ITEM</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">AMOUNT</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          ${order.couponDiscount > 0 ? `<tr><td style="padding:8px 12px;font-size:13px;color:#059669">Coupon (${order.couponCode})</td><td style="padding:8px 12px;font-size:13px;color:#059669;text-align:right">−${sym} ${order.couponDiscount?.toLocaleString()}</td></tr>` : ''}
          ${order.giftCardDiscount > 0 ? `<tr><td style="padding:8px 12px;font-size:13px;color:#059669">Gift Card</td><td style="padding:8px 12px;font-size:13px;color:#059669;text-align:right">−${sym} ${order.giftCardDiscount?.toLocaleString()}</td></tr>` : ''}
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Shipping</td><td style="padding:8px 12px;font-size:13px;color:#6b7280;text-align:right">${sym} ${(order.shippingCost || 0).toLocaleString()}</td></tr>
          <tr style="border-top:2px solid #e5e7eb"><td style="padding:12px;font-size:15px;font-weight:700;color:#111">Total</td><td style="padding:12px;font-size:15px;font-weight:700;color:${t.primary};text-align:right">${sym} ${order.total?.toLocaleString()}</td></tr>
        </tfoot>
      </table>
      <div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:13px;color:#374151;line-height:1.6">
        <strong>Shipping to:</strong><br>
        ${order.billing?.firstName} ${order.billing?.lastName}<br>
        ${order.billing?.street}, ${order.billing?.city}<br>
        ${order.billing?.phone}
      </div>
    </div>`, t);
};

// ── New order notification to admin ──────────────────────────────────────────
const newOrderAdminHtml = async (order) => {
  const t = await getTheme();
  const sym = 'Rs.';
  const paymentLabels = {
    bank_transfer: '🏦 Bank Transfer',
    cod: '💵 Cash on Delivery',
    payhere: '💳 PayHere',
    stripe: '💳 Stripe',
    paypal: '💳 PayPal',
  };
  const itemRows = (order.items || []).map(item => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151">${item.name} × ${item.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;text-align:right;font-weight:600;color:#111">${sym} ${item.subtotal?.toLocaleString()}</td>
    </tr>`).join('');
  return wrapper(`
    ${header('🛒 New Order Received!', t)}
    <div style="padding:32px">
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;margin-bottom:20px;text-align:center">
        <p style="margin:0 0 4px;font-size:12px;color:#166534">New Order</p>
        <p style="margin:0;font-size:24px;font-weight:800;color:#15803d;font-family:monospace">${order.orderNumber}</p>
        <p style="margin:8px 0 0;font-size:18px;font-weight:700;color:#166534">${sym} ${order.total?.toLocaleString()}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:40%">Customer</td><td style="padding:8px 0;font-size:13px;font-weight:600;color:#111">${order.billing?.firstName} ${order.billing?.lastName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;font-size:13px;color:#111">${order.billing?.email}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Phone</td><td style="padding:8px 0;font-size:13px;color:#111">${order.billing?.phone}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">City</td><td style="padding:8px 0;font-size:13px;color:#111">${order.billing?.city}, ${order.billing?.country}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Payment</td><td style="padding:8px 0;font-size:13px;color:#111">${paymentLabels[order.paymentMethod] || order.paymentMethod}</td></tr>
        ${order.notes ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Notes</td><td style="padding:8px 0;font-size:13px;color:#111">${order.notes}</td></tr>` : ''}
      </table>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;font-weight:600">ITEM</th>
          <th style="padding:8px 12px;text-align:right;font-size:11px;color:#6b7280;font-weight:600">SUBTOTAL</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          <tr style="border-top:2px solid #e5e7eb"><td style="padding:10px 12px;font-size:14px;font-weight:700;color:#111">Total</td><td style="padding:10px 12px;font-size:14px;font-weight:700;color:${t.primary};text-align:right">${sym} ${order.total?.toLocaleString()}</td></tr>
        </tfoot>
      </table>
      <a href="${process.env.ADMIN_URL || process.env.FRONTEND_URL || ''}/admin/orders/${order._id}"
         style="display:inline-block;background:linear-gradient(135deg,${t.primary},${lighten(t.primary)});color:white;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">
        View Order in Dashboard →
      </a>
    </div>`, t);
};

// ── Slip uploaded notification to admin ───────────────────────────────────────
const slipUploadedAdminHtml = async (order, slipUrl) => {
  const t = await getTheme();
  return wrapper(`
    ${header('📎 Payment Slip Uploaded', t)}
    <div style="padding:32px">
      <p style="color:#374151;margin:0 0 16px">A customer has uploaded a payment slip for order <strong>${order.orderNumber}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:40%">Customer</td><td style="padding:8px 0;font-size:13px;color:#111;font-weight:600">${order.billing?.firstName} ${order.billing?.lastName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;font-size:13px;color:#111">${order.billing?.email}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Phone</td><td style="padding:8px 0;font-size:13px;color:#111">${order.billing?.phone}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Order Total</td><td style="padding:8px 0;font-size:13px;font-weight:700;color:${t.primary}">Rs. ${order.total?.toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Uploaded At</td><td style="padding:8px 0;font-size:13px;color:#111">${new Date().toLocaleString('en-LK')}</td></tr>
      </table>
      ${slipUrl && /\.(jpg|jpeg|png|gif|webp)$/i.test(slipUrl) ? `
        <p style="font-size:13px;color:#6b7280;margin-bottom:8px">Payment slip preview:</p>
        <img src="${slipUrl}" alt="Payment Slip" style="width:100%;max-height:300px;object-fit:contain;border-radius:10px;border:1px solid #e5e7eb;margin-bottom:16px" />
      ` : slipUrl ? `
        <p style="font-size:13px;color:#6b7280;margin-bottom:16px">Payment slip: <a href="${slipUrl}" style="color:${t.primary}">View PDF</a></p>
      ` : ''}
      <a href="${process.env.ADMIN_URL || process.env.FRONTEND_URL || ''}/admin/orders/${order._id}"
         style="display:inline-block;background:linear-gradient(135deg,${t.primary},${lighten(t.primary)});color:white;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">
        Review &amp; Confirm Payment →
      </a>
    </div>`, t);
};

// ── Slip received confirmation to customer ────────────────────────────────────
const slipReceivedCustomerHtml = async (order) => {
  const t = await getTheme();
  return wrapper(`
    ${header('Payment Slip Received ✅', t)}
    <div style="padding:32px">
      <p style="color:#374151">Hi <strong>${order.billing?.firstName}</strong>,</p>
      <p style="color:#6b7280;font-size:14px">We've received your payment slip for order <strong style="color:${t.primary}">${order.orderNumber}</strong>. Our team will verify your payment shortly and confirm your order.</p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;margin:20px 0;text-align:center">
        <p style="margin:0;font-size:13px;color:#166534">⏳ Payment verification usually takes <strong>1–2 business hours</strong>.<br>You'll receive another email once confirmed.</p>
      </div>
      <div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:13px;color:#374151">
        <strong>Order:</strong> ${order.orderNumber}<br>
        <strong>Total:</strong> Rs. ${order.total?.toLocaleString()}<br>
        <strong>Payment Method:</strong> Bank Transfer
      </div>
    </div>`, t);
};

// ── Payment confirmed email to customer ──────────────────────────────────────
const paymentConfirmedHtml = async (order) => {
  const t = await getTheme();
  const sym = 'Rs.';
  const itemRows = (order.items || []).map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151">${item.name} × ${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;text-align:right;font-weight:600">${sym} ${item.subtotal?.toLocaleString()}</td>
    </tr>`).join('');
  return wrapper(`
    ${header('✅ Payment Confirmed!', t)}
    <div style="padding:32px">
      <p style="color:#374151">Hi <strong>${order.billing?.firstName}</strong>,</p>
      <p style="color:#6b7280;font-size:14px;margin-bottom:20px">Great news! Your payment has been verified and your order is now <strong style="color:#16a34a">confirmed</strong>. We'll begin processing it right away.</p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;color:#166534">Order Number</p>
        <p style="margin:0;font-size:22px;font-weight:800;color:#15803d;font-family:monospace">${order.orderNumber}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#166534;font-weight:600">✓ Payment Verified &amp; Confirmed</p>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <thead><tr style="background:#f8fafc">
          <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">ITEM</th>
          <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">AMOUNT</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          ${order.couponDiscount > 0 ? `<tr><td style="padding:8px 12px;font-size:13px;color:#059669">Coupon</td><td style="padding:8px 12px;font-size:13px;color:#059669;text-align:right">−${sym} ${order.couponDiscount?.toLocaleString()}</td></tr>` : ''}
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Shipping</td><td style="padding:8px 12px;font-size:13px;color:#6b7280;text-align:right">${sym} ${(order.shippingCost || 0).toLocaleString()}</td></tr>
          <tr style="border-top:2px solid #e5e7eb"><td style="padding:12px;font-size:15px;font-weight:700;color:#111">Total Paid</td><td style="padding:12px;font-size:15px;font-weight:700;color:#15803d;text-align:right">${sym} ${order.total?.toLocaleString()}</td></tr>
        </tfoot>
      </table>
      <div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:13px;color:#374151;line-height:1.6">
        <strong>Shipping to:</strong><br>
        ${order.billing?.firstName} ${order.billing?.lastName}<br>
        ${order.billing?.street}, ${order.billing?.city}<br>
        ${order.billing?.phone}
      </div>
      <p style="margin-top:20px;color:#9ca3af;font-size:12px;text-align:center">
        You'll receive tracking details once your order is shipped. Thank you for shopping with ${t.storeName}!
      </p>
    </div>`, t);
};

// ── Order cancelled confirmation to customer ─────────────────────────────────
const orderCancelledHtml = async (order) => {
  const t = await getTheme();
  return wrapper(`
    ${header('Order Cancelled', t)}
    <div style="padding:32px">
      <p style="color:#374151">Hi <strong>${order.billing?.firstName}</strong>,</p>
      <p style="color:#6b7280;font-size:14px;margin-bottom:20px">
        Your cancellation request for order <strong style="color:${t.primary}">${order.orderNumber}</strong> has been approved. The order has been cancelled.
      </p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;color:#991b1b">Cancelled Order</p>
        <p style="margin:0;font-size:20px;font-weight:800;color:#dc2626;font-family:monospace">${order.orderNumber}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#991b1b">Total: Rs. ${order.total?.toLocaleString()}</p>
      </div>
      ${order.cancelRequest?.reason ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:13px;color:#374151;margin-bottom:16px"><strong>Cancellation reason:</strong> ${order.cancelRequest.reason}</div>` : ''}
      <p style="color:#9ca3af;font-size:12px;text-align:center">If you have any questions, please contact our support team. Thank you for shopping with ${t.storeName}!</p>
    </div>`, t);
};

// ── Cancel request received confirmation to customer ─────────────────────────
const cancelRequestReceivedCustomerHtml = async (order) => {
  const t = await getTheme();
  return wrapper(`
    ${header('Cancellation Request Received', t)}
    <div style="padding:32px">
      <p style="color:#374151">Hi <strong>${order.billing?.firstName}</strong>,</p>
      <p style="color:#6b7280;font-size:14px;margin-bottom:20px">
        We received your cancellation request for order <strong style="color:${t.primary}">${order.orderNumber}</strong>. Our team will review it and respond shortly.
      </p>
      <div style="background:#fefce8;border:1px solid #fde047;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;color:#854d0e;font-weight:600">Under Review</p>
        <p style="margin:0;font-size:20px;font-weight:800;color:#854d0e;font-family:monospace">${order.orderNumber}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#854d0e">Total: Rs. ${order.total?.toLocaleString()}</p>
      </div>
      ${order.cancelRequest?.reason ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:13px;color:#374151;margin-bottom:16px"><strong>Your reason:</strong> ${order.cancelRequest.reason}</div>` : ''}
      <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:14px;font-size:13px;color:#0369a1;margin-bottom:20px">
        ℹ️ You will receive an email once the decision is made. Do not re-order until your cancellation is confirmed.
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center">Thank you for shopping with ${t.storeName}!</p>
    </div>`, t);
};

// ── Cancel request notification to admin ─────────────────────────────────────
const cancelRequestAdminHtml = async (order) => {
  const t = await getTheme();
  return wrapper(`
    ${header('🚫 Cancel Request Received', t)}
    <div style="padding:32px">
      <p style="color:#374151;margin:0 0 16px">A customer has requested to cancel order <strong>${order.orderNumber}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:40%">Customer</td><td style="padding:8px 0;font-size:13px;color:#111;font-weight:600">${order.billing?.firstName} ${order.billing?.lastName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;font-size:13px;color:#111">${order.billing?.email}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Order Total</td><td style="padding:8px 0;font-size:13px;font-weight:700;color:${t.primary}">Rs. ${order.total?.toLocaleString()}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Order Status</td><td style="padding:8px 0;font-size:13px;color:#111;text-transform:capitalize">${order.orderStatus}</td></tr>
        ${order.cancelRequest?.reason ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Reason</td><td style="padding:8px 0;font-size:13px;color:#111">${order.cancelRequest.reason}</td></tr>` : ''}
      </table>
      <a href="${process.env.ADMIN_URL || process.env.FRONTEND_URL || ''}/admin/orders/${order._id}"
         style="display:inline-block;background:linear-gradient(135deg,${t.primary},${lighten(t.primary)});color:white;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">
        Review Cancel Request →
      </a>
    </div>`, t);
};

// ── Cancel request rejected notification to customer ─────────────────────────
const cancelRejectedHtml = async (order) => {
  const t = await getTheme();
  return wrapper(`
    ${header('Cancellation Request Update', t)}
    <div style="padding:32px">
      <p style="color:#374151">Hi <strong>${order.billing?.firstName}</strong>,</p>
      <p style="color:#6b7280;font-size:14px;margin-bottom:20px">
        Unfortunately your cancellation request for order <strong style="color:${t.primary}">${order.orderNumber}</strong> could not be approved as the order is already being processed.
      </p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;margin-bottom:20px;text-align:center">
        <p style="margin:0;font-size:13px;color:#166534">Your order is on its way! 📦<br>You'll receive tracking details once shipped.</p>
      </div>
      <p style="color:#9ca3af;font-size:12px;text-align:center">If you have concerns, please contact our support team. Thank you for shopping with ${t.storeName}!</p>
    </div>`, t);
};

// ── Order status update email to customer ─────────────────────────────────────
const orderStatusUpdateHtml = async (order, newStatus, note) => {
  const t = await getTheme();
  const statusLabels = {
    confirmed:'Confirmed ✅', processing:'Processing 🔄', shipped:'Shipped 📦',
    out_for_delivery:'Out for Delivery 🚚', delivered:'Delivered ✅',
    cancelled:'Cancelled ❌', refunded:'Refunded 💰',
  };
  const statusColors = {
    confirmed:'#16a34a', processing:'#d97706', shipped:'#2563eb',
    out_for_delivery:'#7c3aed', delivered:'#16a34a',
    cancelled:'#dc2626', refunded:'#6b7280',
  };
  const color = statusColors[newStatus] || t.primary;
  const label = statusLabels[newStatus] || newStatus;
  return wrapper(`
    ${header(`Order ${label}`, t)}
    <div style="padding:32px">
      <p style="color:#374151">Hi <strong>${order.billing?.firstName}</strong>,</p>
      <p style="color:#6b7280;font-size:14px;margin-bottom:20px">Your order status has been updated.</p>
      <div style="background:#f8fafc;border-radius:10px;padding:16px;text-align:center;margin-bottom:20px;border:2px solid ${color}20">
        <p style="margin:0 0 4px;font-size:12px;color:#6b7280">Order ${order.orderNumber}</p>
        <p style="margin:0;font-size:22px;font-weight:800;color:${color}">${label}</p>
        ${note ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280">${note}</p>` : ''}
      </div>
      ${order.trackingNumber ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:13px;color:#374151;margin-bottom:16px"><strong>Tracking Number:</strong> <span style="font-family:monospace;font-weight:700">${order.trackingNumber}</span>${order.deliveryPartner ? ` via ${order.deliveryPartner}` : ''}</div>` : ''}
      <p style="color:#9ca3af;font-size:12px;text-align:center">Thank you for shopping with ${t.storeName}!</p>
    </div>`, t);
};

// ── Auto cancel-decision notification to admin ────────────────────────────────
const cancelAutoDecisionAdminHtml = async (order, decision) => {
  const t = await getTheme();
  const isApproved = decision === 'approved';
  return wrapper(`
    ${header(isApproved ? '🤖 Auto-Cancellation Approved' : '🤖 Auto-Cancellation Rejected', t)}
    <div style="padding:32px">
      <p style="color:#374151;margin:0 0 12px">The system has automatically <strong>${isApproved ? 'approved' : 'rejected'}</strong> a cancellation request.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:40%">Order</td><td style="padding:8px 0;font-size:13px;font-weight:700;color:${t.primary};font-family:monospace">${order.orderNumber}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Customer</td><td style="padding:8px 0;font-size:13px;font-weight:600;color:#111">${order.billing?.firstName} ${order.billing?.lastName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Email</td><td style="padding:8px 0;font-size:13px;color:#111">${order.billing?.email}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Order Total</td><td style="padding:8px 0;font-size:13px;font-weight:700;color:${t.primary}">Rs. ${order.total?.toLocaleString()}</td></tr>
        ${order.cancelRequest?.reason ? `<tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Reason</td><td style="padding:8px 0;font-size:13px;color:#111">${order.cancelRequest.reason}</td></tr>` : ''}
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px">Decision</td><td style="padding:8px 0;font-size:13px;font-weight:700;color:${isApproved ? '#dc2626' : '#16a34a'}">${isApproved ? '✅ Auto-Approved & Cancelled' : '❌ Auto-Rejected'}</td></tr>
      </table>
      <a href="${process.env.ADMIN_URL || process.env.FRONTEND_URL || ''}/admin/orders/${order._id}"
         style="display:inline-block;background:linear-gradient(135deg,${t.primary},${lighten(t.primary)});color:white;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none">
        View Order →
      </a>
    </div>`, t);
};

// ── Cancel approved notification to admin (manual) ────────────────────────────
const cancelApprovedAdminHtml = async (order) => {
  const t = await getTheme();
  return wrapper(`
    ${header('✅ Cancellation Approved', t)}
    <div style="padding:32px">
      <p style="color:#374151;margin:0 0 12px">You approved the cancellation request for order <strong style="color:${t.primary}">${order.orderNumber}</strong>. The customer has been notified.</p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;color:#991b1b">Cancelled Order</p>
        <p style="margin:0;font-size:20px;font-weight:800;color:#dc2626;font-family:monospace">${order.orderNumber}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#991b1b">Total: Rs. ${order.total?.toLocaleString()} · Stock restored</p>
      </div>
      ${order.cancelRequest?.reason ? `<div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:13px;color:#374151;margin-bottom:16px"><strong>Customer reason:</strong> ${order.cancelRequest.reason}</div>` : ''}
    </div>`, t);
};

// ── Cancel rejected notification to admin (manual) ────────────────────────────
const cancelRejectedAdminHtml = async (order) => {
  const t = await getTheme();
  return wrapper(`
    ${header('❌ Cancellation Rejected', t)}
    <div style="padding:32px">
      <p style="color:#374151;margin:0 0 12px">You rejected the cancellation request for order <strong style="color:${t.primary}">${order.orderNumber}</strong>. The customer has been notified and the order will continue.</p>
      <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:12px;color:#166534">Order Continuing</p>
        <p style="margin:0;font-size:20px;font-weight:800;color:#16a34a;font-family:monospace">${order.orderNumber}</p>
        <p style="margin:8px 0 0;font-size:13px;color:#166534">Status: ${order.orderStatus}</p>
      </div>
    </div>`, t);
};

module.exports = {
  sendMail,
  getAdminEmail,
  clearThemeCache,
  otpEmailHtml,
  orderConfirmHtml,
  newOrderAdminHtml,
  slipUploadedAdminHtml,
  slipReceivedCustomerHtml,
  paymentConfirmedHtml,
  orderCancelledHtml,
  cancelRequestReceivedCustomerHtml,
  cancelRequestAdminHtml,
  cancelRejectedHtml,
  cancelApprovedAdminHtml,
  cancelRejectedAdminHtml,
  cancelAutoDecisionAdminHtml,
  orderStatusUpdateHtml,
};