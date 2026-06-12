/**
 * middleware.js — Vercel Edge Middleware for ShopZen
 *
 * Flow for every request:
 *   Static files (.js/.css/images)  → pass through → Vercel CDN serves them
 *   /api/*                          → pass through → vercel.json proxies to Railway
 *   Private pages (/login, /admin)  → pass through → Vercel serves index.html
 *   Public SEO pages:
 *     /, /product/*, /shop, /shop/*,
 *     /category/*, /brand/*,
 *     /page/*, /campaign/*
 *                                   → proxy to Railway seoRenderMiddleware
 *                                   → Railway injects per-page meta into real index.html
 *                                   → Page source has correct SEO + JS bundles load React ✓
 *
 * White-screen prevention:
 *   - Railway cold-start: if Railway returns anything other than a valid
 *     React HTML shell, we fall through immediately to Vercel's index.html.
 *     React still renders client-side; only the SSR meta injection is skipped.
 *   - 4-second timeout (down from 8s) so customers never wait on a cold backend.
 *   - We never block the user — every error path returns Vercel's index.html.
 */

export const config = {
    runtime: 'edge',
    matcher: ['/(.*)', ],
  };
  
  // Static asset extensions — never proxy, Vercel serves from CDN
  const STATIC_EXT = /\.(?:js|css|png|jpg|jpeg|gif|ico|svg|webp|woff2?|ttf|eot|map|json|xml|txt|html)$/i;
  
  // Private/auth/internal paths — skip SSR, Vercel serves index.html directly
  const SKIP_SSR_PATH = /^\/(api|_vercel|static|favicon|apple-touch|manifest\.json|robots\.txt|sitemap\.xml|og-default\.png|googleee|login|register|forgot-password|account|my-orders|checkout|order-success|track-order|admin)(\/|$|\?|$)/;
  const SITEMAP_PATH  = /^\/api\/seo\/.*-sitemap\.xml$/;
  
  // Public SEO paths that should be SSR-rendered with injected meta
  const SSR_PATH = /^\/(product\/|shop|category\/|brand\/|page\/|campaign\/|gift-cards|wishlist|cart)(.*)|^\/$/;
  
  // ─── Railway health / cold-start tracking ────────────────────────────────────
  // We keep a lightweight in-memory flag (edge function scope) to skip SSR calls
  // when Railway is known to be cold, avoiding stacking timeouts on every request.
  // The flag resets after COOLDOWN_MS, giving Railway time to warm back up.
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
  
    // Pass through static files immediately
    if (STATIC_EXT.test(path)) return;
  
    // Pass through private/internal paths
    if (SKIP_SSR_PATH.test(path) || SITEMAP_PATH.test(path)) return;
  
    // Only proxy paths that benefit from SSR meta injection
    const needsSSR = SSR_PATH.test(path);
    if (!needsSSR) return;
  
    // Skip SSR call while Railway is in its cooldown window after a failure.
    // This prevents every user request from hanging during a cold-start.
    if (!isRailwayHealthy()) return;
  
    // SSR-eligible public pages → Railway SSR
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
        // Non-2xx from Railway (e.g. 503 during cold start) — mark as down
        // so subsequent requests skip the SSR call immediately.
        markRailwayDown();
        return; // fall through to Vercel's plain index.html
      }
  
      const body = await ssrRes.text();
  
      // Validate the response is our real React shell, not an error page or
      // Railway's "application starting" placeholder.
      const isValidShell =
        body.includes('id="root"') &&
        body.includes('/static/js/') &&
        body.includes('</html>');
  
      if (!isValidShell) {
        // Railway returned something unexpected (splash page, error HTML, etc.)
        markRailwayDown();
        return; // fall through to Vercel's plain index.html
      }
  
      // ✅ Valid SSR response — return it with no-cache so browsers always
      // get the freshest meta on the next visit.
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type':  'text/html; charset=utf-8',
          'Cache-Control': 'no-cache, must-revalidate',
          'X-SSR':         'railway',
        },
      });
  
    } catch (err) {
      // Timeout (AbortError) or network error — Railway is cold or unreachable.
      // Mark it down so we skip the SSR call for the next COOLDOWN_MS period.
      markRailwayDown();
  
      // Fall through to Vercel's plain index.html.
      // React still loads client-side — only the SSR meta injection is skipped.
      // Customers see the site instantly; crawlers just get plain meta this visit.
      return;
    }
  }