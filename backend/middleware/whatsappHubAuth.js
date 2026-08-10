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

async function whatsappHubAuth(req, res, next) {
  let credentials;
  try {
    credentials = await require('../services/socialMediaService').getActiveWhatsappHubCredentials();
  } catch {
    return res.status(503).json({ message: 'WhatsApp Hub connector is unavailable' });
  }
  if (!credentials) return res.status(503).json({ message: 'WhatsApp Hub connector is not configured' });

  const suppliedKey = req.get('X-ShopZen-Hub-Key');
  const timestampText = req.get('X-ShopZen-Hub-Timestamp');
  const suppliedSignature = String(req.get('X-ShopZen-Hub-Signature') || '').replace(/^sha256=/i, '').toLowerCase();
  const timestamp = Number(timestampText);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const timestampSeconds = timestamp > 100000000000 ? Math.floor(timestamp / 1000) : timestamp;

  if (!timingSafeStringEqual(suppliedKey, credentials.key) ||
      !Number.isInteger(timestamp) ||
      Math.abs(nowSeconds - timestampSeconds) > MAX_CLOCK_SKEW_SECONDS ||
      !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    return res.status(401).json({ message: 'Invalid connector authentication' });
  }

  const expected = signRequest({
    secret: credentials.secret,
    timestamp: timestampText,
    method: req.method,
    requestPath: String(req.originalUrl || '').split('?')[0],
    rawRequestBody: req.rawBody || '',
  });
  if (!timingSafeStringEqual(suppliedSignature, expected)) {
    return res.status(401).json({ message: 'Invalid connector authentication' });
  }

  pruneReplayCache(nowSeconds);
  if (replayCache.has(suppliedSignature)) {
    return res.status(409).json({ message: 'Connector request was already processed' });
  }
  replayCache.set(suppliedSignature, nowSeconds + MAX_CLOCK_SKEW_SECONDS);
  req.whatsappHub = { authenticated: true };
  return next();
}

module.exports = whatsappHubAuth;
module.exports.canonicalRequest = canonicalRequest;
module.exports.signRequest = signRequest;
