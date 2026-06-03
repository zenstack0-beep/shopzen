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

const DEFAULTS = {
  new_product:      v => `🆕 New Arrival: ${v.productName}!\n\nNow available at ${v.price}.\nShop now 👉 ${v.url}`,
  product_discount: v => `🔥 ${v.discount} OFF — ${v.productName}!\n\nWas ${v.price}, now only ${v.salePrice}!\nGrab it before it's gone 👉 ${v.url}`,
  offer_active:     v => `🎉 Special Offer: ${v.offerName}!\n\nDon't miss out — limited time only.\nShop now 👉 ${v.url}`,
};

async function compose(platform, trigger, entity, customMsg = '') {
  const isOffer = trigger === 'offer_active';
  const vars    = isOffer ? offerVars(entity) : productVars(entity);
  const imageUrl =
    entity.thumbnail || entity.bannerImage || entity.pageBannerImage ||
    (entity.images && entity.images[0]) || entity.image || '';

  // 1. Custom message from rule
  if (customMsg && customMsg.trim()) {
    return { text: interpolate(customMsg, vars), imageUrl };
  }

  // 2. Platform template
  try {
    const doc = await getOrCreate();
    const tpl  = (doc.templates || []).find(t => t.platform === platform && t.enabled);
    if (tpl && tpl.template) {
      let text = interpolate(tpl.template, vars);
      if (tpl.hashtags?.length) text += '\n\n' + tpl.hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ');
      return { text, imageUrl };
    }
  } catch { /* fall through */ }

  // 3. Built-in default
  const fn = DEFAULTS[trigger] || DEFAULTS.new_product;
  return { text: fn(vars), imageUrl };
}

module.exports = { compose };