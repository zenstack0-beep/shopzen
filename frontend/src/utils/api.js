import axios from 'axios';

/**
 * Central API client.
 *
 * IMPORTANT FOR VERCEL USAGE:
 * Frontend API traffic must go directly to Railway, not through shopzen.lk/api/*.
 * Vercel counts every request received by the deployment as an Edge Request.
 */
const DEFAULT_API_URL = 'https://shopzen-production.up.railway.app/api';

const normalizeBaseURL = (url) => {
  const raw = (url || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  return raw.endsWith('/api') ? raw : `${raw}/api`;
};

const API = axios.create({
  baseURL: normalizeBaseURL(process.env.REACT_APP_API_URL),
  timeout: 45000,
  withCredentials: true,
});

/**
 * Small client-side cache for anonymous public GET endpoints.
 * This reduces repeated Railway traffic and prevents React route changes from
 * refetching the same public data immediately. Admin/private endpoints are not
 * cached and continue to receive the auth token normally.
 */
const publicGetCache = new Map();
const publicGetPending = new Map();

const PUBLIC_GET_TTLS = [
  [/^\/settings(?:$|\?)/, 10 * 60 * 1000],
  [/^\/categories(?:$|\/|\?)/, 10 * 60 * 1000],
  [/^\/banners(?:$|\/|\?)/, 5 * 60 * 1000],
  [/^\/pages(?:$|\/|\?)/, 10 * 60 * 1000],
  [/^\/seasonal\/active(?:$|\?)/, 5 * 60 * 1000],
  [/^\/social-media\/public(?:$|\?)/, 10 * 60 * 1000],
  [/^\/whatsapp\/config(?:$|\?)/, 10 * 60 * 1000],
  [/^\/deals(?:$|\/|\?)/, 60 * 1000],
  [/^\/reviews\/(featured|google|product\/[^/?]+)(?:$|\?)/, 5 * 60 * 1000],
  [/^\/products(?:$|\?)/, 2 * 60 * 1000],
  [/^\/products\/[^/?]+(?:$|\?)/, 5 * 60 * 1000],
];

const normalizePath = (url = '') => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) {
    try { return new URL(url).pathname + new URL(url).search; } catch { return url; }
  }
  return url.startsWith('/') ? url : `/${url}`;
};

const getPublicTtl = (url) => {
  const path = normalizePath(url);
  const matched = PUBLIC_GET_TTLS.find(([pattern]) => pattern.test(path));
  return matched ? matched[1] : 0;
};

const stableParams = (params) => {
  if (!params || typeof params !== 'object') return '';
  return Object.keys(params).sort().map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? '')}`).join('&');
};

const cacheKeyFor = (url, config = {}) => {
  const path = normalizePath(url);
  const params = stableParams(config.params);
  return params ? `${path}${path.includes('?') ? '&' : '?'}${params}` : path;
};

export const clearPublicApiCache = (prefix = '') => {
  const normalizedPrefix = prefix ? normalizePath(prefix) : '';
  for (const key of publicGetCache.keys()) {
    if (!normalizedPrefix || key.startsWith(normalizedPrefix)) publicGetCache.delete(key);
  }
  for (const key of publicGetPending.keys()) {
    if (!normalizedPrefix || key.startsWith(normalizedPrefix)) publicGetPending.delete(key);
  }
};

const originalGet = API.get.bind(API);
API.get = (url, config = {}) => {
  const ttl = getPublicTtl(url);
  if (!ttl || config?.skipClientCache) return originalGet(url, config);

  const key = cacheKeyFor(url, config);
  const now = Date.now();
  const cached = publicGetCache.get(key);

  if (cached && now - cached.cachedAt < ttl) {
    return Promise.resolve({
      ...cached.response,
      config: { ...(cached.response.config || {}), fromClientCache: true },
      fromClientCache: true,
    });
  }

  if (publicGetPending.has(key)) return publicGetPending.get(key);

  const request = originalGet(url, { ...config, __skipAuthForPublicGet: true })
    .then((response) => {
      publicGetCache.set(key, { cachedAt: Date.now(), response });
      return response;
    })
    .finally(() => publicGetPending.delete(key));

  publicGetPending.set(key, request);
  return request;
};

API.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token && !config.__skipAuthForPublicGet) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

API.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

['post', 'put', 'patch', 'delete'].forEach((method) => {
  const original = API[method].bind(API);
  API[method] = (...args) => original(...args).then((response) => {
    clearPublicApiCache();
    return response;
  });
});

export default API;
