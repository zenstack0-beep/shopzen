'use strict';

const mongoose = require('mongoose');
const { Schema } = mongoose;

const behaviorSchema = new Schema({
  eventId: { type: String, trim: true, maxlength: 120 },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  emailHash: { type: String, index: true },
  sessionId: { type: String, trim: true, maxlength: 120 },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', index: true },
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
  eventType: { type: String, required: true, enum: ['product_viewed','product_searched','product_clicked_from_search','category_viewed','brand_viewed','added_to_cart','removed_from_cart','wishlist_added','checkout_started','checkout_abandoned','purchase_completed','email_opened','email_clicked','retargeting_converted'] },
  searchQuery: { type: String, trim: true, maxlength: 200 },
  source: { type: String, trim: true, maxlength: 80, default: 'storefront' },
  deviceType: { type: String, enum: ['desktop','mobile','tablet','unknown'], default: 'unknown' },
  referrer: { type: String, trim: true, maxlength: 500 },
  pagePath: { type: String, trim: true, maxlength: 500 },
  metadata: { type: Schema.Types.Mixed, default: {} },
  occurredAt: { type: Date, default: Date.now, index: true },
  createdAt: { type: Date, default: Date.now, index: true },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 90 * 86400000), index: { expires: 0 } },
});
behaviorSchema.index({ customerId: 1, productId: 1, createdAt: -1 });
behaviorSchema.index(
  { customerId: 1, eventId: 1 },
  { unique: true, partialFilterExpression: { eventId: { $type: 'string' } } }
);

const preferenceSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', index: true, sparse: true },
  email: { type: String, required: true, lowercase: true, trim: true, unique: true },
  marketingConsent: { type: Boolean, default: false, index: true },
  consentSource: { type: String, trim: true, maxlength: 80 },
  consentTimestamp: Date,
  consentVersion: { type: String, trim: true, maxlength: 40 },
  consentText: { type: String, trim: true, maxlength: 500 },
  unsubscribedAt: Date,
  suppressionReason: { type: String, trim: true, maxlength: 240 },
  complaintAt: Date,
  deletionRequestedAt: Date,
  emailFrequencyPreference: { type: String, enum: ['normal','reduced','none'], default: 'normal' },
}, { timestamps: true });

const interestSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  score: { type: Number, default: 0 },
  signals: { type: Schema.Types.Mixed, default: {} },
  lastInteractionAt: Date,
  calculatedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active','excluded','expired'], default: 'active' },
});
interestSchema.index({ customerId: 1, productId: 1 }, { unique: true });

const recommendationSchema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  customerEmail: { type: String, required: true, lowercase: true, trim: true },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  interestScore: Number,
  confidence: { type: Number, min: 0, max: 1, default: 0.7 },
  recommendationReason: { type: String, maxlength: 1000 },
  subject: { type: String, required: true, maxlength: 150 },
  previewText: { type: String, maxlength: 220 },
  headline: { type: String, maxlength: 180 },
  emailBody: { type: String, required: true, maxlength: 5000 },
  ctaText: { type: String, maxlength: 60, default: 'View Product' },
  ctaUrl: { type: String, required: true, maxlength: 1000 },
  productSnapshot: Schema.Types.Mixed,
  priceSnapshot: Number,
  stockSnapshot: Number,
  status: { type: String, enum: ['draft','suggested','pending_approval','approved','scheduled','sending','sent','rejected','cancelled','failed','converted'], default: 'pending_approval', index: true },
  approvalMode: { type: String, enum: ['manual','automatic'], default: 'manual' },
  approvedBy: { type: Schema.Types.ObjectId, ref: 'User' }, approvedAt: Date,
  rejectedBy: { type: Schema.Types.ObjectId, ref: 'User' }, rejectedAt: Date,
  scheduledAt: { type: Date, index: true }, sentAt: Date, cancelledAt: Date,
  cancellationReason: String,
  emailProviderMessageId: String,
  contentSource: { type: String, enum: ['ai','fallback','admin'], default: 'fallback' },
  failureReason: String,
  openAt: Date, clickAt: Date, convertedAt: Date,
  attribution: { orderId: Schema.Types.ObjectId, revenue: Number, method: String, purchaseTimestamp: Date },
}, { timestamps: true });
recommendationSchema.index({ customerId: 1, productId: 1, createdAt: -1 });
recommendationSchema.index({ status: 1, scheduledAt: 1 });

const settingsSchema = new Schema({
  singletonKey: { type: String, default: 'default', unique: true },
  enabled: { type: Boolean, default: false },
  automaticSendingEnabled: { type: Boolean, default: false },
  autoApprovalEnabled: { type: Boolean, default: false },
  trackingEnabled: { type: Boolean, default: false },
  aiEnabled: { type: Boolean, default: false },
  waitingPeriodDays: { type: Number, default: 7, min: 1, max: 90 },
  minimumInterestScore: { type: Number, default: 12, min: 1, max: 500 },
  minimumAutoApprovalConfidence: { type: Number, default: 0.85, min: 0, max: 1 },
  maximumEmailsPerWeek: { type: Number, default: 1, min: 0, max: 20 },
  maximumEmailsPerMonth: { type: Number, default: 3, min: 0, max: 100 },
  maximumEmailsPerDay: { type: Number, default: 100, min: 0, max: 10000 },
  sameProductCooldownDays: { type: Number, default: 30, min: 1, max: 365 },
  attributionWindowDays: { type: Number, default: 7, min: 1, max: 90 },
  allowedSendHours: { start: { type: Number, default: 9 }, end: { type: Number, default: 18 } },
  allowedSendingDays: { type: [Number], default: [1,2,3,4,5] },
  timezone: { type: String, default: 'Asia/Colombo' },
  emailOpenTrackingEnabled: { type: Boolean, default: false },
  emailClickTrackingEnabled: { type: Boolean, default: true },
  weights: { type: Schema.Types.Mixed, default: () => ({ product_viewed:2, repeated_product_view:4, product_searched:5, product_clicked_from_search:4, wishlist_added:8, added_to_cart:12, removed_from_cart:2, checkout_started:16, checkout_abandoned:20, repeated_category:3, repeated_brand:3, email_clicked:6 }) },
  excludedProducts: [{ type: Schema.Types.ObjectId, ref: 'Product' }],
  excludedCustomers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
  allowedProductCategories: [{ type: Schema.Types.ObjectId, ref: 'Category' }],
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const auditSchema = new Schema({
  adminId: { type: Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true, index: true },
  entityId: Schema.Types.ObjectId,
  previousStatus: String, newStatus: String,
  metadata: { type: Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now, index: true },
});

module.exports = {
  CustomerBehaviorEvent: mongoose.models.CustomerBehaviorEvent || mongoose.model('CustomerBehaviorEvent', behaviorSchema),
  CustomerMarketingPreference: mongoose.models.CustomerMarketingPreference || mongoose.model('CustomerMarketingPreference', preferenceSchema),
  ProductInterestScore: mongoose.models.ProductInterestScore || mongoose.model('ProductInterestScore', interestSchema),
  MarketingRecommendation: mongoose.models.MarketingRecommendation || mongoose.model('MarketingRecommendation', recommendationSchema),
  MarketingSettings: mongoose.models.MarketingSettings || mongoose.model('MarketingSettings', settingsSchema),
  MarketingAuditLog: mongoose.models.MarketingAuditLog || mongoose.model('MarketingAuditLog', auditSchema),
};
