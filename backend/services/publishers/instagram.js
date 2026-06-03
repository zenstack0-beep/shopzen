/**
 * services/publishers/instagram.js
 * Two-step publish: create container → publish container.
 * An image URL is mandatory — Instagram has no text-only post API.
 */
const GRAPH = 'https://graph.facebook.com/v19.0';

async function publish(creds, payload) {
  const { accessToken, accountId } = creds;
  if (!accessToken)      throw new Error('No access token configured');
  if (!accountId)        throw new Error('No Instagram Business Account ID configured');
  if (!payload.imageUrl) throw new Error('Instagram requires an image URL');

  // Step 1 — container
  const c = await fetch(`${GRAPH}/${accountId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: payload.imageUrl, caption: payload.text, access_token: accessToken }),
  }).then(r => r.json());
  if (c.error) { const e = new Error(c.error.message); e.code = String(c.error.code); throw e; }

  // Step 2 — publish
  const p = await fetch(`${GRAPH}/${accountId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: c.id, access_token: accessToken }),
  }).then(r => r.json());
  if (p.error) { const e = new Error(p.error.message); e.code = String(p.error.code); throw e; }

  return { platformPostId: p.id || '' };
}

module.exports = { publish };