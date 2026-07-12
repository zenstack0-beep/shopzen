'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { Subscriber } = require('../models/index');
const { CustomerMarketingPreference } = require('../models/Marketing');
const User = require('../models/User');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(process.env.MONGODB_URI);
  const subscribers = await Subscriber.find({}).lean();
  let updated = 0;
  for (const subscriber of subscribers) {
    const email = String(subscriber.email || '').trim().toLowerCase();
    if (!email) continue;
    const user = await User.findOne({ email, role: 'customer' }).select('_id').lean();
    await CustomerMarketingPreference.findOneAndUpdate({ email }, {
      $setOnInsert: { consentSource: 'newsletter_backfill', consentTimestamp: subscriber.createdAt || new Date(), marketingConsent: subscriber.isActive === true, ...(subscriber.isActive ? {} : { suppressionReason: 'inactive_newsletter_subscription' }) },
      ...(user ? { $set: { customerId: user._id } } : {}),
    }, { upsert: true, setDefaultsOnInsert: true });
    updated++;
  }
  await Promise.all(Object.values(require('../models/Marketing')).filter(model => model?.createIndexes).map(model => model.createIndexes()));
  console.log(`Marketing preference backfill complete: ${updated} newsletter records processed.`);
  await mongoose.disconnect();
}
main().catch(async error => { console.error(error.message); process.exitCode=1; try{await mongoose.disconnect();}catch(_){} });
