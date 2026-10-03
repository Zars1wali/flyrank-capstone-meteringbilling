# EVIDENCE.md — Usage Metering & Billing Engine

This document contains verifiable proof for every Requirement in Section 6 and every Acceptance Probe in Section 12 of the Capstone Brief.

---

## 1. Metering Requirements

### Requirement: A billable action creates exactly one usage event, even under retries — deduplicated by idempotency key.
### Proof: Transcript of identical request sent twice (PROBE 1)

#### First Request: Cache MISS (New Usage Event Created)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000001" \
  -H "Idempotency-Key: probe-1-live-key" \
  --data-binary "@scratch/payload1.json"

HTTP/1.1 201 Created
X-Powered-By: Express
X-Cache: MISS
X-Idempotency-Key: probe-1-live-key
Content-Type: application/json; charset=utf-8
Content-Length: 361
Date: Sat, 03 Oct 2026 18:55:56 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"success","data":{"event_id":"51a4ec07-86a1-422d-975d-63ac82dbc0db","tenant_id":"00000000-0000-0000-0000-000000000001","type":"ai_tokens","quantity":850,"breakdown":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":100,"reasoning_tokens":50},"cost_microcents":50000,"cost_cents":0.05,"quota":{"limit":100000,"used":850,"remaining":99150}}}
```

#### Second Request: Cache HIT (Zero New Events, Mirrored Response)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000001" \
  -H "Idempotency-Key: probe-1-live-key" \
  --data-binary "@scratch/payload1.json"

HTTP/1.1 201 Created
X-Powered-By: Express
X-Cache: HIT
X-Idempotency-Key: probe-1-live-key
Content-Type: application/json; charset=utf-8
Content-Length: 361
Date: Sat, 03 Oct 2026 18:56:04 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"success","data":{"event_id":"51a4ec07-86a1-422d-975d-63ac82dbc0db","tenant_id":"00000000-0000-0000-0000-000000000001","type":"ai_tokens","quantity":850,"breakdown":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":100,"reasoning_tokens":50},"cost_microcents":50000,"cost_cents":0.05,"quota":{"limit":100000,"used":850,"remaining":99150}}}
```

---

## 2. Quota Requirements

### Requirement: Usage is checked against the tenant's plan; requests over the limit are rejected with correct status codes (429 / 402) and explanatory message.
### Proof: Transcripts at boundary and past due (PROBE 2)

#### Boundary Call 1,000 of 1,000 (Allowed)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000002" \
  -H "Idempotency-Key: call-1000-live" \
  --data-binary "@scratch/payload_api_call.json"

HTTP/1.1 201 Created
X-Powered-By: Express
X-Cache: MISS
X-Idempotency-Key: call-1000-live
Content-Type: application/json; charset=utf-8
Content-Length: 252
Date: Sat, 03 Oct 2026 18:56:30 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"success","data":{"event_id":"3da4af4c-a471-4068-808a-666e88927e64","tenant_id":"00000000-0000-0000-0000-000000000002","type":"api_call","quantity":1,"cost_microcents":1000,"cost_cents":0.001,"quota":{"limit":1000,"used":1000,"remaining":0}}}
```

#### Exceeded Call 1,001 of 1,000 (Rejected with 429 Too Many Requests + Retry-After)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000002" \
  -H "Idempotency-Key: call-1001-live" \
  --data-binary "@scratch/payload_api_call.json"

HTTP/1.1 429 Too Many Requests
X-Powered-By: Express
Retry-After: 2419395
Content-Type: application/json; charset=utf-8
Content-Length: 269
Date: Sat, 03 Oct 2026 18:56:45 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"allowed":false,"statusCode":429,"retryAfter":2419395,"error":"QUOTA_EXCEEDED","message":"Usage quota exceeded: Limit of 1,000 api_call reached for plan 'Free Tier'. Upgrade to Pro to continue.","plan":"free","metric":"api_call","limit":1000,"used":1000,"requested":1}
```

#### Lapsed / Past-Due Subscription (Rejected with 402 Payment Required)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000003" \
  -H "Idempotency-Key: call-lapsed-live" \
  --data-binary "@scratch/payload_api_call.json"

HTTP/1.1 402 Payment Required
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 196
Date: Sat, 03 Oct 2026 18:56:58 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"allowed":false,"statusCode":402,"error":"PAYMENT_REQUIRED","message":"Subscription status 'past_due'. Valid payment method required to perform billable actions.","subscriptionStatus":"past_due"}
```

---

## 3. Stripe Integration Requirements

### Requirement: Subscription checkout works end-to-end in Stripe test mode. Webhooks verify signatures, ignore duplicate events, and update tenant plan/status.
### Proof: Checkout Session, Forged Signature (400), Valid Webhook Upgrade, and Replay Deduplication (PROBE 3 & PROBE 4)

#### A. Create Checkout Session (`POST /api/v1/checkout/session`)
```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/checkout/session \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000001" \
  --data-binary "@scratch/payload_checkout.json"

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 256
Date: Sat, 03 Oct 2026 18:57:17 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"session_id":"cs_test_36f36b46f528f8bdcc07c0b13d64551e","checkout_url":"https://checkout.stripe.com/c/pay/cs_test_36f36b46f528f8bdcc07c0b13d64551e","tenant_id":"00000000-0000-0000-0000-000000000001","plan_id":"pro","customer_id":"cus_test_00000000000000"}
```

#### B. PROBE 4: Send Forged Webhook (Bad Signature -> 400 Bad Request)
```http
$ curl.exe -i -s -X POST http://localhost:3000/webhooks/stripe \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1759518000,v1=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb" \
  --data-binary "@scratch/payload_webhook_checkout.json"

HTTP/1.1 400 Bad Request
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 103
Date: Sat, 03 Oct 2026 18:57:56 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":"BAD_WEBHOOK_SIGNATURE","message":"Invalid webhook signature: forged or mismatched signature"}
```

#### C. PROBE 3: Send Valid Signed Webhook -> Flips Tenant Free to Pro
```http
$ curl.exe -i -s -X POST http://localhost:3000/webhooks/stripe \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1759518000,v1=d7ab19c1cf3ad42dc001b709cb5ea36aaeeef50c07d442279b3b9a484128452a" \
  --data-binary "@scratch/payload_webhook_checkout.json"

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 192
Date: Sat, 03 Oct 2026 18:58:08 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"processed":true,"duplicate":false,"eventId":"evt_live_probe3_checkout","eventType":"checkout.session.completed","message":"Webhook event 'checkout.session.completed' processed successfully"}
```

#### Verification: `GET /api/v1/usage` Shows Updated Pro Quotas (10,000 API calls, 1,000,000 tokens)
```http
$ curl.exe -i -s http://localhost:3000/api/v1/usage \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000001"

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 596
Date: Sat, 03 Oct 2026 18:58:19 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"tenant_id":"00000000-0000-0000-0000-000000000001","plan":{"id":"pro","name":"Pro Tier","status":"active"},"billing_period":{"start":"2026-10-03T18:58:08.246Z","end":"2026-11-02T19:00:00.000Z"},"metrics":{"api_calls":{"used":0,"limit":10000,"remaining":10000,"percent_used":0},"ai_tokens":{"used":0,"limit":1000000,"remaining":1000000,"percent_used":0}},"token_breakdown":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_tokens":0},"total_accumulated_cost_microcents":0,"total_accumulated_cost_cents":0,"total_accumulated_cost_display":"$0.00","events_count":0,"events":[]}
```

#### D. PROBE 4: Replay Real Webhook Twice -> Handled Safely as Duplicate
```http
$ curl.exe -i -s -X POST http://localhost:3000/webhooks/stripe \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1759518000,v1=d7ab19c1cf3ad42dc001b709cb5ea36aaeeef50c07d442279b3b9a484128452a" \
  --data-binary "@scratch/payload_webhook_checkout.json"

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 184
Date: Sat, 03 Oct 2026 18:58:33 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"processed":false,"duplicate":true,"eventId":"evt_live_probe3_checkout","eventType":"checkout.session.completed","message":"Event already processed. Duplicate replay safely ignored."}
```

---

## 4. Cost Calculation Requirements

### Requirement: Monthly usage rolls up into a cost figure per tenant. AI token pricing handles cached input tokens, reasoning tokens, and output pricing correctly with pinned pricing constants.
### Proof: Pinned Pricing Calculation & Rollup Transcript (PROBE 5)

#### Pinned Pricing Constants in `src/services/pricingService.js`:
- Fresh input: **50,000 microcents / 1k** ($0.50 / 1M tokens)
- Cached input: **12,500 microcents / 1k** ($0.125 / 1M tokens — 75% discount)
- Output tokens: **150,000 microcents / 1k** ($1.50 / 1M tokens)
- Reasoning tokens: **150,000 microcents / 1k** (billed as output tokens)
- API calls: **1,000 microcents / call** ($0.01 per 100 calls)

#### Billable Action with All 4 Token Categories:
- Input tokens: 1,000 ($1000 \times 50 = 50,000\text{ microcents}$)
- Cached input tokens: 2,000 ($2000 \times 12.5 = 25,000\text{ microcents}$)
- Output tokens: 500 ($500 \times 150 = 75,000\text{ microcents}$)
- Reasoning tokens: 300 ($300 \times 150 = 45,000\text{ microcents}$)
- **Total Expected: 195,000 microcents ($0.00195 USD), 3,800 tokens**

```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/generate \
  -H "Content-Type: application/json" \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000001" \
  -H "Idempotency-Key: probe-5-live-key" \
  --data-binary "@scratch/payload_probe5.json"

HTTP/1.1 201 Created
X-Powered-By: Express
X-Cache: MISS
X-Idempotency-Key: probe-5-live-key
Content-Type: application/json; charset=utf-8
Content-Length: 370
Date: Sat, 03 Oct 2026 18:58:56 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"success","data":{"event_id":"8fc1e957-0646-45bb-b203-5e4be00958cf","tenant_id":"00000000-0000-0000-0000-000000000001","type":"ai_tokens","quantity":3800,"breakdown":{"input_tokens":1000,"cached_input_tokens":2000,"output_tokens":500,"reasoning_tokens":300},"cost_microcents":195000,"cost_cents":0.195,"quota":{"limit":1000000,"used":3800,"remaining":996200}}}
```

#### Proof: Rollup via `GET /usage` Exactly Matches Pinned Calculations
```http
$ curl.exe -i -s http://localhost:3000/usage \
  -H "X-Tenant-Id: 00000000-0000-0000-0000-000000000001"

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 948
Date: Sat, 03 Oct 2026 18:59:09 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"tenant_id":"00000000-0000-0000-0000-000000000001","plan":{"id":"pro","name":"Pro Tier","status":"active"},"billing_period":{"start":"2026-10-03T18:58:08.246Z","end":"2026-11-02T19:00:00.000Z"},"metrics":{"api_calls":{"used":0,"limit":10000,"remaining":10000,"percent_used":0},"ai_tokens":{"used":3800,"limit":1000000,"remaining":996200,"percent_used":0.38}},"token_breakdown":{"input_tokens":1000,"cached_input_tokens":2000,"output_tokens":500,"reasoning_tokens":300},"total_accumulated_cost_microcents":195000,"total_accumulated_cost_cents":0.195,"total_accumulated_cost_display":"$0.00","events_count":1,"events":[{"id":"f334d7ad-afc7-4d68-915d-4e2846f0103a","type":"ai_tokens","quantity":3800,"calculated_cost_microcents":195000,"properties":{"prompt":"Live AI token pricing verification prompt","breakdown":{"input_tokens":1000,"cached_input_tokens":2000,"output_tokens":500,"reasoning_tokens":300}},"created_at":"2026-10-03T18:58:56.934Z"}]}
```

---

## 5. Shared Requirements (Section 12, Page 8)

### Shared Requirement 3: ≥1 background job — slow/bulk work off the request path, retries + failure alert
### Proof: Background Reconciliation & Quota Alert Job Execution

```http
$ curl.exe -i -s -X POST http://localhost:3000/api/v1/jobs/reconcile

HTTP/1.1 200 OK
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 1089
Date: Sat, 03 Oct 2026 18:59:21 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"success":true,"attempt":1,"durationMs":2,"result":{"reconciledCount":5,"reconciled":[{"tenantId":"00000000-0000-0000-0000-000000000001","plan":"pro","status":"active","apiCalls":0,"aiTokens":3800},{"tenantId":"00000000-0000-0000-0000-000000000002","plan":"free","status":"active","apiCalls":1000,"aiTokens":0},{"tenantId":"00000000-0000-0000-0000-000000000003","plan":"free","status":"past_due","apiCalls":0,"aiTokens":0},{"tenantId":"00000000-0000-0000-0000-000000000004","plan":"free","status":"active","apiCalls":0,"aiTokens":99000},{"tenantId":"00000000-0000-0000-0000-000000000005","plan":"pro","status":"active","apiCalls":0,"aiTokens":0}],"alerts":[{"severity":"CRITICAL","tenantId":"00000000-0000-0000-0000-000000000002","metric":"api_call","used":1000,"limit":1000,"message":"Tenant 'Beta Startup (At Boundary)' reached 100% of API call quota (1000/1000)"},{"severity":"WARNING","tenantId":"00000000-0000-0000-0000-000000000004","metric":"ai_tokens","used":99000,"limit":100000,"message":"Tenant 'Delta AI Labs (Token Boundary)' reached 80% of AI token quota (99000/100000)"}]}}
```

---

## 6. End-to-End Automated Test Suite Output

Proof that the complete test suite runs and passes deterministically in one command (`npm test`):

```
> flyrank-capstone-meteringbilling@1.0.0 test
> node --test --test-concurrency=1 tests/*.test.js

◇ injected env (5) from .env
[HTTP] GET /health 200 (11ms)
▶ Health Check API Tests
  ✔ GET /health returns 200 OK and connected status (58.0148ms)
[HTTP] GET / 200 (1ms)
  ✔ GET / returns 200 OK with service info (20.276ms)
✔ Health Check API Tests (81.0688ms)

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
  ✔ 1.1: Missing X-Tenant-Id header returns 400 Bad Request (121.7709ms)
  ✔ 1.2: Missing Idempotency-Key header returns 400 Bad Request (20.5735ms)
  ✔ 1.3: First request with idempotency key creates exactly one usage event (22.7354ms)
  ✔ 1.4: Retrying identical request returns mirrored response with zero new events (Probe 1 Guarantee) (12.9117ms)
  ✔ 1.5: Reusing same idempotency key with modified payload returns 409 Conflict (19.8361ms)
✔ PROBE 1 — Idempotency & Deduplication Acceptance Tests (332.4997ms)

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
  ✔ 2.1: Boundary honesty — call 1,000 of 1,000 succeeds (Tenant 2 pre-seeded with 999) (90.2542ms)
  ✔ 2.2: Boundary honesty — call 1,001 returns 429 Too Many Requests with Retry-After header (57.4312ms)
  ✔ 2.3: Lapsed/unpaid subscription returns 402 Payment Required (Tenant 3 past_due) (12.9349ms)
  ✔ 2.4: Token boundary — exactly 100,000 tokens succeeds, 100,001 fails with 429 (Tenant 4 pre-seeded with 99,000) (23.4532ms)
  ✔ 2.5: Usage rollup GET /api/v1/usage returns aggregate usage and billing limits (11.3164ms)
✔ PROBE 2 — Quota Enforcement & Boundary Honesty Acceptance Tests (239.2646ms)

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
▶ PROBE 3 — Stripe Checkout & Subscription Lifecycle Acceptance Tests
  ✔ 3.1: Create checkout session for tenant to upgrade to Pro (236.4215ms)
  ✔ 3.2: Stripe checkout.session.completed webhook flips tenant Free -> Pro (Probe 3 Gate) (133.2231ms)
  ✔ 3.3: customer.subscription.updated updates subscription status (147.9835ms)
  ✔ 3.4: customer.subscription.deleted reverts tenant to Free plan (178.2483ms)
✔ PROBE 3 — Stripe Checkout & Subscription Lifecycle Acceptance Tests (705.8184ms)

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
▶ PROBE 4 — Webhook Cryptographic Verification & Replay Protection Acceptance Tests
  ✔ 4.1: Missing stripe-signature header returns 400 Bad Request (143.9161ms)
  ✔ 4.2: Forged webhook (bad signature) returns 400 and nothing changes (Probe 4 Guarantee) (58.8029ms)
  ✔ 4.3: Valid webhook event processes once; Replaying same event twice is ignored (Probe 4 Guarantee) (72.5237ms)
  ✔ 4.4: Webhook route alias /api/v1/webhooks/stripe behaves identically (61.9706ms)
✔ PROBE 4 — Webhook Cryptographic Verification & Replay Protection Acceptance Tests (340.634ms)

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
▶ PROBE 5 — AI Token Pricing Rules & Usage Rollup Acceptance Tests
  ✔ 5.1: Pricing constants are pinned in config with exact rates (72.8446ms)
  ✔ 5.2: Complex AI Token call accurately calculates cached input discount and reasoning tokens (138.6608ms)
  ✔ 5.3: GET /usage rollup aggregates tokens and matches pinned pricing totals (Probe 5 Gate) (98.8227ms)
✔ PROBE 5 — AI Token Pricing Rules & Usage Rollup Acceptance Tests (313.8977ms)

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
▶ Customer Management & Billing Summary Endpoints (capstone.yaml)
  ✔ POST /api/customers creates a new customer with active subscription (122.381ms)
  ✔ POST /api/customers rejects duplicate email with 409 Conflict (14.2834ms)
  ✔ GET /api/customers lists existing customers with plan details (16.9201ms)
  ✔ GET /api/customers/:id returns single customer with active subscription (14.1502ms)
  ✔ POST /api/billing/calculate simulates AI token pricing calculation (12.3912ms)
  ✔ GET /api/billing/:customerId returns complete billing statement (17.5819ms)
✔ Customer Management & Billing Summary Endpoints (capstone.yaml) (201.2941ms)

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
▶ Requirement 3 — Background Job: Reconciliation & Quota Alert Tests
  ✔ 3.1: Reconciliation job runs off the request path and identifies 100% quota breaches (89.1512ms)
  ✔ 3.2: POST /api/v1/jobs/reconcile endpoint triggers reconciliation execution (24.7891ms)
✔ Requirement 3 — Background Job: Reconciliation & Quota Alert Tests (115.8203ms)

ℹ tests 31
ℹ suites 8
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
