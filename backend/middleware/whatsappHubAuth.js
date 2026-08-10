'use strict';

const crypto = require('crypto');

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const replayCache = new Map();

function stableStringify(value) {
  if (value === undefined || value === null) return value === undefined ? '' : 'null';
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function canonicalRequest({ timestamp, method, originalUrl, body }) {
  const bodyHash = crypto.createHash('sha256').update(stableStringify(body || {})).digest('hex');
  return `${timestamp}\n${String(method).toUpperCase()}\n${originalUrl}\n${bodyHash}`;
}

function signRequest({ secret, timestamp, method, originalUrl, body }) {
  return crypto.createHmac('sha256', secret)
    .update(canonicalRequest({ timestamp, method, originalUrl, body }))
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

function whatsappHubAuth(req, res, next) {
  const configuredKey = process.env.SHOPZEN_HUB_KEY;
  const configuredSecret = process.env.SHOPZEN_HUB_SECRET;
  if (!configuredKey || !configuredSecret) {
    return res.status(503).json({ message: 'WhatsApp Hub connector is not configured' });
  }

  const suppliedKey = req.get('X-ShopZen-Hub-Key');
  const timestampText = req.get('X-ShopZen-Hub-Timestamp');
  const suppliedSignature = String(req.get('X-ShopZen-Hub-Signature') || '').replace(/^sha256=/i, '').toLowerCase();
  const timestamp = Number(timestampText);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (!timingSafeStringEqual(suppliedKey, configuredKey) ||
      !Number.isInteger(timestamp) ||
      Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS ||
      !/^[a-f0-9]{64}$/.test(suppliedSignature)) {
    return res.status(401).json({ message: 'Invalid connector authentication' });
  }

  const expected = signRequest({
    secret: configuredSecret,
    timestamp: timestampText,
    method: req.method,
    originalUrl: req.originalUrl,
    body: req.body,
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
module.exports.stableStringify = stableStringify;

