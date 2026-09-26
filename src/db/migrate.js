const fs = require('fs');
const path = require('path');
const db = require('../config/database');

async function runMigrations() {
  console.log('[Migration] Starting database migrations...');
  const migrationsDir = path.resolve(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    console.log(`[Migration] Applying ${file}...`);
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    // Split statements safely
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const stmt of statements) {
      await db.query(stmt);
    }
    console.log(`[Migration] Successfully applied ${file}`);
  }

  console.log('[Migration] All migrations completed successfully.');
}

if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('[Migration] Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration] Failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
