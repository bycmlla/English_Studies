'use strict';

require('dotenv').config({ quiet: true });

const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPool } = require('./db/pool');
const { runMigrations } = require('./db/migrate');
const { ensureAdminUser } = require('./services/users');
const { createApp } = require('./app');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// O banco do Render pode demorar a aceitar conexões logo após um deploy.
async function withRetry(label, fn, logger, attempts = 5) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= attempts) throw err;
      logger.warn(`${label} falhou (tentativa ${attempt}/${attempts}): ${err.message}`);
      await sleep(attempt * 2000);
    }
  }
}

async function main() {
  const logger = createLogger({ level: process.env.LOG_LEVEL || 'info' });
  const config = loadConfig();
  const pool = createPool(config, logger);

  if (config.runMigrationsOnStart) {
    await withRetry('Migrations', () => runMigrations(pool, { logger }), logger);
  }
  await withRetry('Usuário inicial', () => ensureAdminUser(pool, config, logger), logger);

  const app = createApp({ db: pool, config, logger });
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`API ouvindo na porta ${config.port} (${config.nodeEnv})`, {
      corsOrigins: config.corsOrigins.length,
    });
  });

  const shutdown = (signal) => {
    logger.info(`${signal} recebido, encerrando...`);
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(`Falha ao iniciar a API: ${err.message}`);
  process.exit(1);
});
