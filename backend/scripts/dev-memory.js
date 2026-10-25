'use strict';

// Servidor de DESENVOLVIMENTO sobre um PostgreSQL em memória (pg-mem).
// Útil para experimentar o frontend sem instalar o PostgreSQL.
// ATENÇÃO: os dados somem quando o processo termina. Nunca use em produção.

const { newDb, DataType } = require('pg-mem');

const { createApp } = require('../src/app');
const { createLogger } = require('../src/logger');
const { runMigrations } = require('../src/db/migrate');
const { ensureAdminUser } = require('../src/services/users');

const PORT = Number(process.env.PORT) || 3000;

(async () => {
  const logger = createLogger();
  const memory = newDb();
  memory.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (text) => text.length,
  });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();

  const config = {
    nodeEnv: 'development',
    isProduction: false,
    jwtSecret: 'dev-only-secret-dev-only-secret-dev-only',
    jwtExpiresIn: '7d',
    bcryptRounds: 6,
    adminEmail: process.env.ADMIN_EMAIL || 'dev@example.com',
    adminPassword: process.env.ADMIN_PASSWORD || 'dev-password-123',
    corsOrigins: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:8080', 'http://127.0.0.1:8080'],
    trustProxy: 0,
    loginMaxAttempts: 100,
    loginWindowMs: 15 * 60 * 1000,
  };

  await runMigrations(pool, { logger, lock: false });
  await ensureAdminUser(pool, config, logger);

  createApp({ db: pool, config, logger }).listen(PORT, () => {
    logger.info(`API de desenvolvimento (memória) em http://localhost:${PORT}`);
    logger.info(`Login: ${config.adminEmail} / (ADMIN_PASSWORD ou "dev-password-123")`);
  });
})();
