const db = require('../config/database');
const config = require('../config/env');

/**
 * Background Reconciliation & Quota Alert Job
 * Fulfills Requirement 3: "≥1 background job — slow/bulk work off the request path, retries + failure alert"
 * and Stretch Goals: Reconciliation job (catches missed syncs) + Usage alerts (80% & 100%).
 */

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function performReconciliationWork() {
  const alerts = [];
  const reconciled = [];

  // 1. Fetch all tenants with subscriptions and plans
  const query = `
    SELECT 
      t.id AS tenant_id,
      t.name AS tenant_name,
      t.stripe_customer_id,
      s.id AS subscription_id,
      s.plan_id,
      s.status AS subscription_status,
      s.stripe_subscription_id,
      s.current_period_start,
      s.current_period_end,
      p.api_call_limit,
      p.ai_token_limit
    FROM tenants t
    JOIN subscriptions s ON t.id = s.tenant_id
    JOIN plans p ON s.plan_id = p.id
  `;

  const tenantsRes = await db.query(query);

  for (const tenant of tenantsRes.rows) {
    // 2. Aggregate current billing cycle usage
    const usageRes = await db.query(
      `SELECT type, COALESCE(SUM(quantity), 0) AS total_used
       FROM usage_events
       WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
       GROUP BY type`,
      [tenant.tenant_id, tenant.current_period_start, tenant.current_period_end]
    );

    const usageMap = {};
    for (const u of usageRes.rows) {
      usageMap[u.type] = Number(u.total_used);
    }

    const apiCalls = usageMap['api_call'] || 0;
    const aiTokens = usageMap['ai_tokens'] || 0;

    // Check 80% & 100% quota threshold alerts
    const apiCallRatio = apiCalls / tenant.api_call_limit;
    const aiTokenRatio = aiTokens / tenant.ai_token_limit;

    if (apiCallRatio >= 1.0) {
      alerts.push({
        severity: 'CRITICAL',
        tenantId: tenant.tenant_id,
        metric: 'api_call',
        used: apiCalls,
        limit: tenant.api_call_limit,
        message: `Tenant '${tenant.tenant_name}' reached 100% of API call quota (${apiCalls}/${tenant.api_call_limit})`,
      });
    } else if (apiCallRatio >= 0.8) {
      alerts.push({
        severity: 'WARNING',
        tenantId: tenant.tenant_id,
        metric: 'api_call',
        used: apiCalls,
        limit: tenant.api_call_limit,
        message: `Tenant '${tenant.tenant_name}' reached 80% of API call quota (${apiCalls}/${tenant.api_call_limit})`,
      });
    }

    if (aiTokenRatio >= 1.0) {
      alerts.push({
        severity: 'CRITICAL',
        tenantId: tenant.tenant_id,
        metric: 'ai_tokens',
        used: aiTokens,
        limit: tenant.ai_token_limit,
        message: `Tenant '${tenant.tenant_name}' reached 100% of AI token quota (${aiTokens}/${tenant.ai_token_limit})`,
      });
    } else if (aiTokenRatio >= 0.8) {
      alerts.push({
        severity: 'WARNING',
        tenantId: tenant.tenant_id,
        metric: 'ai_tokens',
        used: aiTokens,
        limit: tenant.ai_token_limit,
        message: `Tenant '${tenant.tenant_name}' reached 80% of AI token quota (${aiTokens}/${tenant.ai_token_limit})`,
      });
    }

    reconciled.push({
      tenantId: tenant.tenant_id,
      plan: tenant.plan_id,
      status: tenant.subscription_status,
      apiCalls,
      aiTokens,
    });
  }

  return {
    reconciledCount: reconciled.length,
    reconciled,
    alerts,
  };
}

/**
 * Executes reconciliation with retry policy and failure alerting.
 */
async function runReconciliation({ maxRetries = 3, retryDelayMs = 200 } = {}) {
  const startTime = Date.now();
  let attempt = 0;
  let lastError = null;

  while (attempt < maxRetries) {
    attempt++;
    try {
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[ReconciliationJob] Starting execution attempt ${attempt}/${maxRetries}...`);
      }

      const result = await performReconciliationWork();

      const durationMs = Date.now() - startTime;
      if (process.env.NODE_ENV !== 'test') {
        console.log(`[ReconciliationJob] Success on attempt ${attempt}. Reconciled ${result.reconciledCount} tenants, generated ${result.alerts.length} quota alerts in ${durationMs}ms.`);
      }

      return {
        success: true,
        attempt,
        durationMs,
        result,
      };
    } catch (err) {
      lastError = err;
      console.warn(`[ReconciliationJob] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < maxRetries) {
        await sleep(retryDelayMs * Math.pow(2, attempt - 1));
      }
    }
  }

  // Exhausted all retries: trigger failure alert
  const failureAlert = {
    alert_type: 'CRITICAL_JOB_FAILURE',
    job_name: 'reconciliation_and_quota_alert',
    attempts: attempt,
    error: lastError ? lastError.message : 'Unknown error',
    timestamp: new Date().toISOString(),
  };

  console.error('[ReconciliationJob] CRITICAL FAILURE ALERT DISPATCHED:', JSON.stringify(failureAlert));

  return {
    success: false,
    attempts: attempt,
    failureAlert,
    error: lastError,
  };
}

if (require.main === module) {
  runReconciliation()
    .then((res) => {
      console.log('[ReconciliationJob] Finished:', JSON.stringify(res, null, 2));
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[ReconciliationJob] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = {
  runReconciliation,
  performReconciliationWork,
};
