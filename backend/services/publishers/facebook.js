/**
 * services/publishers/facebook.js
 *
 * Posts to a Facebook PAGE (not personal profile).
 * Requires a Page Access Token with pages_manage_posts permission.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

async function publish(creds, payload) {
  const { accessToken, accountId } = creds;
  if (!accessToken) throw new Error('No Page access token configured');
  if (!accountId)   throw new Error('No Page ID configured');

  let result;

  if (payload.imageUrl) {
    // Post with photo — use /photos endpoint with published:true
    result = await postWithPhoto(accountId, accessToken, payload);
  } else {
    // Text-only post — use /feed endpoint
    result = await postTextOnly(accountId, accessToken, payload);
  }

  return result;
}

async function postWithPhoto(pageId, accessToken, payload) {
  const body = {
    url:          payload.imageUrl,
    caption:      payload.text,
    access_token: accessToken,
    published:    true,
  };

  const res  = await fetch(`${GRAPH}/${pageId}/photos`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json();

  if (json.error) {
    // If photo endpoint fails, fall back to text-only feed post
    if (json.error.code === 200 || json.error.type === 'OAuthException') {
      console.warn('[Facebook] Photo post failed, trying text-only feed post:', json.error.message);
      return postTextOnly(pageId, accessToken, payload);
    }
    const err  = new Error(json.error.message || 'Facebook API error');
    err.code   = String(json.error.code || 'FB_ERROR');
    throw err;
  }

  // /photos returns { id, post_id } — post_id is the feed post ID
  return { platformPostId: json.post_id || json.id || '' };
}

async function postTextOnly(pageId, accessToken, payload) {
  const body = {
    message:      payload.text,
    access_token: accessToken,
  };

  // Add link if present in text (Facebook will generate a preview)
  const urlMatch = payload.text && payload.text.match(/https?:\/\/[^\s]+/);
  if (urlMatch) {
    body.link = urlMatch[0];
  }

  const res  = await fetch(`${GRAPH}/${pageId}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json();

  if (json.error) {
    const err  = new Error(json.error.message || 'Facebook API error');
    err.code   = String(json.error.code || 'FB_ERROR');
    throw err;
  }

  return { platformPostId: json.id || '' };
}

module.exports = { publish };