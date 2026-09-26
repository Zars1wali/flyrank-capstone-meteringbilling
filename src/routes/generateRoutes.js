const express = require('express');
const { v4: uuidv4 } = require('uuid');
const tenantContext = require('../middlewares/tenantContext');
const idempotency = require('../middlewares/idempotency');
const { validateGenerateRequest } = require('../middlewares/validateRequest');
const pricingService = require('../services/pricingService');
const quotaService = require('../services/quotaService');
const meterService = require('../services/meterService');
const db = require('../config/database');

const router = express.Router();

/**
 * POST /api/v1/generate
 * Main billable endpoint (Probe 1 & Probe 2)
 */
router.post(
  '/generate',
  tenantContext,
  validateGenerateRequest,
  idempotency,
  async (req, res, next) => {
    try {
      const { type, simulated_usage, quantity: rawQuantity, prompt } = req.validatedBody;

      // 1. Calculate consumption and monetary cost
      const pricing = pricingService.calculateCost({
        type,
        quantity: rawQuantity,
        simulatedUsage: simulated_usage,
      });

      const quantity = pricing.quantity;

      // 2. Enforce quota limits & boundary honesty (Probe 2)
      const quotaResult = await quotaService.checkQuota({
        tenantId: req.tenant.id,
        subscription: req.subscription,
        type,
        requestedQuantity: quantity,
      });

      if (!quotaResult.allowed) {
        if (quotaResult.retryAfter) {
          res.setHeader('Retry-After', quotaResult.retryAfter.toString());
        }
        return res.status(quotaResult.statusCode).json(quotaResult);
      }

      // 3. Prepare response data payload
      const eventId = uuidv4();
      const responsePayload = {
        status: 'success',
        data: {
          event_id: eventId,
          tenant_id: req.tenant.id,
          type,
          quantity,
          breakdown: pricing.breakdown,
          cost_microcents: pricing.costMicrocents,
          cost_cents: pricing.costCents,
          quota: {
            limit: quotaResult.limit,
            used: quotaResult.projectedUsage,
            remaining: quotaResult.remaining,
          },
        },
      };

      // 4. Atomically persist usage event and idempotency record (Probe 1)
      await meterService.recordUsageAndIdempotency({
        tenantId: req.tenant.id,
        type,
        quantity,
        idempotencyKey: req.idempotency.key,
        requestHash: req.idempotency.hash,
        properties: {
          prompt: prompt || null,
          breakdown: pricing.breakdown || null,
        },
        costMicrocents: pricing.costMicrocents,
        responseStatus: 201,
        responseBody: responsePayload,
      });

      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Idempotency-Key', req.idempotency.key);
      return res.status(201).json(responsePayload);
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/usage
 * Rollup of usage events in active billing cycle
 */
router.get('/usage', tenantContext, async (req, res, next) => {
  try {
    const tenantId = req.tenant.id;
    const sub = req.subscription;

    const periodStart = sub.current_period_start || new Date(0).toISOString();
    const periodEnd = sub.current_period_end || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const query = `
      SELECT 
        type,
        COALESCE(SUM(quantity), 0) AS total_quantity,
        COALESCE(SUM(calculated_cost_microcents), 0) AS total_cost_microcents
      FROM usage_events
      WHERE tenant_id = $1
        AND created_at >= $2
        AND created_at <= $3
      GROUP BY type
    `;

    const result = await db.query(query, [tenantId, periodStart, periodEnd]);
    const metricsMap = {};
    let totalAccumulatedMicrocents = 0;

    for (const row of result.rows) {
      const qty = Number(row.total_quantity);
      const cost = Number(row.total_cost_microcents);
      metricsMap[row.type] = qty;
      totalAccumulatedMicrocents += cost;
    }

    const apiCallsUsed = metricsMap['api_call'] || 0;
    const apiCallLimit = sub.api_call_limit || 1000;
    const aiTokensUsed = metricsMap['ai_tokens'] || 0;
    const aiTokenLimit = sub.ai_token_limit || 100000;

    const totalCents = totalAccumulatedMicrocents / 1000000;
    const dollarsDisplay = `$${(totalCents / 100).toFixed(2)}`;

    return res.status(200).json({
      tenant_id: tenantId,
      plan: {
        id: sub.plan_id,
        name: sub.plan_name,
        status: sub.subscription_status,
      },
      billing_period: {
        start: periodStart,
        end: periodEnd,
      },
      metrics: {
        api_calls: {
          used: apiCallsUsed,
          limit: apiCallLimit,
          remaining: Math.max(0, apiCallLimit - apiCallsUsed),
          percent_used: Number(((apiCallsUsed / apiCallLimit) * 100).toFixed(2)),
        },
        ai_tokens: {
          used: aiTokensUsed,
          limit: aiTokenLimit,
          remaining: Math.max(0, aiTokenLimit - aiTokensUsed),
          percent_used: Number(((aiTokensUsed / aiTokenLimit) * 100).toFixed(2)),
        },
      },
      total_accumulated_cost_microcents: totalAccumulatedMicrocents,
      total_accumulated_cost_display: dollarsDisplay,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
