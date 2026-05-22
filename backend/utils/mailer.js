const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const sendMail = async ({ to, subject, html }) => {
  if (!process.env.EMAIL_USER || process.env.EMAIL_USER === 'your_email@gmail.com') {
    console.log(`[MAIL SKIPPED] To:${to} | ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({ from: process.env.EMAIL_FROM || 'ShopZen <noreply@shopzen.lk>', to, subject, html });
    console.log(`[MAIL SENT] To:${to}`);
  } catch(e) { console.error('[MAIL ERROR]', e.message); }
};

const otpEmailHtml = (otp, name) => `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;padding:40px 20px;margin:0"><div style="max-width:480px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)"><div style="background:linear-gradient(135deg,#b5451b,#e8643c);padding:32px;text-align:center"><h1 style="color:white;margin:0;font-size:28px">ShopZen</h1><p style="color:rgba(255,255,255,0.8);margin:8px 0 0">Password Reset OTP</p></div><div style="padding:32px"><p style="color:#374151">Hi <strong>${name}</strong>,</p><p style="color:#6b7280;font-size:14px">Your OTP to reset your password:</p><div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:20px 0"><span style="font-size:40px;font-weight:800;letter-spacing:12px;color:#b5451b;font-family:monospace">${otp}</span></div><p style="color:#9ca3af;font-size:13px">Expires in <strong>10 minutes</strong>. Do not share with anyone.</p></div><div style="background:#f8fafc;padding:16px;text-align:center"><p style="color:#d1d5db;font-size:12px;margin:0">© ${new Date().getFullYear()} ShopZen</p></div></div></body></html>`;

const orderConfirmHtml = (order) => `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f8fafc;padding:40px 20px"><div style="max-width:560px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)"><div style="background:linear-gradient(135deg,#b5451b,#e8643c);padding:32px;text-align:center"><h1 style="color:white;margin:0">ShopZen</h1><p style="color:rgba(255,255,255,0.8);margin:8px 0 0">Order Confirmed!</p></div><div style="padding:32px"><p style="color:#374151">Hi <strong>${order.billing?.firstName}</strong>, your order is confirmed!</p><div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0"><p style="margin:0;font-size:13px;color:#6b7280">Order Number</p><p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#b5451b;font-family:monospace">${order.orderNumber}</p></div>${order.paymentMethod==='bank_transfer'?`<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:16px;margin:16px 0"><strong style="color:#92400e">Bank Transfer Required:</strong><br><p style="color:#92400e;margin:8px 0 0">Transfer Rs. ${order.total?.toLocaleString()} using <strong>${order.orderNumber}</strong> as reference.</p></div>`:''}<p style="font-weight:700;font-size:18px;color:#111">Total: Rs. ${order.total?.toLocaleString()}</p></div></div></body></html>`;

module.exports = { sendMail, otpEmailHtml, orderConfirmHtml };
