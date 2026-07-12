'use strict';

const assert = require('assert');
process.env.MARKETING_SIGNING_SECRET = 'test-secret-at-least-32-characters-long';
const { calculateInterest, decay, effectivePrice, fallbackContent, renderEmail, safeContent, signToken, verifyToken } = require('../services/marketingService');
const marketingModels = require('../models/Marketing');
const { localParts } = require('../services/marketingScheduler');

const now = new Date('2026-07-12T00:00:00Z');
assert.strictEqual(decay(new Date('2026-07-06T00:00:00Z'),now),1);
assert.strictEqual(decay(new Date('2026-07-01T00:00:00Z'),now),0.7);
assert.strictEqual(decay(new Date('2026-06-20T00:00:00Z'),now),0.4);
assert.strictEqual(decay(new Date('2026-05-01T00:00:00Z'),now),0);

const weights={product_viewed:2,repeated_product_view:4,product_searched:5,added_to_cart:12,checkout_abandoned:20};
const scored=calculateInterest([{eventType:'product_viewed',createdAt:new Date('2026-07-06')},{eventType:'product_viewed',createdAt:new Date('2026-07-05')},{eventType:'product_searched',createdAt:new Date('2026-07-05')},{eventType:'added_to_cart',createdAt:new Date('2026-07-05')},{eventType:'checkout_abandoned',createdAt:new Date('2026-07-05')}],weights,now);
assert.strictEqual(scored.score,45);
assert.strictEqual(calculateInterest([{eventType:'purchase_completed',createdAt:now}],weights,now).excluded,true);
assert.strictEqual(effectivePrice({price:1000,salePrice:800,isOnSale:true}),800);
assert.strictEqual(effectivePrice({price:1000,salePrice:1200,isOnSale:true}),1000);

const product={name:'Safe <script>alert(1)</script> Product',price:1000,stock:2};
const safe=safeContent({subject:' Hello <b>world</b> ',body:'<iframe>bad</iframe> Helpful text',ctaText:' View '},product);
assert(!safe.subject.includes('<')); assert(!safe.body.includes('<')); assert.strictEqual(safe.ctaText,'View');
assert(fallbackContent(product,{product_viewed:2}).body.includes('currently available'));
const token=signToken({customerId:'abc'},1); assert.strictEqual(verifyToken(token).customerId,'abc');
assert.throws(()=>verifyToken(token+'x'));
assert.doesNotThrow(()=>localParts('Asia/Colombo'));
const html=renderEmail({_id:'507f1f77bcf86cd799439011',customerId:'507f1f77bcf86cd799439012',headline:'Helpful headline',emailBody:'Safe body',ctaText:'View Product'},{name:'Product',slug:'product',price:1000,stock:1,thumbnail:'https://shopzen.lk/image.jpg'},{email:'customer@example.com'});
assert(html.includes('Unsubscribe')); assert(html.includes('Marketing preferences')); assert(!html.includes('<script'));
const behaviorIndexes=marketingModels.CustomerBehaviorEvent.schema.indexes();
assert(behaviorIndexes.some(([fields])=>fields.expiresAt===1));
assert(marketingModels.MarketingRecommendation.schema.indexes().some(([fields])=>fields.status===1&&fields.scheduledAt===1));
console.log('Marketing unit tests passed.');
