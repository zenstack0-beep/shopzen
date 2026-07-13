const express = require('express');
const router = express.Router();
const Offer = require('../models/Offer');
const { adminAuth } = require('../middleware/auth');
const { buildPaidLines, findEligibleOffer } = require('../services/offerEngine');
const { DiscountEngine } = require('../services/discountEngine');

const populate = query => query
  .populate('categories', 'name slug')
  .populate('products freeProducts', 'name thumbnail price salePrice stock isActive brand category');

// Public campaign preview used to attract storefront visitors before they
// have built an eligible cart. Only currently published offers are exposed.
router.get('/active', async (_req, res) => {
  try {
    const now = new Date();
    const offers = await populate(Offer.find({
      isActive: true, startsAt: { $lte: now }, endsAt: { $gte: now },
    }).sort({ sortOrder: 1, createdAt: -1 }));
    res.json(offers.map(offer => ({
      _id: offer._id, title: offer.title, description: offer.description,
      minimumAmount: offer.minimumAmount, freeItemCount: offer.freeItemCount,
      popupDelaySeconds: offer.popupDelaySeconds,
      startsAt: offer.startsAt, endsAt: offer.endsAt,
      brands: offer.brands, categories: offer.categories,
      freeProducts: (offer.freeProducts || []).filter(product => product?.isActive && product.stock > 0),
    })).filter(offer => offer.freeProducts.length));
  } catch (error) { res.status(500).json({ message: error.message }); }
});

router.post('/eligible', async (req, res) => {
  try {
    const lines = await buildPaidLines(req.body.items);
    const subtotal = DiscountEngine.computeSubtotal(lines);
    const offer = await findEligibleOffer(lines, subtotal);
    if (!offer) return res.json({ eligible: false, subtotal });
    res.json({
      eligible: true, subtotal, offer: {
        _id: offer._id, title: offer.title, description: offer.description,
        minimumAmount: offer.minimumAmount, freeItemCount: offer.freeItemCount,
        endsAt: offer.endsAt,
        freeProducts: offer.freeProducts.filter(p => p?.isActive && p.stock > 0),
      },
    });
  } catch (error) { res.status(500).json({ message: error.message }); }
});

router.get('/admin/all', adminAuth, async (_req, res) => {
  try { res.json(await populate(Offer.find().sort({ createdAt: -1 }))); }
  catch (error) { res.status(500).json({ message: error.message }); }
});

function clean(body) {
  return {
    title: body.title, description: body.description || '', brands: body.brands || [],
    categories: body.categories || [], products: body.products || [],
    minimumAmount: Number(body.minimumAmount), startsAt: body.startsAt, endsAt: body.endsAt,
    freeProducts: body.freeProducts || [], freeItemCount: Number(body.freeItemCount),
    popupDelaySeconds: Math.min(300, Math.max(0, Number(body.popupDelaySeconds ?? 1))),
    isActive: Boolean(body.isActive), sortOrder: Number(body.sortOrder || 0),
  };
}

router.post('/', adminAuth, async (req, res) => {
  try {
    const data = clean(req.body);
    if (!data.title || !data.freeProducts.length || data.freeItemCount < 1) return res.status(400).json({ message: 'Title, free items, and selection count are required' });
    if (!data.brands.length && !data.categories.length && !data.products.length) return res.status(400).json({ message: 'Select at least one qualifying brand, category, or product' });
    const offer = await Offer.create(data);
    res.status(201).json(await populate(Offer.findById(offer._id)));
  } catch (error) { res.status(400).json({ message: error.message }); }
});

router.put('/:id', adminAuth, async (req, res) => {
  try {
    const data = clean(req.body);
    if (!data.title || !data.freeProducts.length || data.freeItemCount < 1) return res.status(400).json({ message: 'Title, free items, and selection count are required' });
    if (!data.brands.length && !data.categories.length && !data.products.length) return res.status(400).json({ message: 'Select at least one qualifying brand, category, or product' });
    const offer = await populate(Offer.findByIdAndUpdate(req.params.id, data, { new: true, runValidators: true }));
    if (!offer) return res.status(404).json({ message: 'Offer not found' });
    res.json(offer);
  } catch (error) { res.status(400).json({ message: error.message }); }
});

router.delete('/:id', adminAuth, async (req, res) => {
  const offer = await Offer.findByIdAndDelete(req.params.id);
  if (!offer) return res.status(404).json({ message: 'Offer not found' });
  res.json({ message: 'Offer deleted' });
});

module.exports = router;
