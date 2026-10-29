'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DOCS = path.join(__dirname, '..', '..', 'docs');
const backendProgress = require('../src/services/progress');

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

test('frontend: cálculo de progresso é idêntico ao do backend (0..16 unidades)', async () => {
  const front = await import(path.join(DOCS, 'js', 'progress.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
  for (let n = 0; n <= 16; n += 1) {
    assert.equal(front.calculatePercent(n, 16), backendProgress.calculatePercent(n, 16), `percent ${n}`);
    assert.equal(front.getStatus(n, 16), backendProgress.getStatus(n, 16), `status ${n}`);
  }
  assert.equal(front.calculatePercent(1, 16), 6.25);
  assert.equal(front.calculatePercent(4, 16), 25);
  assert.equal(front.calculatePercent(16, 16), 100);

  // Mesma entrada, mesma saída: nível (Student's Book + Workbook) e visão geral.
  const mk = (slug, sb, wb, at) => ({ slug, title: slug, level: 'A1', lastActivityAt: at, ...backendProgress.summarizeBookProgress({ studentBook: sb, workbook: wb }) });
  const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
  const cases = [
    [[], []], [[1], []], [[], [1]], [range(16), []], [range(16), range(16)], [[1, 2, 3, 9], [2, 3, 4]],
  ];
  for (const [sb, wb] of cases) {
    assert.deepEqual(front.summarizeBookProgress({ studentBook: sb, workbook: wb }), backendProgress.summarizeBookProgress({ studentBook: sb, workbook: wb }));
  }
  const books = [mk('a', range(16), range(16), null), mk('b', [1, 2, 3], [1], '2026-01-01T00:00:00Z'), mk('c', [], [], null)];
  const fo = front.summarizeOverall(books);
  const bo = backendProgress.summarizeOverall(books);
  assert.equal(fo.percent, bo.percent);
  assert.equal(fo.completedUnits, bo.completedUnits);
  assert.equal(fo.totalTasks, 96);
  assert.equal(fo.currentBook.slug, bo.currentBook.slug);
});

test('frontend: nenhuma credencial ou segredo é exposto nos arquivos publicados', () => {
  const forbidden = [
    /JWT_SECRET/i,
    /ADMIN_PASSWORD/i,
    /ADMIN_EMAIL/i,
    /DATABASE_URL/i,
    /postgres(ql)?:\/\//i,
    /BEGIN (RSA |EC )?PRIVATE KEY/,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, // JWT embutido
    /localStorage\.setItem\(\s*['"]mej\.(books|progress)/, // progresso não pode ficar no localStorage
  ];
  const files = listFiles(DOCS).filter((file) => /\.(html|js|css|json|svg)$/.test(file));
  assert.ok(files.length >= 10, 'arquivos do frontend encontrados');
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(content), `${path.relative(DOCS, file)} contém ${pattern}`);
    }
  }
});

test('frontend: caminhos relativos funcionam em subdiretório do GitHub Pages', () => {
  const html = fs.readFileSync(path.join(DOCS, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((ref) => !ref.startsWith('#'));
  assert.ok(refs.length >= 4);
  for (const ref of refs) {
    assert.ok(!ref.startsWith('/') && !/^https?:/.test(ref), `caminho não relativo: ${ref}`);
    assert.ok(fs.existsSync(path.join(DOCS, ref)), `arquivo inexistente: ${ref}`);
  }

  for (const file of listFiles(path.join(DOCS, 'js'))) {
    const imports = [...fs.readFileSync(file, 'utf8').matchAll(/from '(\.[^']+)'/g)].map((m) => m[1]);
    for (const spec of imports) {
      assert.ok(fs.existsSync(path.join(path.dirname(file), spec)), `${path.basename(file)} importa ${spec} inexistente`);
    }
  }
  assert.ok(fs.existsSync(path.join(DOCS, '.nojekyll')));
});

test('frontend: sem innerHTML/eval (conteúdo dinâmico só via textContent)', () => {
  for (const file of listFiles(path.join(DOCS, 'js'))) {
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(!/\.innerHTML\s*=|insertAdjacentHTML|\beval\(|new Function\(/.test(content), path.basename(file));
  }
});

test('frontend: cálculo de porcentagem de assuntos (8 de 10 = 80%) idêntico ao do backend', async () => {
  const front = await import(path.join(DOCS, 'js', 'progress.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
  for (const total of [1, 7, 10, 15, 678]) {
    for (let done = 0; done <= Math.min(total, 40); done += 1) {
      assert.equal(front.calculatePercent(done, total), backendProgress.calculatePercent(done, total), `${done}/${total}`);
    }
  }
  assert.equal(front.calculatePercent(8, 10), 80);
});

test('frontend: barra de progresso de Conteúdos de Estudo usa #fed353', () => {
  const css = fs.readFileSync(path.join(DOCS, 'css', 'styles.css'), 'utf8');
  assert.match(css, /--study-bar:\s*#fed353/i);
  assert.match(css, /\.study-panel \.progress-fill\s*\{[^}]*background:\s*var\(--study-bar\)/);
});

test('frontend: Meus Estudos não tem percentuais fixos no código', () => {
  for (const name of ['hub.js', 'coursePage.js']) {
    const content = fs.readFileSync(path.join(DOCS, 'js', name), 'utf8');
    assert.ok(!/\b(70|10)\s*%/.test(content.replace(/\/\/.*$/gm, '')), `${name} tem porcentagem fixa`);
  }
  const hub = fs.readFileSync(path.join(DOCS, 'js', 'hub.js'), 'utf8');
  assert.match(hub, /course\.progress/);
});

test('frontend: Materiais de Estudo não traz links nem materiais fixos no código', () => {
  const content = fs.readFileSync(path.join(DOCS, 'js', 'materialsPage.js'), 'utf8').replace(/\/\/.*$/gm, '');
  const urls = [...content.matchAll(/https?:\/\/[A-Za-z0-9]/g)];
  assert.equal(urls.length, 0, 'materialsPage.js tem URL fixa');
  assert.match(content, /api\.getCourseMaterials/);
});
