'use strict';

const { DeliveryService } = require('../models/index');
const curfox = require('./curfoxService');

function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s()]/g, '');
  if (phone.startsWith('0094')) phone = `0${phone.slice(4)}`;
  else if (phone.startsWith('+94')) phone = `0${phone.slice(3)}`;
  else if (phone.startsWith('94') && phone.length === 11) phone = `0${phone.slice(2)}`;
  phone = phone.replace(/[^0-9+-]/g, '');
  const digits = phone.replace(/\D/g, '');
  const plusCount = (phone.match(/\+/g) || []).length;
  const dashCount = (phone.match(/-/g) || []).length;
  if (digits.length < 8 || digits.length > 13 || plusCount > 1 || (plusCount === 1 && !phone.startsWith('+')) || dashCount > 2) {
    throw new Error('Customer phone must contain 8 to 13 digits in a valid Sri Lankan format');
  }
  return phone;
}

async function getService() {
  const service = await DeliveryService.findOne({ code: 'curfox', isEnabled: true });
  if (!service) throw new Error('Curfox delivery service is not enabled');
  return service;
}

async function resolveDestination(service, requestedCity, requestedState, street = '') {
  const primary = String(requestedCity || '').trim();
  const addressParts = String(street || '').split(',').map(part => part.trim()).filter(part =>
    part.length >= 3 && !/^\d+[\w/-]*$/i.test(part) && !/\b(lane|road|street|mawatha|mw|rd)\b/i.test(part)
  ).reverse();
  const candidates = [...new Set([primary, ...addressParts].filter(value => value && value.toLowerCase() !== 'other'))];
  let city = null;
  for (const candidate of candidates) {
    const response = await curfox.listCities(service, candidate);
    const cities = response.data || [];
    city = cities.find(item => String(item.name).toLowerCase() === candidate.toLowerCase()) || (cities.length === 1 ? cities[0] : null);
    if (city) break;
  }
  if (!city) throw new Error('Destination city could not be matched automatically. Update the customer city using an exact Curfox city name.');
  const stateName = city.state?.name || String(requestedState || '').trim();
  if (!stateName) throw new Error(`Curfox did not return a state for city "${city.name}"`);
  return { cityName: city.name, stateName };
}

async function submitOrder(order, overrides = {}, updatedBy = 'Automation') {
  if (order.courierIntegration?.provider === 'curfox' && order.trackingNumber) return { order, alreadySubmitted: true };
  const service = await getService();
  const config = service.config || {};
  if (!config.businessId || !config.originCity || !config.originState) throw new Error('Complete the Curfox business and origin settings first');
  const address = order.shipToDifferentAddress ? order.shipping : order.billing;
  const destination = await resolveDestination(service, overrides.destinationCity || address?.city, overrides.destinationState, address?.street);
  const customerPhone = normalizePhone(address?.phone || order.billing?.phone);
  const calculatedWeight = order.items.reduce((total, item) => total + (Number(item.product?.weight || 0) * Number(item.quantity || 1)), 0);
  const weight = Math.max(0.01, Number(overrides.weight || calculatedWeight || config.defaultWeight || 1));
  const payload = {
    general_data: { merchant_business_id: String(config.businessId), origin_city_name: config.originCity, origin_state_name: config.originState },
    order_data: [{
      ...(String(overrides.waybillNumber || '').trim() ? { waybill_number: String(overrides.waybillNumber).trim() } : {}),
      order_no: order.orderNumber,
      customer_name: `${address?.firstName || ''} ${address?.lastName || ''}`.trim(),
      customer_address: [address?.street, destination.cityName, address?.country].filter(Boolean).join(', '),
      customer_phone: customerPhone,
      destination_city_name: destination.cityName,
      destination_state_name: destination.stateName,
      cod: order.paymentMethod === 'cod' ? Math.round(Number(order.total || 0)) : 0,
      weight,
      description: order.items.map(item => `${item.name} x${item.quantity}`).join(', ').slice(0, 500),
      remark: String(overrides.remark || order.notes || '').slice(0, 500),
      ...(config.initialStatusKey ? { initial_status_key: config.initialStatusKey } : {}),
    }],
  };
  const dryRun = process.env.CURFOX_DRY_RUN === 'true';
  const result = dryRun ? { data: [`DRYRUN-${order.orderNumber}`] } : await curfox.createOrder(service, payload);
  const waybill = result.data?.[0];
  if (!waybill) throw new Error('Curfox created the order but did not return a waybill');
  order.trackingNumber = String(waybill);
  order.deliveryPartner = 'Curfox';
  order.courierIntegration = { provider:'curfox', externalId:String(waybill), submittedAt:new Date(), lastSyncedAt:new Date(), externalStatus:dryRun?'DRY RUN':'DRAFT', dryRun };
  const submissionNote = `${dryRun ? 'Curfox dry run completed' : 'Submitted to Curfox'}. Waybill: ${waybill}`;
  const latestSameStatus = [...order.statusHistory].reverse().find(entry => entry.status === order.orderStatus);
  if (latestSameStatus) {
    latestSameStatus.note = [latestSameStatus.note, submissionNote].filter(Boolean).join(' • ');
    latestSameStatus.updatedAt = new Date();
    latestSameStatus.updatedBy = updatedBy;
  } else {
    order.statusHistory.push({ status:order.orderStatus, note:submissionNote, updatedBy });
  }
  await order.save();
  return { order, dryRun, payload };
}

function mapStatus(name, current) {
  const status = String(name || '').toUpperCase();
  if (status === 'CANCELLED') return 'cancelled';
  let mapped = current;
  if (status.includes('DELIVERED') && !status.includes('PARTIALLY')) mapped = 'delivered';
  else if (status.includes('ASSIGNED TO DESTINATION RIDER')) mapped = 'out_for_delivery';
  else if (['PICKED UP','DISPATCH TO ORIGIN WAREHOUSE','DISPATCHED FROM ORIGIN WAREHOUSE','RECEIVED AT DESTINATION WAREHOUSE'].some(value => status.includes(value))) mapped = 'shipped';
  else if (status && status !== 'DRAFT') mapped = 'processing';
  const rank = { pending:0, confirmed:1, processing:2, shipped:3, out_for_delivery:4, delivered:5 };
  return (rank[mapped] ?? 0) >= (rank[current] ?? 0) ? mapped : current;
}

async function syncOrder(order, updatedBy = 'Curfox Automation') {
  if (!order?.trackingNumber || order.courierIntegration?.dryRun) return order;
  const service = await getService();
  const result = await curfox.tracking(service, order.trackingNumber);
  const events = result.data || [];
  const latest = events[0]?.status?.name || order.courierIntegration?.externalStatus || '';
  const mapped = mapStatus(latest, order.orderStatus);
  if (mapped !== order.orderStatus) {
    order.orderStatus = mapped;
    order.statusHistory.push({ status:mapped, note:`Automatically synced from Curfox: ${latest}`, updatedBy });
    if (mapped === 'delivered' && !order.deliveredAt) order.deliveredAt = new Date();
  }
  order.courierIntegration = { ...(order.courierIntegration?.toObject?.() || order.courierIntegration || {}), provider:'curfox', externalId:order.trackingNumber, lastSyncedAt:new Date(), externalStatus:latest, trackingEvents:events };
  await order.save();
  return order;
}

module.exports = { getService, mapStatus, normalizePhone, resolveDestination, submitOrder, syncOrder };
