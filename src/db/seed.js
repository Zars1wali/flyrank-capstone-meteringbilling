const db = require('../config/database');
const { runMigrations } = require('./migrate');

async function seedDatabase() {
  console.log('[Seed] Ensuring schema is up to date...');
  await runMigrations();

  console.log('[Seed] Cleaning existing seed data...');
  // Clear tables in reverse dependency order
  await db.query('DELETE FROM idempotency_records');
  await db.query('DELETE FROM usage_events');
  await db.query('DELETE FROM subscriptions');
  await db.query('DELETE FROM tenants');
  await db.query('DELETE FROM plans');

  console.log('[Seed] Inserting plans...');
  await db.query(`
    INSERT INTO plans (id, name, price_cents, api_call_limit, ai_token_limit)
    VALUES 
      ('free', 'Free Tier', 0, 1000, 100000),
      ('pro', 'Pro Tier', 2900, 10000, 1000000)
  `);

  console.log('[Seed] Inserting test tenants and subscriptions...');
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  // Tenant 1: Fresh tenant on Free plan (0 usage)
  const tenant1Id = '00000000-0000-0000-0000-000000000001';
  await db.query(
    'INSERT INTO tenants (id, name, email) VALUES ($1, $2, $3)',
    [tenant1Id, 'Acme Corp (Clean Tenant)', 'acme@example.com']
  );
  await db.query(
    'INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6)',
    ['sub-001', tenant1Id, 'free', 'active', periodStart, periodEnd]
  );

  // Tenant 2: Free tier at boundary (999 API calls used out of 1000 limit)
  const tenant2Id = '00000000-0000-0000-0000-000000000002';
  await db.query(
    'INSERT INTO tenants (id, name, email) VALUES ($1, $2, $3)',
    [tenant2Id, 'Beta Startup (At Boundary)', 'beta@example.com']
  );
  await db.query(
    'INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6)',
    ['sub-002', tenant2Id, 'free', 'active', periodStart, periodEnd]
  );
  // Seed 999 API call usage events
  await db.query(
    'INSERT INTO usage_events (id, tenant_id, type, quantity, idempotency_key, properties, calculated_cost_microcents, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    ['evt-seed-999', tenant2Id, 'api_call', 999, 'seed-key-999', JSON.stringify({ note: 'Pre-seeded 999 calls' }), 999000, now.toISOString()]
  );

  // Tenant 3: Free tier with lapsed/past_due subscription (Immediate 402 Payment Required)
  const tenant3Id = '00000000-0000-0000-0000-000000000003';
  await db.query(
    'INSERT INTO tenants (id, name, email) VALUES ($1, $2, $3)',
    [tenant3Id, 'Gamma Lapsed (Past Due)', 'gamma@example.com']
  );
  await db.query(
    'INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6)',
    ['sub-003', tenant3Id, 'free', 'past_due', periodStart, periodEnd]
  );

  // Tenant 4: Free tier at AI Token boundary (99,000 tokens used out of 100,000 limit)
  const tenant4Id = '00000000-0000-0000-0000-000000000004';
  await db.query(
    'INSERT INTO tenants (id, name, email) VALUES ($1, $2, $3)',
    [tenant4Id, 'Delta AI Labs (Token Boundary)', 'delta@example.com']
  );
  await db.query(
    'INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6)',
    ['sub-004', tenant4Id, 'free', 'active', periodStart, periodEnd]
  );
  await db.query(
    'INSERT INTO usage_events (id, tenant_id, type, quantity, idempotency_key, properties, calculated_cost_microcents, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    ['evt-seed-99k', tenant4Id, 'ai_tokens', 99000, 'seed-key-99k', JSON.stringify({ note: 'Pre-seeded 99k tokens' }), 1237500, now.toISOString()]
  );

  // Tenant 5: Pro tier tenant (higher quotas: 10,000 API calls, 1,000,000 tokens)
  const tenant5Id = '00000000-0000-0000-0000-000000000005';
  await db.query(
    'INSERT INTO tenants (id, name, email) VALUES ($1, $2, $3)',
    [tenant5Id, 'Epsilon Enterprise (Pro Tier)', 'epsilon@example.com']
  );
  await db.query(
    'INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6)',
    ['sub-005', tenant5Id, 'pro', 'active', periodStart, periodEnd]
  );

  console.log('[Seed] Database seeded successfully.');
}

if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('[Seed] Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Seed] Failed:', err);
      process.exit(1);
    });
}

module.exports = { seedDatabase };
