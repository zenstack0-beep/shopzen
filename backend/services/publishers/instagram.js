/**
 * services/publishers/instagram.js
 *
 * Two-step publish for single image: create container → publish container.
 * Carousel publish for multiple images: create item containers → carousel container → publish.
 * An image URL is mandatory — Instagram has no text-only post API.
 *
 * FIX: Multi-image support via Carousel API when imageUrls.length > 1.
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

  if (images.length > 1) {
    return publishCarousel(accountId, accessToken, payload, images);
  } else {
    return publishSingle(accountId, accessToken, payload, images[0]);
  }
}

/**
 * Single-image post (original flow, unchanged).
 */
async function publishSingle(accountId, accessToken, payload, imageUrl) {
  // Step 1 — container
  const c = await fetch(`${GRAPH}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, caption: payload.text, access_token: accessToken }),
  }).then(r => r.json());

  if (c.error) {
    const e = new Error(c.error.message);
    e.code = String(c.error.code);
    throw e;
  }

  // Step 2 — publish
  const p = await fetch(`${GRAPH}/${accountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: c.id, access_token: accessToken }),
  }).then(r => r.json());

  if (p.error) {
    const e = new Error(p.error.message);
    e.code = String(p.error.code);
    throw e;
  }

  return { platformPostId: p.id || '' };
}

/**
 * Carousel post (up to 10 images).
 * Step 1: Create a child media container for each image (no caption, is_carousel_item: true).
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
    }).then(r => r.json());

    if (res.error) {
      console.warn('[Instagram] Skipping carousel child (error):', res.error.message, url);
      continue;
    }
    if (res.id) childIds.push(res.id);
  }

  // Need at least 2 children for a carousel; fall back to single if fewer staged
  if (childIds.length < 2) {
    console.warn('[Instagram] Not enough carousel children staged, falling back to single image.');
    return publishSingle(accountId, accessToken, payload, urls[0]);
  }

  // Step 2 — create carousel container
  const carousel = await fetch(`${GRAPH}/${accountId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type:    'CAROUSEL',
      caption:       payload.text,
      children:      childIds.join(','),
      access_token:  accessToken,
    }),
  }).then(r => r.json());

  if (carousel.error) {
    const e = new Error(carousel.error.message);
    e.code = String(carousel.error.code);
    throw e;
  }

  // Step 3 — publish
  const pub = await fetch(`${GRAPH}/${accountId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: carousel.id, access_token: accessToken }),
  }).then(r => r.json());

  if (pub.error) {
    const e = new Error(pub.error.message);
    e.code = String(pub.error.code);
    throw e;
  }

  return { platformPostId: pub.id || '' };
}

module.exports = { publish };