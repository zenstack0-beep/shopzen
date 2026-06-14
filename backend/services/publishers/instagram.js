/**
 * services/publishers/instagram.js
 *
 * Two-step publish for single image: create container → publish container.
 * Carousel publish for multiple images: create item containers → carousel container → publish.
 * An image URL is mandatory — Instagram has no text-only post API.
 *
 * FIX: Better error messages to diagnose accountId mismatches.
 *      The accountId MUST be the Instagram Business Account ID (numeric),
 *      NOT the Facebook Page ID. Get it from:
 *      GET /{facebook-page-id}?fields=instagram_business_account&access_token=...
 *
 * FIX: Added retry logic — if container creation returns FINISHED status,
 *      proceed to publish without re-creating the container.
 *
 * FIX: Improved error surfacing so 500 errors include the actual API message.
 */

const GRAPH = 'https://graph.facebook.com/v19.0';

async function publish(creds, payload) {
  const { accessToken, accountId } = creds;
  if (!accessToken) throw new Error('No access token configured');
  if (!accountId)   throw new Error('No Instagram Business Account ID configured');

  const images = payload.imageUrls?.length ? payload.imageUrls
               : payload.imageUrl          ? [payload.imageUrl]
               : [];

  if (!images.length) throw new Error('Instagram requires at least one image URL');

  // Verify we can reach the account before attempting publish
  // This gives a clearer error if accountId is wrong (e.g. Facebook Page ID used instead)
  try {
    const checkRes  = await fetch(`${GRAPH}/${accountId}?fields=id,username,name&access_token=${encodeURIComponent(accessToken)}`);
    const checkJson = await checkRes.json();
    if (checkJson.error) {
      // Code 100 = invalid ID — most common mistake is using FB Page ID instead of IG Business Account ID
      if (checkJson.error.code === 100) {
        throw new Error(
          `Invalid Instagram Business Account ID "${accountId}". ` +
          `You may have entered the Facebook Page ID instead. ` +
          `To get the correct ID, call: GET /${accountId}?fields=instagram_business_account&access_token=YOUR_TOKEN`
        );
      }
      throw new Error(`Instagram account check failed: ${checkJson.error.message} (code ${checkJson.error.code})`);
    }
  } catch (err) {
    // Re-throw with context
    throw new Error(`Instagram pre-publish check failed: ${err.message}`);
  }

  if (images.length > 1) {
    return publishCarousel(accountId, accessToken, payload, images);
  } else {
    return publishSingle(accountId, accessToken, payload, images[0]);
  }
}

/**
 * Single-image post: create container → publish.
 */
async function publishSingle(accountId, accessToken, payload, imageUrl) {
  // Step 1 — create media container
  const containerRes = await fetch(`${GRAPH}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url:    imageUrl,
      caption:      payload.text,
      access_token: accessToken,
    }),
  });
  const c = await containerRes.json();

  if (c.error) {
    const e = new Error(`Instagram container creation failed: ${c.error.message} (code ${c.error.code})`);
    e.code = String(c.error.code);
    throw e;
  }
  if (!c.id) {
    throw new Error('Instagram container creation returned no ID');
  }

  // Step 2 — wait briefly for container to be ready, then publish
  await waitForContainer(accountId, accessToken, c.id);

  const publishRes = await fetch(`${GRAPH}/${accountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id:  c.id,
      access_token: accessToken,
    }),
  });
  const p = await publishRes.json();

  if (p.error) {
    const e = new Error(`Instagram publish failed: ${p.error.message} (code ${p.error.code})`);
    e.code = String(p.error.code);
    throw e;
  }

  return { platformPostId: p.id || '' };
}

/**
 * Wait up to ~10 seconds for the container status to become FINISHED.
 * Instagram processes images asynchronously; publishing too early returns an error.
 */
async function waitForContainer(accountId, accessToken, containerId, maxAttempts = 5) {
  for (let i = 0; i < maxAttempts; i++) {
    // First attempt: skip wait (often already ready)
    if (i > 0) {
      await new Promise(r => setTimeout(r, 2000));
    }
    try {
      const res  = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`);
      const json = await res.json();
      if (json.status_code === 'FINISHED') return;
      if (json.status_code === 'ERROR') {
        throw new Error(`Instagram container processing failed with status ERROR`);
      }
      // IN_PROGRESS or no status yet — keep waiting
    } catch (err) {
      if (err.message.includes('ERROR')) throw err;
      // Network error during status check — keep trying
    }
  }
  // Proceed anyway after max waits — let the publish attempt surface any error
}

/**
 * Carousel post (up to 10 images).
 * Step 1: Create a child media container for each image (is_carousel_item: true).
 * Step 2: Create a carousel container referencing all child IDs (caption goes here).
 * Step 3: Publish the carousel container.
 */
async function publishCarousel(accountId, accessToken, payload, images) {
  // Instagram carousel supports max 10 items
  const urls = images.slice(0, 10);

  // Step 1 — create child containers
  const childIds = [];
  for (const url of urls) {
    const res = await fetch(`${GRAPH}/${accountId}/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url:        url,
        is_carousel_item: true,
        access_token:     accessToken,
      }),
    });
    const json = await res.json();

    if (json.error) {
      console.warn('[Instagram] Skipping carousel child (error):', json.error.message, url);
      continue;
    }
    if (json.id) childIds.push(json.id);
  }

  // Need at least 2 children for a carousel; fall back to single if fewer staged
  if (childIds.length < 2) {
    console.warn('[Instagram] Not enough carousel children staged, falling back to single image.');
    return publishSingle(accountId, accessToken, payload, urls[0]);
  }

  // Step 2 — create carousel container
  const carouselRes = await fetch(`${GRAPH}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type:   'CAROUSEL',
      caption:      payload.text,
      children:     childIds.join(','),
      access_token: accessToken,
    }),
  });
  const carousel = await carouselRes.json();

  if (carousel.error) {
    const e = new Error(`Instagram carousel container failed: ${carousel.error.message} (code ${carousel.error.code})`);
    e.code = String(carousel.error.code);
    throw e;
  }

  // Wait for carousel container to be ready
  await waitForContainer(accountId, accessToken, carousel.id);

  // Step 3 — publish
  const pubRes = await fetch(`${GRAPH}/${accountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creation_id:  carousel.id,
      access_token: accessToken,
    }),
  });
  const pub = await pubRes.json();

  if (pub.error) {
    const e = new Error(`Instagram carousel publish failed: ${pub.error.message} (code ${pub.error.code})`);
    e.code = String(pub.error.code);
    throw e;
  }

  return { platformPostId: pub.id || '' };
}

module.exports = { publish };