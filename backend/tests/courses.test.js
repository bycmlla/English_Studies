'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext, loginToken } = require('./helpers');

async function setup() {
  const ctx = await createTestContext();
  const token = await loginToken(ctx.agent);
  const auth = { Authorization: `Bearer ${token}` };
  return {
    ...ctx,
    get: (path) => ctx.agent.get(path).set(auth),
    put: (path, body) => ctx.agent.put(path).set(auth).send(body),
  };
}

const num = async (pool, sql) => Number((await pool.query(sql)).rows[0].n);

/** Cadastra um módulo com aulas para o curso de maquiagem (o conteúdo real ainda não foi fornecido). */
async function seedLessons(pool, count = 4) {
  await pool.query("INSERT INTO course_modules (course_id, position, title) VALUES (2, 1, 'Módulo de teste')");
  const { rows } = await pool.query('SELECT id FROM course_modules');
  const moduleId = rows[0].id;
  for (let i = 1; i <= count; i += 1) {
    await pool.query('INSERT INTO course_lessons (module_id, position, title) VALUES ($1, $2, $3)', [moduleId, i, `Aula ${i}`]);
  }
  return (await pool.query('SELECT id FROM course_lessons ORDER BY position')).rows.map((row) => row.id);
}

test('cursos: Meus Estudos lista os dois cursos, sem percentuais fixos', async () => {
  const t = await setup();
  const res = await t.get('/api/courses');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.courses.map((c) => c.slug), ['english-journey', 'make-10-hundred']);
  assert.deepEqual(res.body.courses.map((c) => c.title), ['My English Journey', 'Make 10 Hundred']);
  assert.equal(res.body.courses[0].description, 'Estudo de Inglês com os livros Cambridge');
  assert.equal(res.body.courses[1].description, 'Curso de Maquiagem Profissional');
  for (const course of res.body.courses) {
    assert.equal(course.progress.percent, 0, `${course.slug} deve começar em 0%`);
    assert.equal(course.progress.status, 'not_started');
  }
  assert.equal(res.body.courses[0].progress.total, 128);
  assert.equal(res.body.courses[1].progress.total, 0, 'sem aulas cadastradas');
});

test('cursos: o progresso do My English Journey segue a lógica dos livros', async () => {
  const t = await setup();
  for (const bookType of ['student_book', 'workbook']) {
    await t.put('/api/books/intro/units/1', { completed: true, bookType });
  }
  await t.put('/api/books/interchange-2/units/5', { completed: true, bookType: 'student_book' });

  const { courses } = (await t.get('/api/courses')).body;
  const overview = (await t.get('/api/progress/overview')).body.overview;
  assert.equal(courses[0].progress.completed, 3);
  assert.equal(courses[0].progress.percent, overview.percent);
  assert.equal(courses[0].progress.percent, 2.34);
  assert.equal(courses[0].progress.status, 'studying');
  assert.equal(courses[1].progress.percent, 0, 'o outro curso não é afetado');
});

test('cursos: Conteúdos de Estudo não alteram o progresso do curso de inglês', async () => {
  const t = await setup();
  await t.put('/api/study/topics/10101', { completed: true });
  assert.equal((await t.get('/api/courses')).body.courses[0].progress.completed, 0);
});

test('cursos: Make 10 Hundred sem aulas fica em 0% / não iniciado e com estrutura pronta', async () => {
  const t = await setup();
  const res = await t.get('/api/courses/make-10-hundred');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.course.modules, []);
  assert.deepEqual(res.body.course.progress, { completed: 0, total: 0, percent: 0, status: 'not_started' });
  assert.equal(await num(t.pool, 'SELECT COUNT(*) AS n FROM course_modules'), 0, 'nenhum módulo inventado');
  assert.equal(await num(t.pool, 'SELECT COUNT(*) AS n FROM course_lessons'), 0, 'nenhuma aula inventada');
});

test('cursos: marcar aulas calcula o percentual real e persiste', async () => {
  const t = await setup();
  const ids = await seedLessons(t.pool, 4);

  let course = (await t.get('/api/courses/make-10-hundred')).body.course;
  assert.equal(course.modules.length, 1);
  assert.equal(course.modules[0].lessons.length, 4);
  assert.equal(course.progress.total, 4);

  const first = await t.put(`/api/courses/make-10-hundred/lessons/${ids[0]}`, { completed: true });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.progress, { completed: 1, total: 4, percent: 25, status: 'studying' });

  await t.put(`/api/courses/make-10-hundred/lessons/${ids[1]}`, { completed: true });
  const list = (await t.get('/api/courses')).body.courses;
  assert.equal(list[1].progress.percent, 50);
  assert.equal(list[0].progress.percent, 0, 'inglês independente');

  course = (await t.get('/api/courses/make-10-hundred')).body.course;
  assert.deepEqual(course.modules[0].lessons.map((l) => l.completed), [true, true, false, false]);
  assert.equal(course.modules[0].progress.percent, 50);

  const off = await t.put(`/api/courses/make-10-hundred/lessons/${ids[0]}`, { completed: false });
  assert.equal(off.body.progress.percent, 25);
  for (const id of ids) await t.put(`/api/courses/make-10-hundred/lessons/${id}`, { completed: true });
  assert.equal((await t.get('/api/courses')).body.courses[1].progress.status, 'completed');
});

test('cursos: cada usuário vê só o próprio progresso', async () => {
  const t = await setup();
  const ids = await seedLessons(t.pool, 2);
  await t.put(`/api/courses/make-10-hundred/lessons/${ids[0]}`, { completed: true });

  await t.pool.query("INSERT INTO users (email, password_hash) VALUES ('outra@example.com', 'x')");
  const other = (await t.pool.query("SELECT id FROM users WHERE email = 'outra@example.com'")).rows[0].id;
  const { listCourses } = require('../src/services/courses');
  const theirs = await listCourses(t.pool, other);
  assert.equal(theirs[1].progress.completed, 0);
  assert.equal((await t.get('/api/courses')).body.courses[1].progress.completed, 1);
});

test('cursos: validações, 404 e autenticação', async () => {
  const t = await setup();
  const ids = await seedLessons(t.pool, 1);
  assert.equal((await t.agent.get('/api/courses')).status, 401);
  assert.equal((await t.agent.get('/api/courses/make-10-hundred')).status, 401);
  assert.equal((await t.agent.put(`/api/courses/make-10-hundred/lessons/${ids[0]}`).send({ completed: true })).status, 401);

  const missing = await t.get('/api/courses/nao-existe');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'COURSE_NOT_FOUND');

  assert.equal((await t.put(`/api/courses/make-10-hundred/lessons/${ids[0]}`, {})).status, 400);
  assert.equal((await t.put('/api/courses/make-10-hundred/lessons/abc', { completed: true })).status, 400);
  const noLesson = await t.put('/api/courses/make-10-hundred/lessons/9999', { completed: true });
  assert.equal(noLesson.status, 404);
  assert.equal(noLesson.body.error.code, 'LESSON_NOT_FOUND');
  // aula existente, mas de outro curso (o de inglês não tem aulas)
  assert.equal((await t.put(`/api/courses/english-journey/lessons/${ids[0]}`, { completed: true })).status, 404);
  assert.equal(await num(t.pool, 'SELECT COUNT(*) AS n FROM course_lesson_progress'), 0);
});

test('cursos: migration 006 preserva todos os dados existentes', async () => {
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
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f < '006')) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(oldDir, file));
  }
  await runMigrations(pool, { dir: oldDir, logger, lock: false });
  await pool.query("INSERT INTO users (email, password_hash) VALUES ('a@b.co', 'x')");
  await pool.query("INSERT INTO unit_progress (user_id, unit_id, book_type, completed, completed_at, updated_at) VALUES (1, 101, 'student_book', true, now(), now())");
  await pool.query('INSERT INTO study_topic_progress (user_id, topic_id, completed, completed_at, updated_at) VALUES (1, 10101, true, now(), now())');

  assert.deepEqual(await runMigrations(pool, { logger, lock: false }), ['006_courses.sql', '007_course_materials.sql']);
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM unit_progress'), 1);
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM study_topic_progress'), 1);
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM courses'), 2);
  assert.deepEqual(await runMigrations(pool, { logger, lock: false }), [], 'rodar de novo não reaplica');
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM courses'), 2);
});
