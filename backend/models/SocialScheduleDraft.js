'use strict';

const mongoose=require('mongoose');

const draftItemSchema=new mongoose.Schema({
  productId:{type:mongoose.Schema.Types.ObjectId,ref:'Product',required:true},
  productName:{type:String,required:true,maxlength:240},
  scheduledAt:{type:Date,required:true},
  caption:{type:String,required:true,maxlength:5000},
},{_id:false});

const socialScheduleDraftSchema=new mongoose.Schema({
  status:{type:String,enum:['draft','confirming','confirmed','discarded'],default:'draft',index:true},
  productIds:[{type:mongoose.Schema.Types.ObjectId,ref:'Product',required:true}],
  platforms:[{type:String,enum:['facebook','instagram','tiktok','whatsapp','telegram'],required:true}],
  startAt:{type:Date,required:true},
  gapMinutes:{type:Number,required:true,min:1},
  productsPerDay:{type:Number,required:true,min:1,max:50},
  offerPercent:{type:Number,min:0,max:95,default:0},
  voucherCode:{type:String,uppercase:true,trim:true,maxlength:80,default:''},
  includeSinhala:{type:Boolean,default:true},
  ctaType:{type:String,enum:['none','shop_now','whatsapp'],default:'shop_now'},
  items:{type:[draftItemSchema],default:[]},
  createdBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},
  confirmedBatchId:{type:String,default:''},
  confirmedAt:Date,
  expiresAt:{type:Date,required:true,index:true},
},{timestamps:true});

socialScheduleDraftSchema.index({expiresAt:1},{expireAfterSeconds:0});

module.exports=mongoose.models.SocialScheduleDraft||mongoose.model('SocialScheduleDraft',socialScheduleDraftSchema);
