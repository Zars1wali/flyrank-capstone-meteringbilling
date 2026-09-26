const express = require('express');
const healthRoutes = require('./routes/healthRoutes');
const generateRoutes = require('./routes/generateRoutes');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(express.json());

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

// Main API v1 routes
app.use('/api/v1', generateRoutes);

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
