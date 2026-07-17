'use strict';

const crypto = require('crypto');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const ScheduledSocialPost = require('../models/ScheduledSocialPost');
const SocialScheduleDraft = require('../models/SocialScheduleDraft');
const { Coupon, Settings } = require('../models/index');
const { publishNow } = require('./publisherService');
const { getOrCreate, decryptPlatformFields } = require('./socialMediaService');

const clean = (value, max=5000) => String(value == null ? '' : value).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const money = value => {
  const number=Number(value);
  return number.toLocaleString('en-LK',{minimumFractionDigits:Number.isInteger(number)?0:2,maximumFractionDigits:2});
};
const sellingPrice = product => product.isOnSale && Number(product.salePrice)>0 && Number(product.salePrice)<Number(product.price) ? Number(product.salePrice) : Number(product.price);
const roundOfferDisplay = value => Math.ceil(Number(value)/10)*10;
const hasProductSale = product => sellingPrice(product)<Number(product.price);

function scheduledTimeForIndex(startAt,index,gapMinutes,productsPerDay){
  const start=new Date(startAt);
  const dayOffset=Math.floor(index/productsPerDay);
  const slot=index%productsPerDay;
  return new Date(start.getTime()+dayOffset*24*60*60000+slot*gapMinutes*60000);
}

function productFeatures(product){
  const specs=(product.specifications||[]).map(spec=>({key:clean(spec.key,80),value:clean(spec.value,180)})).filter(spec=>spec.key&&spec.value&&!/^(brand|sku|part number|part number \/ sku)$/i.test(spec.key)).slice(0,8);
  const descriptions=[clean(product.shortDescription,500),clean(product.description,900)].filter(Boolean);
  const summary=[...new Set(descriptions)].join(' ').slice(0,1200);
  const tags=(product.tags||[]).map(tag=>clean(tag,60)).filter(Boolean).slice(0,10);
  const category=clean(product.category?.name||product.subCategory,100);
  return {specs,summary,tags,category};
}

function localPhone(number){
  const raw=String(number||'');
  const local=raw.startsWith('94')&&raw.length===11?`0${raw.slice(2)}`:raw;
  return local.length===10?`${local.slice(0,3)} ${local.slice(3,6)} ${local.slice(6)}`:local;
}

function hashtag(value){return clean(value,80).replace(/[^a-z0-9]/gi,'');}

function verifiedHashtags(product,facts){
  const model=facts.features.specs.find(spec=>/model/i.test(spec.key))?.value||'';
  const type=facts.features.specs.find(spec=>/product type|type/i.test(spec.key))?.value||product.subCategory||'';
  return [...new Set([hashtag(product.brand),hashtag(model),hashtag(type),'ShopZenLK','SriLanka'].filter(Boolean))].slice(0,6).map(tag=>`#${tag}`).join(' ');
}

async function getStoreContact(){
  const rows=await Settings.find({key:{$in:['seo_config','whatsappNumber','storeName']}}).lean();
  const values=Object.fromEntries(rows.map(row=>[row.key,row.value]));
  const candidates=[process.env.PUBLIC_STORE_URL,values.seo_config?.siteUrl,process.env.FRONTEND_URL,'https://shopzen.lk'];
  const siteUrl=String(candidates.find(url=>/^https:\/\//i.test(String(url||''))&&!/localhost|127\.0\.0\.1/i.test(String(url)))||'https://shopzen.lk').replace(/\/$/,'');
  const whatsappNumber=String(values.whatsappNumber||'').replace(/[^0-9]/g,'');
  if(!whatsappNumber)throw new Error('Configure the public WhatsApp number in Admin Settings before scheduling social posts.');
  return {siteUrl,whatsappNumber,storeName:clean(values.storeName||'ShopZen',80)};
}

function couponApplies(coupon, product) {
  const includes = (list,id) => !list?.length || list.some(value => String(value)===String(id));
  const categoryId=product.category?._id||product.category;
  if ((coupon.excludedProducts||[]).some(id=>String(id)===String(product._id))) return false;
  if (!includes(coupon.applicableProducts,product._id)) return false;
  if (coupon.applicableCategories?.length && !coupon.applicableCategories.some(id=>String(id)===String(categoryId))) return false;
  if (coupon.applicableBrands?.length && !coupon.applicableBrands.some(brand=>String(brand).toLowerCase()===String(product.brand||'').toLowerCase())) return false;
  return true;
}

async function resolveCoupon(code, products, offerPercent) {
  if (!code) {
    if (offerPercent>0) throw new Error('Select an active percentage voucher so customers can receive the advertised extra discount.');
    return null;
  }
  const now = new Date();
  const coupon = await Coupon.findOne({ code:String(code).trim().toUpperCase(), isActive:true, validFrom:{ $lte:now }, validUntil:{ $gte:now } }).lean();
  if (!coupon) throw new Error('Voucher is inactive, expired, not started, or does not exist.');
  const invalid = products.find(product=>!couponApplies(coupon,product));
  if (invalid) throw new Error(`Voucher ${coupon.code} does not apply to ${invalid.name}.`);
  if (coupon.usageLimit && Number(coupon.usedCount)>=Number(coupon.usageLimit)) throw new Error(`Voucher ${coupon.code} has reached its usage limit.`);
  if (coupon.excludeSaleItems && products.some(product=>product.isOnSale&&Number(product.salePrice)>0&&Number(product.salePrice)<Number(product.price))) throw new Error(`Voucher ${coupon.code} excludes products already on sale.`);
  if (offerPercent>0 && coupon.type!=='percentage') throw new Error('A percentage offer requires a percentage voucher.');
  if (offerPercent>0 && Number(coupon.value)!==offerPercent) throw new Error(`Offer percentage must match voucher ${coupon.code} (${coupon.value}%).`);
  return coupon;
}

function templateCaption(product, facts) {
  const mixed=facts.languageMode==='mixed';
  const lines=[];
  if(facts.offerPercent>0)lines.push(`🎉🔥 ${facts.offerPercent}% OFF WITH VOUCHER! 🔥🎉`);
  else if(facts.voucherCode)lines.push(`🎉🔥 SPECIAL VOUCHER OFFER! 🔥🎉`);
  else if(facts.productSale)lines.push(`🎉🔥 SALE PRICE OFFER! 🔥🎉`);
  lines.push('',`⚡ ${clean(product.name,220)}`);
  if(facts.promotionalPrice!==facts.sellingPrice)lines.push(mixed?`💥 දැන් මිල / Now Only: Rs. ${money(facts.displayPromotionalPrice)}`:`💥 Now Only: Rs. ${money(facts.displayPromotionalPrice)}`,...(facts.productSale?[mixed?`🏷️ Sale Price: Rs. ${money(facts.sellingPrice)}`:`🏷️ Sale Price: Rs. ${money(facts.sellingPrice)}`]:[]),mixed?`සාමාන්‍ය මිල / Regular Price: Rs. ${money(facts.regularPrice)}`:`Regular Price: Rs. ${money(facts.regularPrice)}`);
  else if(facts.productSale)lines.push(mixed?`💥 දැන් මිල / Now Only: Rs. ${money(facts.sellingPrice)}`:`💥 Now Only: Rs. ${money(facts.sellingPrice)}`,mixed?`සාමාන්‍ය මිල / Regular Price: Rs. ${money(facts.regularPrice)}`:`Regular Price: Rs. ${money(facts.regularPrice)}`);
  else lines.push(mixed?`💰 මිල / Price: Rs. ${money(facts.sellingPrice)}`:`💰 Price: Rs. ${money(facts.sellingPrice)}`);
  lines.push('',mixed?'🔥 **අදම Order කරන්න! Premium Quality එකත් හොඳම මිලත් එකම තැනින්.**':'Order from ShopZen using the verified product details below.');
  if(product.brand)lines.push('',mixed?`🏷️ Brand / වෙළඳ නාමය: ${clean(product.brand,80)}`:`🏷️ Brand: ${clean(product.brand,80)}`);
  if(facts.features.specs.length){lines.push('',mixed?'✅ ප්‍රධාන Features:':'✅ Key Features:');facts.features.specs.forEach(spec=>lines.push(`✅ ${spec.key}: ${spec.value}`));}
  if(facts.voucherCode)lines.push('',mixed?'🎟️ Coupon Code එක භාවිතා කරන්න:':'🎟️ Use Coupon Code:',facts.voucherCode);
  if(facts.lowStock)lines.push('',mixed?'⏳ සීමිත Stock ප්‍රමාණයක් පමණයි.':'⏳ Limited stock available.');
  lines.push('',mixed?'🛒 දැන්ම Order කරන්න':'🛒 Order Now',`🌐 ${facts.productUrl}`,'','📲 WhatsApp Orders',facts.whatsappUrl,`☎️ ${facts.whatsappDisplay}`,'','🚚 Islandwide Delivery','🔒 Secure Checkout','',verifiedHashtags(product,facts));
  return lines.join('\n');
}

function validateEditedCaption(value,product,facts){
  const caption=String(value||'').trim();
  if(!caption)throw new Error(`${product.name}: caption cannot be empty.`);
  if(caption.length>5000)throw new Error(`${product.name}: caption must be 5,000 characters or fewer.`);
  if(/localhost|127\.0\.0\.1/i.test(caption))throw new Error(`${product.name}: caption contains a local development URL.`);
  const required=[clean(product.name,220),facts.productUrl,facts.whatsappUrl,facts.whatsappDisplay,money(facts.regularPrice)];
  if(facts.productSale)required.push(money(facts.sellingPrice));
  if(facts.promotionalPrice!==facts.sellingPrice)required.push(money(facts.displayPromotionalPrice));
  if(facts.voucherCode)required.push(facts.voucherCode);
  const missing=[...new Set(required)].filter(text=>!caption.includes(text));
  if(missing.length)throw new Error(`${product.name}: edited caption is missing verified information (${missing.join(', ')}).`);
  return caption;
}

async function createSchedule({ productIds, platforms, startAt, gapMinutes, productsPerDay=5, offerPercent=0, voucherCode='', includeSinhala=true, createdBy },options={}) {
  const {previewOnly=false,captionOverrides={}}=options;
  const overrides=captionOverrides instanceof Map?captionOverrides:new Map(Object.entries(captionOverrides||{}));
  const ids=[...new Set((productIds||[]).map(String))];
  const validPlatforms=['facebook','instagram','tiktok','whatsapp','telegram'];
  const platformList=[...new Set((platforms||[]).filter(p=>validPlatforms.includes(p)))];
  if (!ids.length || ids.length>50) throw new Error('Select between 1 and 50 products.');
  if (!platformList.length) throw new Error('Select at least one connected platform.');
  const start=new Date(startAt); if(Number.isNaN(start.getTime())||start<=new Date()) throw new Error('Start date and time must be in the future.');
  const gap=Number(gapMinutes); if(!Number.isFinite(gap)||gap<1||gap>10080) throw new Error('Gap must be between 1 minute and 7 days.');
  const dailyLimit=Number(productsPerDay); if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>50) throw new Error('Products per day must be a whole number between 1 and 50.');
  if((dailyLimit-1)*gap>=24*60)throw new Error('The daily product limit and gap must fit within one 24-hour posting window.');
  const percent=Number(offerPercent)||0; if(percent<0||percent>95) throw new Error('Offer percentage must be between 0 and 95.');
  const products=await Product.find({_id:{$in:ids},isActive:true}).populate('category','name').lean();
  const byId=new Map(products.map(p=>[String(p._id),p]));
  const ordered=ids.map(id=>byId.get(id)).filter(Boolean);
  if(ordered.length!==ids.length) throw new Error('One or more selected products are inactive or missing.');
  const coupon=await resolveCoupon(voucherCode,ordered,percent);
  const effectivePercent=coupon?.type==='percentage'?Number(coupon.value):percent;
  const social=await getOrCreate();
  const unavailable=platformList.filter(platform=>!social[platform]?.connected||!social[platform]?.enabled);
  if(unavailable.length)throw new Error(`Connect and enable before scheduling: ${unavailable.join(', ')}.`);
  const batchId=crypto.randomUUID(); const docs=[];
  const contact=await getStoreContact();
  for(let index=0;index<ordered.length;index++){
    const product=ordered[index]; const regularPrice=Number(product.price); const price=sellingPrice(product); const productSale=hasProductSale(product);
    if(coupon?.minOrderAmount&&price<Number(coupon.minOrderAmount)) throw new Error(`${product.name} costs less than voucher ${coupon.code}'s minimum order of LKR ${coupon.minOrderAmount}.`);
    let promotionalPrice=price;
    if(effectivePercent>0)promotionalPrice=Math.round(price*(1-effectivePercent/100)*100)/100;
    if(coupon?.type==='fixed')promotionalPrice=Math.max(0,price-Math.min(Number(coupon.value),Number(coupon.maxDiscount)||Number(coupon.value)));
    const displayPromotionalPrice=roundOfferDisplay(promotionalPrice);
    const voucherText=coupon?(coupon.type==='percentage'?`${coupon.value}% off`:`LKR ${money(coupon.value)} off`):'';
    const productUrl=`${contact.siteUrl}/product/${product.slug}`;
    const languageMode=includeSinhala===false?'english':'mixed';
    const lowStock=Number(product.stock)>0&&Number(product.stock)<=Number(product.lowStockThreshold||5);
    const productSalePercent=productSale?Math.round((1-price/regularPrice)*10000)/100:0;
    const facts={regularPrice,sellingPrice:price,productSale,productSalePercent,promotionalPrice,displayPromotionalPrice,offerPercent:effectivePercent,voucherCode:coupon?.code||'',voucherText,lowStock,features:productFeatures(product),productUrl,whatsappDisplay:localPhone(contact.whatsappNumber),whatsappUrl:`https://wa.me/${contact.whatsappNumber}`,languageMode};
    const editedCaption=overrides.get(String(product._id));
    const generated=editedCaption==null?{caption:templateCaption(product,facts),source:'template'}:{caption:validateEditedCaption(editedCaption,product,facts),source:'admin'};
    const scheduledAt=scheduledTimeForIndex(start,index,gap,dailyLimit);
    for(const platform of platformList) docs.push({batchId,batchState:'active',scheduleStartAt:start,gapMinutes:gap,productsPerDay:dailyLimit,totalProducts:ordered.length,productId:product._id,productName:product.name,platform,scheduledAt,caption:generated.caption,captionSource:generated.source,languageMode,offerPercent:effectivePercent,regularPriceSnapshot:regularPrice,sellingPriceSnapshot:price,productSalePercentSnapshot:productSalePercent,promotionalPriceSnapshot:promotionalPrice,displayPromotionalPriceSnapshot:displayPromotionalPrice,voucherCode:facts.voucherCode,couponSnapshot:coupon?{id:coupon._id,code:coupon.code,type:coupon.type,value:coupon.value,validUntil:coupon.validUntil}:null,createdBy});
  }
  if(!previewOnly)await ScheduledSocialPost.insertMany(docs,{ordered:true});
  const result={batchId,jobs:docs.length,products:ordered.length,platforms:platformList.length,productsPerDay:dailyLimit,days:Math.ceil(ordered.length/dailyLimit),firstPostAt:start,lastPostAt:docs[docs.length-1].scheduledAt};
  if(previewOnly){result._docs=docs;result._config={productIds:ordered.map(product=>product._id),platforms:platformList,startAt:start,gapMinutes:gap,productsPerDay:dailyLimit,offerPercent:effectivePercent,voucherCode:coupon?.code||'',includeSinhala:includeSinhala!==false};}
  return result;
}

function draftPayload(draft){
  const value=draft.toObject?draft.toObject():draft;
  return {_id:value._id,status:value.status,platforms:value.platforms,startAt:value.startAt,gapMinutes:value.gapMinutes,productsPerDay:value.productsPerDay,offerPercent:value.offerPercent,voucherCode:value.voucherCode,includeSinhala:value.includeSinhala,items:value.items,expiresAt:value.expiresAt,createdAt:value.createdAt};
}

async function createScheduleDraft(args){
  const preview=await createSchedule(args,{previewOnly:true});
  const uniqueItems=[];const seen=new Set();
  for(const doc of preview._docs){const id=String(doc.productId);if(seen.has(id))continue;seen.add(id);uniqueItems.push({productId:doc.productId,productName:doc.productName,scheduledAt:doc.scheduledAt,caption:doc.caption});}
  const draft=await SocialScheduleDraft.create({...preview._config,items:uniqueItems,createdBy:args.createdBy,expiresAt:new Date(Date.now()+24*60*60*1000)});
  return {draft:draftPayload(draft),summary:{products:preview.products,platforms:preview.platforms,jobs:preview.jobs,days:preview.days,firstPostAt:preview.firstPostAt,lastPostAt:preview.lastPostAt}};
}

async function listScheduleDrafts(createdBy){
  const filter={status:'draft',expiresAt:{$gt:new Date()}};if(createdBy)filter.createdBy=createdBy;
  return (await SocialScheduleDraft.find(filter).sort({createdAt:-1}).limit(20).lean()).map(draftPayload);
}

function captionMapForDraft(draft,items){
  const submitted=new Map((items||[]).map(item=>[String(item.productId),String(item.caption||'')]));
  const expected=draft.items.map(item=>String(item.productId));
  if(submitted.size!==expected.length||expected.some(id=>!submitted.has(id)))throw new Error('Every draft product must have exactly one caption before confirmation.');
  return submitted;
}

async function saveScheduleDraft(draftId,items,createdBy){
  const filter={_id:draftId,status:'draft'};if(createdBy)filter.createdBy=createdBy;
  const draft=await SocialScheduleDraft.findOne(filter);if(!draft)throw new Error('Draft was not found, expired, or already confirmed.');
  const captions=captionMapForDraft(draft,items);
  draft.items.forEach(item=>{const caption=captions.get(String(item.productId)).trim();if(!caption||caption.length>5000)throw new Error(`${item.productName}: caption must contain 1 to 5,000 characters.`);item.caption=caption;});
  await draft.save();return draftPayload(draft);
}

async function confirmScheduleDraft(draftId,items,createdBy){
  const filter={_id:draftId,status:'draft',expiresAt:{$gt:new Date()}};if(createdBy)filter.createdBy=createdBy;
  const draft=await SocialScheduleDraft.findOneAndUpdate(filter,{$set:{status:'confirming'}},{new:true});
  if(!draft)throw new Error('Draft was not found, expired, or already confirmed.');
  try{
    const captions=captionMapForDraft(draft,items);
    const result=await createSchedule({productIds:draft.productIds,platforms:draft.platforms,startAt:draft.startAt,gapMinutes:draft.gapMinutes,productsPerDay:draft.productsPerDay,offerPercent:draft.offerPercent,voucherCode:draft.voucherCode,includeSinhala:draft.includeSinhala,createdBy},{captionOverrides:captions});
    draft.items.forEach(item=>{item.caption=captions.get(String(item.productId)).trim();});draft.status='confirmed';draft.confirmedBatchId=result.batchId;draft.confirmedAt=new Date();await draft.save();
    return result;
  }catch(error){await SocialScheduleDraft.updateOne({_id:draft._id,status:'confirming'},{$set:{status:'draft'}});throw error;}
}

async function discardScheduleDraft(draftId,createdBy){
  const filter={_id:draftId,status:'draft'};if(createdBy)filter.createdBy=createdBy;
  const draft=await SocialScheduleDraft.findOneAndUpdate(filter,{$set:{status:'discarded'}},{new:true});if(!draft)throw new Error('Draft was not found or is no longer editable.');return {success:true};
}

let running=false;
async function publishablePlatformsForWorker(){
  const social=await getOrCreate();
  const platforms=['facebook','instagram','tiktok','whatsapp','telegram'];
  return platforms.filter(platform=>{
    const raw=JSON.parse(JSON.stringify(social[platform]?.toObject?.({virtuals:false})??social[platform]??{}));
    const credentials=decryptPlatformFields(raw);
    if(!credentials.connected||!credentials.enabled||!credentials.accessToken)return false;
    return platform==='tiktok'||Boolean(credentials.accountId);
  });
}

async function runDueScheduledPosts(){
  if(running||mongoose.connection.readyState!==1)return; running=true;
  try{
    // Recover claims left behind by a process restart.
    await ScheduledSocialPost.updateMany(
      {status:'processing',claimedAt:{$lt:new Date(Date.now()-15*60000)}},
      {$set:{status:'pending'},$unset:{claimedAt:1}}
    );
    const publishablePlatforms=await publishablePlatformsForWorker();
    const unavailablePlatforms=['facebook','instagram','tiktok','whatsapp','telegram'].filter(platform=>!publishablePlatforms.includes(platform));
    if(unavailablePlatforms.length)await ScheduledSocialPost.updateMany({status:'pending',batchState:{$in:['active',null]},scheduledAt:{$lte:new Date()},platform:{$in:unavailablePlatforms}},{$set:{failureReason:'Waiting for a backend worker with valid, decryptable platform credentials. Ensure SOCIAL_MEDIA_SECRET is identical on every server instance, then restart all instances.'}});
    if(!publishablePlatforms.length)return;
    for(let i=0;i<10;i++){
      const job=await ScheduledSocialPost.findOneAndUpdate({status:'pending',batchState:{$in:['active',null]},platform:{$in:publishablePlatforms},scheduledAt:{$lte:new Date()}},{$set:{status:'processing',claimedAt:new Date(),failureReason:''}},{sort:{scheduledAt:1},new:true});
      if(!job)break;
      if(/localhost|127\.0\.0\.1/i.test(job.caption)){
        await ScheduledSocialPost.updateOne({_id:job._id},{$set:{status:'failed',failureReason:'Caption contains a local development URL. Remove it and create a new schedule with the public store URL.'}});continue;
      }
      const currentProduct=await Product.findById(job.productId).lean();
      const regularPriceChanged=job.regularPriceSnapshot!=null&&Number(currentProduct?.price)!==Number(job.regularPriceSnapshot);
      if(!currentProduct||!currentProduct.isActive||regularPriceChanged||sellingPrice(currentProduct)!==Number(job.sellingPriceSnapshot)){
        await ScheduledSocialPost.updateOne({_id:job._id},{$set:{status:'failed',failureReason:'Product is inactive, missing, or its selling price changed after scheduling. Review and create a new schedule.'}});continue;
      }
      if(job.voucherCode){
        const currentCoupon=await Coupon.findOne({code:job.voucherCode,isActive:true,validFrom:{$lte:new Date()},validUntil:{$gte:new Date()}}).lean();
        if(!currentCoupon||!couponApplies(currentCoupon,currentProduct)||String(currentCoupon.type)!==String(job.couponSnapshot?.type)||Number(currentCoupon.value)!==Number(job.couponSnapshot?.value)){
          await ScheduledSocialPost.updateOne({_id:job._id},{$set:{status:'failed',failureReason:'Voucher expired, changed, became inactive, or no longer applies. Review and create a new schedule.'}});continue;
        }
      }
      const log=await publishNow({platform:job.platform,trigger:'manual',entityType:'product',entityId:job.productId,entityName:job.productName,customMsg:job.caption,triggeredBy:`schedule:${job._id}`});
      if(log?.status==='success') await ScheduledSocialPost.updateOne({_id:job._id},{$set:{status:'published',publishedAt:new Date(),publishLogId:log._id,platformPostId:log.platformPostId||'',failureReason:''}});
      else await ScheduledSocialPost.updateOne({_id:job._id},{$set:{status:'failed',publishLogId:log?._id,failureReason:clean(log?.errorMessage||'Publishing failed',1000)}});
    }
  }catch(error){console.error('[Scheduled Social Posts]',error.message)}finally{running=false}
}

let timer=null;
function startScheduledSocialPostScheduler(){if(timer)return;timer=setInterval(runDueScheduledPosts,30000);timer.unref?.();setTimeout(runDueScheduledPosts,10000);console.log('[Social Scheduler] durable scheduled-post queue registered')}

module.exports={createSchedule,createScheduleDraft,listScheduleDrafts,saveScheduleDraft,confirmScheduleDraft,discardScheduleDraft,templateCaption,fallbackCaption:templateCaption,validateEditedCaption,productFeatures,scheduledTimeForIndex,runDueScheduledPosts,startScheduledSocialPostScheduler};
