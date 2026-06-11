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
  // /category/:slug and /brand/:slug are the new SEO-friendly routes
  const SSR_PATH = /^\/(product\/|shop|category\/|brand\/|page\/|campaign\/|gift-cards|wishlist|cart)(.*)|^\/$/;
  
  export default async function middleware(request) {
    const url  = new URL(request.url);
    const path = url.pathname;
  
    // Pass through static files immediately
    if (STATIC_EXT.test(path)) return;
  
    // Pass through private/internal paths
    if (SKIP_SSR_PATH.test(path) || SITEMAP_PATH.test(path)) return;
  
    // Only proxy paths that benefit from SSR meta injection
    // (everything else falls through to Vercel's plain index.html)
    const needsSSR = SSR_PATH.test(path);
    if (!needsSSR) return;
  
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
        signal: AbortSignal.timeout(8000),
      });
  
      if (ssrRes.ok) {
        const body = await ssrRes.text();
        // Only use if it's the real React build — must have root div AND JS bundle
        if (body.includes('id="root"') && body.includes('/static/js/')) {
          return new Response(body, {
            status: 200,
            headers: {
              'Content-Type':  'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, must-revalidate',
              'X-SSR':         'railway',
            },
          });
        }
      }
    } catch (_) {
      // Railway timeout or error — fall through to Vercel's plain index.html
      // React still loads client-side, just without injected server meta
    }
  
    // Fallback: Vercel serves plain index.html (React handles routing)
    return;
  }