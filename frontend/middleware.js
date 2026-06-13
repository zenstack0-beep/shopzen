// frontend/middleware.js
//
// Vercel Edge Middleware — routes crawler/bot/link-preview requests to the
// Railway backend's seoRenderMiddleware (which injects per-page <title>,
// meta description, OG/Twitter tags, canonical and JSON-LD into index.html),
// while normal human visitors continue to get the static, CDN-cached SPA shell.
//
// Without this, every page (product/category/brand) served to bots and
// social-link-preview scrapers returns the generic homepage <head> tags,
// causing duplicate title/meta warnings in Search Console and broken
// WhatsApp/Facebook/Twitter share previews for product links.

export const config = {
    // Run on every request except static assets, the API (already proxied by
    // vercel.json), and common file extensions.
    matcher: [
      '/((?!api|static|_next|favicon|manifest|robots\\.txt|sitemap|.*\\.(?:ico|png|jpg|jpeg|gif|webp|svg|css|js|map|json|xml|txt|woff|woff2|ttf)$).*)',
    ],
  };
  
  // Backend that hosts seoRenderMiddleware (backend/routes/seo.js).
  const SSR_ORIGIN = 'https://shopzen-production.up.railway.app';
  
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
  
  export default async function middleware(request) {
    const ua = request.headers.get('user-agent') || '';
  
    // Human visitors (and anything we don't recognize as a bot) keep getting
    // the default static index.html shell from Vercel's edge cache.
    if (!BOT_UA_REGEX.test(ua)) {
      return; // fall through to normal Vercel routing
    }
  
    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, SSR_ORIGIN);
  
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