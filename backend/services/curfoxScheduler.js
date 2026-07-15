'use strict';

const Order = require('../models/Order');
const { syncOrder } = require('./curfoxIntegrationService');

let timer;
async function runCurfoxSync() {
  const orders = await Order.find({
    'courierIntegration.provider': 'curfox',
    'courierIntegration.dryRun': { $ne: true },
    // Tracking automation starts only after the admin confirms that the parcel
    // was physically collected and manually marks the ShopZen order Shipped.
    orderStatus: { $in: ['shipped','out_for_delivery'] },
    trackingNumber: { $exists: true, $ne: '' },
  }).sort({ 'courierIntegration.lastSyncedAt': 1 }).limit(50);
  for (const order of orders) await syncOrder(order).catch(error => console.error(`[Curfox Sync] ${order.orderNumber}:`, error.message));
}

function startCurfoxScheduler() {
  if (timer) return;
  timer = setInterval(() => runCurfoxSync().catch(error => console.error('[Curfox Sync]', error.message)), 10 * 60 * 1000);
  setTimeout(() => runCurfoxSync().catch(error => console.error('[Curfox Sync]', error.message)), 30000);
  console.log('[Curfox] automatic tracking sync registered (every 10 minutes)');
}

module.exports = { runCurfoxSync, startCurfoxScheduler };
