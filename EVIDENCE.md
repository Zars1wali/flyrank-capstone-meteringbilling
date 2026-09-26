# Evidence

One proof per Definition-of-Done checkbox. Paste test output, curl transcripts, or log lines here as you complete each item.

## 1. Server starts and responds

```http
$ curl.exe -i http://localhost:3000/health

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 38
Date: Sat, 26 Sep 2026 20:50:01 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"ok","database":"connected"}
```

## 2. Usage tracking (Probe 1: Idempotency & Deduplication)

### First Request (Cache MISS — New Event Created)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000001" \
  -H "Idempotency-Key: probe-1-live-key" \
  -d '{"type":"ai_tokens","prompt":"Live demo query","simulated_usage":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":100,"reasoning_tokens":50}}'

HTTP/1.1 201 Created
X-Powered-By: Express
X-Cache: MISS
X-Idempotency-Key: probe-1-live-key
Content-Type: application/json; charset=utf-8
Content-Length: 361
Date: Sat, 26 Sep 2026 20:52:58 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"success","data":{"event_id":"597df1d5-6ea2-4fdd-a193-5d2a23c5583b","tenant_id":"00000000-0000-0000-0000-000000000001","type":"ai_tokens","quantity":850,"breakdown":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":100,"reasoning_tokens":50},"cost_microcents":50000,"cost_cents":0.05,"quota":{"limit":100000,"used":850,"remaining":99150}}}
```

### Replayed Request (Cache HIT — Mirrored Response, Zero Double Counting)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000001" \
  -H "Idempotency-Key: probe-1-live-key" \
  -d '{"type":"ai_tokens","prompt":"Live demo query","simulated_usage":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":100,"reasoning_tokens":50}}'

HTTP/1.1 201 Created
X-Powered-By: Express
X-Cache: HIT
X-Idempotency-Key: probe-1-live-key
Content-Type: application/json; charset=utf-8
Content-Length: 361
Date: Sat, 26 Sep 2026 20:53:19 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"success","data":{"event_id":"597df1d5-6ea2-4fdd-a193-5d2a23c5583b","tenant_id":"00000000-0000-0000-0000-000000000001","type":"ai_tokens","quantity":850,"breakdown":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":100,"reasoning_tokens":50},"cost_microcents":50000,"cost_cents":0.05,"quota":{"limit":100000,"used":850,"remaining":99150}}}
```

## 3. Customer management & Quotas (Probe 2: Boundary Honesty & 429/402)

### Call 1,000 of 1,000 (Boundary Call Allowed)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000002" \
  -H "Idempotency-Key: call-1000-live" \
  -d '{"type":"api_call","quantity":1}'

HTTP/1.1 201 Created
X-Powered-By: Express
X-Cache: MISS
X-Idempotency-Key: call-1000-live
Content-Type: application/json; charset=utf-8
Content-Length: 252
Date: Sat, 26 Sep 2026 20:53:47 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"success","data":{"event_id":"8b48a804-d038-4993-a887-d9daffba5605","tenant_id":"00000000-0000-0000-0000-000000000002","type":"api_call","quantity":1,"cost_microcents":1000,"cost_cents":0.001,"quota":{"limit":1000,"used":1000,"remaining":0}}}
```

### Call 1,001 of 1,000 (Boundary Exceeded -> 429 Too Many Requests + Retry-After)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000002" \
  -H "Idempotency-Key: call-1001-live" \
  -d '{"type":"api_call","quantity":1}'

HTTP/1.1 429 Too Many Requests
X-Powered-By: Express
Retry-After: 338745
Content-Type: application/json; charset=utf-8
Content-Length: 268
Date: Sat, 26 Sep 2026 20:54:15 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"allowed":false,"statusCode":429,"retryAfter":338745,"error":"QUOTA_EXCEEDED","message":"Usage quota exceeded: Limit of 1,000 api_call reached for plan 'Free Tier'. Upgrade to Pro to continue.","plan":"free","metric":"api_call","limit":1000,"used":1000,"requested":1}
```

### Lapsed / Past-Due Subscription (Tenant 3 -> 402 Payment Required)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000003" \
  -H "Idempotency-Key: call-lapsed-live" \
  -d '{"type":"api_call","quantity":1}'

HTTP/1.1 402 Payment Required
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 196
Date: Sat, 26 Sep 2026 20:54:30 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"allowed":false,"statusCode":402,"error":"PAYMENT_REQUIRED","message":"Subscription status 'past_due'. Valid payment method required to perform billable actions.","subscriptionStatus":"past_due"}
```

## 4. Billing calculation

_In progress (Phase 4)_

## 5. API documentation

_In progress_

## 6. Tests pass

```
> flyrank-capstone-meteringbilling@1.0.0 test
> node --test --test-concurrency=1 tests/*.test.js

◇ injected env (5) from .env
[HTTP] GET /health 200 (8ms)
▶ Health Check API Tests
  ✔ GET /health returns 200 OK and connected status (61.8086ms)
[HTTP] GET / 200 (2ms)
  ✔ GET / returns 200 OK with service info (16.9094ms)
✔ Health Check API Tests (81.3845ms)
◇ injected env (5) from .env
[Seed] Ensuring schema is up to date...
[Migration] Starting database migrations...
[Migration] Applying 001_initial_schema.sql...
[Migration] Successfully applied 001_initial_schema.sql
[Migration] All migrations completed successfully.
[Seed] Cleaning existing seed data...
[Seed] Inserting plans...
[Seed] Inserting test tenants and subscriptions...
[Seed] Database seeded successfully.
▶ PROBE 1 — Idempotency & Deduplication Acceptance Tests
  ✔ 1.1: Missing X-Tenant-Id header returns 400 Bad Request (78.2286ms)
  ✔ 1.2: Missing Idempotency-Key header returns 400 Bad Request (15.4065ms)
  ✔ 1.3: First request with idempotency key creates exactly one usage event (15.9809ms)
  ✔ 1.4: Retrying identical request returns mirrored response with zero new events (Probe 1 Guarantee) (13.0024ms)
  ✔ 1.5: Reusing same idempotency key with modified payload returns 409 Conflict (11.7298ms)
✔ PROBE 1 — Idempotency & Deduplication Acceptance Tests (178.6833ms)
◇ injected env (5) from .env
[Seed] Ensuring schema is up to date...
[Migration] Starting database migrations...
[Migration] Applying 001_initial_schema.sql...
[Migration] Successfully applied 001_initial_schema.sql
[Migration] All migrations completed successfully.
[Seed] Cleaning existing seed data...
[Seed] Inserting plans...
[Seed] Inserting test tenants and subscriptions...
[Seed] Database seeded successfully.
▶ PROBE 2 — Quota Enforcement & Boundary Honesty Acceptance Tests
  ✔ 2.1: Boundary honesty — call 1,000 of 1,000 succeeds (Tenant 2 pre-seeded with 999) (105.2146ms)
  ✔ 2.2: Boundary honesty — call 1,001 returns 429 Too Many Requests with Retry-After header (54.6763ms)
  ✔ 2.3: Lapsed/unpaid subscription returns 402 Payment Required (Tenant 3 past_due) (12.6002ms)
  ✔ 2.4: Token boundary — exactly 100,000 tokens succeeds, 100,001 fails with 429 (Tenant 4 pre-seeded with 99,000) (21.7482ms)
  ✔ 2.5: Usage rollup GET /api/v1/usage returns aggregate usage and billing limits (10.757ms)
✔ PROBE 2 — Quota Enforcement & Boundary Honesty Acceptance Tests (304.4466ms)
ℹ tests 12
ℹ suites 3
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3270.6526
```

## 7. Seed data works

```
$ npm run seed

> flyrank-capstone-meteringbilling@1.0.0 seed
> node src/db/seed.js

◇ injected env (5) from .env
[Seed] Ensuring schema is up to date...
[Migration] Starting database migrations...
[Migration] Applying 001_initial_schema.sql...
[Migration] Successfully applied 001_initial_schema.sql
[Migration] All migrations completed successfully.
[Seed] Cleaning existing seed data...
[Seed] Inserting plans...
[Seed] Inserting test tenants and subscriptions...
[Seed] Database seeded successfully.
[Seed] Done.
```

## 8. Stranger can run it

```bash
# 1. Install dependencies
npm install

# 2. Seed database
npm run seed

# 3. Run automated acceptance probes
npm test

# 4. Start the engine
npm start
```
