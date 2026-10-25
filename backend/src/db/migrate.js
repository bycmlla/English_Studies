'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const MIGRATION_LOCK_ID = 727_001; // evita duas instâncias migrando ao mesmo tempo

/**
 * Aplica, em ordem, os arquivos migrations/NNN_nome.sql ainda não executados.
 * Cada arquivo roda em uma transação e é registrado em schema_migrations.
 */
async function runMigrations(pool, { dir = MIGRATIONS_DIR, logger, lock = true } = {}) {
  const client = await pool.connect();
  const appliedNow = [];
  try {
    if (lock) await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    // Consulta primeiro e só cria a tabela se ela ainda não existir (o lock acima evita corrida).
    let rows;
    try {
      ({ rows } = await client.query('SELECT name FROM schema_migrations'));
    } catch {
      await client.query(`
        CREATE TABLE schema_migrations (
          name       TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      rows = [];
    }
    const applied = new Set(rows.map((row) => row.name));

    const files = (await fs.readdir(dir)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Falha na migration ${file}: ${err.message}`);
      }
      appliedNow.push(file);
      logger?.info(`Migration aplicada: ${file}`);
    }

    if (appliedNow.length === 0) logger?.info('Banco já está atualizado (nenhuma migration pendente)');
    return appliedNow;
  } finally {
    if (lock) await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

module.exports = { runMigrations, MIGRATIONS_DIR };

// CLI: `npm run migrate`
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const { loadDatabaseConfig } = require('../config');
  const { createLogger } = require('../logger');
  const { createPool } = require('./pool');

  const logger = createLogger();
  (async () => {
    const pool = createPool(loadDatabaseConfig(), logger);
    try {
      await runMigrations(pool, { logger });
    } finally {
      await pool.end();
    }
  })().catch((err) => {
    logger.error(`Migrations falharam: ${err.message}`);
    process.exit(1);
  });
}
