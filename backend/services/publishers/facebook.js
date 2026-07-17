/**
 * services/publishers/facebook.js
 *
 * Posts to a Facebook PAGE via the Graph API.
 *
 * ── HOW FACEBOOK FEED VISIBILITY WORKS ────────────────────────────────────────
 *
 * There are 3 ways to post with an image to a Facebook Page:
 *
 *   A) POST /{pageId}/feed  { link: imageUrl }
 *      → Facebook creates a "link card" preview using the image URL.
 *      → PROBLEM: only appears in Photos tab, NOT in the main All Posts feed.
 *        This was the bug causing posts to be invisible to followers.
 *
 *   B) POST /{pageId}/photos  { url, published: true }
 *      → Creates a native photo post visible in Photos tab.
 *      → PROBLEM: no way to attach a separate product link preview below it.
 *
 *   C) POST /{pageId}/photos  { url, published: false }  (stage)
 *      then POST /{pageId}/feed  { attached_media: [{ media_fbid }], link: productUrl }
 *      → Creates a FEED POST with the image displayed inline + a clickable
 *        product link preview card below it.
 *      → ✅ Appears in ALL Posts feed, Photos tab, and followers' News Feed.
 *      → ✅ Product URL is a real clickable link, not plain text.
 *
 * STRATEGY:
 *   Single image  → publish a native Page photo with `published:true` and
 *                    `no_story:false`, using the caption for text + product URL.
 *                    This creates the Page feed story and Photos entry together.
 *   Multi-image   → stage all images + /feed with attached_media[], product
 *                    URL appended as plain text to `message` (NOT `link`)
 *   No image      → plain /feed with product URL appended to `message`
 *
 * IMPORTANT: Do NOT set `feedBody.link` when `attached_media` is present.
 * Facebook mishandles that combination — the post ends up visible only in
 * the Photos tab and not in "All Posts". Appending the URL to `message`
 * instead (Facebook auto-links plain URLs in text) fixes this.
 *
 * The productUrl comes from payload.productUrl (set by postComposer.js).
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

  // Native CTA buttons are available on Page link posts, not /photos posts.
  // Keep the existing native-photo strategy when no CTA was selected.
  if (payload.ctaType==='shop_now'||payload.ctaType==='whatsapp') {
    return postWithCallToAction(accountId,accessToken,payload);
  }

  const images = payload.imageUrls?.length ? payload.imageUrls
               : payload.imageUrl          ? [payload.imageUrl]
               : [];

  if (images.length > 1) {
    return postMultipleImages(accountId, accessToken, payload, images);
  } else if (images.length === 1) {
    return postSingleImage(accountId, accessToken, payload, images[0]);
  } else {
    return postTextOnly(accountId, accessToken, payload);
  }
}

function buildCallToAction(payload){
  const ctaUrl=String(payload.ctaUrl||'');
  if(!/^https:\/\//i.test(ctaUrl)||/localhost|127\.0\.0\.1/i.test(ctaUrl))throw new Error('Facebook CTA requires a public HTTPS destination URL');
  if(payload.ctaType==='shop_now')return {type:'SHOP_NOW',value:{link:ctaUrl}};
  if(payload.ctaType==='whatsapp'){
    const whatsappNumber=ctaUrl.match(/wa\.me\/(\d+)/i)?.[1];
    if(!whatsappNumber)throw new Error('WhatsApp CTA requires a valid wa.me destination');
    return {type:'WHATSAPP_MESSAGE',value:{link:ctaUrl,app_destination:'WHATSAPP',whatsapp_number:whatsappNumber}};
  }
  return null;
}

async function postWithCallToAction(pageId,accessToken,payload){
  const productUrl=getProductUrl(payload);
  if(!productUrl)throw new Error('Facebook CTA post requires a public product URL');
  const callToAction=buildCallToAction(payload);
  const body={message:payload.text||'',link:productUrl,call_to_action:JSON.stringify(callToAction),published:true,access_token:accessToken};
  const response=await fetch(`${GRAPH}/${pageId}/feed`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const json=await response.json();
  if(json.error){
    const label=payload.ctaType==='whatsapp'?'WhatsApp':'Shop Now';
    const hint=payload.ctaType==='whatsapp'?' Ensure the Facebook Page is linked to the ShopZen WhatsApp Business account.':'';
    const error=new Error(`Facebook ${label} button post failed: ${json.error.message} (code ${json.error.code}).${hint}`);
    error.code=String(json.error.code||'FB_CTA_ERROR');throw error;
  }
  console.log(`[Facebook] ✅ Link post with ${callToAction.type} CTA: ${json.id}`);
  return {platformPostId:json.id||''};
}

/**
 * Stage the image as an unpublished photo, then publish a /feed post that has:
 *   - The image visible inline (via attached_media)
 *   - A clickable product link preview card below (via link param)
 *
 * This is the only approach that makes posts appear in ALL feed sections AND
 * renders the product URL as a real clickable link rather than plain text.
 *
 * Fallback chain:
 *   1. Stage → /feed with attached_media + link  ← correct (primary)
 *   2. /feed with link only (image won't show but link works)
 *   3. /feed text-only (last resort)
 */
async function postSingleImage(pageId, accessToken, payload, imageUrl) {
  const isPublicUrl = imageUrl &&
    imageUrl.startsWith('https://') &&
    !imageUrl.includes('localhost') &&
    !imageUrl.includes('127.0.0.1');

  // The product page URL — used as `link` param for a clickable link preview
  const productUrl = getProductUrl(payload);

  if (isPublicUrl) {
    // A directly published Page photo is the canonical single-image Page post.
    // no_story:false is explicit so Facebook cannot retain only the photo object
    // without also creating its public Page feed story.
    let caption = payload.text || '';
    if (productUrl && !caption.includes(productUrl)) {
      caption = caption ? `${caption}\n\n${productUrl}` : productUrl;
    }
    const photoRes = await fetch(`${GRAPH}/${pageId}/photos`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        url:          imageUrl,
        caption,
        published:    true,
        no_story:     false,
        access_token: accessToken,
      }),
    });
    const photoJson = await photoRes.json();
    if (!photoJson.error && (photoJson.post_id || photoJson.id)) {
      const postId = photoJson.post_id || photoJson.id;
      console.log(`[Facebook] ✅ Native published Page photo story: ${postId}`);
      return { platformPostId: postId, platformPhotoId: photoJson.id || '' };
    }
    console.warn(`[Facebook] Native Page photo story failed: ${photoJson.error?.message || 'no post id returned'} — falling back to feed post`);
  }

  // Fallback: text post with product URL as link (image won't show inline)
  console.warn('[Facebook] Falling back to feed post with product link only (no image)');
  return postTextOnly(pageId, accessToken, payload);
}

/**
 * Stage all images, then post a feed carousel with all images + product link.
 */
async function postMultipleImages(pageId, accessToken, payload, images) {
  const productUrl = getProductUrl(payload);
  const photoIds   = [];

  let message = payload.text || '';
  if (productUrl && !message.includes(productUrl)) {
    message = message ? `${message}\n\n${productUrl}` : productUrl;
  }

  for (const url of images) {
    if (!url.startsWith('https://')) continue;
    try {
      const res  = await fetch(`${GRAPH}/${pageId}/photos`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ url, access_token: accessToken, published: false }),
      });
      const json = await res.json();
      if (json.id) {
        photoIds.push(json.id);
        console.log(`[Facebook] Staged photo ${photoIds.length}: ${json.id}`);
      } else {
        console.warn('[Facebook] Failed to stage photo:', url, json.error?.message);
      }
    } catch (err) {
      console.warn('[Facebook] Photo staging error:', err.message);
    }
  }

  if (!photoIds.length) {
    console.warn('[Facebook] No photos staged — falling back to single image post');
    return postSingleImage(pageId, accessToken, payload, images[0]);
  }

  // Single staged photo → feed + attached_media, URL appended to message (no `link` param)
  if (photoIds.length === 1) {
    const feedBody = {
      message:        message,
      attached_media: [{ media_fbid: photoIds[0] }],
      published:      true,
      access_token:   accessToken,
    };

    const res  = await fetch(`${GRAPH}/${pageId}/feed`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(feedBody),
    });
    const json = await res.json();
    if (!json.error) {
      console.log(`[Facebook] ✅ Feed post (1 image): ${json.id}`);
      return { platformPostId: json.id || '' };
    }
    return postSingleImage(pageId, accessToken, payload, images[0]);
  }

  // Multiple staged photos → carousel feed post, URL appended to message (no `link` param)
  const feedBody = {
    message:        message,
    attached_media: photoIds.map(id => ({ media_fbid: id })),
    published:      true,
    access_token:   accessToken,
  };

  const res  = await fetch(`${GRAPH}/${pageId}/feed`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(feedBody),
  });
  const json = await res.json();

  if (!json.error) {
    console.log(`[Facebook] ✅ Carousel feed post (${photoIds.length} images): ${json.id}`);
    return { platformPostId: json.id || '' };
  }

  console.warn(`[Facebook] Multi-image feed failed (${json.error.message}) — falling back to single image`);
  return postSingleImage(pageId, accessToken, payload, images[0]);
}

/**
 * Text-only post.  Uses productUrl as the `link` param so Facebook renders
 * a proper clickable link preview card rather than plain text.
 */
async function postTextOnly(pageId, accessToken, payload) {
  const productUrl = getProductUrl(payload);

  const body = {
    message:      payload.text,
    access_token: accessToken,
  };

  if (productUrl) {
    body.link = productUrl;
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

  console.log(`[Facebook] ✅ Text post with link: ${json.id}`);
  return { platformPostId: json.id || '' };
}

/**
 * Extract the product/offer page URL from the payload.
 * Falls back to parsing the text if productUrl field isn't set
 * (for backward compat with any older code paths).
 * Only returns public HTTPS URLs — never localhost.
 */
function getProductUrl(payload) {
  // Primary: dedicated productUrl field from postComposer
  if (payload.productUrl &&
      payload.productUrl.startsWith('https://') &&
      !payload.productUrl.includes('localhost')) {
    return payload.productUrl;
  }
  // Fallback: extract first https URL from post text
  const match = payload.text && payload.text.match(/https:\/\/[^\s]+/);
  if (match && !match[0].includes('localhost') && !match[0].includes('127.0.0.1')) {
    return match[0];
  }
  return null;
}

module.exports = { publish,buildCallToAction };
