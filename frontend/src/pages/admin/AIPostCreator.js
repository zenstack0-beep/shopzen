/**
 * AIPostCreator.js  ★ PROFESSIONAL STUDIO EDITION ★
 * Path: frontend/src/pages/admin/AIPostCreator.js
 *
 * ENHANCEMENTS in this version:
 *  1. Pricing & Discount — fully bidirectional:
 *     • Type discount % → auto-computes sale price from original
 *     • Type original + sale → auto-computes discount %
 *     • Type sale price alone → auto-computes discount % from product price
 *  2. Post Content section with:
 *     • Store logo (text or image upload) — top-left of canvas
 *     • Product options/features as bullet-point callout chips
 *     • Website URL — footer right
 *     • WhatsApp number — footer left
 *     • All contact/brand fields editable
 *  3. Save & Load Template presets (MongoDB with localStorage fallback)
 *     • Save current settings as a named preset
 *     • Load any saved preset
 *     • Delete presets
 *  4. Layout engine overhauled:
 *     • All zones calculated before drawing — zero overlap
 *     • Adaptive vertical stacking for Square / Story / Banner / Facebook
 *     • Text wrapping prevents any partial display
 *     • Price block never collides with product image
 *     • Footer always pinned to bottom with clearance above CTA button
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import API from '../../utils/api';
import toast from 'react-hot-toast';

/* ════════════════════════════════════════════════════════════════════════
   BACKGROUND REMOVAL — server-side sharp-based
════════════════════════════════════════════════════════════════════════ */
async function removeImageBackground(imageUrl, apiInstance) {
  const { data } = await apiInstance.post('/ai-post-creator/remove-background', { imageUrl });
  if (!data?.dataUrl) throw new Error('No dataUrl returned from server');
  return data.dataUrl;
}

/* ════════════════════════════════════════════════════════════════════════
   ACCENT COLOUR PALETTES
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
   SAVED TEMPLATES (localStorage)
════════════════════════════════════════════════════════════════════════ */
const LS_KEY = 'shopzen_post_presets_v1';

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch { return []; }
}

function savePresets(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch {}
}

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

function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

/* ════════════════════════════════════════════════════════════════════════
   DRAW HELPERS
════════════════════════════════════════════════════════════════════════ */
function drawGrain(ctx, W, H, alpha = 0.022) {
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

function drawSpotlight(ctx, W, H, cx, topY, radius, accentColor) {
  ctx.save();
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
  const ag = ctx.createRadialGradient(cx, topY + radius * 0.55, 0, cx, topY + radius * 0.55, radius * 0.55);
  ag.addColorStop(0, accentColor + '22');
  ag.addColorStop(1, 'transparent');
  ctx.fillStyle = ag;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawPedestal(ctx, cx, cy, rx, ry, accentColor) {
  ctx.save();
  const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx * 1.5);
  fg.addColorStop(0,   'rgba(255,255,255,0.12)');
  fg.addColorStop(0.4, 'rgba(255,255,255,0.04)');
  fg.addColorStop(1,   'transparent');
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * 1.5, ry * 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  const rng = ctx.createRadialGradient(cx, cy, rx * 0.3, cx, cy, rx);
  rng.addColorStop(0, accentColor + '00');
  rng.addColorStop(0.7, accentColor + '33');
  rng.addColorStop(1,   accentColor + '00');
  ctx.fillStyle = rng;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
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

function drawGhostType(ctx, W, H, text, centerX, centerY, accentColor) {
  if (!text) return;
  ctx.save();
  const maxW = W * 0.88;
  let fontSize = Math.round(W * 0.18);
  ctx.font = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`;
  while (ctx.measureText(text).width > maxW && fontSize > 24) {
    fontSize -= 4;
    ctx.font = `900 ${fontSize}px 'Arial Black', Arial, sans-serif`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tg = ctx.createLinearGradient(centerX, centerY - fontSize * 0.6, centerX, centerY + fontSize * 0.6);
  tg.addColorStop(0,   'rgba(255,255,255,0.09)');
  tg.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  tg.addColorStop(1,   'rgba(255,255,255,0.01)');
  ctx.fillStyle = tg;
  ctx.fillText(text, centerX, centerY);
  ctx.restore();
}

/* Bullet-point feature chip — new design with •  prefix */
function drawFeatureChip(ctx, x, y, text, accentColor, fontSize, side = 'left') {
  ctx.save();
  const label = `• ${text}`;
  ctx.font = `600 ${fontSize}px Arial, sans-serif`;
  const tw   = ctx.measureText(label).width;
  const padX = fontSize * 0.9;
  const padY = fontSize * 0.5;
  const w    = tw + padX * 2;
  const h    = fontSize + padY * 2;
  const bx   = side === 'right' ? x - w : x;

  roundRect(ctx, bx, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(10,10,14,0.80)';
  ctx.fill();
  roundRect(ctx, bx, y, w, h, h / 2);
  ctx.strokeStyle = accentColor + 'bb';
  ctx.lineWidth   = Math.max(1.5, fontSize * 0.08);
  ctx.stroke();
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + w / 2, y + h / 2 + 1);
  ctx.restore();
  return h;
}

function drawDiscountBadge(ctx, x, y, discountPct, accentColor) {
  if (!discountPct || discountPct <= 0) return;
  ctx.save();
  const sz  = Math.round(x * 2.2);
  const r   = sz * 0.18;
  roundRect(ctx, x, y, sz, sz * 0.88, r);
  ctx.fillStyle = 'rgba(8,8,12,0.88)';
  ctx.fill();
  roundRect(ctx, x, y, sz, sz * 0.88, r);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth   = Math.max(2, sz * 0.04);
  ctx.shadowColor = accentColor;
  ctx.shadowBlur  = sz * 0.18;
  ctx.stroke();
  ctx.shadowBlur  = 0;
  ctx.font         = `600 ${Math.round(sz * 0.16)}px Arial, sans-serif`;
  ctx.fillStyle    = 'rgba(255,255,255,0.65)';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('UPTO', x + sz / 2, y + sz * 0.08);
  ctx.font      = `900 ${Math.round(sz * 0.38)}px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle = accentColor;
  ctx.shadowColor = accentColor; ctx.shadowBlur = sz * 0.12;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${discountPct}%`, x + sz / 2, y + sz * 0.52);
  ctx.shadowBlur = 0;
  ctx.font      = `800 ${Math.round(sz * 0.19)}px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'bottom';
  ctx.fillText('OFF', x + sz / 2, y + sz * 0.86);
  ctx.restore();
}

function drawParticles(ctx, W, H, accentColor, count = 22, seed = 77) {
  const rng = seededRng(seed);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const px = rng() * W;
    const py = rng() * H;
    const pr = W * (0.003 + rng() * 0.008);
    const pa = 0.08 + rng() * 0.22;
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
   STORE LOGO RENDERER  — text-based logo with optional accent bar
════════════════════════════════════════════════════════════════════════ */
function drawStoreLogo(ctx, x, y, logoText, logoImg, accentColor, W) {
  const logoSz = Math.round(W * 0.028);
  ctx.save();
  if (logoImg) {
    // Image logo — draw at fixed height
    const lH = Math.round(logoSz * 2.2);
    const sc = lH / logoImg.height;
    const lW = Math.min(logoImg.width * sc, W * 0.18);
    ctx.drawImage(logoImg, x, y, lW, lH);
  } else {
    // Text logo with accent underline
    ctx.font         = `700 ${logoSz}px Arial, sans-serif`;
    ctx.fillStyle    = '#ffffff';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(logoText || 'ShopZen.lk', x, y);
    // Accent underline
    const tw = ctx.measureText(logoText || 'ShopZen.lk').width;
    ctx.beginPath();
    ctx.strokeStyle = accentColor + 'cc';
    ctx.lineWidth   = Math.max(1.5, logoSz * 0.09);
    ctx.moveTo(x, y + logoSz * 1.15);
    ctx.lineTo(x + tw, y + logoSz * 1.15);
    ctx.stroke();
  }
  ctx.restore();
  return logoSz * 1.5; // height used
}

/* ════════════════════════════════════════════════════════════════════════
   MASTER CINEMATIC RENDERER — layout-safe version
   All vertical zones are pre-calculated so nothing overlaps.
════════════════════════════════════════════════════════════════════════ */
async function renderCinematic(canvas, params) {
  const {
    format, product, headline, badgeLabel,
    discountPct, originalPrice, salePrice,
    cta, features, whatsapp, website,
    accentColor, logoText, tagline, logoImgSrc,
  } = params;

  const W   = format.w;
  const H   = format.h;
  const ACC = accentColor || '#e8eaf0';
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const pad      = Math.round(W * 0.048);
  const isSq     = Math.abs(W - H) < 50;
  const isStory  = H > W * 1.5;
  const isBanner = W > H * 1.7;

  /* ── FOOTER HEIGHT (fixed) ── */
  const footerH = Math.round(H * 0.085);
  const footerY = H - footerH;

  /* ── CTA HEIGHT (fixed) ── */
  const ctaSz  = Math.round(W * (isBanner ? 0.020 : 0.022));
  const ctaBH  = ctaSz * 2.8;
  const ctaGap = pad * 0.6; // gap between CTA and footer

  /* ── BOTTOM RESERVED — CTA + footer + gap ── */
  const bottomReserved = footerH + ctaBH + ctaGap + pad * 0.4;

  /* ── 1. DEEP DARK BACKGROUND ── */
  const bg = ctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.82);
  bg.addColorStop(0,    '#1c1c24');
  bg.addColorStop(0.45, '#111116');
  bg.addColorStop(1,    '#06060a');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* ── 2. VIGNETTE ── */
  ctx.save();
  const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  /* ── 3. GRAIN ── */
  drawGrain(ctx, W, H, 0.022);

  /* ── 4. PARTICLES ── */
  drawParticles(ctx, W, H, ACC, 26, 113);

  /* ══════════════════════════════════════════════════════════════════
     LAYOUT PRE-CALCULATION
     We build a stack from top → bottom and calculate product zone
     so nothing ever overlaps.
  ══════════════════════════════════════════════════════════════════ */

  // HEADER BLOCK (logo + tagline + badge)
  const logoSz   = Math.round(W * 0.028);
  const headerTopY = pad * 0.75;
  const logoH    = logoSz * 1.5;
  const taglineH = logoSz * 0.65;
  const headerH  = logoH + taglineH + pad * 0.3;

  // badge label (top-right pill) — same top as logo
  const blSz   = Math.round(W * 0.018);
  const blH    = blSz * 2.2;

  // discount badge (below logo, top-left)
  const discBadgeSz = Math.round(pad * 2.2);
  const discH       = Number(discountPct) > 0 ? discBadgeSz * 0.88 + pad * 0.5 : 0;

  const headerBlockBottom = headerTopY + headerH + discH;

  /* ── PRODUCT ZONE ── */
  let prodZoneX, prodZoneY, prodZoneW, prodZoneH, prodCX, prodCY;
  if (isBanner) {
    prodZoneW = W * 0.36;
    prodZoneH = H * 0.76;
    prodZoneX = W * 0.32;
    prodZoneY = H * 0.12;
  } else {
    prodZoneW  = isSq ? W * 0.52 : W * 0.60;
    prodZoneY  = Math.max(headerBlockBottom + pad * 0.4, H * (isStory ? 0.24 : 0.20));
    // Bottom of product zone: leave room for content + CTA + footer
    const contentH_estimate = isSq
      ? logoSz * 3.5 + pad   // headline 2 lines + price
      : logoSz * 4 + pad;
    const availH = footerY - bottomReserved - contentH_estimate - prodZoneY;
    prodZoneH  = Math.max(Math.min(availH, H * 0.42), H * 0.22);
    prodZoneX  = (W - prodZoneW) / 2;
  }
  prodCX = prodZoneX + prodZoneW / 2;
  prodCY = prodZoneY + prodZoneH / 2;

  const pedestalRX = prodZoneW * 0.42;
  const pedestalRY = pedestalRX * 0.22;
  const pedestalY  = prodZoneY + prodZoneH + pedestalRY * 0.5;

  /* ── CONTENT BLOCK — below product zone ── */
  // Only for non-banner
  const contentStartY = isBanner ? H * 0.10 : pedestalY + pedestalRY * 1.5 + pad * 0.3;

  /* ── 5. GHOST TYPE ── */
  const ghostText = (product?.brand || product?.name || headline || 'PRODUCT').toUpperCase().split(' ')[0];
  drawGhostType(ctx, W, H, ghostText, prodCX, prodCY, ACC);

  /* ── 6. SPOTLIGHT ── */
  const spotR = Math.max(W, H) * (isBanner ? 0.55 : 0.70);
  drawSpotlight(ctx, W, H, prodCX, -spotR * 0.05, spotR, ACC);

  /* ── 7. PEDESTAL ── */
  drawPedestal(ctx, prodCX, pedestalY, pedestalRX, pedestalRY, ACC);

  /* ── 8. PRODUCT IMAGE ── */
  try {
    const img = await loadImage(product?.thumbnail);
    ctx.save();
    ctx.shadowColor  = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur   = prodZoneW * 0.18;
    ctx.shadowOffsetY = prodZoneH * 0.06;
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

  /* ── 9. STORE LOGO — top-left ── */
  let logoImgEl = null;
  if (logoImgSrc) {
    try { logoImgEl = await loadImage(logoImgSrc); } catch {}
  }
  ctx.save();
  drawStoreLogo(ctx, pad, headerTopY, logoText || 'ShopZen.lk', logoImgEl, ACC, W);
  // Tagline below logo
  ctx.font      = `400 ${Math.round(logoSz * 0.48)}px Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(tagline || 'SMART CHOICES · BETTER LIVING', pad, headerTopY + logoH + pad * 0.05);
  ctx.restore();

  /* ── 10. TOP-RIGHT BADGE LABEL ── */
  const blText = (badgeLabel || 'NEW ARRIVAL').split('\n')[0].toUpperCase();
  ctx.save();
  ctx.font = `700 ${blSz}px Arial, sans-serif`;
  const blW  = ctx.measureText(blText).width + blSz * 1.6;
  const blX  = W - pad - blW;
  const blY  = headerTopY;
  roundRect(ctx, blX, blY, blW, blH, blH / 2);
  ctx.strokeStyle = ACC + 'cc';
  ctx.lineWidth   = Math.max(1.5, blSz * 0.07);
  ctx.shadowColor = ACC;
  ctx.shadowBlur  = blH;
  ctx.stroke();
  ctx.fillStyle   = 'rgba(8,8,12,0.72)';
  ctx.fill();
  ctx.shadowBlur  = 0;
  ctx.fillStyle   = '#ffffff';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(blText, blX + blW / 2, blY + blH / 2 + 1);
  ctx.restore();

  /* ── 11. DISCOUNT BADGE — below logo ── */
  const discBadgeY = headerTopY + headerH + pad * 0.15;
  if (Number(discountPct) > 0) {
    drawDiscountBadge(ctx, pad, discBadgeY, discountPct, ACC);
  }

  /* ── 12. FEATURE CALLOUT CHIPS (bullet-point options) ── */
  const fts      = (features || []).filter(Boolean);
  const chipSz   = Math.round(W * (isBanner ? 0.016 : 0.017));
  const chipH    = chipSz + chipSz * 0.5 * 2;
  const chipGap  = chipH + Math.round(W * 0.012);

  if (!isBanner && fts.length > 0) {
    const leftChips  = fts.filter((_, i) => i % 2 === 0).slice(0, 3);
    const rightChips = fts.filter((_, i) => i % 2 !== 0).slice(0, 3);
    const chipStartY = prodZoneY + prodZoneH * 0.15;
    const leftEdge   = Math.round(pad * 0.5);
    const rightEdge  = W - Math.round(pad * 0.5);

    leftChips.forEach((ft, i) => {
      drawFeatureChip(ctx, leftEdge, chipStartY + i * chipGap, ft, ACC, chipSz, 'left');
    });
    rightChips.forEach((ft, i) => {
      drawFeatureChip(ctx, rightEdge, chipStartY + i * chipGap, ft, ACC, chipSz, 'right');
    });
  }

  /* ── CONTENT BLOCK: headline + price (below product, above CTA) ── */
  const maxContentW = isBanner ? W * 0.28 : W - pad * 2;
  const hlSz = Math.round(W * (isBanner ? 0.034 : isSq ? 0.030 : 0.032));
  const pSz  = Math.round(W * (isBanner ? 0.032 : 0.034));
  let curY   = contentStartY;

  // ── 13. HEADLINE ──
  ctx.save();
  ctx.font         = `900 ${hlSz}px 'Arial Black', Arial, sans-serif`;
  ctx.fillStyle    = '#ffffff';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  const hlX    = isBanner ? pad : pad;
  const hlLines = wrapText(ctx, headline || product?.name || '', maxContentW, 2);
  hlLines.forEach(line => {
    ctx.fillText(line, hlX, curY);
    curY += hlSz * 1.28;
  });
  ctx.restore();

  /* ── 14. PRICE BLOCK — strikethrough original + bright sale ── */
  if (salePrice || originalPrice) {
    const mainP = salePrice || originalPrice;
    ctx.save();
    ctx.font         = `900 ${pSz}px 'Arial Black', Arial, sans-serif`;
    ctx.fillStyle    = ACC;
    ctx.shadowColor  = ACC;
    ctx.shadowBlur   = pSz * 0.5;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(fmtLKR(mainP), hlX, curY + pad * 0.15);
    ctx.shadowBlur = 0;

    // Strikethrough original price — drawn NEXT TO sale price on same line
    if (Number(originalPrice) > Number(salePrice) && salePrice) {
      const oSz  = Math.round(pSz * 0.52);
      const oStr = fmtLKR(originalPrice);
      const mainPW = ctx.measureText(fmtLKR(mainP)).width;
      const oX   = hlX + mainPW + pSz * 0.35;
      const oY   = curY + pad * 0.15 + pSz * 0.22;
      ctx.font      = `400 ${oSz}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText(oStr, oX, oY);
      const ow = ctx.measureText(oStr).width;
      // Strikethrough line
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,80,80,0.70)';
      ctx.lineWidth   = Math.max(1.5, oSz * 0.09);
      ctx.moveTo(oX, oY + oSz * 0.54);
      ctx.lineTo(oX + ow, oY + oSz * 0.54);
      ctx.stroke();
    }
    curY += pSz * 1.5 + pad * 0.15;
    ctx.restore();
  }

  /* ── 15. CTA BUTTON — pinned above footer with safe clearance ── */
  const ctaStr = (cta || 'SHOP NOW').toUpperCase();
  ctx.save();
  ctx.font = `800 ${ctaSz}px 'Arial Black', Arial, sans-serif`;
  const ctaTW = ctx.measureText(ctaStr).width;
  const ctaBW = ctaTW + ctaSz * 3.2;
  const ctaY  = footerY - ctaBH - ctaGap;
  const ctaX  = (W - ctaBW) / 2;

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
  ctx.fillStyle    = '#06060a';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`→  ${ctaStr}`, ctaX + ctaBW / 2, ctaY + ctaBH / 2 + 1);
  ctx.restore();

  /* ── 16. FOOTER BAR — WhatsApp + Website ── */
  const fBg = ctx.createLinearGradient(0, footerY, 0, H);
  fBg.addColorStop(0, 'rgba(6,6,10,0.0)');
  fBg.addColorStop(0.3, 'rgba(6,6,10,0.88)');
  fBg.addColorStop(1, 'rgba(6,6,10,0.98)');
  ctx.fillStyle = fBg;
  ctx.fillRect(0, footerY, W, footerH);

  const fSz    = Math.round(W * 0.018);
  const fCY    = footerY + footerH * 0.55;
  const fIconR = Math.round(fSz * 1.1);

  // Thin separator line at top of footer
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  ctx.moveTo(pad, footerY + 2);
  ctx.lineTo(W - pad, footerY + 2);
  ctx.stroke();
  ctx.restore();

  // WhatsApp
  ctx.save();
  ctx.beginPath(); ctx.arc(pad + fIconR, fCY, fIconR, 0, Math.PI * 2);
  ctx.fillStyle = '#25D366'; ctx.shadowColor = '#25D366'; ctx.shadowBlur = fIconR * 1.2;
  ctx.fill(); ctx.shadowBlur = 0;
  ctx.font = `${fIconR * 1.1}px Arial`; ctx.fillStyle = '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('💬', pad + fIconR, fCY);
  ctx.font      = `600 ${fSz}px Arial, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(whatsapp || '0775474001', pad + fIconR * 2 + pad * 0.22, fCY);
  ctx.restore();

  // Website
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
  ctx.font = `600 ${fSz}px Arial, sans-serif`; ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(webStr, wbX + fIconR * 2 + pad * 0.22, fCY);
  ctx.restore();
}

async function renderCreative(canvas, params) {
  return renderCinematic(canvas, params);
}

/* ════════════════════════════════════════════════════════════════════════
   SAVE PRESET MODAL
════════════════════════════════════════════════════════════════════════ */
function SavePresetModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h3 className="font-display font-bold text-lg text-gray-900 mb-4">Save as Template Preset</h3>
        <input
          className="form-input w-full mb-4"
          placeholder="Preset name (e.g. Summer Sale, Electronics Deal)"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => { if (name.trim()) { onSave(name.trim()); onClose(); } }}
            disabled={!name.trim()}
            className="btn-primary text-sm disabled:opacity-50"
          >
            Save Preset
          </button>
        </div>
      </div>
    </div>
  );
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

const EDITOR_FIELD_LABELS = {
  badge: 'Offer Badge', brand: 'Store Name', name: 'Product Title', description: 'Subtitle',
  productBrand: 'Product Brand', category: 'Category',
  feature1: 'Feature 1', feature2: 'Feature 2', feature3: 'Feature 3', feature4: 'Feature 4',
  feature5: 'Feature 5', feature6: 'Feature 6', discount: 'Discount', originalPrice: 'Regular Price',
  price: 'Selling Price', cta: 'Action Button', website: 'Website', whatsapp: 'WhatsApp',
};

const EDITOR_THEMES = [
  { name: 'Original', tint: '#000000', opacity: 0, accent: null, text: null },
  { name: 'Midnight', tint: '#07111f', opacity: .78, accent: '#31e8ff', text: '#ffffff' },
  { name: 'Emerald', tint: '#063d34', opacity: .68, accent: '#f2cf78', text: '#ffffff' },
  { name: 'Rose', tint: '#f4c6d4', opacity: .48, accent: '#a92f60', text: '#30151f' },
  { name: 'Royal', tint: '#151b54', opacity: .68, accent: '#f0c75e', text: '#ffffff' },
  { name: 'Graphite', tint: '#101216', opacity: .76, accent: '#f1f3f5', text: '#ffffff' },
];

const cloneLayout = value => value ? JSON.parse(JSON.stringify(value)) : null;

function recommendedTemplateForProduct(product, templates) {
  const haystack = `${product?.name || ''} ${product?.brand || ''} ${product?.category || ''}`.toLowerCase();
  const preferred = /beauty|fashion|jewel|watch|perfume/.test(haystack) ? 'champagne-signature-pro'
    : /car|automotive|tool|inflator|outdoor/.test(haystack) ? 'velocity-conversion-pro'
    : /home|kitchen|living|appliance/.test(haystack) ? 'editorial-pearl-pro'
    : /phone|charger|audio|earbud|headphone|computer|gaming|tech|cable|accessor/.test(haystack) ? 'aurora-commerce-pro'
    : 'midnight-spotlight-pro';
  return templates.find(template => template.id === preferred)?.id || templates.find(template => template.tier === 'advanced')?.id || templates[0]?.id;
}

function VisualTemplateEditor({
  layout, baseLayout, setLayout, onClose, onSave, templateThumbnail,
  cutoutDataUrl, logoImgSrc, logoText, headline, templateDescription, badgeLabel,
  features, discountPct, originalPrice, salePrice, cta, website, whatsapp, product,
}) {
  const [selectedId, setSelectedId] = useState('productImage');
  const [zoom, setZoom] = useState(.55);
  const [snap, setSnap] = useState(true);
  const [logoIsMark, setLogoIsMark] = useState(false);
  const layoutRef = useRef(layout);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => {
    if (!logoImgSrc) { setLogoIsMark(false); return; }
    const image = new Image();
    image.onload = () => setLogoIsMark(image.width / image.height < 1.8);
    image.src = logoImgSrc;
  }, [logoImgSrc]);

  if (!layout) return null;
  const logoLayerKey = logoIsMark && layout.logoMark ? 'logoMark' : 'logo';
  const snapValue = value => snap ? Math.round(value / 10) * 10 : Math.round(value);
  const getLayer = (source, id) => id === 'productImage' || id === 'logo' || id === 'logoMark'
    ? source?.[id]
    : source?.fields?.[id];
  const updateLayer = (id, patch) => setLayout(current => {
    const next = cloneLayout(current);
    if (id === 'productImage' || id === 'logo' || id === 'logoMark') next[id] = { ...next[id], ...patch };
    else next.fields[id] = { ...next.fields[id], ...patch };
    return next;
  });

  const startTransform = (event, id, mode) => {
    event.preventDefault(); event.stopPropagation(); setSelectedId(id);
    const startX = event.clientX, startY = event.clientY;
    const original = { ...getLayer(layoutRef.current, id) };
    const aspect = (original.width || 1) / (original.height || 1);
    const isImage = ['productImage', 'logo', 'logoMark'].includes(id);
    const move = pointer => {
      const dx = (pointer.clientX - startX) / zoom;
      const dy = (pointer.clientY - startY) / zoom;
      if (mode === 'move') updateLayer(id, { x: snapValue((original.x || 0) + dx), y: snapValue((original.y || 0) + dy) });
      else if (isImage) {
        const width = Math.max(40, snapValue((original.width || 100) + dx));
        updateLayer(id, { width, height: Math.max(40, Math.round(width / aspect)) });
      } else updateLayer(id, {
        width: Math.max(40, snapValue((original.width || 150) + dx)),
        ...(original.height ? { height: Math.max(24, snapValue(original.height + dy)) } : {}),
      });
    };
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop);
  };

  const values = {
    badge: badgeLabel, brand: (!logoImgSrc || logoIsMark) ? logoText : '', name: headline,
    productBrand: product?.brand || '', category: product?.category || '',
    description: templateDescription, feature1: features[0], feature2: features[1], feature3: features[2],
    feature4: features[3], feature5: features[4], feature6: features[5], discount: Number(discountPct) || 0,
    originalPrice: Number(originalPrice) || 0, price: Number(salePrice) || Number(originalPrice) || 0,
    cta, website, whatsapp,
  };
  const displayText = (key, field) => {
    const raw = values[key];
    if (raw === '' || raw === null || raw === undefined) return '';
    if ((key === 'discount' || key === 'originalPrice') && Number(raw) <= 0) return '';
    const formatted = ['price', 'originalPrice'].includes(key) ? Number(raw).toLocaleString('en-LK') : raw;
    let text = `${field.prefix || ''}${formatted}${field.suffix || ''}`;
    return field.uppercase ? text.toUpperCase() : text;
  };
  const fieldEntries = Object.entries(layout.fields || {});
  const layers = [
    { id: 'productImage', label: 'Product Image', type: 'image', src: cutoutDataUrl, box: layout.productImage },
    ...(logoImgSrc ? [{ id: logoLayerKey, label: 'Store Logo', type: 'image', src: logoImgSrc, box: layout[logoLayerKey] }] : []),
    ...fieldEntries.map(([id, box]) => ({ id, label: EDITOR_FIELD_LABELS[id] || id, type: 'text', text: displayText(id, box), box })),
  ];
  const selected = getLayer(layout, selectedId);
  const selectedIsField = selectedId && !['productImage', 'logo', 'logoMark'].includes(selectedId);

  const applyTheme = theme => setLayout(current => {
    const next = cloneLayout(current);
    next.backgroundOverlay = { color: theme.tint, opacity: theme.opacity };
    if (theme.accent || theme.text) Object.entries(next.fields || {}).forEach(([key, field]) => {
      if (theme.accent && field.background) field.background = theme.accent;
      if (theme.text && !field.background && !['description', 'website', 'whatsapp', 'originalPrice'].includes(key)) field.color = theme.text;
    });
    return next;
  });

  const scaleSelected = factor => {
    if (!selected) return;
    const width = Math.max(20, Math.round((selected.width || 100) * factor));
    const patch = { width };
    if (selected.height) patch.height = Math.max(20, Math.round(selected.height * factor));
    if (selectedIsField && selected.fontSize) patch.fontSize = Math.max(8, Math.round(selected.fontSize * factor));
    updateLayer(selectedId, patch);
  };
  const baseSelected = getLayer(baseLayout, selectedId);
  const selectedScale = selected && baseSelected?.width ? Math.round((selected.width / baseSelected.width) * 100) : 100;
  const setSelectedScale = percent => {
    if (!selected || !baseSelected) return;
    const factor = Number(percent) / 100;
    const patch = { width: Math.max(20, Math.round(baseSelected.width * factor)) };
    if (baseSelected.height) patch.height = Math.max(20, Math.round(baseSelected.height * factor));
    if (selectedIsField && baseSelected.fontSize) patch.fontSize = Math.max(8, Math.round(baseSelected.fontSize * factor));
    updateLayer(selectedId, patch);
  };
  const nudgeSelected = (dx, dy) => selected && updateLayer(selectedId, { x: (selected.x || 0) + dx, y: (selected.y || 0) + dy });
  const centerSelected = axis => {
    if (!selected) return;
    updateLayer(selectedId, axis === 'x' ? { x: Math.round((1080 - (selected.width || 0)) / 2) } : { y: Math.round((1080 - (selected.height || 0)) / 2) });
  };
  const resetSelected = () => baseSelected && updateLayer(selectedId, cloneLayout(baseSelected));
  const applyAccent = color => setLayout(current => {
    const next = cloneLayout(current);
    Object.values(next.fields || {}).forEach(field => { if (field.background) field.background = color; });
    return next;
  });

  return (
    <div className="fixed inset-0 z-[80] bg-gray-950/90 backdrop-blur-sm p-3 sm:p-5 overflow-auto">
      <div className="max-w-[1500px] mx-auto bg-gray-100 rounded-2xl overflow-hidden shadow-2xl min-h-[92vh]">
        <div className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-wrap sticky top-0 z-30">
          <div className="mr-auto"><p className="font-bold text-gray-900">Visual Template Studio</p><p className="text-xs text-gray-500">Drag any layer, resize from its corner, then save it for future products.</p></div>
          <label className="text-xs font-semibold text-gray-600 flex items-center gap-2">Canvas zoom
            <input type="range" min="0.35" max="0.85" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/><span>{Math.round(zoom*100)}%</span>
          </label>
          <label className="text-xs font-semibold text-gray-600"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)} className="mr-1"/>Snap 10px</label>
          <button onClick={()=>setLayout(cloneLayout(baseLayout))} className="px-3 py-2 rounded-lg border text-xs font-bold">Reset</button>
          <button onClick={onSave} className="btn-primary text-xs">💾 Save Template</button>
          <button onClick={onClose} className="px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-bold">Done</button>
        </div>

        <div className="grid xl:grid-cols-[230px_minmax(600px,1fr)_310px] gap-3 p-3">
          <aside className="bg-white rounded-xl border p-3 xl:max-h-[calc(92vh-90px)] overflow-auto">
            <p className="form-label mb-2">Layers</p>
            <div className="space-y-1">
              {layers.map(layer => <button key={layer.id} onClick={()=>setSelectedId(layer.id)}
                className={`w-full rounded-lg px-2 py-2 flex items-center gap-2 text-left text-xs ${selectedId===layer.id?'bg-primary/10 text-primary font-bold':'hover:bg-gray-50 text-gray-700'}`}>
                <span>{layer.type==='image'?'🖼':'T'}</span><span className="flex-1 truncate">{layer.label}</span>
                <span onClick={e=>{e.stopPropagation();updateLayer(layer.id,{visible:layer.box?.visible===false})}} className="text-sm">{layer.box?.visible===false?'○':'●'}</span>
              </button>)}
            </div>
            <p className="form-label mt-5 mb-2">Modern Themes</p>
            <div className="grid grid-cols-2 gap-2">
              {EDITOR_THEMES.map(theme=><button key={theme.name} onClick={()=>applyTheme(theme)} className="rounded-lg border p-2 text-[11px] font-bold text-left" style={{background:theme.opacity?theme.tint:'#fff',color:theme.text||'#374151'}}>{theme.name}</button>)}
            </div>
          </aside>

          <main className="bg-gray-900 rounded-xl overflow-auto flex items-start justify-center p-6 min-h-[680px]">
            <div style={{width:1080*zoom,height:1080*zoom}} className="relative shrink-0">
              <div className="absolute origin-top-left overflow-hidden bg-white shadow-2xl" style={{width:1080,height:1080,transform:`scale(${zoom})`}} onPointerDown={()=>setSelectedId('')}>
                <img src={templateThumbnail} alt="Template background" className="absolute inset-0 w-full h-full" draggable={false}/>
                {layout.backgroundOverlay?.opacity>0&&<div className="absolute inset-0 pointer-events-none" style={{background:layout.backgroundOverlay.color,opacity:layout.backgroundOverlay.opacity}}/>}
                {layers.filter(layer=>layer.box?.visible!==false).map(layer=>{
                  const box=layer.box||{}; const active=selectedId===layer.id;
                  const height=box.height||Math.ceil((box.fontSize||30)*(box.maxLines||1)*1.25+12);
                  if(layer.type==='text'&&!layer.text)return null;
                  return <div key={layer.id} onPointerDown={e=>startTransform(e,layer.id,'move')}
                    className={`absolute select-none cursor-move ${active?'ring-[5px] ring-blue-500 ring-offset-2 ring-offset-transparent':''}`}
                    style={{left:box.x||0,top:box.y||0,width:box.width||200,height,opacity:box.opacity??1,zIndex:layer.type==='image'?10:20,
                      ...(layer.type==='text'?{fontFamily:box.fontFamily||'Arial, sans-serif',fontSize:box.fontSize||30,fontWeight:box.fontWeight||400,color:box.color||'#000',textAlign:box.align||'left',letterSpacing:box.letterSpacing||0,lineHeight:box.lineHeight||1.08,background:box.background||'transparent',borderRadius:box.borderRadius||0,display:'flex',alignItems:box.background?'center':'flex-start',justifyContent:box.align==='center'?'center':box.align==='right'?'flex-end':'flex-start',padding:box.background?'0 14px':0,overflow:'hidden',whiteSpace:'normal'}:{})}}>
                    {layer.type==='image'?<img src={layer.src} alt={layer.label} draggable={false} className="w-full h-full object-contain drop-shadow-2xl"/>:<span>{layer.text}</span>}
                    {active&&<span onPointerDown={e=>startTransform(e,layer.id,'resize')} className="absolute -right-3 -bottom-3 w-7 h-7 rounded-full bg-blue-500 border-4 border-white cursor-nwse-resize shadow-lg"/>}
                  </div>;
                })}
              </div>
            </div>
          </main>

          <aside className="bg-white rounded-xl border p-4 xl:max-h-[calc(92vh-90px)] overflow-auto">
            <p className="form-label mb-1">Easy Adjust</p>
            <p className="text-[11px] text-gray-400 mb-3">Select an item, then use these simple controls. Dragging on the canvas also works.</p>
            {!selected?<p className="text-xs text-gray-400">Select an object from the canvas or Layers list.</p>:<div className="space-y-4">
              <div className="flex items-center justify-between"><p className="text-sm font-bold text-gray-800">{selectedId==='productImage'?'Product Image':selectedId==='logo'||selectedId==='logoMark'?'Store Logo':EDITOR_FIELD_LABELS[selectedId]||selectedId}</p><label className="text-xs font-semibold">Show <input type="checkbox" checked={selected.visible!==false} onChange={e=>updateLayer(selectedId,{visible:e.target.checked})}/></label></div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-[11px] font-bold text-gray-500 mb-2">MOVE</p>
                <div className="grid grid-cols-3 gap-1 max-w-[150px] mx-auto"><span/><button onClick={()=>nudgeSelected(0,-10)} className="border rounded-lg py-2">↑</button><span/><button onClick={()=>nudgeSelected(-10,0)} className="border rounded-lg py-2">←</button><button onClick={()=>centerSelected('x')} className="border rounded-lg py-2 text-[10px] font-bold">CENTER</button><button onClick={()=>nudgeSelected(10,0)} className="border rounded-lg py-2">→</button><span/><button onClick={()=>nudgeSelected(0,10)} className="border rounded-lg py-2">↓</button><span/></div>
                <button onClick={()=>centerSelected('y')} className="w-full mt-2 border rounded-lg py-1.5 text-[10px] font-bold">CENTER VERTICALLY</button>
              </div>
              <label className="text-[11px] font-bold text-gray-500 block">SIZE — {selectedScale}%<input className="w-full mt-2" type="range" min="40" max="180" step="5" value={Math.max(40,Math.min(180,selectedScale))} onChange={e=>setSelectedScale(e.target.value)}/></label>
              <div className="flex gap-2"><button onClick={()=>scaleSelected(.9)} className="flex-1 border rounded-lg py-2 text-xs font-bold">− Smaller</button><button onClick={()=>scaleSelected(1.1)} className="flex-1 border rounded-lg py-2 text-xs font-bold">+ Larger</button></div>
              {selectedIsField&&<div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-gray-500">Text colour<input type="color" className="w-full h-10 mt-1" value={/^#[0-9a-f]{6}$/i.test(selected.color||'')?selected.color:'#000000'} onChange={e=>updateLayer(selectedId,{color:e.target.value})}/></label>{selected.background&&<label className="text-[11px] text-gray-500">Button colour<input type="color" className="w-full h-10 mt-1" value={selected.background} onChange={e=>updateLayer(selectedId,{background:e.target.value})}/></label>}</div>}
              <div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-gray-500">All accent colours<input type="color" className="w-full h-10 mt-1" defaultValue="#18bfa0" onChange={e=>applyAccent(e.target.value)}/></label><label className="text-[11px] text-gray-500">Background tint<input type="color" className="w-full h-10 mt-1" value={layout.backgroundOverlay?.color||'#000000'} onChange={e=>setLayout(current=>({...cloneLayout(current),backgroundOverlay:{...current.backgroundOverlay,color:e.target.value}}))}/></label></div>
              <label className="text-[11px] text-gray-500 block">Tint strength<input className="w-full" type="range" min="0" max="1" step=".05" value={layout.backgroundOverlay?.opacity||0} onChange={e=>setLayout(current=>({...cloneLayout(current),backgroundOverlay:{color:current.backgroundOverlay?.color||'#000000',opacity:Number(e.target.value)}}))}/></label>
              <div className="flex gap-2"><button onClick={resetSelected} className="flex-1 border rounded-lg py-2 text-xs font-bold">Reset Item</button><button onClick={()=>setLayout(cloneLayout(baseLayout))} className="flex-1 border rounded-lg py-2 text-xs font-bold">Reset All</button></div>

              <details className="border-t pt-3"><summary className="cursor-pointer text-xs font-bold text-gray-700">Advanced controls</summary><div className="space-y-3 mt-3">
                <div className="grid grid-cols-2 gap-2">{[['x','X'],['y','Y'],['width','Width'],['height','Height']].map(([key,label])=>selected[key]!==undefined&&<label key={key} className="text-[11px] text-gray-500">{label}<input className="form-input mt-1" type="number" value={Math.round(selected[key])} onChange={e=>updateLayer(selectedId,{[key]:Number(e.target.value)})}/></label>)}</div>
                <label className="text-[11px] text-gray-500 block">Opacity {Math.round((selected.opacity??1)*100)}%<input className="w-full" type="range" min="0" max="1" step=".05" value={selected.opacity??1} onChange={e=>updateLayer(selectedId,{opacity:Number(e.target.value)})}/></label>
                {selectedIsField&&<><div className="grid grid-cols-2 gap-2"><label className="text-[11px] text-gray-500">Font size<input className="form-input mt-1" type="number" min="8" max="180" value={selected.fontSize||30} onChange={e=>updateLayer(selectedId,{fontSize:Number(e.target.value)})}/></label><label className="text-[11px] text-gray-500">Weight<select className="form-input mt-1" value={selected.fontWeight||400} onChange={e=>updateLayer(selectedId,{fontWeight:Number(e.target.value)})}><option value="400">Regular</option><option value="600">Semi Bold</option><option value="700">Bold</option><option value="900">Black</option></select></label></div><label className="text-[11px] text-gray-500 block">Font<select className="form-input mt-1" value={selected.fontFamily||'Arial, sans-serif'} onChange={e=>updateLayer(selectedId,{fontFamily:e.target.value})}><option>Arial, sans-serif</option><option>Verdana, sans-serif</option><option>Georgia, serif</option><option>Trebuchet MS, sans-serif</option><option>Impact, sans-serif</option></select></label><div className="grid grid-cols-3 gap-1">{['left','center','right'].map(value=><button key={value} onClick={()=>updateLayer(selectedId,{align:value})} className={`border rounded-lg py-2 text-xs capitalize ${selected.align===value?'bg-gray-900 text-white':''}`}>{value}</button>)}</div></>}
              </div></details>
            </div>}
          </aside>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   TEMPLATE MODE VIEW
════════════════════════════════════════════════════════════════════════ */
function TemplateModeView({
  product, products, activeIdx, setActiveIdx,
  templateList, templatesLoading, selectedTemplateId, setSelectedTemplateId, selectedTemplate,
  customTemplateLayout, setCustomTemplateLayout,
  headline, setHeadline, cta, setCta,
  templateDescription, setTemplateDescription, templateCaption, setTemplateCaption,
  generateTemplateCopy, templateCopyLoading,
  discountPct, setDiscountPct, originalPrice, setOriginalPrice, salePrice, setSalePrice,
  handleDiscountChange, handleOriginalPriceChange, handleSalePriceChange,
  availableVouchers, voucherChoice, setVoucherChoice, vouchersLoading, resolvedVoucher, templateCopyStale,
  badgeLabel, setBadgeLabel,
  features, updateFeature,
  whatsapp, setWhatsapp, website, setWebsite,
  logoText, setLogoText, logoImgSrc, setLogoImgSrc,
  tagline, setTagline,
  paletteId, setPaletteId, customAccent, setCustomAccent, accentColor,
  bgRemoving, cutoutDataUrl, runBackgroundRemoval,
  templateRendering, templateResultUrl, generateTemplateCreative,
  templatePreviewStale,
  downloadCreative, getCurrentDataUrl,
  connectedPlatforms, publishPlatforms, setPublishPlatforms,
  publishCtaType, setPublishCtaType, handlePublish, publishing,
  presets, showSaveModal, setShowSaveModal, handleSavePreset, handleLoadPreset, handleDeletePreset,
}) {
  const logoFileRef = React.useRef(null);
  const [visualEditorOpen, setVisualEditorOpen] = React.useState(false);
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('Use a PNG, JPG, or WEBP logo');
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo must be smaller than 2MB');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setLogoImgSrc(ev.target.result);
    reader.readAsDataURL(file);
  };
  return (
    <div className="grid lg:grid-cols-[440px_minmax(0,1fr)] xl:grid-cols-[500px_minmax(0,1fr)] gap-6 items-start">
      <div className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-2">

        {/* Preset bar */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowSaveModal(true)}
            className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 flex-1">
            💾 Save Preset
          </button>
          {presets.length > 0 && (
            <details className="flex-1">
              <summary className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 cursor-pointer list-none">
                📋 Load Preset <span className="ml-1 text-xs bg-gray-200 px-1.5 py-0.5 rounded-full">{presets.length}</span>
              </summary>
              <div className="absolute z-20 mt-1 bg-white rounded-xl border border-gray-100 shadow-xl p-2 grid gap-1 min-w-[220px]">
                {presets.map(preset => (
                  <div key={preset.id} className="flex items-center gap-1 rounded-lg hover:bg-gray-50 p-1.5">
                    <button onClick={() => handleLoadPreset(preset)} className="flex-1 text-left">
                      <p className="text-xs font-semibold text-gray-800 truncate">{preset.name}</p>
                      <p className="text-[10px] text-gray-400">{new Date(preset.id).toLocaleDateString()}</p>
                    </button>
                    <button onClick={() => handleDeletePreset(preset.id)}
                      className="w-5 h-5 rounded-full bg-red-50 text-red-400 hover:bg-red-100 text-[10px] flex items-center justify-center shrink-0">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

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

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between gap-2 mb-3"><p className="form-label mb-0">Choose Template</p><div className="flex items-center gap-2"><button type="button" onClick={()=>{const id=recommendedTemplateForProduct(product,templateList);if(id)setSelectedTemplateId(id);}} className="text-[11px] font-bold text-primary hover:underline">✨ Auto-pick best design</button><span className="text-xs text-gray-400">{templateList.length} designs</span></div></div>
          {templatesLoading ? (
            <p className="text-sm text-gray-400">Loading templates…</p>
          ) : templateList.length === 0 ? (
            <p className="text-sm text-gray-400">No templates available.</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto overscroll-x-contain pb-2 snap-x">
              {templateList.map(t => (
                <button key={t.id} onClick={() => setSelectedTemplateId(t.id)}
                  className={`w-28 shrink-0 snap-start rounded-xl overflow-hidden border-2 transition-all text-left ${selectedTemplateId === t.id ? 'border-primary ring-2 ring-primary/20' : 'border-gray-100 hover:border-gray-200'}`}
                  title={t.description}>
                  <div className="w-full aspect-square bg-gray-50">
                    <img src={t.thumbnailUrl} alt={t.label} className="w-full h-full object-cover" />
                  </div>
                  <p className="text-[11px] font-semibold text-gray-700 px-1.5 pt-1 truncate">{t.label}</p>
                  {t.tier==='advanced'&&<p className="text-[9px] font-black text-primary px-1.5 pb-1 uppercase tracking-wide">Premium Pro</p>}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-1">Choose any design to render it automatically. Scroll sideways to see all templates.</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="form-label mb-0">Product Cutout</p>
            <span className="text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Browser</span>
          </div>
          <p className="text-xs text-gray-500 mb-3">Removes the background before placing into the template.</p>
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center shrink-0"
              style={{ backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)', backgroundSize: '10px 10px', backgroundPosition:'0 0,0 5px,5px -5px,-5px 0px' }}>
              {cutoutDataUrl ? <img src={cutoutDataUrl} alt="Cutout" className="w-full h-full object-contain" /> : <span className="text-2xl opacity-30">🖼️</span>}
            </div>
            <button onClick={()=>runBackgroundRemoval()} disabled={bgRemoving || !product?.thumbnail}
              className="btn-primary text-sm flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
              {bgRemoving ? 'Removing background…' : cutoutDataUrl ? '↻ Re-run Removal' : '✂️ Remove Background'}
            </button>
          </div>
        </div>

        {/* Pricing — bidirectional */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-3">Pricing &amp; Discount</p>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="form-label">Discount %</label>
              <input className="form-input text-center font-bold text-lg" type="number" min="0" max="99"
                value={discountPct}
                onChange={e => handleDiscountChange(e.target.value)} />
            </div>
            <div>
              <label className="form-label">Original Price</label>
              <input className="form-input" type="number" min="0" value={originalPrice}
                onChange={e => handleOriginalPriceChange(e.target.value)} placeholder="Rs." />
            </div>
            <div>
              <label className="form-label">Sale Price</label>
              <input className="form-input" type="number" min="0" value={salePrice}
                onChange={e => handleSalePriceChange(e.target.value)} placeholder="Rs." />
            </div>
          </div>
          {salePrice && originalPrice && Number(originalPrice) > 0 && (
            <p className="text-xs text-green-600 font-semibold mt-2">
              Customer saves {fmtLKR(Number(originalPrice) - Number(salePrice))} ({Math.round(((Number(originalPrice) - Number(salePrice)) / Number(originalPrice)) * 100)}% off)
            </p>
          )}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <label className="form-label">Product Voucher</label>
            <select className="form-input" value={voucherChoice} disabled={vouchersLoading}
              onChange={e => setVoucherChoice(e.target.value)}>
              <option value="auto">{vouchersLoading ? 'Checking active vouchers…' : 'Auto-detect best valid voucher'}</option>
              {availableVouchers.map(voucher => (
                <option key={voucher.code} value={voucher.code}>
                  {voucher.code} — {voucher.label}{voucher.minOrderAmount > 0 ? ` · Min. Rs. ${Number(voucher.minOrderAmount).toLocaleString('en-LK')}` : ''}
                </option>
              ))}
            </select>
            {!vouchersLoading && availableVouchers.length === 0 && (
              <p className="text-[11px] text-gray-400 mt-1">No active publicly eligible voucher applies to this product. A genuine product sale will still be shown automatically.</p>
            )}
            {resolvedVoucher && !templateCopyStale && (
              <div className="mt-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-[11px] text-emerald-800">
                Verified for this description: <strong>{resolvedVoucher.code}</strong> · {resolvedVoucher.label}
                {resolvedVoucher.minOrderAmount > 0 ? ` · Minimum eligible order Rs. ${Number(resolvedVoucher.minOrderAmount).toLocaleString('en-LK')}` : ''}
              </div>
            )}
          </div>
        </div>

        {/* ── Accent Colour ── */}
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

        {/* ── Post Content ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="form-label mb-0">Post Content</p>
            <button type="button" onClick={()=>generateTemplateCopy()} disabled={templateCopyLoading}
              className="text-xs font-bold text-primary hover:underline disabled:opacity-50">
              {templateCopyLoading?'Generating…':'✨ Generate Product Description'}
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="form-label">Top Badge Text</label>
              <input className="form-input" value={badgeLabel}
                onChange={e => setBadgeLabel(e.target.value.slice(0, 30))} placeholder="NEW ARRIVAL / HOT DEAL" />
            </div>
            <div>
              <label className="form-label">Product Name (headline)</label>
              <input className="form-input" value={headline} onChange={e => setHeadline(e.target.value.slice(0, 60))} />
            </div>
            <div>
              <label className="form-label">Short Description on Creative</label>
              <textarea className="form-input" rows={2} value={templateDescription}
                onChange={e => setTemplateDescription(e.target.value.slice(0, 140))}
                placeholder="Short line shown on the creative (optional)" />
            </div>
            <div>
              <label className="form-label">CTA Button Text</label>
              <input className="form-input" value={cta} onChange={e => setCta(e.target.value.slice(0, 20))} placeholder="Shop Now" />
            </div>
            <div>
              <label className="form-label">Social Media Description</label>
              <textarea className="form-input font-mono text-xs leading-5" rows={12} maxLength={5000} value={templateCaption}
                onChange={e => setTemplateCaption(e.target.value)}
                placeholder="Generate a product-aware description, then review and edit it before publishing." />
              <p className="text-[11px] text-gray-400 mt-1">Generated from the live database price, genuine sale price, checkout-validated voucher, links, contact details, and verified product features.</p>
              {templateCopyStale && templateCaption.trim() && (
                <p className="text-[11px] font-semibold text-amber-700 mt-1">Pricing, voucher, or post action changed. Generate the description again before publishing.</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Product Options / Feature Bullets ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-1">Product Options &amp; Features</p>
          <p className="text-xs text-gray-400 mb-3">Auto-filled from verified specifications and available product options. You can review or edit each bullet.</p>
          <div className="grid grid-cols-2 gap-2">
            {features.map((f, i) => (
              <input key={i} className="form-input text-xs" value={f}
                onChange={e => updateFeature(i, e.target.value.slice(0, 60))}
                placeholder={`Verified feature or option ${i + 1}`} />
            ))}
          </div>
        </div>

        {/* ── Branding & Contact ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-3">Branding &amp; Contact</p>
          <div className="space-y-3">
            <div>
              <label className="form-label">Store Logo</label>
              <div className="flex gap-2 items-center">
                <input className="form-input flex-1" value={logoText}
                  onChange={e => setLogoText(e.target.value.slice(0, 30))} placeholder="Store name as text logo" />
                <button onClick={() => logoFileRef.current?.click()}
                  className="shrink-0 px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                  🖼 Upload
                </button>
                {logoImgSrc && (
                  <button onClick={() => setLogoImgSrc('')}
                    className="shrink-0 w-8 h-8 rounded-full bg-red-50 text-red-400 hover:bg-red-100 text-xs flex items-center justify-center">✕</button>
                )}
              </div>
              <input type="file" accept="image/png,image/jpeg,image/webp" ref={logoFileRef} className="hidden" onChange={handleLogoUpload} />
              {logoImgSrc && (
                <div className="mt-2 w-24 h-12 rounded-lg bg-gray-900 overflow-hidden flex items-center justify-center border border-gray-200">
                  <img src={logoImgSrc} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                </div>
              )}
            </div>
            <div>
              <label className="form-label">Tagline (below store name)</label>
              <input className="form-input" value={tagline} onChange={e => setTagline(e.target.value.slice(0, 50))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">WhatsApp Number</label>
                <input className="form-input" value={whatsapp} onChange={e => setWhatsapp(e.target.value.slice(0, 20))} placeholder="0775474001" />
              </div>
              <div>
                <label className="form-label">Website URL</label>
                <input className="form-input" value={website} onChange={e => setWebsite(e.target.value.slice(0, 30))} placeholder="ShopZen.lk" />
              </div>
            </div>
            <div className="flex gap-4 bg-gray-900 rounded-xl px-4 py-2.5 text-xs">
              <span className="text-green-400">💬 {whatsapp || '—'}</span>
              <span className="text-blue-300">🌐 {website || '—'}</span>
            </div>
          </div>
        </div>

        <button onClick={()=>generateTemplateCreative()} disabled={templateRendering || bgRemoving || !selectedTemplateId}
          className="btn-primary text-sm w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed">
          {templateRendering ? 'Refreshing Live Preview…' : '↻ Refresh Live Preview'}
        </button>
      </div>

      <div className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="form-label mb-0">
              Live Preview
              {templateRendering && <span className="text-primary text-xs normal-case ml-2">(updating…)</span>}
              {!templateRendering&&templatePreviewStale&&templateResultUrl&&<span className="text-amber-600 text-xs normal-case ml-2">(changes pending…)</span>}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={()=>setVisualEditorOpen(true)} disabled={!customTemplateLayout}
                className="px-3 py-2 rounded-lg bg-gray-900 text-white text-xs font-bold disabled:opacity-40">✦ Customize Design</button>
              <span className="text-xs text-gray-400 font-mono">1080 × 1080px</span>
            </div>
          </div>
          <div className="relative bg-gray-100 border border-gray-200 rounded-xl p-0 flex items-center justify-center overflow-auto" style={{ minHeight: 340, maxHeight: '62vh' }}>
            {templateResultUrl ? (
              <img src={templateResultUrl} alt="Template creative preview"
                className={`max-w-full transition-opacity ${templatePreviewStale?'opacity-60':'opacity-100'}`}
                style={{ maxHeight: '56vh', width: 'auto', height: 'auto' }} />
            ) : (
              <p className="text-gray-500 text-sm text-center px-6">
                {templateRendering?'Creating your live preview…':'Choose a template to create the live preview automatically.'}
              </p>
            )}
            {templateRendering&&templateResultUrl&&<div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-xl"><span className="rounded-full bg-white/95 px-4 py-2 text-xs font-bold text-primary shadow-lg">Updating preview…</span></div>}
          </div>
        </div>

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

        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="form-label mb-3">Publish to Social Media</p>
          {connectedPlatforms.length === 0 ? (
            <p className="text-sm text-gray-400">No social accounts connected.</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {connectedPlatforms.map(p => {
                  const selected=publishPlatforms.has(p.platform);
                  return <label key={p.platform} className={`rounded-xl border p-3 cursor-pointer ${selected?'border-primary bg-primary/5':'border-gray-200'}`}>
                    <span className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selected} onChange={()=>setPublishPlatforms(current=>{const next=new Set(current);next.has(p.platform)?next.delete(p.platform):next.add(p.platform);return next;})}/>{PLATFORM_META[p.platform]?.label||p.platform}</span>
                    {p.accountName&&<span className="block ml-5 mt-1 text-[10px] text-gray-400 truncate">{p.accountName}</span>}
                  </label>;
                })}
              </div>
              <div>
                <p className="form-label mb-2">Post Action</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[{value:'shop_now',label:'🛒 Shop Now'},{value:'whatsapp',label:'💬 WhatsApp'},{value:'none',label:'No native button'}].map(option=><label key={option.value} className={`rounded-xl border p-2.5 cursor-pointer text-xs font-semibold ${publishCtaType===option.value?'border-primary bg-primary/5':'border-gray-200'}`}><input type="radio" name="aiCreatorCta" className="mr-2" checked={publishCtaType===option.value} onChange={()=>{setPublishCtaType(option.value);if(option.value==='shop_now')setCta('SHOP NOW');if(option.value==='whatsapp')setCta('WHATSAPP')}}/>{option.label}</label>)}
                </div>
                <p className="text-[11px] text-amber-700 mt-2">Facebook can receive the native Shop Now or WhatsApp action. Instagram and other organic feeds receive the exact product and WhatsApp links inside the reviewed description because they do not support this per-post native button format.</p>
              </div>
              <button onClick={handlePublish} disabled={!publishPlatforms.size || publishing || !templateResultUrl || templatePreviewStale || !templateCaption.trim() || templateCopyStale}
                className="btn-primary text-sm w-full disabled:opacity-50">
                {publishing ? 'Publishing…' : `📤 Publish to ${publishPlatforms.size} Platform${publishPlatforms.size===1?'':'s'}`}
              </button>
            </div>
          )}
        </div>
      </div>
      {visualEditorOpen&&<VisualTemplateEditor
        layout={customTemplateLayout} baseLayout={selectedTemplate?.editorConfig}
        setLayout={setCustomTemplateLayout} onClose={()=>setVisualEditorOpen(false)}
        onSave={()=>{setVisualEditorOpen(false);setShowSaveModal(true);}} templateThumbnail={selectedTemplate?.thumbnailUrl}
        cutoutDataUrl={cutoutDataUrl} logoImgSrc={logoImgSrc} logoText={logoText}
        headline={headline} templateDescription={templateDescription} badgeLabel={badgeLabel}
        features={features} discountPct={discountPct} originalPrice={originalPrice} salePrice={salePrice}
        cta={cta} website={website} whatsapp={whatsapp}
        product={product}
      />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN PAGE
════════════════════════════════════════════════════════════════════════ */
export default function AIPostCreator() {
  const [generationMode, setGenerationMode] = useState('ai');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [products, setProducts]     = useState([]);
  const [activeIdx, setActiveIdx]   = useState(0);
  const [formatId, setFormatId]     = useState('instagram');

  const [paletteId, setPaletteId]       = useState('electric_white');
  const [customAccent, setCustomAccent] = useState('');

  const [badgeLabel, setBadgeLabel]       = useState('NEW ARRIVAL');
  const [headline, setHeadline]           = useState('');
  const [caption, setCaption]             = useState('');
  const [cta, setCta]                     = useState('SHOP NOW');
  const [tagline, setTagline]             = useState('SMART CHOICES · BETTER LIVING');
  const [hashtags, setHashtags]           = useState([]);
  const [discountPct, setDiscountPct]     = useState(0);
  const [originalPrice, setOriginalPrice] = useState('');
  const [salePrice, setSalePrice]         = useState('');
  const [availableVouchers, setAvailableVouchers] = useState([]);
  const [voucherChoice, setVoucherChoice] = useState('auto');
  const [vouchersLoading, setVouchersLoading] = useState(false);
  const [resolvedVoucher, setResolvedVoucher] = useState(null);
  const [offerSnapshot, setOfferSnapshot] = useState(null);
  const [lastGeneratedCopySignature, setLastGeneratedCopySignature] = useState('');

  // Features / product options — up to 6 bullet-point chips
  const [features, setFeatures]           = useState(['', '', '', '', '', '']);

  const [whatsapp, setWhatsapp]           = useState('0775474001');
  const [website, setWebsite]             = useState('ShopZen.lk');
  const [logoText, setLogoText]           = useState('ShopZen.lk');
  const [logoImgSrc, setLogoImgSrc]       = useState(''); // data-url of uploaded logo

  const [aiLoading, setAiLoading]         = useState(false);
  const [exportFormat, setExportFormat]   = useState('png');
  const [rendering, setRendering]         = useState(false);

  const [connectedPlatforms, setConnectedPlatforms] = useState([]);
  const [publishPlatform, setPublishPlatform]       = useState('');
  const [publishPlatforms, setPublishPlatforms]     = useState(new Set());
  const [publishCtaType, setPublishCtaType]         = useState('shop_now');
  const [publishing, setPublishing]                 = useState(false);
  const [uploadedUrl, setUploadedUrl]               = useState('');

  const [viewMode, setViewMode]               = useState('canvas');
  const [photorealUrl, setPhotorealUrl]       = useState('');
  const [photorealLoading, setPhotorealLoading] = useState(false);

  // Preset management
  const [presets, setPresets]               = useState(() => loadPresets());
  const [showSaveModal, setShowSaveModal]   = useState(false);
  const [showPresets, setShowPresets]       = useState(false);

  // Template Mode state
  const [templateList, setTemplateList]             = useState([]);
  const [templatesLoading, setTemplatesLoading]     = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateCaption, setTemplateCaption]       = useState('');
  const [templateCopyLoading, setTemplateCopyLoading] = useState(false);
  const [bgRemoving, setBgRemoving]               = useState(false);
  const [cutoutDataUrl, setCutoutDataUrl]         = useState('');
  const [templateResultUrl, setTemplateResultUrl] = useState('');
  const [templateRendering, setTemplateRendering] = useState(false);
  const [templatePreviewStale, setTemplatePreviewStale] = useState(true);
  const [customTemplateLayout, setCustomTemplateLayout] = useState(null);

  const canvasRef = useRef(null);
  const templatesFetchedRef = useRef(false);
  const logoFileRef = useRef(null);
  const templateRenderSequenceRef = useRef(0);
  const currentTemplateVisualSignatureRef = useRef('');
  const lastRenderedTemplateSignatureRef = useRef('');

  const format      = useMemo(() => FORMATS.find(f => f.id === formatId), [formatId]);
  const product     = products[activeIdx] || null;
  const palette     = ACCENT_PALETTES.find(p => p.id === paletteId) || ACCENT_PALETTES[0];
  const accentColor = customAccent || palette.color;
  const selectedTemplate = useMemo(() => templateList.find(template => template.id === selectedTemplateId) || null, [templateList, selectedTemplateId]);
  const templateVisualSignature = useMemo(() => JSON.stringify([
    product?._id || '', selectedTemplateId, headline, cta, templateDescription,
    Number(discountPct)||0, originalPrice, salePrice, badgeLabel, features,
    whatsapp, website, logoText, logoImgSrc, tagline, customTemplateLayout,
  ]), [product?._id, selectedTemplateId, headline, cta, templateDescription, discountPct, originalPrice, salePrice, badgeLabel, features, whatsapp, website, logoText, logoImgSrc, tagline, customTemplateLayout]);
  currentTemplateVisualSignatureRef.current=templateVisualSignature;
  const templateCopySignature = useMemo(() => JSON.stringify([
    product?._id || '', originalPrice, salePrice, Number(discountPct) || 0,
    voucherChoice, publishCtaType,
  ]), [product?._id, originalPrice, salePrice, discountPct, voucherChoice, publishCtaType]);
  const currentTemplateCopySignatureRef = useRef('');
  currentTemplateCopySignatureRef.current = templateCopySignature;
  const templateCopyStale = !templateCaption.trim() || lastGeneratedCopySignature !== templateCopySignature;

  /* ── Connected platforms ── */
  useEffect(() => {
    API.get('/ai-post-creator/connected-platforms')
      .then(({ data }) => setConnectedPlatforms(data.platforms || []))
      .catch(() => {});
  }, []);

  /* ── Template list fetch ── */
  useEffect(() => {
    if (generationMode !== 'template') return;
    if (templatesFetchedRef.current) return;
    templatesFetchedRef.current = true;
    setTemplatesLoading(true);
    API.get('/ai-post-creator/templates')
      .then(({ data }) => {
        const list = data.templates || [];
        setTemplateList(list);
        if (list.length > 0) setSelectedTemplateId(prev => prev || list[0].id);
      })
      .catch(() => {
        toast.error('Could not load templates');
        templatesFetchedRef.current = false;
      })
      .finally(() => setTemplatesLoading(false));
  }, [generationMode]);

  useEffect(() => {
    if (!selectedTemplate?.editorConfig) return;
    setCustomTemplateLayout(current => current?.id === selectedTemplate.id ? current : cloneLayout(selectedTemplate.editorConfig));
  }, [selectedTemplate]);

  // Merge server-persisted templates with local presets so saved designs are
  // available across browsers while preserving existing offline behaviour.
  useEffect(() => {
    API.get('/ai-post-creator/presets').then(({data}) => {
      const server = data.presets || [];
      if (!server.length) return;
      setPresets(current => {
        const merged = [...server, ...current.filter(local => !server.some(saved => saved.name === local.name))].slice(0, 30);
        savePresets(merged);
        return merged;
      });
    }).catch(()=>{});
  }, []);

  /* ── Auto-populate fields when product changes ── */
  useEffect(() => {
    if (!product) return;
    setOriginalPrice(String(product.price || ''));
    setSalePrice(String(product.salePrice || ''));
    setDiscountPct(product.discount || 0);
    setHeadline(product.name || '');
    setBadgeLabel(product.discount > 0 ? 'HOT DEAL' : 'NEW ARRIVAL');
    setFeatures((product.marketingFeatures || []).concat(['','','','','','']).slice(0, 6));
    setVoucherChoice('auto');
    setAvailableVouchers([]);
    setResolvedVoucher(null);
    setOfferSnapshot(null);
    setLastGeneratedCopySignature('');
    setTemplateDescription('');
    setTemplateCaption('');
    setUploadedUrl('');
    setPhotorealUrl('');
    setViewMode('canvas');
    setCutoutDataUrl('');
    setTemplateResultUrl('');
    setTemplatePreviewStale(true);
  }, [product?._id]); // eslint-disable-line

  useEffect(() => {
    if (generationMode !== 'template' || !product?._id) return undefined;
    let cancelled = false;
    setVouchersLoading(true);
    API.get(`/ai-post-creator/product-offers/${product._id}`)
      .then(({ data }) => {
        if (cancelled) return;
        setAvailableVouchers(data.vouchers || []);
        if (data.pricing) {
          setOriginalPrice(String(data.pricing.regularPrice || ''));
          setSalePrice(data.pricing.isProductSale ? String(data.pricing.sellingPrice || '') : '');
          setDiscountPct(Number(data.pricing.productSalePercent) || 0);
          lastPricingChange.current = 'prices';
        }
      })
      .catch(err => {
        if (!cancelled) toast.error(err.response?.data?.message || 'Could not check product vouchers');
      })
      .finally(() => {
        if (!cancelled) setVouchersLoading(false);
      });
    return () => { cancelled = true; };
  }, [generationMode, product?._id]);

  /* ═══════════════════════════════════════════════════════════
     BIDIRECTIONAL PRICING LOGIC
     • Discount % typed  → sale price = original × (1 - %/100)
     • Prices typed       → discount % = round((orig - sale)/orig × 100)
  ═══════════════════════════════════════════════════════════ */
  const lastPricingChange = useRef('prices'); // 'discount' | 'prices'

  const handleDiscountChange = (val) => {
    const d = Math.max(0, Math.min(99, parseInt(val) || 0));
    lastPricingChange.current = 'discount';
    setDiscountPct(d);
    const orig = parseFloat(originalPrice);
    if (orig > 0 && d > 0) {
      setSalePrice(String(Math.round(orig * (1 - d / 100))));
    } else if (d === 0) {
      setSalePrice(String(orig || ''));
    }
  };

  const handleOriginalPriceChange = (val) => {
    const keepPercentage = lastPricingChange.current === 'discount';
    setOriginalPrice(val);
    const orig = parseFloat(val);
    const sale = parseFloat(salePrice);
    if (keepPercentage && discountPct > 0 && orig > 0) {
      setSalePrice(String(Math.round(orig * (1 - discountPct / 100))));
    } else if (orig > 0 && sale > 0 && sale < orig) {
      setDiscountPct(Math.round(((orig - sale) / orig) * 100));
    } else if (sale >= orig && orig > 0) {
      setDiscountPct(0);
    }
    lastPricingChange.current = keepPercentage ? 'discount' : 'prices';
  };

  const handleSalePriceChange = (val) => {
    lastPricingChange.current = 'prices';
    setSalePrice(val);
    const orig = parseFloat(originalPrice);
    const sale = parseFloat(val);
    if (orig > 0 && sale > 0 && sale < orig) {
      setDiscountPct(Math.round(((orig - sale) / orig) * 100));
    } else if (sale >= orig) {
      setDiscountPct(0);
    }
  };

  /* ── Canvas render params ── */
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
    logoImgSrc,
  }), [format, product, headline, badgeLabel, discountPct, originalPrice, salePrice,
       cta, features, whatsapp, website, accentColor, logoText, tagline, logoImgSrc]);

  useEffect(() => {
    if (viewMode !== 'canvas' || !product || !canvasRef.current) return;
    setRendering(true);
    renderCreative(canvasRef.current, renderParams).finally(() => setRendering(false));
  }, [viewMode, renderParams, product]);

  /* ── Handlers ── */
  const handlePickProducts = (picked) => {
    setProducts(picked);
    setActiveIdx(0);
    setPickerOpen(false);
  };

  const updateFeature = (i, val) => {
    setFeatures(prev => { const n = [...prev]; n[i] = val; return n; });
  };

  /* ── Logo image upload ── */
  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setLogoImgSrc(ev.target.result);
    reader.readAsDataURL(file);
  };

  /* ── Preset save / load ── */
  const PRESET_FIELDS = () => ({
    badgeLabel, headline, cta, tagline, discountPct,
    originalPrice, salePrice, features, whatsapp, website,
    logoText, logoImgSrc, paletteId, customAccent, formatId,
    selectedTemplateId, customTemplateLayout,
  });

  const handleSavePreset = async (name) => {
    const newPreset = { id: Date.now(), name, data: PRESET_FIELDS() };
    const updated   = [newPreset, ...presets].slice(0, 20);
    setPresets(updated);
    savePresets(updated);
    try {
      const {data}=await API.post('/ai-post-creator/presets',{name,data:newPreset.data});
      if(data.presets?.length){setPresets(data.presets);savePresets(data.presets);}
      toast.success(`Template "${name}" saved for future use`);
    } catch {
      toast.success(`Template "${name}" saved on this browser`);
    }
  };

  const handleLoadPreset = (preset) => {
    const d = preset.data;
    if (d.badgeLabel !== undefined)  setBadgeLabel(d.badgeLabel);
    if (d.headline   !== undefined)  setHeadline(d.headline);
    if (d.cta        !== undefined)  setCta(d.cta);
    if (d.tagline    !== undefined)  setTagline(d.tagline);
    if (d.discountPct !== undefined) setDiscountPct(d.discountPct);
    if (d.originalPrice !== undefined) setOriginalPrice(d.originalPrice);
    if (d.salePrice  !== undefined)  setSalePrice(d.salePrice);
    if (d.features   !== undefined)  setFeatures(d.features);
    if (d.whatsapp   !== undefined)  setWhatsapp(d.whatsapp);
    if (d.website    !== undefined)  setWebsite(d.website);
    if (d.logoText   !== undefined)  setLogoText(d.logoText);
    if (d.logoImgSrc !== undefined)  setLogoImgSrc(d.logoImgSrc);
    if (d.paletteId  !== undefined)  setPaletteId(d.paletteId);
    if (d.customAccent !== undefined) setCustomAccent(d.customAccent);
    if (d.formatId   !== undefined)  setFormatId(d.formatId);
    if (d.selectedTemplateId !== undefined) setSelectedTemplateId(d.selectedTemplateId);
    if (d.customTemplateLayout !== undefined) setCustomTemplateLayout(cloneLayout(d.customTemplateLayout));
    setShowPresets(false);
    toast.success(`Preset "${preset.name}" loaded`);
  };

  const handleDeletePreset = async (id) => {
    const updated = presets.filter(p => p.id !== id);
    setPresets(updated);
    savePresets(updated);
    try {
      const {data}=await API.delete(`/ai-post-creator/presets/${id}`);
      if(data.presets){setPresets(data.presets);savePresets(data.presets);}
    } catch {}
  };

  /* ── AI Copy ── */
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
        productImageUrl: product.thumbnail, storeName: logoText, accentColor,
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

  /* ── Template Mode ── */
  const runBackgroundRemoval = async ({quiet=false}={}) => {
    if (!product?.thumbnail) { if(!quiet)toast.error('This product has no image'); return null; }
    setBgRemoving(true);
    setTemplateResultUrl('');
    try {
      const dataUrl = await removeImageBackground(product.thumbnail, API);
      setCutoutDataUrl(dataUrl);
      if(!quiet)toast.success('Background removed');
      return dataUrl;
    } catch (err) {
      const serverMsg = err?.response?.data?.message;
      toast.error(`Background removal failed: ${serverMsg || err?.message || 'Unknown error'}`);
      return null;
    } finally {
      setBgRemoving(false);
    }
  };

  const generateTemplateCopy = async ({ quiet=false, onlyMissing=false }={}) => {
    if (!product) { if(!quiet)toast.error('Select a product first'); return null; }
    const copySignatureAtRequest = templateCopySignature;
    setTemplateCopyLoading(true);
    try {
      const { data } = await API.post('/ai-post-creator/generate-template-copy', {
        productId: product._id,
        ctaType: publishCtaType,
        voucherCode: voucherChoice,
      });
      if (copySignatureAtRequest !== currentTemplateCopySignatureRef.current) return null;
      const verifiedCopySignature = data.pricing ? JSON.stringify([
        product._id,
        String(data.pricing.regularPrice || ''),
        data.pricing.isProductSale ? String(data.pricing.sellingPrice || '') : '',
        Number(data.pricing.productSalePercent) || 0,
        voucherChoice,
        publishCtaType,
      ]) : copySignatureAtRequest;
      const shouldUpdateCaption = !onlyMissing || !templateCaption.trim() || lastGeneratedCopySignature !== verifiedCopySignature;
      if (data.pricing) {
        setOriginalPrice(String(data.pricing.regularPrice || ''));
        setSalePrice(data.pricing.isProductSale ? String(data.pricing.sellingPrice || '') : '');
        setDiscountPct(Number(data.pricing.productSalePercent) || 0);
        lastPricingChange.current = 'prices';
      }
      if(!onlyMissing||!templateDescription.trim())setTemplateDescription(data.description||'');
      if(shouldUpdateCaption)setTemplateCaption(data.caption||'');
      if((!onlyMissing||!features.some(Boolean))&&data.features?.length)setFeatures(data.features.concat(['','','','','','']).slice(0,6));
      if(data.hashtags?.length)setHashtags(data.hashtags);
      if(voucherChoice === 'auto' && data.availableVouchers) setAvailableVouchers(data.availableVouchers);
      setResolvedVoucher(data.selectedVoucher || null);
      setOfferSnapshot(data.offerSnapshot || null);
      if(shouldUpdateCaption || lastGeneratedCopySignature === verifiedCopySignature) setLastGeneratedCopySignature(verifiedCopySignature);
      if(!quiet)toast.success('Accurate product description generated');
      return data;
    } catch (err) {
      if(!quiet)toast.error(err.response?.data?.message || 'Description generation failed');
      return null;
    } finally {
      setTemplateCopyLoading(false);
    }
  };

  const generateTemplateCreative = async ({automatic=false,templateId=selectedTemplateId,renderSignature=templateVisualSignature}={}) => {
    if (!product) { if(!automatic)toast.error('Select a product first'); return; }
    if (!templateId) { if(!automatic)toast.error('Choose a template first'); return; }
    const requestId=++templateRenderSequenceRef.current;
    setTemplateRendering(true);
    setTemplatePreviewStale(true);
    setUploadedUrl('');
    try {
      const generatedCopy=(!templateCaption.trim()||!templateDescription.trim())
        ? await generateTemplateCopy({quiet:true,onlyMissing:true})
        : null;
      const cutout = cutoutDataUrl || await runBackgroundRemoval({quiet:automatic});
      if (!cutout) return;
      const { data } = await API.post('/ai-post-creator/generate-template', {
        templateId,
        productImageDataUrl: cutout,
        name: headline || product.name,
        price: parseFloat(salePrice) || parseFloat(originalPrice) || product.price,
        originalPrice: parseFloat(originalPrice) || product.price,
        discount: discountPct,
        cta,
        description: templateDescription || generatedCopy?.description || '',
        badge: badgeLabel,
        brand: product.brand || '',
        productBrand: product.brand || '',
        category: product.category || '',
        logoImageDataUrl: logoImgSrc || '',
        logoText,
        tagline,
        layout: customTemplateLayout,
        whatsapp,
        website,
        features: features.some(Boolean)?features:(generatedCopy?.features||[]),
      });
      if(requestId!==templateRenderSequenceRef.current||renderSignature!==currentTemplateVisualSignatureRef.current)return;
      setTemplateResultUrl(data.dataUrl);
      lastRenderedTemplateSignatureRef.current=renderSignature;
      setTemplatePreviewStale(false);
      setUploadedUrl('');
      if(!automatic)toast.success('Live preview refreshed');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Template generation failed');
    } finally {
      if(requestId===templateRenderSequenceRef.current)setTemplateRendering(false);
    }
  };

  // Debounced live rendering keeps typing responsive and prevents an older
  // request from replacing a newer template selection. The existing manual
  // refresh action remains available if an external image service fails.
  useEffect(() => {
    if(generationMode!=='template'||!product?.thumbnail||!selectedTemplateId)return;
    if(lastRenderedTemplateSignatureRef.current===templateVisualSignature){setTemplatePreviewStale(false);return;}
    setTemplatePreviewStale(true);
    setUploadedUrl('');
    const timer=setTimeout(()=>generateTemplateCreative({automatic:true,templateId:selectedTemplateId,renderSignature:templateVisualSignature}),550);
    return()=>clearTimeout(timer);
  }, [generationMode, product?.thumbnail, selectedTemplateId, templateVisualSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportMime   = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[exportFormat];
  const getCurrentDataUrl = () => {
    if (generationMode === 'template') return templateResultUrl || null;
    if (viewMode === 'photoreal') return photorealUrl || null;
    return canvasRef.current ? canvasRef.current.toDataURL(exportMime, 0.93) : null;
  };

  const downloadCreative = () => {
    const dataUrl = getCurrentDataUrl();
    if (!dataUrl) return;
    const ext  = generationMode === 'template' ? 'png' : (viewMode === 'photoreal' ? 'png' : exportFormat);
    const link = document.createElement('a');
    link.download = `${(product?.name || 'creative').slice(0, 30).replace(/\s+/g, '-')}-${formatId}.${ext}`;
    link.href = dataUrl;
    link.click();
    toast.success('Creative downloaded');
  };

  const uploadCreative = async () => {
    const dataUrl = getCurrentDataUrl();
    if (!dataUrl) return null;
    const fmt = generationMode === 'template' ? 'png' : (viewMode === 'photoreal' ? 'png' : exportFormat);
    const { data } = await API.post('/ai-post-creator/upload-creative', { dataUrl, format: fmt });
    setUploadedUrl(data.url);
    return data.url;
  };

  const handlePublish = async () => {
    const selectedPlatforms=generationMode==='template'?[...publishPlatforms]:(publishPlatform?[publishPlatform]:[]);
    if (!selectedPlatforms.length || !product) return;
    setPublishing(true);
    try {
      const url = uploadedUrl || await uploadCreative();
      const fullCaption = generationMode === 'template'
        ? templateCaption
        : [headline, caption, hashtags.map(h => `#${h}`).join(' ')].filter(Boolean).join('\n\n');
      const {data}=await API.post('/ai-post-creator/publish', {
        platforms: selectedPlatforms, imageUrl: url, caption: fullCaption,
        productId: product._id,
        productUrl: product.slug ? `${window.location.origin}/product/${product.slug}` : '',
        productName: product.name,
        ctaType: generationMode==='template'?publishCtaType:'none',
        voucherCode: generationMode==='template' ? (offerSnapshot?.voucherCode || '') : '',
        offerSnapshot: generationMode==='template' ? offerSnapshot : null,
      },{timeout:180000});
      if(data.succeeded)toast.success(`Published successfully to ${data.succeeded} platform${data.succeeded===1?'':'s'}`);
      if(data.failed){
        const failures=(data.results||[]).filter(result=>!result.success).map(result=>`${PLATFORM_META[result.platform]?.label||result.platform}: ${result.message}`).join(' · ');
        toast.error(`${data.failed} platform${data.failed===1?'':'s'} failed. ${failures}`);
      }
      if(!data.succeeded&&data.message)throw new Error(data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  /* ════════════════════════════════════════════════════════════
     SAVINGS SUMMARY — shown below price fields
  ════════════════════════════════════════════════════════════ */
  const savingsDisplay = (() => {
    const orig = parseFloat(originalPrice);
    const sale = parseFloat(salePrice);
    if (!orig || !sale || sale >= orig) return null;
    const saved = orig - sale;
    const pct   = Math.round((saved / orig) * 100);
    return `Customer saves ${fmtLKR(saved)} (${pct}% off)`;
  })();

  /* ── JSX ── */
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="font-display text-xl font-bold text-gray-900">AI Post Creator</h2>
          <p className="text-sm text-gray-500">
            {generationMode === 'template'
              ? 'Template Mode — drop a product into a designed PNG template'
              : 'Cinematic studio template — professional ad-quality social posts'}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Presets button */}
          {generationMode === 'ai' && (
            <>
              <button onClick={() => setShowPresets(v => !v)}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                📋 Presets {presets.length > 0 && <span className="ml-1 text-xs bg-gray-200 px-1.5 py-0.5 rounded-full">{presets.length}</span>}
              </button>
              <button onClick={() => setShowSaveModal(true)}
                className="px-3 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                💾 Save Preset
              </button>
            </>
          )}
          <button onClick={() => setPickerOpen(true)} className="btn-primary text-sm">
            {products.length ? 'Change Product' : '+ Select Product'}
          </button>
        </div>
      </div>

      {/* Presets panel */}
      {showPresets && generationMode === 'ai' && (
        <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="form-label mb-0">Saved Presets</p>
            <button onClick={() => setShowPresets(false)} className="text-xs text-gray-400 hover:text-gray-600">✕ Close</button>
          </div>
          {presets.length === 0 ? (
            <p className="text-sm text-gray-400">No saved presets yet. Set up your fields and click "Save Preset".</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {presets.map(preset => (
                <div key={preset.id} className="flex items-center gap-1 rounded-xl border border-gray-100 p-2 hover:border-gray-200">
                  <button onClick={() => handleLoadPreset(preset)} className="flex-1 text-left">
                    <p className="text-xs font-semibold text-gray-800 truncate">{preset.name}</p>
                    <p className="text-[10px] text-gray-400">{new Date(preset.id).toLocaleDateString()}</p>
                  </button>
                  <button onClick={() => handleDeletePreset(preset.id)}
                    className="w-6 h-6 rounded-full bg-red-50 text-red-400 hover:bg-red-100 text-xs flex items-center justify-center shrink-0">
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Generation Mode Toggle */}
      <div className="inline-flex bg-gray-100 rounded-xl p-1 mb-6">
        <button onClick={() => setGenerationMode('ai')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${generationMode === 'ai' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
          ✨ AI Mode
        </button>
        <button onClick={() => setGenerationMode('template')}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${generationMode === 'template' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
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
          product={product} products={products}
          activeIdx={activeIdx} setActiveIdx={setActiveIdx}
          templateList={templateList} templatesLoading={templatesLoading}
          selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId}
          selectedTemplate={selectedTemplate} customTemplateLayout={customTemplateLayout} setCustomTemplateLayout={setCustomTemplateLayout}
          headline={headline} setHeadline={setHeadline}
          cta={cta} setCta={setCta}
          templateDescription={templateDescription} setTemplateDescription={setTemplateDescription}
          templateCaption={templateCaption} setTemplateCaption={setTemplateCaption}
          generateTemplateCopy={generateTemplateCopy} templateCopyLoading={templateCopyLoading}
          discountPct={discountPct} setDiscountPct={setDiscountPct}
          originalPrice={originalPrice} setOriginalPrice={setOriginalPrice}
          salePrice={salePrice} setSalePrice={setSalePrice}
          handleDiscountChange={handleDiscountChange} handleOriginalPriceChange={handleOriginalPriceChange} handleSalePriceChange={handleSalePriceChange}
          availableVouchers={availableVouchers} voucherChoice={voucherChoice} setVoucherChoice={setVoucherChoice}
          vouchersLoading={vouchersLoading} resolvedVoucher={resolvedVoucher} templateCopyStale={templateCopyStale}
          badgeLabel={badgeLabel} setBadgeLabel={setBadgeLabel}
          features={features} updateFeature={updateFeature}
          whatsapp={whatsapp} setWhatsapp={setWhatsapp}
          website={website} setWebsite={setWebsite}
          logoText={logoText} setLogoText={setLogoText}
          logoImgSrc={logoImgSrc} setLogoImgSrc={setLogoImgSrc}
          tagline={tagline} setTagline={setTagline}
          paletteId={paletteId} setPaletteId={setPaletteId}
          customAccent={customAccent} setCustomAccent={setCustomAccent}
          accentColor={accentColor}
          bgRemoving={bgRemoving} cutoutDataUrl={cutoutDataUrl} runBackgroundRemoval={runBackgroundRemoval}
          templateRendering={templateRendering} templateResultUrl={templateResultUrl}
          templatePreviewStale={templatePreviewStale}
          generateTemplateCreative={generateTemplateCreative}
          downloadCreative={downloadCreative} getCurrentDataUrl={getCurrentDataUrl}
          connectedPlatforms={connectedPlatforms}
          publishPlatforms={publishPlatforms} setPublishPlatforms={setPublishPlatforms}
          publishCtaType={publishCtaType} setPublishCtaType={setPublishCtaType}
          handlePublish={handlePublish} publishing={publishing}
          presets={presets} showSaveModal={showSaveModal} setShowSaveModal={setShowSaveModal}
          handleSavePreset={handleSavePreset} handleLoadPreset={handleLoadPreset}
          handleDeletePreset={handleDeletePreset}
        />
      ) : (
        /* ══════════════════ AI MODE ══════════════════ */
        <div className="grid lg:grid-cols-[420px_1fr] gap-6">

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

            {/* ═══════════════════════════════════════════════
                PRICING & DISCOUNT — fully bidirectional
            ═══════════════════════════════════════════════ */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-1">Pricing &amp; Discount</p>
              <p className="text-xs text-gray-400 mb-3">
                Change any field — the others auto-update. Discount % changes original → sale price. Changing both prices recalculates %.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Discount %</label>
                  <input
                    className="form-input text-center font-bold text-lg"
                    type="number" min="0" max="99"
                    value={discountPct}
                    onChange={e => handleDiscountChange(e.target.value)}
                  />
                </div>
                <div>
                  <label className="form-label">Original Price</label>
                  <input
                    className="form-input"
                    type="number" min="0"
                    value={originalPrice}
                    onChange={e => handleOriginalPriceChange(e.target.value)}
                    placeholder="Rs."
                  />
                </div>
                <div>
                  <label className="form-label">Sale Price</label>
                  <input
                    className="form-input"
                    type="number" min="0"
                    value={salePrice}
                    onChange={e => handleSalePriceChange(e.target.value)}
                    placeholder="Rs."
                  />
                </div>
              </div>
              {savingsDisplay && (
                <p className="text-xs text-green-600 font-semibold mt-2">✓ {savingsDisplay}</p>
              )}
              {/* Visual price preview */}
              {(salePrice || originalPrice) && (
                <div className="mt-3 p-3 rounded-xl bg-gray-900 flex items-center gap-3">
                  <span className="text-lg font-black text-yellow-400">{fmtLKR(salePrice || originalPrice)}</span>
                  {Number(originalPrice) > Number(salePrice) && salePrice && (
                    <span className="text-sm text-gray-400 line-through">{fmtLKR(originalPrice)}</span>
                  )}
                  {Number(discountPct) > 0 && (
                    <span className="ml-auto text-xs font-bold bg-red-600 text-white px-2 py-0.5 rounded-full">{discountPct}% OFF</span>
                  )}
                </div>
              )}
            </div>

            {/* ═══════════════════════════════════════════════
                POST CONTENT — all canvas text fields
            ═══════════════════════════════════════════════ */}
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
                  <label className="form-label">Headline (product name on post)</label>
                  <input className="form-input" value={headline}
                    onChange={e => setHeadline(e.target.value.slice(0, 60))} />
                </div>
                <div>
                  <label className="form-label">CTA Button Text</label>
                  <input className="form-input" value={cta}
                    onChange={e => setCta(e.target.value.slice(0, 20))} placeholder="SHOP NOW" />
                </div>
                <div>
                  <label className="form-label">Caption (for publishing only)</label>
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

            {/* ═══════════════════════════════════════════════
                PRODUCT OPTIONS / FEATURE BULLETS
            ═══════════════════════════════════════════════ */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-1">Product Options &amp; Features</p>
              <p className="text-xs text-gray-400 mb-3">
                Each entry appears as a • bullet-point callout chip around the product on the post. Leave blank to hide.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {features.map((f, i) => (
                  <input key={i} className="form-input text-xs" value={f}
                    onChange={e => updateFeature(i, e.target.value.slice(0, 24))}
                    placeholder={[
                      'High Quality Sound', 'Crystal Clear Call',
                      '60 HRS Battery', '10 Min Fast Charge',
                      'ANC Technology', 'IPX5 Waterproof'
                    ][i] || `Option ${i+1}`} />
                ))}
              </div>
            </div>

            {/* ═══════════════════════════════════════════════
                BRANDING & CONTACT
            ═══════════════════════════════════════════════ */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <p className="form-label mb-3">Branding &amp; Contact</p>
              <div className="space-y-3">

                {/* Logo */}
                <div>
                  <label className="form-label">Store Logo</label>
                  <div className="flex gap-2 items-center">
                    <input className="form-input flex-1" value={logoText}
                      onChange={e => setLogoText(e.target.value.slice(0, 30))}
                      placeholder="Store name as text logo" />
                    <button
                      onClick={() => logoFileRef.current?.click()}
                      className="shrink-0 px-3 py-2 rounded-xl border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                      title="Upload a logo image (PNG/SVG recommended)">
                      🖼 Upload
                    </button>
                    {logoImgSrc && (
                      <button onClick={() => setLogoImgSrc('')}
                        className="shrink-0 w-8 h-8 rounded-full bg-red-50 text-red-400 hover:bg-red-100 text-xs flex items-center justify-center">
                        ✕
                      </button>
                    )}
                  </div>
                  <input type="file" accept="image/*" ref={logoFileRef} className="hidden" onChange={handleLogoUpload} />
                  {logoImgSrc && (
                    <div className="mt-2 w-24 h-12 rounded-lg bg-gray-900 overflow-hidden flex items-center justify-center border border-gray-200">
                      <img src={logoImgSrc} alt="Logo preview" className="max-w-full max-h-full object-contain" />
                    </div>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {logoImgSrc ? 'Image logo will be used on the post.' : 'Upload a PNG/SVG logo, or the store name text will be shown.'}
                  </p>
                </div>

                {/* Tagline */}
                <div>
                  <label className="form-label">Tagline (below store name)</label>
                  <input className="form-input" value={tagline} onChange={e => setTagline(e.target.value.slice(0, 50))} />
                </div>

                {/* Contact */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">WhatsApp Number</label>
                    <input className="form-input" value={whatsapp} onChange={e => setWhatsapp(e.target.value.slice(0, 20))} placeholder="0775474001" />
                  </div>
                  <div>
                    <label className="form-label">Website URL</label>
                    <input className="form-input" value={website} onChange={e => setWebsite(e.target.value.slice(0, 30))} placeholder="ShopZen.lk" />
                  </div>
                </div>

                {/* Contact preview */}
                <div className="flex gap-4 bg-gray-900 rounded-xl px-4 py-2.5 text-xs">
                  <span className="text-green-400">💬 {whatsapp || '—'}</span>
                  <span className="text-blue-300">🌐 {website || '—'}</span>
                </div>
              </div>
            </div>

            {/* AI Photoreal */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="form-label mb-0">AI Photoreal Mode</p>
                <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Uses AI quota</span>
              </div>
              <p className="text-xs text-gray-500 mb-3">Generates a studio-quality photorealistic post.</p>
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

      {/* Modals */}
      {pickerOpen && (
        <ProductPickerModal
          initialSelected={products}
          onClose={() => setPickerOpen(false)}
          onConfirm={handlePickProducts}
        />
      )}

      {showSaveModal && (
        <SavePresetModal
          onClose={() => setShowSaveModal(false)}
          onSave={handleSavePreset}
        />
      )}
    </div>
  );
}
