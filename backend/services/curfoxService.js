'use strict';

const axios = require('axios');

const BASE_URL = 'https://v1.api.curfox.com';

function errorMessage(error) {
  const data = error.response?.data;
  const validation = data?.errors && Object.values(data.errors).flat().filter(Boolean).join(' ');
  const message = validation || data?.message || error.message || 'Curfox request failed';
  if (/undefined array key\s+["']?waybill_number/i.test(message)) {
    return 'Royal Express requires a manual waybill number for this account. Enter a provider-issued waybill number and retry, or ask Royal Express to enable automatic waybill generation.';
  }
  return message;
}

async function login(service) {
  if (!service?.config?.tenant || !service.apiKey || !service.apiSecret) {
    throw new Error('Curfox tenant, email and password are required');
  }
  try {
    const { data } = await axios.post(`${BASE_URL}/api/public/merchant/login`, {
      email: service.apiKey,
      password: service.apiSecret,
    }, { headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-tenant': service.config.tenant }, timeout: 20000 });
    if (!data?.token) throw new Error('Curfox did not return an access token');
    return { token: data.token, user: data.user };
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

async function request(service, method, path, options = {}) {
  const { token } = await login(service);
  try {
    const { data } = await axios({
      method,
      url: `${BASE_URL}${path}`,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-tenant': service.config.tenant, Authorization: `Bearer ${token}` },
      timeout: 20000,
      ...options,
    });
    return data;
  } catch (error) {
    throw new Error(errorMessage(error));
  }
}

const listBusinesses = service => request(service, 'get', '/api/public/merchant/business', { params: { noPagination: 1 } });
const listCities = (service, search = '') => request(service, 'get', '/api/public/merchant/city', { params: { noPagination: 1, ...(search ? { 'filter[name]': search } : {}) } });
const listStates = service => request(service, 'get', '/api/public/merchant/state', { params: { noPagination: 1 } });
const createOrder = (service, payload) => request(service, 'post', '/api/public/merchant/order/single', { data: payload });
const tracking = (service, waybill) => request(service, 'get', '/api/public/merchant/order/tracking-info', { params: { waybill_number: waybill } });

module.exports = { createOrder, listBusinesses, listCities, listStates, login, tracking };
