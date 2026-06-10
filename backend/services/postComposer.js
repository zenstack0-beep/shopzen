/**
 * services/postComposer.js
 *
 * Builds the final post payload by merging (highest → lowest priority):
 *   1. Automation rule's customMessage
 *   2. Platform template from SocialMedia settings (with hashtags)
 *   3. Built-in default template
 *
 * Template variables:
 *   {{productName}} {{price}} {{salePrice}} {{discount}}
 *   {{url}} {{brand}} {{category}} {{offerName}}
 *
 * FIX: imageUrls (array) now passed alongside imageUrl (first image) so
 *      publishers that support multi-photo carousels can use all images.
 * FIX: manual trigger auto-upgrades to 'product_discount' when salePrice exists.
 * FIX: Default templates are more attractive and show discount pricing.
 */

const { getOrCreate } = require('./socialMediaService');

const STORE_URL = process.env.FRONTEND_URL || 'https://shopzen.lk';

function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

function productVars(p) {
  const disc = p.price && p.salePrice
    ? Math.round(((p.price - p.salePrice) / p.price) * 100) : 0;
  return {
    productName: p.name         || '',
    price:       `LKR ${(p.price || 0).toLocaleString()}`,
    salePrice:   p.salePrice    ? `LKR ${p.salePrice.toLocaleString()}` : '',
    discount:    disc           ? `${disc}%` : '',
    brand:       p.brand        || '',
    category:    p.subCategory  || '',
    url:         `${STORE_URL}/product/${p.slug || p._id}`,
    offerName:   '',
  };
}

function offerVars(o) {
  return {
    productName: '',
    price:       '',
    salePrice:   '',
    discount:    o.discountPercent ? `${o.discountPercent}%` : '',
    brand:       '',
    category:    '',
    url:         o.pageSlug ? `${STORE_URL}/campaign/${o.pageSlug}` : STORE_URL,
    offerName:   o.name || '',
  };
}

// ── Attractive default templates ──────────────────────────────────────────────
const DEFAULTS = {
  new_product: v => {
    const brandLine = v.brand ? `\n🏷️ Brand: ${v.brand}` : '';
    const catLine   = v.category ? `\n📂 ${v.category}` : '';
    return (
      `✨ Just Landed at ShopZen!\n\n` +
      `🛍️ *${v.productName}*${brandLine}${catLine}\n\n` +
      `💰 Price: *${v.price}*\n\n` +
      `Don't miss out — this one won't last long! Tap the link below to grab yours now 👇\n\n` +
      `🔗 ${v.url}\n\n` +
      `#ShopZen #NewArrival #ShopNow #SriLanka`
    );
  },

  product_discount: v => {
    const saveLine = v.salePrice
      ? `💥 Was ${v.price} → Now only *${v.salePrice}*`
      : `💥 Now *${v.price}*`;
    const brandLine = v.brand ? `\n🏷️ Brand: ${v.brand}` : '';
    return (
      `🔥 ${v.discount} OFF — Today Only!\n\n` +
      `🛍️ *${v.productName}*${brandLine}\n\n` +
      `${saveLine}\n` +
      `⏰ Limited time deal — stock is running out!\n\n` +
      `Shop now before it's gone 👇\n` +
      `🔗 ${v.url}\n\n` +
      `#ShopZen #Sale #Discount #DealOfTheDay #SriLanka`
    );
  },

  offer_active: v => {
    const discLine = v.discount ? `\n🏷️ Up to *${v.discount}* off!` : '';
    return (
      `🎉 Special Offer Alert!\n\n` +
      `✨ *${v.offerName}*${discLine}\n\n` +
      `This is your chance to save big on your favourite products.\n` +
      `⏳ Hurry — limited time only!\n\n` +
      `Shop the offer now 👇\n` +
      `🔗 ${v.url}\n\n` +
      `#ShopZen #SpecialOffer #LimitedTime #SriLanka`
    );
  },

  manual: v => {
    // manual with discount → same as product_discount
    if (v.salePrice && v.discount) {
      return DEFAULTS.product_discount(v);
    }
    return DEFAULTS.new_product(v);
  },
};

async function compose(platform, trigger, entity, customMsg = '') {
  const isOffer = trigger === 'offer_active';
  const vars    = isOffer ? offerVars(entity) : productVars(entity);

  // ── Auto-upgrade 'manual' trigger when product has a sale price ────────────
  let effectiveTrigger = trigger;
  if (!isOffer && (trigger === 'manual' || trigger === 'new_product')) {
    if (entity.salePrice && entity.price && entity.salePrice < entity.price) {
      effectiveTrigger = 'product_discount';
    }
  }

  // ── Collect ALL product images (not just the first) ────────────────────────
  const imageUrls = [];
  // Thumbnail / primary image first
  const primary = entity.thumbnail || entity.bannerImage || entity.pageBannerImage || entity.image || '';
  if (primary) imageUrls.push(primary);
  // Additional images array
  if (Array.isArray(entity.images)) {
    entity.images.forEach(url => {
      if (url && !imageUrls.includes(url)) imageUrls.push(url);
    });
  }
  const imageUrl = imageUrls[0] || '';   // kept for backward compat with single-image publishers

  // 1. Custom message from rule
  if (customMsg && customMsg.trim()) {
    return { text: interpolate(customMsg, vars), imageUrl, imageUrls };
  }

  // 2. Platform template
  try {
    const doc = await getOrCreate();
    const tpl  = (doc.templates || []).find(t => t.platform === platform && t.enabled);
    if (tpl && tpl.template) {
      let text = interpolate(tpl.template, vars);
      if (tpl.hashtags?.length) text += '\n\n' + tpl.hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ');
      return { text, imageUrl, imageUrls };
    }
  } catch { /* fall through */ }

  // 3. Built-in default
  const fn = DEFAULTS[effectiveTrigger] || DEFAULTS.new_product;
  return { text: fn(vars), imageUrl, imageUrls };
}

module.exports = { compose };