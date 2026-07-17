'use strict';

const crypto = require('crypto');

const GOOGLE_NS = 'http://base.google.com/ns/1.0';
const VALID_AVAILABILITY = new Set(['in_stock', 'out_of_stock', 'preorder', 'backorder']);

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function xmlEscape(value) {
  return clean(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtml(value) {
  return clean(String(value == null ? '' : value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' '));
}

function validGtin(value) {
  const gtin = clean(value);
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(gtin)) return '';
  const digits = gtin.split('').map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check ? gtin : '';
}

function validMpn(value) {
  const mpn = clean(value);
  return mpn && mpn.length <= 70 ? mpn : '';
}

function condition(value) {
  const normalized = clean(value).toLowerCase();
  return ['used', 'refurbished'].includes(normalized) ? normalized : 'new';
}

function availability(product) {
  const explicit = clean(product.availability).toLowerCase();
  if (VALID_AVAILABILITY.has(explicit)) return explicit;
  return Number(product.stock) > 0 ? 'in_stock' : 'out_of_stock';
}

function buildGoogleMerchantFeed(products, siteUrl) {
  const baseUrl = clean(siteUrl).replace(/\/+$/, '');
  const skuCounts = new Map();
  products.forEach(product => {
    const sku = clean(product.sku);
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) || 0) + 1);
  });

  const diagnostics = {
    totalActiveProducts: products.length,
    emittedItems: 0,
    skipped: [],
    duplicateIds: [],
    productsWithoutImages: 0,
    productsWithoutValidIdentifiers: 0,
    invalidPrices: 0,
    invalidSalePrices: 0,
  };
  const usedIds = new Set();
  const items = [];

  products.forEach(product => {
    const mongoId = clean(product._id);
    const sku = clean(product.sku);
    const id = sku && skuCounts.get(sku) === 1 ? sku : mongoId;
    const title = clean(product.name).slice(0, 150);
    const slug = clean(product.slug);
    const link = slug && baseUrl ? `${baseUrl}/product/${encodeURIComponent(slug)}` : '';
    const images = [...new Set([product.thumbnail, ...(product.images || [])].map(clean).filter(Boolean))];
    const regularPrice = Number(product.price);
    const candidateSalePrice = Number(product.salePrice);
    const validSalePrice = Number.isFinite(candidateSalePrice) &&
      candidateSalePrice > 0 && candidateSalePrice < regularPrice;

    let skipReason = '';
    if (!id) skipReason = 'missing stable product ID';
    else if (usedIds.has(id)) {
      diagnostics.duplicateIds.push(id);
      skipReason = 'duplicate feed ID';
    } else if (!title) skipReason = 'missing title';
    else if (!link) skipReason = 'missing product URL or slug';
    else if (!images.length) {
      diagnostics.productsWithoutImages += 1;
      skipReason = 'missing product image';
    } else if (!Number.isFinite(regularPrice) || regularPrice <= 0) {
      diagnostics.invalidPrices += 1;
      skipReason = 'regular price must be numeric and greater than zero';
    }

    if (product.salePrice != null && product.salePrice !== '' && !validSalePrice) {
      diagnostics.invalidSalePrices += 1;
    }
    if (skipReason) {
      diagnostics.skipped.push({ id: id || mongoId || '(missing)', title: title || '(missing)', reason: skipReason });
      return;
    }

    usedIds.add(id);
    const brand = clean(product.brand);
    const gtin = validGtin(product.gtin);
    const mpn = validMpn(product.mpn);
    const hasIdentifiers = Boolean(gtin || (mpn && brand));
    if (!hasIdentifiers) diagnostics.productsWithoutValidIdentifiers += 1;
    const description = stripHtml(product.shortDescription || product.description || title).slice(0, 5000);
    const category = clean(product.category && (product.category.name || product.category));
    const additionalImages = images.slice(1, 11)
      .map(image => `    <g:additional_image_link>${xmlEscape(image)}</g:additional_image_link>`).join('\n');

    items.push(`  <item>
    <g:id>${xmlEscape(id)}</g:id>
    <title>${xmlEscape(title)}</title>
    <description>${xmlEscape(description || title)}</description>
    <link>${xmlEscape(link)}</link>
    <g:image_link>${xmlEscape(images[0])}</g:image_link>
${additionalImages ? `${additionalImages}\n` : ''}    <g:availability>${availability(product)}</g:availability>
    <g:condition>${condition(product.condition)}</g:condition>
    <g:price>${regularPrice.toFixed(2)} LKR</g:price>
${validSalePrice ? `    <g:sale_price>${candidateSalePrice.toFixed(2)} LKR</g:sale_price>\n` : ''}${brand ? `    <g:brand>${xmlEscape(brand)}</g:brand>\n` : ''}${gtin ? `    <g:gtin>${gtin}</g:gtin>\n` : ''}${mpn ? `    <g:mpn>${xmlEscape(mpn)}</g:mpn>\n` : ''}    <g:identifier_exists>${hasIdentifiers ? 'yes' : 'no'}</g:identifier_exists>
${category ? `    <g:product_type>${xmlEscape(category)}</g:product_type>\n` : ''}  </item>`);
  });

  diagnostics.emittedItems = items.length;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="${GOOGLE_NS}" version="2.0">
<channel>
  <title>ShopZen Products</title>
  <link>${xmlEscape(baseUrl)}</link>
  <description>Automatically synchronized ShopZen product feed</description>
${items.join('\n')}
</channel>
</rss>`;
  const etag = `"${crypto.createHash('sha256').update(xml).digest('hex')}"`;
  return { xml, etag, diagnostics };
}

module.exports = {
  GOOGLE_NS,
  VALID_AVAILABILITY,
  availability,
  buildGoogleMerchantFeed,
  clean,
  condition,
  stripHtml,
  validGtin,
  validMpn,
  xmlEscape,
};
