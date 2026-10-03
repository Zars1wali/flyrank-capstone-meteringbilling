const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const { seedDatabase } = require('../src/db/seed');
const { PRICING_CONFIG, calculateCost } = require('../src/services/pricingService');

describe('PROBE 5 — AI Token Pricing Rules & Usage Rollup Acceptance Tests', () => {
  const tenant1Id = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    await seedDatabase();
  });

  test('5.1: Pricing constants are pinned in config with exact rates', () => {
    // Check rates match DESIGN.md & Brief specification
    assert.equal(PRICING_CONFIG.AI_TOKENS.FRESH_INPUT_MICROCENTS_PER_1K, 50000, 'Fresh input must be 50,000 microcents/1k ($0.50/1M)');
    assert.equal(PRICING_CONFIG.AI_TOKENS.CACHED_INPUT_MICROCENTS_PER_1K, 12500, 'Cached input must be 12,500 microcents/1k ($0.125/1M, 75% discount)');
    assert.equal(PRICING_CONFIG.AI_TOKENS.OUTPUT_MICROCENTS_PER_1K, 150000, 'Output tokens must be 150,000 microcents/1k ($1.50/1M)');
    assert.equal(PRICING_CONFIG.AI_TOKENS.REASONING_MICROCENTS_PER_1K, 150000, 'Reasoning tokens must be billed identically to output tokens');
    assert.equal(PRICING_CONFIG.API_CALLS.BASE_COST_MICROCENTS_PER_CALL, 1000, 'API call must be 1,000 microcents/call');
  });

  test('5.2: Complex AI Token call accurately calculates cached input discount and reasoning tokens', async () => {
    // Test payload with all 4 token categories
    const simulatedUsage = {
      input_tokens: 1000,         // 1000 * 50 = 50,000 microcents
      cached_input_tokens: 2000,  // 2000 * 12.5 = 25,000 microcents
      output_tokens: 500,         // 500 * 150 = 75,000 microcents
      reasoning_tokens: 300,      // 300 * 150 = 45,000 microcents
    };
    // Expected total: 50000 + 25000 + 75000 + 45000 = 195,000 microcents ($0.00195)
    // Expected quantity: 1000 + 2000 + 500 + 300 = 3800 tokens

    const expectedCostMicrocents = 195000;
    const expectedQuantity = 3800;

    const res = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenant1Id)
      .set('Idempotency-Key', `probe-5-pricing-${Date.now()}`)
      .send({
        type: 'ai_tokens',
        prompt: 'Complex benchmark inference prompt',
        simulated_usage: simulatedUsage,
      });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.data.quantity, expectedQuantity);
    assert.equal(res.body.data.cost_microcents, expectedCostMicrocents);
    assert.equal(res.body.data.cost_cents, 0.195);
    assert.deepEqual(res.body.data.breakdown, simulatedUsage);
    assert.equal(res.body.data.quota.used, expectedQuantity);
    assert.equal(res.body.data.quota.remaining, 100000 - expectedQuantity);
  });

  test('5.3: GET /usage rollup aggregates tokens and matches pinned pricing totals (Probe 5 Gate)', async () => {
    // Generate request 1: 1,000 fresh input tokens (50,000 microcents)
    await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenant1Id)
      .set('Idempotency-Key', 'probe-5-run-1')
      .send({
        type: 'ai_tokens',
        simulated_usage: {
          input_tokens: 1000,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_tokens: 0,
        },
      });

    // Generate request 2: 4,000 cached input tokens (4,000 * 12.5 = 50,000 microcents)
    await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenant1Id)
      .set('Idempotency-Key', 'probe-5-run-2')
      .send({
        type: 'ai_tokens',
        simulated_usage: {
          input_tokens: 0,
          cached_input_tokens: 4000,
          output_tokens: 0,
          reasoning_tokens: 0,
        },
      });

    // Generate request 3: 200 output tokens + 200 reasoning tokens (400 * 150 = 60,000 microcents)
    await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenant1Id)
      .set('Idempotency-Key', 'probe-5-run-3')
      .send({
        type: 'ai_tokens',
        simulated_usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 200,
          reasoning_tokens: 200,
        },
      });

    // Total tokens consumed: 1,000 + 4,000 + 400 = 5,400 tokens
    // Total cost: 50,000 + 50,000 + 60,000 = 160,000 microcents ($0.0016)

    const usageRes = await request(app)
      .get('/api/v1/usage')
      .set('X-Tenant-Id', tenant1Id);

    assert.equal(usageRes.statusCode, 200);
    assert.equal(usageRes.body.metrics.ai_tokens.used, 5400);
    assert.equal(usageRes.body.metrics.ai_tokens.remaining, 100000 - 5400);
    assert.equal(usageRes.body.token_breakdown.input_tokens, 1000);
    assert.equal(usageRes.body.token_breakdown.cached_input_tokens, 4000);
    assert.equal(usageRes.body.token_breakdown.output_tokens, 200);
    assert.equal(usageRes.body.token_breakdown.reasoning_tokens, 200);
    assert.equal(usageRes.body.total_accumulated_cost_microcents, 160000);
    assert.equal(usageRes.body.total_accumulated_cost_cents, 0.16);
    assert.equal(usageRes.body.total_accumulated_cost_display, '$0.00');

    // Also check GET /usage canonical path
    const aliasRes = await request(app)
      .get('/usage')
      .set('X-Tenant-Id', tenant1Id);

    assert.equal(aliasRes.statusCode, 200);
    assert.equal(aliasRes.body.metrics.ai_tokens.used, 5400);
    assert.equal(aliasRes.body.total_accumulated_cost_microcents, 160000);
  });
});
