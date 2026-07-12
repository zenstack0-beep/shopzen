# ShopZen retargeting rollout

The system is disabled by default. Existing users are not opted in automatically. Run the backfill only to copy explicit active newsletter subscriptions into the marketing-preference collection.

## Environment

Required before sending: `MARKETING_SIGNING_SECRET` (at least 32 random characters), `MARKETING_BASE_URL`, existing `RESEND_API_KEY`, and a verified existing `EMAIL_FROM`. Optional AI: `MARKETING_AI_ENABLED=true`, `MARKETING_AI_PROVIDER=openrouter`, `MARKETING_AI_MODEL`, and `MARKETING_AI_API_KEY` (or the existing `OPENROUTER_API_KEY`). Suggested defaults: `MARKETING_DEFAULT_WAIT_DAYS=7` and `MARKETING_DEFAULT_TIMEZONE=Asia/Colombo`. Redis is not required: scheduled state and atomic send claims are stored in MongoDB.

## Install, migrate, and test

No new package installation is required.

```sh
cd backend
npm run marketing:migrate
npm run test:marketing
npm run validate:marketing-indexes
cd ../frontend
npm run build
```

## Deployment and use

Deploy backend first, run the migration once, then deploy frontend. In Admin → Marketing, enable event tracking first. Confirm consent records and suggestions before enabling recommendations. Keep automatic approval and sending disabled during manual review. Manual “Send now” also requires the explicit sending flag, preventing accidental delivery immediately after deployment.

Unsubscribe links are signed and expiring. An unsubscribe immediately suppresses the address and cancels pending, approved, and scheduled recommendations. Consent is presently created only by explicit newsletter subscription; account creation and checkout do not imply consent.

Auto approval rechecks consent, purchase history, frequency, product status, price, image, and stock. Sending repeats the same validation and uses current product data. AI receives only product facts and aggregated signal counts; failures use the deterministic safe template.

## Rollback

Turn off tracking, recommendations, automatic approval, and sending in Admin → Marketing. Deploy the prior application version. New marketing collections are isolated and may remain in MongoDB for audit purposes; removing them is not required and should only be done under the store's retention policy.
