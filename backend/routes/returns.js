const express = require('express');
const router = express.Router();
const { ReturnRequest, Notification } = require('../models/index');
const { auth, adminAuth } = require('../middleware/auth');
const {
  sendMail,
  getAdminEmail,
  isEmailEnabled,
  returnRequestCustomerHtml,
  returnRequestAdminHtml,
  returnApprovedCustomerHtml,
  returnRejectedCustomerHtml,
  returnReceivedCustomerHtml,
  returnRefundedCustomerHtml,
  returnStatusAdminHtml,
} = require('../utils/mailer');

// ── Status label helpers ──────────────────────────────────────────────────────
const STATUS_LABELS = {
  pending:  'Pending ⏳',
  approved: 'Approved ✅',
  rejected: 'Rejected ❌',
  received: 'Item Received 📦',
  refunded: 'Refunded 💰',
};

// ── Customer — Submit return request ──────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const { order, items, reason, description, images } = req.body;

    const returnReq = await ReturnRequest.create({
      order,
      customer:      req.user._id,
      customerEmail: req.user.email,
      items,
      reason,
      description,
      images: images || [],
    });

    // Populate order for email data
    await returnReq.populate('order', 'orderNumber total');

    const returnId    = returnReq._id.toString().slice(-8).toUpperCase();
    const orderNumber = returnReq.order?.orderNumber || 'N/A';
    const customerName = `${req.user.firstName} ${req.user.lastName}`;

    // ── In-app notification (admin) ──
    await Notification.create({
      type:    'return_request',
      title:   '🔄 New Return Request',
      message: `${customerName} submitted a return request for order ${orderNumber}`,
      link:    `/admin/returns/${returnReq._id}`,
      data:    { returnId: returnReq._id, orderNumber },
    }).catch(() => {});

    // ── Email customer: return request received ──
    if (req.user.email) {
      if (await isEmailEnabled('return_request_customer')) {
        sendMail({
          to:      req.user.email,
          subject: `Return Request Received — Order ${orderNumber} | ShopZen`,
          html:    await returnRequestCustomerHtml({
            customerName,
            orderNumber,
            returnId,
            reason,
            description,
            items,
          }),
        }).catch(err => console.error('[RETURN REQUEST CUSTOMER EMAIL]', err.message));
      }
    }

    // ── Email admin: new return alert ──
    if (await isEmailEnabled('return_request_admin')) {
      const adminEmail = await getAdminEmail();
      if (adminEmail) {
        sendMail({
          to:      adminEmail,
          subject: `[Admin] 🔄 New Return Request — Order ${orderNumber}`,
          html:    await returnRequestAdminHtml({
            customerName,
            customerEmail: req.user.email,
            customerPhone: req.user.phone || '',
            orderNumber,
            orderId:   returnReq.order?._id,
            returnId,
            reason,
            description,
            items,
          }),
        }).catch(err => console.error('[RETURN REQUEST ADMIN EMAIL]', err.message));
      }
    }

    res.status(201).json(returnReq);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Customer — My return requests ─────────────────────────────────────────────
router.get('/my-returns', auth, async (req, res) => {
  try {
    const returns = await ReturnRequest.find({ customer: req.user._id })
      .populate('order', 'orderNumber total')
      .sort({ createdAt: -1 });
    res.json(returns);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin — All return requests ───────────────────────────────────────────────
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    const total   = await ReturnRequest.countDocuments(filter);
    const returns = await ReturnRequest.find(filter)
      .populate('order', 'orderNumber total createdAt')
      .populate('customer', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ returns, total, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin — Get single return ─────────────────────────────────────────────────
router.get('/admin/:id', adminAuth, async (req, res) => {
  try {
    const ret = await ReturnRequest.findById(req.params.id)
      .populate('order')
      .populate('customer', 'firstName lastName email phone');
    if (!ret) return res.status(404).json({ message: 'Return request not found' });
    res.json(ret);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Admin — Update return status ──────────────────────────────────────────────
router.put('/admin/:id', adminAuth, async (req, res) => {
  try {
    const { status, adminNote, refundAmount, refundMethod } = req.body;

    const ret = await ReturnRequest.findByIdAndUpdate(
      req.params.id,
      { status, adminNote, refundAmount, refundMethod, updatedAt: Date.now() },
      { new: true }
    )
      .populate('order', 'orderNumber total')
      .populate('customer', 'firstName lastName email phone');

    if (!ret) return res.status(404).json({ message: 'Return request not found' });

    const customerName  = `${ret.customer?.firstName || ''} ${ret.customer?.lastName || ''}`.trim();
    const customerEmail = ret.customerEmail || ret.customer?.email;
    const orderNumber   = ret.order?.orderNumber || 'N/A';
    const returnId      = ret._id.toString().slice(-8).toUpperCase();

    // ── In-app notification (admin) ──
    await Notification.create({
      type:    'return_status',
      title:   `Return ${STATUS_LABELS[status] || status}`,
      message: `Return #${returnId} for order ${orderNumber} (${customerName}) updated to ${status}`,
      link:    `/admin/returns/${ret._id}`,
      data:    { returnId: ret._id, status, orderNumber },
    }).catch(() => {});

    // ── Email customer based on new status ──
    if (customerEmail) {
      const basePayload = { customerName, orderNumber, returnId, adminNote };

      if (status === 'approved' && await isEmailEnabled('return_approved_customer')) {
        sendMail({
          to:      customerEmail,
          subject: `Return Approved — Order ${orderNumber} | ShopZen`,
          html:    await returnApprovedCustomerHtml({ ...basePayload, refundAmount, refundMethod }),
        }).catch(err => console.error('[RETURN APPROVED EMAIL]', err.message));
      }

      if (status === 'rejected' && await isEmailEnabled('return_rejected_customer')) {
        sendMail({
          to:      customerEmail,
          subject: `Return Request Update — Order ${orderNumber} | ShopZen`,
          html:    await returnRejectedCustomerHtml(basePayload),
        }).catch(err => console.error('[RETURN REJECTED EMAIL]', err.message));
      }

      if (status === 'received' && await isEmailEnabled('return_received_customer')) {
        sendMail({
          to:      customerEmail,
          subject: `We Received Your Return — Order ${orderNumber} | ShopZen`,
          html:    await returnReceivedCustomerHtml(basePayload),
        }).catch(err => console.error('[RETURN RECEIVED EMAIL]', err.message));
      }

      if (status === 'refunded' && await isEmailEnabled('return_refunded_customer')) {
        sendMail({
          to:      customerEmail,
          subject: `Refund Processed — Order ${orderNumber} | ShopZen`,
          html:    await returnRefundedCustomerHtml({ ...basePayload, refundAmount, refundMethod }),
        }).catch(err => console.error('[RETURN REFUNDED EMAIL]', err.message));
      }
    }

    // ── Email admin copy on every status change ──
    if (await isEmailEnabled('return_status_admin')) {
      const adminEmail = await getAdminEmail();
      if (adminEmail) {
        sendMail({
          to:      adminEmail,
          subject: `[Admin] Return ${status.toUpperCase()} — Order ${orderNumber}`,
          html:    await returnStatusAdminHtml({
            customerName,
            customerEmail,
            orderNumber,
            returnId,
            newStatus: status,
            refundAmount,
            refundMethod,
            adminNote,
          }),
        }).catch(err => console.error('[RETURN STATUS ADMIN EMAIL]', err.message));
      }
    }

    res.json(ret);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;