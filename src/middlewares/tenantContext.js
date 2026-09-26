const db = require('../config/database');

async function tenantContext(req, res, next) {
  const tenantId = req.headers['x-tenant-id'];

  if (!tenantId) {
    return res.status(400).json({
      error: 'MISSING_TENANT_ID',
      message: 'X-Tenant-Id header is required to identify the organization context.',
    });
  }

  try {
    const query = `
      SELECT 
        t.id, t.name, t.email, t.stripe_customer_id,
        s.id AS subscription_id, s.plan_id, s.status AS subscription_status,
        s.current_period_start, s.current_period_end,
        p.name AS plan_name, p.price_cents, p.api_call_limit, p.ai_token_limit
      FROM tenants t
      LEFT JOIN subscriptions s ON t.id = s.tenant_id
      LEFT JOIN plans p ON s.plan_id = p.id
      WHERE t.id = $1
      LIMIT 1
    `;
    const result = await db.query(query, [tenantId]);

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'TENANT_NOT_FOUND',
        message: `Tenant with ID '${tenantId}' does not exist.`,
      });
    }

    const row = result.rows[0];

    req.tenant = {
      id: row.id,
      name: row.name,
      email: row.email,
      stripeCustomerId: row.stripe_customer_id,
    };

    req.subscription = {
      id: row.subscription_id,
      plan_id: row.plan_id || 'free',
      plan_name: row.plan_name || 'Free Tier',
      price_cents: row.price_cents || 0,
      subscription_status: row.subscription_status || 'active',
      api_call_limit: row.api_call_limit || 1000,
      ai_token_limit: row.ai_token_limit || 100000,
      current_period_start: row.current_period_start,
      current_period_end: row.current_period_end,
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = tenantContext;
