const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');
const { seedDatabase } = require('../src/db/seed');
const stripeService = require('../src/services/stripeService');

describe('PROBE 4 — Webhook Cryptographic Verification & Replay Protection Acceptance Tests', () => {
  const tenant1Id = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    await seedDatabase();
  });

  test('4.1: Missing stripe-signature header returns 400 Bad Request', async () => {
    const payload = {
      id: 'evt_test_no_sig',
      type: 'checkout.session.completed',
      data: { object: { client_reference_id: tenant1Id } },
    };

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'BAD_WEBHOOK_SIGNATURE');
  });

  test('4.2: Forged webhook (bad signature) returns 400 and nothing changes (Probe 4 Guarantee)', async () => {
    const initialPlanRes = await db.query('SELECT plan_id FROM subscriptions WHERE tenant_id = $1', [tenant1Id]);
    assert.equal(initialPlanRes.rows[0].plan_id, 'free');

    const forgedPayload = {
      id: `evt_forged_${Date.now()}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: tenant1Id,
          subscription: 'sub_forged_999',
          metadata: { tenant_id: tenant1Id, plan_id: 'pro' },
        },
      },
    };

    // Construct a forged signature
    const forgedSignature = 't=1600000000,v1=0000000000000000000000000000000000000000000000000000000000000000';

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', forgedSignature)
      .send(JSON.stringify(forgedPayload));

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'BAD_WEBHOOK_SIGNATURE');

    // Guarantee: Tenant state remains Free in database
    const checkPlanRes = await db.query('SELECT plan_id FROM subscriptions WHERE tenant_id = $1', [tenant1Id]);
    assert.equal(checkPlanRes.rows[0].plan_id, 'free', 'Tenant plan must not change on forged webhook');

    // Guarantee: Event is NOT recorded in processed_webhook_events
    const eventCheck = await db.query('SELECT id FROM processed_webhook_events WHERE id = $1', [forgedPayload.id]);
    assert.equal(eventCheck.rows.length, 0);
  });

  test('4.3: Valid webhook event processes once; Replaying same event twice is ignored (Probe 4 Guarantee)', async () => {
    const eventId = `evt_probe4_replay_test_${Date.now()}`;
    const payload = {
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_replay_session',
          client_reference_id: tenant1Id,
          customer: 'cus_probe4_tenant',
          subscription: 'sub_probe4_live',
          metadata: {
            tenant_id: tenant1Id,
            plan_id: 'pro',
          },
        },
      },
    };

    const signature = stripeService.generateTestSignature(payload);

    // First arrival: processes normally
    const firstRes = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(JSON.stringify(payload));

    assert.equal(firstRes.statusCode, 200);
    assert.equal(firstRes.body.processed, true);
    assert.equal(firstRes.body.duplicate, false);

    // Verify tenant upgraded to Pro
    const planAfterFirst = await db.query('SELECT plan_id FROM subscriptions WHERE tenant_id = $1', [tenant1Id]);
    assert.equal(planAfterFirst.rows[0].plan_id, 'pro');

    // Count records in processed_webhook_events
    const countFirst = await db.query('SELECT COUNT(*) as count FROM processed_webhook_events WHERE id = $1', [eventId]);
    assert.equal(Number(countFirst.rows[0].count), 1);

    // Second arrival (REPLAY): ignored safely
    const replayRes = await request(app)
      .post('/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(JSON.stringify(payload));

    assert.equal(replayRes.statusCode, 200);
    assert.equal(replayRes.body.processed, false);
    assert.equal(replayRes.body.duplicate, true);
    assert.match(replayRes.body.message, /already processed/i);

    // Count in processed_webhook_events remains exactly 1
    const countAfterReplay = await db.query('SELECT COUNT(*) as count FROM processed_webhook_events WHERE id = $1', [eventId]);
    assert.equal(Number(countAfterReplay.rows[0].count), 1);
  });

  test('4.4: Webhook route alias /api/v1/webhooks/stripe behaves identically', async () => {
    const eventId = `evt_probe4_alias_${Date.now()}`;
    const payload = {
      id: eventId,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: tenant1Id,
          subscription: 'sub_alias_test',
          metadata: { tenant_id: tenant1Id, plan_id: 'pro' },
        },
      },
    };

    const signature = stripeService.generateTestSignature(payload);

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(JSON.stringify(payload));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.processed, true);
  });
});
