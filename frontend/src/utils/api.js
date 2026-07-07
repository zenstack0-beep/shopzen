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

const normalizeBaseURL = (url) => {
  const raw = (url || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  return raw.endsWith('/api') ? raw : `${raw}/api`;
};

const API = axios.create({
  baseURL: normalizeBaseURL(process.env.REACT_APP_API_URL),
  timeout: 45000,
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
