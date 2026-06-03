/**
 * socialMediaService.js
 * Business logic for social media account management.
 * All credential encryption/decryption lives here.
 * Access tokens are NEVER returned to the frontend.
 */

const crypto = require('crypto');
const SocialMedia = require('../models/SocialMedia');

// ─── Encryption helpers ───────────────────────────────────────────────────────
const ALGO      = 'aes-256-gcm';
const KEY_LEN   = 32;
const IV_LEN    = 16;
const TAG_LEN   = 16;

function getKey() {
  const raw = process.env.SOCIAL_MEDIA_SECRET || process.env.JWT_SECRET || 'shopzen-fallback-secret-32chars!!';
  // Derive a 32-byte key from whatever length the env var is
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(plaintext) {
  if (!plaintext) return '';
  const iv  = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as: iv(hex):tag(hex):ciphertext(hex)
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(ciphertext) {
  if (!ciphertext) return '';
  try {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    const iv         = Buffer.from(ivHex, 'hex');
    const tag        = Buffer.from(tagHex, 'hex');
    const encrypted  = Buffer.from(encHex, 'hex');
    const decipher   = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  } catch {
    return '';
  }
}

// ─── Credential fields that must be encrypted at rest ────────────────────────
const SENSITIVE_FIELDS = ['accessToken', 'accessSecret', 'appSecret'];

// ─── Sanitize a platform doc for the frontend (strip all credentials) ─────────
function sanitizePlatform(platform = {}) {
  const { accessToken, accessSecret, appId, appSecret, extraConfig, ...safe } = platform;
  return {
    ...safe,
    // expose only whether a secret exists, never the value
    hasAccessToken: !!accessToken,
    hasAppSecret:   !!appSecret,
    hasAccessSecret:!!accessSecret,
  };
}

// ─── Sanitize the whole document ─────────────────────────────────────────────
function sanitizeDoc(doc) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'telegram'];
  PLATFORMS.forEach(p => {
    if (obj[p]) obj[p] = sanitizePlatform(obj[p]);
  });
  return obj;
}

// ─── Encrypt sensitive fields in a platform object before save ────────────────
function encryptPlatformFields(platformData) {
  const result = { ...platformData };
  SENSITIVE_FIELDS.forEach(field => {
    if (result[field] !== undefined) {
      // Only re-encrypt if the value looks like a real plaintext (not already encrypted)
      const val = result[field];
      if (val && !val.includes(':')) {
        result[field] = encrypt(val);
      } else if (!val) {
        result[field] = '';
      }
    }
  });
  return result;
}

// ─── Decrypt sensitive fields from a platform object ─────────────────────────
function decryptPlatformFields(platformData) {
  const result = { ...platformData };
  SENSITIVE_FIELDS.forEach(field => {
    if (result[field]) result[field] = decrypt(result[field]);
  });
  return result;
}

// ─── Load or create the singleton doc ────────────────────────────────────────
async function getOrCreate() {
  let doc = await SocialMedia.findOne();
  if (!doc) doc = await SocialMedia.create({});
  return doc;
}

// ─── GET settings (sanitized for frontend) ───────────────────────────────────
async function getSettings() {
  const doc = await getOrCreate();
  return sanitizeDoc(doc);
}

// ─── UPDATE platform credentials ─────────────────────────────────────────────
async function updatePlatform(platform, data) {
  const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'telegram'];
  if (!PLATFORMS.includes(platform)) throw new Error('Unknown platform');

  const doc = await getOrCreate();
  const existing = doc[platform]?.toObject ? doc[platform].toObject() : (doc[platform] || {});

  // Merge, then encrypt sensitive fields
  const merged = encryptPlatformFields({ ...existing, ...data });

  doc[platform] = merged;
  doc.updatedAt = new Date();
  await doc.save();
  return sanitizePlatform(doc[platform]);
}

// ─── CONNECT a platform (mark connected, store credentials) ──────────────────
async function connectPlatform(platform, credentials) {
  const doc = await getOrCreate();
  const existing = doc[platform]?.toObject ? doc[platform].toObject() : (doc[platform] || {});

  const updated = encryptPlatformFields({
    ...existing,
    ...credentials,
    connected: true,
    connectedAt: new Date(),
  });

  doc[platform] = updated;
  doc.updatedAt = new Date();
  await doc.save();
  return sanitizePlatform(doc[platform]);
}

// ─── DISCONNECT a platform (wipe credentials, mark disconnected) ──────────────
async function disconnectPlatform(platform) {
  const doc = await getOrCreate();
  doc[platform] = {
    connected: false,
    enabled: false,
    accountId: '',
    accountName: '',
    accountHandle: '',
    accountAvatar: '',
    accessToken: '',
    accessSecret: '',
    appId: '',
    appSecret: '',
    extraConfig: {},
    lastTested: null,
    lastTestStatus: '',
    lastTestMessage: '',
    connectedAt: null,
  };
  doc.updatedAt = new Date();
  await doc.save();
  return { disconnected: true };
}

// ─── TEST connection ──────────────────────────────────────────────────────────
async function testConnection(platform) {
  const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'whatsapp', 'telegram'];
  if (!PLATFORMS.includes(platform)) throw new Error('Unknown platform');

  const doc = await getOrCreate();
  const raw  = doc[platform]?.toObject ? doc[platform].toObject() : (doc[platform] || {});
  const data = decryptPlatformFields(raw);

  if (!data.connected) {
    return { ok: false, message: 'Account is not connected' };
  }

  let result = { ok: false, message: 'Unknown error' };

  try {
    result = await runPlatformTest(platform, data);
  } catch (err) {
    result = { ok: false, message: err.message || 'Connection test failed' };
  }

  // Persist last test result
  doc[platform].lastTested     = new Date();
  doc[platform].lastTestStatus  = result.ok ? 'ok' : 'error';
  doc[platform].lastTestMessage = result.message;
  doc.updatedAt = new Date();
  await doc.save();

  return result;
}

// ─── Platform-specific test implementations ───────────────────────────────────
async function runPlatformTest(platform, data) {
  switch (platform) {
    case 'facebook':
      return testFacebook(data);
    case 'instagram':
      return testInstagram(data);
    case 'tiktok':
      return testTikTok(data);
    case 'whatsapp':
      return testWhatsApp(data);
    case 'telegram':
      return testTelegram(data);
    default:
      return { ok: false, message: 'Unsupported platform' };
  }
}

async function testFacebook(data) {
  if (!data.accessToken) return { ok: false, message: 'No access token configured' };
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me?access_token=${data.accessToken}&fields=id,name`
    );
    const json = await res.json();
    if (json.error) return { ok: false, message: json.error.message };
    return { ok: true, message: `Connected as: ${json.name} (${json.id})` };
  } catch (err) {
    return { ok: false, message: `Network error: ${err.message}` };
  }
}

async function testInstagram(data) {
  if (!data.accessToken) return { ok: false, message: 'No access token configured' };
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me?access_token=${data.accessToken}&fields=id,name,username`
    );
    const json = await res.json();
    if (json.error) return { ok: false, message: json.error.message };
    return { ok: true, message: `Connected as: ${json.username || json.name} (${json.id})` };
  } catch (err) {
    return { ok: false, message: `Network error: ${err.message}` };
  }
}

async function testTikTok(data) {
  if (!data.accessToken) return { ok: false, message: 'No access token configured' };
  try {
    const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name', {
      headers: { Authorization: `Bearer ${data.accessToken}` },
    });
    const json = await res.json();
    if (json.error?.code && json.error.code !== 'ok') {
      return { ok: false, message: json.error.message || 'TikTok API error' };
    }
    const user = json.data?.user;
    return { ok: true, message: `Connected as: ${user?.display_name || 'TikTok user'} (${user?.open_id || '—'})` };
  } catch (err) {
    return { ok: false, message: `Network error: ${err.message}` };
  }
}

async function testWhatsApp(data) {
  if (!data.accessToken) return { ok: false, message: 'No access token configured' };
  if (!data.accountId)   return { ok: false, message: 'No Phone Number ID configured' };
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${data.accountId}?access_token=${data.accessToken}&fields=id,display_phone_number,verified_name`
    );
    const json = await res.json();
    if (json.error) return { ok: false, message: json.error.message };
    return { ok: true, message: `Connected: ${json.verified_name} (${json.display_phone_number})` };
  } catch (err) {
    return { ok: false, message: `Network error: ${err.message}` };
  }
}

async function testTelegram(data) {
  if (!data.accessToken) return { ok: false, message: 'No Bot Token configured' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${data.accessToken}/getMe`);
    const json = await res.json();
    if (!json.ok) return { ok: false, message: json.description || 'Telegram API error' };
    const bot = json.result;
    return { ok: true, message: `Connected: @${bot.username} — ${bot.first_name}` };
  } catch (err) {
    return { ok: false, message: `Network error: ${err.message}` };
  }
}

// ─── UPDATE global automation settings ───────────────────────────────────────
async function updateAutomation({ automationEnabled, enabledPlatforms }) {
  const doc = await getOrCreate();
  if (automationEnabled !== undefined) doc.automationEnabled = automationEnabled;
  if (enabledPlatforms  !== undefined) doc.enabledPlatforms  = enabledPlatforms;
  doc.updatedAt = new Date();
  await doc.save();
  return { automationEnabled: doc.automationEnabled, enabledPlatforms: doc.enabledPlatforms };
}

// ─── UPDATE post templates ────────────────────────────────────────────────────
async function updateTemplates(templates) {
  const doc = await getOrCreate();
  doc.templates = templates;
  doc.updatedAt = new Date();
  await doc.save();
  return doc.templates;
}

// ─── TOGGLE platform enabled/disabled ────────────────────────────────────────
async function togglePlatform(platform, enabled) {
  const doc = await getOrCreate();
  if (!doc[platform]) throw new Error('Unknown platform');
  doc[platform].enabled = enabled;
  doc.updatedAt = new Date();
  await doc.save();
  return { platform, enabled };
}

module.exports = {
  getSettings,
  updatePlatform,
  connectPlatform,
  disconnectPlatform,
  testConnection,
  updateAutomation,
  updateTemplates,
  togglePlatform,
  // expose for internal use by other services (e.g. post scheduler)
  getOrCreate,
  decryptPlatformFields,
};