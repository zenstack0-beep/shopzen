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