'use strict';

const mongoose = require('mongoose');

const scheduledSocialPostSchema = new mongoose.Schema({
  batchId: { type:String, required:true, index:true },
  productId: { type:mongoose.Schema.Types.ObjectId, ref:'Product', required:true, index:true },
  productName: { type:String, required:true, maxlength:240 },
  platform: { type:String, enum:['facebook','instagram','tiktok','whatsapp','telegram'], required:true },
  scheduledAt: { type:Date, required:true, index:true },
  status: { type:String, enum:['pending','processing','published','failed','cancelled'], default:'pending', index:true },
  batchState: { type:String, enum:['active','paused','stopped'], default:'active', index:true },
  scheduleStartAt: Date,
  gapMinutes: { type:Number, min:1 },
  productsPerDay: { type:Number, min:1, max:50 },
  totalProducts: { type:Number, min:1, max:50 },
  caption: { type:String, required:true, maxlength:5000 },
  captionSource: { type:String, enum:['template','ai','fallback','admin'], default:'template' },
  languageMode: { type:String, enum:['mixed','english'], default:'mixed' },
  offerPercent: { type:Number, min:0, max:95, default:0 },
  regularPriceSnapshot: { type:Number, min:0 },
  sellingPriceSnapshot: { type:Number, required:true, min:0 },
  productSalePercentSnapshot: { type:Number, min:0, max:100, default:0 },
  promotionalPriceSnapshot: { type:Number, required:true, min:0 },
  displayPromotionalPriceSnapshot: { type:Number, min:0 },
  voucherCode: { type:String, uppercase:true, trim:true, maxlength:80, default:'' },
  couponSnapshot: { type:mongoose.Schema.Types.Mixed, default:null },
  createdBy: { type:mongoose.Schema.Types.ObjectId, ref:'User' },
  claimedAt: Date,
  pausedAt: Date,
  publishedAt: Date,
  cancelledAt: Date,
  publishLogId: { type:mongoose.Schema.Types.ObjectId, ref:'PublishLog' },
  platformPostId: { type:String, default:'' },
  failureReason: { type:String, maxlength:1000, default:'' },
}, { timestamps:true });

scheduledSocialPostSchema.index({ status:1, scheduledAt:1 });
scheduledSocialPostSchema.index({ batchId:1, productId:1, platform:1 }, { unique:true });

module.exports = mongoose.models.ScheduledSocialPost || mongoose.model('ScheduledSocialPost', scheduledSocialPostSchema);
