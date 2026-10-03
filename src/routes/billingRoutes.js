const express = require('express');
const { z } = require('zod');
const pricingService = require('../services/pricingService');
const db = require('../config/database');

const router = express.Router();

const calculateSchema = z.object({
  tenant_id: z.string().optional(),
  type: z.enum(['api_call', 'ai_tokens']).optional(),
  quantity: z.number().int().positive().optional(),
  simulated_usage: z
    .object({
      input_tokens: z.number().int().nonnegative().default(0),
      cached_input_tokens: z.number().int().nonnegative().default(0),
      output_tokens: z.number().int().nonnegative().default(0),
      reasoning_tokens: z.number().int().nonnegative().default(0),
    })
    .optional(),
});

/**
 * POST /api/billing/calculate
 * Calculate bill or rating simulation
 */
router.post('/calculate', async (req, res, next) => {
  try {
    const parseResult = calculateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid calculation parameters',
        details: parseResult.error.format(),
      });
    }

    const { tenant_id, type, quantity, simulated_usage } = parseResult.data;

    // 1. If explicit usage params provided, calculate cost for that usage
    if (type) {
      const calculation = pricingService.calculateCost({
        type,
        quantity,
        simulatedUsage: simulated_usage,
      });

      return res.status(200).json({
        status: 'success',
        type,
        quantity: calculation.quantity,
        breakdown: calculation.breakdown || null,
        cost_microcents: calculation.costMicrocents,
        cost_cents: calculation.costCents,
        cost_display: `$${(calculation.costMicrocents / 100000000).toFixed(6)}`,
        pricing_rates_per_1k: pricingService.PRICING_CONFIG,
      });
    }

    // 2. If tenant_id provided without type, rollup tenant's total usage
    if (tenant_id) {
      const tenantRes = await db.query(
        `SELECT t.id, t.name, s.plan_id, s.current_period_start, s.current_period_end, p.price_cents
         FROM tenants t
         JOIN subscriptions s ON t.id = s.tenant_id
         JOIN plans p ON s.plan_id = p.id
         WHERE t.id = $1`,
        [tenant_id]
      );

      if (tenantRes.rows.length === 0) {
        return res.status(404).json({
          error: 'TENANT_NOT_FOUND',
          message: `Tenant '${tenant_id}' not found`,
        });
      }

      const tenant = tenantRes.rows[0];
      const usageRes = await db.query(
        `SELECT type, COALESCE(SUM(quantity), 0) AS total_quantity, COALESCE(SUM(calculated_cost_microcents), 0) AS total_cost_microcents
         FROM usage_events
         WHERE tenant_id = $1 AND created_at >= $2 AND created_at <= $3
         GROUP BY type`,
        [tenant_id, tenant.current_period_start, tenant.current_period_end]
      );

      let usageMicrocents = 0;
      const breakdown = {};
      for (const row of usageRes.rows) {
        breakdown[row.type] = {
          quantity: Number(row.total_quantity),
          cost_microcents: Number(row.total_cost_microcents),
        };
        usageMicrocents += Number(row.total_cost_microcents);
      }

      const baseFeeMicrocents = tenant.price_cents * 1000000;
      const grandTotalMicrocents = baseFeeMicrocents + usageMicrocents;

      return res.status(200).json({
        status: 'success',
        tenant_id,
        plan_id: tenant.plan_id,
        base_fee_cents: tenant.price_cents,
        usage_microcents: usageMicrocents,
        total_microcents: grandTotalMicrocents,
        total_display: `$${(grandTotalMicrocents / 100000000).toFixed(2)}`,
        breakdown,
      });
    }

    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'Please provide either a usage type or a tenant_id to calculate.',
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/:customerId
 * Get billing summary for customer
 */
router.get('/:customerId', async (req, res, next) => {
  try {
    const { customerId } = req.params;

    const query = `
      SELECT 
        t.id AS tenant_id,
        t.name,
        t.email,
        s.plan_id,
        s.status AS subscription_status,
        s.current_period_start,
        s.current_period_end,
        p.name AS plan_name,
        p.price_cents,
        p.api_call_limit,
        p.ai_token_limit
      FROM tenants t
      JOIN subscriptions s ON t.id = s.tenant_id
      JOIN plans p ON s.plan_id = p.id
      WHERE t.id = $1 OR t.stripe_customer_id = $1
    `;

    const result = await db.query(query, [customerId]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'CUSTOMER_NOT_FOUND',
        message: `Billing record for customer '${customerId}' not found.`,
      });
    }

    const sub = result.rows[0];
    const tenantId = sub.tenant_id;

    const usageQuery = `
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

    const usageResult = await db.query(usageQuery, [tenantId, sub.current_period_start, sub.current_period_end]);
    const metricsMap = {};
    let totalUsageMicrocents = 0;

    for (const row of usageResult.rows) {
      const qty = Number(row.total_quantity);
      const cost = Number(row.total_cost_microcents);
      metricsMap[row.type] = { quantity: qty, cost_microcents: cost };
      totalUsageMicrocents += cost;
    }

    const apiCallsUsed = metricsMap['api_call']?.quantity || 0;
    const aiTokensUsed = metricsMap['ai_tokens']?.quantity || 0;
    const baseFeeMicrocents = sub.price_cents * 1000000;
    const grandTotalMicrocents = baseFeeMicrocents + totalUsageMicrocents;

    return res.status(200).json({
      customer_id: tenantId,
      customer_name: sub.name,
      plan: {
        id: sub.plan_id,
        name: sub.plan_name,
        status: sub.subscription_status,
        base_price_cents: sub.price_cents,
      },
      billing_period: {
        start: sub.current_period_start,
        end: sub.current_period_end,
      },
      usage: {
        api_calls: {
          used: apiCallsUsed,
          limit: sub.api_call_limit,
          remaining: Math.max(0, sub.api_call_limit - apiCallsUsed),
        },
        ai_tokens: {
          used: aiTokensUsed,
          limit: sub.ai_token_limit,
          remaining: Math.max(0, sub.ai_token_limit - aiTokensUsed),
        },
      },
      cost: {
        base_fee_cents: sub.price_cents,
        usage_microcents: totalUsageMicrocents,
        total_microcents: grandTotalMicrocents,
        total_cents: grandTotalMicrocents / 1000000,
        formatted_usd: `$${(grandTotalMicrocents / 100000000).toFixed(2)}`,
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
