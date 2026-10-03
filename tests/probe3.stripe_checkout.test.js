const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const { seedDatabase } = require('../src/db/seed');
const stripeService = require('../src/services/stripeService');

describe('PROBE 3 — Stripe Checkout & Subscription Lifecycle Acceptance Tests', () => {
  const tenant1Id = '00000000-0000-0000-0000-000000000001'; // Acme Corp (starts on Free)

  beforeEach(async () => {
    await seedDatabase();
  });

  test('3.1: Create checkout session for tenant to upgrade to Pro', async () => {
    const res = await request(app)
      .post('/api/v1/checkout/session')
      .set('X-Tenant-Id', tenant1Id)
      .send({ plan_id: 'pro' });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.session_id, 'Should return session_id');
    assert.ok(res.body.checkout_url, 'Should return checkout_url');
    assert.equal(res.body.tenant_id, tenant1Id);
    assert.equal(res.body.plan_id, 'pro');
  });

  test('3.2: Stripe checkout.session.completed webhook flips tenant Free -> Pro (Probe 3 Gate)', async () => {
    // Verify initial plan is Free (limit: 1,000 API calls, 100,000 tokens)
    const initialUsage = await request(app)
      .get('/api/v1/usage')
      .set('X-Tenant-Id', tenant1Id);

    assert.equal(initialUsage.statusCode, 200);
    assert.equal(initialUsage.body.plan.id, 'free');
    assert.equal(initialUsage.body.metrics.api_calls.limit, 1000);
    assert.equal(initialUsage.body.metrics.ai_tokens.limit, 100000);

    // Simulate Stripe checkout.session.completed event
    const webhookPayload = {
      id: `evt_test_checkout_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_mock_session_123',
          customer: 'cus_test_acme_customer',
          client_reference_id: tenant1Id,
          subscription: 'sub_test_pro_stripe_999',
          metadata: {
            tenant_id: tenant1Id,
            plan_id: 'pro',
          },
        },
      },
    };

    const signature = stripeService.generateTestSignature(webhookPayload);

    const webhookRes = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(JSON.stringify(webhookPayload));

    assert.equal(webhookRes.statusCode, 200);
    assert.equal(webhookRes.body.processed, true);
    assert.equal(webhookRes.body.duplicate, false);

    // Verify tenant plan flipped to Pro and GET /usage reflects new Pro limits
    const updatedUsage = await request(app)
      .get('/api/v1/usage')
      .set('X-Tenant-Id', tenant1Id);

    assert.equal(updatedUsage.statusCode, 200);
    assert.equal(updatedUsage.body.plan.id, 'pro');
    assert.equal(updatedUsage.body.plan.name, 'Pro Tier');
    assert.equal(updatedUsage.body.metrics.api_calls.limit, 10000, 'Pro limit should be 10,000 API calls');
    assert.equal(updatedUsage.body.metrics.ai_tokens.limit, 1000000, 'Pro limit should be 1,000,000 AI tokens');

    // Also verify compatibility alias GET /usage works identically
    const aliasUsage = await request(app)
      .get('/usage')
      .set('X-Tenant-Id', tenant1Id);

    assert.equal(aliasUsage.statusCode, 200);
    assert.equal(aliasUsage.body.plan.id, 'pro');
    assert.equal(aliasUsage.body.metrics.api_calls.limit, 10000);
  });

  test('3.3: customer.subscription.updated updates subscription status', async () => {
    // First flip to pro with subscription ID sub_test_active_123
    const checkoutEvent = {
      id: `evt_test_checkout_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: tenant1Id,
          customer: 'cus_test_123',
          subscription: 'sub_test_active_123',
          metadata: { tenant_id: tenant1Id, plan_id: 'pro' },
        },
      },
    };
    await request(app)
      .post('/webhooks/stripe')
      .set('Stripe-Signature', stripeService.generateTestSignature(checkoutEvent))
      .send(JSON.stringify(checkoutEvent));

    // Now send customer.subscription.updated marking it past_due
    const updateEvent = {
      id: `evt_test_sub_update_${Date.now()}`,
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test_active_123',
          customer: 'cus_test_123',
          status: 'past_due',
        },
      },
    };

    const updateRes = await request(app)
      .post('/webhooks/stripe')
      .set('Stripe-Signature', stripeService.generateTestSignature(updateEvent))
      .send(JSON.stringify(updateEvent));

    assert.equal(updateRes.statusCode, 200);

    // Billable request should now be blocked with 402 Payment Required
    const billableRes = await request(app)
      .post('/api/v1/generate')
      .set('X-Tenant-Id', tenant1Id)
      .set('Idempotency-Key', `probe-3-lapsed-${Date.now()}`)
      .send({ type: 'api_call', quantity: 1 });

    assert.equal(billableRes.statusCode, 402);
    assert.equal(billableRes.body.error, 'PAYMENT_REQUIRED');
  });

  test('3.4: customer.subscription.deleted reverts tenant to Free plan', async () => {
    // Setup Pro subscription
    const checkoutEvent = {
      id: `evt_test_checkout_${Date.now()}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: tenant1Id,
          customer: 'cus_test_del_123',
          subscription: 'sub_test_to_delete',
          metadata: { tenant_id: tenant1Id, plan_id: 'pro' },
        },
      },
    };
    await request(app)
      .post('/webhooks/stripe')
      .set('Stripe-Signature', stripeService.generateTestSignature(checkoutEvent))
      .send(JSON.stringify(checkoutEvent));

    // Send customer.subscription.deleted
    const deleteEvent = {
      id: `evt_test_sub_del_${Date.now()}`,
      object: 'event',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_test_to_delete',
          customer: 'cus_test_del_123',
          status: 'canceled',
        },
      },
    };

    const deleteRes = await request(app)
      .post('/webhooks/stripe')
      .set('Stripe-Signature', stripeService.generateTestSignature(deleteEvent))
      .send(JSON.stringify(deleteEvent));

    assert.equal(deleteRes.statusCode, 200);

    // Verify tenant subscription plan has reverted to Free
    const checkRes = await request(app)
      .get('/api/v1/usage')
      .set('X-Tenant-Id', tenant1Id);

    assert.equal(checkRes.statusCode, 200);
    assert.equal(checkRes.body.plan.id, 'free');
    assert.equal(checkRes.body.metrics.api_calls.limit, 1000);
  });
});
