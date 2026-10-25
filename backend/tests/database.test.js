'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext, testConfig, TEST_EMAIL, TEST_PASSWORD } = require('./helpers');
const { runMigrations } = require('../src/db/migrate');
const { createLogger } = require('../src/logger');
const { ensureAdminUser, findByEmail } = require('../src/services/users');
const bcrypt = require('bcryptjs');

const logger = createLogger({ silent: true });
const count = async (pool, table) => Number((await pool.query(`SELECT COUNT(*) AS total FROM ${table}`)).rows[0].total);

test('migrations criam 4 livros e 64 unidades', async () => {
  const { pool } = await createTestContext();
  assert.equal(await count(pool, 'books'), 4);
  assert.equal(await count(pool, 'units'), 64);
  const { rows } = await pool.query('SELECT book_id, COUNT(*) AS total FROM units GROUP BY book_id');
  assert.ok(rows.every((row) => Number(row.total) === 16));
});

test('rodar migrations de novo não duplica registros nem reaplica arquivos', async () => {
  const { pool } = await createTestContext();
  const again = await runMigrations(pool, { logger, lock: false });
  assert.deepEqual(again, []);
  assert.equal(await count(pool, 'books'), 4);
  assert.equal(await count(pool, 'units'), 64);
  assert.equal(await count(pool, 'schema_migrations'), 2);
});

test('o seed é idempotente mesmo executado manualmente de novo', async () => {
  const { pool } = await createTestContext();
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_seed_books_units.sql'), 'utf8');
  await pool.query(sql);
  assert.equal(await count(pool, 'books'), 4);
  assert.equal(await count(pool, 'units'), 64);
});

test('restrições do banco impedem unidades duplicadas ou fora de 1..16', async () => {
  const { pool } = await createTestContext();
  const insert = (id, book, number) =>
    pool.query('INSERT INTO units (id, book_id, number) VALUES ($1, $2, $3)', [id, book, number]);

  await assert.rejects(insert(9001, 1, 1), 'duplicada (livro, número)');
  await assert.rejects(insert(117, 1, 17), 'número 17');
  await assert.rejects(insert(100, 1, 0), 'número 0');
  await assert.rejects(insert(999, 1, 5), 'id inconsistente com livro/número');
});

test('restrições do banco: tipo de material e cor do livro', async () => {
  const { pool } = await createTestContext();
  const { rows } = await pool.query('SELECT id FROM users');
  await assert.rejects(
    pool.query('INSERT INTO study_materials (user_id, book_id, kind, url) VALUES ($1, 1, $2, $3)', [rows[0].id, 'video', 'https://x.test']),
  );
  await assert.rejects(
    pool.query("INSERT INTO books (id, slug, title, level, color, position) VALUES (9, 'x', 'X', 'A1', 'pink', 9)"),
  );
});

test('ensureAdminUser: cria, mantém e rotaciona a senha sem duplicar usuário', async () => {
  const { pool, config } = await createTestContext();
  assert.equal(await count(pool, 'users'), 1);

  await ensureAdminUser(pool, config, logger);
  assert.equal(await count(pool, 'users'), 1);

  const before = (await findByEmail(pool, TEST_EMAIL)).password_hash;
  await ensureAdminUser(pool, config, logger);
  assert.equal((await findByEmail(pool, TEST_EMAIL)).password_hash, before, 'mesma senha: hash intacto');

  await ensureAdminUser(pool, { ...config, adminPassword: 'nova-senha-bem-longa' }, logger);
  const after = (await findByEmail(pool, TEST_EMAIL)).password_hash;
  assert.ok(await bcrypt.compare('nova-senha-bem-longa', after));
  assert.ok(!(await bcrypt.compare(TEST_PASSWORD, after)));
  assert.equal(await count(pool, 'users'), 1);
});

test('ensureAdminUser: trocar ADMIN_EMAIL com um único usuário preserva os dados', async () => {
  const { pool, config } = await createTestContext();
  await ensureAdminUser(pool, { ...config, adminEmail: 'novo@example.com' }, logger);
  assert.equal(await count(pool, 'users'), 1);
  assert.ok(await findByEmail(pool, 'novo@example.com'));
});

test('loadConfig: valida variáveis obrigatórias sem expor valores', () => {
  const { loadConfig } = require('../src/config');
  assert.throws(() => loadConfig({}), /DATABASE_URL.*\n.*JWT_SECRET/s);
  assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://u:p@h/db', JWT_SECRET: 'curto' }), /JWT_SECRET/);
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'x', JWT_SECRET: 'x'.repeat(40), ADMIN_EMAIL: 'a@b.co', ADMIN_PASSWORD: 'curta' }),
    /ADMIN_PASSWORD/,
  );
  try {
    loadConfig({ DATABASE_URL: 'postgres://u:senha-secreta@h/db', JWT_SECRET: 'curto' });
  } catch (err) {
    assert.ok(!err.message.includes('senha-secreta'));
  }

  const config = loadConfig({
    DATABASE_URL: 'postgres://u:p@h/db',
    JWT_SECRET: 'x'.repeat(40),
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://bycmlla.github.io/, https://outro.example',
    PORT: '10000',
  });
  assert.equal(config.port, 10000);
  assert.deepEqual(config.corsOrigins, ['https://bycmlla.github.io', 'https://outro.example']);
  assert.deepEqual(config.databaseSsl, { rejectUnauthorized: false });
  assert.equal(testConfig().bcryptRounds, 4);
});
