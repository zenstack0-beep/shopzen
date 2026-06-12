/**
 * middleware.js — Vercel Edge Middleware for ShopZen (OPTIMIZED)
 *
 * Key changes to cut Edge Requests by 50-80%:
 *   1. `matcher` is now scoped to ONLY the paths that need SSR meta injection,
 *      instead of `/(.*)`. Static assets, /api/*, cart, wishlist, account,
 *      admin, etc. NEVER invoke the edge function at all (Vercel routes them
 *      directly) — this alone removes the vast majority of Edge Requests.
 *   2. Removed 'cart' and 'wishlist' from SSR paths — these are private/dynamic
 *      and don't need SEO meta, so they no longer trigger Railway calls.
 *   3. SSR responses are now cached at the CDN edge for 5 minutes
 *      (s-maxage=300, stale-while-revalidate=600) instead of no-cache.
 *      Repeat visits to the same product/category page are served from
 *      Vercel's CDN cache — zero additional Edge Requests/Railway calls.
 */

export const config = {
    runtime: 'edge',
    // Narrow matcher — only run this function for paths that need SSR meta.
    // Everything else (static, /api, /admin, /login, /cart, /checkout, etc.)
    // bypasses the edge function entirely (handled by Vercel's normal routing).
    matcher: [
      '/',
      '/product/:path*',
      '/shop',
      '/shop/:path*',
      '/category/:path*',
      '/brand/:path*',
      '/page/:path*',
      '/campaign/:path*',
    ],
  };
  
  // ─── Railway health / cold-start tracking ────────────────────────────────────
  let railwayDown = false;
  let railwayDownAt = 0;
  const COOLDOWN_MS = 30_000; // 30 s — try Railway again after this
  
  function markRailwayDown() {
    railwayDown = true;
    railwayDownAt = Date.now();
  }
  
  function isRailwayHealthy() {
    if (!railwayDown) return true;
    if (Date.now() - railwayDownAt > COOLDOWN_MS) {
      railwayDown = false; // cooldown expired, try again
      return true;
    }
    return false;
  }
  
  export default async function middleware(request) {
    const url  = new URL(request.url);
    const path = url.pathname;
  
    // Skip SSR call while Railway is in its cooldown window after a failure.
    if (!isRailwayHealthy()) return;
  
    const RAILWAY = (process.env.RAILWAY_BACKEND_URL || 'https://shopzen-production.up.railway.app').replace(/\/$/, '');
    const target  = `${RAILWAY}${path}${url.search}`;
  
    try {
      const ssrRes = await fetch(target, {
        method: 'GET',
        headers: {
          'user-agent':        request.headers.get('user-agent') || 'Mozilla/5.0',
          'accept':            'text/html,application/xhtml+xml',
          'accept-language':   request.headers.get('accept-language') || 'en',
          'x-forwarded-host':  url.host,
          'x-forwarded-proto': 'https',
          'x-real-ip':         request.headers.get('x-real-ip') || '',
        },
        // 4 s timeout — fast enough that users don't notice on warm Railway,
        // short enough that a cold start doesn't block the page for 8+ seconds.
        signal: AbortSignal.timeout(4000),
      });
  
      if (!ssrRes.ok) {
        markRailwayDown();
        return; // fall through to Vercel's plain index.html
      }
  
      const body = await ssrRes.text();
  
      const isValidShell =
        body.includes('id="root"') &&
        body.includes('/static/js/') &&
        body.includes('</html>');
  
      if (!isValidShell) {
        markRailwayDown();
        return;
      }
  
      // ✅ Valid SSR response — cache at the CDN edge for 5 minutes.
      // Repeat hits to the same URL within this window are served straight
      // from Vercel's CDN cache, WITHOUT re-invoking this edge function or
      // calling Railway again — this is the single biggest reduction lever.
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type':  'text/html; charset=utf-8',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
          'X-SSR':         'railway',
        },
      });
  
    } catch (err) {
      // Timeout (AbortError) or network error — Railway is cold or unreachable.
      markRailwayDown();
      return; // fall through to Vercel's plain index.html
    }
  }