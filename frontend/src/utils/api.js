import axios from 'axios';

/**
 * Central API client optimized for Vercel CDN/Edge Request reduction.
 *
 * Rules:
 * 1. Production frontend calls Railway directly; never proxy /api/* through Vercel.
 * 2. Public GET requests do not send JWT/cookies. This avoids cache fragmentation,
 *    smaller request headers, and unnecessary protected-route failures.
 * 3. Frequently reused public GET requests are deduped and cached in-memory/sessionStorage.
 */
const DEFAULT_API_URL = 'https://shopzen-production.up.railway.app/api';

const normalizeBaseURL = (url) => {
  const raw = (url || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  return raw.endsWith('/api') ? raw : `${raw}/api`;
};

const API_BASE_URL = normalizeBaseURL(process.env.REACT_APP_API_URL);

const API = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000,
  withCredentials: false,
});

const PUBLIC_GET_RULES = [
  { test: /^\/settings(?:$|[/?])/, ttl: 10 * 60 * 1000 },
  { test: /^\/categories(?:$|[/?])/, ttl: 30 * 60 * 1000 },
  { test: /^\/banners(?:$|[/?])/, ttl: 10 * 60 * 1000 },
  { test: /^\/products(?:$|[/?])/, ttl: 3 * 60 * 1000 },
  { test: /^\/reviews\/(featured|google)(?:$|[/?])/, ttl: 10 * 60 * 1000 },
  { test: /^\/seasonal\/(active|page\/)/, ttl: 5 * 60 * 1000 },
  { test: /^\/deals(?:$|[/?])/, ttl: 2 * 60 * 1000 },
  { test: /^\/pages(?:$|[/?])/, ttl: 30 * 60 * 1000 },
  { test: /^\/social-media\/public(?:$|[/?])/, ttl: 30 * 60 * 1000 },
  { test: /^\/whatsapp\/config(?:$|[/?])/, ttl: 30 * 60 * 1000 },
  { test: /^\/payments\/gateways(?:$|[/?])/, ttl: 10 * 60 * 1000 },
  { test: /^\/delivery(?:$|[/?])/, ttl: 10 * 60 * 1000 },
];

const PROTECTED_PREFIXES = [
  '/admin', '/auth', '/orders', '/returns', '/gift-cards', '/notifications',
  '/upload', '/scrape', '/payments/admin', '/delivery/admin', '/backup',
  '/automation', '/monitoring', '/ai', '/ai-post-creator', '/social-media',
];

const memoryCache = new Map();
const pending = new Map();
const SESSION_PREFIX = 'shopzen_api_cache:';

const serializeParams = (params) => {
  if (!params) return '';
  const usp = new URLSearchParams();
  Object.keys(params).sort().forEach((key) => {
    const value = params[key];
    if (value === undefined || value === null || value === '') return;
    if (Array.isArray(value)) value.forEach(v => usp.append(key, v));
    else usp.append(key, value);
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
};

const normalizePath = (url = '', params) => {
  const raw = String(url || '');
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return `${u.pathname.replace(/^\/api/, '')}${u.search || serializeParams(params)}`;
    } catch { return raw; }
  }
  return `${raw.startsWith('/') ? raw : `/${raw}`}${raw.includes('?') ? '' : serializeParams(params)}`;
};

const publicRuleFor = (method, url, params) => {
  if ((method || 'get').toLowerCase() !== 'get') return null;
  const path = normalizePath(url, params);
  if (PROTECTED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) return null;
  return PUBLIC_GET_RULES.find(rule => rule.test.test(path)) || null;
};

const cacheKeyFor = (config) => `${(config.method || 'get').toUpperCase()} ${normalizePath(config.url, config.params)}`;

const readSession = (key) => {
  try {
    const raw = sessionStorage.getItem(SESSION_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const writeSession = (key, entry) => {
  try { sessionStorage.setItem(SESSION_PREFIX + key, JSON.stringify(entry)); } catch {}
};

const clearPublicCache = () => {
  memoryCache.clear();
  pending.clear();
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(SESSION_PREFIX))
      .forEach(k => sessionStorage.removeItem(k));
  } catch {}
};

export { API_BASE_URL, clearPublicCache };

API.interceptors.request.use(config => {
  const method = (config.method || 'get').toLowerCase();
  const isPublicGet = !!publicRuleFor(method, config.url, config.params);

  config.headers = config.headers || {};

  if (isPublicGet) {
    delete config.headers.Authorization;
    config.withCredentials = false;
  } else {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

const originalRequest = API.request.bind(API);

API.request = function optimizedRequest(configOrUrl, config = {}) {
  const cfg = typeof configOrUrl === 'string'
    ? { ...config, url: configOrUrl }
    : { ...(configOrUrl || {}) };

  cfg.method = (cfg.method || 'get').toLowerCase();
  const rule = publicRuleFor(cfg.method, cfg.url, cfg.params);
  if (!rule || cfg.skipClientCache) return originalRequest(cfg);

  const key = cacheKeyFor(cfg);
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && mem.expiresAt > now) return Promise.resolve({ ...mem.response, fromClientCache: true });

  const stored = readSession(key);
  if (stored && stored.expiresAt > now) {
    memoryCache.set(key, stored);
    return Promise.resolve({ ...stored.response, fromClientCache: true });
  }

  if (pending.has(key)) return pending.get(key);

  const promise = originalRequest(cfg).then((response) => {
    const slim = {
      data: response.data,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      config: response.config,
    };
    const entry = { response: slim, expiresAt: Date.now() + rule.ttl };
    memoryCache.set(key, entry);
    writeSession(key, entry);
    return response;
  }).finally(() => pending.delete(key));

  pending.set(key, promise);
  return promise;
};

['get', 'delete', 'head', 'options'].forEach(method => {
  API[method] = (url, config = {}) => API.request({ ...config, method, url });
});

['post', 'put', 'patch'].forEach(method => {
  API[method] = (url, data, config = {}) => API.request({ ...config, method, url, data });
});

API.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const path = normalizePath(err.config?.url, err.config?.params);
      const isProtected = PROTECTED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
      if (isProtected) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

export default API;
