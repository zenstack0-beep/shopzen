/**
 * services/publishers/facebook.js
 *
 * Posts to a Facebook PAGE (not personal profile).
 * Requires a Page Access Token with pages_manage_posts permission.
 *
 * FIX: Multi-image support — if imageUrls has >1 image, posts as a
 *      multi-photo carousel using /photos?published=false then /feed.
 *      Falls back to single photo or text-only gracefully.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

async function publish(creds, payload) {
  const { accessToken, accountId } = creds;
  if (!accessToken) throw new Error('No Page access token configured');
  if (!accountId)   throw new Error('No Page ID configured');

  const images = payload.imageUrls?.length ? payload.imageUrls
               : payload.imageUrl          ? [payload.imageUrl]
               : [];

  if (images.length > 1) {
    return postCarousel(accountId, accessToken, payload, images);
  } else if (images.length === 1) {
    return postWithPhoto(accountId, accessToken, { ...payload, imageUrl: images[0] });
  } else {
    return postTextOnly(accountId, accessToken, payload);
  }
}

/**
 * Multi-photo carousel post.
 * 1. Upload each photo as unpublished (attached_media).
 * 2. Create a single /feed post referencing all photo IDs.
 */
async function postCarousel(pageId, accessToken, payload, images) {
  // Upload photos as unpublished stagers
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

  // If no photos staged, fall back to text-only
  if (!photoIds.length) {
    return postTextOnly(pageId, accessToken, payload);
  }

  // If only 1 staged successfully, post as single photo
  if (photoIds.length === 1) {
    const body = {
      message:      payload.text,
      attached_media: [{ media_fbid: photoIds[0] }],
      access_token: accessToken,
    };
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

  // Multiple photos → carousel via attached_media[]
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
    // Fallback: post first photo only
    console.warn('[Facebook] Carousel post failed, falling back to single photo:', json.error.message);
    return postWithPhoto(pageId, accessToken, { ...payload, imageUrl: payload.imageUrls[0] });
  }

  return { platformPostId: json.id || '' };
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
    if (json.error.code === 200 || json.error.type === 'OAuthException') {
      console.warn('[Facebook] Photo post failed, trying text-only feed post:', json.error.message);
      return postTextOnly(pageId, accessToken, payload);
    }
    const err  = new Error(json.error.message || 'Facebook API error');
    err.code   = String(json.error.code || 'FB_ERROR');
    throw err;
  }

  return { platformPostId: json.post_id || json.id || '' };
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