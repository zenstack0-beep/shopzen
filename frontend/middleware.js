// frontend/middleware.js
//
// Vercel Edge Middleware — routes crawler/bot/link-preview requests to the
// Railway backend's seoRenderMiddleware (which injects per-page <title>,
// meta description, OG/Twitter tags, canonical and JSON-LD into index.html),
// while normal human visitors continue to get the static, CDN-cached SPA shell.
//
// ── REGRESSION FIX ───────────────────────────────────────────────────────────
// The previous version used a single regex `matcher` with a negative lookahead
// (`(?!api|static|...).*`). Vercel compiles `matcher` patterns with
// path-to-regexp, which does NOT reliably support that pattern for nested
// paths — so the middleware silently failed to run for `/product/:slug` (and
// other multi-segment routes). Result: bots/crawlers requesting product pages
// fell through to Vercel's static `index.html`, which still carries the
// HOMEPAGE's <title>, meta description, canonical, OG tags, and
// WebSite/Organization JSON-LD instead of product-specific data.
//
// Fix: match EVERYTHING (a pattern Vercel always compiles correctly), and do
// all exclusion logic (assets, /api, bots-only) inside the function body using
// plain string checks on `pathname` — no regex-in-matcher ambiguity.

export const config = {
    matcher: '/:path*',
  };
  
  // Backend that hosts seoRenderMiddleware (backend/routes/seo.js).
  const SSR_ORIGIN = 'https://shopzen-production.up.railway.app';
  
  // Paths/prefixes that must NEVER be proxied — these are served directly by
  // Vercel (static assets) or already proxied to Railway via vercel.json (/api).
  const SKIP_PREFIXES = ['/api/', '/static/', '/_next/', '/favicon', '/manifest'];
  const SKIP_EXACT = new Set(['/robots.txt', '/sitemap.xml']);
  const SKIP_EXTENSION_RE = /\.(?:ico|png|jpg|jpeg|gif|webp|svg|css|js|map|json|xml|txt|woff2?|ttf)$/i;
  
  // User-agent substrings for crawlers, search bots, and link-preview/unfurl
  // services that do NOT execute JavaScript before reading <head> tags.
  const BOT_UA_REGEX = new RegExp(
    [
      'bot', 'crawl', 'spider', 'slurp', 'crawler',
      'facebookexternalhit', 'facebookcatalog', 'whatsapp',
      'telegrambot', 'slackbot', 'discordbot', 'linkedinbot',
      'twitterbot', 'pinterest', 'pinterestbot', 'redditbot',
      'embedly', 'quora link preview', 'tumblr', 'vkshare',
      'skypeuripreview', 'w3c_validator', 'applebot',
      'googlebot', 'bingbot', 'yandex', 'baiduspider', 'duckduckbot',
      'mj12bot', 'ahrefsbot', 'semrushbot', 'screaming frog',
    ].join('|'),
    'i'
  );
  
  function shouldSkip(pathname) {
    if (SKIP_EXACT.has(pathname)) return true;
    if (SKIP_EXTENSION_RE.test(pathname)) return true;
    return SKIP_PREFIXES.some((p) => pathname.startsWith(p));
  }
  
  export default async function middleware(request) {
    const { pathname, search } = new URL(request.url);
  
    // Static assets, API routes, and already-handled SEO files: never touch.
    if (shouldSkip(pathname)) return;
  
    const ua = request.headers.get('user-agent') || '';
  
    // Human visitors keep getting the default static index.html shell from
    // Vercel's edge cache — including on /product/:slug, /category/:slug, etc.
    if (!BOT_UA_REGEX.test(ua)) return;
  
    // Bot/crawler/link-preview request on a page route (/, /product/:slug,
    // /category/:slug, /brand/:slug, /shop, /page/:slug, ...) — proxy to the
    // Railway SSR endpoint, which injects per-page meta + JSON-LD.
    const target = new URL(pathname + search, SSR_ORIGIN);
  
    try {
      const upstream = await fetch(target.toString(), {
        method: 'GET',
        headers: {
          'user-agent': ua,
          accept: request.headers.get('accept') || 'text/html',
        },
        redirect: 'follow',
      });
  
      const headers = new Headers(upstream.headers);
      // Let bots see fresh per-page meta on every crawl.
      headers.set('Cache-Control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=600');
      headers.set('X-SEO-SSR', 'railway');
  
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    } catch (err) {
      // If the SSR backend is down, don't break crawling — fall back to the
      // static shell rather than returning an error to the bot.
      return;
    }
  }