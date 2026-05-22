# ShopZen — Bug Fix Deployment Guide

## Files Changed (copy these into your project)

| Fixed File | Copy To |
|---|---|
| `frontend/src/context/ThemeContext.js` | `frontend/src/context/ThemeContext.js` |
| `frontend/public/index.html` | `frontend/public/index.html` |
| `frontend/src/index.css` | `frontend/src/index.css` |
| `frontend/src/pages/customer/Home.js` | `frontend/src/pages/customer/Home.js` |
| `frontend/src/pages/admin/Settings.js` | `frontend/src/pages/admin/Settings.js` |
| `frontend/vercel.json` | `frontend/vercel.json` |

---

## Bugs Fixed

| Bug | Root Cause | Fix |
|---|---|---|
| Theme flashes default orange on load | `ThemeContext` started with `null` and used `useEffect` (fires after paint) | IIFE + `useLayoutEffect` + localStorage cache; CSS vars set before first pixel |
| CSS `:root` reset the bootstrap | `index.css :root {}` overrode JS-set vars when webpack injected the bundle | Removed all theme defaults from `:root` in `index.css` |
| Newsletter flashed before settings loaded | `settings?.enableNewsletter !== false` is `true` when `settings = null` | Added `settingsReady` guard — blocks render until settings arrive |
| Home page layout ignored admin changes | `Home.js` fetched `/settings` independently and used stale data | Removed duplicate fetch; syncs `sectionOrder` from `ThemeContext.settings` |
| Theme reverted on next page load (production) | Admin save called `applyTheme()` but never wrote `localStorage` | `Settings.js` now writes `localStorage.setItem('shopzen_theme_v1', ...)` on save |
| First visit (no cache) showed default theme | Bootstrap script only ran when `localStorage` had data | Bootstrap now always runs — applies default if no cache, correct theme if cache exists |
| Vercel served stale `index.html` | No cache-control headers on `index.html` | `vercel.json` now sets `no-cache, no-store` for `index.html` only |

---

## Step 1 — Copy the files locally

```bash
# From your project root
cp /path/to/fixed/ThemeContext.js    frontend/src/context/ThemeContext.js
cp /path/to/fixed/index.html         frontend/public/index.html
cp /path/to/fixed/index.css          frontend/src/index.css
cp /path/to/fixed/Home.js            frontend/src/pages/customer/Home.js
cp /path/to/fixed/Settings.js        frontend/src/pages/admin/Settings.js
cp /path/to/fixed/vercel.json        frontend/vercel.json
```

---

## Step 2 — Clear old localStorage cache (one-time only)

The old cache key was `shopzen_theme_settings`. The new key is `shopzen_theme_v1`.
Open your browser console on the live site and run:

```js
localStorage.removeItem('shopzen_theme_settings');
localStorage.removeItem('shopzen_theme_v1');
```

This forces a fresh fetch from the API on next load, which will then write the correct new cache key.

---

## Step 3 — Test locally

```bash
cd frontend
npm start
```

1. Open http://localhost:3000 — should load with the **correct theme immediately**, no flash.
2. Open admin → Settings → change theme to something different → Save.
3. Open a new tab at http://localhost:3000 — should load with the new theme instantly.
4. Hard-refresh (Ctrl+Shift+R) — still no flash.

---

## Step 4 — Build for production

```bash
cd frontend
npm run build
```

Fix any build errors before deploying.

---

## Step 5 — Deploy frontend to Vercel

### Option A — Via Vercel CLI (recommended)

```bash
# Install Vercel CLI if not already installed
npm install -g vercel

cd frontend

# First time setup
vercel

# Subsequent deploys
vercel --prod
```

When prompted:
- **Framework**: Create React App
- **Build command**: `npm run build`
- **Output directory**: `build`
- **Root directory**: `frontend` (if deploying from project root)

### Option B — Via Vercel Dashboard

1. Go to https://vercel.com/dashboard
2. Click your ShopZen project → **Settings** → **Git**
3. Push your changes to GitHub:
   ```bash
   git add .
   git commit -m "fix: eliminate theme flash, fix home customizations"
   git push origin main
   ```
4. Vercel will auto-deploy. Watch the build logs.

### Set Environment Variables in Vercel

Go to your Vercel project → **Settings** → **Environment Variables** and ensure:

```
REACT_APP_API_URL = https://shopzen-production.up.railway.app
```

⚠️ **This is critical.** Without it, `api.js` falls back to `/api` which Vercel cannot proxy to Railway.

---

## Step 6 — Deploy backend to Railway (if backend changed)

```bash
# Backend has no changes in this fix.
# Only redeploy if you changed backend files.
cd backend
# Railway deploys automatically on git push if connected to GitHub
git push origin main
```

---

## Step 7 — Post-deploy verification

1. **Open production URL in incognito** (no localStorage) → no theme flash ✅
2. **Open production URL normally** (has cache) → no theme flash ✅  
3. **Admin → Settings → change theme → Save** → refresh customer site → new theme loads instantly ✅
4. **Admin → Layout Editor → reorder sections → Save** → home page reflects new order ✅
5. **Hard-refresh** the page → still correct theme ✅

---

## Troubleshooting

### "Theme still flashing" after deploy
- Check that `REACT_APP_API_URL` is set in Vercel env vars
- Check that `vercel.json` was deployed (run `vercel env ls` or check dashboard)
- Open browser console → Application → Local Storage → look for `shopzen_theme_v1`
- If it's missing: the API call is failing. Check Railway backend logs.

### "Theme is wrong after admin save"
- Open browser console after saving in admin
- Run `localStorage.getItem('shopzen_theme_v1')` — it should show the new theme
- If not: the Settings.js fix wasn't deployed

### "Build fails"
- Make sure `node_modules` is up to date: `npm install`
- Check for any ESLint errors in the modified files

### CORS errors in production
- Make sure `FRONTEND_URL` env var is set in Railway backend to your exact Vercel URL
  e.g. `FRONTEND_URL=https://shopzen.vercel.app`
