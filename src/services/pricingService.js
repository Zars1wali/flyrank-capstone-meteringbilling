// Pricing rules adhering strictly to DESIGN.md Section 6 & Modern Treasury integer microcents standard

const PRICING_CONFIG = {
  // Rates defined in microcents per 1,000 tokens ($1.00 = 100,000,000 microcents)
  // $0.50 / 1M input tokens = 50,000 microcents / 1k tokens
  // $0.125 / 1M cached input tokens = 12,500 microcents / 1k tokens
  // $1.50 / 1M output tokens = 150,000 microcents / 1k tokens
  AI_TOKENS: {
    FRESH_INPUT_MICROCENTS_PER_1K: 50000,    // $0.50 per 1M tokens
    CACHED_INPUT_MICROCENTS_PER_1K: 12500,   // $0.125 per 1M tokens (75% discount)
    OUTPUT_MICROCENTS_PER_1K: 150000,        // $1.50 per 1M tokens
    REASONING_MICROCENTS_PER_1K: 150000      // Billed identically to output tokens
  },
  API_CALLS: {
    BASE_COST_MICROCENTS_PER_CALL: 1000      // $0.01 per 100 calls = 1000 microcents/call
  }
};

function calculateCost({ type, quantity, simulatedUsage }) {
  if (type === 'api_call') {
    const qty = quantity || 1;
    const costMicrocents = qty * PRICING_CONFIG.API_CALLS.BASE_COST_MICROCENTS_PER_CALL;
    return {
      quantity: qty,
      costMicrocents,
      costCents: costMicrocents / 1000000,
    };
  }

  if (type === 'ai_tokens') {
    const input = (simulatedUsage && simulatedUsage.input_tokens) || 0;
    const cached = (simulatedUsage && simulatedUsage.cached_input_tokens) || 0;
    const output = (simulatedUsage && simulatedUsage.output_tokens) || 0;
    const reasoning = (simulatedUsage && simulatedUsage.reasoning_tokens) || 0;

    const totalTokens = input + cached + output + reasoning;

    // Formula from DESIGN.md Section 6:
    // Total Cost = floor((input * 50000 + cached * 12500 + output * 150000 + reasoning * 150000) / 1000)
    const costMicrocents = Math.floor(
      (input * PRICING_CONFIG.AI_TOKENS.FRESH_INPUT_MICROCENTS_PER_1K +
       cached * PRICING_CONFIG.AI_TOKENS.CACHED_INPUT_MICROCENTS_PER_1K +
       output * PRICING_CONFIG.AI_TOKENS.OUTPUT_MICROCENTS_PER_1K +
       reasoning * PRICING_CONFIG.AI_TOKENS.REASONING_MICROCENTS_PER_1K) / 1000
    );

    return {
      quantity: totalTokens,
      breakdown: {
        input_tokens: input,
        cached_input_tokens: cached,
        output_tokens: output,
        reasoning_tokens: reasoning,
      },
      costMicrocents,
      costCents: costMicrocents / 1000000,
    };
  }

  throw new Error(`Unsupported usage type: ${type}`);
}

module.exports = {
  PRICING_CONFIG,
  calculateCost,
};
