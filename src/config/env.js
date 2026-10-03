const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'sqlite://./data/metering_billing.sqlite',
  stripeApiKey: process.env.STRIPE_API_KEY || 'sk_test_placeholder',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || process.env.WEBHOOK_SECRET || 'whsec_placeholder',
};

module.exports = config;
