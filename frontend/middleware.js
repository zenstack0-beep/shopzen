/**
 * middleware.js  — Vercel Edge Middleware for ShopZen (Create React App / any SPA)
 * Place at: frontend/middleware.js
 *
 * Works with any framework on Vercel — uses the Web API standard (Request/Response)
 * via the Edge Runtime, no Next.js required.
 *
 * Logic:
 *   • Real browsers  → fall through → Vercel serves /index.html (React SPA, fast)
 *   • Crawlers/bots  → rewrite to Railway seoRenderMiddleware (injects per-page meta)
 */

export const config = {
    runtime: 'edge',
    // Apply to all navigable routes; skip static files, API proxies and Vercel internals
    matcher: [
      '/((?!_vercel|static|api|favicon\\.ico|favicon-|apple-touch|manifest\\.json|robots\\.txt|sitemap\\.xml|og-default\\.png|googleee.*\\.html|.*\\.(?:js|css|png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|map|json|xml|txt)).*)',
    ],
  };
  
  // All known crawler / social-scraper user-agent patterns
  const BOT_PATTERN = new RegExp([
    'googlebot', 'google-inspectiontool', 'adsbot-google',
    'bingbot', 'msnbot', 'bingpreview',
    'yandexbot', 'yandex\\.com/bots',
    'baiduspider',
    'duckduckbot',
    'yahoo! slurp',
    'facebookexternalhit', 'facebot',
    'twitterbot',
    'linkedinbot', 'linkedinscraper',
    'whatsapp',
    'telegrambot',
    'applebot',
    'discordbot',
    'slackbot', 'slack-imgproxy',
    'embedly', 'quora link preview', 'rogerbot',
    'showyoubot', 'outbrain', 'pinterest',
    'redditbot', 'semrushbot', 'ahrefsbot',
    'mj12bot', 'dotbot', 'petalbot',
    'gptbot', 'chatgpt-user', 'claudebot', 'anthropic-ai',
    'ia_archiver', 'archive\\.org_bot',
    'sogou', 'exabot',
  ].join('|'), 'i');
  
  export default async function middleware(request) {
    const ua = request.headers.get('user-agent') || '';
  
    // Real user — serve the React SPA normally (Vercel handles index.html rewrite)
    if (!BOT_PATTERN.test(ua)) {
      return; // returning undefined = pass through, Vercel serves index.html
    }
  
    // ── Crawler detected — proxy to Railway for SSR meta injection ──────────────
    const RAILWAY = (process.env.RAILWAY_BACKEND_URL || 'https://shopzen-production.up.railway.app').replace(/\/$/, '');
  
    const url = new URL(request.url);
    const target = `${RAILWAY}${url.pathname}${url.search}`;
  
    // Forward with host info so Railway builds correct canonical URLs
    const headers = new Headers();
    headers.set('user-agent', ua);
    headers.set('accept', request.headers.get('accept') || 'text/html');
    headers.set('accept-language', request.headers.get('accept-language') || 'en');
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', 'https');
    headers.set('x-real-ip', request.headers.get('x-real-ip') || '');
  
    try {
      const ssrResponse = await fetch(target, {
        method: 'GET',
        headers,
        // 8s timeout — if Railway is slow, fall back to React shell
        signal: AbortSignal.timeout(8000),
      });
  
      // If Railway returned valid HTML, serve it
      if (ssrResponse.ok) {
        const body = await ssrResponse.text();
        // Safety check: must look like our index.html (has React root + our script)
        if (body.includes('id="root"') && body.includes('shopzen')) {
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
      // Railway timeout or error — fall back to the static React shell
      // The crawler will still get a valid HTML page, just without injected meta
    }
  
    // Fallback: let Vercel serve /index.html as-is
    return;
  }