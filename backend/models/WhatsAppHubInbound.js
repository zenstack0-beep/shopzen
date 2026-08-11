'use strict';

const mongoose = require('mongoose');

// ShopZen owns the integration inbox. The Hub reads it only through the
// authenticated connector API and therefore never needs database access.
const whatsappHubInboundSchema = new mongoose.Schema({
  metaMessageId: { type: String, required: true, unique: true, index: true },
  from: { type: String, required: true, maxlength: 32 },
  customerName: { type: String, default: '', maxlength: 160 },
  messageType: { type: String, required: true, maxlength: 40 },
  message: { type: mongoose.Schema.Types.Mixed, required: true },
  receivedAt: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'acknowledged'], default: 'pending', index: true },
  acknowledgedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });

module.exports = mongoose.models.WhatsAppHubInbound || mongoose.model('WhatsAppHubInbound', whatsappHubInboundSchema);
