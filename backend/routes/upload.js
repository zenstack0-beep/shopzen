const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { adminAuth } = require('../middleware/auth');

// ─── Cloudinary or local storage ─────────────────────────────────────────────
const USE_CLOUDINARY =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

let cloudinary, CloudinaryStorage;

if (USE_CLOUDINARY) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  const { CloudinaryStorage: CS } = require('multer-storage-cloudinary');
  CloudinaryStorage = CS;
  console.log('🌥️  Upload storage: Cloudinary');
} else {
  console.log('💾 Upload storage: local disk');
}

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|svg/;
  const ext  = allowed.test(path.extname(file.originalname).toLowerCase());
  const mime = allowed.test(file.mimetype);
  if (ext && mime) cb(null, true);
  else cb(new Error('Only image files allowed'));
};

let upload;

if (USE_CLOUDINARY) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: () => ({
      folder: 'shopzen',
      allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
      transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      public_id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    }),
  });
  upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });
} else {
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`);
    },
  });
  upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });
}

function localUrl(req, filename) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return `${proto}://${host}/uploads/${filename}`;
}

router.post('/', adminAuth, upload.single('image'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const url = USE_CLOUDINARY ? req.file.path : localUrl(req, req.file.filename);
    res.json({ url, filename: req.file.filename });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post('/multiple', adminAuth, upload.array('images', 10), (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ message: 'No files uploaded' });
    const urls = req.files.map(f => ({
      url: USE_CLOUDINARY ? f.path : localUrl(req, f.filename),
      filename: f.filename,
    }));
    res.json({ urls });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete('/:publicId', adminAuth, async (req, res) => {
  if (!USE_CLOUDINARY) return res.json({ message: 'Local files not deleted via API' });
  try {
    const result = await cloudinary.uploader.destroy(`shopzen/${req.params.publicId}`);
    res.json({ result });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
