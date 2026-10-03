const express = require('express');
const { z } = require('zod');
const stripeService = require('../services/stripeService');
const tenantContext = require('../middlewares/tenantContext');

const router = express.Router();

const checkoutSchema = z.object({
  plan_id: z.enum(['free', 'pro']).default('pro'),
  success_url: z.string().url().optional(),
  cancel_url: z.string().url().optional(),
});

/**
 * POST /api/v1/checkout/session (also /api/v1/billing/checkout)
 * Initiates Stripe Checkout session for a tenant to upgrade to Pro.
 */
router.post(
  '/session',
  tenantContext,
  async (req, res, next) => {
    try {
      const parseResult = checkoutSchema.safeParse(req.body || {});
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid checkout parameters',
          details: parseResult.error.format(),
        });
      }

      const { plan_id, success_url, cancel_url } = parseResult.data;

      const session = await stripeService.createCheckoutSession({
        tenantId: req.tenant.id,
        planId: plan_id,
        successUrl: success_url,
        cancelUrl: cancel_url,
      });

      return res.status(200).json(session);
    } catch (err) {
      next(err);
    }
  }
);

// Alias: POST /api/v1/billing/checkout -> POST /session
router.post(
  '/checkout',
  tenantContext,
  async (req, res, next) => {
    req.url = '/session';
    return router.handle(req, res, next);
  }
);

module.exports = router;
