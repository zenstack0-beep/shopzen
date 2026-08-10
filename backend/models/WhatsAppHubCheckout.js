'use strict';

const mongoose = require('mongoose');

const whatsappHubCheckoutSchema = new mongoose.Schema({
  externalReference: { type: String, trim: true, maxlength: 120, index: true },
  status: {
    type: String,
    enum: ['prepared', 'confirming', 'confirmed', 'failed'],
    default: 'prepared',
    index: true,
  },
  orderPayload: { type: mongoose.Schema.Types.Mixed, required: true },
  quote: {
    subtotal: Number,
    couponDiscount: Number,
    giftCardDeduction: Number,
    shippingCost: Number,
    total: Number,
    deliveryServiceName: String,
    items: [{ productId: mongoose.Schema.Types.ObjectId, name: String, quantity: Number, unitPrice: Number, subtotal: Number }],
  },
  order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  orderNumber: { type: String, default: '' },
  lastError: { type: String, default: '' },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

whatsappHubCheckoutSchema.index(
  { externalReference: 1 },
  { unique: true, partialFilterExpression: { externalReference: { $type: 'string', $gt: '' } } }
);

module.exports = mongoose.models.WhatsAppHubCheckout || mongoose.model('WhatsAppHubCheckout', whatsappHubCheckoutSchema);

