const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { seedDatabase } = require('../src/db/seed');
const { runReconciliation } = require('../src/jobs/reconciliationJob');

describe('Requirement 3 — Background Job: Reconciliation & Quota Alert Tests', () => {
  beforeEach(async () => {
    await seedDatabase();
  });

  test('3.1: Reconciliation job runs off the request path and identifies 100% quota breaches', async () => {
    const jobResult = await runReconciliation({ maxRetries: 3, retryDelayMs: 50 });

    assert.equal(jobResult.success, true);
    assert.equal(jobResult.attempt, 1);
    assert.ok(jobResult.durationMs >= 0);
    assert.equal(jobResult.result.reconciledCount, 5);

    // Tenant 2 (999 API calls seeded, limit 1,000 => 99.9% / >= 80%)
    const tenant2Alert = jobResult.result.alerts.find(
      (a) => a.tenantId === '00000000-0000-0000-0000-000000000002'
    );
    assert.ok(tenant2Alert, 'Tenant 2 should generate a quota alert');
    assert.equal(tenant2Alert.metric, 'api_call');

    // Tenant 4 (99,000 AI tokens seeded, limit 100,000 => 99% / >= 80%)
    const tenant4Alert = jobResult.result.alerts.find(
      (a) => a.tenantId === '00000000-0000-0000-0000-000000000004'
    );
    assert.ok(tenant4Alert, 'Tenant 4 should generate a quota alert');
    assert.equal(tenant4Alert.metric, 'ai_tokens');
  });

  test('3.2: POST /api/v1/jobs/reconcile endpoint triggers reconciliation execution', async () => {
    const res = await request(app).post('/api/v1/jobs/reconcile');

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.result.reconciledCount >= 5);
  });
});
