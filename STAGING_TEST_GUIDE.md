# Local staging and Curfox testing

This setup keeps local test data in the separate `shopzen_staging` database. The backend refuses to start in staging mode if the database name does not contain `staging`, `stage`, `test`, or `local`.

## 1. Start the isolated MongoDB

With Docker Desktop running:

```bash
docker compose -f docker-compose.staging.yml up -d
```

If you already run MongoDB locally, you may instead use a separate database such as `mongodb://127.0.0.1:27017/shopzen_staging` and skip Docker.

On a Mac with MongoDB installed through Homebrew, start it with:

```bash
mkdir -p backend/.mongodb-staging
mongod --dbpath backend/.mongodb-staging --port 27017
```

Keep that terminal open while testing. This direct command avoids changing Homebrew tap trust settings.

## 2. Create the staging environment file

```bash
cp backend/.env.staging.example backend/.env.staging
```

Replace `JWT_SECRET` with a staging-only random value. Keep:

```env
APP_ENV=staging
CURFOX_DRY_RUN=true
```

Never copy the production `MONGODB_URI` into this file.

## 3. Seed and start staging

```bash
cd backend
npm run seed:staging
npm run staging
```

In a second terminal:

```bash
cd frontend
npm run start:staging
```

Open `http://localhost:3000/admin`. The seeded local admin is `admin@shopzen.lk` / `Admin@123456`.

The staging backend runs on `5002`, separately from any existing backend on `5001`. Always use `npm run start:staging` so the frontend cannot accidentally call the backend on `5001`.

## 4. Configure and safely test Curfox

1. Go to **Admin → Settings → Delivery → Connect Curfox**.
2. Enter tenant `royalexpress` and your Royal Express merchant login.
3. Test the connection, select the business, set the exact origin city/state, save, and enable it.
4. Create a test product and place a local test order.
5. Open the order in admin and click **Send Order to Curfox**.
6. With `CURFOX_DRY_RUN=true`, ShopZen validates and stores the complete submission workflow locally, assigns a clearly marked `DRYRUN-...` waybill, and does **not** call Curfox's order-create endpoint.

The connection-test button still calls Curfox login/business-list endpoints, which are read-only.

## 5. One controlled real Curfox test

A real end-to-end courier test necessarily creates data in Royal Express/Curfox. When ready:

1. Confirm the MongoDB URI still points to `shopzen_staging`.
2. Change only `CURFOX_DRY_RUN=false` in `backend/.env.staging`.
3. Restart the staging backend.
4. Create a new local test order with a real deliverable address and phone number.
5. Submit it once, note the real waybill, and refresh tracking.
6. Cancel/remove the test shipment through the Royal Express merchant portal if required by the courier.
7. Restore `CURFOX_DRY_RUN=true` and restart the backend.

Do not reuse a dry-run order for the live test; create a new staging order.

## Stop staging

Stop the Node processes, then optionally stop MongoDB:

```bash
docker compose -f docker-compose.staging.yml down
```

The staging database remains in its Docker volume for the next test. `docker compose down -v` deletes that staging volume and all local staging data.
