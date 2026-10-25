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

async function toggle(t, slug, number, completed = true, bookType = 'student_book') {
  const res = await t.put(`/api/books/${slug}/units/${number}`, { completed, bookType });
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
    assert.equal(book.totalTasks, 32, '16 do Student\'s Book + 16 do Workbook');
    assert.equal(book.completedTasks, 0);
    assert.equal(book.fullyCompletedUnits, 0);
    assert.equal(book.studentBook.total, 16);
    assert.equal(book.workbook.total, 16);
    assert.equal(book.percent, 0);
    assert.equal(book.status, 'not_started');
  }
});

test('Student\'s Book e Workbook têm progresso próprio; o nível soma as duas partes (32 conclusões) nos 4 livros', async () => {
  const t = await setup();
  const steps = [
    [1, 6.25],
    [4, 25],
    [8, 50],
    [12, 75],
    [16, 100],
  ];

  for (const slug of SLUGS) {
    // Student's Book: 0 -> 16. O nível chega a 50 % e continua "estudando".
    let done = 0;
    for (const [target, percent] of steps) {
      while (done < target) await toggle(t, slug, (done += 1), true, 'student_book');
      const { book } = (await t.get(`/api/books/${slug}`)).body;
      assert.equal(book.studentBook.completed, target, `${slug} SB ${target}`);
      assert.equal(book.studentBook.percent, percent, `${slug} SB ${target}`);
      assert.equal(book.workbook.completed, 0, 'o Workbook não é afetado');
      assert.equal(book.completedTasks, target);
      assert.equal(book.percent, Math.round((percent / 2) * 100) / 100, `${slug}: nível = tarefas / 32`);
      assert.equal(book.fullyCompletedUnits, 0, 'sem Workbook nenhuma unidade está 100 %');
      assert.equal(book.status, 'studying');
    }
    assert.equal((await t.get(`/api/books/${slug}`)).body.book.percent, 50);

    // Workbook: 0 -> 16. Ao final, o nível está 100 % concluído.
    done = 0;
    for (const [target, percent] of steps) {
      while (done < target) await toggle(t, slug, (done += 1), true, 'workbook');
      const { book } = (await t.get(`/api/books/${slug}`)).body;
      assert.equal(book.workbook.completed, target, `${slug} WB ${target}`);
      assert.equal(book.workbook.percent, percent, `${slug} WB ${target}`);
      assert.equal(book.studentBook.completed, 16, 'o Student\'s Book não é afetado');
      assert.equal(book.completedTasks, 16 + target);
      assert.equal(book.fullyCompletedUnits, target);
      assert.equal(book.status, target === 16 ? 'completed' : 'studying');
    }
    assert.equal((await t.get(`/api/books/${slug}`)).body.book.percent, 100);
  }

  const overview = (await t.get('/api/progress/overview')).body.overview;
  assert.equal(overview.totalUnits, 64);
  assert.equal(overview.completedUnits, 64);
  assert.equal(overview.totalTasks, 128);
  assert.equal(overview.completedTasks, 128);
  assert.equal(overview.percent, 100);
  assert.equal(overview.currentBook, null);
});

test('uma unidade só é completa quando Student\'s Book e Workbook estão concluídos', async () => {
  const t = await setup();

  await toggle(t, 'intro', 3, true, 'student_book');
  let units = (await t.get('/api/books/intro/units')).body.units;
  assert.equal(units[2].studentBook.completed, true);
  assert.equal(units[2].workbook.completed, false);
  assert.equal(units[2].completed, false);
  assert.equal((await t.get('/api/books/intro')).body.book.fullyCompletedUnits, 0);

  const both = await toggle(t, 'intro', 3, true, 'workbook');
  assert.equal(both.unit.bookType, 'workbook');
  assert.deepEqual(both.book.fullyCompletedUnitNumbers, [3]);
  assert.equal(both.book.fullyCompletedUnits, 1);
  units = (await t.get('/api/books/intro/units')).body.units;
  assert.equal(units[2].completed, true);

  // Desmarcar só o Workbook tira a unidade de "completa" sem mexer no Student's Book.
  const after = await toggle(t, 'intro', 3, false, 'workbook');
  assert.equal(after.book.fullyCompletedUnits, 0);
  assert.deepEqual(after.book.studentBook.completedUnitNumbers, [3]);
  assert.deepEqual(after.book.workbook.completedUnitNumbers, []);
});

test('bookType é opcional (padrão student_book) e rejeita valores inválidos', async () => {
  const t = await setup();
  const legacy = await t.put('/api/books/intro/units/1', { completed: true }); // clientes antigos
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.unit.bookType, 'student_book');
  assert.equal(legacy.body.book.studentBook.completed, 1);
  assert.equal(legacy.body.book.workbook.completed, 0);

  for (const bookType of ['audio', 'Workbook', 1, '']) {
    const res = await t.put('/api/books/intro/units/2', { completed: true, bookType });
    assert.equal(res.status, 400, JSON.stringify(bookType));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('marcar e desmarcar uma unidade; a resposta já traz o progresso atualizado', async () => {
  const t = await setup();

  const checked = await toggle(t, 'intro', 1, true);
  assert.equal(checked.unit.completed, true);
  assert.equal(checked.book.studentBook.completed, 1);
  assert.equal(checked.book.studentBook.percent, 6.25);
  assert.equal(checked.book.percent, 3.13, '1 de 32 conclusões');
  assert.deepEqual(checked.book.studentBook.completedUnitNumbers, [1]);

  const unchecked = await toggle(t, 'intro', 1, false);
  assert.equal(unchecked.unit.completed, false);
  assert.equal(unchecked.book.completedTasks, 0);
  assert.equal(unchecked.book.status, 'not_started');
});

test('marcar a mesma unidade duas vezes é idempotente (sem duplicar registros)', async () => {
  const t = await setup();
  await toggle(t, 'intro', 3);
  await toggle(t, 'intro', 3);
  const { rows } = await t.pool.query('SELECT COUNT(*) AS total FROM unit_progress');
  assert.equal(Number(rows[0].total), 1);
  assert.equal((await t.get('/api/books/intro')).body.book.studentBook.completed, 1);
});

test('persistência: o progresso vem do banco, inclusive após novo login', async () => {
  const t = await setup();
  await toggle(t, 'interchange-2', 5);
  await toggle(t, 'interchange-2', 9);
  await toggle(t, 'interchange-2', 9, true, 'workbook');

  const { rows } = await t.pool.query(
    'SELECT u.number, up.book_type FROM unit_progress up JOIN units u ON u.id = up.unit_id WHERE up.completed = true ORDER BY up.book_type, u.number',
  );
  assert.deepEqual(rows.map((r) => [r.number, r.book_type]), [[5, 'student_book'], [9, 'student_book'], [9, 'workbook']]);

  // "Outro dispositivo": novo login, novo token.
  const otherToken = await loginToken(t.agent);
  const res = await t.agent.get('/api/books/interchange-2/units').set('Authorization', `Bearer ${otherToken}`);
  const sb = res.body.units.filter((u) => u.studentBook.completed).map((u) => u.number);
  const wb = res.body.units.filter((u) => u.workbook.completed).map((u) => u.number);
  assert.deepEqual(sb, [5, 9]);
  assert.deepEqual(wb, [9]);
  assert.deepEqual(res.body.units.filter((u) => u.completed).map((u) => u.number), [9], 'só a 9 tem os dois');
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

test('visão geral: total 64, porcentagem geral (128 conclusões) e livro atual', async () => {
  const t = await setup();

  let overview = (await t.get('/api/progress/overview')).body.overview;
  assert.equal(overview.totalUnits, 64);
  assert.equal(overview.totalTasks, 128);
  assert.equal(overview.completedUnits, 0);
  assert.equal(overview.percent, 0);
  assert.equal(overview.currentBook.slug, 'intro');

  for (let n = 1; n <= 16; n += 1) {
    await toggle(t, 'intro', n, true, 'student_book');
    await toggle(t, 'intro', n, true, 'workbook');
  }
  for (let n = 1; n <= 4; n += 1) await toggle(t, 'interchange-1', n);

  overview = (await t.get('/api/progress/overview')).body.overview;
  assert.equal(overview.completedUnits, 16, 'só o Intro tem unidades com os dois materiais');
  assert.equal(overview.completedTasks, 36);
  assert.equal(overview.percent, 28.13); // 36 / 128
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
  await toggle(source, 'intro', 2, true, 'workbook');
  await toggle(source, 'interchange-3', 16);
  await toggle(source, 'interchange-3', 15, true, 'workbook');
  await source.post('/api/books/interchange-1/materials', { kind: 'workbook', title: 'WB', url: 'https://example.com/wb' });
  await source.put('/api/books/interchange-2/notes', { content: 'minhas notas' });

  const exported = await source.get('/api/backup/export');
  assert.equal(exported.status, 200);
  assert.equal(exported.body.app, 'my-english-journey');
  assert.equal(exported.body.version, 2);
  assert.deepEqual(exported.body.books[0].completedUnits, [1, 2]);
  assert.deepEqual(exported.body.books[0].workbookCompletedUnits, [2]);
  assert.equal(exported.body.books.length, 4);
  assert.ok(!JSON.stringify(exported.body).includes('password'));

  const target = await setup();
  const imported = await target.post('/api/backup/import', exported.body);
  assert.equal(imported.status, 200);
  assert.equal(imported.body.imported, true);
  assert.deepEqual(imported.body.summary, { books: 4, studentBookUnits: 3, workbookUnits: 2, materials: 1, notes: 1 });

  const books = (await target.get('/api/books')).body.books;
  assert.deepEqual(books.map((b) => b.studentBook.completed), [2, 0, 0, 1]);
  assert.deepEqual(books.map((b) => b.workbook.completed), [1, 0, 0, 1]);
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

  const backup = { app: 'my-english-journey', version: 2, books: [{ slug: 'intro', completedUnits: [2, 4], workbookCompletedUnits: [4] }] };
  const res = await t.post('/api/backup/import', backup);
  assert.equal(res.status, 200);

  const books = (await t.get('/api/books')).body.books;
  assert.deepEqual(books[0].studentBook.completedUnitNumbers, [2, 4]);
  assert.deepEqual(books[0].workbook.completedUnitNumbers, [4]);
  assert.equal(books[1].studentBook.completed, 1, 'livros fora do arquivo permanecem intactos');
  assert.deepEqual((await t.get('/api/books/intro/materials')).body.materials, []);
});

test('backup v1 (antigo, sem Workbook) importa o Student\'s Book e não apaga o Workbook', async () => {
  const t = await setup();
  await toggle(t, 'intro', 7, true, 'workbook');
  const v1 = { app: 'my-english-journey', version: 1, books: [{ slug: 'intro', completedUnits: [1, 2] }] };
  const res = await t.post('/api/backup/import', v1);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.summary, { books: 1, studentBookUnits: 2, workbookUnits: 0, materials: 0, notes: 0 });
  const { book } = (await t.get('/api/books/intro')).body;
  assert.deepEqual(book.studentBook.completedUnitNumbers, [1, 2]);
  assert.deepEqual(book.workbook.completedUnitNumbers, [7], 'Workbook preservado');
});

test('backup: dryRun valida sem gravar nada', async () => {
  const t = await setup();
  const backup = { app: 'my-english-journey', version: 2, books: [{ slug: 'intro', completedUnits: [1, 2, 3], workbookCompletedUnits: [1] }] };
  const res = await t.post('/api/backup/import?dryRun=true', backup);
  assert.equal(res.status, 200);
  assert.equal(res.body.dryRun, true);
  assert.equal(res.body.imported, false);
  assert.equal(res.body.summary.studentBookUnits, 3);
  assert.equal(res.body.summary.workbookUnits, 1);
  assert.equal((await t.get('/api/books/intro')).body.book.completedTasks, 0);
});

test('backup: arquivos inválidos são rejeitados (400) e nada é alterado', async () => {
  const t = await setup();
  await toggle(t, 'intro', 1);
  const ok = { app: 'my-english-journey', version: 2 };

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
    { ...ok, books: [{ slug: 'intro', workbookCompletedUnits: [17] }] },
    { ...ok, books: [{ slug: 'intro', workbookCompletedUnits: 'todas' }] },
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
  assert.equal((await t.get('/api/books/intro')).body.book.studentBook.completed, 1);
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
