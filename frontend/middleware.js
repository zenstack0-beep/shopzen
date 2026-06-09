/**
 * middleware.js  — Vercel Edge Middleware for ShopZen
 *
 * ALL page requests are proxied to Railway seoRenderMiddleware.
 * Railway injects per-page title, meta, OG, JSON-LD into the real
 * built index.html (which contains the JS/CSS bundles), so:
 *   • Page source shows correct SEO meta for every page  ✓
 *   • JS/CSS bundles are present so React loads normally  ✓
 *   • Bots and browsers both get the same correct HTML    ✓
 *
 * Static assets (/static/*, /favicon.ico, etc.) bypass this
 * middleware and are served directly by Vercel CDN.
 */

export const config = {
    runtime: 'edge',
    matcher: [
      // Match all navigable page routes — skip static files and API
      '/((?!_vercel|static|api|favicon\\.ico|favicon-|apple-touch|manifest\\.json|robots\\.txt|sitemap\\.xml|og-default\\.png|googleee.*\\.html|.*\\.(?:js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|map|json|xml|txt)).*)',
    ],
  };
  
  // Pages that don't need SSR — serve plain index.html directly
  // (login/account/checkout have no public SEO value and no product data)
  const SKIP_SSR = /^\/(login|register|forgot-password|account|my-orders|checkout|order-success|track-order|admin)(\/|$)/;
  
  export default async function middleware(request) {
    const url = new URL(request.url);
  
    // Skip SSR for private/auth pages — serve React shell directly
    if (SKIP_SSR.test(url.pathname)) {
      return; // Vercel serves index.html
    }
  
    const RAILWAY = (process.env.RAILWAY_BACKEND_URL || 'https://shopzen-production.up.railway.app').replace(/\/$/, '');
    const target = `${RAILWAY}${url.pathname}${url.search}`;
  
    const headers = new Headers();
    headers.set('user-agent', request.headers.get('user-agent') || 'Mozilla/5.0');
    headers.set('accept', 'text/html');
    headers.set('accept-language', request.headers.get('accept-language') || 'en');
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', 'https');
    headers.set('x-real-ip', request.headers.get('x-real-ip') || '');
  
    try {
      const ssrRes = await fetch(target, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      });
  
      if (ssrRes.ok) {
        const body = await ssrRes.text();
        // Must contain React root AND our JS bundle to be valid
        if (body.includes('id="root"') && body.includes('/static/js/')) {
          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, must-revalidate',
              'X-SSR': 'railway',
            },
          });
        }
      }
    } catch (_) {
      // Railway timeout or error — fall back to Vercel's index.html
      // React still loads, just without injected per-page meta
    }
  
    // Fallback: Vercel serves plain index.html
    return;
  }