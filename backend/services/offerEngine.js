const Offer = require('../models/Offer');
const Product = require('../models/Product');
const { DiscountEngine } = require('./discountEngine');

const ids = values => (values || []).map(value => String(value?._id || value));

function offerMatches(offer, lineItems, subtotal) {
  if (Number(subtotal) < Number(offer.minimumAmount || 0)) return false;
  const cartProducts = new Set(lineItems.map(item => String(item.product)));
  const cartCategories = new Set(lineItems.flatMap(item => [item.category, item.subCategory]).filter(Boolean).map(String));
  const cartBrands = new Set(lineItems.map(item => String(item.brand || '').toLowerCase()).filter(Boolean));
  const requiredProducts = ids(offer.products);
  const requiredCategories = ids(offer.categories);
  const requiredBrands = (offer.brands || []).map(value => String(value).toLowerCase());

  return (!requiredProducts.length || requiredProducts.some(id => cartProducts.has(id)))
    && (!requiredCategories.length || requiredCategories.some(id => cartCategories.has(id)))
    && (!requiredBrands.length || requiredBrands.some(brand => cartBrands.has(brand)));
}

async function buildPaidLines(cartItems) {
  const lines = [];
  for (const item of cartItems || []) {
    const quantity = Number.parseInt(item.quantity, 10);
    if (!item.productId || !Number.isInteger(quantity) || quantity < 1) continue;
    const product = await Product.findOne({ _id: item.productId, isActive: true });
    if (product) lines.push(DiscountEngine.buildLineItem(product, quantity));
  }
  return lines;
}

async function findEligibleOffer(lineItems, subtotal) {
  const now = new Date();
  const offers = await Offer.find({ isActive: true, startsAt: { $lte: now }, endsAt: { $gte: now } })
    .populate('freeProducts', 'name slug thumbnail images price salePrice stock isActive')
    .sort({ sortOrder: 1, createdAt: -1 });
  return offers.find(offer => offerMatches(offer, lineItems, subtotal) && offer.freeProducts.some(p => p?.isActive && p.stock > 0)) || null;
}

module.exports = { offerMatches, buildPaidLines, findEligibleOffer };
