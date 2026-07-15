const express = require('express');
const router = express.Router();
const { DeliveryService, Settings } = require('../models/index');
const Order = require('../models/Order');
const { adminAuth } = require('../middleware/auth');
const curfox = require('../services/curfoxService');
const { getService: getCurfoxService, resolveDestination, submitOrder, syncOrder } = require('../services/curfoxIntegrationService');

// Public - Get enabled delivery services (with delivery settings)
router.get('/', async (req, res) => {
  try {
    const services = await DeliveryService.find({ isEnabled: true })
      .select('-apiKey -apiSecret')
      .sort({ sortOrder: 1, name: 1 });

    // Also return global delivery settings
    const settingDocs = await Settings.find({ key: { $in: [
      'freeDeliveryThreshold','standardDelivery','deliveryETA',
      'deliveryZones','deliveryNote','deliveryEnabled'
    ]}});
    const globalSettings = {};
    settingDocs.forEach(s => { globalSettings[s.key] = s.value; });

    res.json({ services, globalSettings });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Public - Calculate delivery cost (zone-aware)
router.post('/calculate', async (req, res) => {
  try {
    const { serviceCode, orderAmount, city, zone } = req.body;

    if (serviceCode) {
      const service = await DeliveryService.findOne({ code: serviceCode, isEnabled: true });
      if (!service) return res.status(404).json({ message: 'Service not found' });

      // Find zone-specific rate if zone provided
      let rate = null;
      if ((city || zone) && service.zoneRates?.length > 0) {
        const search = (city || zone || '').toLowerCase();
        rate = service.zoneRates.find(zr =>
          zr.zones.some(z => z.toLowerCase() === search || search.includes(z.toLowerCase()))
        );
      }
      // Fall back to base rates
      if (!rate) rate = service.rates?.[0];

      const cost = rate
        ? (rate.freeAbove && orderAmount >= rate.freeAbove ? 0 : rate.price)
        : 0;

      return res.json({
        cost,
        estimatedDays: rate?.estimatedDays || service.estimatedDays,
        isFree: cost === 0,
        freeAbove: rate?.freeAbove || 0,
        serviceName: service.name,
      });
    }

    // Fallback: use global settings
    const settingDocs = await Settings.find({ key: { $in: ['freeDeliveryThreshold','standardDelivery','deliveryETA'] }});
    const gs = {};
    settingDocs.forEach(s => { gs[s.key] = s.value; });

    const threshold = gs.freeDeliveryThreshold || 5000;
    const cost = orderAmount >= threshold ? 0 : (gs.standardDelivery || 600);
    res.json({ cost, isFree: cost === 0, freeAbove: threshold, estimatedDays: gs.deliveryETA || '3-5 business days' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Get all services
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const services = await DeliveryService.find().sort({ sortOrder: 1, name: 1 }).lean();
    res.json(services.map(service => ({ ...service, apiSecret: '', hasCredentials: !!(service.apiKey && service.apiSecret) })));
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Create/update service (full update with zones + rules)
router.put('/admin/:code', adminAuth, async (req, res) => {
  try {
    const patch = { ...req.body, code: req.params.code, updatedAt: new Date() };
    if (req.params.code === 'curfox') {
      const existing = await DeliveryService.findOne({ code: 'curfox' }).lean();
      const config = { ...(existing?.config || {}), ...(patch.config || {}) };
      patch.config = config;
      const missing = [
        ['tenant', 'tenant'], ['businessId', 'merchant business'],
        ['originCity', 'origin city'], ['originState', 'origin state'],
      ].filter(([key]) => !String(config[key] || '').trim()).map(([, label]) => label);
      if (missing.length) return res.status(400).json({ message: `Complete the Curfox ${missing.join(', ')} settings` });
    }
    if (!patch.apiSecret) delete patch.apiSecret;
    const result = await DeliveryService.findOneAndUpdate(
      { code: req.params.code },
      { $set: patch },
      { upsert: true, new: true, runValidators: true }
    );
    const safe = result.toObject();
    safe.hasCredentials = !!(safe.apiKey && safe.apiSecret);
    safe.apiSecret = '';
    res.json(safe);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

async function curfoxService(res) {
  const service = await DeliveryService.findOne({ code: 'curfox' });
  if (!service) res.status(404).json({ message: 'Create the Curfox delivery service in Delivery Settings first' });
  return service;
}

router.post('/admin/curfox/test', adminAuth, async (req, res) => {
  try {
    const stored = await DeliveryService.findOne({ code: 'curfox' });
    const service = {
      apiKey: req.body.apiKey || stored?.apiKey,
      apiSecret: req.body.apiSecret || stored?.apiSecret,
      config: { ...(stored?.config || {}), ...(req.body.config || {}) },
    };
    const [{ user }, businesses] = await Promise.all([curfox.login(service), curfox.listBusinesses(service)]);
    res.json({ connected: true, merchant: user?.merchant_name || user?.merchant?.name, businesses: businesses.data || [] });
  } catch (error) { res.status(502).json({ message: error.message }); }
});

router.get('/admin/curfox/resources', adminAuth, async (_req, res) => {
  try {
    const service = await curfoxService(res); if (!service) return;
    const [businesses, cities, states] = await Promise.all([curfox.listBusinesses(service), curfox.listCities(service), curfox.listStates(service)]);
    res.json({ businesses: businesses.data || [], cities: cities.data || [], states: states.data || [] });
  } catch (error) { res.status(502).json({ message: error.message }); }
});

router.get('/admin/curfox/orders/:orderId/destination', adminAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId).lean();
    if (!order) return res.status(404).json({ message: 'Order not found' });
    const address = order.shipToDifferentAddress ? order.shipping : order.billing;
    const destination = await resolveDestination(await getCurfoxService(), address?.city, '', address?.street);
    res.json(destination);
  } catch (error) { res.status(422).json({ message: error.message }); }
});

router.post('/admin/curfox/orders/:orderId', adminAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId).populate('items.product', 'weight');
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (!['confirmed', 'processing'].includes(order.orderStatus)) return res.status(409).json({ message: 'Confirm the order and move it to Processing before sending it to Curfox' });
    if (order.courierIntegration?.provider === 'curfox' && order.trackingNumber) return res.status(409).json({ message: `Order is already in Curfox (${order.trackingNumber})` });
    const result = await submitOrder(order, req.body, req.user?.email || 'Admin');
    res.json(result.order);
  } catch (error) { res.status(502).json({ message: error.message }); }
});

router.post('/admin/curfox/orders/:orderId/sync', adminAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order?.trackingNumber) return res.status(400).json({ message: 'This order has no Curfox waybill' });
    if (order.courierIntegration?.dryRun || order.trackingNumber.startsWith('DRYRUN-')) {
      return res.status(409).json({ message: 'This was a Curfox dry run; it has no live tracking data' });
    }
    res.json(await syncOrder(order, req.user?.email || 'Admin'));
  } catch (error) { res.status(502).json({ message: error.message }); }
});

// Admin - Toggle service
router.put('/admin/:code/toggle', adminAuth, async (req, res) => {
  try {
    const svc = await DeliveryService.findOne({ code: req.params.code });
    if (!svc) return res.status(404).json({ message: 'Service not found' });
    svc.isEnabled = !svc.isEnabled;
    await svc.save();
    const safe = svc.toObject(); safe.hasCredentials = !!(safe.apiKey && safe.apiSecret); safe.apiSecret = '';
    res.json(safe);
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Delete service
router.delete('/admin/:code', adminAuth, async (req, res) => {
  try {
    await DeliveryService.findOneAndDelete({ code: req.params.code });
    res.json({ message: 'Deleted' });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

// Admin - Reorder services
router.put('/admin/reorder/batch', adminAuth, async (req, res) => {
  try {
    const { order } = req.body; // array of { code, sortOrder }
    for (const item of order) {
      await DeliveryService.findOneAndUpdate({ code: item.code }, { sortOrder: item.sortOrder });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;
