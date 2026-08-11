'use strict';

const crypto = require('crypto');

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const replayCache = new Map();

function canonicalRequest({ timestamp, method, requestPath, rawRequestBody = '' }) {
  return `${timestamp}\n${String(method).toUpperCase()}\n${requestPath}\n${rawRequestBody}`;
}

function signRequest({ secret, timestamp, method, requestPath, rawRequestBody = '' }) {
  return crypto.createHmac('sha256', secret)
    .update(canonicalRequest({ timestamp, method, requestPath, rawRequestBody }))
    .digest('hex');
}

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function pruneReplayCache(nowSeconds) {
  for (const [signature, expiresAt] of replayCache.entries()) {
    if (expiresAt <= nowSeconds) replayCache.delete(signature);
  }
}

function verifyWhatsappHubRequest({ credentials, key, timestampText, signature, method, requestPath, rawRequestBody = '', nowSeconds = Math.floor(Date.now() / 1000) }) {
  const suppliedSignature = String(signature || '').replace(/^sha256=/i, '').toLowerCase();
  const timestamp = Number(timestampText);
  const timestampSeconds = timestamp > 100000000000 ? Math.floor(timestamp / 1000) : timestamp;
  if (!credentials ||
      !timingSafeStringEqual(key, credentials.key) ||
      !Number.isInteger(timestamp) ||
      Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS ||
      !/^[a-f0-9]{64}$/.test(suppliedSignature)) return { ok: false, status: 401 };

  const expected = signRequest({ secret: credentials.secret, timestamp: timestampText, method, requestPath, rawRequestBody });
  if (!timingSafeStringEqual(suppliedSignature, expected)) return { ok: false, status: 401 };
  pruneReplayCache(nowSeconds);
  if (replayCache.has(suppliedSignature)) return { ok: false, status: 409 };
  replayCache.set(suppliedSignature, nowSeconds + MAX_CLOCK_SKEW_SECONDS);
  return { ok: true, status: 200 };
}

async function whatsappHubAuth(req, res, next) {
  let credentials;
  try {
    credentials = await require('../services/socialMediaService').getActiveWhatsappHubCredentials();
  } catch {
    return res.status(503).json({ message: 'WhatsApp Hub connector is unavailable' });
  }
  if (!credentials) return res.status(503).json({ message: 'WhatsApp Hub connector is not configured' });

  const verification = verifyWhatsappHubRequest({
    credentials,
    key: req.get('X-ShopZen-Hub-Key'),
    timestampText: req.get('X-ShopZen-Hub-Timestamp'),
    signature: req.get('X-ShopZen-Hub-Signature'),
    method: req.method,
    requestPath: String(req.originalUrl || '').split('?')[0],
    rawRequestBody: req.rawBody || '',
  });
  if (verification.status === 409) {
    return res.status(409).json({ message: 'Connector request was already processed' });
  }
  if (!verification.ok) return res.status(401).json({ message: 'Invalid connector authentication' });
  req.whatsappHub = { authenticated: true };
  return next();
}

module.exports = whatsappHubAuth;
module.exports.canonicalRequest = canonicalRequest;
module.exports.signRequest = signRequest;
module.exports.verifyWhatsappHubRequest = verifyWhatsappHubRequest;
module.exports.clearReplayCache = () => replayCache.clear();
