const express = require('express');
const { z } = require('zod');
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');

const router = express.Router();

const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Valid email is required'),
  plan_id: z.enum(['free', 'pro']).default('free'),
});

/**
 * POST /api/customers
 * Create a new tenant customer with default subscription
 */
router.post('/', async (req, res, next) => {
  try {
    const parseResult = createCustomerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid customer input',
        details: parseResult.error.format(),
      });
    }

    const { name, email, plan_id } = parseResult.data;

    // Check if customer email already exists
    const existing = await db.query('SELECT id FROM tenants WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'CUSTOMER_EXISTS',
        message: `Customer with email '${email}' already exists.`,
      });
    }

    const tenantId = uuidv4();
    const subId = `sub-${uuidv4().slice(0, 8)}`;
    const now = new Date();
    const periodStart = now.toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO tenants (id, name, email) VALUES ($1, $2, $3)',
        [tenantId, name, email]
      );
      await client.query(
        'INSERT INTO subscriptions (id, tenant_id, plan_id, status, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6)',
        [subId, tenantId, plan_id, 'active', periodStart, periodEnd]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return res.status(201).json({
      status: 'success',
      data: {
        id: tenantId,
        name,
        email,
        plan_id,
        subscription_id: subId,
        created_at: periodStart,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers
 * List all tenants with plan details
 */
router.get('/', async (req, res, next) => {
  try {
    const query = `
      SELECT 
        t.id,
        t.name,
        t.email,
        t.stripe_customer_id,
        t.created_at,
        s.plan_id,
        s.status AS subscription_status,
        p.name AS plan_name,
        p.api_call_limit,
        p.ai_token_limit
      FROM tenants t
      LEFT JOIN subscriptions s ON t.id = s.tenant_id
      LEFT JOIN plans p ON s.plan_id = p.id
      ORDER BY t.created_at ASC
    `;
    const result = await db.query(query);
    return res.status(200).json({
      status: 'success',
      count: result.rows.length,
      data: result.rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/customers/:id
 * Get single tenant by ID
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT 
        t.id,
        t.name,
        t.email,
        t.stripe_customer_id,
        t.created_at,
        s.id AS subscription_id,
        s.plan_id,
        s.status AS subscription_status,
        s.current_period_start,
        s.current_period_end,
        p.name AS plan_name,
        p.price_cents,
        p.api_call_limit,
        p.ai_token_limit
      FROM tenants t
      LEFT JOIN subscriptions s ON t.id = s.tenant_id
      LEFT JOIN plans p ON s.plan_id = p.id
      WHERE t.id = $1
    `;
    const result = await db.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'CUSTOMER_NOT_FOUND',
        message: `Customer with ID '${id}' was not found.`,
      });
    }

    return res.status(200).json({
      status: 'success',
      data: result.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
