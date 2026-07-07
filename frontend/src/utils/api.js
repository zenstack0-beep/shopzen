import axios from 'axios';

/**
 * Edge-request-safe API client.
 *
 * Production MUST call Railway directly, not /api through Vercel.
 * Required Vercel env:
 *   REACT_APP_API_URL=https://shopzen-production.up.railway.app/api
 *
 * Local fallback remains /api so CRA proxy/local dev can still work.
 */
const normalizeBaseURL = (value) => {
  const raw = (value || '').trim();
  if (!raw) return '/api';
  return raw.replace(/\/+$/, '');
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
