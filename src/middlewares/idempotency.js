const meterService = require('../services/meterService');

async function idempotency(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'MISSING_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key header is required for mutating billable requests.',
    });
  }

  try {
    const fullPath = req.baseUrl ? req.baseUrl + req.path : req.path;
    const requestHash = meterService.hashRequest(req.method, fullPath, req.body);
    const existingRecord = await meterService.findIdempotencyRecord(req.tenant.id, idempotencyKey);

    if (existingRecord) {
      // Check for parameter mismatch (Probe 1 - Stripe idempotency rule)
      if (existingRecord.request_hash !== requestHash) {
        return res.status(409).json({
          error: 'IDEMPOTENCY_CONFLICT',
          message: 'Idempotency key was previously used with a different request payload or parameters.',
        });
      }

      // Exact replay match: mirror original response directly without side effects
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('X-Idempotency-Key', idempotencyKey);
      const parsedBody = typeof existingRecord.response_body === 'string'
        ? JSON.parse(existingRecord.response_body)
        : existingRecord.response_body;

      return res.status(existingRecord.response_status).json(parsedBody);
    }

    // First request: attach idempotency data for downstream persistence
    req.idempotency = {
      key: idempotencyKey,
      hash: requestHash,
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = idempotency;
