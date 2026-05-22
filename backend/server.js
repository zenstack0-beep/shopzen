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
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,   // any localhost port
];
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);   // production Vercel URL
}

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / same-origin
    const ok = allowedOrigins.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    ok ? cb(null, true) : cb(new Error('CORS blocked: ' + origin));
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

app.use((req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.url}` });
});

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
