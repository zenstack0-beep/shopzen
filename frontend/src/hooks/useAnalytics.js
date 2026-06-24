/**
 * useAnalytics.js — Injects GA4, GTM, and Meta Pixel scripts
 * from the seo_config Settings key.
 *
 * Call <AnalyticsBootstrap/> once at App root inside ThemeProvider
 * (which already fetches settings). The component reads
 * window.__SHOPZEN_SEO__ set by ThemeContext or SEO settings save.
 *
 * FIX: Meta Pixel events fired before fbq loads are queued in
 * window.__fbQueue and replayed the moment the pixel script loads.
 * This eliminates the race condition where PageView / ViewContent /
 * AddToCart / InitiateCheckout fire before bootstrapAnalytics() runs.
 */

import { useEffect } from 'react';

// ── Pixel event queue ─────────────────────────────────────────────────────────
// Any call to fbq() before the pixel script loads is pushed here.
// bootstrapAnalytics() drains the queue once fbq is ready.
window.__fbQueue = window.__fbQueue || [];

/**
 * Safe wrapper around fbq(). If fbq is not yet loaded the call is
 * queued and replayed automatically once the pixel boots.
 *
 * Use this everywhere instead of calling window.fbq() directly.
 */
export function fbqSafe(type, eventName, params) {
  if (window.fbq) {
    window.fbq(type, eventName, params);
  } else {
    window.__fbQueue.push({ type, eventName, params });
  }
}

function drainFbQueue() {
  const q = window.__fbQueue || [];
  window.__fbQueue = [];
  q.forEach(({ type, eventName, params }) => {
    try { window.fbq(type, eventName, params); } catch (_) {}
  });
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function injectScript(src, id, onload) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.id = id;
  if (onload) s.onload = onload;
  document.head.appendChild(s);
}

function injectInlineScript(code, id) {
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.textContent = code;
  document.head.appendChild(s);
}

function injectNoscript(html, id) {
  if (document.getElementById(id)) return;
  const ns = document.createElement('noscript');
  ns.id = id;
  ns.innerHTML = html;
  document.body.insertBefore(ns, document.body.firstChild);
}

export function bootstrapAnalytics(cfg) {
  if (!cfg) return;

  // ── Google Tag Manager ────────────────────────────────────────────────────
  if (cfg.gtmId && !document.getElementById('gtm-script')) {
    injectInlineScript(
      `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${cfg.gtmId}');`,
      'gtm-script'
    );
    injectNoscript(
      `<iframe src="https://www.googletagmanager.com/ns.html?id=${cfg.gtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe>`,
      'gtm-noscript'
    );
  }

  // ── Google Analytics 4 ────────────────────────────────────────────────────
  if (cfg.ga4Id && !document.getElementById('ga4-script')) {
    injectScript(
      `https://www.googletagmanager.com/gtag/js?id=${cfg.ga4Id}`,
      'ga4-loader',
      () => {
        injectInlineScript(
          `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${cfg.ga4Id}',{send_page_view:false});`,
          'ga4-script'
        );
      }
    );
  }

  // ── Meta Pixel ────────────────────────────────────────────────────────────
  if (cfg.metaPixelId) {
    if (!document.getElementById('fb-pixel-script')) {
      // Pixel not yet loaded at all — inject it with an onload that:
      //   1. initialises the pixel
      //   2. fires the initial PageView
      //   3. drains any queued events fired before the script loaded
      const pixelScript = document.createElement('script');
      pixelScript.id = 'fb-pixel-script';
      pixelScript.textContent = `
        !function(f,b,e,v,n,t,s){
          if(f.fbq)return;
          n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;
          n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];
          t=b.createElement(e);t.async=!0;t.src=v;
          s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s);
        }(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init','${cfg.metaPixelId}');
        fbq('track','PageView');
      `;
      document.head.appendChild(pixelScript);

      injectNoscript(
        `<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${cfg.metaPixelId}&ev=PageView&noscript=1"/>`,
        'fb-pixel-noscript'
      );

      // Poll until fbq is available then drain the queue.
      // fbevents.js loads in ~100-300 ms; polling every 50 ms is cheap.
      const pollInterval = setInterval(() => {
        if (window.fbq) {
          clearInterval(pollInterval);
          drainFbQueue();
        }
      }, 50);

      // Safety: stop polling after 10 s regardless
      setTimeout(() => clearInterval(pollInterval), 10000);

    } else if (window.fbq && !window.__fbPixelInitIds?.[cfg.metaPixelId]) {
      // fbq stub already exists (bootstrapAnalytics called twice, e.g. from
      // a settings reload) — re-init with the pixel ID only if not already done,
      // then drain any queued events.  This branch also covers the edge-case
      // where a browser extension pre-loaded fbevents.js.
      window.__fbPixelInitIds = window.__fbPixelInitIds || {};
      window.__fbPixelInitIds[cfg.metaPixelId] = true;
      window.fbq('init', cfg.metaPixelId);
      window.fbq('track', 'PageView');
      drainFbQueue();
    }
  }
}

/** React component — mount once at App root */
export default function AnalyticsBootstrap() {
  useEffect(() => {
    const cfg = window.__SHOPZEN_SEO__;
    if (cfg) bootstrapAnalytics(cfg);
    // Also listen for delayed injection (settings loaded after mount)
    const handler = () => bootstrapAnalytics(window.__SHOPZEN_SEO__);
    window.addEventListener('shopzen:seo-ready', handler);
    return () => window.removeEventListener('shopzen:seo-ready', handler);
  }, []);
  return null;
}