'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { newDb, DataType } = require('pg-mem');
const { runMigrations, MIGRATIONS_DIR } = require('../src/db/migrate');
const { createLogger } = require('../src/logger');

const logger = createLogger({ silent: true });

test('migration 003: preserva o progresso existente como Student\'s Book e libera o Workbook', async () => {
  const memory = newDb();
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (s) => s.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();

  // 1) Banco "antigo": só as migrations 001 e 002, com progresso já gravado.
  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mej-migrations-'));
  for (const file of ['001_init.sql', '002_seed_books_units.sql']) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(oldDir, file));
  }
  await runMigrations(pool, { dir: oldDir, logger, lock: false });
  await pool.query("INSERT INTO users (email, password_hash) VALUES ('a@b.co', 'x')");
  await pool.query(`INSERT INTO unit_progress (user_id, unit_id, completed, completed_at, updated_at)
                    VALUES (1, 101, true, now(), now()), (1, 102, true, now(), now()), (1, 205, false, NULL, now())`);

  // 2) Atualiza com todas as migrations.
  const applied = await runMigrations(pool, { logger, lock: false });
  assert.deepEqual(applied, ['003_workbook_progress.sql', '004_study_contents.sql', '005_seed_study_contents.sql', '006_courses.sql', '007_course_materials.sql']);

  const { rows } = await pool.query('SELECT unit_id, completed, book_type FROM unit_progress ORDER BY unit_id');
  assert.equal(rows.length, 3, 'nenhuma linha perdida');
  assert.ok(rows.every((row) => row.book_type === 'student_book'), 'dados antigos viram student_book');
  assert.deepEqual(rows.map((r) => [r.unit_id, r.completed]), [[101, true], [102, true], [205, false]]);

  // 3) Agora a mesma unidade aceita um registro de workbook, mas não duplicados nem tipos inválidos.
  await pool.query("INSERT INTO unit_progress (user_id, unit_id, completed, book_type) VALUES (1, 101, true, 'workbook')");
  await assert.rejects(pool.query("INSERT INTO unit_progress (user_id, unit_id, completed, book_type) VALUES (1, 101, true, 'workbook')"));
  await assert.rejects(pool.query("INSERT INTO unit_progress (user_id, unit_id, completed, book_type) VALUES (1, 103, true, 'audio')"));
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM unit_progress')).rows[0].n, 4);
});
