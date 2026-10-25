'use strict';

const { newDb, DataType } = require('pg-mem');
const request = require('supertest');

const { createApp } = require('../src/app');
const { createLogger } = require('../src/logger');
const { runMigrations } = require('../src/db/migrate');
const { ensureAdminUser } = require('../src/services/users');

const TEST_EMAIL = 'tester@example.com';
const TEST_PASSWORD = 'correct-horse-battery';

function testConfig(overrides = {}) {
  return {
    nodeEnv: 'test',
    isProduction: false,
    port: 0,
    jwtSecret: 'test-secret-test-secret-test-secret-123',
    jwtExpiresIn: '1h',
    bcryptRounds: 4,
    adminEmail: TEST_EMAIL,
    adminPassword: TEST_PASSWORD,
    corsOrigins: ['https://bycmlla.github.io'],
    trustProxy: 0,
    loginMaxAttempts: 5,
    loginWindowMs: 60_000,
    ...overrides,
  };
}

/** App completo sobre um PostgreSQL em memória (pg-mem), com migrations e usuário inicial. */
async function createTestContext(configOverrides) {
  const memory = newDb();
  // pg-mem não traz char_length (usada em um CHECK da migration).
  memory.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (text) => text.length,
  });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const logger = createLogger({ silent: true });
  const config = testConfig(configOverrides);

  await runMigrations(pool, { logger, lock: false });
  await ensureAdminUser(pool, config, logger);

  const app = createApp({ db: pool, config, logger });
  return { app, pool, config, logger, agent: request(app) };
}

async function loginToken(agent, email = TEST_EMAIL, password = TEST_PASSWORD) {
  const res = await agent.post('/api/auth/login').send({ email, password });
  return res.body.token;
}

module.exports = { createTestContext, loginToken, testConfig, TEST_EMAIL, TEST_PASSWORD };
