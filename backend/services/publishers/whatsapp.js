/**
 * services/publishers/whatsapp.js
 * Sends a WhatsApp Business template message via Meta Cloud API.
 * Outbound messages must use a pre-approved template.
 * Set extraConfig.recipientNumber + extraConfig.templateName when connecting.
 */
const GRAPH = 'https://graph.facebook.com/v19.0';

async function publish(creds, payload) {
  const { accessToken, accountId, extraConfig = {} } = creds;
  if (!accessToken) throw new Error('No system access token configured');
  if (!accountId)   throw new Error('No Phone Number ID configured');

  const recipient = extraConfig.recipientNumber || extraConfig.testNumber;
  if (!recipient) throw new Error('No recipient number in extraConfig.recipientNumber');

  const body = {
    messaging_product: 'whatsapp',
    to:       recipient,
    type:     'template',
    template: {
      name:     extraConfig.templateName || 'hello_world',
      language: { code: extraConfig.languageCode || 'en_US' },
      components: payload.text
        ? [{ type: 'body', parameters: [{ type: 'text', text: payload.text.slice(0, 1024) }] }]
        : [],
    },
  };

  const json = await fetch(`${GRAPH}/${accountId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  }).then(r => r.json());

  if (json.error) { const e = new Error(json.error.message); e.code = String(json.error.code); throw e; }
  return { platformPostId: json.messages?.[0]?.id || '' };
}

module.exports = { publish };