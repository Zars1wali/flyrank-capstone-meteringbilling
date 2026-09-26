const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

function hashRequest(method, urlPath, body) {
  const normalizedBody = body ? JSON.stringify(body, Object.keys(body).sort()) : '';
  const payload = `${method.toUpperCase()}:${urlPath}:${normalizedBody}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function findIdempotencyRecord(tenantId, idempotencyKey) {
  const query = `
    SELECT * FROM idempotency_records
    WHERE tenant_id = $1 AND idempotency_key = $2
    LIMIT 1
  `;
  const res = await db.query(query, [tenantId, idempotencyKey]);
  return res.rows[0] || null;
}

async function recordUsageAndIdempotency({
  tenantId,
  type,
  quantity,
  idempotencyKey,
  requestHash,
  properties = {},
  costMicrocents = 0,
  responseStatus = 201,
  responseBody = {}
}) {
  const client = await db.getClient();
  const eventId = uuidv4();
  const recordId = uuidv4();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    await client.query('BEGIN');

    // 1. Insert immutable usage event
    await client.query(
      `INSERT INTO usage_events (
        id, tenant_id, type, quantity, idempotency_key, properties, calculated_cost_microcents, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        eventId,
        tenantId,
        type,
        quantity,
        idempotencyKey,
        JSON.stringify(properties),
        costMicrocents,
        now
      ]
    );

    // 2. Insert cached idempotency response
    await client.query(
      `INSERT INTO idempotency_records (
        id, tenant_id, idempotency_key, request_hash, response_status, response_body, created_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        recordId,
        tenantId,
        idempotencyKey,
        requestHash,
        responseStatus,
        JSON.stringify(responseBody),
        now,
        expiresAt
      ]
    );

    await client.query('COMMIT');

    return {
      eventId,
      recordId,
      created: true
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  hashRequest,
  findIdempotencyRecord,
  recordUsageAndIdempotency,
};
