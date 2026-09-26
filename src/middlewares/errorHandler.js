function errorHandler(err, req, res, next) {
  console.error('[Error]', err);

  if (res.headersSent) {
    return next(err);
  }

  // Handle unique constraint violations
  if (err.code === '23505' || (err.message && err.message.includes('UNIQUE constraint failed'))) {
    return res.status(409).json({
      error: 'CONFLICT',
      message: 'A duplicate record exists or the idempotency key was already consumed.',
    });
  }

  const statusCode = err.statusCode || 500;
  return res.status(statusCode).json({
    error: err.errorCode || 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected internal server error occurred.',
  });
}

module.exports = errorHandler;
