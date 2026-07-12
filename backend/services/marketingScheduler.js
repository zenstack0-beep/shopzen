'use strict';

const mongoose = require('mongoose');
const { MarketingRecommendation } = require('../models/Marketing');
const { generateRecommendations, getSettings, sendRecommendation } = require('./marketingService');

let timer = null;
let running = false;

function localParts(timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(new Date());
  const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.find(p=>p.type==='weekday')?.value);
  return { weekday, hour: Number(parts.find(p=>p.type==='hour')?.value) };
}

async function runMarketingJobs() {
  if (running || mongoose.connection.readyState !== 1) return;
  running = true;
  try {
    const settings = await getSettings();
    if (!settings.enabled) return;
    await generateRecommendations();
    if (!settings.automaticSendingEnabled) return;
    const { weekday, hour } = localParts(settings.timezone || 'Asia/Colombo');
    if (!(settings.allowedSendingDays || []).includes(weekday) || hour < settings.allowedSendHours.start || hour >= settings.allowedSendHours.end) return;
    const startOfDay = new Date(); startOfDay.setUTCHours(0,0,0,0);
    const sentToday = await MarketingRecommendation.countDocuments({ sentAt: { $gte: startOfDay }, status: { $in: ['sent','converted'] } });
    const remaining = Math.max(0, settings.maximumEmailsPerDay - sentToday);
    if (!remaining) return;
    const due = await MarketingRecommendation.find({
      $or: [
        { status: 'scheduled', scheduledAt: { $lte: new Date() } },
        { status: 'approved', approvalMode: 'automatic', scheduledAt: { $in: [null, undefined] } },
      ],
    }).select('_id').limit(Math.min(25, remaining)).lean();
    for (const item of due) await sendRecommendation(item._id).catch(error => console.error('[Marketing] send failed:', error.message));
  } catch (error) {
    console.error('[Marketing scheduler]', error.message);
  } finally { running = false; }
}

function startMarketingScheduler() {
  if (timer) return;
  if (!process.env.MARKETING_SIGNING_SECRET) console.warn('[Marketing] MARKETING_SIGNING_SECRET missing; sending remains unavailable');
  timer = setInterval(runMarketingJobs, 5 * 60 * 1000);
  timer.unref?.();
  setTimeout(runMarketingJobs, 15000);
  console.log('[Marketing] durable MongoDB scheduler registered (disabled by settings by default)');
}

module.exports = { localParts, runMarketingJobs, startMarketingScheduler };
