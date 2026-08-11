'use strict';

const assert = require('assert');
const {
  signRequest,
  verifyWhatsappHubRequest,
  clearReplayCache,
} = require('../middleware/whatsappHubAuth');
const { isWhatsappHubIntegrationPath } = require('../middleware/security');

const credentials = { key: 'hub-key-for-test', secret: 'hub-secret-for-test' };
const nowSeconds = 1_786_435_200;
const base = {
  credentials,
  key: credentials.key,
  timestampText: String(nowSeconds),
  method: 'POST',
  requestPath: '/api/integrations/whatsapp-hub/messages/send',
  rawRequestBody: JSON.stringify({ to: '94770000000', type: 'text', text: 'hello' }),
  nowSeconds,
};

function signed(input = base) {
  return signRequest({
    secret: input.credentials.secret,
    timestamp: input.timestampText,
    method: input.method,
    requestPath: input.requestPath,
    rawRequestBody: input.rawRequestBody,
  });
}

clearReplayCache();
assert.equal(isWhatsappHubIntegrationPath({ originalUrl: base.requestPath }), true, 'Hub path must bypass only the public IP limiter');
assert.equal(isWhatsappHubIntegrationPath({ originalUrl: '/api/products' }), false, 'Product API must remain subject to its existing limiter');
assert.equal(isWhatsappHubIntegrationPath({ originalUrl: '/api/orders' }), false, 'Order API must remain subject to its existing limiter');
assert.equal(isWhatsappHubIntegrationPath({ originalUrl: '/api/auth/login' }), false, 'Login API must retain its existing limiter');
assert.equal(isWhatsappHubIntegrationPath({ originalUrl: '/api/integrations/whatsapp-hub-evil' }), false, 'Prefix lookalikes must not bypass the limiter');

const valid = verifyWhatsappHubRequest({ ...base, signature: signed() });
assert.deepEqual(valid, { ok: true, status: 200 }, 'Authenticated Hub request must pass');

clearReplayCache();
const invalid = verifyWhatsappHubRequest({ ...base, signature: '0'.repeat(64) });
assert.equal(invalid.status, 401, 'Invalid HMAC must return 401');

clearReplayCache();
const staleInput = { ...base, timestampText: String(nowSeconds - 301) };
const stale = verifyWhatsappHubRequest({ ...staleInput, signature: signed(staleInput) });
assert.equal(stale.status, 401, 'Stale HMAC must return 401');

clearReplayCache();
const signature = signed();
assert.equal(verifyWhatsappHubRequest({ ...base, signature }).status, 200);
assert.equal(verifyWhatsappHubRequest({ ...base, signature }).status, 409, 'Replay must return 409');

clearReplayCache();
const wrongPath = { ...base, requestPath: '/api/integrations/whatsapp-hub/health' };
assert.equal(verifyWhatsappHubRequest({ ...wrongPath, signature: signed() }).status, 401, 'A signature for another path must fail');

console.log('WhatsApp Hub security tests passed.');
