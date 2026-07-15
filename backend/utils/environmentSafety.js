'use strict';

function databaseName(uri) {
  const withoutQuery = String(uri || '').split('?')[0].replace(/\/$/, '');
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
}

function assertSafeEnvironment() {
  if (process.env.APP_ENV !== 'staging') return;
  const name = databaseName(process.env.MONGODB_URI);
  if (!/(staging|stage|test|local)/i.test(name)) {
    throw new Error(`STAGING SAFETY BLOCK: database "${name || 'unknown'}" is not clearly a staging/test database`);
  }
  if (process.env.CURFOX_DRY_RUN !== 'true') {
    console.warn('⚠️  CURFOX_DRY_RUN is off — Curfox submissions will create real courier orders');
  }
}

module.exports = { assertSafeEnvironment, databaseName };
