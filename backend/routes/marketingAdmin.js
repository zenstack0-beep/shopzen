'use strict';

const express = require('express');
const { adminAuth } = require('../middleware/auth');
const { MarketingRecommendation, MarketingSettings, MarketingAuditLog, CustomerMarketingPreference, CustomerBehaviorEvent } = require('../models/Marketing');
const { clean, generateContent, getSettings, sendRecommendation, validateEligibility } = require('../services/marketingService');
const router = express.Router();
router.use(adminAuth);

const audit = (req, action, rec, previousStatus, metadata = {}) => MarketingAuditLog.create({ adminId: req.user._id, action, entityId: rec._id, previousStatus, newStatus: rec.status, metadata });

router.get('/dashboard', async (_req, res) => {
  const grouped = await MarketingRecommendation.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$attribution.revenue', 0] } } } }]);
  const stats = Object.fromEntries(grouped.map(x => [x._id, x.count]));
  const sent = (stats.sent || 0) + (stats.converted || 0); const converted = stats.converted || 0;
  const unsubscribes = await CustomerMarketingPreference.countDocuments({ unsubscribedAt: { $ne: null } });
  const settings = await getSettings();
  res.json({ stats, revenue: grouped.reduce((n,x)=>n+x.revenue,0), conversionRate: sent ? converted / sent * 100 : 0, unsubscribes, autoApprovalEnabled: settings.autoApprovalEnabled });
});
router.get('/behavior', async (_req, res) => {
  try {
    const since24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [totalEvents, eventsLast24Hours, customerGroups, eventGroups, recentEvents, consentedCustomers] = await Promise.all([
      CustomerBehaviorEvent.countDocuments(),
      CustomerBehaviorEvent.countDocuments({ createdAt: { $gte: since24Hours } }),
      CustomerBehaviorEvent.aggregate([{ $match: { customerId: { $ne: null } } }, { $group: { _id: '$customerId' } }, { $count: 'count' }]),
      CustomerBehaviorEvent.aggregate([{ $group: { _id: '$eventType', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      CustomerBehaviorEvent.find().populate('customerId', 'firstName lastName email').populate('productId', 'name slug thumbnail').sort({ createdAt: -1 }).limit(30).lean(),
      CustomerMarketingPreference.countDocuments({ marketingConsent: true, unsubscribedAt: null, suppressionReason: { $in: [null, ''] } }),
    ]);
    res.json({
      totalEvents,
      eventsLast24Hours,
      trackedCustomers: customerGroups[0]?.count || 0,
      consentedCustomers,
      byType: Object.fromEntries(eventGroups.map(group => [group._id, group.count])),
      recentEvents,
    });
  } catch (error) {
    res.status(500).json({ message: 'Customer behavior data could not be loaded' });
  }
});
router.get('/segments', async (_req, res) => {
  try {
    const since30Days = new Date(Date.now() - 30 * 86400000);
    const rows = await CustomerBehaviorEvent.aggregate([
      { $set: { effectiveAt: { $ifNull: ['$occurredAt','$createdAt'] } } },
      { $match: { customerId: { $ne: null }, effectiveAt: { $gte: since30Days } } },
      { $group: {
        _id: '$customerId', lastSeenAt: { $max: '$effectiveAt' }, events: { $sum: 1 },
        productViews: { $sum: { $cond: [{ $eq: ['$eventType','product_viewed'] },1,0] } },
        searches: { $sum: { $cond: [{ $eq: ['$eventType','product_searched'] },1,0] } },
        cartAdds: { $sum: { $cond: [{ $eq: ['$eventType','added_to_cart'] },1,0] } },
        checkoutStarts: { $sum: { $cond: [{ $eq: ['$eventType','checkout_started'] },1,0] } },
        purchases: { $sum: { $cond: [{ $eq: ['$eventType','purchase_completed'] },1,0] } },
        emailClicks: { $sum: { $cond: [{ $eq: ['$eventType','email_clicked'] },1,0] } },
      } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'customer' } },
      { $unwind: { path: '$customer', preserveNullAndEmptyArrays: true } },
      { $sort: { lastSeenAt: -1 } }, { $limit: 250 },
    ]);
    const classify = row => {
      if (row.purchases > 0) return 'recent_customer';
      if (row.checkoutStarts > 0) return 'checkout_abandoner';
      if (row.cartAdds > 0) return 'cart_abandoner';
      if (row.emailClicks > 0) return 'email_engaged';
      if (row.productViews >= 3 || row.searches >= 2) return 'high_intent_browser';
      return 'browser';
    };
    const items = rows.map(row => ({
      customerId: row._id, customerName: [row.customer?.firstName,row.customer?.lastName].filter(Boolean).join(' '),
      email: row.customer?.email, segment: classify(row), lastSeenAt: row.lastSeenAt, events: row.events,
      productViews: row.productViews, searches: row.searches, cartAdds: row.cartAdds,
      checkoutStarts: row.checkoutStarts, purchases: row.purchases, emailClicks: row.emailClicks,
    }));
    const counts = items.reduce((out,item) => { out[item.segment] = (out[item.segment] || 0) + 1; return out; }, {});
    res.json({ generatedAt: new Date(), windowDays: 30, counts, items });
  } catch (error) { res.status(500).json({ message: 'Behavior segments could not be generated' }); }
});
router.post('/analyze', async (req, res) => {
  try {
    const result = await require('../services/marketingService').generateRecommendations();
    await MarketingAuditLog.create({ adminId:req.user._id, action:'manual_analysis_run', metadata:result });
    res.json(result);
  } catch (error) { res.status(500).json({ message:'Marketing analysis failed' }); }
});
router.get('/recommendations', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const filter = {}; if (req.query.status) filter.status = req.query.status; if (req.query.customer) filter.customerEmail = new RegExp(clean(req.query.customer,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i');
  const [items,total] = await Promise.all([MarketingRecommendation.find(filter).populate('customerId','firstName lastName').populate('productId','name slug thumbnail images price salePrice stock isOnSale category').sort({ createdAt:-1 }).skip((page-1)*limit).limit(limit).lean(), MarketingRecommendation.countDocuments(filter)]);
  res.json({ items, total, page, pages: Math.ceil(total/limit) });
});
router.get('/recommendations/:id', async (req,res) => { const rec=await MarketingRecommendation.findById(req.params.id).populate('customerId','firstName lastName').populate('productId'); if(!rec)return res.status(404).json({message:'Recommendation not found'}); res.json(rec); });
router.put('/recommendations/:id', async (req,res) => {
  const rec=await MarketingRecommendation.findById(req.params.id); if(!rec)return res.status(404).json({message:'Recommendation not found'}); const prev=rec.status;
  ['subject','previewText','headline','emailBody','ctaText'].forEach(k=>{if(req.body[k]!=null)rec[k]=clean(req.body[k],k==='emailBody'?5000:220);}); rec.contentSource='admin'; await rec.save(); await audit(req,'admin_edited',rec,prev); res.json(rec);
});
async function transition(req,res,status,action) { const rec=await MarketingRecommendation.findById(req.params.id); if(!rec)return res.status(404).json({message:'Recommendation not found'}); const prev=rec.status; const settings=await getSettings(); const v=await validateEligibility({customerId:rec.customerId,productId:rec.productId,settings,recommendation:rec}); if(['approved','scheduled'].includes(status)&&!v.eligible)return res.status(409).json({message:v.reason}); rec.status=status; if(status==='approved'){rec.approvedBy=req.user._id;rec.approvedAt=new Date();rec.approvalMode='manual';} if(status==='rejected'){rec.rejectedBy=req.user._id;rec.rejectedAt=new Date();} if(status==='cancelled'){rec.cancelledAt=new Date();rec.cancellationReason=clean(req.body.reason||'Cancelled by administrator',240);} await rec.save();await audit(req,action,rec,prev);res.json(rec); }
router.post('/recommendations/:id/approve',(req,res)=>transition(req,res,'approved','admin_approved'));
router.post('/recommendations/:id/reject',(req,res)=>transition(req,res,'rejected','rejected'));
router.post('/recommendations/:id/cancel',(req,res)=>transition(req,res,'cancelled','cancelled'));
router.post('/recommendations/:id/schedule',async(req,res)=>{const d=new Date(req.body.scheduledAt);if(isNaN(d)||d<=new Date())return res.status(400).json({message:'A future schedule time is required'});const rec=await MarketingRecommendation.findById(req.params.id);if(!rec)return res.status(404).json({message:'Not found'});const settings=await getSettings();const v=await validateEligibility({customerId:rec.customerId,productId:rec.productId,settings,recommendation:rec});if(!v.eligible)return res.status(409).json({message:v.reason});const prev=rec.status;rec.status='scheduled';rec.scheduledAt=d;await rec.save();await audit(req,'scheduled',rec,prev);res.json(rec);});
router.post('/recommendations/:id/send',async(req,res)=>{const settings=await getSettings();if(!settings.automaticSendingEnabled)return res.status(409).json({message:'Marketing sending is disabled in settings'});try{const rec=await sendRecommendation(req.params.id);res.json(rec);}catch(e){res.status(502).json({message:'Email delivery failed'});}});
router.post('/recommendations/:id/regenerate',async(req,res)=>{const rec=await MarketingRecommendation.findById(req.params.id).populate('productId');if(!rec)return res.status(404).json({message:'Not found'});const content=await generateContent(rec.productId,{},await getSettings());Object.assign(rec,{subject:content.subject,previewText:content.previewText,headline:content.headline,emailBody:content.body,ctaText:content.ctaText,recommendationReason:content.reason,confidence:content.confidence,contentSource:content.source});await rec.save();await audit(req,'content_regenerated',rec,rec.status);res.json(rec);});
router.get('/recommendations/:id/activity',async(req,res)=>{const rec=await MarketingRecommendation.findById(req.params.id);if(!rec)return res.status(404).json({message:'Not found'});const events=await CustomerBehaviorEvent.find({customerId:rec.customerId,productId:rec.productId}).select('eventType source createdAt').sort({createdAt:-1}).limit(100);res.json(events);});
router.get('/settings',async(_req,res)=>res.json(await getSettings()));
router.put('/settings',async(req,res)=>{const allowed=['enabled','automaticSendingEnabled','autoApprovalEnabled','trackingEnabled','aiEnabled','waitingPeriodDays','minimumInterestScore','minimumAutoApprovalConfidence','maximumEmailsPerWeek','maximumEmailsPerMonth','maximumEmailsPerDay','sameProductCooldownDays','attributionWindowDays','allowedSendHours','allowedSendingDays','timezone','emailOpenTrackingEnabled','emailClickTrackingEnabled','weights','excludedProducts','excludedCustomers','allowedProductCategories'];const patch={updatedBy:req.user._id};allowed.forEach(k=>{if(req.body[k]!==undefined)patch[k]=req.body[k]});const s=await MarketingSettings.findOneAndUpdate({singletonKey:'default'},{$set:patch},{upsert:true,new:true,runValidators:true,setDefaultsOnInsert:true});await MarketingAuditLog.create({adminId:req.user._id,action:'settings_changed',entityId:s._id});res.json(s);});
router.get('/analytics',async(_req,res)=>{const data=await MarketingRecommendation.aggregate([{$group:{_id:'$status',count:{$sum:1},revenue:{$sum:{$ifNull:['$attribution.revenue',0]}}}}]);res.json(data);});
module.exports=router;
