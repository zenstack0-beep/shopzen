import axios from 'axios';

/**
 * API base URL resolution:
 *  - Production (Vercel): REACT_APP_API_URL is set to the Railway backend URL.
 *  - Local dev: React proxy in package.json forwards /api/* to localhost:5001.
 *    BUT the proxy only works when the backend is running. If it's not up yet,
 *    we still use /api and let calls fail gracefully (ThemeContext catches errors).
 */
const BASE = process.env.REACT_APP_API_URL
  ? `${process.env.REACT_APP_API_URL}/api`
  : '/api';

const API = axios.create({
  baseURL: BASE,
  timeout: 15000, // 15s — prevents hanging requests from blocking the UI
});

API.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

API.interceptors.response.use(
  res => res,
  err => {
    // Auto-logout on 401
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default API;
