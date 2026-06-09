/**
 * routes/products.js  — with automation hooks
 *
 *   POST /       → fires 'new_product'      trigger after product create
 *   PUT  /:id    → fires 'product_discount' trigger when salePrice is set/changed
 */
const express = require('express');
const router  = express.Router();
const Product = require('../models/Product');
const { adminAuth } = require('../middleware/auth');
const { dispatchForTrigger, manualPublish } = require('../services/publisherService');

// ── IMPORTANT: named routes BEFORE /:slug wildcard ───────────────────────────

// Admin — get all products
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const { search, category, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (search)   filter.name     = new RegExp(search, 'i');
    if (category) filter.category = category;
    const total    = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('category', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ products, total, pages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin — create product
router.post('/', adminAuth, async (req, res) => {
  let product;
  try {
    product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }

  // Fire automation AFTER response is sent — non-blocking
  try {
    if (product.isActive !== false) {
      await dispatchForTrigger('new_product', product, 'product');
    }
  } catch (err) {
    console.error('[Automation] new_product dispatch error:', err.message);
  }
});

// Admin — update product
router.put('/:id', adminAuth, async (req, res) => {
  let before, product;
  try {
    before  = await Product.findById(req.params.id).lean();
    product = await Product.findByIdAndUpdate(
      req.params.id, { $set: req.body }, { new: true, runValidators: false }
    );
    res.json(product);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }

  // Fire discount trigger when salePrice is newly set or changed
  try {
    const hadSale    = !!before?.salePrice;
    const nowHasSale = !!req.body.salePrice;
    const saleChanged = hadSale
      ? (req.body.salePrice && String(req.body.salePrice) !== String(before.salePrice))
      : nowHasSale;
    if (saleChanged && product.isActive !== false) {
      await dispatchForTrigger('product_discount', product, 'product');
    }
  } catch (err) {
    console.error('[Automation] product_discount dispatch error:', err.message);
  }
});


// Admin — manual publish a product to social media platforms
// POST /api/products/:id/publish
// Body: { platforms: ['facebook','instagram',...], customMsg?: '' }
router.post('/:id/publish', adminAuth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    const { platforms = [], customMsg = '' } = req.body;
    if (!platforms.length) return res.status(400).json({ message: 'Select at least one platform' });

    const adminUserId = req.admin?._id?.toString() || 'unknown';

    const results = await Promise.allSettled(
      platforms.map(platform =>
        manualPublish({
          platform,
          entityType:  'product',
          entityId:    product._id.toString(),
          entityName:  product.name,
          customMsg,
          trigger:     'manual',
          adminUserId,
        })
      )
    );

    const logs = results.map((r, i) => ({
      platform: platforms[i],
      status:   r.value?.status ?? 'failed',
      message:  r.value?.errorMessage || (r.reason?.message ?? ''),
    }));

    const allFailed = logs.every(l => l.status === 'failed');
    res.status(allFailed ? 500 : 200).json({ logs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin — hard delete
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    const deleted = await Product.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Public — list with filters
router.get('/', async (req, res) => {
  try {
    const { category, search, minPrice, maxPrice, sort, page = 1, limit = 12, featured, onSale, brand } = req.query;
    const filter = { isActive: true };
    if (category) filter.category  = category;
    if (featured) filter.isFeatured = true;
    if (onSale)   filter.isOnSale   = true;
    if (brand)    filter.brand       = new RegExp(brand, 'i');
    if (search)   filter.$or = [
      { name: new RegExp(search, 'i') },
      { description: new RegExp(search, 'i') },
      { tags: new RegExp(search, 'i') },
    ];
    if (minPrice || maxPrice) {
      const min = minPrice ? Number(minPrice) : null;
      const max = maxPrice ? Number(maxPrice) : null;
      const priceRange = {};
      if (min !== null) priceRange.$gte = min;
      if (max !== null) priceRange.$lte = max;
      // Match products where effective price is in range:
      // - On-sale products: use salePrice (discounted price)
      // - Regular products: use price
      filter.$and = filter.$and || [];
      filter.$and.push({
        $or: [
          // Product has an active sale — match against salePrice
          { isOnSale: true, salePrice: priceRange },
          // Product has no active sale — match against regular price
          { $or: [{ isOnSale: false }, { isOnSale: { $exists: false } }], price: priceRange },
        ],
      });
    }
    let sortObj = { createdAt: -1 };
    if (sort === 'price_asc')  sortObj = { price: 1 };
    if (sort === 'price_desc') sortObj = { price: -1 };
    if (sort === 'popular')    sortObj = { soldCount: -1 };
    if (sort === 'rating')     sortObj = { 'ratings.average': -1 };
    const total    = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .sort(sortObj)
      .skip((page - 1) * limit)
      .limit(Number(limit));
    res.json({ products, total, pages: Math.ceil(total / limit), page: Number(page) });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Public — similar products by product ID (scored by tags, category, brand, price range)
// GET /api/products/:id/similar?limit=6
router.get('/:id/similar', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 6, 12);
    const source = await Product.findById(req.params.id).populate('category', 'name slug').lean();
    if (!source) return res.status(404).json({ message: 'Product not found' });

    // Build a broad candidate pool: same category OR overlapping tags OR same brand
    const orConditions = [];
    if (source.category?._id) orConditions.push({ category: source.category._id });
    if (source.tags?.length)   orConditions.push({ tags: { $in: source.tags } });
    if (source.brand)          orConditions.push({ brand: source.brand });

    const candidates = await Product.find({
      _id:      { $ne: source._id },
      isActive: true,
      ...(orConditions.length ? { $or: orConditions } : {}),
    })
      .populate('category', 'name slug')
      .lean();

    // Score each candidate — higher = more similar
    const effectivePrice = p => p.isOnSale && p.salePrice ? p.salePrice : p.price;
    const sourcePrice    = effectivePrice(source);

    const scored = candidates.map(p => {
      let score = 0;

      // Same category → strong signal
      if (p.category?._id?.toString() === source.category?._id?.toString()) score += 40;

      // Overlapping tags — weight by overlap ratio
      const srcTags  = new Set((source.tags || []).map(t => t.toLowerCase()));
      const candTags = (p.tags || []).map(t => t.toLowerCase());
      const sharedTags = candTags.filter(t => srcTags.has(t)).length;
      if (srcTags.size > 0) score += Math.round((sharedTags / srcTags.size) * 35);

      // Same brand
      if (source.brand && p.brand && source.brand.toLowerCase() === p.brand.toLowerCase()) score += 15;

      // Similar price (within 30% of source price)
      if (sourcePrice > 0) {
        const priceDiff = Math.abs(effectivePrice(p) - sourcePrice) / sourcePrice;
        if (priceDiff <= 0.1) score += 10;
        else if (priceDiff <= 0.2) score += 6;
        else if (priceDiff <= 0.3) score += 3;
      }

      // Popularity boost (normalised, max 5 pts)
      score += Math.min(5, Math.round((p.soldCount || 0) / 20));

      return { ...p, _similarityScore: score };
    });

    // Sort by score desc, then by soldCount for ties
    scored.sort((a, b) =>
      b._similarityScore - a._similarityScore ||
      (b.soldCount || 0) - (a.soldCount || 0)
    );

    const results = scored.slice(0, limit).map(({ _similarityScore, ...p }) => p);
    res.json(results);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Public — single product by slug (wildcard — MUST be last)
router.get('/:slug', async (req, res) => {
  try {
    const product = await Product.findOneAndUpdate(
      { slug: req.params.slug, isActive: true },
      { $inc: { views: 1 } },
      { new: true }
    ).populate('category', 'name slug');
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;