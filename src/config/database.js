const fs = require('fs');
const path = require('path');
const config = require('./env');

let dbDriver = null;

function isPostgres(url) {
  return url && (url.startsWith('postgres://') || url.startsWith('postgresql://'));
}

if (isPostgres(config.databaseUrl)) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.databaseUrl });

  dbDriver = {
    type: 'postgres',
    async query(text, params = []) {
      const res = await pool.query(text, params);
      return {
        rows: res.rows,
        rowCount: res.rowCount,
      };
    },
    async getClient() {
      const client = await pool.connect();
      return {
        query: (text, params) => client.query(text, params),
        release: () => client.release(),
      };
    },
    async close() {
      await pool.end();
    },
    async isHealthy() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    }
  };
} else {
  // SQLite implementation using built-in node:sqlite in Node v22+
  const { DatabaseSync } = require('node:sqlite');
  let dbPath = config.databaseUrl.replace(/^sqlite:\/\//, '');

  if (dbPath !== ':memory:') {
    const absPath = path.resolve(process.cwd(), dbPath);
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    dbPath = absPath;
  }

  const db = new DatabaseSync(dbPath);
  // Enable foreign keys, busy timeout, and WAL mode for multi-process safety
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {}

  // Translate $1, $2, ... to ? for SQLite prepared statements
  function adaptSql(text) {
    // Replace PostgreSQL-specific tokens
    let adapted = text
      .replace(/::jsonb/gi, '')
      .replace(/NOW\(\)/gi, "datetime('now')")
      .replace(/INTERVAL '1 month'/gi, "'+1 month'")
      .replace(/INTERVAL '24 hours'/gi, "'+1 day'")
      .replace(/gen_random_uuid\(\)/gi, "(lower(hex(randomblob(16))))");

    // Replace $1, $2, etc. with ?
    adapted = adapted.replace(/\$\d+/g, '?');
    return adapted;
  }

  function parseRow(row) {
    if (!row) return row;
    const cloned = { ...row };
    // Auto-parse JSON columns if stored as strings
    if (typeof cloned.properties === 'string') {
      try { cloned.properties = JSON.parse(cloned.properties); } catch {}
    }
    if (typeof cloned.response_body === 'string') {
      try { cloned.response_body = JSON.parse(cloned.response_body); } catch {}
    }
    // Convert SQLite sum/count numbers if needed
    if (cloned.total_used !== undefined && cloned.total_used !== null) {
      cloned.total_used = Number(cloned.total_used);
    }
    return cloned;
  }

  dbDriver = {
    type: 'sqlite',
    rawDb: db,
    async query(text, params = []) {
      const adapted = adaptSql(text);
      const isSelect = /^\s*(SELECT|PRAGMA)/i.test(adapted);

      // Serialize object params to JSON strings for SQLite
      const processedParams = params.map(p => (typeof p === 'object' && p !== null && !(p instanceof Date)) ? JSON.stringify(p) : p);

      if (isSelect) {
        const stmt = db.prepare(adapted);
        const rows = stmt.all(...processedParams).map(parseRow);
        return { rows, rowCount: rows.length };
      } else {
        const stmt = db.prepare(adapted);
        const info = stmt.run(...processedParams);
        return {
          rows: [],
          rowCount: info.changes,
          lastInsertRowid: info.lastInsertRowid,
        };
      }
    },
    async getClient() {
      // In SQLite synchronous driver, transaction is handled via BEGIN / COMMIT
      let inTransaction = false;
      return {
        query: async (text, params = []) => {
          const trimmed = text.trim().toUpperCase();
          if (trimmed === 'BEGIN') {
            db.exec('BEGIN TRANSACTION;');
            inTransaction = true;
            return { rows: [], rowCount: 0 };
          }
          if (trimmed === 'COMMIT') {
            db.exec('COMMIT;');
            inTransaction = false;
            return { rows: [], rowCount: 0 };
          }
          if (trimmed === 'ROLLBACK') {
            if (inTransaction) {
              db.exec('ROLLBACK;');
              inTransaction = false;
            }
            return { rows: [], rowCount: 0 };
          }
          return dbDriver.query(text, params);
        },
        release: () => {
          if (inTransaction) {
            try { db.exec('ROLLBACK;'); } catch {}
          }
        },
      };
    },
    async close() {
      try { db.close(); } catch {}
    },
    async isHealthy() {
      try {
        const stmt = db.prepare('SELECT 1 as alive');
        const res = stmt.get();
        return res && res.alive === 1;
      } catch {
        return false;
      }
    }
  };
}

module.exports = dbDriver;
