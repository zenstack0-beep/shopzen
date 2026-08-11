'use strict';

const GRAPH_VERSION = 'v23.0';
const GRAPH_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function getWhatsAppCredentials() {
  const { getOrCreate, decryptPlatformFields } = require('./socialMediaService');
  const doc = await getOrCreate();
  const raw = doc?.whatsapp?.toObject ? doc.whatsapp.toObject() : (doc?.whatsapp || {});
  const credentials = decryptPlatformFields(raw);
  return {
    connected: Boolean(raw.connected),
    accessToken: credentials.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: credentials.accountId || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    appSecret: credentials.appSecret || '',
    webhookVerifyToken: credentials.accessSecret || '',
    extraConfig: credentials.extraConfig || {},
  };
}

function normalizeRecipient(value) {
  const recipient = String(value || '').replace(/[^0-9]/g, '');
  if (recipient.length < 8 || recipient.length > 15) throw new Error('A valid E.164 WhatsApp recipient is required');
  return recipient;
}

function buildMessageBody(input) {
  const to = normalizeRecipient(input.to);
  const type = String(input.type || 'text').toLowerCase();
  if (type === 'text') {
    const body = String(input.text || '').trim();
    if (!body || body.length > 4096) throw new Error('Text must contain 1–4096 characters');
    return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type, text: { preview_url: Boolean(input.previewUrl), body } };
  }
  if (type === 'template') {
    const name = String(input.template?.name || '').trim();
    const language = String(input.template?.language || '').trim();
    if (!/^[a-z0-9_]{1,512}$/.test(name) || !/^[A-Za-z_]{2,15}$/.test(language)) throw new Error('A valid template name and language are required');
    const components = Array.isArray(input.template?.components) ? input.template.components : [];
    return { messaging_product: 'whatsapp', to, type, template: { name, language: { code: language }, ...(components.length ? { components } : {}) } };
  }
  if (['image', 'document'].includes(type)) {
    const link = String(input.media?.link || '').trim();
    let parsed;
    try { parsed = new URL(link); } catch { throw new Error('A valid HTTPS media URL is required'); }
    if (parsed.protocol !== 'https:') throw new Error('Media URL must use HTTPS');
    const media = { link };
    if (input.media?.caption) media.caption = String(input.media.caption).slice(0, 1024);
    if (type === 'document' && input.media?.filename) media.filename = String(input.media.filename).slice(0, 240);
    return { messaging_product: 'whatsapp', recipient_type: 'individual', to, type, [type]: media };
  }
  throw new Error('Unsupported WhatsApp message type');
}

async function sendWhatsAppMessage(input) {
  const credentials = await getWhatsAppCredentials();
  if (!credentials.accessToken || !credentials.phoneNumberId) throw new Error('ShopZen WhatsApp is not configured');
  const body = buildMessageBody(input);
  const response = await fetch(`${GRAPH_URL}/${credentials.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${credentials.accessToken}` },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error) {
    const error = new Error('WhatsApp message could not be sent');
    error.status = response.status >= 400 && response.status < 500 ? 422 : 502;
    error.metaCode = result.error?.code;
    throw error;
  }
  return { messageId: String(result.messages?.[0]?.id || ''), recipient: body.to };
}

module.exports = { getWhatsAppCredentials, sendWhatsAppMessage };
