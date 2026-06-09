import axios from 'axios';

/**
 * API base URL resolution:
 *  - Production (Vercel): /api is rewritten to Railway via vercel.json rewrites.
 *    REACT_APP_API_URL is no longer needed — all /api/* calls stay on the same
 *    Vercel domain and are proxied server-side, so cookies & CORS are never an issue.
 *  - Local dev: React proxy in package.json forwards /api/* to localhost:5001.
 *
 * We always use /api as the base — Vercel handles the routing in both cases.
 */
const API = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true,
});

API.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
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

export default API;