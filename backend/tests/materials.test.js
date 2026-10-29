'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext, loginToken, TEST_EMAIL } = require('./helpers');

async function setup() {
  const ctx = await createTestContext();
  const token = await loginToken(ctx.agent);
  const auth = { Authorization: `Bearer ${token}` };
  const api = (token2) => {
    const a = { Authorization: `Bearer ${token2}` };
    return {
      get: (p) => ctx.agent.get(p).set(a),
      post: (p, b) => ctx.agent.post(p).set(a).send(b),
      put: (p, b) => ctx.agent.put(p).set(a).send(b),
      del: (p) => ctx.agent.delete(p).set(a),
    };
  };
  return { ...ctx, auth, ...api(token), as: api };
}

const EN = '/api/courses/english-journey';
const MK = '/api/courses/make-10-hundred';
const num = async (pool, sql) => Number((await pool.query(sql)).rows[0].n);

const cats = async (t, base = EN) => (await t.get(`${base}/materials`)).body.categories;
const catId = async (t, name, base = EN) => (await cats(t, base)).find((c) => c.name === name).id;

async function addMaterial(t, overrides = {}, base = EN) {
  const res = await t.post(`${base}/materials`, {
    categoryId: await catId(t, 'Vídeos', base),
    bookSlug: base === EN ? 'intro' : null,
    unitNumber: null,
    title: 'Material',
    url: 'https://example.com/a',
    ...overrides,
  });
  return res;
}

test('materiais: nada é cadastrado automaticamente; só as 4 categorias padrão existem', async () => {
  const t = await setup();
  const res = await t.get(`${EN}/materials`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.materials, []);
  assert.deepEqual(res.body.categories.map((c) => c.name), ['Vídeos', 'Áudios', 'Materiais complementares', 'Links úteis']);
  assert.ok(res.body.categories.every((c) => c.isDefault));
  assert.deepEqual(res.body.levels.map((l) => l.title), ['Interchange Intro', 'Interchange 1', 'Interchange 2', 'Interchange 3']);
  assert.equal(res.body.course.kind, 'english_journey');
  assert.equal(await num(t.pool, 'SELECT COUNT(*) AS n FROM course_materials'), 0);

  const mk = await t.get(`${MK}/materials`);
  assert.deepEqual(mk.body.levels, [], 'Make 10 Hundred não tem níveis');
  assert.equal(mk.body.categories.length, 4);
});

test('materiais: cadastrar, listar, editar e excluir (My English Journey)', async () => {
  const t = await setup();
  const created = await addMaterial(t, { unitNumber: 1, title: 'Welcome!', description: 'Vídeo de abertura' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const m = created.body.material;
  assert.equal(m.bookSlug, 'intro');
  assert.equal(m.unitNumber, 1);
  assert.equal(m.title, 'Welcome!');
  assert.equal(m.description, 'Vídeo de abertura');

  let list = (await t.get(`${EN}/materials`)).body.materials;
  assert.equal(list.length, 1);
  assert.equal(list[0].url, 'https://example.com/a');

  const audio = await catId(t, 'Áudios');
  const upd = await t.put(`${EN}/materials/${m.id}`, { categoryId: audio, bookSlug: 'interchange-2', unitNumber: 7, title: 'Novo nome', url: 'http://example.com/b', description: '' });
  assert.equal(upd.status, 200);
  assert.deepEqual([upd.body.material.bookSlug, upd.body.material.unitNumber, upd.body.material.categoryId, upd.body.material.title, upd.body.material.description], ['interchange-2', 7, audio, 'Novo nome', '']);

  const del = await t.del(`${EN}/materials/${m.id}`);
  assert.equal(del.status, 204);
  list = (await t.get(`${EN}/materials`)).body.materials;
  assert.deepEqual(list, []);
  assert.equal((await t.del(`${EN}/materials/${m.id}`)).status, 404);
});

test('materiais: ordenados por nível e por unidade crescente (sem unidade por último)', async () => {
  const t = await setup();
  for (const [unit, title] of [[3, 'Newcomers High School'], [1, 'Welcome!'], [null, 'Geral'], [2, 'My Passport!']]) {
    assert.equal((await addMaterial(t, { unitNumber: unit, title })).status, 201);
  }
  await addMaterial(t, { bookSlug: 'interchange-1', unitNumber: 1, title: 'Do nível 1' });
  const list = (await t.get(`${EN}/materials`)).body.materials;
  assert.deepEqual(list.map((m) => m.title), ['Welcome!', 'My Passport!', 'Newcomers High School', 'Geral', 'Do nível 1']);
});

test('materiais: validações de campos, nível, unidade e categoria', async () => {
  const t = await setup();
  const videos = await catId(t, 'Vídeos');
  const post = (body) => t.post(`${EN}/materials`, { categoryId: videos, bookSlug: 'intro', title: 'x', url: 'https://x.test', ...body });

  assert.equal((await post({ title: '   ' })).status, 400);
  assert.equal((await post({ title: 'a'.repeat(161) })).status, 400);
  assert.equal((await post({ url: '' })).status, 400);
  assert.equal((await post({ url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await post({ url: 'ftp://x.test/a' })).status, 400);
  assert.equal((await post({ url: 'nao-e-url' })).status, 400);
  assert.equal((await post({ description: 'a'.repeat(501) })).status, 400);
  assert.equal((await post({ description: 123 })).status, 400);
  assert.equal((await post({ unitNumber: 0 })).status, 400);
  assert.equal((await post({ unitNumber: 17 })).status, 400);
  assert.equal((await post({ unitNumber: '3' })).status, 400);
  assert.equal((await post({ categoryId: 'x' })).status, 400);
  assert.equal((await post({ categoryId: 99999 })).status, 400, 'categoria inexistente');
  assert.equal((await post({ bookSlug: null })).status, 400, 'inglês exige nível');
  assert.equal((await post({ bookSlug: 'nao-existe' })).status, 400);
  assert.equal((await t.post(`${EN}/materials`, 'texto')).status, 400);
  assert.equal(await num(t.pool, 'SELECT COUNT(*) AS n FROM course_materials'), 0);

  // Make 10 Hundred: sem níveis nem unidades
  const mkVideos = await catId(t, 'Vídeos', MK);
  const mk = (body) => t.post(`${MK}/materials`, { categoryId: mkVideos, bookSlug: null, title: 'Aula', url: 'https://x.test', ...body });
  assert.equal((await mk({ bookSlug: 'intro' })).status, 400);
  assert.equal((await mk({ unitNumber: 2 })).status, 400);
  const ok = await mk({});
  assert.equal(ok.status, 201);
  assert.equal(ok.body.material.bookSlug, null);
  assert.equal(ok.body.material.unitNumber, null);

  assert.equal((await t.post('/api/courses/nao-existe/materials', { categoryId: 1, title: 'x', url: 'https://x.test' })).status, 404);
});

test('materiais: cada curso tem os seus; o de um curso não aparece no outro', async () => {
  const t = await setup();
  await addMaterial(t, { title: 'Inglês' });
  await addMaterial(t, { title: 'Maquiagem' }, MK);
  assert.deepEqual((await t.get(`${EN}/materials`)).body.materials.map((m) => m.title), ['Inglês']);
  assert.deepEqual((await t.get(`${MK}/materials`)).body.materials.map((m) => m.title), ['Maquiagem']);

  const mkMaterial = (await t.get(`${MK}/materials`)).body.materials[0];
  assert.equal((await t.put(`${EN}/materials/${mkMaterial.id}`, { categoryId: await catId(t, 'Vídeos'), bookSlug: 'intro', title: 'x', url: 'https://x.test' })).status, 404, 'não edita pelo curso errado');
  assert.equal((await t.del(`${EN}/materials/${mkMaterial.id}`)).status, 404);
});

test('materiais: exclusivos do usuário autenticado (outro usuário não vê, edita nem exclui)', async () => {
  const t = await setup();
  const created = await addMaterial(t, { title: 'Meu link' });
  const id = created.body.material.id;

  await t.pool.query("INSERT INTO users (email, password_hash) VALUES ('outra@example.com', 'x')");
  const other = (await t.pool.query("SELECT id FROM users WHERE email = 'outra@example.com'")).rows[0].id;
  const jwt = require('jsonwebtoken');
  const otherToken = jwt.sign({ email: 'outra@example.com' }, t.config.jwtSecret, { subject: String(other), expiresIn: '1h' });
  const o = t.as(otherToken);

  assert.deepEqual((await o.get(`${EN}/materials`)).body.materials, []);
  const body = { categoryId: await catId(t, 'Vídeos'), bookSlug: 'intro', title: 'invasão', url: 'https://x.test' };
  assert.equal((await o.put(`${EN}/materials/${id}`, body)).status, 404);
  assert.equal((await o.del(`${EN}/materials/${id}`)).status, 404);
  assert.equal((await t.get(`${EN}/materials`)).body.materials[0].title, 'Meu link', 'intacto');

  // categorias personalizadas também são privadas
  const mine = await t.post(`${EN}/material-categories`, { name: 'Só minha' });
  assert.ok(!(await o.get(`${EN}/materials`)).body.categories.some((c) => c.name === 'Só minha'));
  assert.equal((await o.put(`${EN}/material-categories/${mine.body.category.id}`, { name: 'roubada' })).status, 404);
  assert.equal((await o.del(`${EN}/material-categories/${mine.body.category.id}`)).status, 404);
  assert.equal((await o.post(`${EN}/materials`, { ...body, categoryId: mine.body.category.id })).status, 400, 'não usa categoria alheia');
});

test('materiais: categorias personalizadas — criar, duplicada, renomear, excluir e proteção', async () => {
  const t = await setup();
  const created = await t.post(`${EN}/material-categories`, { name: '  Gramática   extra ' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.category, { id: created.body.category.id, name: 'Gramática extra', isDefault: false });

  const names = (await cats(t)).map((c) => c.name);
  assert.deepEqual(names, ['Vídeos', 'Áudios', 'Materiais complementares', 'Links úteis', 'Gramática extra']);
  assert.deepEqual((await cats(t, MK)).map((c) => c.name).includes('Gramática extra'), false, 'é por curso');

  assert.equal((await t.post(`${EN}/material-categories`, { name: 'gramática EXTRA' })).status, 409);
  assert.equal((await t.post(`${EN}/material-categories`, { name: 'vídeos' })).status, 409, 'não repete as padrão');
  assert.equal((await t.post(`${EN}/material-categories`, { name: '' })).status, 400);
  assert.equal((await t.post(`${EN}/material-categories`, { name: 'x'.repeat(61) })).status, 400);

  const id = created.body.category.id;
  assert.equal((await t.put(`${EN}/material-categories/${id}`, { name: 'Gramática' })).body.category.name, 'Gramática');
  assert.equal((await t.put(`${EN}/material-categories/${id}`, { name: 'Links úteis' })).status, 409);

  // padrão protegida
  const videos = await catId(t, 'Vídeos');
  const protectedPut = await t.put(`${EN}/material-categories/${videos}`, { name: 'Outro' });
  assert.equal(protectedPut.status, 403);
  assert.equal(protectedPut.body.error.code, 'CATEGORY_PROTECTED');
  assert.equal((await t.del(`${EN}/material-categories/${videos}`)).status, 403);

  // usada por um material: não exclui
  const m = await addMaterial(t, { categoryId: id, title: 'Na categoria nova' });
  assert.equal(m.status, 201);
  const inUse = await t.del(`${EN}/material-categories/${id}`);
  assert.equal(inUse.status, 409);
  assert.equal(inUse.body.error.code, 'CATEGORY_IN_USE');
  await t.del(`${EN}/materials/${m.body.material.id}`);
  assert.equal((await t.del(`${EN}/material-categories/${id}`)).status, 204);
  assert.equal((await cats(t)).length, 4);
  assert.equal((await t.del(`${EN}/material-categories/${id}`)).status, 404);
});

test('materiais: independentes do progresso (cadastrar não conclui nada)', async () => {
  const t = await setup();
  await addMaterial(t, { unitNumber: 1, title: 'Welcome!' });
  assert.equal(await num(t.pool, 'SELECT COUNT(*) AS n FROM unit_progress'), 0);
  assert.equal(await num(t.pool, 'SELECT COUNT(*) AS n FROM study_topic_progress'), 0);
  assert.equal((await t.get('/api/courses')).body.courses[0].progress.completed, 0);
  assert.equal((await t.get('/api/books/intro')).body.book.studentBook.completed, 0);
  // e os links antigos de cada livro (Important links) seguem separados
  assert.deepEqual((await t.get('/api/books/intro/materials')).body.materials, []);
});

test('materiais: autenticação obrigatória', async () => {
  const t = await setup();
  const id = (await addMaterial(t)).body.material.id;
  for (const [method, path] of [
    ['get', `${EN}/materials`], ['post', `${EN}/materials`], ['put', `${EN}/materials/${id}`], ['delete', `${EN}/materials/${id}`],
    ['post', `${EN}/material-categories`], ['put', `${EN}/material-categories/1`], ['delete', `${EN}/material-categories/1`],
  ]) {
    assert.equal((await t.agent[method](path)).status, 401, `${method} ${path}`);
  }
});

test('materiais: migration 007 preserva dados existentes e não cadastra materiais', async () => {
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
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f < '007')) {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, file), path.join(oldDir, file));
  }
  await runMigrations(pool, { dir: oldDir, logger, lock: false });
  await pool.query("INSERT INTO users (email, password_hash) VALUES ('a@b.co', 'x')");
  await pool.query("INSERT INTO unit_progress (user_id, unit_id, book_type, completed, completed_at, updated_at) VALUES (1, 101, 'student_book', true, now(), now())");
  await pool.query("INSERT INTO study_materials (user_id, book_id, kind, url) VALUES (1, 1, 'student_book', 'https://velho.test')");
  await pool.query('INSERT INTO study_topic_progress (user_id, topic_id, completed, completed_at, updated_at) VALUES (1, 10101, true, now(), now())');

  assert.deepEqual(await runMigrations(pool, { logger, lock: false }), ['007_course_materials.sql']);
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM unit_progress'), 1);
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM study_materials'), 1);
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM study_topic_progress'), 1);
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM course_materials'), 0, 'nenhum link fictício');
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM material_categories'), 4);
  assert.deepEqual(await runMigrations(pool, { logger, lock: false }), []);
  assert.equal(await num(pool, 'SELECT COUNT(*) AS n FROM material_categories'), 4);
});

test('materiais: restrições do banco (unidade exige nível; unidade 1..16)', async () => {
  const t = await setup();
  const userId = (await t.pool.query('SELECT id FROM users')).rows[0].id;
  const insert = (book, unit) =>
    t.pool.query('INSERT INTO course_materials (user_id, course_id, book_id, unit_number, category_id, title, url) VALUES ($1, 1, $2, $3, 1, $4, $5)', [userId, book, unit, 't', 'https://x.test']);
  await assert.rejects(insert(null, 3), 'unidade sem nível');
  await assert.rejects(insert(1, 17), 'unidade 17');
  await insert(1, 16);
  await insert(null, null);
  assert.equal(TEST_EMAIL.length > 0, true);
});
