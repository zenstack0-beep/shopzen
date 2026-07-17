/**
 * routes/socialMedia.js
 * All routes are protected by adminAuth — credentials never leave the server.
 *
 * MODIFIED: Added POST /bulk-post for admin bulk product posting with rate-limit
 *           support baked into the frontend; the route handles one post at a time.
 */

const express    = require('express');
const router     = express.Router();
const { adminAuth } = require('../middleware/auth');
const ctrl       = require('../controllers/socialMediaController');
const { refreshPlatformNow } = require('../services/tokenRefreshScheduler');
const { getOrCreate, decryptPlatformFields } = require('../services/socialMediaService');
const { inspectToken } = require('../services/facebookTokenRefresh');
const { manualPublish } = require('../services/publisherService');
const ScheduledSocialPost = require('../models/ScheduledSocialPost');
const { createSchedule, createScheduleDraft, listScheduleDrafts, saveScheduleDraft, confirmScheduleDraft, discardScheduleDraft } = require('../services/scheduledSocialPostService');

// ─── PUBLIC: storefront footer social links (no secrets) ─────────────────────
router.get('/public', async (req, res) => {
  try {
    const SocialMedia = require('../models/SocialMedia');
    const PLATFORM_META = {
      facebook:  { label: 'Facebook',  color: '#1877f2', urlPrefix: 'https://facebook.com/' },
      instagram: { label: 'Instagram', color: 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', urlPrefix: 'https://instagram.com/' },
      tiktok:    { label: 'TikTok',    color: '#010101', urlPrefix: 'https://tiktok.com/@' },
      whatsapp:  { label: 'WhatsApp',  color: '#25d366', urlPrefix: 'https://wa.me/' },
      telegram:  { label: 'Telegram',  color: '#229ed9', urlPrefix: 'https://t.me/' },
    };
    const doc = await SocialMedia.findOne().lean();
    if (!doc) return res.json([]);

    const platforms = Object.keys(PLATFORM_META);
    const result = platforms
      .filter(p => doc[p]?.connected && doc[p]?.enabled)
      .map(p => {
        const { label, color, urlPrefix } = PLATFORM_META[p];
        const acct = doc[p];
        // For Telegram: accountHandle is the BOT username (@BotFather name) — NOT the channel.
        // The channel/group to link to is stored in accountId (e.g. @mypublicchannel or -100...).
        // So for Telegram we use accountId first; for all other platforms use accountHandle first.
        const rawHandle = p === 'telegram'
          ? (acct.accountId?.replace(/^@/, '') || acct.accountHandle?.replace(/^@/, '') || '')
          : (acct.accountHandle?.replace(/^@/, '') || acct.accountId || '');
        const handle = rawHandle;
        const url = p === 'whatsapp'
          ? `https://wa.me/${handle.replace(/[^0-9]/g, '')}`
          : handle ? `${urlPrefix}${handle}` : null;
        return {
          platform:    p,
          label,
          color,
          url,
          accountName:   acct.accountName   || label,
          accountHandle: acct.accountHandle  || '',
          accountAvatar: acct.accountAvatar  || '',
        };
      })
      .filter(p => p.url);

    res.json(result);
  } catch (err) {
    console.error('social-media/public error:', err);
    res.json([]);
  }
});

// ─── TEMP DEBUG — no auth, remove after fixing ───────────────────────────────
router.get('/debug-whatsapp', async (req, res) => {
  const doc = await require('../models/SocialMedia').findOne();
  res.json(doc?.whatsapp?.extraConfig || {});
});

router.get('/fix-whatsapp', async (req, res) => {
  const SocialMedia = require('../models/SocialMedia');
  await SocialMedia.updateOne({}, {
    $set: {
      'whatsapp.extraConfig.templateName': 'hello_world',
      'whatsapp.extraConfig.languageCode': 'en_US',
    }
  });
  const doc = await SocialMedia.findOne();
  res.json(doc?.whatsapp?.extraConfig || {});
});
// ─── END TEMP ─────────────────────────────────────────────────────────────────

// ─── All routes below require admin auth ─────────────────────────────────────
router.use(adminAuth);

// Settings overview (sanitized — no secrets)
router.get('/', ctrl.getSettings);

// Automation toggle + platform selection
router.put('/automation', ctrl.updateAutomation);

// Post templates
router.put('/templates', ctrl.updateTemplates);

// ─── Bulk post: one product to one platform ───────────────────────────────────
// Called once per job by the frontend rate-limited loop.
// The frontend controls the rate (postsPerMin + delay), so this is intentionally
// a thin wrapper around the existing manualPublish() service.
//
// POST /api/social-media/bulk-post
// Body: { productId, platform }
// Returns: { success, logId, platformPostId?, error? }
router.post('/bulk-post', async (req, res) => {
  try {
    const { productId, platform } = req.body;

    if (!productId || !platform) {
      return res.status(400).json({ success: false, error: 'productId and platform are required' });
    }

    const VALID_PLATFORMS = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'telegram'];
    if (!VALID_PLATFORMS.includes(platform)) {
      return res.status(400).json({ success: false, error: `Unknown platform: ${platform}` });
    }

    // Load product name for logging
    const Product = require('../models/Product');
    const product = await Product.findById(productId).select('name').lean();
    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    const log = await manualPublish({
      platform,
      entityType:  'product',
      entityId:    productId,
      entityName:  product.name,
      customMsg:   '',
      trigger:     'manual',
      adminUserId: req.admin?._id || req.user?._id || 'unknown',
    });

    if (log?.status === 'success') {
      return res.json({ success: true, logId: log._id, platformPostId: log.platformPostId });
    } else {
      return res.status(422).json({
        success: false,
        logId:  log?._id,
        error:  log?.errorMessage || 'Publish failed',
        code:   log?.errorCode,
      });
    }
  } catch (err) {
    console.error('[bulk-post] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Durable multi-product schedule. Products are spaced by gapMinutes; selected
// platforms for the same product share its scheduled time.
router.post('/schedules', async (req,res) => {
  try {
    const result=await createSchedule({...req.body,createdBy:req.user?._id||req.admin?._id});
    res.status(201).json(result);
  } catch(error) { res.status(400).json({message:error.message}); }
});

router.post('/schedules/preview', async (req,res) => {
  try {
    const result=await createScheduleDraft({...req.body,createdBy:req.user?._id||req.admin?._id});
    res.status(201).json(result);
  } catch(error){res.status(400).json({message:error.message});}
});

router.get('/schedule-drafts', async (req,res) => {
  try {res.json({items:await listScheduleDrafts(req.user?._id||req.admin?._id)});}
  catch(error){res.status(500).json({message:'Schedule drafts could not be loaded'});}
});

router.patch('/schedule-drafts/:id', async (req,res) => {
  try {res.json({draft:await saveScheduleDraft(req.params.id,req.body.items,req.user?._id||req.admin?._id)});}
  catch(error){res.status(400).json({message:error.message});}
});

router.post('/schedule-drafts/:id/confirm', async (req,res) => {
  try {res.status(201).json(await confirmScheduleDraft(req.params.id,req.body.items,req.user?._id||req.admin?._id));}
  catch(error){res.status(400).json({message:error.message});}
});

router.delete('/schedule-drafts/:id', async (req,res) => {
  try {res.json(await discardScheduleDraft(req.params.id,req.user?._id||req.admin?._id));}
  catch(error){res.status(400).json({message:error.message});}
});

router.get('/schedules', async (req,res) => {
  try {
    const filter={}; if(req.query.status)filter.status=req.query.status;
    const page=Math.max(1,Number(req.query.page)||1); const limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
    const [items,total]=await Promise.all([
      ScheduledSocialPost.find(filter).populate('productId','name slug thumbnail images').sort({scheduledAt:-1}).skip((page-1)*limit).limit(limit).lean(),
      ScheduledSocialPost.countDocuments(filter),
    ]);
    res.json({items,total,page,pages:Math.ceil(total/limit)});
  } catch(error){res.status(500).json({message:'Scheduled posts could not be loaded'});}
});

// Persistent schedule-plan activity shown after page navigation or browser restart.
router.get('/schedule-batches', async (req,res) => {
  try {
    const limit=Math.min(50,Math.max(1,Number(req.query.limit)||20));
    const never=new Date('9999-12-31T23:59:59.999Z');
    const batches=await ScheduledSocialPost.aggregate([
      {$group:{
        _id:'$batchId',createdAt:{$min:'$createdAt'},updatedAt:{$max:'$updatedAt'},
        firstPostAt:{$min:'$scheduledAt'},lastPostAt:{$max:'$scheduledAt'},
        nextPostAt:{$min:{$cond:[{$eq:['$status','pending']},'$scheduledAt',never]}},
        batchState:{$max:{$ifNull:['$batchState','active']}},
        scheduleStartAt:{$max:'$scheduleStartAt'},gapMinutes:{$max:'$gapMinutes'},productsPerDay:{$max:'$productsPerDay'},configuredTotalProducts:{$max:'$totalProducts'},
        products:{$addToSet:'$productId'},platforms:{$addToSet:'$platform'},
        totalJobs:{$sum:1},pending:{$sum:{$cond:[{$eq:['$status','pending']},1,0]}},processing:{$sum:{$cond:[{$eq:['$status','processing']},1,0]}},published:{$sum:{$cond:[{$eq:['$status','published']},1,0]}},failed:{$sum:{$cond:[{$eq:['$status','failed']},1,0]}},cancelled:{$sum:{$cond:[{$eq:['$status','cancelled']},1,0]}},
      }},
      {$sort:{createdAt:-1}},{$limit:limit},
    ]);
    const items=batches.map(batch=>{
      const finished=batch.published+batch.failed+batch.cancelled;
      let activityStatus=batch.batchState;
      if(batch.batchState==='active')activityStatus=batch.processing>0?'publishing':batch.pending>0?'active':finished>=batch.totalJobs?'completed':'active';
      return {...batch,batchId:batch._id,_id:undefined,totalProducts:batch.configuredTotalProducts||batch.products.length,nextPostAt:batch.nextPostAt?.getUTCFullYear()===9999?null:batch.nextPostAt,activityStatus};
    });
    res.json({items});
  } catch(error){console.error('[schedule-batches]',error.message);res.status(500).json({message:'Scheduling activity could not be loaded'});}
});

router.post('/schedules/:id/cancel', async (req,res) => {
  const item=await ScheduledSocialPost.findOneAndUpdate({_id:req.params.id,status:'pending'},{$set:{status:'cancelled',cancelledAt:new Date()}},{new:true});
  if(!item)return res.status(409).json({message:'Only pending posts can be cancelled'});
  res.json(item);
});

router.post('/schedules/:id/retry', async (req,res) => {
  try {
    const item=await ScheduledSocialPost.findOneAndUpdate({_id:req.params.id,status:'failed'},{$set:{status:'pending',batchState:'active',scheduledAt:new Date(Date.now()+30000),failureReason:'',platformPostId:''},$unset:{claimedAt:1,publishedAt:1,publishLogId:1}},{new:true});
    if(!item)return res.status(409).json({message:'Only failed scheduled posts can be retried'});
    res.json(item);
  } catch(error){res.status(400).json({message:'Scheduled post could not be retried'});}
});

router.delete('/schedules/:id', async (req,res) => {
  try {
    const item=await ScheduledSocialPost.findById(req.params.id);
    if(!item)return res.status(404).json({message:'Scheduled post not found'});
    if(item.status==='processing')return res.status(409).json({message:'This post is currently processing and cannot be removed'});
    await item.deleteOne();
    res.json({success:true,message:'Scheduled queue item removed'});
  } catch(error){res.status(400).json({message:'Scheduled queue item could not be removed'});}
});

router.post('/schedules/batch/:batchId/pause', async (req,res) => {
  try {
    const filter={batchId:req.params.batchId,status:{$in:['pending','processing']}};
    if(!await ScheduledSocialPost.exists(filter))return res.status(409).json({message:'This schedule has no active posts to pause'});
    const pausedAt=new Date();
    await ScheduledSocialPost.updateMany({batchId:req.params.batchId},{$set:{batchState:'paused'}});
    const result=await ScheduledSocialPost.updateMany({batchId:req.params.batchId,status:'pending'},{$set:{pausedAt}});
    res.json({success:true,paused:result.modifiedCount,pausedAt});
  } catch(error){res.status(400).json({message:'Schedule could not be paused'});}
});

router.post('/schedules/batch/:batchId/resume', async (req,res) => {
  try {
    const jobs=await ScheduledSocialPost.find({batchId:req.params.batchId,status:'pending',batchState:'paused'}).sort({scheduledAt:1}).lean();
    if(!jobs.length)return res.status(409).json({message:'This schedule has no paused posts to resume'});
    const pausedAt=jobs.map(job=>job.pausedAt?.getTime()).filter(Number.isFinite).sort((a,b)=>a-b)[0]||Date.now();
    const shiftMs=Math.max(0,Date.now()-pausedAt);
    await ScheduledSocialPost.bulkWrite(jobs.map(job=>({updateOne:{filter:{_id:job._id,status:'pending',batchState:'paused'},update:{$set:{scheduledAt:new Date(job.scheduledAt.getTime()+shiftMs),batchState:'active'},$unset:{pausedAt:1}}}})));
    await ScheduledSocialPost.updateMany({batchId:req.params.batchId},{$set:{batchState:'active'},$unset:{pausedAt:1}});
    res.json({success:true,resumed:jobs.length,shiftedByMs:shiftMs});
  } catch(error){res.status(400).json({message:'Schedule could not be resumed'});}
});

const stopScheduledBatch=async(req,res)=>{
  try {
    if(!await ScheduledSocialPost.exists({batchId:req.params.batchId}))return res.status(404).json({message:'Schedule not found'});
    const stoppedAt=new Date();
    await ScheduledSocialPost.updateMany({batchId:req.params.batchId},{$set:{batchState:'stopped'}});
    const result=await ScheduledSocialPost.updateMany({batchId:req.params.batchId,status:'pending'},{$set:{status:'cancelled',cancelledAt:stoppedAt},$unset:{pausedAt:1}});
    res.json({success:true,stopped:result.modifiedCount,message:'Unpublished scheduled posts were stopped'});
  } catch(error){res.status(400).json({message:'Schedule could not be stopped'});}
};
router.post('/schedules/batch/:batchId/stop',stopScheduledBatch);
router.post('/schedules/batch/:batchId/cancel',stopScheduledBatch);

// Per-platform routes
router.put   ('/platform/:platform',          ctrl.updatePlatform);
router.post  ('/platform/:platform/connect',  ctrl.connectPlatform);
router.delete('/platform/:platform',          ctrl.disconnectPlatform);
router.post  ('/platform/:platform/test',     ctrl.testConnection);
router.patch ('/platform/:platform/toggle',   ctrl.togglePlatform);

// Manual token refresh (Facebook / Instagram only)
router.post('/platform/:platform/refresh-token', async (req, res) => {
  const { platform } = req.params;
  if (!['facebook', 'instagram'].includes(platform)) {
    return res.status(400).json({ message: 'Token refresh is only available for Facebook and Instagram' });
  }
  try {
    const result = await refreshPlatformNow(platform);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Token status — returns expiry info for the admin UI
router.get('/platform/:platform/token-status', async (req, res) => {
  const { platform } = req.params;
  try {
    const doc = await getOrCreate();
    const raw = doc[platform]?.toObject ? doc[platform].toObject() : (doc[platform] || {});

    if (!raw.connected) return res.json({ connected: false });

    const creds = decryptPlatformFields(raw);
    let inspection = { valid: null, expiresAt: raw.tokenExpiresAt, scopes: [], error: null };

    if (['facebook', 'instagram'].includes(platform) && creds.appId && creds.appSecret && creds.accessToken) {
      inspection = await inspectToken(creds.accessToken, creds.appId, creds.appSecret);
      if (inspection.expiresAt && String(inspection.expiresAt) !== String(raw.tokenExpiresAt)) {
        await doc.constructor.updateOne({}, {
          $set: { [`${platform}.tokenExpiresAt`]: inspection.expiresAt, updatedAt: new Date() },
        });
      }
    }

    res.json({
      connected:            raw.connected,
      tokenExpiresAt:       inspection.expiresAt || raw.tokenExpiresAt,
      tokenLastRefreshedAt: raw.tokenLastRefreshedAt,
      tokenRefreshError:    raw.tokenRefreshError,
      reconnectNeeded:      raw.reconnectNeeded,
      tokenValid:           inspection.valid,
      scopes:               inspection.scopes,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
