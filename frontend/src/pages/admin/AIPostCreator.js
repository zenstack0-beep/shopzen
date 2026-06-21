/**
 * AIPostCreator.js  ★ CINEMATIC STUDIO EDITION ★
 * Path: frontend/src/pages/admin/AIPostCreator.js
 *
 * ONE cohesive cinematic dark-studio template system.
 * Inspired by: AirPod/boAt/JBL/iPhone pro ad aesthetics.
 *
 * SINGLE TEMPLATE — changes only: product image, name, price, discount,
 * accent colour, badge text, features, CTA. Layout and visual language
 * stay identical across every generation so the brand is consistent.
 *
 * Visual elements:
 *  • Deep charcoal-black radial bg with subtle noise grain
 *  • Dramatic spotlight cone from above — white centre → transparent
 *  • Giant semi-transparent product-name typography BEHIND the product
 *  • Product centred on a glowing white disc pedestal with fog mist
 *  • Discount badge — rounded rectangle pill (dark fill, accent outline)
 *  • Feature callout chips (pill tags) scattered around product
 *  • Store logo top-left, accent tagline top-right
 *  • Price block with crossed-out original + bright sale price
 *  • CTA pill button bottom-centre
 *  • WhatsApp + website bottom bar
 *  • Fine halftone/dot-grid texture overlay for print feel
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import API from '../../utils/api';
import toast from 'react-hot-toast';

/* ════════════════════════════════════════════════════════════════════════
   TEMPLATE MODE — background removal
   Calls the backend /remove-background endpoint (server-side sharp-based
   corner-flood-fill masking) instead of the client-side WASM library.
   This works reliably for ALL product image types including:
     • White/light studio backgrounds
     • Images with printed text on the background (spec sheets, branded)
     • WebP, JPEG, PNG — any format the backend can read
════════════════════════════════════════════════════════════════════════ */
async function removeImageBackground(imageUrl, apiInstance) {
  const { data } = await apiInstance.post('/ai-post-creator/remove-background', { imageUrl });
  if (!data?.dataUrl) throw new Error('No dataUrl returned from server');
  return data.dataUrl;
}

/* ════════════════════════════════════════════════════════════════════════
   ACCENT COLOUR PALETTES  (admin picks one; layout never changes)
════════════════════════════════════════════════════════════════════════ */
const ACCENT_PALETTES = [
  { id: 'electric_white', label: 'Electric White', color: '#e8eaf0', glow: '#a0a8c0' },
  { id: 'neon_green',     label: 'Neon Green',     color: '#39d353', glow: '#1a6628' },
  { id: 'cyber_red',      label: 'Cyber Red',      color: '#ff2d55', glow: '#8b0022' },
  { id: 'solar_gold',     label: 'Solar Gold',     color: '#ffd600', glow: '#7a6000' },
  { id: 'ice_blue',       label: 'Ice Blue',       color: '#00d4ff', glow: '#004d66' },
  { id: 'royal_violet',   label: 'Royal Violet',   color: '#bf5fff', glow: '#4b0080' },
  { id: 'flame_orange',   label: 'Flame Orange',   color: '#ff6b00', glow: '#7a3000' },
  { id: 'rose_gold',      label: 'Rose Gold',      color: '#f4a0b0', glow: '#7a3040' },
];

const FORMATS = [
  { id: 'instagram', label: 'Instagram Post',  w: 1080, h: 1080 },
  { id: 'facebook',  label: 'Facebook Post',   w: 1200, h: 630  },
  { id: 'story',     label: 'Story (IG/FB)',   w: 1080, h: 1920 },
  { id: 'banner',    label: 'Web Banner',      w: 1600, h: 500  },
];

const PLATFORM_META = {
  facebook:  { label: 'Facebook',  color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E1306C' },
  tiktok:    { label: 'TikTok',    color: '#010101' },
  whatsapp:  { label: 'WhatsApp',  color: '#25D366' },
  telegram:  { label: 'Telegram',  color: '#229ED9' },
};

const fmtLKR = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

/* ════════════════════════════════════════════════════════════════════════
   CANVAS UTILITIES
════════════════════════════════════════════════════════════════════════ */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) return reject(new Error('no src'));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth, maxLines = 99) {
  const words = String(text || '').split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      if (lines.length >= maxLines) return lines;
      line = word;
    } else { line = test; }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

/* Seeded RNG — stable particles across re-renders */
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW: halftone dot-grid overlay (subtle print/studio texture)
════════════════════════════════════════════════════════════════════════ */
function drawGrain(ctx, W, H, alpha = 0.028) {
  const spacing = Math.round(W * 0.012);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  for (let x = 0; x < W; x += spacing) {
    for (let y = 0; y < H; y += spacing) {
      const r = spacing * 0.14;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW: dramatic spotlight cone from above
════════════════════════════════════════════════════════════════════════ */
function drawSpotlight(ctx, W, H, cx, topY, radius, accentColor) {
  ctx.save();
  // Primary white cone
  const sg = ctx.createRadialGradient(cx, topY, 0, cx, topY, radius);
  sg.addColorStop(0,    'rgba(255,255,255,0.18)');
  sg.addColorStop(0.35, 'rgba(255,255,255,0.07)');
  sg.addColorStop(0.7,  'rgba(255,255,255,0.02)');
  sg.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx - radius * 0.6, topY + radius);
  ctx.lineTo(cx + radius * 0.6, topY + radius);
  ctx.closePath();
  ctx.fill();

  // Accent colour tint halo
  const ag = ctx.createRadialGradient(cx, topY + radius * 0.55, 0, cx, topY + radius * 0.55, radius * 0.55);
  ag.addColorStop(0, accentColor + '22');
  ag.addColorStop(1, 'transparent');
  ctx.fillStyle = ag;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW: pedestal disc with fog/mist
════════════════════════════════════════════════════════════════════════ */
function drawPedestal(ctx, cx, cy, rx, ry, accentColor) {
  ctx.save();

  // Mist/fog glow beneath
  const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx * 1.5);
  fg.addColorStop(0,   'rgba(255,255,255,0.12)');
  fg.addColorStop(0.4, 'rgba(255,255,255,0.04)');
  fg.addColorStop(1,   'transparent');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 1.5, ry * 2.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Accent glow ring
  const rng = ctx.createRadialGradient(cx, cy, rx * 0.3, cx, cy, rx);
  rng.addColorStop(0, accentColor + '00');
  rng.addColorStop(0.7, accentColor + '33');
  rng.addColorStop(1,   accentColor + '00');
  ctx.fillStyle = rng;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  // Top disc surface (lighter ellipse)
  const dg = ctx.createRadialGradient(cx, cy - ry * 0.2, 0, cx, cy, rx);
  dg.addColorStop(0,   'rgba(255,255,255,0.22)');
  dg.addColorStop(0.6, 'rgba(255,255,255,0.08)');
  dg.addColorStop(1,   'rgba(255,255,255,0.02)');
  ctx.fillStyle = dg;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW: giant ghost product-name typography behind product
════════════════════════════════════════════════════════════════════════ */
function drawGhostType(ctx, W, H, text, centerX, centerY, accentColor) {
  if (!text) return;
  ctx.save();
  // Fit text to ~88% of width
  const maxW = W * 0.88;
  let fontSize = Math.round(W * 0.18);
  ctx.font = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`;
  while (ctx.measureText(text).width > maxW && fontSize > 24) {
    fontSize -= 4;
    ctx.font = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Gradient fill: top-to-bottom fade, very subtle
  const tg = ctx.createLinearGradient(centerX, centerY - fontSize * 0.6, centerX, centerY + fontSize * 0.6);
  tg.addColorStop(0,   'rgba(255,255,255,0.09)');
  tg.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  tg.addColorStop(1,   'rgba(255,255,255,0.01)');
  ctx.fillStyle = tg;
  ctx.fillText(text, centerX, centerY);
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW: feature callout chip  (pill: dark translucent fill, accent border)
════════════════════════════════════════════════════════════════════════ */
function drawFeatureChip(ctx, x, y, text, accentColor, fontSize, side = 'left') {
  ctx.save();
  ctx.font = `600 ${fontSize}px Arial, sans-serif`;
  const tw   = ctx.measureText(text).width;
  const padX = fontSize * 1.0;
  const padY = fontSize * 0.55;
  const w    = tw + padX * 2;
  const h    = fontSize + padY * 2;
  const bx   = side === 'right' ? x - w : x;

  // Dark glass fill
  roundRect(ctx, bx, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(10,10,14,0.78)';
  ctx.fill();
  // Accent border
  roundRect(ctx, bx, y, w, h, h / 2);
  ctx.strokeStyle = accentColor + 'aa';
  ctx.lineWidth   = Math.max(1.5, fontSize * 0.08);
  ctx.stroke();
  // Text
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + w / 2, y + h / 2 + 1);
  ctx.restore();
  return h; // return chip height
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW: discount badge — top-left corner pill
════════════════════════════════════════════════════════════════════════ */
function drawDiscountBadge(ctx, x, y, discountPct, accentColor) {
  if (!discountPct || discountPct <= 0) return;
  ctx.save();
  const sz  = Math.round(x * 2.2); // badge size relative to pad
  const r   = sz * 0.18;
  // Fill
  roundRect(ctx, x, y, sz, sz * 0.88, r);
  ctx.fillStyle = 'rgba(8,8,12,0.88)';
  ctx.fill();
  // Accent outline glow
  roundRect(ctx, x, y, sz, sz * 0.88, r);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth   = Math.max(2, sz * 0.04);
  ctx.shadowColor = accentColor;
  ctx.shadowBlur  = sz * 0.18;
  ctx.stroke();
  ctx.shadowBlur  = 0;
  // "UPTO" small text
  ctx.font         = `600 ${Math.round(sz * 0.16)}px Arial, sans-serif`;
  ctx.fillStyle    = 'rgba(255,255,255,0.65)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('UPTO', x + sz / 2, y + sz * 0.08);
  // Percent number
  ctx.font      = `900 ${Math.round(sz * 0.38)}px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle = accentColor;
  ctx.shadowColor = accentColor; ctx.shadowBlur = sz * 0.12;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${discountPct}%`, x + sz / 2, y + sz * 0.52);
  ctx.shadowBlur = 0;
  // "OFF" text
  ctx.font      = `800 ${Math.round(sz * 0.19)}px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'bottom';
  ctx.fillText('OFF', x + sz / 2, y + sz * 0.86);
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW: floating dot particles (ambient atmosphere)
════════════════════════════════════════════════════════════════════════ */
function drawParticles(ctx, W, H, accentColor, count = 22, seed = 77) {
  const rng = seededRng(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const px = rng() * W;
    const py = rng() * H;
    const pr = W * (0.003 + rng() * 0.008);
    const pa = 0.08 + rng() * 0.22;
    // Alternate between white and accent
    const col = rng() > 0.5 ? `rgba(255,255,255,${pa})` : accentColor + Math.round(pa * 255).toString(16).padStart(2,'0');
    const pg = ctx.createRadialGradient(px, py, 0, px, py, pr * 2.5);
    pg.addColorStop(0, col);
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(px, py, pr * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW: horizontal spec bar  (e.g. "10 Min = 180 Min" style)
════════════════════════════════════════════════════════════════════════ */
function drawSpecBar(ctx, x, y, w, specs, accentColor, fontSize) {
  if (!specs || specs.length === 0) return;
  ctx.save();
  const h   = fontSize * 2.8;
  const r   = h * 0.18;
  // Background
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  roundRect(ctx, x, y, w, h, r);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const colW = w / specs.length;
  specs.forEach((spec, i) => {
    const cx2 = x + colW * i + colW / 2;
    // Divider
    if (i > 0) {
      ctx.beginPath();
      ctx.moveTo(x + colW * i, y + h * 0.2);
      ctx.lineTo(x + colW * i, y + h * 0.8);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.font         = `700 ${Math.round(fontSize * 0.95)}px Arial, sans-serif`;
    ctx.fillStyle    = accentColor;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(spec.value, cx2, y + h * 0.35);
    ctx.font         = `400 ${Math.round(fontSize * 0.72)}px Arial, sans-serif`;
    ctx.fillStyle    = 'rgba(255,255,255,0.55)';
    ctx.fillText(spec.label, cx2, y + h * 0.72);
  });
  ctx.restore();
}

/* ════════════════════════════════════════════════════════════════════════
   MASTER CINEMATIC RENDERER
   All products use this same layout — only content & accent colour vary
════════════════════════════════════════════════════════════════════════ */
async function renderCinematic(canvas, params) {
  const {
    format, product, headline, badgeLabel,
    discountPct, originalPrice, salePrice,
    cta, features, whatsapp, website,
    accentColor, logoText, tagline,
  } = params;

  const W   = format.w;
  const H   = format.h;
  const ACC = accentColor || '#e8eaf0';
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const pad = Math.round(W * 0.048);
  const isSq     = Math.abs(W - H) < 50;
  const isStory  = H > W * 1.5;
  const isBanner = W > H * 1.7;

  /* ── 1. DEEP DARK BACKGROUND ── */
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.82);
  bg.addColorStop(0,    '#1c1c24');
  bg.addColorStop(0.45, '#111116');
  bg.addColorStop(1,    '#06060a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* ── 2. SUBTLE VIGNETTE (darken corners) ── */
  ctx.save();
  const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  /* ── 3. DOT-GRAIN TEXTURE ── */
  drawGrain(ctx, W, H, 0.022);

  /* ── 4. AMBIENT PARTICLES ── */
  drawParticles(ctx, W, H, ACC, 26, 113);

  /* ────────────────────────────────────────────────
     LAYOUT ZONES
  ─────────────────────────────────────────────── */
  // Product zone — centred vertically, slight upper bias
  const prodZoneW = isBanner ? W * 0.36 : isSq ? W * 0.52 : W * 0.60;
  const prodZoneH = isBanner ? H * 0.76 : isSq ? H * 0.46 : isStory ? H * 0.38 : H * 0.52;
  const prodZoneX = isBanner ? W * 0.32 : (W - prodZoneW) / 2;
  const prodZoneY = isBanner ? H * 0.12 : isStory ? H * 0.24 : H * 0.18;

  const prodCX = prodZoneX + prodZoneW / 2;
  const prodCY = prodZoneY + prodZoneH / 2;

  /* ── 5. GHOST TYPOGRAPHY (behind product) ── */
  const ghostText = (product?.brand || product?.name || headline || 'PRODUCT').toUpperCase().split(' ')[0];
  drawGhostType(ctx, W, H, ghostText, prodCX, prodCY, ACC);

  /* ── 6. SPOTLIGHT FROM ABOVE ── */
  const spotR = Math.max(W, H) * (isBanner ? 0.55 : 0.70);
  drawSpotlight(ctx, W, H, prodCX, -spotR * 0.05, spotR, ACC);

  /* ── 7. PEDESTAL / STAGE ── */
  const pedestalRX = prodZoneW * 0.42;
  const pedestalRY = pedestalRX * 0.22;
  const pedestalY  = prodZoneY + prodZoneH + pedestalRY * 0.5;
  drawPedestal(ctx, prodCX, pedestalY, pedestalRX, pedestalRY, ACC);

  /* ── 8. PRODUCT IMAGE ── */
  try {
    const img = await loadImage(product?.thumbnail);
    ctx.save();
    // Subtle drop shadow below product
    ctx.shadowColor  = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur   = prodZoneW * 0.18;
    ctx.shadowOffsetY = prodZoneH * 0.06;

    // Accent colour glow halo
    const imgGlow = ctx.createRadialGradient(prodCX, prodCY, 0, prodCX, prodCY, prodZoneW * 0.55);
    imgGlow.addColorStop(0, ACC + '18');
    imgGlow.addColorStop(1, 'transparent');
    ctx.fillStyle = imgGlow;
    ctx.fillRect(0, 0, W, H);

    const sc = Math.min(prodZoneW / img.width, prodZoneH / img.height);
    const dw = img.width * sc;
    const dh = img.height * sc;
    const dx = prodZoneX + (prodZoneW - dw) / 2;
    const dy = prodZoneY + (prodZoneH - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } catch { /* no image */ }

  /* ── 9. LOGO — top-left ── */
  const logoSz = Math.round(W * 0.028);
  ctx.save();
  ctx.font         = `700 ${logoSz}px Arial, sans-serif`;
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(logoText || 'ShopZen.lk', pad, pad * 0.85);
  ctx.font      = `400 ${Math.round(logoSz * 0.48)}px Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fillText(tagline || 'SMART CHOICES · BETTER LIVING', pad, pad * 0.85 + logoSz * 1.35);
  ctx.restore();

  /* ── 10. TOP-RIGHT BADGE LABEL ("NEW ARRIVAL" / "FLASH DEAL") ── */
  const blText = (badgeLabel || 'NEW ARRIVAL').split('\n')[0].toUpperCase();
  const blSz   = Math.round(W * 0.018);
  ctx.save();
  ctx.font         = `700 ${blSz}px Arial, sans-serif`;
  const blW        = ctx.measureText(blText).width + blSz * 1.6;
  const blH        = blSz * 2.2;
  const blX        = W - pad - blW;
  const blY        = pad * 0.85;
  roundRect(ctx, blX, blY, blW, blH, blH / 2);
  ctx.strokeStyle  = ACC + 'cc';
  ctx.lineWidth    = Math.max(1.5, blSz * 0.07);
  ctx.shadowColor  = ACC;
  ctx.shadowBlur   = blH;
  ctx.stroke();
  ctx.fillStyle    = 'rgba(8,8,12,0.72)';
  ctx.fill();
  ctx.shadowBlur   = 0;
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(blText, blX + blW / 2, blY + blH / 2 + 1);
  ctx.restore();

  /* ── 11. DISCOUNT BADGE — below logo ── */
  const discountBadgeY = pad * 0.85 + logoSz * 1.35 + logoSz * 0.55 + pad * 0.5;
  if (Number(discountPct) > 0) {
    drawDiscountBadge(ctx, pad, discountBadgeY, discountPct, ACC);
  }

  /* ── 12. HEADLINE  (product name / custom headline) ── */
  // Positioned below the product zone or in banner left-side
  let headlineY, headlineX, headlineMaxW;
  if (isBanner) {
    headlineX    = pad;
    headlineY    = H * 0.10;
    headlineMaxW = W * 0.28;
  } else if (isSq) {
    headlineX    = pad;
    headlineY    = prodZoneY + prodZoneH + pedestalRY * 1.8 + pad * 0.35;
    headlineMaxW = W - pad * 2;
  } else {
    headlineX    = pad;
    headlineY    = prodZoneY + prodZoneH + pedestalRY * 1.8 + pad * 0.3;
    headlineMaxW = W - pad * 2;
  }
  const hlSz = Math.round(W * (isBanner ? 0.034 : isSq ? 0.030 : 0.032));
  ctx.save();
  ctx.font         = `900 ${hlSz}px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  const hlLines = wrapText(ctx, headline || product?.name || '', headlineMaxW, 2);
  let afterHL = headlineY;
  hlLines.forEach(line => {
    ctx.fillText(line, headlineX, afterHL);
    afterHL += hlSz * 1.25;
  });
  ctx.restore();

  /* ── 13. PRICE BLOCK — below headline ── */
  if (salePrice || originalPrice) {
    const mainP = salePrice || originalPrice;
    const pSz   = Math.round(W * (isBanner ? 0.032 : 0.034));
    ctx.save();
    ctx.font         = `900 ${pSz}px 'Arial Black', Arial, sans-serif`;
    ctx.fillStyle    = ACC;
    ctx.shadowColor  = ACC;
    ctx.shadowBlur   = pSz * 0.5;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtLKR(mainP), headlineX, afterHL + pad * 0.18);
    ctx.shadowBlur = 0;

    if (Number(originalPrice) > Number(salePrice) && salePrice) {
      const oSz  = Math.round(pSz * 0.52);
      const oStr = fmtLKR(originalPrice);
      const mainW2 = ctx.measureText(fmtLKR(mainP)).width;
      const oX   = headlineX + mainW2 + pSz * 0.35;
      const oY   = afterHL + pad * 0.18 + pSz * 0.22;
      ctx.font      = `400 ${oSz}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(oStr, oX, oY);
      const ow = ctx.measureText(oStr).width;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth   = Math.max(1.5, oSz * 0.07);
      ctx.moveTo(oX, oY + oSz * 0.56);
      ctx.lineTo(oX + ow, oY + oSz * 0.56);
      ctx.stroke();
    }
    afterHL += pSz * 1.5 + pad * 0.18;
    ctx.restore();
  }

  /* ── 14. FEATURE CALLOUT CHIPS ── */
  // Place chips left & right of product zone
  const fts   = features || [];
  const chipSz = Math.round(W * (isBanner ? 0.016 : 0.017));
  const chipGap = chipSz * 3.2;
  const leftChips  = fts.filter((_, i) => i % 2 === 0).slice(0, 3);
  const rightChips = fts.filter((_, i) => i % 2 !== 0).slice(0, 3);

  if (!isBanner) {
    // Left chips
    const leftEdge = Math.round(pad * 0.5);
    const chipStartY = prodZoneY + prodZoneH * 0.18;
    leftChips.forEach((ft, i) => {
      drawFeatureChip(ctx, leftEdge, chipStartY + i * chipGap, ft, ACC, chipSz, 'left');
    });
    // Right chips
    const rightEdge = W - Math.round(pad * 0.5);
    rightChips.forEach((ft, i) => {
      drawFeatureChip(ctx, rightEdge, chipStartY + i * chipGap, ft, ACC, chipSz, 'right');
    });
  }

  /* ── 15. SPEC BAR (horizontal key specs below price) ── */
  // Only shown on square/story when there's space
  if (!isBanner && afterHL + pad * 2 < H * 0.82) {
    const specs = [];
    if (product?.specs) {
      // product.specs can be an array of {label, value} or a simple string
      if (Array.isArray(product.specs)) specs.push(...product.specs.slice(0, 3));
    }
    if (specs.length >= 2) {
      drawSpecBar(ctx, headlineX, afterHL, headlineMaxW * 0.85, specs, ACC, chipSz);
      afterHL += chipSz * 2.8 + pad * 0.35;
    }
  }

  /* ── 16. CTA BUTTON — bottom-centre ── */
  const ctaSz  = Math.round(W * (isBanner ? 0.020 : 0.022));
  const ctaStr = (cta || 'SHOP NOW').toUpperCase();
  ctx.save();
  ctx.font = `800 ${ctaSz}px 'Arial Black', Arial, sans-serif`;
  const ctaTW = ctx.measureText(ctaStr).width;
  const ctaBW = ctaTW + ctaSz * 3.2;
  const ctaBH = ctaSz * 2.8;
  let ctaY;
  if (isBanner) {
    ctaY = H - Math.round(H * 0.14) - ctaBH / 2;
  } else {
    ctaY = H - Math.round(H * 0.09) - ctaBH - pad * 0.5;
  }
  const ctaX = (W - ctaBW) / 2;
  // Glow behind button
  ctx.shadowColor = ACC;
  ctx.shadowBlur  = ctaBH * 0.9;
  roundRect(ctx, ctaX, ctaY, ctaBW, ctaBH, ctaBH / 2);
  const ctaG = ctx.createLinearGradient(ctaX, ctaY, ctaX + ctaBW, ctaY + ctaBH);
  ctaG.addColorStop(0, ACC);
  ctaG.addColorStop(1, ACC + 'aa');
  ctx.fillStyle = ctaG;
  ctx.fill();
  ctx.shadowBlur = 0;
  // Shine
  roundRect(ctx, ctaX, ctaY, ctaBW, ctaBH * 0.48, ctaBH / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fill();
  // Arrow + text
  ctx.fillStyle    = '#06060a';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`→  ${ctaStr}`, ctaX + ctaBW / 2, ctaY + ctaBH / 2 + 1);
  ctx.restore();

  /* ── 17. FOOTER BAR ── */
  const fH = Math.round(H * 0.085);
  const fY = H - fH;
  // Subtle dark footer bg
  const fBg = ctx.createLinearGradient(0, fY, 0, H);
  fBg.addColorStop(0, 'rgba(6,6,10,0.0)');
  fBg.addColorStop(0.3, 'rgba(6,6,10,0.88)');
  fBg.addColorStop(1, 'rgba(6,6,10,0.98)');
  ctx.fillStyle = fBg;
  ctx.fillRect(0, fY, W, fH);

  const fSz  = Math.round(W * 0.018);
  const fCY  = fY + fH * 0.55;
  const fIconR = Math.round(fSz * 1.1);

  // WhatsApp circle
  ctx.save();
  ctx.beginPath(); ctx.arc(pad + fIconR, fCY, fIconR, 0, Math.PI * 2);
  ctx.fillStyle = '#25D366'; ctx.shadowColor = '#25D366'; ctx.shadowBlur = fIconR * 1.2;
  ctx.fill(); ctx.shadowBlur = 0;
  ctx.font = `${fIconR * 1.1}px Arial`; ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('💬', pad + fIconR, fCY);
  ctx.font      = `600 ${fSz}px Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.80)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(whatsapp || '0775474001', pad + fIconR * 2 + pad * 0.22, fCY);
  ctx.restore();

  // Website globe circle
  ctx.save();
  const webStr  = website || 'ShopZen.lk';
  ctx.font      = `600 ${fSz}px Arial, sans-serif`;
  const webTW   = ctx.measureText(webStr).width;
  const wbX     = W - pad - webTW - fIconR * 2 - pad * 0.22;
  ctx.beginPath(); ctx.arc(wbX + fIconR, fCY, fIconR, 0, Math.PI * 2);
  ctx.fillStyle = ACC; ctx.shadowColor = ACC; ctx.shadowBlur = fIconR * 1.2;
  ctx.fill(); ctx.shadowBlur = 0;
  ctx.font = `${fIconR * 1.1}px Arial`; ctx.fillStyle = '#06060a';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🌐', wbX + fIconR, fCY);
  ctx.font = `600 ${fSz}px Arial, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.80)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(webStr, wbX + fIconR * 2 + pad * 0.22, fCY);
  ctx.restore();
}

async function renderCreative(canvas, params) {
  return renderCinematic(canvas, params);
}

/* ════════════════════════════════════════════════════════════════════════
   PRODUCT PICKER MODAL
════════════════════════════════════════════════════════════════════════ */
function ProductPickerModal({ onClose, onConfirm, initialSelected }) {
  const [products, setProducts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState(initialSelected || []);
  const timer = useRef(null);

  const fetchProducts = useCallback(async (q) => {
    setLoading(true);
    try {
      const { data } = await API.get(`/ai-post-creator/products?search=${encodeURIComponent(q)}&limit=30`);
      setProducts(data.products || []);
    } catch { toast.error('Could not load products'); }
    finally   { setLoading(false); }
  }, []);

  useEffect(() => { fetchProducts(''); }, [fetchProducts]);

  const onSearch = (v) => {
    setSearch(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => fetchProducts(v), 350);
  };

  const isSelected = (id) => selected.some(p => p._id === id);
  const toggle     = (p)  => setSelected(prev =>
    isSelected(p._id) ? prev.filter(x => x._id !== p._id) : [...prev, p]);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10 rounded-t-2xl">
          <h2 className="font-display font-bold text-xl text-gray-900">Select Product</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 text-gray-500">✕</button>
        </div>
        <div className="p-5">
          <input className="form-input mb-4" placeholder="Search by name, brand, or SKU…"
            value={search} onChange={e => onSearch(e.target.value)} />
          {loading ? (
            <div className="text-center text-gray-400 py-10">Loading…</div>
          ) : products.length === 0 ? (
            <div className="text-center text-gray-400 py-10">No products found</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto pr-1">
              {products.map(p => (
                <button type="button" key={p._id} onClick={() => toggle(p)}
                  className={`text-left rounded-xl border-2 p-2 transition-all ${isSelected(p._id) ? 'border-primary bg-primary/5' : 'border-gray-100 hover:border-gray-200'}`}>
                  <div className="w-full aspect-square rounded-lg bg-gray-50 overflow-hidden mb-2 flex items-center justify-center">
                    {p.thumbnail ? <img src={p.thumbnail} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-3xl">🛍️</span>}
                  </div>
                  <p className="text-xs font-semibold text-gray-800 line-clamp-2 leading-tight">{p.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {p.salePrice
                      ? <><span className="font-bold text-primary">{fmtLKR(p.salePrice)}</span> <span className="line-through text-gray-400">{fmtLKR(p.price)}</span></>
                      : fmtLKR(p.price)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 p-5 border-t border-gray-100 sticky bottom-0 bg-white rounded-b-2xl">
          <p className="text-sm text-gray-500">{selected.length} selected</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={() => onConfirm(selected)} disabled={selected.length === 0}
              className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed">
              Use {selected.length || ''} Product{selected.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TEMPLATE MODE VIEW — fully isolated UI for generationMode: "template"
   Renders inside the same AIPostCreator page, reusing the product picker
   and overlapping form fields (headline/CTA/discount/pricing) passed down
   as props, but never touches any AI Mode state (accentColor, features,
   photoreal, canvas ref, etc).
════════════════════════════════════════════════════════════════════════ */
function TemplateModeView({
  product, products, activeIdx, setActiveIdx,
  templateList, templatesLoading, selectedTemplateId, setSelectedTemplateId,
  headline, setHeadline, cta, setCta,
  templateDescription, setTemplateDescription,
  discountPct, setDiscountPct, originalPrice, setOriginalPrice, salePrice, setSalePrice,
  bgRemoving, cutoutDataUrl, runBackgroundRemoval,
  templateRendering, templateResultUrl, generateTemplateCreative,
  downloadCreative, getCurrentDataUrl,
  connectedPlatforms, publishPlatform, setPublishPlatform, handlePublish, publishing,
}) {
  return (
    <div className="grid lg:grid-cols-[400px_1fr] gap-6">

      {/* ── LEFT CONTROLS ── */}
      <div className="space-y-4">

        {/* Multi-product strip */}
        {products.length > 1 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-3">
            <p className="form-label mb-2">Editing Product</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {products.map((p, i) => (
                <button key={p._id} onClick={() => setActiveIdx(i)}
                  className={`shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 ${i === activeIdx ? 'border-primary' : 'border-gray-100'}`}>
                  {p.thumbnail ? <img src={p.thumbnail} alt={p.name} className="w-full h-full object-cover" /> : <span className="flex items-center justify-center w-full h-full text-xl">🛍️</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Template Picker */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-3">Choose Template</p>
          {templatesLoading ? (
            <p className="text-sm text-gray-400">Loading templates…</p>
          ) : templateList.length === 0 ? (
            <p className="text-sm text-gray-400">No templates available. Add PNGs + JSON configs under backend/templates/.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {templateList.map(t => (
                <button key={t.id} onClick={() => setSelectedTemplateId(t.id)}
                  className={`rounded-xl overflow-hidden border-2 transition-all text-left ${
                    selectedTemplateId === t.id ? 'border-primary ring-2 ring-primary/20' : 'border-gray-100 hover:border-gray-200'
                  }`}
                  title={t.description}>
                  <div className="w-full aspect-square bg-gray-50">
                    <img src={t.thumbnailUrl} alt={t.label} className="w-full h-full object-cover" />
                  </div>
                  <p className="text-[11px] font-semibold text-gray-700 px-1.5 py-1 truncate">{t.label}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Background Removal */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="form-label mb-0">Product Cutout</p>
            <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Runs in browser</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">Removes the background from the product photo before placing it into the template.</p>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-[length:10px_10px] bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0"
              style={{ backgroundImage: 'linear-gradient(45deg, #eee 25%, transparent 25%), linear-gradient(-45deg, #eee 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #eee 75%), linear-gradient(-45deg, transparent 75%, #eee 75%)', backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px' }}>
              {cutoutDataUrl
                ? <img src={cutoutDataUrl} alt="Cutout" className="w-full h-full object-contain" />
                : <span className="text-2xl opacity-30">🖼️</span>}
            </div>
            <button onClick={runBackgroundRemoval} disabled={bgRemoving || !product?.thumbnail}
              className="btn-primary text-sm flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
              {bgRemoving ? 'Removing background…' : cutoutDataUrl ? '↻ Re-run Removal' : '✂️ Remove Background'}
            </button>
          </div>
        </div>

        {/* Pricing */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-3">Pricing &amp; Discount</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="form-label">Discount %</label>
              <input className="form-input text-center font-bold text-lg" type="number" min="0" max="99"
                value={discountPct} onChange={e => setDiscountPct(Math.max(0, Math.min(99, parseInt(e.target.value)||0)))} />
            </div>
            <div>
              <label className="form-label">Original Price</label>
              <input className="form-input" type="number" min="0" value={originalPrice}
                onChange={e => setOriginalPrice(e.target.value)} placeholder="Rs." />
            </div>
            <div>
              <label className="form-label">Sale Price</label>
              <input className="form-input" type="number" min="0" value={salePrice}
                onChange={e => setSalePrice(e.target.value)} placeholder="Rs." />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">Discount % auto-calculated from prices.</p>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-3">Post Content</p>
          <div className="space-y-3">
            <div>
              <label className="form-label">Product Name</label>
              <input className="form-input" value={headline}
                onChange={e => setHeadline(e.target.value.slice(0, 60))} />
            </div>
            <div>
              <label className="form-label">Description</label>
              <textarea className="form-input" rows={2} value={templateDescription}
                onChange={e => setTemplateDescription(e.target.value.slice(0, 140))}
                placeholder="Short line shown on the creative (optional)" />
            </div>
            <div>
              <label className="form-label">CTA Button</label>
              <input className="form-input" value={cta}
                onChange={e => setCta(e.target.value.slice(0, 20))} placeholder="Shop Now" />
            </div>
          </div>
        </div>

        {/* Generate */}
        <button onClick={generateTemplateCreative} disabled={templateRendering || bgRemoving || !selectedTemplateId}
          className="btn-primary text-sm w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed">
          {templateRendering ? 'Generating…' : '🖼️ Generate Template Creative'}
        </button>
      </div>

      {/* ── RIGHT: PREVIEW + EXPORT ── */}
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="form-label mb-0">
              Preview
              {templateRendering && <span className="text-gray-400 text-xs normal-case ml-2">(rendering…)</span>}
            </p>
            <span className="text-xs text-gray-400 font-mono">1080 × 1080px</span>
          </div>
          <div className="bg-gray-900 rounded-xl p-3 flex items-center justify-center overflow-auto" style={{ minHeight: 340, maxHeight: '72vh' }}>
            {templateResultUrl ? (
              <img src={templateResultUrl} alt="Template creative preview"
                className="rounded-lg shadow-2xl max-w-full"
                style={{ maxHeight: '66vh', width: 'auto', height: 'auto' }} />
            ) : (
              <p className="text-gray-500 text-sm text-center px-6">
                Pick a template, remove the product's background, then click "Generate Template Creative" to see a preview here.
              </p>
            )}
          </div>
        </div>

        {/* Download */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-3">Download</p>
          <div className="flex flex-wrap gap-2 items-center">
            <p className="text-xs text-gray-400 flex-1">Template creatives download as PNG</p>
            <button onClick={downloadCreative} disabled={!getCurrentDataUrl()}
              className="btn-primary text-sm whitespace-nowrap disabled:opacity-50">
              ⬇ Download
            </button>
          </div>
        </div>

        {/* Publish */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-3">Publish to Social Media</p>
          {connectedPlatforms.length === 0 ? (
            <p className="text-sm text-gray-400">No social accounts connected. Connect one in <span className="font-semibold text-gray-500">Social Media</span> settings.</p>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              <select className="form-input flex-1 min-w-[160px]" value={publishPlatform} onChange={e => setPublishPlatform(e.target.value)}>
                <option value="">Select platform…</option>
                {connectedPlatforms.map(p => (
                  <option key={p.platform} value={p.platform}>
                    {PLATFORM_META[p.platform]?.label || p.platform}{p.accountName ? ` — ${p.accountName}` : ''}
                  </option>
                ))}
              </select>
              <button onClick={handlePublish} disabled={!publishPlatform || publishing || !templateResultUrl}
                className="btn-primary text-sm whitespace-nowrap disabled:opacity-50">
                {publishing ? 'Publishing…' : '📤 Publish Now'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN PAGE
════════════════════════════════════════════════════════════════════════ */
export default function AIPostCreator() {
  // ── generationMode: "ai" (existing flow, untouched) | "template" (new flow) ──
  const [generationMode, setGenerationMode] = useState('ai');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [products, setProducts]     = useState([]);
  const [activeIdx, setActiveIdx]   = useState(0);
  const [formatId, setFormatId]     = useState('instagram');

  // Accent palette
  const [paletteId, setPaletteId]     = useState('electric_white');
  const [customAccent, setCustomAccent] = useState('');

  // Content fields
  const [badgeLabel, setBadgeLabel]       = useState('NEW ARRIVAL');
  const [headline, setHeadline]           = useState('');
  const [caption, setCaption]             = useState('');
  const [cta, setCta]                     = useState('SHOP NOW');
  const [tagline, setTagline]             = useState('SMART CHOICES · BETTER LIVING');
  const [hashtags, setHashtags]           = useState([]);
  const [discountPct, setDiscountPct]     = useState(0);
  const [originalPrice, setOriginalPrice] = useState('');
  const [salePrice, setSalePrice]         = useState('');
  // Feature chips (up to 6)
  const [features, setFeatures]           = useState(['', '', '', '']);
  const [whatsapp, setWhatsapp]           = useState('0775474001');
  const [website, setWebsite]             = useState('ShopZen.lk');
  const [logoText, setLogoText]           = useState('ShopZen.lk');

  const [aiLoading, setAiLoading]         = useState(false);
  const [exportFormat, setExportFormat]   = useState('png');
  const [rendering, setRendering]         = useState(false);

  const [connectedPlatforms, setConnectedPlatforms] = useState([]);
  const [publishPlatform, setPublishPlatform]       = useState('');
  const [publishing, setPublishing]                 = useState(false);
  const [uploadedUrl, setUploadedUrl]               = useState('');

  const [viewMode, setViewMode]               = useState('canvas'); // 'canvas' | 'photoreal' — internal to AI Mode only
  const [photorealUrl, setPhotorealUrl]       = useState('');
  const [photorealLoading, setPhotorealLoading] = useState(false);

  /* ── Template Mode state — isolated from the AI Mode state above ── */
  const [templateList, setTemplateList]           = useState([]);
  const [templatesLoading, setTemplatesLoading]   = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [bgRemoving, setBgRemoving]               = useState(false);
  const [cutoutDataUrl, setCutoutDataUrl]         = useState('');     // background-removed product PNG
  const [templateResultUrl, setTemplateResultUrl] = useState('');     // final rendered 1080x1080 PNG
  const [templateRendering, setTemplateRendering] = useState(false);

  const canvasRef = useRef(null);
  // Ref to track if a template fetch has already been initiated (prevents
  // infinite re-fetch loops caused by state changes re-triggering the effect).
  const templatesFetchedRef = useRef(false);
  const format    = useMemo(() => FORMATS.find(f => f.id === formatId), [formatId]);
  const product   = products[activeIdx] || null;
  const palette   = ACCENT_PALETTES.find(p => p.id === paletteId) || ACCENT_PALETTES[0];
  const accentColor = customAccent || palette.color;

  useEffect(() => {
    API.get('/ai-post-creator/connected-platforms')
      .then(({ data }) => setConnectedPlatforms(data.platforms || []))
      .catch(() => {});
  }, []);

  /* ── Template Mode: fetch available templates exactly once, the first time
     the admin switches into Template Mode. Uses a ref (not state) to gate the
     fetch so that state updates (templatesLoading, templateList) never cause
     this effect to re-run and create an infinite request loop. ── */
  useEffect(() => {
    if (generationMode !== 'template') return;
    if (templatesFetchedRef.current) return;   // already fetched or in-flight
    templatesFetchedRef.current = true;         // mark immediately — before await
    setTemplatesLoading(true);
    API.get('/ai-post-creator/templates')
      .then(({ data }) => {
        const list = data.templates || [];
        setTemplateList(list);
        if (list.length > 0) setSelectedTemplateId(prev => prev || list[0].id);
      })
      .catch(() => {
        toast.error('Could not load templates');
        // Allow a manual retry by resetting the ref only on failure
        templatesFetchedRef.current = false;
      })
      .finally(() => setTemplatesLoading(false));
  }, [generationMode]); // ← only re-run when mode changes, NOT on loading/list state

  useEffect(() => {
    if (!product) return;
    setOriginalPrice(String(product.price || ''));
    setSalePrice(String(product.salePrice || ''));
    setDiscountPct(product.discount || 0);
    setHeadline(product.name || '');
    setBadgeLabel(product.discount > 0 ? 'HOT DEAL' : 'NEW ARRIVAL');
    setUploadedUrl('');
    setPhotorealUrl('');
    setViewMode('canvas');
    // Template Mode: product-specific results don't carry over to a new product
    setCutoutDataUrl('');
    setTemplateResultUrl('');
  }, [product?._id]); // eslint-disable-line

  useEffect(() => {
    const orig = parseFloat(originalPrice);
    const sale = parseFloat(salePrice);
    if (orig > 0 && sale > 0 && sale < orig) {
      setDiscountPct(Math.round(((orig - sale) / orig) * 100));
    }
  }, [originalPrice, salePrice]);

  const renderParams = useMemo(() => ({
    format,
    product,
    headline,
    badgeLabel,
    discountPct: Number(discountPct) || 0,
    originalPrice: parseFloat(originalPrice) || 0,
    salePrice:     parseFloat(salePrice) || 0,
    cta,
    features: features.filter(Boolean),
    whatsapp,
    website,
    accentColor,
    logoText,
    tagline,
  }), [format, product, headline, badgeLabel, discountPct, originalPrice, salePrice,
       cta, features, whatsapp, website, accentColor, logoText, tagline]);

  useEffect(() => {
    if (viewMode !== 'canvas' || !product || !canvasRef.current) return;
    setRendering(true);
    renderCreative(canvasRef.current, renderParams).finally(() => setRendering(false));
  }, [viewMode, renderParams, product]);

  const handlePickProducts = (picked) => {
    setProducts(picked);
    setActiveIdx(0);
    setPickerOpen(false);
  };

  const updateFeature = (i, val) => {
    setFeatures(prev => { const n = [...prev]; n[i] = val; return n; });
  };

  const generateAICopy = async () => {
    if (!product) return;
    setAiLoading(true);
    try {
      const { data } = await API.post('/ai-post-creator/generate-copy', {
        name: product.name, category: product.category, brand: product.brand,
        price: parseFloat(salePrice) || parseFloat(originalPrice) || product.price,
        discount: discountPct, template: 'cinematic',
      });
      setHeadline(data.headline);
      setCaption(data.caption);
      setCta(data.cta);
      setHashtags(data.hashtags || []);
      if (data.features) setFeatures(data.features.slice(0, 6).concat(['','','','','','']).slice(0,6));
      if (data.badgeLabel) setBadgeLabel(data.badgeLabel);
      toast.success('AI copy generated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'AI generation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const generatePhotoreal = async () => {
    if (!product?.thumbnail) { toast.error('This product has no image'); return; }
    setPhotorealLoading(true);
    try {
      const { data } = await API.post('/ai-post-creator/generate-photoreal', {
        name: product.name, category: product.category, brand: product.brand,
        price: parseFloat(salePrice) || parseFloat(originalPrice) || product.price,
        discount: discountPct, template: 'cinematic', badgeLabel, headline,
        productImageUrl: product.thumbnail, storeName: logoText,
        accentColor,
      });
      setPhotorealUrl(data.dataUrl);
      setViewMode('photoreal');
      setUploadedUrl('');
      toast.success('Photoreal creative generated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Photoreal generation failed');
    } finally {
      setPhotorealLoading(false);
    }
  };

  /* ══════════════════════════════════════════════════════════════════════
     TEMPLATE MODE HANDLERS — isolated from AI Mode handlers above.
     Step 1: remove the product photo's background client-side (WASM).
     Step 2: send the cutout + template id + form fields to the backend,
             which composites everything server-side with Sharp.
  ══════════════════════════════════════════════════════════════════════ */
  const runBackgroundRemoval = async () => {
    if (!product?.thumbnail) { toast.error('This product has no image'); return null; }
    setBgRemoving(true);
    setTemplateResultUrl('');
    try {
      const dataUrl = await removeImageBackground(product.thumbnail, API);
      setCutoutDataUrl(dataUrl);
      toast.success('Background removed');
      return dataUrl;
    } catch (err) {
      console.error('[BG Removal] Full error:', err);
      // Extract the actual server error message from the axios response body
      const serverMsg = err?.response?.data?.message;
      const msg = serverMsg || err?.message || 'Unknown error';
      toast.error(`Background removal failed: ${msg}`);
      return null;
    } finally {
      setBgRemoving(false);
    }
  };

  const generateTemplateCreative = async () => {
    if (!product) { toast.error('Select a product first'); return; }
    if (!selectedTemplateId) { toast.error('Choose a template first'); return; }

    setTemplateRendering(true);
    try {
      const cutout = cutoutDataUrl || await runBackgroundRemoval();
      if (!cutout) return;

      const { data } = await API.post('/ai-post-creator/generate-template', {
        templateId: selectedTemplateId,
        productImageDataUrl: cutout,
        name: headline || product.name,
        price: parseFloat(salePrice) || parseFloat(originalPrice) || product.price,
        originalPrice: parseFloat(originalPrice) || product.price,
        discount: discountPct,
        cta,
        description: templateDescription,
      });
      setTemplateResultUrl(data.dataUrl);
      setUploadedUrl('');
      toast.success('Template creative generated');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Template generation failed');
    } finally {
      setTemplateRendering(false);
    }
  };


  const exportMime   = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[exportFormat];
  const getCurrentDataUrl = () => {
    if (generationMode === 'template') return templateResultUrl || null;
    if (viewMode === 'photoreal') return photorealUrl || null;
    return canvasRef.current ? canvasRef.current.toDataURL(exportMime, 0.93) : null;
  };

  const downloadCreative = () => {
    const dataUrl = getCurrentDataUrl();
    if (!dataUrl) return;
    const ext = generationMode === 'template' ? 'png' : (viewMode === 'photoreal' ? 'png' : exportFormat);
    const link = document.createElement('a');
    link.download = `${(product?.name || 'creative').slice(0, 30).replace(/\s+/g, '-')}-${formatId}.${ext}`;
    link.href = dataUrl;
    link.click();
    toast.success('Creative downloaded');
  };

  const uploadCreative = async () => {
    const dataUrl = getCurrentDataUrl();
    if (!dataUrl) return null;
    const format = generationMode === 'template' ? 'png' : (viewMode === 'photoreal' ? 'png' : exportFormat);
    const { data } = await API.post('/ai-post-creator/upload-creative', {
      dataUrl, format,
    });
    setUploadedUrl(data.url);
    return data.url;
  };

  const handlePublish = async () => {
    if (!publishPlatform || !product) return;
    setPublishing(true);
    try {
      const url = uploadedUrl || await uploadCreative();
      const fullCaption = generationMode === 'template'
        ? [headline || product.name, templateDescription].filter(Boolean).join('\n\n')
        : [headline, caption, hashtags.map(h => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
      await API.post('/ai-post-creator/publish', {
        platform: publishPlatform, imageUrl: url, caption: fullCaption,
        productUrl: product.slug ? `${window.location.origin}/product/${product.slug}` : '',
        productName: product.name,
      });
      toast.success(`Published to ${PLATFORM_META[publishPlatform]?.label}`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  /* ── JSX ── */
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-gray-900">AI Post Creator</h2>
          <p className="text-sm text-gray-500">
            {generationMode === 'template'
              ? 'Template Mode — drop a product into a designed PNG template, background removed automatically'
              : 'Cinematic studio template — change accent colour & content, keep the premium look consistent'}
          </p>
        </div>
        <button onClick={() => setPickerOpen(true)} className="btn-primary text-sm">
          {products.length ? 'Change Product' : '+ Select Product'}
        </button>
      </div>

      {/* Generation Mode Toggle */}
      <div className="inline-flex bg-gray-100 rounded-xl p-1 mb-6">
        <button
          onClick={() => setGenerationMode('ai')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            generationMode === 'ai' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}>
          ✨ AI Mode
        </button>
        <button
          onClick={() => setGenerationMode('template')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            generationMode === 'template' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
          }`}>
          🖼️ Template Mode
        </button>
      </div>

      {products.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <p className="text-5xl mb-4">{generationMode === 'template' ? '🖼️' : '🎬'}</p>
          <p className="text-gray-500 mb-4">
            {generationMode === 'template'
              ? 'Select a product to place it into a ready-made template'
              : 'Select a product to generate a cinematic studio post'}
          </p>
          <button onClick={() => setPickerOpen(true)} className="btn-primary text-sm">Select Product</button>
        </div>
      ) : generationMode === 'template' ? (
        <TemplateModeView
          product={product}
          products={products}
          activeIdx={activeIdx}
          setActiveIdx={setActiveIdx}
          templateList={templateList}
          templatesLoading={templatesLoading}
          selectedTemplateId={selectedTemplateId}
          setSelectedTemplateId={setSelectedTemplateId}
          headline={headline}
          setHeadline={setHeadline}
          cta={cta}
          setCta={setCta}
          templateDescription={templateDescription}
          setTemplateDescription={setTemplateDescription}
          discountPct={discountPct}
          setDiscountPct={setDiscountPct}
          originalPrice={originalPrice}
          setOriginalPrice={setOriginalPrice}
          salePrice={salePrice}
          setSalePrice={setSalePrice}
          bgRemoving={bgRemoving}
          cutoutDataUrl={cutoutDataUrl}
          runBackgroundRemoval={runBackgroundRemoval}
          templateRendering={templateRendering}
          templateResultUrl={templateResultUrl}
          generateTemplateCreative={generateTemplateCreative}
          downloadCreative={downloadCreative}
          getCurrentDataUrl={getCurrentDataUrl}
          connectedPlatforms={connectedPlatforms}
          publishPlatform={publishPlatform}
          setPublishPlatform={setPublishPlatform}
          handlePublish={handlePublish}
          publishing={publishing}
        />
      ) : (
        <div className="grid lg:grid-cols-[400px_1fr] gap-6">

          {/* ── LEFT CONTROLS ── */}
          <div className="space-y-4">

            {/* Multi-product strip */}
            {products.length > 1 && (
              <div className="bg-white rounded-2xl border border-gray-100 p-3">
                <p className="form-label mb-2">Editing Product</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {products.map((p, i) => (
                    <button key={p._id} onClick={() => setActiveIdx(i)}
                      className={`shrink-0 w-14 h-14 rounded-xl overflow-hidden border-2 ${i === activeIdx ? 'border-primary' : 'border-gray-100'}`}>
                      {p.thumbnail ? <img src={p.thumbnail} alt={p.name} className="w-full h-full object-cover" /> : <span className="flex items-center justify-center w-full h-full text-xl">🛍️</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Accent Colour */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-3">Accent Colour</p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {ACCENT_PALETTES.map(p => (
                  <button key={p.id} onClick={() => { setPaletteId(p.id); setCustomAccent(''); }}
                    className={`rounded-xl h-10 flex items-center justify-center border-2 transition-all text-xs font-bold ${paletteId === p.id && !customAccent ? 'border-gray-800 ring-2 ring-gray-400/30' : 'border-transparent'}`}
                    style={{ background: `linear-gradient(135deg, ${p.color}cc, ${p.glow}cc)` }}
                    title={p.label}>
                    <span className="text-white drop-shadow text-[10px]">{p.label.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <input type="color" value={accentColor}
                  onChange={e => { setCustomAccent(e.target.value); setPaletteId(''); }}
                  className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer" />
                <span className="text-xs text-gray-400 font-mono">{accentColor}</span>
                {customAccent && <button onClick={() => { setCustomAccent(''); setPaletteId('electric_white'); }} className="text-xs text-gray-400 hover:text-gray-600">Reset</button>}
              </div>
            </div>

            {/* Format */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-2">Output Format</p>
              <select className="form-input" value={formatId} onChange={e => setFormatId(e.target.value)}>
                {FORMATS.map(f => <option key={f.id} value={f.id}>{f.label} ({f.w}×{f.h})</option>)}
              </select>
            </div>

            {/* Pricing */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-3">Pricing &amp; Discount</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Discount %</label>
                  <input className="form-input text-center font-bold text-lg" type="number" min="0" max="99"
                    value={discountPct} onChange={e => setDiscountPct(Math.max(0, Math.min(99, parseInt(e.target.value)||0)))} />
                </div>
                <div>
                  <label className="form-label">Original Price</label>
                  <input className="form-input" type="number" min="0" value={originalPrice}
                    onChange={e => setOriginalPrice(e.target.value)} placeholder="Rs." />
                </div>
                <div>
                  <label className="form-label">Sale Price</label>
                  <input className="form-input" type="number" min="0" value={salePrice}
                    onChange={e => setSalePrice(e.target.value)} placeholder="Rs." />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">Discount % auto-calculated from prices.</p>
            </div>

            {/* Content */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="form-label mb-0">Post Content</p>
                <button onClick={generateAICopy} disabled={aiLoading}
                  className="text-xs font-bold text-primary hover:underline disabled:opacity-50">
                  {aiLoading ? 'Generating…' : '✨ AI Generate'}
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="form-label">Top Badge Text</label>
                  <input className="form-input" value={badgeLabel}
                    onChange={e => setBadgeLabel(e.target.value.slice(0, 30))} placeholder="NEW ARRIVAL / HOT DEAL" />
                </div>
                <div>
                  <label className="form-label">Headline</label>
                  <input className="form-input" value={headline}
                    onChange={e => setHeadline(e.target.value.slice(0, 60))} />
                </div>
                <div>
                  <label className="form-label">CTA Button</label>
                  <input className="form-input" value={cta}
                    onChange={e => setCta(e.target.value.slice(0, 20))} placeholder="SHOP NOW" />
                </div>
                <div>
                  <label className="form-label">Caption (for publishing)</label>
                  <textarea className="form-input" rows={2} value={caption}
                    onChange={e => setCaption(e.target.value.slice(0, 280))} />
                </div>
                {hashtags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {hashtags.map(h => <span key={h} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">#{h}</span>)}
                  </div>
                )}
              </div>
            </div>

            {/* Feature Chips */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-1">Feature Callout Chips</p>
              <p className="text-xs text-gray-400 mb-3">Up to 6 — shown as pill tags around the product</p>
              <div className="grid grid-cols-2 gap-2">
                {features.map((f, i) => (
                  <input key={i} className="form-input text-xs" value={f}
                    onChange={e => updateFeature(i, e.target.value.slice(0, 22))}
                    placeholder={['High Quality Sound', 'Crystal Clear Call', '60 HRS Battery', '10 Min Fast Charge', 'ANC Technology', 'IPX5 Waterproof'][i] || `Feature ${i+1}`} />
                ))}
              </div>
            </div>

            {/* Branding */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-3">Branding &amp; Contact</p>
              <div className="space-y-3">
                <div>
                  <label className="form-label">Store Name</label>
                  <input className="form-input" value={logoText} onChange={e => setLogoText(e.target.value.slice(0,30))} />
                </div>
                <div>
                  <label className="form-label">Tagline (below store name)</label>
                  <input className="form-input" value={tagline} onChange={e => setTagline(e.target.value.slice(0,50))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">WhatsApp</label>
                    <input className="form-input" value={whatsapp} onChange={e => setWhatsapp(e.target.value.slice(0,20))} placeholder="0775474001" />
                  </div>
                  <div>
                    <label className="form-label">Website</label>
                    <input className="form-input" value={website} onChange={e => setWebsite(e.target.value.slice(0,30))} placeholder="ShopZen.lk" />
                  </div>
                </div>
              </div>
            </div>

            {/* Photoreal */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="form-label mb-0">AI Photoreal Mode</p>
                <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Uses AI quota</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">Generates a studio-quality photorealistic post using the same cinematic template style.</p>
              <div className="flex gap-2">
                <button onClick={generatePhotoreal} disabled={photorealLoading || !product?.thumbnail}
                  className="btn-primary text-sm flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
                  {photorealLoading ? 'Generating…' : '🎬 Generate Photoreal'}
                </button>
                {viewMode === 'photoreal' && (
                  <button onClick={() => setViewMode('canvas')}
                    className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                    ← Canvas
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT: LIVE PREVIEW + EXPORT ── */}
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="form-label mb-0">
                  {viewMode === 'photoreal' ? 'Photoreal Preview' : 'Live Preview'}
                  {rendering && <span className="text-gray-400 text-xs normal-case ml-2">(rendering…)</span>}
                </p>
                <span className="text-xs text-gray-400 font-mono">{format.w} × {format.h}px</span>
              </div>
              <div className="bg-gray-900 rounded-xl p-3 flex items-center justify-center overflow-auto" style={{ minHeight: 340, maxHeight: '72vh' }}>
                {viewMode === 'photoreal' && photorealUrl ? (
                  <img src={photorealUrl} alt="Photoreal preview"
                    className="rounded-lg shadow-2xl max-w-full"
                    style={{ maxHeight: '66vh', width: 'auto', height: 'auto' }} />
                ) : (
                  <canvas ref={canvasRef}
                    className="rounded-lg shadow-2xl max-w-full"
                    style={{ maxHeight: '66vh', width: 'auto', height: 'auto' }} />
                )}
              </div>
            </div>

            {/* Download */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-3">Download</p>
              <div className="flex flex-wrap gap-2 items-center">
                {viewMode === 'canvas' ? (
                  <select className="form-input flex-1 min-w-[120px]" value={exportFormat} onChange={e => setExportFormat(e.target.value)}>
                    <option value="png">PNG (recommended)</option>
                    <option value="jpg">JPG</option>
                    <option value="webp">WEBP</option>
                  </select>
                ) : (
                  <p className="text-xs text-gray-400 flex-1">Photoreal downloads as PNG</p>
                )}
                <button onClick={downloadCreative} disabled={!getCurrentDataUrl()}
                  className="btn-primary text-sm whitespace-nowrap disabled:opacity-50">
                  ⬇ Download
                </button>
              </div>
            </div>

            {/* Publish */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-3">Publish to Social Media</p>
              {connectedPlatforms.length === 0 ? (
                <p className="text-sm text-gray-400">No social accounts connected. Connect one in <span className="font-semibold text-gray-500">Social Media</span> settings.</p>
              ) : (
                <div className="flex flex-wrap gap-2 items-center">
                  <select className="form-input flex-1 min-w-[160px]" value={publishPlatform} onChange={e => setPublishPlatform(e.target.value)}>
                    <option value="">Select platform…</option>
                    {connectedPlatforms.map(p => (
                      <option key={p.platform} value={p.platform}>
                        {PLATFORM_META[p.platform]?.label || p.platform}{p.accountName ? ` — ${p.accountName}` : ''}
                      </option>
                    ))}
                  </select>
                  <button onClick={handlePublish} disabled={!publishPlatform || publishing}
                    className="btn-primary text-sm whitespace-nowrap disabled:opacity-50">
                    {publishing ? 'Publishing…' : '📤 Publish Now'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pickerOpen && (
        <ProductPickerModal
          initialSelected={products}
          onClose={() => setPickerOpen(false)}
          onConfirm={handlePickProducts}
        />
      )}
    </div>
  );
}