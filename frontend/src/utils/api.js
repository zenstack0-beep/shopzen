import axios from 'axios';

/**
 * Central API client.
 *
 * Production must call Railway directly. Do NOT use /api on shopzen.lk,
 * because Vercel counts every proxied /api/* request as an Edge Request and
 * can also increase Function Invocation usage.
 *
 * Required Vercel frontend env:
 *   REACT_APP_API_URL=https://shopzen-production.up.railway.app/api
 */
const DEFAULT_API_URL = 'https://shopzen-production.up.railway.app/api';
export const API_BASE_URL = DEFAULT_API_URL;
const PUBLIC_CACHE_PREFIX = 'shopzen_public_api_cache_v1:';

const normalizeBaseURL = (url) => {
  const rawInput = (url || DEFAULT_API_URL).trim().replace(/\/+$/, '');

  // Safety guard: if production env was accidentally set to shopzen.lk/api,
  // force Railway direct API to avoid Vercel /api Edge Requests.
  try {
    const parsed = new URL(rawInput, window.location.origin);
    const isShopzenFrontend = /(^|\.)shopzen\.lk$/i.test(parsed.hostname);
    if (process.env.NODE_ENV === 'production' && isShopzenFrontend) {
      return DEFAULT_API_URL;
    }
  } catch {}

  return rawInput.endsWith('/api') ? rawInput : `${rawInput}/api`;
};

const API = axios.create({
  baseURL: normalizeBaseURL(process.env.REACT_APP_API_URL),
  timeout: 45000,
  withCredentials: true,
});

const getPath = (url = '') => {
  try {
    const parsed = new URL(url, API.defaults.baseURL);
    return `${parsed.pathname.replace(/^\/api/, '')}${parsed.search || ''}` || '/';
  } catch {
    return String(url || '');
  }
};

const isPublicGetPath = (url = '') => {
  const path = getPath(url);
  return (
    path === '/settings' ||
    path.startsWith('/products') ||
    path.startsWith('/categories') ||
    path.startsWith('/banners') ||
    path.startsWith('/deals') ||
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
  if (path.startsWith('/notifications')) return 60 * 1000;
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
  try {
    const raw = localStorage.getItem(PUBLIC_CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const writeStoredCache = (key, entry) => {
  try {
    localStorage.setItem(PUBLIC_CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {}
};

const makeCachedResponse = (entry) => ({
  data: entry.data,
  status: 200,
  statusText: 'OK (client cache)',
  headers: entry.headers || {},
  config: entry.config || {},
  request: null,
  fromClientCache: true,
});

const rawGet = API.get.bind(API);

API.get = (url, config = {}) => {
  const shouldCache =
    config.cache !== false &&
    isPublicGetPath(url) &&
    !(config.headers && config.headers.Authorization);

  if (!shouldCache) return rawGet(url, config);

  const key = cacheKeyFor(url, config);
  const ttl = Number.isFinite(config.cacheTtl) ? config.cacheTtl : ttlForPath(url);
  const now = Date.now();
  const mem = memoryPublicCache.get(key);

  if (mem && now - mem.cachedAt < ttl) {
    return Promise.resolve(makeCachedResponse(mem));
  }

  const stored = readStoredCache(key);
  if (stored && now - stored.cachedAt < ttl) {
    memoryPublicCache.set(key, stored);
    return Promise.resolve(makeCachedResponse(stored));
  }

  if (pendingPublicGets.has(key)) return pendingPublicGets.get(key);

  const request = rawGet(url, config)
    .then((res) => {
      const entry = {
        data: res.data,
        headers: res.headers,
        config: res.config,
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
  try {
    Object.keys(localStorage).forEach((key) => {
      if (!key.startsWith(PUBLIC_CACHE_PREFIX)) return;
      if (!prefix || key.slice(PUBLIC_CACHE_PREFIX.length).startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    });
  } catch {}
};

API.interceptors.request.use(config => {
  const method = (config.method || 'get').toLowerCase();

  // Public GET endpoints should not carry JWT. This improves CDN/browser cache
  // behaviour and avoids user-specific variants for shared storefront data.
  if (method === 'get' && isPublicGetPath(config.url || '')) {
    if (config.headers) delete config.headers.Authorization;
    return config;
  }

  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const path = getPath(err.config?.url || '');
      const isAuthPage = window.location.pathname === '/login' || window.location.pathname === '/register';
      const isPublicGet = (err.config?.method || 'get').toLowerCase() === 'get' && isPublicGetPath(path);
      if (!isPublicGet && !isAuthPage) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default API;