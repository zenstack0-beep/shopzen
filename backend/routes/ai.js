/**
 * routes/ai.js  — AI autofill helpers
 * Primary: OpenRouter | Fallback: Gemini
 *
 * Endpoints:
 *   POST /api/ai/autofill   → { brand, shortDescription }
 *   POST /api/ai/tags       → { tags: string[] }          ← HIGH-QUALITY SEO tags
 *   POST /api/ai/seo        → { metaTitle, metaDesc, focusKeyword, schema }
 *   GET  /api/ai/status     → { provider, status }
 */
const express = require('express');
const router  = express.Router();
const { adminAuth } = require('../middleware/auth');

router.use(adminAuth);

/* ══════════════════════════════════════════════════════════════════
   AI CALLERS
══════════════════════════════════════════════════════════════════ */

async function callOpenRouter(systemMsg, userMsg, maxTokens = 1000) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer':  process.env.FRONTEND_URL || 'https://shopzen.lk',
      'X-Title':       'ShopZen',
    },
    body: JSON.stringify({
      model:       'meta-llama/llama-3.1-8b-instruct',
      max_tokens:  maxTokens,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg   },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

async function callGemini(prompt, maxTokens = 1000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

async function callAI(systemMsg, userMsg, maxTokens = 1000) {
  if (process.env.OPENROUTER_API_KEY) {
    try {
      return await callOpenRouter(systemMsg, userMsg, maxTokens);
    } catch (err) {
      console.warn('[AI] OpenRouter failed, trying Gemini fallback:', err.message);
      if (process.env.GEMINI_API_KEY)
        return await callGemini(`${systemMsg}\n\n${userMsg}`, maxTokens);
      throw err;
    }
  }
  if (process.env.GEMINI_API_KEY)
    return callGemini(`${systemMsg}\n\n${userMsg}`, maxTokens);
  throw new Error('No AI key configured. Set OPENROUTER_API_KEY or GEMINI_API_KEY in your .env');
}

/* ── safe JSON extractor ── */
function extractJSON(raw, type = 'object') {
  const open  = type === 'array' ? '[' : '{';
  const close = type === 'array' ? ']' : '}';
  const start = raw.indexOf(open);
  const end   = raw.lastIndexOf(close);
  if (start === -1 || end === -1 || end <= start)
    throw new Error(`No JSON ${type} in response: ` + raw.slice(0, 120));
  return JSON.parse(raw.slice(start, end + 1));
}

/* ══════════════════════════════════════════════════════════════════
   POST /api/ai/autofill  →  { brand, shortDescription }
══════════════════════════════════════════════════════════════════ */
router.post('/autofill', async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim().length < 3)
    return res.status(400).json({ message: 'Product name too short' });

  const n = name.trim();
  const systemMsg = 'You output ONLY valid JSON. No markdown. No explanation.';
  const userMsg = `For the product "${n}", reply with this JSON and nothing else:
{"brand":"BRAND_HERE","shortDescription":"DESCRIPTION_HERE"}
- BRAND_HERE: the brand/manufacturer name (empty string if unknown)
- DESCRIPTION_HERE: a compelling product description under 12 words`;

  try {
    const raw    = await callAI(systemMsg, userMsg, 300);
    const parsed = extractJSON(raw, 'object');
    res.json({
      brand:            (parsed.brand            || '').trim(),
      shortDescription: (parsed.shortDescription || '').trim(),
    });
  } catch (err) {
    console.error('[AI /autofill]', err.message);
    res.status(500).json({ message: 'AI autofill failed: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/ai/tags  →  { tags: string[] }
   HIGH-QUALITY SEO tags — buyer-intent + long-tail keywords
══════════════════════════════════════════════════════════════════ */
router.post('/tags', async (req, res) => {
  const { name, category, brand, description, price } = req.body;
  if (!name || name.trim().length < 3)
    return res.status(400).json({ message: 'Product name too short' });

  const ctx = [
    name,
    brand     && `Brand: ${brand}`,
    category  && `Category: ${category}`,
    price     && `Price: Rs.${price}`,
    description && `Description snippet: ${String(description).replace(/<[^>]+>/g,'').slice(0,200)}`,
  ].filter(Boolean).join('\n');

  const systemMsg = 'You are an expert e-commerce SEO specialist. You output ONLY valid JSON arrays. No markdown. No explanation.';
  const userMsg = `Generate 15 high-value SEO search tags for this Sri Lankan e-commerce product. 

Product info:
${ctx}

Rules:
- Mix of: exact product keywords, buyer-intent phrases, long-tail variations, brand+product combos, category terms
- Include Sri Lanka / LK specific buying terms where relevant (e.g. "buy in sri lanka", "colombo delivery")
- Tags must be what real shoppers TYPE into Google/search bars
- All lowercase, no special characters except hyphens
- 1 to 4 words each — no full sentences

Reply ONLY with a JSON array of 15 strings:
["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13","tag14","tag15"]`;

  try {
    const raw  = await callAI(systemMsg, userMsg, 600);
    console.log('[AI tags raw]', raw);
    const arr  = extractJSON(raw, 'array');
    const tags = Array.isArray(arr)
      ? arr.map(t => String(t).trim().toLowerCase().replace(/[^a-z0-9\s\-]/g, '')).filter(t => t.length > 1).slice(0, 15)
      : [];
    if (tags.length === 0) throw new Error('AI returned empty tags');
    res.json({ tags });
  } catch (err) {
    console.error('[AI /tags]', err.message);
    res.status(500).json({ message: 'AI tag suggestion failed: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════
   POST /api/ai/seo  →  { metaTitle, metaDesc, focusKeyword, schema }
   Full on-page SEO package for a product
══════════════════════════════════════════════════════════════════ */
router.post('/seo', async (req, res) => {
  const { name, category, brand, description, price, salePrice, sku, tags, slug } = req.body;
  if (!name || name.trim().length < 3)
    return res.status(400).json({ message: 'Product name too short' });

  const siteUrl   = (process.env.FRONTEND_URL || 'https://shopzen.lk').replace(/\/$/, '');
  const productUrl = `${siteUrl}/product/${slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const descText  = String(description || '').replace(/<[^>]+>/g, '').slice(0, 300);
  const tagList   = Array.isArray(tags) ? tags.join(', ') : tags || '';

  const systemMsg = 'You are a senior SEO expert specialising in e-commerce. Output ONLY valid JSON. No markdown fences. No explanation.';
  const userMsg = `Create a complete SEO package for this product listed on a Sri Lankan online store (shopzen.lk).

Product details:
- Name: ${name}
- Brand: ${brand || 'unknown'}
- Category: ${category || 'General'}
- Price: Rs.${price}${salePrice ? ` (Sale: Rs.${salePrice})` : ''}
- SKU: ${sku || 'N/A'}
- Tags: ${tagList}
- Description snippet: ${descText}
- Product URL: ${productUrl}

Return ONLY this JSON (fill every field, no nulls):
{
  "metaTitle": "...",
  "metaDesc": "...",
  "focusKeyword": "...",
  "secondaryKeywords": ["...", "..."],
  "schema": {}
}

Rules:
- metaTitle: 50–60 chars, include main keyword + brand if space allows + "| ShopZen" suffix
- metaDesc: 140–160 chars, include focus keyword naturally, mention Sri Lanka / fast delivery, add a call to action
- focusKeyword: the single best keyword a shopper would use to find this exact product
- secondaryKeywords: 5 related long-tail keyword phrases (what people also search)
- schema: complete JSON-LD Product schema object (type Product) with name, description, brand, offers (price, priceCurrency LKR, availability, url), image placeholder "IMAGE_URL", sku`;

  try {
    const raw    = await callAI(systemMsg, userMsg, 1200);
    console.log('[AI seo raw]', raw);
    const parsed = extractJSON(raw, 'object');

    // Validate and sanitize
    const result = {
      metaTitle:         (parsed.metaTitle         || `${name} | ShopZen`).slice(0, 70),
      metaDesc:          (parsed.metaDesc           || '').slice(0, 165),
      focusKeyword:      (parsed.focusKeyword       || name).toLowerCase(),
      secondaryKeywords: Array.isArray(parsed.secondaryKeywords) ? parsed.secondaryKeywords.slice(0, 5) : [],
      schema:            parsed.schema              || {},
    };

    res.json(result);
  } catch (err) {
    console.error('[AI /seo]', err.message);
    res.status(500).json({ message: 'AI SEO generation failed: ' + err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════
   GET /api/ai/status
══════════════════════════════════════════════════════════════════ */
router.get('/status', (req, res) => {
  if (process.env.OPENROUTER_API_KEY) return res.json({ provider: 'openrouter', status: 'ok' });
  if (process.env.GEMINI_API_KEY)     return res.json({ provider: 'gemini',     status: 'ok' });
  res.status(500).json({ provider: 'none', status: 'error' });
});

module.exports = router;