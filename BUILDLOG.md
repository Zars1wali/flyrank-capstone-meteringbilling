# Build Log — AI Usage

Honesty is graded, perfection is not. Log where AI helped, where it was wrong, and what you changed.

## Format

| Date | What I asked AI | What AI gave me | What I changed |
|------|----------------|-----------------|----------------|

## Log

| Date | What I asked AI | What AI gave me | What I changed |
|------|----------------|-----------------|----------------|
| 2026-09-22 | Review Capstone Brief PDF and produce Phase 1 System Design covering database schema, plans & quotas, AI token pricing math, metering API contract, and idempotency strategy. | Complete draft of DESIGN.md with ER diagram, DDL definitions, boundary semantics, integer microcents money math, sequence diagram, and acceptance probe mapping. | Verified alignment with the 5 acceptance probes in Section 12, confirmed multi-tenant isolation, explicit status codes (429 vs 402), and strict non-goals. |
| 2026-09-22 | Deepen DESIGN.md using curated references: Stripe Idempotency (retries & payload hashing), Stripe Usage Metering (collection -> aggregation -> rating), and Modern Treasury (IEEE 754 floats vs integer cents/microcents). | Enriched DESIGN.md with dedicated section on foundational engineering references, payload SHA-256 fingerprinting, aggregation window indexing, and strict integer microcents ledger math. | Committed updated DESIGN.md and verified alignment with Section 13 references in the brief. |
| 2026-09-27 | Implement Phase 2 Core Billing Logic: migrations, seed script, layered architecture (Express, Zod boundary validation), idempotency deduplication (Probe 1), and boundary-honest quota checks with 429/402 status codes (Probe 2). | Created Express service with dual-driver persistence (Postgres + SQLite fallback), migrations, deterministic seed data, Zod validation, SHA-256 idempotency cache, quota boundary enforcement with Retry-After, and test suites. | Fixed SQLite multi-process concurrency lock during parallel tests by adding `PRAGMA busy_timeout` and configuring `--test-concurrency=1`, separated duplicate replay test assertions, validated live server behavior with curl transcripts, and documented evidence in EVIDENCE.md. |
