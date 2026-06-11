const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not defined'); process.exit(1); }
console.log('🔗 MongoDB:', process.env.MONGODB_URI.replace(/\/\/(.*?):(.*)@/, '//***:***@'));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Since Vercel rewrites /api/* server-side to Railway, the Origin header seen
// by Railway will be the Vercel deployment URL (shopzen.lk or *.vercel.app).
// We also keep localhost for local dev. No origin (server-to-server) is allowed.
const allowedOrigins = [
  // Local dev
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  // Any Vercel preview / production deployment
  /^https:\/\/.*\.vercel\.app$/,
  // Production custom domain
  /^https:\/\/(www\.)?shopzen\.lk$/,
];

// Extra origins from env (comma-separated), e.g. EXTRA_ORIGINS=https://staging.shopzen.lk
if (process.env.EXTRA_ORIGINS) {
  process.env.EXTRA_ORIGINS.split(',').forEach(o => {
    const trimmed = o.trim().replace(/\/$/, '');
    if (trimmed) allowedOrigins.push(new RegExp('^' + trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
  });
}

app.use(cors({
  origin: (origin, cb) => {
    // No origin = server-to-server (Vercel rewrite, curl, health checks) — allow
    if (!origin) return cb(null, true);
    const ok = allowedOrigins.some(o => o.test(origin));
    if (ok) return cb(null, true);
    console.warn(`[CORS] Blocked: ${origin}`);
    cb(new Error('CORS blocked: ' + origin));
  },
  credentials: true,
}));

app.use((req, res, next) => { console.log(`→ ${req.method} ${req.url}`); next(); });
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date() }));

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/products',      require('./routes/products'));
app.use('/api/orders',        require('./routes/orders'));
app.use('/api/categories',    require('./routes/categories'));
app.use('/api/coupons',       require('./routes/coupons'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/banners',       require('./routes/banners'));
app.use('/api/reviews',       require('./routes/reviews'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/returns',       require('./routes/returns'));
app.use('/api/gift-cards',    require('./routes/giftcards'));
app.use('/api/seasonal',      require('./routes/seasonal'));
app.use('/api/upload',        require('./routes/upload'));
app.use('/api/payments',      require('./routes/payments'));
app.use('/api/delivery',      require('./routes/delivery'));
app.use('/api/pages',         require('./routes/pages'));
app.use('/api/subscribers',   require('./routes/subscribers'));
app.use('/api/seo',           require('./routes/seo'));

// ── Root-level SEO file aliases (so Sitemap: line in robots.txt resolves) ─────
app.get('/sitemap.xml', (req, res) => res.redirect(301, '/api/seo/sitemap.xml'));
app.get('/robots.txt', (req, res) => res.redirect(301, '/api/seo/robots.txt'));

app.use('/api/whatsapp',      require('./routes/whatsapp'));
app.use('/api/social-media',  require('./routes/socialMedia'));
app.use('/api/automation',    require('./routes/automation'));
app.use('/api/deals',         require('./routes/deals'));
app.use('/api/ai',            require('./routes/ai'));

// ── Page SSR for crawlers ──────────────────────────────────────────────────────
// Real users are served /index.html directly by Vercel (React SPA).
// Crawlers/bots are proxied here by Vercel Edge Middleware (middleware.js)
// so we can inject dynamic per-page meta, OG tags, and JSON-LD schema.
// The seoRenderMiddleware fetches the real index.html from Vercel, injects
// the correct tags, and returns the enriched HTML to the crawler.
const { seoRenderMiddleware } = require('./routes/seo');
const fs = require('fs');

// Only serve static files if a local build exists (monorepo / self-hosted deploy)
const frontendBuildPath = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath, {
    index: false,   // don't auto-serve index.html — let seoRenderMiddleware handle it
    maxAge: '7d',
    immutable: true,
  }));
}

// Catch-all: SSR for bots proxied via Vercel Edge Middleware,
// or fallback index.html for any other request that reaches Railway.
app.get('*', seoRenderMiddleware);

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    console.log('✅ MongoDB Connected');

    // Start proactive Facebook/Instagram token refresh scheduler
    const { startTokenRefreshScheduler } = require('./services/tokenRefreshScheduler');
    startTokenRefreshScheduler();

    const PORT = process.env.PORT || 5001;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error('❌ MongoDB Error:', err.message);
    process.exit(1);
  }
}
startServer();