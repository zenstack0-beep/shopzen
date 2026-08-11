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
  const suppliedButtons = Array.isArray(input.buttons) ? input.buttons : [];
  if (suppliedButtons.length || ['button', 'buttons', 'interactive'].includes(type)) {
    const text = String(input.text || '').trim();
    if (!text || text.length > 1024) throw new Error('Button message text must contain 1–1024 characters');
    if (suppliedButtons.length < 1 || suppliedButtons.length > 3) throw new Error('Button messages require 1–3 buttons');
    const buttons = suppliedButtons.map((button, index) => {
      const id = String(button?.id || button?.value || `button_${index + 1}`).trim();
      const title = String(button?.title || button?.text || button?.label || '').trim();
      if (!id || id.length > 256 || !title || title.length > 20) {
        throw new Error('Each button requires an ID and a title of no more than 20 characters');
      }
      return { type: 'reply', reply: { id, title } };
    });
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: { type: 'button', body: { text }, action: { buttons } },
    };
  }
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
    error.internalMeta = {
      httpStatus: response.status,
      code: result.error?.code || null,
      subcode: result.error?.error_subcode || null,
      type: String(result.error?.type || '').slice(0, 100),
      message: String(result.error?.message || 'Unknown Meta API error').slice(0, 500),
    };
    throw error;
  }
  const messageId = String(result.messages?.[0]?.id || '');
  if (!messageId) {
    const error = new Error('WhatsApp message could not be sent');
    error.status = 502;
    error.internalMeta = { httpStatus: response.status, message: 'Meta returned no message ID' };
    throw error;
  }
  return { messageId };
}

module.exports = { getWhatsAppCredentials, sendWhatsAppMessage, buildMessageBody };
