const { z } = require('zod');

const generateSchema = z.object({
  type: z.enum(['ai_tokens', 'api_call']).default('ai_tokens'),
  prompt: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  simulated_usage: z.object({
    input_tokens: z.number().int().min(0).default(0),
    cached_input_tokens: z.number().int().min(0).default(0),
    output_tokens: z.number().int().min(0).default(0),
    reasoning_tokens: z.number().int().min(0).default(0),
  }).optional()
});

function validateGenerateRequest(req, res, next) {
  const result = generateSchema.safeParse(req.body || {});
  if (!result.success) {
    return res.status(400).json({
      error: 'INVALID_REQUEST_PAYLOAD',
      message: 'Request payload validation failed.',
      issues: result.error.issues.map(i => ({
        path: i.path.join('.'),
        message: i.message,
      }))
    });
  }

  req.validatedBody = result.data;
  next();
}

module.exports = {
  validateGenerateRequest,
};
