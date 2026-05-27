const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  guestInfo: {
    firstName: String, lastName: String,
    email: String, phone: String
  },
  items: [{
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    name: String,
    image: String,
    price: Number,
    quantity: Number,
    subtotal: Number
  }],
  billing: {
    firstName: String, lastName: String,
    country: String, street: String,
    city: String, phone: String, email: String
  },
  shipping: {
    firstName: String, lastName: String,
    country: String, street: String,
    city: String, phone: String
  },
  shipToDifferentAddress: { type: Boolean, default: false },
  paymentMethod: { type: String, enum: ['bank_transfer', 'cod'], required: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  orderStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded'],
    default: 'pending'
  },
  statusHistory: [{
    status: String,
    note: String,
    updatedAt: { type: Date, default: Date.now },
    updatedBy: String
  }],
  couponCode: { type: String },
  couponDiscount: { type: Number, default: 0 },
  subtotal: { type: Number, required: true },
  shippingCost: { type: Number, default: 0 },
  tax: { type: Number, default: 0 },
  total: { type: Number, required: true },
  notes: { type: String },
  trackingNumber: { type: String },
  deliveryPartner: { type: String },
  estimatedDelivery: { type: Date },
  deliveredAt: { type: Date },
  isRead: { type: Boolean, default: false },
  giftCard: { type: String },
  giftCardDiscount: { type: Number, default: 0 },
  paymentSlip: { type: String }, // URL to uploaded bank transfer slip
  paymentSlipUploadedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

orderSchema.pre('save', function(next) {
  if (!this.orderNumber) {
    this.orderNumber = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
  }
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Order', orderSchema);