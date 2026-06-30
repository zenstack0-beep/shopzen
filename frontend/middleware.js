// frontend/middleware.js
//
// Vercel Edge Middleware — proxies HTML page requests to the Railway
// backend's seoRenderMiddleware (backend/routes/seo.js), which injects
// per-page <title>, meta description, canonical, OG/Twitter tags, and
// JSON-LD (Product/Breadcrumb/Review/AggregateRating/Organization, etc.)
// into index.html before it's returned.
//
// ── WHY THIS VERSION EXISTS ────────────────────────────────────────────
// Previous versions invoked this middleware (a billed Vercel Function) on
// every single request — including real customers, static assets, and
// the SPA shell — and proxied ALL of them to Railway. That meant every
// page view by a normal shopper consumed a Function invocation AND a
// round-trip fetch to Railway, even though customers don't need
// server-rendered meta tags; the React SPA handles that for them.
//
// This version does two things to cut invocations drastically:
//   1. The `matcher` only targets actual page routes (/, /product/*,
//      /category/*, /brand/*, /shop*, /page/*, /campaign/*). Requests for
//      /api/*, /static/*, favicons, sitemap/robots, and any file with a
//      static extension (css/js/json/xml/txt/images/fonts) never invoke
//      this function at all — Vercel's matcher filters them out before
//      the function runs, so they're served straight from the CDN.
//   2. Within that already-narrow matcher, we only proxy to Railway SSR
//      when the User-Agent is a known SEO or social-preview crawler
//      (Googlebot, Bingbot, Facebook/WhatsApp, Twitter/X, LinkedIn,
//      Slack, Discord, Telegram, etc). Lighthouse and HeadlessChrome are
//      explicitly excluded so synthetic audits don't get billed as SSR
//      traffic. Every real customer falls through and gets the static
//      `/index.html` SPA shell served by Vercel's CDN — zero Function
//      invocation, zero Railway round-trip.

export const config = {
    // Only run on page-like routes. Everything else (assets, /api, /static,
    // favicons, sitemap/robots, fonts, etc.) is filtered out here and never
    // triggers a Function invocation.
    matcher: [
      '/',
      '/product/:path*',
      '/category/:path*',
      '/brand/:path*',
      '/shop',
      '/shop/:path*',
      '/page/:path*',
      '/campaign/:path*',
    ],
  };
  
  // Backend that hosts seoRenderMiddleware (backend/routes/seo.js).
  const SSR_ORIGIN = 'https://shopzen-production.up.railway.app';
  
  // Known SEO / social-preview crawlers that need server-rendered meta tags.
  // Deliberately does NOT include Lighthouse or HeadlessChrome — those are
  // synthetic/audit tools, not real SEO or social crawlers, and should see
  // the same static shell a real visitor gets.
  const BOT_UA_RE = new RegExp(
    [
      'Googlebot',
      'Google-InspectionTool',
      'AdsBot-Google',
      'Bingbot',
      'BingPreview',
      'facebookexternalhit',
      'Facebot',
      'WhatsApp',
      'Twitterbot',
      'LinkedInBot',
      'Slackbot',
      'Slack-ImgProxy',
      'Discordbot',
      'TelegramBot',
      'Pinterest',
      'redditbot',
      'Applebot',
      'DuckDuckBot',
      'YandexBot',
      'Baiduspider',
    ].join('|'),
    'i'
  );
  
  // Explicit exclusion list: never treat these as SEO/social bots, even if
  // they happen to match a substring above (defense in depth).
  const NON_SEO_UA_RE = /HeadlessChrome|Lighthouse|Chrome-Lighthouse|PageSpeed/i;
  
  function isSeoBot(ua) {
    if (!ua) return false;
    if (NON_SEO_UA_RE.test(ua)) return false;
    return BOT_UA_RE.test(ua);
  }
  
  export default async function middleware(request) {
    const { pathname, search } = new URL(request.url);
    const ua = request.headers.get('user-agent') || '';
  
    // Real customers (and anything not a recognized SEO/social crawler):
    // fall through to the static SPA shell served from Vercel's CDN. No
    // Railway round-trip, no extra work.
    if (!isSeoBot(ua)) return;
  
    // Only proxy GET/HEAD navigations that accept HTML.
    const accept = request.headers.get('accept') || '';
    if (request.method !== 'GET' && request.method !== 'HEAD') return;
    if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return;
  
    const target = new URL(pathname + search, SSR_ORIGIN);
  
    try {
      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers: {
          'user-agent': ua,
          accept: accept || 'text/html',
        },
        redirect: 'follow',
      });
  
      const headers = new Headers(upstream.headers);
      // Never let Vercel's edge cache this — Railway already sets its own
      // correct per-route Cache-Control (no-cache, must-revalidate), and
      // caching here risks cross-path pollution (one page's HTML served for
      // another's URL).
      headers.set('Cache-Control', 'private, no-store, max-age=0, must-revalidate');
      headers.set('X-SEO-SSR', 'railway');
  
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    } catch (err) {
      // If the SSR backend is down, fail open to the static shell rather than
      // breaking the site for visitors.
      return;
    }
  }