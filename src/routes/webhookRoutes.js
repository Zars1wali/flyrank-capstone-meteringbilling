const express = require('express');
const stripeService = require('../services/stripeService');

const router = express.Router();

/**
 * POST /webhooks/stripe (and /api/v1/webhooks/stripe)
 * Cryptographically verifies signature and deduplicates webhook events.
 */
router.post(
  '/',
  async (req, res, next) => {
    try {
      const signature = req.headers['stripe-signature'];
      // Accept either req.rawBody (populated by express.json verify hook or express.raw) or req.body Buffer/string
      let rawBody = req.rawBody || req.body;
      if (typeof rawBody === 'object' && !Buffer.isBuffer(rawBody)) {
        rawBody = JSON.stringify(rawBody);
      }

      // 1. Signature verification (Probe 4: bad signature -> 400)
      let event;
      try {
        event = stripeService.verifyWebhookSignature(rawBody, signature);
      } catch (sigErr) {
        return res.status(400).json({
          error: 'BAD_WEBHOOK_SIGNATURE',
          message: sigErr.message || 'Webhook signature verification failed',
        });
      }

      // 2. Event processing & deduplication (Probe 3 & Probe 4)
      const result = await stripeService.processWebhookEvent(event);

      // Return 200 OK to Stripe in both new and duplicate cases
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
