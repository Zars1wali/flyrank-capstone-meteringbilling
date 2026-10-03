# Usage Metering & Billing Engine

<div align="center">

[![NodeJS](https://img.shields.io/badge/node.js-%236DA55F.svg?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/express.js-%23404d59.svg?style=for-the-badge&logo=express&logoColor=%2361DAFB)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![SQLite](https://img.shields.io/badge/sqlite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Stripe](https://img.shields.io/badge/Stripe-626CD9?style=for-the-badge&logo=Stripe&logoColor=white)](https://stripe.com/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

</div>

A production-grade, multi-tenant usage metering and billing backend service designed for SaaS platforms. It reliably answers the three critical questions every billing engine must solve:

1. **How much has this customer used?** — Append-only immutable usage event collection with SHA-256 idempotency key deduplication.
2. **Have they reached their plan limits?** — Boundary-honest quota enforcement returning `429 Too Many Requests` (with `Retry-After`) and `402 Payment Required`.
3. **How much should they pay?** — Exact integer financial mathematics (microcents / cents) conforming to Modern Treasury principles, featuring real-world AI token pricing rules.

---

## Architecture Overview

```
                               ┌─────────────────────────────────────────┐
                               │           CLIENTS / CONSUMERS           │
                               │  (API Consumers, Stripe CLI Webhooks)   │
                               └────────────────────┬────────────────────┘
                                                    │
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   HTTP TRANSPORT & VALIDATION                                   │
│  • Zod Request Boundary Validation (bad input -> clean 4xx, never 500)                          │
│  • Tenant Context Interceptor (Header: X-Tenant-Id)                                             │
│  • Idempotency Middleware (Header: Idempotency-Key & SHA-256 payload fingerprinting)            │
│  • Webhook Signature Verifier (Stripe RFC HMAC-SHA256 constant-time verification)               │
└───────────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                                    │
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       DOMAIN SERVICE LAYER                                      │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌───────────────────────────────────┐  │
│  │      MeterService      │  │      QuotaService      │  │          PricingService           │  │
│  │  • Idempotency Cache   │  │  • Boundary Honesty    │  │  • Pinned Rate Calculations       │  │
│  │  • Immutable Ledger    │  │  • 429 vs 402 Decision │  │  • Cached Input Discounts (75%)   │  │
│  │  • Replay Mirroring    │  │  • Retry-After Header  │  │  • Reasoning = Output Tokens      │  │
│  └────────────────────────┘  └────────────────────────┘  └───────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────┐  ┌───────────────────────────────────┐  │
│  │                 StripeService                      │  │       ReconciliationWorker        │  │
│  │  • Test Mode Checkout Session Creation             │  │  • Offline Background Job         │  │
│  │  • Webhook Replay Deduplication                    │  │  • 80% & 100% Quota Alerts        │  │
│  │  • Subscription State Synchronization (Free -> Pro)│  │  • Exponential Backoff & Alerts   │  │
│  └────────────────────────────────────────────────────┘  └───────────────────────────────────┘  │
└───────────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                                    │
                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   PERSISTENCE LAYER (Dual Driver)                               │
│  • PostgreSQL / SQLite with strict ACID transactions & schema migrations                        │
│  • Tables: tenants, plans, subscriptions, usage_events, idempotency_records, webhook_events     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Subscription Plans & Quotas

Customers belong to tenants; each tenant is associated with a subscription plan:

| Plan | Monthly Fee | API Calls Quota | AI Tokens Quota | Behavior at Boundary |
|:---|:---|:---|:---|:---|
| **Free** | $0.00 (`0` cents) | **1,000** calls / month | **100,000** tokens / month | Request 1,000 succeeds; 1,001 returns `429 Too Many Requests` |
| **Pro** | $29.00 (`2900` cents) | **10,000** calls / month | **1,000,000** tokens / month | High-capacity limits; unlocked via Stripe Checkout |

---

## AI Token Pricing Rules (Pinned Constants)

All financial amounts are represented and calculated strictly as **integers in microcents** ($1.00\text{ USD} = 100\text{ cents} = 100,000,000\text{ microcents}$) to eliminate IEEE 754 floating-point drift:

- **Fresh Input Tokens**: 50,000 microcents / 1k tokens ($0.50 / 1M tokens)
- **Cached Input Tokens**: 12,500 microcents / 1k tokens ($0.125 / 1M tokens — 75% discount)
- **Output Tokens**: 150,000 microcents / 1k tokens ($1.50 / 1M tokens)
- **Reasoning ("Thinking") Tokens**: 150,000 microcents / 1k tokens (billed identically to output tokens)
- **API Calls**: 1,000 microcents / call ($0.01 per 100 calls)

$$\text{Cost (microcents)} = \left\lfloor \frac{\text{fresh} \times 50000 + \text{cached} \times 12500 + \text{output} \times 150000 + \text{reasoning} \times 150000}{1000} \right\rfloor$$

---

## Quickstart & Setup Instructions

A stranger on a clean machine can run and test this service in under 60 seconds with zero credit cards required.

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```
*(By default, uses SQLite with zero-config local storage. To use PostgreSQL, set `DATABASE_URL=postgresql://...` and run `docker compose up -d`)*

### 3. Seed Database
```bash
npm run seed
```
Seeds 5 deterministic tenants:
- **Tenant 1**: Fresh tenant on Free plan (Acme Corp).
- **Tenant 2**: Free plan at boundary (999 of 1,000 calls pre-seeded).
- **Tenant 3**: Free plan with past-due subscription (triggers 402).
- **Tenant 4**: Free plan at AI token boundary (99,000 of 100,000 tokens pre-seeded).
- **Tenant 5**: Pro plan enterprise tenant.

### 4. Run Automated Test Suite
```bash
npm test
```
Executes all 31 acceptance probes and behavioral test suites with 100% pass rate.

### 5. Start the Engine
```bash
npm start
```
Starts the API on `http://localhost:3000`.

### 6. Run Background Reconciliation Job
```bash
npm run job:reconcile
```
Executes offline subscription reconciliation and generates 80% / 100% quota threshold alerts.

---

## Stripe Local Testing (CLI)

The system works seamlessly with the Stripe CLI:

```bash
# 1. Forward incoming test webhooks to the local engine
stripe listen --forward-to localhost:3000/webhooks/stripe

# 2. Trigger test checkout completion to upgrade a tenant
stripe trigger checkout.session.completed
```

---

## Key API Endpoints

| Method | Endpoint | Description |
|:---|:---|:---|
| `GET` | `/health` | Health check endpoint |
| `POST` | `/generate` | Record billable action with idempotency (`Idempotency-Key` header) |
| `GET` | `/usage` | Rollup tenant usage events, limits, and cost breakdown |
| `POST` | `/api/v1/checkout/session` | Create Stripe test Checkout session for Pro upgrade |
| `POST` | `/webhooks/stripe` | Signature-verified, deduplicated Stripe webhook receiver |
| `POST` | `/api/v1/jobs/reconcile` | Trigger background reconciliation & quota alert job |
| `GET` | `/api/customers` | List all tenant customers |
| `POST` | `/api/customers` | Register a new tenant customer |
| `GET` | `/api/billing/:customerId` | Retrieve comprehensive billing summary and itemized usage |
| `POST` | `/api/billing/calculate` | Perform rating calculations and price simulations |

---

## Honest Limitations

- **Simulated AI Tokens**: The service meters token counts and categories submitted via payload rather than calling live LLM inference endpoints (Anthropic, Gemini, OpenAI).
- **Stripe Test Mode Only**: Strictly operates in Stripe sandbox/test mode using test card `4242...` and mock events; live payment cards are never charged.
- **Fixed Monthly Billing Cycles**: Billing windows default to calendar month boundaries rather than custom anniversary rollover dates.
- **In-Process Background Worker**: The background reconciliation worker runs as a detached process or cron script rather than a distributed queue cluster (e.g., Redis BullMQ / Celery).
- **No Proration / PDF Invoices in Core**: Mid-cycle prorations and rendering PDF statements are designated non-goals for this core engine.
