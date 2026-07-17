/**
 * services/templateRenderer.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPLATE MODE RENDERING ENGINE — standalone, server-side
 * ─────────────────────────────────────────────────────────────────────────────
 * Composites a background-removed product cutout onto a PNG template
 * background, then renders text fields (name, price, discount, CTA,
 * description) on top, all positioned according to a per-template JSON
 * config in templates/configs/*.json.
 *
 * Does NOT touch, import, or depend on anything in the existing AI
 * generation flow (routes/ai.js, the cinematic canvas renderer in
 * AIPostCreator.js, or generate-photoreal). Fully isolated module.
 *
 * Text is rendered via an SVG layer (Sharp composites SVG buffers
 * natively through librsvg), which keeps this dependency-light — no
 * node-canvas / native canvas bindings required, just `sharp` which is
 * already a backend dependency.
 *
 * Usage:
 *   const { renderTemplate, listTemplates, getTemplateConfig } = require('./templateRenderer');
 *   const pngBuffer = await renderTemplate('sale-burst', {
 *     productImageBuffer,           // Buffer — background-removed PNG
 *     name, price, originalPrice, discount, cta, description,
 *   });
 */
'use strict';

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const CONFIGS_DIR = path.join(__dirname, '../templates/configs');
const ASSETS_DIR = path.join(__dirname, '../templates/assets');

/* ══════════════════════════════════════════════════════════════════════════
   CONFIG LOADING
══════════════════════════════════════════════════════════════════════════ */
function listTemplates() {
  const files = fs.readdirSync(CONFIGS_DIR).filter(f => f.endsWith('.json'));
  const results = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(CONFIGS_DIR, f), 'utf8').trim();
      if (!raw) { console.warn(`[templateRenderer] Skipping empty config: ${f}`); continue; }
      const cfg = JSON.parse(raw);
      if (!cfg.id || !cfg.label) { console.warn(`[templateRenderer] Skipping invalid config (missing id/label): ${f}`); continue; }
      results.push({
        id: cfg.id,
        label: cfg.label,
        description: cfg.description || '',
        thumbnailUrl: `/api/ai-post-creator/templates/${cfg.id}/thumbnail`,
        editorConfig: cfg,
        tier: cfg.tier || 'standard',
        priority: Number(cfg.priority) || 0,
      });
    } catch (err) {
      console.warn(`[templateRenderer] Skipping malformed config ${f}:`, err.message);
    }
  }
  return results.sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label));
}

function getTemplateConfig(templateId) {
  const safeId = String(templateId || '').replace(/[^a-z0-9-]/gi, '');
  const configPath = path.join(CONFIGS_DIR, `${safeId}.json`);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Unknown template: "${templateId}"`);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function getTemplateAssetPath(templateId) {
  const cfg = getTemplateConfig(templateId);
  const assetPath = path.join(ASSETS_DIR, cfg.background);
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Template background image missing: ${cfg.background}`);
  }
  return assetPath;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function safeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
}

// Custom layouts are admin-authored but still treated as untrusted request
// data. Only existing template layers and a strict visual-property whitelist
// can be overridden; SVG content and file paths can never be injected.
function applyCustomLayout(baseConfig, customLayout) {
  const cfg = JSON.parse(JSON.stringify(baseConfig));
  if (!customLayout || typeof customLayout !== 'object') return cfg;
  const boxKeys = ['x', 'y', 'width', 'height'];
  const applyBox = (target, source) => {
    if (!target || !source || typeof source !== 'object') return;
    boxKeys.forEach(key => {
      const minimum = key === 'width' || key === 'height' ? 20 : -300;
      target[key] = Math.round(clampNumber(source[key], target[key], minimum, 1500));
    });
    if (typeof source.visible === 'boolean') target.visible = source.visible;
    target.opacity = clampNumber(source.opacity, target.opacity ?? 1, 0, 1);
  };

  applyBox(cfg.productImage, customLayout.productImage);
  applyBox(cfg.logo, customLayout.logo);
  applyBox(cfg.logoMark, customLayout.logoMark);

  const allowedFonts = ['Arial, sans-serif', 'Verdana, sans-serif', 'Georgia, serif', 'Trebuchet MS, sans-serif', 'Impact, sans-serif'];
  Object.keys(cfg.fields || {}).forEach(key => {
    const target = cfg.fields[key];
    const source = customLayout.fields?.[key];
    if (!source || typeof source !== 'object') return;
    applyBox(target, source);
    target.fontSize = clampNumber(source.fontSize, target.fontSize || 32, 8, 180);
    target.fontWeight = clampNumber(source.fontWeight, target.fontWeight || 400, 100, 900);
    target.letterSpacing = clampNumber(source.letterSpacing, target.letterSpacing || 0, -8, 30);
    target.borderRadius = clampNumber(source.borderRadius, target.borderRadius || 0, 0, 250);
    target.color = safeColor(source.color, target.color || '#000000');
    if (target.background || source.background) target.background = safeColor(source.background, target.background || '#000000');
    if (['left', 'center', 'right'].includes(source.align)) target.align = source.align;
    if (allowedFonts.includes(source.fontFamily)) target.fontFamily = source.fontFamily;
    if (typeof source.uppercase === 'boolean') target.uppercase = source.uppercase;
  });

  if (customLayout.backgroundOverlay && typeof customLayout.backgroundOverlay === 'object') {
    cfg.backgroundOverlay = {
      color: safeColor(customLayout.backgroundOverlay.color, '#000000'),
      opacity: clampNumber(customLayout.backgroundOverlay.opacity, 0, 0, 1),
    };
  }
  return cfg;
}

/* ══════════════════════════════════════════════════════════════════════════
   SMALL HELPERS
══════════════════════════════════════════════════════════════════════════ */
function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const fmtLKR = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

/** Very small condition evaluator for `showIf` — only supports the
 *  whitelisted comparisons used in templates/configs/*.json. No eval(). */
function evalShowIf(expr, data) {
  if (!expr) return true;
  const clauses = expr.split('&&').map(s => s.trim());
  return clauses.every(clause => {
    const m = clause.match(/^(\w+)\s*(>|>=|<|<=|==)\s*(-?\d+(\.\d+)?)$/);
    if (!m) return true; // unrecognised clause — fail open, don't block rendering
    const [, key, op, valStr] = m;
    const left = Number(data[key]) || 0;
    const right = Number(valStr);
    switch (op) {
      case '>':  return left > right;
      case '>=': return left >= right;
      case '<':  return left < right;
      case '<=': return left <= right;
      case '==': return left === right;
      default:   return true;
    }
  });
}

/** Word-wraps text to fit `maxWidth` px at a given font size, using an
 *  approximate average character width (no canvas measureText available
 *  server-side without native bindings). Slightly conservative on purpose
 *  so text never overflows its box. */
function wrapText(text, fontSize, maxWidth, maxLines, truncate=true) {
  const avgCharWidth = fontSize * 0.56;
  const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / avgCharWidth));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxCharsPerLine && current) {
      lines.push(current);
      if (lines.length >= maxLines) break;
      current = word;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Truncate last line with ellipsis if we still have leftover words
  const consumedWords = lines.join(' ').split(/\s+/).length;
  const overflow = lines.length === maxLines && consumedWords < words.length;
  if (truncate && overflow) {
    const last = lines[maxLines - 1];
    const lastWords = last.split(/\s+/).filter(Boolean);
    if (lastWords.length > 1) lastWords.pop();
    lines[maxLines - 1] = `${lastWords.join(' ') || last}…`;
  }
  return { lines: lines.length ? lines : [''], overflow };
}

/* ══════════════════════════════════════════════════════════════════════════
   SVG TEXT/SHAPE LAYER BUILDERS
══════════════════════════════════════════════════════════════════════════ */
function buildTextSvgFragment(field, rawValue, data) {
  if (!field) return '';
  if (field.visible === false) return '';
  if (field.showIf && !evalShowIf(field.showIf, data)) return '';

  // Check the raw value before applying a prefix/suffix. Otherwise an empty
  // feature becomes the literal string "✓ undefined".
  if (rawValue === '' || rawValue === null || rawValue === undefined) return '';

  let text = String(rawValue).trim();
  if (!text) return '';
  if (field.prefix) text = `${field.prefix}${text}`;
  if (field.suffix) text = `${text}${field.suffix}`;
  if (field.uppercase) text = String(text).toUpperCase();

  let fontSize = field.fontSize || 32;
  const fontWeight = field.fontWeight || 400;
  const fontFamily = field.fontFamily || 'Arial, sans-serif';
  const color = field.color || '#000000';
  const align = field.align || 'left';
  const maxLines = field.maxLines || 1;
  const lineHeight = field.lineHeight || 1.2;
  const letterSpacing = field.letterSpacing || 0;

  let wrapResult = field.width
    ? wrapText(text, fontSize, field.width, maxLines, !field.autoFit)
    : { lines: [String(text)], overflow: false };
  if (field.autoFit && field.width) {
    const minimum = field.minFontSize || Math.max(28, Math.round(fontSize * 0.68));
    while (wrapResult.overflow && fontSize > minimum) {
      fontSize = Math.max(minimum, fontSize - 2);
      wrapResult = wrapText(text, fontSize, field.width, maxLines, false);
    }
    if (wrapResult.overflow) wrapResult = wrapText(text, fontSize, field.width, maxLines, true);
  }
  const lines = wrapResult.lines;

  const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  const textX = align === 'center' ? (field.width || 0) / 2 : align === 'right' ? (field.width || 0) : 0;

  const shadowFilterId = `shadow-${Math.round(field.x)}-${Math.round(field.y)}`;
  let defs = '';
  let filterAttr = '';
  if (field.shadow?.enabled) {
    filterAttr = ` filter="url(#${shadowFilterId})"`;
    defs = `
      <filter id="${shadowFilterId}" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="${field.shadow.offsetY || 2}" stdDeviation="${(field.shadow.blur || 6) / 2}"
          flood-color="${field.shadow.color || 'rgba(0,0,0,0.4)'}" flood-opacity="${field.shadow.opacity ?? 1}"/>
      </filter>`;
  }

  const decoration = field.strikethrough ? ' text-decoration="line-through"' : '';

  const tspans = lines.map((line, i) =>
    `<tspan x="${textX}" y="${i * fontSize * lineHeight}">${escapeXml(line)}</tspan>`
  ).join('');

  return `
    <svg x="${field.x}" y="${field.y}" width="${field.width || 1000}" height="${fontSize * lineHeight * lines.length + 10}" overflow="visible" opacity="${field.opacity ?? 1}">
      ${defs}
      <text font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}"
        fill="${color}" text-anchor="${anchor}" letter-spacing="${letterSpacing}"${decoration}${filterAttr}
        dominant-baseline="hanging">${tspans}</text>
    </svg>`;
}

function buildPillSvgFragment(field, rawValue, data) {
  // Used for fields that have a `background` — rendered as a rounded pill/box
  // behind the text (e.g. CTA buttons, discount badges in some templates).
  if (!field?.background) return buildTextSvgFragment(field, rawValue, data);
  if (field.visible === false) return '';
  if (field.showIf && !evalShowIf(field.showIf, data)) return '';

  if (rawValue === '' || rawValue === null || rawValue === undefined) return '';

  let text = String(rawValue).trim();
  if (!text) return '';
  if (field.prefix) text = `${field.prefix}${text}`;
  if (field.suffix) text = `${text}${field.suffix}`;
  if (field.uppercase) text = String(text).toUpperCase();

  const w = field.width || 200;
  const h = field.height || 70;
  const r = field.borderRadius ?? h / 2;
  const fontSize = field.fontSize || 28;

  return `
    <svg x="${field.x}" y="${field.y}" width="${w}" height="${h}" overflow="visible" opacity="${field.opacity ?? 1}">
      <rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${field.background}"/>
      <text x="${w / 2}" y="${h / 2}" font-family="${field.fontFamily || 'Arial, sans-serif'}"
        font-size="${fontSize}" font-weight="${field.fontWeight || 700}" fill="${field.color || '#000'}"
        text-anchor="middle" dominant-baseline="central">${escapeXml(String(text))}</text>
    </svg>`;
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN RENDER FUNCTION
══════════════════════════════════════════════════════════════════════════ */
/**
 * @param {string} templateId
 * @param {object} data
 * @param {Buffer} data.productImageBuffer  - background-removed product PNG (required)
 * @param {Buffer} [data.logoImageBuffer]    - optional store logo image
 * @param {string} data.name
 * @param {number} data.price
 * @param {number} [data.originalPrice]
 * @param {number} [data.discount]          - percent, e.g. 25
 * @param {string} [data.cta]
 * @param {string} [data.description]
 * @returns {Promise<Buffer>} rendered 1080x1080 PNG buffer
 */
async function renderTemplate(templateId, data) {
  const cfg = applyCustomLayout(getTemplateConfig(templateId), data.layout);
  const bgPath = getTemplateAssetPath(templateId);
  const { width: W, height: H } = cfg.canvas;

  if (!data.productImageBuffer) {
    throw new Error('productImageBuffer is required (background-removed product cutout)');
  }

  let logoIsMark = false;
  if (data.logoImageBuffer) {
    const logoMeta = await sharp(data.logoImageBuffer).metadata();
    logoIsMark = !!(logoMeta.width && logoMeta.height && logoMeta.width / logoMeta.height < 1.8);
  }

  const fieldData = {
    name: data.name || '',
    price: Number(data.price) || 0,
    originalPrice: Number(data.originalPrice) || 0,
    discount: Number(data.discount) || 0,
    cta: data.cta || 'Shop Now',
    description: data.description || '',
    badge: data.badge || '',
    // Template "brand" slots are store-branding positions. A compact logo
    // mark is paired with the store name; a complete wide wordmark stands on
    // its own without duplicated text.
    brand: !data.logoImageBuffer || logoIsMark ? (data.logoText || '') : '',
    productBrand: data.productBrand || '',
    category: data.category || '',
    tagline: data.tagline || '',
    whatsapp: data.whatsapp || '',
    website: data.website || '',
  };
  (data.features || []).slice(0, 6).forEach((feature, index) => {
    fieldData[`feature${index + 1}`] = feature;
  });

  /* ── 1. Prepare product image: resize to fit its slot, contain-fit ── */
  const pi = cfg.productImage;
  // Background removal leaves the original transparent canvas dimensions.
  // Trim that empty padding before contain-fit so the actual product—not its
  // invisible canvas—fills the intended premium focal area.
  const trimmedProduct = await sharp(data.productImageBuffer)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
  let productResized = await sharp(trimmedProduct)
    .resize(pi.width, pi.height, { fit: pi.fit || 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Optional soft drop shadow under the product cutout, built via a blurred
  // alpha silhouette composited beneath the product layer.
  const compositeLayers = [];
  if (pi.visible !== false && pi.glow?.enabled) {
    const glowSilhouette = await sharp(trimmedProduct)
      .resize(pi.width, pi.height, { fit: pi.fit || 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .tint(pi.glow.color || '#ffffff')
      .blur(pi.glow.blur || 45)
      .toBuffer();
    compositeLayers.push({
      input: glowSilhouette,
      left: pi.x,
      top: pi.y,
      blend: 'over',
      opacity: pi.glow.opacity ?? 0.22,
    });
  }
  if (pi.visible !== false && pi.shadow?.enabled) {
    const shadowSilhouette = await sharp(trimmedProduct)
      .resize(pi.width, pi.height, { fit: pi.fit || 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .tint({ r: 0, g: 0, b: 0 })
      .blur(pi.shadow.blur || 30)
      .toBuffer();
    compositeLayers.push({
      input: shadowSilhouette,
      left: pi.x,
      top: pi.y + (pi.shadow.offsetY || 20),
      blend: 'over',
      opacity: pi.shadow.opacity ?? 0.3,
    });
  }

  if (pi.visible !== false) compositeLayers.push({ input: productResized, left: pi.x, top: pi.y, opacity: pi.opacity ?? 1 });

  // Store logo is a real image layer, not text embedded into the generated
  // background. The transparent contain-fit keeps the original aspect ratio.
  if (data.logoImageBuffer && cfg.logo) {
    const logo = logoIsMark && cfg.logoMark ? cfg.logoMark : cfg.logo;
    if (logo.visible === false) {
      // The matching store-name field can still be independently displayed.
    } else {
    const logoResized = await sharp(data.logoImageBuffer)
      .resize(logo.width, logo.height, {
        fit: logo.fit || 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
    compositeLayers.push({ input: logoResized, left: logo.x, top: logo.y, opacity: logo.opacity ?? 1 });
    }
  }

  /* ── 2. Build the text/shape SVG overlay (one combined SVG covers all fields) ── */
  const fieldSvgParts = Object.entries(cfg.fields || {}).map(([key, field]) => {
    let rawValue = key === 'price' ? fieldData.price
      : key === 'originalPrice' ? fieldData.originalPrice
      : key === 'discount' ? fieldData.discount
      : fieldData[key];
    if (field.format === 'number' && Number.isFinite(Number(rawValue))) {
      rawValue = Number(rawValue).toLocaleString('en-LK', { maximumFractionDigits: 2 });
    }
    return field.background
      ? buildPillSvgFragment(field, rawValue, fieldData)
      : buildTextSvgFragment(field, rawValue, fieldData);
  }).join('\n');

  const overlaySvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${fieldSvgParts}</svg>`;
  const overlayBuffer = Buffer.from(overlaySvg);

  /* ── 3. Composite: background → shadow → product → text/shape overlay ── */
  const backgroundLayers = [];
  if (cfg.backgroundOverlay?.opacity > 0) {
    const overlay = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${cfg.backgroundOverlay.color}" opacity="${cfg.backgroundOverlay.opacity}"/></svg>`);
    backgroundLayers.push({ input: overlay, left: 0, top: 0 });
  }
  const finalBuffer = await sharp(bgPath)
    .resize(W, H)
    .composite([
      ...backgroundLayers,
      ...compositeLayers,
      { input: overlayBuffer, left: 0, top: 0 },
    ])
    .png({ quality: 92 })
    .toBuffer();

  return finalBuffer;
}

module.exports = {
  renderTemplate,
  listTemplates,
  getTemplateConfig,
  getTemplateAssetPath,
  applyCustomLayout,
};
