const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { Coupon, GiftCard, Notification, Settings, DeliveryService } = require('../models/index');
const { auth, adminAuth } = require('../middleware/auth');
const {
  sendMail,
  orderConfirmHtml,
  slipUploadedAdminHtml,
  slipReceivedCustomerHtml,
  paymentConfirmedHtml,
  orderCancelledHtml,
  cancelRequestAdminHtml,
  cancelRejectedHtml,
  orderStatusUpdateHtml,
} = require('../utils/mailer');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ── Helpers ───────────────────────────────────────────────────────────────────
function absoluteSlipUrl(relPath) {
  const base =
    process.env.BACKEND_URL ||
    process.env.RAILWAY_STATIC_URL ||
    `http://localhost:${process.env.PORT || 5001}`;
  return `${base.replace(/\/$/, '')}${relPath}`;
}

// ── Cloudinary setup for payment slips ───────────────────────────────────────
const USE_CLOUDINARY =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

let cloudinary;
let uploadSlip;

if (USE_CLOUDINARY) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const { CloudinaryStorage } = require('multer-storage-cloudinary');
  const slipStorage = new CloudinaryStorage({
    cloudinary,
    params: (req) => ({
      folder: 'shopzen/payment-slips',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'],
      public_id: `slip-${req.params.id}-${Date.now()}`,
      // PDFs must not be force-converted to image
      resource_type: 'auto',
    }),
  });
  uploadSlip = multer({
    storage: slipStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /jpeg|jpg|png|gif|webp|pdf/;
      if (allowed.test(file.mimetype)) cb(null, true);
      else cb(new Error('Only images and PDFs are allowed'));
    },
  });
  console.log('🌥️  Payment-slip storage: Cloudinary');
} else {
  // Fallback: local disk (dev without Cloudinary)
  const slipStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../uploads/payment-slips');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `slip-${req.params.id}-${Date.now()}${ext}`);
    },
  });
  uploadSlip = multer({
    storage: slipStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const allowed = /jpeg|jpg|png|gif|webp|pdf/;
      if (allowed.test(file.mimetype)) cb(null, true);
      else cb(new Error('Only images and PDFs are allowed'));
    },
  });
  console.log('💾 Payment-slip storage: local disk');
}

// ── IMPORTANT: All named routes BEFORE /:id wildcard ─────────────────────────

// Admin — Get all orders
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.orderStatus = status;
    if (search)
      filter.$or = [
        { orderNumber: new RegExp(search, 'i') },
        { 'billing.email': new RegExp(search, 'i') },
        { 'billing.firstName': new RegExp(search, 'i') },
      ];
    const total = await Order.countDocuments(filter);
    const orders = await Order.find(filter)
      .populate('customer', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ orders, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin — Update order status
router.put('/admin/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, note, trackingNumber, deliveryPartner } = req.body;
    const update = { orderStatus: status, updatedAt: Date.now() };
    if (trackingNumber) update.trackingNumber = trackingNumber;
    if (deliveryPartner) update.deliveryPartner = deliveryPartner;
    if (status === 'delivered') update.deliveredAt = Date.now();
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        ...update,
        $push: {
          statusHistory: {
            status,
            note: note || `Status updated to ${status}`,
            updatedBy: req.user.email,
          },
        },
      },
      { new: true }
    );
    // Email customer on every meaningful status change
    const notifyStatuses = ['confirmed','processing','shipped','out_for_delivery','delivered','cancelled'];
    if (order?.billing?.email && notifyStatuses.includes(status)) {
      sendMail({
        to: order.billing.email,
        subject: `Order Update — ${order.orderNumber} | ShopZen`,
        html: await orderStatusUpdateHtml(order, status, note),
      }).catch(() => {});
    }
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin — Mark order as read
router.put('/admin/:id/read', adminAuth, async (req, res) => {
  try {
    await Order.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin — Confirm payment (manual gateway confirmation)
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
        $push: {
          statusHistory: {
            status: 'confirmed',
            note: 'Payment confirmed by admin',
            updatedBy: req.user.email,
          },
        },
      },
      { new: true }
    );
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin — Confirm payment from uploaded slip + send confirmation email to customer
router.put('/admin/:id/confirm-slip', adminAuth, async (req, res) => {
  try {
    const { paymentReference } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        paymentStatus: 'paid',
        orderStatus: 'confirmed',
        ...(paymentReference && { paymentReference }),
        updatedAt: Date.now(),
        $push: {
          statusHistory: {
            status: 'confirmed',
            note: 'Payment slip verified by admin',
            updatedBy: req.user.email,
          },
        },
      },
      { new: true }
    );

    if (order?.billing?.email) {
      sendMail({
        to: order.billing.email,
        subject: `✅ Payment Confirmed — Order ${order.orderNumber} | ShopZen`,
        html: await paymentConfirmedHtml(order),
      }).catch(() => {});
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Customer — Get my orders
router.get('/my-orders', auth, async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .populate('items.product', 'name thumbnail');
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Place order (public — guest + logged in)
router.post('/', async (req, res) => {
  try {
    const {
      items,
      billing,
      shipping,
      shipToDifferentAddress,
      paymentMethod,
      couponCode,
      giftCard,
      notes,
      deliveryService,
    } = req.body;

    if (!items || items.length === 0)
      return res.status(400).json({ message: 'No items in order' });

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product || !product.isActive)
        return res.status(400).json({ message: `Product not available: ${item.name}` });
      if (product.stock < item.quantity)
        return res.status(400).json({ message: `Insufficient stock for ${product.name}` });
      const price = product.salePrice || product.price;
      const itemSubtotal = price * item.quantity;
      subtotal += itemSubtotal;
      orderItems.push({
        product: product._id,
        name: product.name,
        image: product.thumbnail,
        price,
        quantity: item.quantity,
        subtotal: itemSubtotal,
      });
      await Product.findByIdAndUpdate(product._id, {
        $inc: { stock: -item.quantity, soldCount: item.quantity },
      });
    }

    // Coupon discount
    let couponDiscount = 0;
    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(),
        isActive: true,
        validUntil: { $gte: new Date() },
      });
      if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
        couponDiscount =
          coupon.type === 'percentage'
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
      giftCardDoc = await GiftCard.findOne({
        code: giftCard.toUpperCase(),
        isActive: true,
        expiresAt: { $gte: new Date() },
      });
      if (giftCardDoc && giftCardDoc.balance > 0) {
        giftCardDiscount = Math.min(giftCardDoc.balance, subtotal - couponDiscount);
      }
    }

    // Shipping cost
    let shippingCost = 0;
    let deliveryServiceName = 'Standard Delivery';
    if (deliveryService) {
      const svc = await DeliveryService.findOne({ code: deliveryService, isEnabled: true });
      if (svc && svc.rates && svc.rates.length > 0) {
        const rate = svc.rates[0];
        shippingCost = rate.freeAbove && subtotal >= rate.freeAbove ? 0 : rate.price;
        deliveryServiceName = svc.name;
      }
    } else {
      const settingsMap = {};
      const allSettings = await Settings.find({
        key: { $in: ['standardDelivery', 'freeDeliveryThreshold'] },
      });
      allSettings.forEach((s) => (settingsMap[s.key] = s.value));
      const freeThreshold = settingsMap.freeDeliveryThreshold || 5000;
      shippingCost =
        subtotal >= freeThreshold ? 0 : settingsMap.standardDelivery || 600;
    }

    const total = Math.max(0, subtotal - couponDiscount - giftCardDiscount + shippingCost);

    const orderData = {
      items: orderItems,
      billing,
      shipping: shipToDifferentAddress ? shipping : billing,
      shipToDifferentAddress,
      paymentMethod,
      paymentStatus: 'pending',
      orderStatus: 'pending',
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
      statusHistory: [
        { status: 'pending', note: 'Order placed', updatedBy: billing.email },
      ],
    };

    // Attach customer if logged in
    if (req.headers.authorization) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(
          req.headers.authorization.replace('Bearer ', ''),
          process.env.JWT_SECRET
        );
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

    // Admin notification
    await Notification.create({
      type: 'new_order',
      title: '🛒 New Order Received!',
      message: `Order ${order.orderNumber} from ${billing.firstName} ${billing.lastName} — Rs. ${total.toLocaleString()}`,
      link: `/admin/orders/${order._id}`,
      data: { orderId: order._id, total, paymentMethod },
    });

    // Send order confirmation email to customer
    if (billing?.email) {
      sendMail({
        to: billing.email,
        subject: `Order Confirmed — ${order.orderNumber} | ShopZen`,
        html: await orderConfirmHtml(order),
      }).catch(() => {});
    }

    res.status(201).json({
      orderId: order._id,
      orderNumber: order.orderNumber,
      total,
      paymentMethod,
    });
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
    order.statusHistory.push({
      status: 'confirmed',
      note: `Payment confirmed via ${gateway}`,
      updatedBy: 'system',
    });
    await order.save();
    await Notification.create({
      type: 'new_order',
      title: '✅ Payment Confirmed',
      message: `Order ${order.orderNumber} payment received via ${gateway}`,
      link: `/admin/orders/${order._id}`,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Upload payment slip (customer — after placing bank_transfer order) ────────
router.post('/:id/payment-slip', uploadSlip.single('slip'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    let slipUrl;
    let slipRelPath;

    if (USE_CLOUDINARY) {
      // Cloudinary: req.file.path is the full CDN URL, req.file.filename is public_id
      slipUrl = req.file.path;
      slipRelPath = slipUrl; // store the full Cloudinary URL directly
    } else {
      // Local disk: build relative path for express static serving
      slipRelPath = `/uploads/payment-slips/${req.file.filename}`;
      slipUrl = absoluteSlipUrl(slipRelPath);
    }

    order.paymentSlip = slipRelPath;
    order.paymentSlipUploadedAt = new Date();
    await order.save();

    // Admin in-app notification
    await Notification.create({
      type: 'payment_slip',
      title: '📎 Payment Slip Uploaded',
      message: `Order ${order.orderNumber} — ${order.billing?.firstName} ${order.billing?.lastName} uploaded a payment slip`,
      link: `/admin/orders/${order._id}`,
    }).catch(() => {});

    // Email to admin
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
    if (adminEmail) {
      sendMail({
        to: adminEmail,
        subject: `📎 Payment Slip Uploaded — ${order.orderNumber} | ShopZen`,
        html: await slipUploadedAdminHtml(order, slipUrl),
      }).catch(() => {});
    }

    // Confirmation email to customer
    if (order.billing?.email) {
      sendMail({
        to: order.billing.email,
        subject: `Payment Slip Received — ${order.orderNumber} | ShopZen`,
        html: await slipReceivedCustomerHtml(order),
      }).catch(() => {});
    }

    res.json({ success: true, slipUrl: slipRelPath });
  } catch (err) {
    console.error('Slip upload error:', err);
    res.status(500).json({ message: err.message });
  }
});

// Get single order by ID — MUST be LAST
// Customer — Request order cancellation
router.post('/:id/cancel-request', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findOne({ _id: req.params.id, customer: req.user._id });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    // Check if order is in a cancellable state
    const cancellableStatuses = ['pending', 'confirmed'];
    if (!cancellableStatuses.includes(order.orderStatus)) {
      return res.status(400).json({ message: 'Order cannot be cancelled at this stage' });
    }
    if (order.cancelRequest?.requested) {
      return res.status(400).json({ message: 'Cancellation already requested' });
    }

    // Check cancel window from settings
    const windowSetting = await Settings.findOne({ key: 'cancelWindowMinutes' });
    const windowMinutes = windowSetting?.value || 60;
    const minutesElapsed = (Date.now() - new Date(order.createdAt).getTime()) / 60000;
    if (minutesElapsed > windowMinutes) {
      return res.status(400).json({ message: `Cancellation window of ${windowMinutes} minutes has passed` });
    }

    order.cancelRequest = { requested: true, requestedAt: new Date(), reason, status: 'pending' };
    await order.save();

    // Notify admin by email
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
    if (adminEmail) {
      sendMail({
        to: adminEmail,
        subject: `🚫 Cancel Request — ${order.orderNumber} | ShopZen`,
        html: await cancelRequestAdminHtml(order),
      }).catch(() => {});
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin — Approve or reject a cancel request
router.put('/admin/:id/cancel-decision', adminAuth, async (req, res) => {
  try {
    const { decision } = req.body; // 'approved' | 'rejected'
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.cancelRequest?.requested) return res.status(400).json({ message: 'No cancel request on this order' });

    order.cancelRequest.status = decision;
    order.cancelRequest.resolvedAt = new Date();
    order.cancelRequest.resolvedBy = req.user.email;

    if (decision === 'approved') {
      order.orderStatus = 'cancelled';
      order.statusHistory.push({
        status: 'cancelled',
        note: `Cancelled by admin. Customer reason: ${order.cancelRequest.reason || 'None'}`,
        updatedBy: req.user.email,
      });
      // Restore stock
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, { $inc: { stock: item.quantity, soldCount: -item.quantity } }).catch(() => {});
      }
      if (order.billing?.email) {
        sendMail({
          to: order.billing.email,
          subject: `Order Cancelled — ${order.orderNumber} | ShopZen`,
          html: await orderCancelledHtml(order),
        }).catch(() => {});
      }
    } else {
      if (order.billing?.email) {
        sendMail({
          to: order.billing.email,
          subject: `Cancellation Update — ${order.orderNumber} | ShopZen`,
          html: await cancelRejectedHtml(order),
        }).catch(() => {});
      }
    }

    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single order (public — works for guest and logged-in)
router.get('/:id', async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('items.product', 'name thumbnail slug')
      .populate('customer', 'firstName lastName email');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Claim a guest order after registration
router.patch('/:id/claim', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.customer) return res.json({ message: 'Already linked' });
    if (
      order.billing?.email &&
      order.billing.email.toLowerCase() !== req.user.email.toLowerCase()
    ) {
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