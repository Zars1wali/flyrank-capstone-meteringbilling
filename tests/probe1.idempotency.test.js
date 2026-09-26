const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const { seedDatabase } = require('../src/db/seed');

describe('PROBE 1 — Idempotency & Deduplication Acceptance Tests', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';

  before(async () => {
    process.env.NODE_ENV = 'test';
    await seedDatabase();
  });

  test('1.1: Missing X-Tenant-Id header returns 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/v1/generate')
      .set('Idempotency-Key', 'test-key-missing-tenant')
      .send({ type: 'api_call' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_TENANT_ID');
  });

  test('1.2: Missing Idempotency-Key header returns 400 Bad Request', async () => {
    const res = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenantId)
      .send({ type: 'api_call' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'MISSING_IDEMPOTENCY_KEY');
  });

  let firstResponsePayload = null;
  const idempotencyKey = 'idemp-test-probe-1';
  const testPayload = {
    type: 'ai_tokens',
    prompt: 'Summarize financial reports',
    simulated_usage: {
      input_tokens: 500,
      cached_input_tokens: 200,
      output_tokens: 100,
      reasoning_tokens: 50,
    }
  };

  test('1.3: First request with idempotency key creates exactly one usage event', async () => {
    const res1 = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenantId)
      .set('Idempotency-Key', idempotencyKey)
      .send(testPayload);

    assert.equal(res1.status, 201);
    assert.equal(res1.header['x-cache'], 'MISS');
    assert.equal(res1.body.status, 'success');
    assert.equal(res1.body.data.quantity, 850); // 500 + 200 + 100 + 50
    assert.ok(res1.body.data.event_id);
    firstResponsePayload = res1.body;

    // Verify exactly 1 usage event in database
    const dbEvents = await db.query(
      'SELECT * FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2',
      [tenantId, idempotencyKey]
    );
    assert.equal(dbEvents.rows.length, 1);
    assert.equal(Number(dbEvents.rows[0].quantity), 850);
  });

  test('1.4: Retrying identical request returns mirrored response with zero new events (Probe 1 Guarantee)', async () => {
    const res2 = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenantId)
      .set('Idempotency-Key', idempotencyKey)
      .send(testPayload);

    assert.equal(res2.status, 201);
    assert.equal(res2.header['x-cache'], 'HIT');
    assert.deepEqual(res2.body, firstResponsePayload); // Exact mirror

    // Verify still exactly 1 usage event in database (no double count)
    const dbEventsAfter = await db.query(
      'SELECT * FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2',
      [tenantId, idempotencyKey]
    );
    assert.equal(dbEventsAfter.rows.length, 1);
  });

  test('1.5: Reusing same idempotency key with modified payload returns 409 Conflict', async () => {
    const idempotencyKey = 'idemp-test-probe-1';
    const modifiedPayload = {
      type: 'ai_tokens',
      prompt: 'Different prompt with mutated parameters',
      simulated_usage: {
        input_tokens: 900,
        output_tokens: 300,
      }
    };

    const res = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenantId)
      .set('Idempotency-Key', idempotencyKey)
      .send(modifiedPayload);

    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'IDEMPOTENCY_CONFLICT');
  });
});
