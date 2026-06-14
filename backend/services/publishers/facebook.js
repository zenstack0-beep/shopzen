/**
 * services/publishers/facebook.js
 *
 * Posts to a Facebook PAGE via the Graph API.
 *
 * STRATEGY FOR FEED VISIBILITY:
 * - Single image: POST to /{pageId}/feed with `link` = image URL.
 *   Facebook will embed the image inline AND show it in the main feed.
 *   (The attached_media staging approach fails silently when FB can't
 *    fetch the image server-side, causing a text-only fallback.)
 * - Multiple images: Stage each as unpublished photo → /feed with attached_media[].
 * - No image: plain /feed text post with optional link preview.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';

async function publish(creds, payload) {
  const { accessToken, accountId } = creds;
  if (!accessToken) throw new Error('No Page access token configured');
  if (!accountId)   throw new Error('No Page ID configured');

  // ── Pre-publish: verify this token can reach the Page ─────────────────────
  try {
    const checkRes  = await fetch(`${GRAPH}/${accountId}?fields=id,name&access_token=${encodeURIComponent(accessToken)}`);
    const checkJson = await checkRes.json();
    if (checkJson.error) {
      if (checkJson.error.code === 190) {
        throw new Error(
          `Facebook token is invalid or expired. Please reconnect your Facebook Page ` +
          `in Social Media settings using a Page Access Token (not a User token).`
        );
      }
      if (checkJson.error.code === 100) {
        throw new Error(
          `Facebook Page ID "${accountId}" not found. ` +
          `Double-check the numeric Page ID in Social Media settings.`
        );
      }
      throw new Error(`Facebook Page check failed: ${checkJson.error.message} (code ${checkJson.error.code})`);
    }
    console.log(`[Facebook] Page verified: ${checkJson.name} (${checkJson.id})`);
  } catch (err) {
    if (err.message.includes('Facebook')) throw err;
    throw new Error(`Facebook pre-publish check failed: ${err.message}`);
  }

  const images = payload.imageUrls?.length ? payload.imageUrls
               : payload.imageUrl          ? [payload.imageUrl]
               : [];

  if (images.length > 1) {
    // Multi-image: must use the staging + attached_media approach
    return postMultipleImages(accountId, accessToken, payload, images);
  } else if (images.length === 1) {
    // Single image: post directly to /feed — avoids staging failure
    return postSingleImage(accountId, accessToken, payload, images[0]);
  } else {
    return postTextOnly(accountId, accessToken, payload);
  }
}

/**
 * Single image post via /feed directly.
 *
 * WHY NOT use /photos + attached_media for single image:
 * The staging step (POST /{pageId}/photos?published=false) requires Facebook's
 * servers to fetch the image URL. If the URL redirects, requires auth, or is
 * a Cloudinary transformation URL, the staging silently fails (returns no id)
 * and we fall back to text-only. The /feed approach with `link` embeds the
 * image directly from the URL without server-side prefetch.
 *
 * Posts appear in the main "All" feed AND in the Photos tab (this is
 * Facebook's normal behaviour for any post that contains an image).
 */
async function postSingleImage(pageId, accessToken, payload, imageUrl) {
  // Only use the `link` approach for real public HTTPS URLs.
  // Facebook rejects localhost/http URLs with code 1500 "invalid url".
  const isPublicUrl = imageUrl && imageUrl.startsWith('https://') &&
    !imageUrl.includes('localhost') && !imageUrl.includes('127.0.0.1');

  if (isPublicUrl) {
    // Primary attempt: POST to /feed with the image URL as `link`
    // Facebook embeds the image inline AND shows it in the main feed.
    const body = {
      message:      payload.text,
      link:         imageUrl,
      access_token: accessToken,
    };

    const res  = await fetch(`${GRAPH}/${pageId}/feed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json();

    if (!json.error) {
      console.log(`[Facebook] Single image feed post OK: ${json.id}`);
      return { platformPostId: json.id || '' };
    }

    console.warn(`[Facebook] /feed with link failed (${json.error.message}), trying /photos staging…`);
  } else {
    console.warn(`[Facebook] Image URL is not a public HTTPS URL, skipping link approach: ${imageUrl}`);
  }

  // Fallback: try the staging approach
  const stageRes  = await fetch(`${GRAPH}/${pageId}/photos`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url: imageUrl, access_token: accessToken, published: false }),
  });
  const stageJson = await stageRes.json();

  if (stageJson.id) {
    // Staging worked — post to /feed with attached_media
    const feedRes  = await fetch(`${GRAPH}/${pageId}/feed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message:        payload.text,
        attached_media: [{ media_fbid: stageJson.id }],
        access_token:   accessToken,
      }),
    });
    const feedJson = await feedRes.json();
    if (!feedJson.error) {
      console.log(`[Facebook] Single image staged+feed post OK: ${feedJson.id}`);
      return { platformPostId: feedJson.id || '' };
    }
    console.warn(`[Facebook] staged /feed failed: ${feedJson.error.message}`);
  } else {
    console.warn(`[Facebook] Photo staging failed: ${stageJson.error?.message || 'no id returned'}`);
  }

  // Last resort: text-only with URL in message so it at least posts something
  console.warn('[Facebook] Falling back to text-only post');
  return postTextOnly(pageId, accessToken, { ...payload, text: `${payload.text}\n\n${imageUrl}` });
}

/**
 * Multiple images: stage each as unpublished, then /feed with attached_media[].
 */
async function postMultipleImages(pageId, accessToken, payload, images) {
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
        console.log(`[Facebook] Staged photo: ${json.id}`);
      } else {
        console.warn('[Facebook] Failed to stage photo:', url, json.error?.message);
      }
    } catch (err) {
      console.warn('[Facebook] Photo upload error:', err.message);
    }
  }

  if (!photoIds.length) {
    console.warn('[Facebook] No photos staged — falling back to single image feed post');
    return postSingleImage(pageId, accessToken, payload, images[0]);
  }

  if (photoIds.length === 1) {
    // Only one staged — use single image path for reliability
    const feedRes  = await fetch(`${GRAPH}/${pageId}/feed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        message:        payload.text,
        attached_media: [{ media_fbid: photoIds[0] }],
        access_token:   accessToken,
      }),
    });
    const feedJson = await feedRes.json();
    if (!feedJson.error) return { platformPostId: feedJson.id || '' };
    // Fall back to link post if attached_media fails
    return postSingleImage(pageId, accessToken, payload, images[0]);
  }

  // Multiple staged photos → carousel via /feed
  const res  = await fetch(`${GRAPH}/${pageId}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      message:        payload.text,
      attached_media: photoIds.map(id => ({ media_fbid: id })),
      access_token:   accessToken,
    }),
  });
  const json = await res.json();

  if (!json.error) {
    console.log(`[Facebook] Multi-image feed post OK: ${json.id}`);
    return { platformPostId: json.id || '' };
  }

  console.warn(`[Facebook] Multi-image feed failed: ${json.error.message} — falling back to single`);
  return postSingleImage(pageId, accessToken, payload, images[0]);
}

async function postTextOnly(pageId, accessToken, payload) {
  const body = {
    message:      payload.text,
    access_token: accessToken,
  };

  // Only add link preview for real public URLs — Facebook rejects localhost/private URLs
  // with code 1500 "invalid url". Filter out anything that isn't a public https URL.
  const urlMatch = payload.text && payload.text.match(/https:\/\/[^\s]+/);
  if (urlMatch && !urlMatch[0].includes('localhost') && !urlMatch[0].includes('127.0.0.1')) {
    body.link = urlMatch[0];
  }

  const res  = await fetch(`${GRAPH}/${pageId}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const json = await res.json();

  if (json.error) {
    const err  = new Error(`Facebook post failed: ${json.error.message} (code ${json.error.code})`);
    err.code   = String(json.error.code || 'FB_ERROR');
    throw err;
  }

  return { platformPostId: json.id || '' };
}

module.exports = { publish };