/**
 * useAnalytics.js — Injects GA4, GTM, and Meta Pixel scripts
 * from the seo_config Settings key.
 *
 * Architecture:
 *  - index.html loads the fbevents.js STUB (fbq shim + async script tag)
 *    without calling fbq('init'). This means fbq() is always available as
 *    a native queue from the very first paint — no race condition.
 *  - bootstrapAnalytics() (called from <AnalyticsBootstrap/>) calls
 *    fbq('init', pixelId) once the Pixel ID is fetched from admin settings.
 *  - Any event fired between page load and init (AddToCart, Purchase, etc.)
 *    sits in Meta's own f.queue and is replayed automatically after init.
 *
 * This eliminates:
 *  - The "Duplicate Pixel ID" warning (no hardcoded init in index.html)
 *  - Lost Purchase events (fbq queue is native, not a custom polyfill)
 *  - The polling interval hack (fbevents.js is already loading from stub)
 */

import { useEffect } from 'react';

/**
 * fbqSafe — call this everywhere instead of window.fbq() directly.
 *
 * Since the fbq stub is loaded in index.html, window.fbq is ALWAYS defined
 * by the time any React code runs. Calls before fbq('init') are buffered
 * in Meta's own n.queue and replayed after init automatically.
 * The fallback branch is a safety net for environments where index.html
 * is served without the stub (e.g. unit tests, some SSR setups).
 */
export function fbqSafe(type, eventName, params) {
  if (window.fbq) {
    window.fbq(type, eventName, params);
  }
  // No custom queue needed — fbevents.js stub handles buffering natively.
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
  // The fbq stub (shim + async fbevents.js loader) is already in index.html,
  // so window.fbq is available immediately. We only need to call fbq('init')
  // once per pixel ID. Events queued before init() are replayed by Meta's
  // own queue mechanism — no custom drain needed.
  if (cfg.metaPixelId && window.fbq) {
    window.__fbPixelInitIds = window.__fbPixelInitIds || {};

    if (!window.__fbPixelInitIds[cfg.metaPixelId]) {
      window.__fbPixelInitIds[cfg.metaPixelId] = true;
      window.fbq('init', cfg.metaPixelId);
      window.fbq('track', 'PageView');

      // noscript fallback for crawlers / JS-disabled browsers
      injectNoscript(
        `<img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=${cfg.metaPixelId}&ev=PageView&noscript=1"/>`,
        'fb-pixel-noscript'
      );
    }
    // If bootstrapAnalytics is called again (e.g. settings hot-reload) with the
    // same pixel ID, we do nothing — the pixel is already initialised and a
    // second fbq('init') with the same ID is what causes the Duplicate warning.
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