const db = require('../config/database');

async function checkQuota({ tenantId, subscription, type, requestedQuantity }) {
  // 1. Subscription status check (Probe 2 - Lapsed/unpaid check returns 402)
  if (subscription.subscription_status !== 'active') {
    return {
      allowed: false,
      statusCode: 402,
      error: 'PAYMENT_REQUIRED',
      message: `Subscription status '${subscription.subscription_status}'. Valid payment method required to perform billable actions.`,
      subscriptionStatus: subscription.subscription_status,
    };
  }

  // 2. Resolve plan limit for requested metric
  let limit = 0;
  if (type === 'api_call') {
    limit = Number(subscription.api_call_limit || 1000);
  } else if (type === 'ai_tokens') {
    limit = Number(subscription.ai_token_limit || 100000);
  } else {
    throw new Error(`Unsupported metric type for quota check: ${type}`);
  }

  // 3. Aggregate current usage within active billing window
  const query = `
    SELECT COALESCE(SUM(quantity), 0) AS total_used
    FROM usage_events
    WHERE tenant_id = $1
      AND type = $2
      AND created_at >= $3
      AND created_at <= $4
  `;

  const periodStart = subscription.current_period_start || new Date(0).toISOString();
  const periodEnd = subscription.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const res = await db.query(query, [tenantId, type, periodStart, periodEnd]);
  const currentUsed = Number(res.rows[0]?.total_used || 0);
  const projectedUsage = currentUsed + Number(requestedQuantity);

  // 4. Boundary honesty check (Probe 2)
  if (projectedUsage <= limit) {
    return {
      allowed: true,
      limit,
      used: currentUsed,
      projectedUsage,
      remaining: limit - projectedUsage,
    };
  }

  // Limit exceeded: calculate Retry-After in seconds
  const endMs = new Date(periodEnd).getTime();
  const nowMs = Date.now();
  const retryAfterSeconds = Math.max(1, Math.ceil((endMs - nowMs) / 1000));

  return {
    allowed: false,
    statusCode: 429,
    retryAfter: retryAfterSeconds,
    error: 'QUOTA_EXCEEDED',
    message: `Usage quota exceeded: Limit of ${limit.toLocaleString()} ${type} reached for plan '${subscription.plan_name || subscription.plan_id}'. Upgrade to Pro to continue.`,
    plan: subscription.plan_id,
    metric: type,
    limit,
    used: currentUsed,
    requested: Number(requestedQuantity),
  };
}

module.exports = {
  checkQuota,
};
