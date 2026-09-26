const app = require('./app');
const config = require('./config/env');
const db = require('./config/database');
const { runMigrations } = require('./db/migrate');

async function startServer() {
  try {
    console.log('[Server] Initializing database...');
    await runMigrations();

    const server = app.listen(config.port, () => {
      console.log(`[Server] Usage Metering Engine running on http://localhost:${config.port}`);
      console.log(`[Server] Environment: ${config.nodeEnv}`);
    });

    const shutdown = async (signal) => {
      console.log(`[Server] Received ${signal}. Gracefully shutting down...`);
      server.close(async () => {
        await db.close();
        console.log('[Server] HTTP server and database pool closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('[Server] Fatal error on startup:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer };
