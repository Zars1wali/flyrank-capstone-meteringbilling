const express = require('express');
const healthRoutes = require('./routes/healthRoutes');
const generateRoutes = require('./routes/generateRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const checkoutRoutes = require('./routes/checkoutRoutes');
const customerRoutes = require('./routes/customerRoutes');
const billingRoutes = require('./routes/billingRoutes');
const { runReconciliation } = require('./jobs/reconciliationJob');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

// Raw body parser for Stripe webhooks, JSON parser for standard REST endpoints
app.use((req, res, next) => {
  if (req.originalUrl.includes('/webhooks/stripe')) {
    express.raw({ type: '*/*', limit: '10mb' })(req, res, (err) => {
      if (err) return next(err);
      req.rawBody = req.body;
      next();
    });
  } else {
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })(req, res, next);
  }
});

// Request logger for debugging & audits
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Root & Health check
app.use('/', healthRoutes);

// Stripe Webhooks (supports both /webhooks/stripe and /api/v1/webhooks/stripe)
app.use('/webhooks/stripe', webhookRoutes);
app.use('/api/v1/webhooks/stripe', webhookRoutes);

// Checkout routes
app.use('/api/v1/checkout', checkoutRoutes);
app.use('/api/v1/billing', checkoutRoutes);

// Customer management routes (capstone.yaml support)
app.use('/api/customers', customerRoutes);

// Billing calculations & summaries (capstone.yaml support)
app.use('/api/billing', billingRoutes);

// Main billable generation and usage rollup routes
app.use('/api/v1', generateRoutes);

// Background job trigger endpoint (Requirement 3: ≥1 background job)
app.post('/api/v1/jobs/reconcile', async (req, res, next) => {
  try {
    const result = await runReconciliation();
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// Direct canonical route aliases from Capstone Brief:
// POST /generate -> Main billable action
// GET /usage -> Usage rollup
app.post('/generate', (req, res, next) => {
  req.url = '/generate';
  return generateRoutes(req, res, next);
});
app.get('/usage', (req, res, next) => {
  req.url = '/usage';
  return generateRoutes(req, res, next);
});

// Compatibility route aliases (aligning with capstone.yaml)
// POST /api/usage -> maps to /api/v1/generate
// GET /api/usage -> maps to /api/v1/usage
app.post('/api/usage', (req, res, next) => {
  req.url = '/generate';
  return generateRoutes(req, res, next);
});
app.get('/api/usage', (req, res, next) => {
  req.url = '/usage';
  return generateRoutes(req, res, next);
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Global Error Handler
app.use(errorHandler);

module.exports = app;
