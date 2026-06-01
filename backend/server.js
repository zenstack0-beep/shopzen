const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not defined'); process.exit(1); }
console.log('🔗 MongoDB:', process.env.MONGODB_URI.replace(/\/\/(.*?):(.*)@/, '//***:***@'));

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allowed origins:
//   1. Any localhost / 127.0.0.1 port (local dev)
//   2. The production domain set in FRONTEND_URL env var
//   3. ALL Vercel preview deployments for your project (*.vercel.app)
//      This fixes: "CORS blocked: https://shopzen-xxx-yyy.vercel.app"
const allowedOrigins = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,  // any localhost port
  /^https:\/\/[a-z0-9-]+-[a-z0-9]+-[a-z0-9-]+\.vercel\.app$/,  // Vercel preview URLs
  /^https:\/\/shopzen\.lk$/,                        // production domain
  /^https:\/\/www\.shopzen\.lk$/,                   // www variant
];

// Also allow whatever is in FRONTEND_URL (e.g. https://shopzen.lk)
if (process.env.FRONTEND_URL) {
  const fu = process.env.FRONTEND_URL.trim().replace(/\/$/, '');
  if (!allowedOrigins.some(o => typeof o === 'string' && o === fu)) {
    allowedOrigins.push(fu);
  }
}

// Allow any extra origins listed in EXTRA_ORIGINS (comma-separated)
if (process.env.EXTRA_ORIGINS) {
  process.env.EXTRA_ORIGINS.split(',').forEach(o => {
    const trimmed = o.trim().replace(/\/$/, '');
    if (trimmed) allowedOrigins.push(trimmed);
  });
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / server-to-server / same-origin
    const ok = allowedOrigins.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    if (ok) {
      cb(null, true);
    } else {
      console.warn(`[CORS] Blocked: ${origin}`);
      cb(new Error('CORS blocked: ' + origin));
    }
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
app.use('/api/whatsapp',      require('./routes/whatsapp'));

// ── Serve built frontend with live SEO meta injection ─────────────────────────
// This replaces the static catch-all so Googlebot always sees real meta tags.
// For local dev (no build folder), it falls back gracefully with a clear message.
const { seoRenderMiddleware } = require('./routes/seo');
const frontendBuildPath = path.join(__dirname, '..', 'frontend', 'build');
const fs = require('fs');

if (fs.existsSync(frontendBuildPath)) {
  // Serve all static assets (JS, CSS, images, fonts) from the build folder
  app.use(express.static(frontendBuildPath, {
    index: false,            // do NOT serve index.html directly — we inject meta first
    maxAge: '7d',            // cache static assets for 7 days
    immutable: true,
  }));
  // All remaining routes → SSR-lite HTML with injected SEO meta
  app.get('*', seoRenderMiddleware);
} else {
  // Dev mode: backend only, no built frontend
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      res.status(404).json({ message: `Route not found: ${req.method} ${req.url}` });
    } else {
      res.status(200).send('<p>Frontend not built yet. Run: <code>cd frontend && npm run build</code></p>');
    }
  });
}

async function startServer() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    console.log('✅ MongoDB Connected');
    const PORT = process.env.PORT || 5001;
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  } catch (err) {
    console.error('❌ MongoDB Error:', err.message);
    process.exit(1);
  }
}
startServer();