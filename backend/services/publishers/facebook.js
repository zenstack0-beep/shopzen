/**
 * services/publishers/facebook.js
 *
 * Posts to a Facebook PAGE (not personal profile).
 * Requires a Page Access Token with pages_manage_posts permission.
 *
 * FIX: All image posts now go through /feed with attached_media so they
 *      appear in the main "All Posts" feed, not just the Photos tab.
 *      Single image: upload as unpublished photo → post via /feed with attached_media.
 *      Multi-image:  upload all as unpublished photos → post via /feed with attached_media[].
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

async function publish(creds, payload) {
  const { accessToken, accountId } = creds;
  if (!accessToken) throw new Error('No Page access token configured');
  if (!accountId)   throw new Error('No Page ID configured');

  const images = payload.imageUrls?.length ? payload.imageUrls
               : payload.imageUrl          ? [payload.imageUrl]
               : [];

  if (images.length > 0) {
    return postWithImages(accountId, accessToken, payload, images);
  } else {
    return postTextOnly(accountId, accessToken, payload);
  }
}

/**
 * Upload one or more images as unpublished photos, then publish a
 * single /feed post referencing all of them via attached_media[].
 * This makes the post appear in the "All Posts" feed (not just Photos tab).
 */
async function postWithImages(pageId, accessToken, payload, images) {
  // Upload each image as an unpublished photo (staged only)
  const photoIds = [];
  for (const url of images) {
    try {
      const res  = await fetch(`${GRAPH}/${pageId}/photos`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url, access_token: accessToken, published: false }),
      });
      const json = await res.json();
      if (json.id) {
        photoIds.push(json.id);
      } else {
        console.warn('[Facebook] Failed to stage photo:', url, json.error?.message);
      }
    } catch (err) {
      console.warn('[Facebook] Photo upload error:', err.message);
    }
  }

  // If no photos staged successfully, fall back to text-only
  if (!photoIds.length) {
    console.warn('[Facebook] No photos staged, falling back to text-only post');
    return postTextOnly(pageId, accessToken, payload);
  }

  // Post via /feed with attached_media — this appears in "All Posts" feed
  const body = {
    message:        payload.text,
    attached_media: photoIds.map(id => ({ media_fbid: id })),
    access_token:   accessToken,
  };

  const res  = await fetch(`${GRAPH}/${pageId}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json();

  if (json.error) {
    console.warn('[Facebook] Feed post with images failed, trying text-only:', json.error.message);
    // Last-resort fallback to text-only
    return postTextOnly(pageId, accessToken, payload);
  }

  return { platformPostId: json.id || '' };
}

async function postTextOnly(pageId, accessToken, payload) {
  const body = {
    message:      payload.text,
    access_token: accessToken,
  };

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