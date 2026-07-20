import axios from 'axios';

/**
 * Central API client.
 *
 * Important for Vercel usage:
 * - Production storefront/admin API calls must go directly to Railway.
 * - Do not use https://shopzen.lk/api because that goes through Vercel CDN/rewrite
 *   and increases Edge Requests / Function Invocations.
 */
const DEFAULT_API_URL = 'https://shopzen-production.up.railway.app/api';
const PUBLIC_CACHE_PREFIX = 'shopzen_public_api_cache_v3:';

const hasWindow = typeof window !== 'undefined';
const hasLocalStorage = () => hasWindow && typeof window.localStorage !== 'undefined';

// Remove the previous public-settings cache generation, which may contain
// fields that are now classified as server-only secrets.
if (hasLocalStorage()) {
  try {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith('shopzen_public_api_cache_v2:'))
      .forEach(key => window.localStorage.removeItem(key));
  } catch {}
}

const normalizeBaseURL = (url) => {
  const configured = String(url || '').trim();
  // In local development, an intentionally blank REACT_APP_API_URL uses the
  // CRA proxy from package.json (/api → localhost:5001). Production continues
  // to bypass Vercel and call Railway directly.
  const rawInput = (configured || (process.env.NODE_ENV === 'development' ? '/api' : DEFAULT_API_URL)).replace(/\/+$/, '');

  try {
    const parsed = new URL(rawInput, hasWindow ? window.location.origin : DEFAULT_API_URL);
    const isShopzenFrontend = /(^|\.)shopzen\.lk$/i.test(parsed.hostname);

    // Safety guard: never let production API calls go through Vercel domain.
    if (process.env.NODE_ENV === 'production' && isShopzenFrontend) {
      return DEFAULT_API_URL;
    }
  } catch {
    // Keep fallback below.
  }

  return rawInput.endsWith('/api') ? rawInput : `${rawInput}/api`;
};

export const API_BASE_URL = normalizeBaseURL(process.env.REACT_APP_API_URL);

const API = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000,
  withCredentials: true,
});

const getPath = (url = '') => {
  try {
    const parsed = new URL(url, API_BASE_URL);
    return `${parsed.pathname.replace(/^\/api/, '')}${parsed.search || ''}` || '/';
  } catch {
    return String(url || '');
  }
};

const isAdminOrPrivatePath = (path = '') => {
  return (
    path.includes('/admin') ||
    path.startsWith('/auth') ||
    path.startsWith('/orders') ||
    path.startsWith('/returns') ||
    path.startsWith('/backup') ||
    path.startsWith('/monitoring') ||
    path.startsWith('/automation') ||
    path.startsWith('/subscribers') ||
    path.startsWith('/upload') ||
    path.startsWith('/notifications') ||
    path.startsWith('/social-media') ||
    path.startsWith('/gift-cards/admin') ||
    path.startsWith('/gift-cards/my') ||
    path.startsWith('/reviews/reviewable') ||
    path.startsWith('/reviews/admin') ||
    path.startsWith('/coupons')
  );
};

const isPublicGetPath = (url = '') => {
  const path = getPath(url);

  // Critical: never treat admin/private endpoints as public.
  // This fixes admin "No products found" / "Failed to load categories" caused by JWT removal.
  if (isAdminOrPrivatePath(path)) return false;

  return (
    path === '/settings' ||
    path === '/categories' ||
    path === '/categories/all' ||
    path.startsWith('/categories/siblings/') ||
    path.startsWith('/categories/sub/') ||
    path === '/products' ||
    path.startsWith('/products?') ||
    path.startsWith('/products/') ||
    path.startsWith('/banners') ||
    path.startsWith('/deals') ||
    path.startsWith('/offers/eligible') ||
    path.startsWith('/offers/active') ||
    path.startsWith('/seasonal/active') ||
    path.startsWith('/seasonal/page/') ||
    path.startsWith('/social-media/public') ||
    path.startsWith('/pages') ||
    path.startsWith('/whatsapp/config') ||
    path.startsWith('/reviews/product/') ||
    path.startsWith('/reviews/featured') ||
    path.startsWith('/reviews/google') ||
    path.startsWith('/payments/gateways') ||
    path === '/delivery' ||
    path.startsWith('/gift-cards/balance/')
  );
};

const ttlForPath = (url = '') => {
  const path = getPath(url);
  if (path === '/settings') return 30 * 60 * 1000;
  if (path.startsWith('/products') || path.startsWith('/categories')) return 5 * 60 * 1000;
  if (path.startsWith('/banners') || path.startsWith('/deals') || path.startsWith('/seasonal')) return 5 * 60 * 1000;
  if (path.startsWith('/whatsapp/config') || path.startsWith('/social-media/public') || path.startsWith('/pages')) return 15 * 60 * 1000;
  if (path.startsWith('/reviews/')) return 10 * 60 * 1000;
  return 2 * 60 * 1000;
};

const pendingPublicGets = new Map();
const memoryPublicCache = new Map();

const cacheKeyFor = (url, config = {}) => {
  const params = config.params ? `::${JSON.stringify(config.params)}` : '';
  return `${getPath(url)}${params}`;
};

const readStoredCache = (key) => {
  if (!hasLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(PUBLIC_CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const writeStoredCache = (key, entry) => {
  if (!hasLocalStorage()) return;
  try {
    window.localStorage.setItem(PUBLIC_CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Ignore quota/private-mode errors.
  }
};

const makeCachedResponse = (entry, config = {}) => ({
  data: entry.data,
  status: 200,
  statusText: 'OK (client cache)',
  headers: entry.headers || {},
  config,
  request: null,
  fromClientCache: true,
});

const rawGet = API.get.bind(API);

// Public storefront requests can occasionally fail on the first hit when the
// production API is waking up or a mobile in-app browser briefly changes
// networks. Never convert those transient failures into a false "not found".
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const isTransientGetError = (error) => {
  const status = Number(error?.response?.status || 0);
  return (
    !error?.response ||
    error?.code === 'ECONNABORTED' ||
    error?.code === 'ERR_NETWORK' ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
};

const getWithRetry = async (url, config = {}) => {
  const maxAttempts = Math.max(1, Number(config.retryAttempts || 3));
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await rawGet(url, config);
    } catch (error) {
      lastError = error;
      if (!isTransientGetError(error) || attempt === maxAttempts) throw error;

      // Short exponential delay: 350ms, 700ms. This is long enough for a
      // transient gateway/cold-start failure but remains fast for ad visitors.
      await sleep(350 * (2 ** (attempt - 1)));
    }
  }

  throw lastError;
};

API.get = (url, config = {}) => {
  const path = getPath(url);
  const shouldCache =
    config.cache !== false &&
    isPublicGetPath(path) &&
    !(config.headers && (config.headers.Authorization || config.headers.authorization));

  if (!shouldCache) return getWithRetry(url, config);

  const key = cacheKeyFor(url, config);
  const ttl = Number.isFinite(config.cacheTtl) ? config.cacheTtl : ttlForPath(path);
  const now = Date.now();
  const mem = memoryPublicCache.get(key);

  if (mem && now - mem.cachedAt < ttl) {
    return Promise.resolve(makeCachedResponse(mem, config));
  }

  const stored = readStoredCache(key);
  if (stored && now - stored.cachedAt < ttl) {
    memoryPublicCache.set(key, stored);
    return Promise.resolve(makeCachedResponse(stored, config));
  }

  if (pendingPublicGets.has(key)) return pendingPublicGets.get(key);

  const request = getWithRetry(url, config)
    .then((res) => {
      const entry = {
        data: res.data,
        headers: res.headers,
        cachedAt: Date.now(),
      };
      memoryPublicCache.set(key, entry);
      writeStoredCache(key, entry);
      return res;
    })
    .finally(() => pendingPublicGets.delete(key));

  pendingPublicGets.set(key, request);
  return request;
};

API.clearPublicCache = (pathPrefix = '') => {
  const prefix = pathPrefix ? getPath(pathPrefix).replace(/\?.*$/, '') : '';

  [...memoryPublicCache.keys()].forEach((key) => {
    if (!prefix || key.startsWith(prefix)) memoryPublicCache.delete(key);
  });

  if (!hasLocalStorage()) return;

  try {
    Object.keys(window.localStorage).forEach((key) => {
      if (!key.startsWith(PUBLIC_CACHE_PREFIX)) return;
      const publicKey = key.slice(PUBLIC_CACHE_PREFIX.length);
      if (!prefix || publicKey.startsWith(prefix)) {
        window.localStorage.removeItem(key);
      }
    });
  } catch {
    // Ignore.
  }
};

API.interceptors.request.use((config) => {
  const method = (config.method || 'get').toLowerCase();
  const path = getPath(config.url || '');
  config.headers = config.headers || {};

  const token = hasLocalStorage() ? window.localStorage.getItem('token') : null;
  const isPublicGet = method === 'get' && isPublicGetPath(path);

  if (isPublicGet) {
    // Public GET endpoints should not carry JWT. This improves cache behavior
    // and avoids user-specific variants for storefront data.
    delete config.headers.Authorization;
    delete config.headers.authorization;
    return config;
  }

  // Admin/customer/private endpoints must always receive JWT.
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

API.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const path = getPath(err.config?.url || '');
      const method = (err.config?.method || 'get').toLowerCase();
      const isPublicGet = method === 'get' && isPublicGetPath(path);
      const isAuthPage = hasWindow && (window.location.pathname === '/login' || window.location.pathname === '/register');
      const hadAuthorization = Boolean(
        err.config?.headers?.Authorization || err.config?.headers?.authorization
      );

      // Only expire the session when this request actually used a JWT.
      // Guest pages can make optional authenticated requests; a 401 from one
      // of those must not force an anonymous shopper onto the login screen.
      if (hadAuthorization && !isPublicGet && !isAuthPage && hasLocalStorage()) {
        window.localStorage.removeItem('token');
        window.localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default API;