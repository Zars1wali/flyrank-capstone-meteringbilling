const express = require('express');
const db = require('../config/database');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    name: 'Usage Metering & Billing Engine',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      health: 'GET /health',
      billableGenerate: 'POST /api/v1/generate (Requires X-Tenant-Id, Idempotency-Key)',
      usageRollup: 'GET /api/v1/usage (Requires X-Tenant-Id)',
    },
  });
});

router.get('/health', async (req, res) => {
  const isHealthy = await db.isHealthy();
  if (!isHealthy) {
    return res.status(503).json({
      status: 'error',
      database: 'disconnected',
    });
  }
  return res.status(200).json({
    status: 'ok',
    database: 'connected',
  });
});

module.exports = router;
