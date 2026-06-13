// frontend/middleware.js
//
// Vercel Edge Middleware — proxies HTML page requests to the Railway
// backend's seoRenderMiddleware (backend/routes/seo.js), which injects
// per-page <title>, meta description, canonical, OG/Twitter tags, and
// JSON-LD (Product/Breadcrumb/Review/AggregateRating/Organization, etc.)
// into index.html before it's returned.
//
// ── HISTORY OF THIS FILE ─────────────────────────────────────────────────
// v1: matcher used a negative-lookahead regex Vercel's path-to-regexp
//     couldn't compile for nested routes -> /product/:slug never proxied,
//     so it fell back to the static homepage shell.
// v2: fixed the matcher, but only proxied requests whose User-Agent matched
//     a hardcoded bot/crawler list. Result: `view-source:` in a real browser
//     (and any crawler/tool NOT on that list) still got the generic static
//     homepage shell for /product/:slug, /category/:slug, etc.
//
// ── THIS VERSION ─────────────────────────────────────────────────────────
// Proxy ALL HTML page requests (everyone — humans, browsers, every crawler)
// to Railway's SSR endpoint. This removes the entire "is this UA a bot?"
// guessing game: every visitor, tool, and crawler sees the same correct,
// page-specific <head>. seoRenderMiddleware is a lightweight DB lookup +
// string substitution, so the per-request cost is small.

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
  
  function shouldSkip(pathname) {
    if (SKIP_EXACT.has(pathname)) return true;
    if (SKIP_EXTENSION_RE.test(pathname)) return true;
    return SKIP_PREFIXES.some((p) => pathname.startsWith(p));
  }
  
  export default async function middleware(request) {
    const { pathname, search } = new URL(request.url);
  
    // Static assets, API routes, and already-handled SEO files: never touch.
    if (shouldSkip(pathname)) return;
  
    // Only proxy GET/HEAD navigations that accept HTML. This avoids
    // interfering with prefetch requests for JS chunks, etc. that don't carry
    // an Accept header indicating an HTML document.
    const accept = request.headers.get('accept') || '';
    if (request.method !== 'GET' && request.method !== 'HEAD') return;
    if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return;
  
    const ua = request.headers.get('user-agent') || '';
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