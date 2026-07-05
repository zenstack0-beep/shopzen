const express = require('express');
const router = express.Router();
const https = require('https');
const { Review, Settings } = require('../models/index');
const Product = require('../models/Product');
const { auth, adminAuth } = require('../middleware/auth');

// ── Admin routes FIRST ────────────────────────────────────────────────────────

router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const reviews = await Review.find()
      .populate('user', 'firstName lastName')
      .populate('product', 'name')
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.put('/admin/:id/approve', adminAuth, async (req, res) => {
  try {
    const review = await Review.findByIdAndUpdate(
      req.params.id,
      { isApproved: !req.body.approved },
      { new: true }
    );
    res.json(review);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    await Review.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Admin-only: report Google Reviews config STATUS without ever returning the
// actual API key (the key is write-only from the browser's point of view —
// it is never sent back down, even to the admin panel, after it's saved).
router.get('/admin/google-config', adminAuth, async (req, res) => {
  try {
    const rows = await Settings.find({
      key: { $in: ['googlePlaceId', 'googlePlacesApiKey', 'showGoogleReviews'] },
    }).lean();
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.value; });
    res.json({
      googlePlaceId: cfg.googlePlaceId || '',
      hasApiKey: !!cfg.googlePlacesApiKey,
      showGoogleReviews: cfg.showGoogleReviews !== false,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Public routes ─────────────────────────────────────────────────────────────

router.get('/product/:productId', async (req, res) => {
  try {
    const reviews = await Review.find({
      product: req.params.productId,
      isApproved: true
    })
      .populate('user', 'firstName lastName avatar')
      .sort({ createdAt: -1 });
    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * GET /api/reviews/featured
 *
 * Store-wide "featured" reviews for the homepage "What People Say About Us"
 * section (Layout Builder → Testimonials). Pulls the best APPROVED reviews
 * across all products — not scoped to a single product page.
 *
 * Query params:
 *   limit  — max reviews to return (default 12, capped at 30)
 */
router.get('/featured', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);

    // Prefer strong reviews (4★ and up) so the homepage puts its best foot forward.
    const reviews = await Review.find({ isApproved: true, rating: { $gte: 4 } })
      .populate('user', 'firstName lastName avatar')
      .populate('product', 'name thumbnail images slug')
      .sort({ rating: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    // New stores may not have many 4★+ reviews yet — top up with the best
    // available approved reviews (any rating) so the section isn't sparse.
    if (reviews.length < 4) {
      const extra = await Review.find({ isApproved: true })
        .populate('user', 'firstName lastName avatar')
        .populate('product', 'name thumbnail images slug')
        .sort({ rating: -1, createdAt: -1 })
        .limit(limit)
        .lean();
      const seen = new Set(reviews.map(r => String(r._id)));
      for (const r of extra) {
        if (reviews.length >= limit) break;
        if (seen.has(String(r._id))) continue;
        reviews.push(r);
        seen.add(String(r._id));
      }
    }

    res.json(reviews);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── Google Reviews (Places API — New) — cached server-side relay ───────────
//
// IMPORTANT: Google has two generations of this API:
//   - "Places API" (legacy)  — maps.googleapis.com/maps/api/place/details/json
//   - "Places API (New)"     — places.googleapis.com/v1/places/{placeId}
// API keys created recently are commonly only authorized for the NEW API,
// so a call to the legacy endpoint silently comes back denied/empty even
// with a correct key + Place ID. This integration uses the NEW API.
//
// Config is stored in Settings (set from Admin → Reviews → Google Reviews):
//   googlePlaceId       — the store's Google Place ID (not secret)
//   googlePlacesApiKey  — a Google Places API key (SECRET — never sent to the
//                          browser; read directly from the DB here, and
//                          filtered out of the public GET /api/settings
//                          response in routes/settings.js)
//   showGoogleReviews   — boolean toggle, defaults to true if a Place ID + key exist
//
// Google's Place Details response (both API generations) caps out at a
// maximum of 5 reviews per place — that's a Google-side limit, not a bug here.
//
// Results are cached in-memory for 1 hour to respect quota/cost. A fetch
// failure never breaks the homepage — it falls back to the last good cache,
// or an empty/disabled payload. Admin → Reviews has a "Refresh Now" button
// that calls POST /admin/google-refresh to clear the cache on demand.
let _googleReviewsCache = null;
let _googleReviewsCacheAt = 0;
const GOOGLE_REVIEWS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function fetchGooglePlaceDetailsNew(placeId, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'places.googleapis.com',
      path: `/v1/places/${encodeURIComponent(placeId)}`,
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': apiKey,
        // FieldMask is REQUIRED by the New Places API — omitting it returns an error.
        'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,googleMapsUri,reviews',
      },
      timeout: 8000,
    };
    const req = https.request(options, (r) => {
      let data = '';
      r.on('data', chunk => { data += chunk; });
      r.on('end', () => {
        try { resolve({ statusCode: r.statusCode, body: JSON.parse(data || '{}') }); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('Google Places API timeout')); });
    req.end();
  });
}

const EMPTY_GOOGLE_PAYLOAD = { enabled: false, rating: 0, totalRatings: 0, mapsUrl: '', reviews: [] };

router.get('/google', async (req, res) => {
  try {
    const now = Date.now();
    if (_googleReviewsCache && now - _googleReviewsCacheAt < GOOGLE_REVIEWS_CACHE_TTL) {
      return res.json(_googleReviewsCache);
    }

    const rows = await Settings.find({
      key: { $in: ['googlePlaceId', 'googlePlacesApiKey', 'showGoogleReviews'] },
    }).lean();
    const cfg = {};
    rows.forEach(r => { cfg[r.key] = r.value; });

    if (cfg.showGoogleReviews === false || !cfg.googlePlaceId || !cfg.googlePlacesApiKey) {
      console.log('[GOOGLE REVIEWS] Skipped — not configured or disabled in Admin → Reviews.');
      _googleReviewsCache = EMPTY_GOOGLE_PAYLOAD;
      _googleReviewsCacheAt = now;
      return res.json(EMPTY_GOOGLE_PAYLOAD);
    }

    const result = await fetchGooglePlaceDetailsNew(cfg.googlePlaceId, cfg.googlePlacesApiKey);

    // ── DEBUG: always log the raw status + a trimmed body so misconfiguration
    // (wrong Place ID, API not enabled, key restrictions, billing not enabled)
    // is visible in Railway logs instead of silently showing nothing.
    console.log(
      '[GOOGLE REVIEWS] Places API (New) response — status:', result.statusCode,
      'body:', JSON.stringify(result.body).slice(0, 500)
    );

    if (result.statusCode !== 200 || result.body.error) {
      console.warn(
        '[GOOGLE REVIEWS] Places API (New) error —',
        'status:', result.statusCode,
        'code:', result.body?.error?.status || '(none)',
        'message:', result.body?.error?.message || '(no message)'
      );
      // Serve stale cache if we have one rather than a hard empty state
      if (_googleReviewsCache) return res.json(_googleReviewsCache);
      return res.json(EMPTY_GOOGLE_PAYLOAD);
    }

    const place = result.body;
    const payload = {
      enabled: true,
      rating: typeof place.rating === 'number' ? place.rating : 0,
      totalRatings: place.userRatingCount || 0,
      mapsUrl: place.googleMapsUri || '',
      reviews: (place.reviews || [])
        .slice()
        .sort((a, b) => new Date(b.publishTime || 0) - new Date(a.publishTime || 0))
        .slice(0, 10)
        .map(r => ({
          authorName:   r.authorAttribution?.displayName || 'Google User',
          authorPhoto:  r.authorAttribution?.photoUri || '',
          rating:       r.rating || 0,
          text:         r.text?.text || r.originalText?.text || '',
          relativeTime: r.relativePublishTimeDescription || '',
          time:         r.publishTime ? new Date(r.publishTime).getTime() : 0,
        })),
    };

    _googleReviewsCache = payload;
    _googleReviewsCacheAt = now;
    console.log('[GOOGLE REVIEWS] Fetched fresh —', payload.reviews.length, 'reviews, place rating', payload.rating, '/ 5, total ratings', payload.totalRatings);
    res.json(payload);
  } catch (err) {
    console.error('[GOOGLE REVIEWS] fetch failed:', err.message);
    // Never break the homepage over a Google API hiccup
    if (_googleReviewsCache) return res.json(_googleReviewsCache);
    res.json(EMPTY_GOOGLE_PAYLOAD);
  }
});

// Admin: force a fresh Google Reviews fetch on next GET /google call
// (bypasses the 1-hour cache) — used by the "Refresh Now" button in
// Admin → Reviews → Google Reviews, e.g. right after saving new credentials.
router.post('/admin/google-refresh', adminAuth, async (req, res) => {
  _googleReviewsCache = null;
  _googleReviewsCacheAt = 0;
  console.log('[GOOGLE REVIEWS] Cache cleared by admin — next request will fetch fresh from Google.');
  res.json({ success: true });
});

// Get products eligible for review by the current user (delivered orders, not yet reviewed)
router.get('/reviewable', auth, async (req, res) => {
  try {
    const Order = require('../models/Order');
    const orders = await Order.find({
      customer: req.user._id,
      orderStatus: 'delivered'
    }).select('items deliveredAt createdAt').populate('items.product', 'name images thumbnail slug');

    // Existing reviews by this user
    const existingReviews = await Review.find({ user: req.user._id }).select('product order');
    const reviewedKey = new Set(existingReviews.map(r => `${r.order}_${r.product}`));

    const reviewable = [];
    for (const order of orders) {
      for (const item of order.items) {
        if (!item.product) continue;
        const key = `${order._id}_${item.product._id}`;
        if (reviewedKey.has(key)) continue;
        reviewable.push({
          orderId: order._id,
          product: item.product,
          deliveredAt: order.deliveredAt || order.createdAt
        });
      }
    }

    res.json(reviewable);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post('/', auth, async (req, res) => {
  try {
    const { product, order: orderId, rating, title, comment } = req.body;

    if (!orderId) {
      return res.status(400).json({ message: 'An order is required to leave a review.' });
    }

    // Verify the order belongs to this user, contains this product, and has been delivered
    const Order = require('../models/Order');
    const order = await Order.findOne({ _id: orderId, customer: req.user._id });
    if (!order) {
      return res.status(403).json({ message: 'You can only review products from your own orders.' });
    }
    if (order.orderStatus !== 'delivered') {
      return res.status(403).json({ message: 'You can only review products after your order has been delivered.' });
    }
    const purchasedProduct = order.items.find(i => String(i.product) === String(product));
    if (!purchasedProduct) {
      return res.status(403).json({ message: 'You can only review products you have purchased.' });
    }

    // Prevent duplicate review for the same product/order
    const existing = await Review.findOne({ product, user: req.user._id, order: orderId });
    if (existing) {
      return res.status(409).json({ message: 'You have already reviewed this product for this order.' });
    }

    const review = await Review.create({
      product, order: orderId, rating, title, comment,
      user: req.user._id,
      isVerifiedPurchase: true,
      isApproved: true
    });
    const reviews = await Review.find({ product, isApproved: true });
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / (reviews.length || 1);
    await Product.findByIdAndUpdate(product, {
      'ratings.average': avg,
      'ratings.count': reviews.length
    });
    res.status(201).json(review);
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: 'You have already reviewed this product for this order.' });
    }
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;