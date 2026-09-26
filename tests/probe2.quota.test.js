const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const { seedDatabase } = require('../src/db/seed');

describe('PROBE 2 — Quota Enforcement & Boundary Honesty Acceptance Tests', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    await seedDatabase();
  });

  test('2.1: Boundary honesty — call 1,000 of 1,000 succeeds (Tenant 2 pre-seeded with 999)', async () => {
    const boundaryTenantId = '00000000-0000-0000-0000-000000000002';
    const idempotencyKey = 'call-1000-key';

    const res = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', boundaryTenantId)
      .set('Idempotency-Key', idempotencyKey)
      .send({ type: 'api_call', quantity: 1 });

    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.quota.used, 1000);
    assert.equal(res.body.data.quota.limit, 1000);
    assert.equal(res.body.data.quota.remaining, 0);
  });

  test('2.2: Boundary honesty — call 1,001 returns 429 Too Many Requests with Retry-After header', async () => {
    const boundaryTenantId = '00000000-0000-0000-0000-000000000002';
    const idempotencyKey = 'call-1001-key';

    const res = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', boundaryTenantId)
      .set('Idempotency-Key', idempotencyKey)
      .send({ type: 'api_call', quantity: 1 });

    assert.equal(res.status, 429);
    assert.equal(res.body.error, 'QUOTA_EXCEEDED');
    assert.equal(res.body.limit, 1000);
    assert.equal(res.body.used, 1000);
    assert.equal(res.body.requested, 1);
    assert.ok(res.header['retry-after'], 'Retry-After header must be present');
    assert.ok(Number(res.header['retry-after']) > 0);

    // Verify call 1,001 was NOT recorded as a usage event in the database
    const dbEvents = await db.query(
      'SELECT * FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2',
      [boundaryTenantId, idempotencyKey]
    );
    assert.equal(dbEvents.rows.length, 0);
  });

  test('2.3: Lapsed/unpaid subscription returns 402 Payment Required (Tenant 3 past_due)', async () => {
    const lapsedTenantId = '00000000-0000-0000-0000-000000000003';
    const idempotencyKey = 'lapsed-sub-key';

    const res = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', lapsedTenantId)
      .set('Idempotency-Key', idempotencyKey)
      .send({ type: 'api_call', quantity: 1 });

    assert.equal(res.status, 402);
    assert.equal(res.body.error, 'PAYMENT_REQUIRED');
    assert.equal(res.body.subscriptionStatus, 'past_due');
    assert.match(res.body.message, /Subscription status 'past_due'/);
  });

  test('2.4: Token boundary — exactly 100,000 tokens succeeds, 100,001 fails with 429 (Tenant 4 pre-seeded with 99,000)', async () => {
    const tokenTenantId = '00000000-0000-0000-0000-000000000004';

    // Request exactly 1,000 tokens to reach 100,000 limit
    const resBoundary = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tokenTenantId)
      .set('Idempotency-Key', 'token-key-boundary')
      .send({
        type: 'ai_tokens',
        simulated_usage: {
          input_tokens: 500,
          cached_input_tokens: 200,
          output_tokens: 200,
          reasoning_tokens: 100, // Total = 1,000
        }
      });

    assert.equal(resBoundary.status, 201);
    assert.equal(resBoundary.body.data.quota.used, 100000);
    assert.equal(resBoundary.body.data.quota.remaining, 0);

    // Next request exceeding 100,000 limit must be rejected with 429
    const resExceeded = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tokenTenantId)
      .set('Idempotency-Key', 'token-key-exceeded')
      .send({
        type: 'ai_tokens',
        simulated_usage: {
          input_tokens: 10,
          output_tokens: 0,
        }
      });

    assert.equal(resExceeded.status, 429);
    assert.equal(resExceeded.body.error, 'QUOTA_EXCEEDED');
    assert.equal(resExceeded.body.metric, 'ai_tokens');
    assert.equal(resExceeded.body.limit, 100000);
    assert.equal(resExceeded.body.used, 100000);
  });

  test('2.5: Usage rollup GET /api/v1/usage returns aggregate usage and billing limits', async () => {
    const boundaryTenantId = '00000000-0000-0000-0000-000000000002';

    const res = await request(app)
      .get('/api/v1/usage')
      .set('X-Tenant-Id', boundaryTenantId);

    assert.equal(res.status, 200);
    assert.equal(res.body.tenant_id, boundaryTenantId);
    assert.equal(res.body.plan.id, 'free');
    assert.equal(res.body.metrics.api_calls.limit, 1000);
    assert.equal(res.body.metrics.api_calls.used, 1000);
    assert.equal(res.body.metrics.api_calls.percent_used, 100);
    assert.ok(res.body.total_accumulated_cost_display);
  });
});
