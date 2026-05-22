const express = require('express');
const router = express.Router();
const { ReturnRequest, Notification } = require('../models/index');
const { auth, adminAuth } = require('../middleware/auth');

// Customer - Submit return request
router.post('/', auth, async (req, res) => {
  try {
    const { order, items, reason, description, images } = req.body;
    const returnReq = await ReturnRequest.create({
      order, customer: req.user._id, customerEmail: req.user.email,
      items, reason, description, images: images || []
    });
    await Notification.create({
      type: 'return_request', title: 'New Return Request',
      message: `${req.user.firstName} ${req.user.lastName} submitted a return request`,
      link: `/admin/returns/${returnReq._id}`
    });
    res.status(201).json(returnReq);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Customer - My return requests
router.get('/my-returns', auth, async (req, res) => {
  try {
    const returns = await ReturnRequest.find({ customer: req.user._id })
      .populate('order', 'orderNumber total').sort({ createdAt: -1 });
    res.json(returns);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - All return requests
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    const total = await ReturnRequest.countDocuments(filter);
    const returns = await ReturnRequest.find(filter)
      .populate('order', 'orderNumber total createdAt')
      .populate('customer', 'firstName lastName email')
      .sort({ createdAt: -1 }).skip((page-1)*limit).limit(Number(limit));
    res.json({ returns, total, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Get single return
router.get('/admin/:id', adminAuth, async (req, res) => {
  try {
    const ret = await ReturnRequest.findById(req.params.id)
      .populate('order').populate('customer', 'firstName lastName email phone');
    if (!ret) return res.status(404).json({ message: 'Return request not found' });
    res.json(ret);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Update return status
router.put('/admin/:id', adminAuth, async (req, res) => {
  try {
    const { status, adminNote, refundAmount, refundMethod } = req.body;
    const ret = await ReturnRequest.findByIdAndUpdate(
      req.params.id,
      { status, adminNote, refundAmount, refundMethod, updatedAt: Date.now() },
      { new: true }
    ).populate('customer', 'firstName lastName email');
    res.json(ret);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
