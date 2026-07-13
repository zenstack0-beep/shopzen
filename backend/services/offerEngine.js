const Offer = require('../models/Offer');
const Product = require('../models/Product');
const { DiscountEngine } = require('./discountEngine');

const ids = values => (values || []).map(value => String(value?._id || value));

function offerMatches(offer, lineItems) {
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

function rewardForAmount(offer, amount) {
  const configured = (offer.tiers || []).length
    ? offer.tiers
    : [{ minimumAmount: offer.minimumAmount, freeProducts: offer.freeProducts, freeItemCount: offer.freeItemCount }];
  const unlockedTiers = configured
    .filter(tier => Number(amount) >= Number(tier.minimumAmount || 0))
    .sort((a, b) => Number(a.minimumAmount) - Number(b.minimumAmount));
  const products = [];
  const seen = new Set();
  unlockedTiers.forEach(tier => (tier.freeProducts || []).forEach(product => {
    const productId = String(product?._id || product);
    if (product && !seen.has(productId)) { seen.add(productId); products.push(product); }
  }));
  return {
    unlockedTiers,
    freeProducts: products.filter(product => product?.isActive !== false && (product?.stock == null || product.stock > 0)),
    // The count on a level is the TOTAL number selectable at that spend,
    // not an amount added to every previous level. Previous levels only add
    // product choices. Four levels set to 1 therefore still allow one gift.
    freeItemCount: unlockedTiers.length
      ? Number(unlockedTiers[unlockedTiers.length - 1].freeItemCount || 0)
      : 0,
  };
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

async function findEligibleOffer(lineItems, eligibleAmount) {
  const now = new Date();
  const offers = await Offer.find({ isActive: true, startsAt: { $lte: now }, endsAt: { $gte: now } })
    .populate('freeProducts tiers.freeProducts', 'name slug thumbnail images price salePrice stock isActive')
    .sort({ sortOrder: 1, createdAt: -1 });
  for (const offer of offers) {
    if (!offerMatches(offer, lineItems)) continue;
    const reward = rewardForAmount(offer, eligibleAmount);
    if (reward.freeItemCount > 0 && reward.freeProducts.length) return { offer, reward };
  }
  return null;
}

module.exports = { offerMatches, rewardForAmount, buildPaidLines, findEligibleOffer };
