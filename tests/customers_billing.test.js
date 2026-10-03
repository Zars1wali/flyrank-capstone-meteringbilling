const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { seedDatabase } = require('../src/db/seed');

describe('Customer Management & Billing Summary Endpoints (capstone.yaml)', () => {
  beforeEach(async () => {
    await seedDatabase();
  });

  test('POST /api/customers creates a new customer with active subscription', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({
        name: 'New Test Customer',
        email: 'newcustomer@example.com',
        plan_id: 'pro',
      });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.status, 'success');
    assert.ok(res.body.data.id);
    assert.equal(res.body.data.name, 'New Test Customer');
    assert.equal(res.body.data.email, 'newcustomer@example.com');
    assert.equal(res.body.data.plan_id, 'pro');
  });

  test('POST /api/customers rejects duplicate email with 409 Conflict', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({
        name: 'Duplicate Acme',
        email: 'acme@example.com', // Seeded in seed.js
      });

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, 'CUSTOMER_EXISTS');
  });

  test('GET /api/customers lists existing customers with plan details', async () => {
    const res = await request(app).get('/api/customers');

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.count >= 5);
  });

  test('GET /api/customers/:id returns single customer with active subscription', async () => {
    const tenant1Id = '00000000-0000-0000-0000-000000000001';
    const res = await request(app).get(`/api/customers/${tenant1Id}`);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'success');
    assert.equal(res.body.data.id, tenant1Id);
    assert.equal(res.body.data.plan_id, 'free');
  });

  test('POST /api/billing/calculate simulates AI token pricing calculation', async () => {
    const res = await request(app)
      .post('/api/billing/calculate')
      .send({
        type: 'ai_tokens',
        simulated_usage: {
          input_tokens: 1000,
          cached_input_tokens: 1000,
          output_tokens: 1000,
          reasoning_tokens: 1000,
        },
      });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'success');
    // 1000*50 + 1000*12.5 + 1000*150 + 1000*150 = 362,500 microcents
    assert.equal(res.body.cost_microcents, 362500);
    assert.equal(res.body.cost_cents, 0.3625);
  });

  test('GET /api/billing/:customerId returns complete billing statement', async () => {
    const tenant2Id = '00000000-0000-0000-0000-000000000002'; // Seeded with 999 API calls
    const res = await request(app).get(`/api/billing/${tenant2Id}`);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.customer_id, tenant2Id);
    assert.equal(res.body.plan.id, 'free');
    assert.equal(res.body.usage.api_calls.used, 999);
    assert.ok(res.body.cost.formatted_usd);
  });
});
