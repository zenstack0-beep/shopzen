const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

if (!process.env.MONGODB_URI) { console.error('❌ MONGODB_URI not defined'); process.exit(1); }
console.log('🔗 MongoDB:', process.env.MONGODB_URI.replace(/\/\/(.*?):(.*)@/, '//***:***@'));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+-[a-z0-9]+-[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/shopzen\.lk$/,
  /^https:\/\/www\.shopzen\.lk$/,
];

if (process.env.FRONTEND_URL) {
  const fu = process.env.FRONTEND_URL.trim().replace(/\/$/, '');
  if (!allowedOrigins.some(o => typeof o === 'string' && o === fu)) {
    allowedOrigins.push(fu);
  }
}

if (process.env.EXTRA_ORIGINS) {
  process.env.EXTRA_ORIGINS.split(',').forEach(o => {
    const trimmed = o.trim().replace(/\/$/, '');
    if (trimmed) allowedOrigins.push(trimmed);
  });
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
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
app.use('/api/social-media',  require('./routes/socialMedia'));
app.use('/api/automation',    require('./routes/automation'));
app.use('/api/deals',         require('./routes/deals'));

// ── Serve built frontend ───────────────────────────────────────────────────────
const { seoRenderMiddleware } = require('./routes/seo');
const frontendBuildPath = path.join(__dirname, '..', 'frontend', 'build');
const fs = require('fs');

if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath, {
    index: false,
    maxAge: '7d',
    immutable: true,
  }));
  app.get('*', seoRenderMiddleware);
} else {
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