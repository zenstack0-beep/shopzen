const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const { Coupon, GiftCard, Notification, Settings, DeliveryService } = require('../models/index');
const { auth, adminAuth } = require('../middleware/auth');
const {
  sendMail,
  getAdminEmail,
  orderConfirmHtml,
  newOrderAdminHtml,
  slipUploadedAdminHtml,
  slipReceivedCustomerHtml,
  paymentConfirmedHtml,
  orderCancelledHtml,
  cancelRequestAdminHtml,
  cancelRequestReceivedCustomerHtml,
  cancelRejectedHtml,
  cancelApprovedAdminHtml,
  cancelRejectedAdminHtml,
  cancelAutoDecisionAdminHtml,
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

// ── Auto-cancel decision scheduler ───────────────────────────────────────────
const runAutoCancelDecisions = async () => {
  try {
    const rows = await Settings.find({
      key: { $in: ['autoDecisionEnabled', 'autoDecisionMinutes', 'autoDecisionAction'] },
    }).lean();
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.value; });

    if (!cfg.autoDecisionEnabled) return;

    const minutes = Number(cfg.autoDecisionMinutes) || 60;
    const action  = cfg.autoDecisionAction === 'reject' ? 'rejected' : 'approved';
    const cutoff  = new Date(Date.now() - minutes * 60 * 1000);

    const pending = await Order.find({
      'cancelRequest.requested': true,
      'cancelRequest.status': 'pending',
      'cancelRequest.requestedAt': { $lte: cutoff },
    });

    for (const order of pending) {
      order.cancelRequest.status     = action;
      order.cancelRequest.resolvedAt = new Date();
      order.cancelRequest.resolvedBy = 'system (auto)';

      if (action === 'approved') {
        order.orderStatus = 'cancelled';
        order.statusHistory.push({
          status: 'cancelled',
          note: `Auto-cancelled by system after ${minutes} min. Customer reason: ${order.cancelRequest.reason || 'None'}`,
          updatedBy: 'system',
        });
        for (const item of order.items) {
          await Product.findByIdAndUpdate(item.product, {
            $inc: { stock: item.quantity, soldCount: -item.quantity },
          }).catch(() => {});
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

      await Notification.create({
        type: 'cancel_auto_decision',
        title: action === 'approved' ? '🤖 Auto-Cancelled Order' : '🤖 Auto-Rejected Cancel Request',
        message: `Order ${order.orderNumber} — cancellation auto-${action} after ${minutes} min`,
        link: `/admin/orders/${order._id}`,
        data: { orderId: order._id, action },
      }).catch(() => {});

      const adminEmail = await getAdminEmail();
      if (adminEmail) {
        sendMail({
          to: adminEmail,
          subject: `🤖 Auto-${action === 'approved' ? 'Cancellation' : 'Rejection'} — ${order.orderNumber} | ShopZen`,
          html: await cancelAutoDecisionAdminHtml(order, action),
        }).catch(() => {});
      }

      console.log(`[AUTO-CANCEL] Order ${order.orderNumber} → ${action}`);
    }
  } catch (err) {
    console.error('[AUTO-CANCEL] Scheduler error:', err.message);
  }
};

setInterval(runAutoCancelDecisions, 60 * 1000);
setTimeout(runAutoCancelDecisions, 5000);

// ── Admin — Get all orders ────────────────────────────────────────────────────
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

// ── Admin — Update order status ───────────────────────────────────────────────
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

    if (!order) return res.status(404).json({ message: 'Order not found' });

    // In-app notification for admin panel
    const statusLabels = {
      confirmed: 'Confirmed ✅', processing: 'Processing 🔄', shipped: 'Shipped 📦',
      out_for_delivery: 'Out for Delivery 🚚', delivered: 'Delivered ✅',
      cancelled: 'Cancelled ❌', refunded: 'Refunded 💰',
    };
    await Notification.create({
      type: 'order_status',
      title: `Order ${statusLabels[status] || status}`,
      message: `Order ${order.orderNumber} (${order.billing?.firstName} ${order.billing?.lastName}) → ${status}`,
      link: `/admin/orders/${order._id}`,
      data: { orderId: order._id, status },
    }).catch(() => {});

    // Email customer
    const notifyStatuses = ['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
    if (order.billing?.email && notifyStatuses.includes(status)) {
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

// ── Admin — Mark order as read ────────────────────────────────────────────────
router.put('/admin/:id/read', adminAuth, async (req, res) => {
  try {
    await Order.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin — Confirm payment (manual gateway) ──────────────────────────────────
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
    if (!order) return res.status(404).json({ message: 'Order not found' });

    await Notification.create({
      type: 'payment_confirmed',
      title: '✅ Payment Confirmed',
      message: `Order ${order.orderNumber} — payment confirmed manually`,
      link: `/admin/orders/${order._id}`,
    }).catch(() => {});

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin — Confirm payment from uploaded slip ────────────────────────────────
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
    if (!order) return res.status(404).json({ message: 'Order not found' });

    await Notification.create({
      type: 'payment_confirmed',
      title: '✅ Slip Verified & Payment Confirmed',
      message: `Order ${order.orderNumber} — bank slip verified by admin`,
      link: `/admin/orders/${order._id}`,
    }).catch(() => {});

    if (order.billing?.email) {
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

// ── Customer — Get my orders ──────────────────────────────────────────────────
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

// ── Place order (public — guest + logged in) ──────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      items, billing, shipping, shipToDifferentAddress,
      paymentMethod, couponCode, giftCard, notes, deliveryService,
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
        product: product._id, name: product.name, image: product.thumbnail,
        price, quantity: item.quantity, subtotal: itemSubtotal,
      });
      await Product.findByIdAndUpdate(product._id, {
        $inc: { stock: -item.quantity, soldCount: item.quantity },
      });
    }

    let couponDiscount = 0;
    if (couponCode) {
      const coupon = await Coupon.findOne({
        code: couponCode.toUpperCase(), isActive: true,
        validUntil: { $gte: new Date() },
      });
      if (coupon && subtotal >= (coupon.minOrderAmount || 0)) {
        couponDiscount = coupon.type === 'percentage'
          ? Math.min((subtotal * coupon.value) / 100, coupon.maxDiscount || Infinity)
          : coupon.value;
        coupon.usedCount += 1;
        await coupon.save();
      }
    }

    let giftCardDiscount = 0;
    let giftCardDoc = null;
    if (giftCard) {
      giftCardDoc = await GiftCard.findOne({
        code: giftCard.toUpperCase(), isActive: true,
        expiresAt: { $gte: new Date() },
      });
      if (giftCardDoc && giftCardDoc.balance > 0) {
        giftCardDiscount = Math.min(giftCardDoc.balance, subtotal - couponDiscount);
      }
    }

    let shippingCost = 0;
    let deliveryServiceName = 'Standard Delivery';
    if (deliveryService) {
      const svc = await DeliveryService.findOne({ code: deliveryService, isEnabled: true });
      if (svc) {
        const city = (billing?.city || '').toLowerCase();
        let rate = null;
        if (city && svc.zoneRates?.length > 0) {
          rate = svc.zoneRates.find(zr =>
            zr.zones?.some(z => z.toLowerCase() === city || city.includes(z.toLowerCase()))
          );
        }
        if (!rate && svc.rates?.length > 0) rate = svc.rates[0];
        if (rate) {
          shippingCost = rate.freeAbove && subtotal >= rate.freeAbove ? 0 : rate.price;
        }
        deliveryServiceName = svc.name;
      }
    } else {
      const settingsMap = {};
      const allSettings = await Settings.find({
        key: { $in: ['standardDelivery', 'freeDeliveryThreshold'] },
      });
      allSettings.forEach((s) => (settingsMap[s.key] = s.value));
      const freeThreshold = settingsMap.freeDeliveryThreshold || 5000;
      shippingCost = subtotal >= freeThreshold ? 0 : (settingsMap.standardDelivery || 600);
    }

    const total = Math.max(0, subtotal - couponDiscount - giftCardDiscount + shippingCost);

    const orderData = {
      items: orderItems, billing,
      shipping: shipToDifferentAddress ? shipping : billing,
      shipToDifferentAddress, paymentMethod,
      paymentStatus: 'pending', orderStatus: 'pending',
      couponCode, couponDiscount, giftCard, giftCardDiscount,
      subtotal, shippingCost,
      discount: couponDiscount + giftCardDiscount,
      total, notes,
      deliveryService: deliveryService || 'standard', deliveryServiceName,
      statusHistory: [{ status: 'pending', note: 'Order placed', updatedBy: billing.email }],
    };

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

    if (giftCardDoc && giftCardDiscount > 0) {
      giftCardDoc.balance -= giftCardDiscount;
      giftCardDoc.usageHistory.push({ orderId: order._id, amount: giftCardDiscount });
      if (giftCardDoc.balance <= 0) giftCardDoc.isActive = false;
      await giftCardDoc.save();
    }

    // ── Admin in-app notification ──
    await Notification.create({
      type: 'new_order',
      title: '🛒 New Order Received!',
      message: `Order ${order.orderNumber} from ${billing.firstName} ${billing.lastName} — Rs. ${total.toLocaleString()}`,
      link: `/admin/orders/${order._id}`,
      data: { orderId: order._id, total, paymentMethod },
    });

    // ── Email customer: order confirmation ──
    if (billing?.email) {
      sendMail({
        to: billing.email,
        subject: `Order Confirmed — ${order.orderNumber} | ShopZen`,
        html: await orderConfirmHtml(order),
      }).catch(err => console.error('[ORDER CONFIRM EMAIL]', err.message));
    }

    // ── Email admin: new order alert ──
    const adminEmail = await getAdminEmail();
    if (adminEmail) {
      sendMail({
        to: adminEmail,
        subject: `🛒 New Order ${order.orderNumber} — Rs. ${total.toLocaleString()} | ShopZen`,
        html: await newOrderAdminHtml(order),
      }).catch(err => console.error('[NEW ORDER ADMIN EMAIL]', err.message));
    }

    res.status(201).json({
      orderId: order._id, orderNumber: order.orderNumber, total, paymentMethod,
    });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── Payment gateway webhook — auto-confirm order after successful payment ──────
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
      type: 'payment_confirmed',
      title: '✅ Payment Confirmed',
      message: `Order ${order.orderNumber} payment received via ${gateway}`,
      link: `/admin/orders/${order._id}`,
    });

    // Email customer: payment confirmed
    if (order.billing?.email) {
      sendMail({
        to: order.billing.email,
        subject: `✅ Payment Confirmed — Order ${order.orderNumber} | ShopZen`,
        html: await paymentConfirmedHtml(order),
      }).catch(() => {});
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Upload payment slip ───────────────────────────────────────────────────────
router.post('/:id/payment-slip', uploadSlip.single('slip'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    let slipUrl, slipRelPath;
    if (USE_CLOUDINARY) {
      slipUrl = req.file.path;
      slipRelPath = slipUrl;
    } else {
      slipRelPath = `/uploads/payment-slips/${req.file.filename}`;
      slipUrl = absoluteSlipUrl(slipRelPath);
    }

    order.paymentSlip = slipRelPath;
    order.paymentSlipUploadedAt = new Date();
    await order.save();

    // ── Admin in-app notification ──
    await Notification.create({
      type: 'payment_slip',
      title: '📎 Payment Slip Uploaded',
      message: `Order ${order.orderNumber} — ${order.billing?.firstName} ${order.billing?.lastName} uploaded a payment slip`,
      link: `/admin/orders/${order._id}`,
    }).catch(() => {});

    // ── Email admin: slip uploaded ──
    const adminEmail = await getAdminEmail();
    if (adminEmail) {
      sendMail({
        to: adminEmail,
        subject: `📎 Payment Slip Uploaded — ${order.orderNumber} | ShopZen`,
        html: await slipUploadedAdminHtml(order, slipUrl),
      }).catch(err => console.error('[SLIP ADMIN EMAIL]', err.message));
    }

    // ── Email customer: slip received ──
    if (order.billing?.email) {
      sendMail({
        to: order.billing.email,
        subject: `Payment Slip Received — ${order.orderNumber} | ShopZen`,
        html: await slipReceivedCustomerHtml(order),
      }).catch(err => console.error('[SLIP CUSTOMER EMAIL]', err.message));
    }

    res.json({ success: true, slipUrl: slipRelPath });
  } catch (err) {
    console.error('Slip upload error:', err);
    res.status(500).json({ message: err.message });
  }
});

// ── Customer — Request order cancellation ─────────────────────────────────────
router.post('/:id/cancel-request', auth, async (req, res) => {
  try {
    const { reason } = req.body;
    const order = await Order.findOne({ _id: req.params.id, customer: req.user._id });
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const cancellableStatuses = ['pending', 'confirmed'];
    if (!cancellableStatuses.includes(order.orderStatus)) {
      return res.status(400).json({ message: 'Order cannot be cancelled at this stage' });
    }
    if (order.cancelRequest?.requested) {
      return res.status(400).json({ message: 'Cancellation already requested' });
    }

    const windowSetting  = await Settings.findOne({ key: 'cancelWindowMinutes' });
    const rawWindow      = windowSetting ? windowSetting.value : null;
    const parsedWindow   = (rawWindow !== null && rawWindow !== undefined && String(rawWindow).trim() !== '')
      ? Number(rawWindow) : 60;
    const windowMinutes  = (!isNaN(parsedWindow) && isFinite(parsedWindow)) ? parsedWindow : 60;

    if (windowMinutes === 0) {
      return res.status(400).json({ message: 'Order cancellations are disabled by the store' });
    }
    const orderPlacedAt = new Date(order.createdAt).getTime();
    if (!isFinite(orderPlacedAt) || orderPlacedAt <= 0) {
      return res.status(400).json({ message: 'Cannot determine order placement time' });
    }
    const minutesElapsed = (Date.now() - orderPlacedAt) / 60000;
    if (minutesElapsed > windowMinutes) {
      return res.status(400).json({
        message: `Cancellation window of ${windowMinutes} minute${windowMinutes !== 1 ? 's' : ''} has passed. Please contact support.`,
      });
    }

    order.cancelRequest = {
      requested: true,
      requestedAt: new Date(),
      reason,
      status: 'pending',
    };
    await order.save();

    // ── Admin in-app notification ──
    await Notification.create({
      type: 'cancel_request',
      title: '🚫 Cancellation Request',
      message: `Order ${order.orderNumber} — ${order.billing?.firstName} ${order.billing?.lastName} requested cancellation${reason ? `: "${reason}"` : ''}`,
      link: `/admin/orders/${order._id}`,
      data: { orderId: order._id, reason },
    }).catch(() => {});

    // ── Email admin: cancel request ──
    const adminEmail = await getAdminEmail();
    if (adminEmail) {
      sendMail({
        to: adminEmail,
        subject: `🚫 Cancel Request — ${order.orderNumber} | ShopZen`,
        html: await cancelRequestAdminHtml(order),
      }).catch(() => {});
    }

    // ── Email customer: request received confirmation ──
    if (order.billing?.email) {
      sendMail({
        to: order.billing.email,
        subject: `Cancellation Request Received — ${order.orderNumber} | ShopZen`,
        html: await cancelRequestReceivedCustomerHtml(order),
      }).catch(() => {});
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin — Approve or reject a cancel request ────────────────────────────────
router.put('/admin/:id/cancel-decision', adminAuth, async (req, res) => {
  try {
    const { decision } = req.body; // 'approved' | 'rejected'
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!order.cancelRequest?.requested)
      return res.status(400).json({ message: 'No cancel request on this order' });

    order.cancelRequest.status     = decision;
    order.cancelRequest.resolvedAt = new Date();
    order.cancelRequest.resolvedBy = req.user.email;

    const adminEmail = await getAdminEmail();

    if (decision === 'approved') {
      order.orderStatus = 'cancelled';
      order.statusHistory.push({
        status: 'cancelled',
        note: `Cancelled by admin. Customer reason: ${order.cancelRequest.reason || 'None'}`,
        updatedBy: req.user.email,
      });
      for (const item of order.items) {
        await Product.findByIdAndUpdate(item.product, {
          $inc: { stock: item.quantity, soldCount: -item.quantity },
        }).catch(() => {});
      }

      await Notification.create({
        type: 'cancel_approved',
        title: '✅ Cancellation Approved',
        message: `Order ${order.orderNumber} — cancellation approved, stock restored`,
        link: `/admin/orders/${order._id}`,
      }).catch(() => {});

      if (order.billing?.email) {
        sendMail({
          to: order.billing.email,
          subject: `Order Cancelled — ${order.orderNumber} | ShopZen`,
          html: await orderCancelledHtml(order),
        }).catch(() => {});
      }
      if (adminEmail) {
        sendMail({
          to: adminEmail,
          subject: `✅ Cancellation Approved — ${order.orderNumber} | ShopZen`,
          html: await cancelApprovedAdminHtml(order),
        }).catch(() => {});
      }
    } else {
      await Notification.create({
        type: 'cancel_rejected',
        title: '❌ Cancellation Rejected',
        message: `Order ${order.orderNumber} — cancellation request rejected`,
        link: `/admin/orders/${order._id}`,
      }).catch(() => {});

      if (order.billing?.email) {
        sendMail({
          to: order.billing.email,
          subject: `Cancellation Update — ${order.orderNumber} | ShopZen`,
          html: await cancelRejectedHtml(order),
        }).catch(() => {});
      }
      if (adminEmail) {
        sendMail({
          to: adminEmail,
          subject: `❌ Cancellation Rejected — ${order.orderNumber} | ShopZen`,
          html: await cancelRejectedAdminHtml(order),
        }).catch(() => {});
      }
    }

    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Get single order (public — guest + logged-in) ─────────────────────────────
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

// ── Claim a guest order after registration ────────────────────────────────────
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