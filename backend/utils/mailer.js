const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendMail = async ({ to, subject, html }) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[MAIL SKIPPED — not configured] To:${to} | ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `ShopZen <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`[MAIL SENT] To:${to} | ${subject}`);
  } catch (e) {
    console.error('[MAIL ERROR]', e.message);
  }
};

// ── Theme helper ──────────────────────────────────────────────────────────────
// Fetches primaryColor and storeName from the Settings collection and caches
// them for 60 seconds so every email in a burst uses the same values without
// hammering MongoDB. Falls back to the original orange if DB is unreachable.

let _themeCache = null;
let _themeCacheAt = 0;
const THEME_TTL_MS = 60_000;

const getTheme = async () => {
  const now = Date.now();
  if (_themeCache && now - _themeCacheAt < THEME_TTL_MS) return _themeCache;

  try {
    // Lazy-require so mailer can be loaded before mongoose connects
    const { Settings } = require('./models/index');
    const rows = await Settings.find(
      { key: { $in: ['primaryColor', 'storeName'] } },
      'key value'
    ).lean();

    const map = {};
    rows.forEach(r => { map[r.key] = r.value; });

    // Derive a readable light version of the primary colour for backgrounds
    // by just using it at low opacity — we embed it inline so no CSS var needed.
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

// Call this whenever settings are saved so the next email picks up the change
// immediately instead of waiting for the TTL. Used in routes/settings.js.
const clearThemeCache = () => { _themeCache = null; _themeCacheAt = 0; };

// ── Shared layout helpers (accept theme object) ───────────────────────────────
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

// ── Colour utility — lighten a hex colour for the gradient end-stop ───────────
// Shifts each RGB channel 30% towards 255 so the gradient looks natural even
// with dark brand colours (navy, forest-green, etc.).
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

// ── Order placed confirmation email ──────────────────────────────────────────
const orderConfirmHtml = async (order) => {
  const t = await getTheme();

  const itemRows = (order.items || []).map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151">${item.name} × ${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;text-align:right;font-weight:600">Rs. ${item.subtotal?.toLocaleString()}</td>
    </tr>`).join('');

  const bankBlock = order.paymentMethod === 'bank_transfer' ? `
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:16px;margin:20px 0">
      <p style="margin:0 0 8px;font-weight:700;color:#92400e;font-size:14px">⚠️ Action Required — Bank Transfer</p>
      <p style="margin:0;color:#92400e;font-size:13px;line-height:1.6">
        Please transfer <strong>Rs. ${order.total?.toLocaleString()}</strong> to the account below and upload your payment slip on the order success page.<br><br>
        Use <strong>${order.orderNumber}</strong> as the payment reference.
      </p>
    </div>` : '';

  return wrapper(`
    ${header('Order Confirmed!', t)}
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
          ${order.couponDiscount > 0 ? `<tr><td style="padding:8px 12px;font-size:13px;color:#059669">Coupon (${order.couponCode})</td><td style="padding:8px 12px;font-size:13px;color:#059669;text-align:right">−Rs. ${order.couponDiscount?.toLocaleString()}</td></tr>` : ''}
          ${order.giftCardDiscount > 0 ? `<tr><td style="padding:8px 12px;font-size:13px;color:#059669">Gift Card</td><td style="padding:8px 12px;font-size:13px;color:#059669;text-align:right">−Rs. ${order.giftCardDiscount?.toLocaleString()}</td></tr>` : ''}
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Shipping</td><td style="padding:8px 12px;font-size:13px;color:#6b7280;text-align:right">Rs. ${order.shippingCost?.toLocaleString()}</td></tr>
          <tr style="border-top:2px solid #e5e7eb"><td style="padding:12px;font-size:15px;font-weight:700;color:#111">Total</td><td style="padding:12px;font-size:15px;font-weight:700;color:${t.primary};text-align:right">Rs. ${order.total?.toLocaleString()}</td></tr>
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

// ── Slip uploaded notification to admin ───────────────────────────────────────
const slipUploadedAdminHtml = async (order, slipUrl) => {
  const t = await getTheme();
  return wrapper(`
    ${header('Payment Slip Uploaded', t)}
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
      ` : `
        <p style="font-size:13px;color:#6b7280;margin-bottom:8px">Payment slip: <a href="${slipUrl}" style="color:${t.primary}">View PDF</a></p>
      `}

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
    ${header('Payment Slip Received', t)}
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

  const itemRows = (order.items || []).map(item => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151">${item.name} × ${item.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;text-align:right;font-weight:600">Rs. ${item.subtotal?.toLocaleString()}</td>
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
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">ITEM</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">AMOUNT</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
        <tfoot>
          ${order.couponDiscount > 0 ? `<tr><td style="padding:8px 12px;font-size:13px;color:#059669">Coupon</td><td style="padding:8px 12px;font-size:13px;color:#059669;text-align:right">−Rs. ${order.couponDiscount?.toLocaleString()}</td></tr>` : ''}
          <tr><td style="padding:8px 12px;font-size:13px;color:#6b7280">Shipping</td><td style="padding:8px 12px;font-size:13px;color:#6b7280;text-align:right">Rs. ${order.shippingCost?.toLocaleString()}</td></tr>
          <tr style="border-top:2px solid #e5e7eb"><td style="padding:12px;font-size:15px;font-weight:700;color:#111">Total Paid</td><td style="padding:12px;font-size:15px;font-weight:700;color:#15803d;text-align:right">Rs. ${order.total?.toLocaleString()}</td></tr>
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

// ── Cancel request notification to admin ─────────────────────────────────────
const cancelRequestAdminHtml = async (order) => {
  const t = await getTheme();
  return wrapper(`
    ${header('Cancel Request Received', t)}
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
    confirmed:'Confirmed', processing:'Processing', shipped:'Shipped',
    out_for_delivery:'Out for Delivery', delivered:'Delivered ✅',
    cancelled:'Cancelled', refunded:'Refunded',
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

module.exports = {
  sendMail,
  clearThemeCache,
  otpEmailHtml,
  orderConfirmHtml,
  slipUploadedAdminHtml,
  slipReceivedCustomerHtml,
  paymentConfirmedHtml,
  orderCancelledHtml,
  cancelRequestAdminHtml,
  cancelRejectedHtml,
  orderStatusUpdateHtml,
};