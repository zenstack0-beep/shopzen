'use strict';

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const rows = [];
const inboundModel = {
  async updateOne(filter, update) {
    if (rows.some(row => row.metaMessageId === filter.metaMessageId)) return { matchedCount: 1, upsertedCount: 0 };
    rows.push({ ...update.$setOnInsert, status: 'pending', acknowledgedAt: null });
    return { matchedCount: 0, upsertedCount: 1 };
  },
  countDocuments(filter) {
    return Promise.resolve(rows.filter(row => !filter.status || row.status === filter.status).length);
  },
  find(filter) {
    let limit = 20;
    const query = {
      sort() { return query; },
      limit(value) { limit = value; return query; },
      lean() { return Promise.resolve(rows.filter(row => row.status === filter.status).slice(0, limit).map(row => ({ ...row }))); },
    };
    return query;
  },
  findOneAndUpdate(filter, update) {
    const row = rows.find(item => item.metaMessageId === filter.metaMessageId && item.status === filter.status);
    if (row) Object.assign(row, update.$set);
    return { lean: () => Promise.resolve(row ? { ...row } : null) };
  },
};

const metaAppSecret = 'meta-app-secret-test';
const hubCredentials = { key: 'hub-key-test', secret: 'hub-secret-test' };
function mockModule(relativePath, exports) {
  const filename = require.resolve(relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

mockModule('../models/WhatsAppHubInbound', inboundModel);
mockModule('../services/whatsappCloudService', {
  getWhatsAppCredentials: async () => ({ appSecret: metaAppSecret, webhookVerifyToken: 'verify-test' }),
  sendWhatsAppMessage: async () => ({ messageId: 'outbound-test' }),
});
const socialMediaService = require('../services/socialMediaService');
socialMediaService.getActiveWhatsappHubCredentials = async () => hubCredentials;

const routeFile = fs.readFileSync(path.join(__dirname, '../routes/whatsappHubIntegration.js'), 'utf8');
const serverFile = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
assert.equal((routeFile.match(/router\.post\('\/webhook'/g) || []).length, 1, 'POST webhook must be declared once');
assert.equal((serverFile.match(/require\('\.\/routes\/whatsappHubIntegration'\)/g) || []).length, 1, 'Hub router must be registered once');

const app = express();
app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = buffer.toString('utf8'); } }));
app.use('/api/integrations/whatsapp-hub', require('../routes/whatsappHubIntegration'));

function metaPayload(id, text = 'Hi') {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-test', changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: '94740776790', profile: { name: 'Customer' } }],
      messages: [{ from: '94740776790', id, timestamp: '1786435200', type: 'text', text: { body: text } }],
    } }] }],
  };
}

function hubHeaders(method, requestPath, rawBody, offset) {
  const timestamp = String(Math.floor(Date.now() / 1000) + offset);
  const canonical = `${timestamp}\n${method}\n${requestPath}\n${rawBody}`;
  return {
    'X-ShopZen-Hub-Key': hubCredentials.key,
    'X-ShopZen-Hub-Timestamp': timestamp,
    'X-ShopZen-Hub-Signature': crypto.createHmac('sha256', hubCredentials.secret).update(canonical).digest('hex'),
  };
}

async function run() {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const webhookPath = '/api/integrations/whatsapp-hub/webhook';
  try {
    const firstBody = JSON.stringify(metaPayload('meta-message-1'));
    const firstSignature = crypto.createHmac('sha256', metaAppSecret).update(firstBody).digest('hex');
    let response = await fetch(`${base}${webhookPath}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': `sha256=${firstSignature}` }, body: firstBody });
    assert.equal(response.status, 200, 'Valid Meta webhook must return 200');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'pending');

    response = await fetch(`${base}${webhookPath}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': `sha256=${firstSignature}` }, body: firstBody });
    assert.equal(response.status, 200);
    assert.equal(rows.length, 1, 'Duplicate Meta message ID must remain unique');

    response = await fetch(`${base}${webhookPath}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': `sha256=${'0'.repeat(64)}` }, body: firstBody });
    assert.equal(response.status, 401, 'Invalid Meta signature must return 401');

    const inboundPath = '/api/integrations/whatsapp-hub/messages/inbound';
    response = await fetch(`${base}${inboundPath}`, { headers: hubHeaders('GET', inboundPath, '', 0) });
    assert.equal(response.status, 200);
    let json = await response.json();
    assert.deepEqual(json, { messages: [{ messageId: 'meta-message-1', from: '94740776790', name: 'Customer', type: 'text', text: 'Hi', timestamp: new Date(1786435200 * 1000).toISOString() }] });
    assert.equal(rows[0].status, 'pending', 'GET must not acknowledge a message');

    const secondBody = JSON.stringify(metaPayload('meta-message-2', 'Second'));
    const secondSignature = crypto.createHmac('sha256', metaAppSecret).update(secondBody).digest('hex');
    response = await fetch(`${base}${webhookPath}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': `sha256=${secondSignature}` }, body: secondBody });
    assert.equal(response.status, 200);

    const acknowledgePath = '/api/integrations/whatsapp-hub/messages/inbound/meta-message-1/acknowledge';
    response = await fetch(`${base}${acknowledgePath}`, { method: 'POST', headers: { 'content-type': 'application/json', ...hubHeaders('POST', acknowledgePath, '{}', 1) }, body: '{}' });
    assert.equal(response.status, 200);
    assert.equal(rows.find(row => row.metaMessageId === 'meta-message-1').status, 'acknowledged');
    assert.equal(rows.find(row => row.metaMessageId === 'meta-message-2').status, 'pending', 'Acknowledgement must affect only the specified message');

    response = await fetch(`${base}${inboundPath}`, { headers: hubHeaders('GET', inboundPath, '', 2) });
    json = await response.json();
    assert.deepEqual(json.messages.map(message => message.messageId), ['meta-message-2']);
    console.log('WhatsApp Hub inbound integration tests passed.');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
