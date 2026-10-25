'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createTestContext, loginToken, TEST_EMAIL, TEST_PASSWORD } = require('./helpers');

const SLUGS = ['intro', 'interchange-1', 'interchange-2', 'interchange-3'];

async function setup(overrides) {
  const ctx = await createTestContext(overrides);
  const token = await loginToken(ctx.agent);
  const auth = { Authorization: `Bearer ${token}` };
  const get = (path) => ctx.agent.get(path).set(auth);
  const put = (path, body) => ctx.agent.put(path).set(auth).send(body);
  const post = (path, body) => ctx.agent.post(path).set(auth).send(body);
  const del = (path) => ctx.agent.delete(path).set(auth);
  return { ...ctx, token, auth, get, put, post, del };
}

async function toggle(t, slug, number, completed = true) {
  const res = await t.put(`/api/books/${slug}/units/${number}`, { completed });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

// ---------- saúde e erros gerais ----------

test('GET /health responde 200 sem autenticação', async () => {
  const { agent } = await createTestContext();
  const res = await agent.get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.database, 'up');
});

test('GET /health responde 503 quando o banco está indisponível', async () => {
  const ctx = await createTestContext();
  ctx.pool.query = async () => {
    throw new Error('connection refused');
  };
  const res = await ctx.agent.get('/health');
  assert.equal(res.status, 503);
  assert.equal(res.body.status, 'degraded');
});

test('rota inexistente devolve 404 em JSON (e /api exige login antes de revelar rotas)', async () => {
  const t = await setup();
  const outside = await t.agent.get('/nao-existe');
  assert.equal(outside.status, 404);
  assert.equal(outside.body.error.code, 'ROUTE_NOT_FOUND');

  assert.equal((await t.agent.get('/api/nao-existe')).status, 401);
  const authed = await t.get('/api/nao-existe');
  assert.equal(authed.status, 404);
  assert.equal(authed.body.error.code, 'ROUTE_NOT_FOUND');
});

test('JSON malformado devolve 400 INVALID_JSON', async () => {
  const { agent } = await createTestContext();
  const res = await agent.post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_JSON');
});

test('erro interno não vaza detalhes ao cliente', async () => {
  const t = await setup();
  t.pool.query = async () => {
    throw new Error('password=super-secret host=db.internal');
  };
  const res = await t.get('/api/books');
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.ok(!JSON.stringify(res.body).includes('super-secret'));
});

// ---------- autenticação ----------

test('login com credenciais corretas devolve token com expiração', async () => {
  const { agent } = await createTestContext();
  const res = await agent.post('/api/auth/login').send({ email: ` ${TEST_EMAIL.toUpperCase()} `, password: TEST_PASSWORD });
  assert.equal(res.status, 200);
  assert.ok(res.body.token.split('.').length === 3);
  assert.equal(res.body.tokenType, 'Bearer');
  assert.ok(new Date(res.body.expiresAt) > new Date());
  assert.ok(!JSON.stringify(res.body).includes('password'));
});

test('login com senha errada ou e-mail inexistente devolve a mesma resposta 401', async () => {
  const { agent } = await createTestContext();
  const wrongPassword = await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: 'errada-errada' });
  const unknownUser = await agent.post('/api/auth/login').send({ email: 'ninguem@example.com', password: 'qualquer-coisa' });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(wrongPassword.body, unknownUser.body);
  assert.equal(wrongPassword.body.error.code, 'INVALID_CREDENTIALS');
});

test('login valida o formato dos campos (400)', async () => {
  const { agent } = await createTestContext();
  for (const body of [{}, { email: 'sem-arroba', password: 'x' }, { email: TEST_EMAIL }, { email: TEST_EMAIL, password: 123 }]) {
    const res = await agent.post('/api/auth/login').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('login aplica limite de tentativas falhas (429) por IP', async () => {
  const { agent } = await createTestContext({ loginMaxAttempts: 3 });
  const attempt = () => agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: 'senha-errada-1' });
  for (let i = 0; i < 3; i += 1) assert.equal((await attempt()).status, 401);
  const blocked = await attempt();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'TOO_MANY_ATTEMPTS');
  // Mesmo com a senha certa, o bloqueio vale até a janela terminar.
  const correct = await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
  assert.equal(correct.status, 429);
});

test('logins bem-sucedidos não consomem o limite de tentativas', async () => {
  const { agent } = await createTestContext({ loginMaxAttempts: 2 });
  for (let i = 0; i < 5; i += 1) {
    const res = await agent.post('/api/auth/login').send({ email: TEST_EMAIL, password: TEST_PASSWORD });
    assert.equal(res.status, 200);
  }
});

test('endpoints privados exigem token válido', async () => {
  const { agent, config } = await createTestContext();
  const jwt = require('jsonwebtoken');
  const expired = jwt.sign({ email: TEST_EMAIL }, config.jwtSecret, { subject: '1', expiresIn: -10 });
  const forged = jwt.sign({ email: TEST_EMAIL }, 'outro-segredo-outro-segredo-outro-1234', { subject: '1' });
  const none = jwt.sign({ email: TEST_EMAIL }, '', { algorithm: 'none', subject: '1' });

  const privatePaths = [
    ['get', '/api/books'],
    ['get', '/api/books/intro'],
    ['get', '/api/books/intro/units'],
    ['put', '/api/books/intro/units/1'],
    ['get', '/api/books/intro/materials'],
    ['post', '/api/books/intro/materials'],
    ['get', '/api/books/intro/notes'],
    ['put', '/api/books/intro/notes'],
    ['get', '/api/progress/overview'],
    ['get', '/api/backup/export'],
    ['post', '/api/backup/import'],
    ['get', '/api/auth/me'],
  ];

  for (const [method, path] of privatePaths) {
    const res = await agent[method](path);
    assert.equal(res.status, 401, `${method} ${path} sem token`);
    assert.equal(res.body.error.code, 'AUTH_REQUIRED');
  }

  const tokens = { expired, forged, none, garbage: 'abc.def.ghi' };
  for (const [name, token] of Object.entries(tokens)) {
    const res = await agent.get('/api/books').set('Authorization', `Bearer ${token}`);
    assert.equal(res.status, 401, name);
  }
  const res = await agent.get('/api/books').set('Authorization', `Bearer ${expired}`);
  assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
});

test('GET /api/auth/me devolve o e-mail do usuário autenticado', async () => {
  const t = await setup();
  const res = await t.get('/api/auth/me');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { user: { email: TEST_EMAIL } });
});

// ---------- livros e progresso ----------

test('GET /api/books lista os 4 livros com 16 unidades e progresso zerado', async () => {
  const t = await setup();
  const res = await t.get('/api/books');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.books.map((b) => b.slug), SLUGS);
  assert.deepEqual(res.body.books.map((b) => b.level), ['A1', 'A2', 'A2/B1', 'B1']);
  assert.deepEqual(res.body.books.map((b) => b.color), ['yellow', 'red', 'blue', 'green']);
  for (const book of res.body.books) {
    assert.equal(book.totalUnits, 16);
    assert.equal(book.completedUnits, 0);
    assert.equal(book.percent, 0);
    assert.equal(book.status, 'not_started');
  }
});

test('marcar unidades recalcula porcentagem e status em cada um dos 4 livros', async () => {
  const t = await setup();
  const steps = [
    [1, 6.25, 'studying'],
    [4, 25, 'studying'],
    [8, 50, 'studying'],
    [12, 75, 'studying'],
    [16, 100, 'completed'],
  ];

  for (const slug of SLUGS) {
    let done = 0;
    for (const [target, percent, status] of steps) {
      while (done < target) {
        done += 1;
        await toggle(t, slug, done);
      }
      const { body } = await t.get(`/api/books/${slug}`);
      assert.equal(body.book.completedUnits, target, `${slug} ${target}`);
      assert.equal(body.book.percent, percent, `${slug} ${target}`);
      assert.equal(body.book.status, status, `${slug} ${target}`);
    }
  }

  const overview = (await t.get('/api/progress/overview')).body.overview;
  assert.equal(overview.totalUnits, 64);
  assert.equal(overview.completedUnits, 64);
  assert.equal(overview.percent, 100);
  assert.equal(overview.currentBook, null);
});

test('marcar e desmarcar uma unidade; a resposta já traz o progresso atualizado', async () => {
  const t = await setup();

  const checked = await toggle(t, 'intro', 1, true);
  assert.equal(checked.unit.completed, true);
  assert.equal(checked.book.completedUnits, 1);
  assert.equal(checked.book.percent, 6.25);
  assert.deepEqual(checked.book.completedUnitNumbers, [1]);

  const unchecked = await toggle(t, 'intro', 1, false);
  assert.equal(unchecked.unit.completed, false);
  assert.equal(unchecked.book.completedUnits, 0);
  assert.equal(unchecked.book.status, 'not_started');
});

test('marcar a mesma unidade duas vezes é idempotente (sem duplicar registros)', async () => {
  const t = await setup();
  await toggle(t, 'intro', 3);
  await toggle(t, 'intro', 3);
  const { rows } = await t.pool.query('SELECT COUNT(*) AS total FROM unit_progress');
  assert.equal(Number(rows[0].total), 1);
  assert.equal((await t.get('/api/books/intro')).body.book.completedUnits, 1);
});

test('persistência: o progresso vem do banco, inclusive após novo login', async () => {
  const t = await setup();
  await toggle(t, 'interchange-2', 5);
  await toggle(t, 'interchange-2', 9);

  const { rows } = await t.pool.query(
    'SELECT u.number FROM unit_progress up JOIN units u ON u.id = up.unit_id WHERE up.completed = true ORDER BY u.number',
  );
  assert.deepEqual(rows.map((r) => r.number), [5, 9]);

  // "Outro dispositivo": novo login, novo token.
  const otherToken = await loginToken(t.agent);
  const res = await t.agent.get('/api/books/interchange-2/units').set('Authorization', `Bearer ${otherToken}`);
  const doneNumbers = res.body.units.filter((u) => u.completed).map((u) => u.number);
  assert.deepEqual(doneNumbers, [5, 9]);
  assert.equal(res.body.units.length, 16);
  assert.equal(res.body.units[0].label, 'Unit 01');
  assert.equal(res.body.units[15].label, 'Unit 16');
});

test('unidade fora de 1..16 ou inválida devolve 400; livro inexistente devolve 404', async () => {
  const t = await setup();
  for (const n of ['0', '17', '-1', '1.5', 'abc', '01x']) {
    const res = await t.put(`/api/books/intro/units/${n}`, { completed: true });
    assert.equal(res.status, 400, `unidade ${n}`);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
  const missing = await t.put('/api/books/livro-x/units/1', { completed: true });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'BOOK_NOT_FOUND');
});

test('corpo inválido ao marcar unidade devolve 400', async () => {
  const t = await setup();
  for (const body of [{}, { completed: 'true' }, { completed: 1 }, null]) {
    const res = await t.put('/api/books/intro/units/1', body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test('visão geral: total 64, porcentagem geral e livro atual', async () => {
  const t = await setup();

  let overview = (await t.get('/api/progress/overview')).body.overview;
  assert.equal(overview.totalUnits, 64);
  assert.equal(overview.completedUnits, 0);
  assert.equal(overview.percent, 0);
  assert.equal(overview.currentBook.slug, 'intro');

  for (let n = 1; n <= 16; n += 1) await toggle(t, 'intro', n);
  for (let n = 1; n <= 4; n += 1) await toggle(t, 'interchange-1', n);

  overview = (await t.get('/api/progress/overview')).body.overview;
  assert.equal(overview.completedUnits, 20);
  assert.equal(overview.percent, 31.25);
  assert.equal(overview.currentBook.slug, 'interchange-1');
  assert.equal(overview.currentBook.title, 'Interchange 1');
});

// ---------- materiais ----------

test('materiais: criar, listar, editar, remover', async () => {
  const t = await setup();
  const base = '/api/books/intro/materials';

  assert.deepEqual((await t.get(base)).body.materials, []);

  const created = await t.post(base, { kind: 'workbook', title: ' Meu workbook ', url: 'https://example.com/wb' });
  assert.equal(created.status, 201);
  assert.equal(created.body.material.title, 'Meu workbook');
  await t.post(base, { kind: 'student_book', url: 'https://example.com/sb' });

  const list = (await t.get(base)).body.materials;
  assert.deepEqual(list.map((m) => m.kind), ['student_book', 'workbook']); // ordenados por tipo
  assert.equal(list[0].title, null);

  const id = created.body.material.id;
  const updated = await t.put(`${base}/${id}`, { kind: 'audio', title: 'Áudios', url: 'http://example.com/audio' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.material.kind, 'audio');

  assert.equal((await t.del(`${base}/${id}`)).status, 204);
  assert.equal((await t.del(`${base}/${id}`)).status, 404);
  assert.equal((await t.get(base)).body.materials.length, 1);
});

test('materiais: valida tipo e URL (somente http/https)', async () => {
  const t = await setup();
  const base = '/api/books/intro/materials';
  const invalid = [
    { kind: 'video', url: 'https://example.com' },
    { kind: 'audio', url: 'javascript:alert(1)' },
    { kind: 'audio', url: 'ftp://example.com/file' },
    { kind: 'audio', url: 'não é url' },
    { kind: 'audio', url: '' },
    { kind: 'audio' },
    { kind: 'audio', url: 'https://example.com', title: 'x'.repeat(121) },
  ];
  for (const body of invalid) {
    const res = await t.post(base, body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await t.put(`${base}/abc`, { kind: 'audio', url: 'https://example.com' })).status, 400);
  assert.equal((await t.put(`${base}/999`, { kind: 'audio', url: 'https://example.com' })).status, 404);
});

test('materiais de um livro não aparecem em outro', async () => {
  const t = await setup();
  const created = await t.post('/api/books/intro/materials', { kind: 'audio', url: 'https://example.com/a' });
  assert.deepEqual((await t.get('/api/books/interchange-1/materials')).body.materials, []);
  const wrongBook = await t.del(`/api/books/interchange-1/materials/${created.body.material.id}`);
  assert.equal(wrongBook.status, 404);
});

// ---------- anotações ----------

test('anotações: vazio por padrão, salvar e ler de volta', async () => {
  const t = await setup();
  const url = '/api/books/interchange-3/notes';

  assert.deepEqual((await t.get(url)).body.notes, { content: '', updatedAt: null });

  const saved = await t.put(url, { content: 'Revisar present perfect\nUnit 3 é difícil' });
  assert.equal(saved.status, 200);
  assert.ok(saved.body.notes.updatedAt);

  const again = (await t.get(url)).body.notes;
  assert.equal(again.content, 'Revisar present perfect\nUnit 3 é difícil');

  await t.put(url, { content: '' });
  assert.equal((await t.get(url)).body.notes.content, '');
});

test('anotações: valida tipo e tamanho', async () => {
  const t = await setup();
  const url = '/api/books/intro/notes';
  assert.equal((await t.put(url, {})).status, 400);
  assert.equal((await t.put(url, { content: 42 })).status, 400);
  assert.equal((await t.put(url, { content: 'x'.repeat(20001) })).status, 400);
  assert.equal((await t.put(url, { content: 'x'.repeat(20000) })).status, 200);
});

// ---------- backup ----------

test('backup: exportar e importar em um banco limpo reproduz progresso, materiais e anotações', async () => {
  const source = await setup();
  await toggle(source, 'intro', 1);
  await toggle(source, 'intro', 2);
  await toggle(source, 'interchange-3', 16);
  await source.post('/api/books/interchange-1/materials', { kind: 'workbook', title: 'WB', url: 'https://example.com/wb' });
  await source.put('/api/books/interchange-2/notes', { content: 'minhas notas' });

  const exported = await source.get('/api/backup/export');
  assert.equal(exported.status, 200);
  assert.equal(exported.body.app, 'my-english-journey');
  assert.equal(exported.body.version, 1);
  assert.equal(exported.body.books.length, 4);
  assert.ok(!JSON.stringify(exported.body).includes('password'));

  const target = await setup();
  const imported = await target.post('/api/backup/import', exported.body);
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported, true);
  assert.deepEqual(imported.body.summary, { books: 4, completedUnits: 3, materials: 1, notes: 1 });

  const books = (await target.get('/api/books')).body.books;
  assert.deepEqual(books.map((b) => b.completedUnits), [2, 0, 0, 1]);
  assert.equal((await target.get('/api/books/interchange-1/materials')).body.materials[0].title, 'WB');
  assert.equal((await target.get('/api/books/interchange-2/notes')).body.notes.content, 'minhas notas');

  // Exportar de novo gera o mesmo conteúdo (ida e volta).
  const again = (await target.get('/api/backup/export')).body;
  assert.deepEqual(again.books, exported.body.books);
});

test('backup: importar substitui os dados existentes dos livros do arquivo', async () => {
  const t = await setup();
  for (let n = 1; n <= 10; n += 1) await toggle(t, 'intro', n);
  await toggle(t, 'interchange-1', 1);
  await t.post('/api/books/intro/materials', { kind: 'audio', url: 'https://example.com/old' });

  const backup = { app: 'my-english-journey', version: 1, books: [{ slug: 'intro', completedUnits: [2, 4] }] };
  const res = await t.post('/api/backup/import', backup);
  assert.equal(res.status, 200);

  const books = (await t.get('/api/books')).body.books;
  assert.deepEqual(books[0].completedUnitNumbers, [2, 4]);
  assert.equal(books[1].completedUnits, 1, 'livros fora do arquivo permanecem intactos');
  assert.deepEqual((await t.get('/api/books/intro/materials')).body.materials, []);
});

test('backup: dryRun valida sem gravar nada', async () => {
  const t = await setup();
  const backup = { app: 'my-english-journey', version: 1, books: [{ slug: 'intro', completedUnits: [1, 2, 3] }] };
  const res = await t.post('/api/backup/import?dryRun=true', backup);
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.imported, false);
  assert.equal(res.body.summary.completedUnits, 3);
  assert.equal((await t.get('/api/books/intro')).body.book.completedUnits, 0);
});

test('backup: arquivos inválidos são rejeitados (400) e nada é alterado', async () => {
  const t = await setup();
  await toggle(t, 'intro', 1);
  const ok = { app: 'my-english-journey', version: 1 };

  const invalid = [
    {},
    [],
    { ...ok, app: 'outro-app', books: [] },
    { ...ok, version: 99, books: [] },
    { ...ok },
    { ...ok, books: [{ slug: 'desconhecido', completedUnits: [] }] },
    { ...ok, books: [{ slug: 'intro', completedUnits: [0] }] },
    { ...ok, books: [{ slug: 'intro', completedUnits: [17] }] },
    { ...ok, books: [{ slug: 'intro', completedUnits: [1, 1] }] },
    { ...ok, books: [{ slug: 'intro', completedUnits: ['1'] }] },
    { ...ok, books: [{ slug: 'intro' }, { slug: 'intro' }] },
    { ...ok, books: [{ slug: 'intro', materials: [{ kind: 'audio', url: 'javascript:alert(1)' }] }] },
    { ...ok, books: [{ slug: 'intro', notes: 'x'.repeat(20001) }] },
  ];
  for (const body of invalid) {
    const res = await t.post('/api/backup/import', body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 100));
    assert.equal(res.body.error.code, 'INVALID_BACKUP');
  }
  assert.equal((await t.get('/api/books/intro')).body.book.completedUnits, 1);
});

// ---------- CORS e segurança ----------

test('CORS: libera a origem configurada e bloqueia as demais', async () => {
  const { agent } = await createTestContext();

  const allowed = await agent.options('/api/books')
    .set('Origin', 'https://bycmlla.github.io')
    .set('Access-Control-Request-Method', 'GET')
    .set('Access-Control-Request-Headers', 'authorization');
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://bycmlla.github.io');
  assert.match(allowed.headers['access-control-allow-headers'], /authorization/i);
  assert.equal(allowed.headers['access-control-allow-credentials'], undefined);

  const blocked = await agent.get('/health').set('Origin', 'https://site-malicioso.example');
  assert.equal(blocked.headers['access-control-allow-origin'], undefined);
});

test('respostas incluem cabeçalhos de segurança e não revelam o framework', async () => {
  const { agent } = await createTestContext();
  const res = await agent.get('/health');
  assert.equal(res.headers['x-powered-by'], undefined);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('senhas ficam armazenadas apenas como hash bcrypt', async () => {
  const { pool } = await createTestContext();
  const { rows } = await pool.query('SELECT password_hash FROM users');
  assert.equal(rows.length, 1);
  assert.match(rows[0].password_hash, /^\$2[aby]\$\d{2}\$/);
  assert.ok(!rows[0].password_hash.includes(TEST_PASSWORD));
});
