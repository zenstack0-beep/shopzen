'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
require('../models/index'); // Registers Category for Product.populate().
const { buildGoogleMerchantFeed, validGtin } = require('../services/googleMerchantFeed');

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function value(item, tag) {
  const match = item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXml(match[1]) : '';
}

function validateXml(xml) {
  const errors = [];
  if (!/^<\?xml version="1\.0" encoding="UTF-8"\?>/.test(xml)) errors.push('missing XML declaration');
  if (!xml.includes('<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">')) errors.push('invalid RSS root or Google namespace');
  if (!xml.includes('<channel>') || !xml.includes('</channel>') || !xml.endsWith('</rss>')) errors.push('malformed RSS/channel structure');
  const itemOpens = (xml.match(/<item>/g) || []).length;
  const itemCloses = (xml.match(/<\/item>/g) || []).length;
  if (itemOpens !== itemCloses) errors.push(`unbalanced item elements (${itemOpens}/${itemCloses})`);
  const invalidEntity = xml.match(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  if (invalidEntity) errors.push('unescaped ampersand/entity');

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => match[1]);
  const ids = new Set();
  items.forEach((item, index) => {
    const label = `item ${index + 1}`;
    const id = value(item, 'g:id');
    const title = value(item, 'title');
    const link = value(item, 'link');
    const image = value(item, 'g:image_link');
    const price = value(item, 'g:price');
    const availability = value(item, 'g:availability');
    const brand = value(item, 'g:brand');
    const gtin = value(item, 'g:gtin');
    const mpn = value(item, 'g:mpn');
    const identifierExists = value(item, 'g:identifier_exists');

    if (!id) errors.push(`${label}: missing ID`);
    else if (ids.has(id)) errors.push(`${label}: duplicate ID ${id}`);
    else ids.add(id);
    if (id !== id.trim()) errors.push(`${label}: whitespace around ID`);
    if (!title) errors.push(`${label}: missing title`);
    if (!link) errors.push(`${label}: missing link`);
    if (!image) errors.push(`${label}: missing image`);
    if (!/^\d+(?:\.\d{2}) LKR$/.test(price) || Number(price.split(' ')[0]) <= 0) errors.push(`${label}: invalid price ${price}`);
    if (!['in_stock', 'out_of_stock', 'preorder', 'backorder'].includes(availability)) errors.push(`${label}: invalid availability ${availability}`);
    if (brand !== brand.trim()) errors.push(`${label}: whitespace around brand`);
    if (gtin && !validGtin(gtin)) errors.push(`${label}: invalid GTIN`);
    const expectedIdentifierExists = gtin || (mpn && brand) ? 'yes' : 'no';
    if (identifierExists !== expectedIdentifierExists) errors.push(`${label}: incorrect identifier_exists`);
  });
  return { errors, itemCount: items.length };
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  const products = await Product.find({ isActive: true }).populate('category', 'name').lean();
  const siteUrl = (process.env.FRONTEND_URL || 'https://shopzen.lk').trim();
  const { xml, diagnostics } = buildGoogleMerchantFeed(products, siteUrl);
  const validation = validateXml(xml);

  console.log(JSON.stringify({ ...diagnostics, validationErrors: validation.errors }, null, 2));
  if (validation.itemCount !== diagnostics.emittedItems) validation.errors.push('generated and parsed item counts differ');
  if (validation.errors.length || diagnostics.duplicateIds.length) process.exitCode = 1;
  await mongoose.disconnect();
}

main().catch(async error => {
  console.error(`Feed validation failed: ${error.message}`);
  process.exitCode = 1;
  try { await mongoose.disconnect(); } catch (_) {}
});

module.exports = { validateXml };
