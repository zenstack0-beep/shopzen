/**
 * services/publishers/telegram.js
 * Sends a message or photo caption to a Telegram channel / group.
 * accessToken = bot token, accountId = @channel or numeric chat id.
 */
async function publish(creds, payload) {
    const { accessToken, accountId } = creds;
    if (!accessToken) throw new Error('No bot token configured');
    if (!accountId)   throw new Error('No channel / chat ID configured');
  
    const BASE   = `https://api.telegram.org/bot${accessToken}`;
    const method = payload.imageUrl ? 'sendPhoto' : 'sendMessage';
    const body   = payload.imageUrl
      ? { chat_id: accountId, photo: payload.imageUrl, caption: payload.text, parse_mode: 'HTML' }
      : { chat_id: accountId, text: payload.text, parse_mode: 'HTML' };
  
    const json = await fetch(`${BASE}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json());
  
    if (!json.ok) { const e = new Error(json.description || 'Telegram API error'); e.code = String(json.error_code || 'TG_ERROR'); throw e; }
    return { platformPostId: String(json.result?.message_id || '') };
  }
  
  module.exports = { publish };