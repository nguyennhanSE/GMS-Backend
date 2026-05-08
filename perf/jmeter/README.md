# API Performance Testing With JMeter

This folder contains the Phase 1 mixed-critical API performance suite described in [docs/api-performance-testing.md](/d:/source/repos/GMS-Backend/docs/api-performance-testing.md:1).

## Files

- `phase1-mixed-suite.jmx`: the main non-GUI JMeter plan
- `local.properties`: local runtime defaults and placeholders
- `out/`: recommended output folder for JTL, dashboard, and JMeter logs
- `smoke.jmx`: legacy headless sanity check kept as a minimal JMeter runner check

## Prerequisites

1. Start the full local dependencies:

```powershell
docker compose up -d postgres redis rabbitmq
```

2. Apply schema and seed the local database:

```powershell
npx prisma migrate deploy
npm run seed
```

3. Start a local API target with `/api/v1`.

Standard app port from `.env.dev`:

```powershell
npm run start:dev
```

Or use the repo's local test server entrypoint:

```powershell
node -r ts-node/register/transpile-only -r tsconfig-paths/register test/playwright/server.ts
```

The Playwright server defaults to `http://127.0.0.1:3015/api/v1`.

4. Put the PostgreSQL JDBC driver jar into `D:\JMeter\apache-jmeter-5.6.3\lib`.

Required driver class:

```text
org.postgresql.Driver
```

Without that jar, the checkout-to-webhook flow will fail during the DB payment-session lookup step.

## Local Properties

`local.properties` is intentionally safe-by-default.

Update these before a full Phase 1 run:

- `baseUrl`
- `jdbcUrl`
- `jdbcUsername`
- `jdbcPassword`
- `stripeWebhookSecret`
- optional pacing knobs: `readThinkTimeMs`, `authThinkTimeMs`, `transactionThinkTimeMs`, `webhookThinkTimeMs`

The seeded credentials already match `prisma/seed.ts`.

## Recommended Commands

Full smoke-to-mixed run against a standard local app:

```powershell
D:\JMeter\apache-jmeter-5.6.3\bin\jmeter.bat -n -t perf\jmeter\phase1-mixed-suite.jmx -q perf\jmeter\local.properties -l perf\jmeter\out\phase1.jtl -j perf\jmeter\out\jmeter.log -e -o perf\jmeter\out\dashboard
```

Run against the repo's local Playwright server on `3015`:

```powershell
D:\JMeter\apache-jmeter-5.6.3\bin\jmeter.bat -n -t perf\jmeter\phase1-mixed-suite.jmx -q perf\jmeter\local.properties -JbaseUrl=http://127.0.0.1:3015/api/v1 -l perf\jmeter\out\phase1.jtl -j perf\jmeter\out\jmeter.log -e -o perf\jmeter\out\dashboard
```

## What The Plan Covers

- `POST /auth/login`
- `GET /trainer/:id/availability`
- `GET /class-schedule/list`
- `GET /exercises`
- `POST /class-booking/create`
- `POST /class-booking/:id/checkout`
- JDBC lookup of `payments.provider_session_id`
- `POST /payments/webhook/stripe`

## Notes

- The webhook flow signs synthetic `checkout.session.completed` payloads with the configured Stripe webhook secret.
- Booking creation uses weekly date offsets to reduce collisions across threads.
- HTTP keep-alive is enabled explicitly in the plan, and the default local profile uses longer ramp-up plus small per-group think times to reduce socket churn on Windows.
- The suite fails fast if Redis or RabbitMQ are unreachable.
- The strict preflight also fails fast when the PostgreSQL JDBC driver or webhook secret is missing.
