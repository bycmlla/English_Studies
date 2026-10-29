'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext, loginToken } = require('./helpers');

const SLUGS = ['intro', 'interchange-1', 'interchange-2', 'interchange-3'];

async function setup() {
  const ctx = await createTestContext();
  const token = await loginToken(ctx.agent);
  const auth = { Authorization: `Bearer ${token}` };
  return {
    ...ctx,
    get: (path) => ctx.agent.get(path).set(auth),
    put: (path, body) => ctx.agent.put(path).set(auth).send(body),
    post: (path, body) => ctx.agent.post(path).set(auth).send(body),
  };
}

const study = async (t) => (await t.get('/api/study')).body;
const unitOf = (data, slug, number) => data.books.find((b) => b.slug === slug).units.find((u) => u.number === number);
const toggleTopic = (t, id, completed) => t.put(`/api/study/topics/${id}`, { completed });

test('estudo: os 4 níveis trazem 16 unidades com título e assuntos, todos pendentes', async () => {
  const t = await setup();
  const res = await t.get('/api/study');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.books.map((b) => b.slug), SLUGS);
  assert.deepEqual(res.body.books.map((b) => b.color), ['yellow', 'red', 'blue', 'green']);

  let total = 0;
  for (const book of res.body.books) {
    assert.equal(book.units.length, 16, book.slug);
    assert.deepEqual(book.units.map((u) => u.number), Array.from({ length: 16 }, (_, i) => i + 1));
    for (const unit of book.units) {
      assert.ok(unit.title, `${book.slug} unit ${unit.number} sem título`);
      assert.ok(unit.topics.length >= 6, `${book.slug} unit ${unit.number} com poucos assuntos`);
      assert.equal(unit.progress.total, unit.topics.length);
      assert.equal(unit.progress.completed, 0);
      for (const category of ['grammar', 'vocabulary', 'communication']) {
        assert.ok(unit.topics.some((topic) => topic.category === category), `${book.slug} u${unit.number} sem ${category}`);
      }
      assert.ok(unit.topics.every((topic) => topic.completed === false && topic.title.trim() !== ''));
    }
    total += book.progress.total;
  }
  assert.equal(res.body.progress.total, total);
  assert.equal(res.body.progress.percent, 0);
  assert.equal(total, 678);
});

test('estudo: títulos e numeração batem com a lista fornecida', async () => {
  const t = await setup();
  const data = await study(t);
  const titles = (slug) => data.books.find((b) => b.slug === slug).units.map((u) => u.title);

  assert.equal(titles('intro')[0], "What's your name?");
  assert.equal(titles('intro')[1], 'Where are my keys?');
  assert.equal(titles('intro')[15], 'Can I take a message?');
  assert.equal(titles('interchange-1')[0], 'Where are you from?');
  assert.equal(titles('interchange-1')[15], 'How have you changed?');
  assert.equal(titles('interchange-2')[0], 'Good memories');
  assert.equal(titles('interchange-2')[15], 'Making excuses');
  assert.equal(titles('interchange-3')[0], "That's my kind of friend!");
  assert.equal(titles('interchange-3')[15], 'Reaching your goals');

  const u1 = unitOf(data, 'intro', 1).topics.map((topic) => topic.title);
  assert.ok(u1.includes('Verbo to be — afirmativo'));
  assert.ok(u1.includes('Soletrar palavras'));
  const u2 = unitOf(data, 'intro', 2).topics.map((topic) => topic.title);
  assert.ok(u2.includes('Preposições de lugar'));
});

test('estudo: não há assuntos de Listening/Reading/Writing/Pronunciation inventados', async () => {
  const t = await setup();
  const { rows } = await t.pool.query("SELECT COUNT(*) AS n FROM study_topics WHERE category NOT IN ('grammar','vocabulary','communication')");
  assert.equal(Number(rows[0].n), 0);
});

test('estudo: marcar salva, persiste e calcula unidade, nível e total (8 de 10 = 80%)', async () => {
  const t = await setup();
  const unit = unitOf(await study(t), 'intro', 1);
  const ids = unit.topics.map((topic) => topic.id);
  assert.equal(ids.length, 15);

  const first = await toggleTopic(t, ids[0], true);
  assert.equal(first.status, 200);
  assert.equal(first.body.topic.completed, true);
  assert.deepEqual(first.body.progress.unit, { completed: 1, total: 15, percent: 6.67 });
  assert.equal(first.body.progress.book.completed, 1);
  assert.equal(first.body.progress.overall.total, 678);

  // "Recarregar a página" = nova leitura da API.
  let data = await study(t);
  assert.equal(unitOf(data, 'intro', 1).topics[0].completed, true);
  assert.equal(unitOf(data, 'intro', 1).progress.completed, 1);
  assert.equal(data.books[0].progress.completed, 1);
  assert.equal(data.progress.completed, 1);
  assert.ok(data.lastActivityAt);

  for (const id of ids.slice(1, 8)) await toggleTopic(t, id, true);
  data = await study(t);
  assert.equal(unitOf(data, 'intro', 1).progress.completed, 8);
  assert.equal(unitOf(data, 'intro', 1).progress.percent, 53.33);

  // Desmarcar.
  const off = await toggleTopic(t, ids[0], false);
  assert.equal(off.body.topic.completed, false);
  assert.equal(off.body.progress.unit.completed, 7);
  data = await study(t);
  assert.equal(unitOf(data, 'intro', 1).topics[0].completed, false);
  assert.equal(data.progress.completed, 7);
});

test('estudo: porcentagem exata — 8 de 10 assuntos = 80%, tudo marcado = 100%', async () => {
  const t = await setup();
  const { summarizeTopics } = require('../src/services/study');
  assert.deepEqual(summarizeTopics(8, 10), { completed: 8, total: 10, percent: 80 });
  assert.deepEqual(summarizeTopics(0, 0), { completed: 0, total: 0, percent: 0 });

  const data = await study(t);
  for (const topic of unitOf(data, 'interchange-3', 16).topics) await toggleTopic(t, topic.id, true);
  const after = await study(t);
  assert.equal(unitOf(after, 'interchange-3', 16).progress.percent, 100);
  assert.equal(unitOf(after, 'interchange-3', 15).progress.percent, 0);
  assert.equal(after.books[3].progress.completed, unitOf(after, 'interchange-3', 16).topics.length);
  assert.equal(after.books[0].progress.completed, 0, 'outros níveis não mudam');
});

test('estudo: marcar é idempotente e não duplica linhas', async () => {
  const t = await setup();
  const id = unitOf(await study(t), 'intro', 3).topics[0].id;
  await toggleTopic(t, id, true);
  await toggleTopic(t, id, true);
  assert.equal(Number((await t.pool.query('SELECT COUNT(*) AS n FROM study_topic_progress')).rows[0].n), 1);
  await toggleTopic(t, id, false);
  await toggleTopic(t, id, false);
  assert.equal(Number((await t.pool.query('SELECT COUNT(*) AS n FROM study_topic_progress')).rows[0].n), 1);
  assert.equal((await study(t)).progress.completed, 0);
});

test('estudo: independente do Student\'s Book / Workbook nos dois sentidos', async () => {
  const t = await setup();
  const before = (await t.get('/api/books')).body.books;

  // Estudar todos os assuntos de uma unidade não conclui a unidade do livro.
  for (const topic of unitOf(await study(t), 'intro', 1).topics) await toggleTopic(t, topic.id, true);
  const afterStudy = (await t.get('/api/books')).body.books;
  assert.deepEqual(afterStudy, before);
  assert.equal(Number((await t.pool.query('SELECT COUNT(*) AS n FROM unit_progress')).rows[0].n), 0);

  // Concluir unidades dos livros não marca assuntos.
  const snapshot = (await study(t)).progress;
  for (const bookType of ['student_book', 'workbook']) {
    const res = await t.put('/api/books/interchange-1/units/4', { completed: true, bookType });
    assert.equal(res.status, 200);
  }
  const data = await study(t);
  assert.deepEqual(data.progress, snapshot);
  assert.equal(unitOf(data, 'interchange-1', 4).progress.completed, 0);
  assert.equal((await t.get('/api/books/interchange-1')).body.book.fullyCompletedUnits, 1);
});

test('estudo: cada usuário vê só o próprio progresso', async () => {
  const t = await setup();
  const id = unitOf(await study(t), 'intro', 1).topics[0].id;
  await toggleTopic(t, id, true);

  await t.pool.query("INSERT INTO users (email, password_hash) VALUES ('outra@example.com', 'x')");
  const { rows } = await t.pool.query("SELECT id FROM users WHERE email = 'outra@example.com'");
  const { listStudyContents } = require('../src/services/study');
  const other = await listStudyContents(t.pool, rows[0].id);
  assert.equal(other.progress.completed, 0);
  assert.equal((await study(t)).progress.completed, 1);
});

test('estudo: validações e autenticação', async () => {
  const t = await setup();
  assert.equal((await t.agent.get('/api/study')).status, 401);
  assert.equal((await t.agent.put('/api/study/topics/10101').send({ completed: true })).status, 401);

  assert.equal((await t.put('/api/study/topics/10101', {})).status, 400);
  assert.equal((await t.put('/api/study/topics/10101', { completed: 'sim' })).status, 400);
  assert.equal((await t.put('/api/study/topics/abc', { completed: true })).status, 400);
  assert.equal((await t.put('/api/study/topics/-1', { completed: true })).status, 400);

  const missing = await t.put('/api/study/topics/99999', { completed: true });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'TOPIC_NOT_FOUND');
  assert.equal(Number((await t.pool.query('SELECT COUNT(*) AS n FROM study_topic_progress')).rows[0].n), 0);
});

test('estudo: rodar a migration de novo não duplica nem apaga progresso', async () => {
  const t = await setup();
  const id = unitOf(await study(t), 'intro', 1).topics[0].id;
  await toggleTopic(t, id, true);

  const fs = require('node:fs');
  const path = require('node:path');
  const seed = fs.readFileSync(path.join(__dirname, '..', 'migrations', '005_seed_study_contents.sql'), 'utf8');
  await t.pool.query(seed);

  assert.equal(Number((await t.pool.query('SELECT COUNT(*) AS n FROM study_topics')).rows[0].n), 678);
  assert.equal((await study(t)).progress.completed, 1);
});

test('estudo: migration 004/005 sobre banco com progresso de livros preserva tudo', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { newDb, DataType } = require('pg-mem');
  const { runMigrations, MIGRATIONS_DIR } = require('../src/db/migrate');
  const { createLogger } = require('../src/logger');

  const memory = newDb();
  memory.public.registerFunction({ name: 'char_length', args: [DataType.text], returns: DataType.integer, implementation: (s) => s.length });
  const { Pool } = memory.adapters.createPg();
  const pool = new Pool();
  const logger = createLogger({ silent: true });

  const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mej-migrations-'));
  for (const file of ['001_init.sql', '002_seed_books_units.sql', '003_workbook_progress.sql']) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(oldDir, file));
  }
  await runMigrations(pool, { dir: oldDir, logger, lock: false });
  await pool.query("INSERT INTO users (email, password_hash) VALUES ('a@b.co', 'x')");
  await pool.query(`INSERT INTO unit_progress (user_id, unit_id, book_type, completed, completed_at, updated_at)
                    VALUES (1, 101, 'student_book', true, now(), now()), (1, 101, 'workbook', true, now(), now()), (1, 305, 'student_book', true, now(), now())`);
  await pool.query("INSERT INTO study_materials (user_id, book_id, kind, url) VALUES (1, 1, 'student_book', 'https://x.test')");
  await pool.query("INSERT INTO book_notes (user_id, book_id, content) VALUES (1, 2, 'minhas notas')");

  const applied = await runMigrations(pool, { logger, lock: false });
  assert.deepEqual(applied, ['004_study_contents.sql', '005_seed_study_contents.sql', '006_courses.sql', '007_course_materials.sql']);

  const { rows } = await pool.query('SELECT unit_id, book_type, completed FROM unit_progress ORDER BY unit_id, book_type');
  assert.deepEqual(rows.map((r) => [r.unit_id, r.book_type, r.completed]), [[101, 'student_book', true], [101, 'workbook', true], [305, 'student_book', true]]);
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM study_materials')).rows[0].n), 1);
  assert.equal((await pool.query('SELECT content FROM book_notes')).rows[0].content, 'minhas notas');
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM study_topic_progress')).rows[0].n), 0);
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM units')).rows[0].n), 64);
});

test('backup: exporta e importa o progresso de estudo; backups sem studyTopics não o alteram', async () => {
  const source = await setup();
  const data = await study(source);
  const picked = [unitOf(data, 'intro', 1).topics[0].id, unitOf(data, 'intro', 2).topics[3].id, unitOf(data, 'interchange-3', 9).topics[1].id];
  for (const id of picked) await toggleTopic(source, id, true);

  const exported = (await source.get('/api/backup/export')).body;
  assert.deepEqual(exported.books[0].studyTopics, picked.slice(0, 2));
  assert.deepEqual(exported.books[3].studyTopics, [picked[2]]);
  assert.deepEqual(exported.books[1].studyTopics, []);

  const target = await setup();
  const dry = await target.post('/api/backup/import?dryRun=true', exported);
  assert.equal(dry.status, 200);
  assert.equal(dry.body.summary.studyTopics, 3);
  assert.equal((await study(target)).progress.completed, 0, 'dryRun não grava');

  const imported = await target.post('/api/backup/import', exported);
  assert.equal(imported.status, 200);
  const after = await study(target);
  assert.equal(after.progress.completed, 3);
  assert.equal(unitOf(after, 'intro', 2).topics[3].completed, true);

  // Backup antigo (sem studyTopics) não mexe no progresso de estudo.
  const old = { app: 'my-english-journey', version: 2, books: [{ slug: 'intro', completedUnits: [1] }] };
  assert.equal((await target.post('/api/backup/import', old)).status, 200);
  assert.equal((await study(target)).progress.completed, 3);

  // Com studyTopics vazio para o livro, o progresso desse livro é substituído.
  const clear = { app: 'my-english-journey', version: 2, books: [{ slug: 'intro', studyTopics: [] }] };
  assert.equal((await target.post('/api/backup/import', clear)).status, 200);
  const cleared = await study(target);
  assert.equal(cleared.books[0].progress.completed, 0);
  assert.equal(cleared.books[3].progress.completed, 1, 'outros níveis intactos');
});

test('backup: rejeita assuntos inexistentes ou de outro nível', async () => {
  const t = await setup();
  const wrongBook = { app: 'my-english-journey', version: 2, books: [{ slug: 'intro', studyTopics: [20101] }] };
  const res = await t.post('/api/backup/import', wrongBook);
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_BACKUP');

  const bad = { app: 'my-english-journey', version: 2, books: [{ slug: 'intro', studyTopics: ['x'] }] };
  assert.equal((await t.post('/api/backup/import', bad)).status, 400);
  const dup = { app: 'my-english-journey', version: 2, books: [{ slug: 'intro', studyTopics: [10101, 10101] }] };
  assert.equal((await t.post('/api/backup/import', dup)).status, 400);
  assert.equal((await study(t)).progress.completed, 0);
});
