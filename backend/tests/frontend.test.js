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

  const books = [
    { slug: 'a', title: 'A', level: 'A1', totalUnits: 16, completedUnits: 16, status: 'completed', lastActivityAt: null },
    { slug: 'b', title: 'B', level: 'A2', totalUnits: 16, completedUnits: 3, status: 'studying', lastActivityAt: '2026-01-01T00:00:00Z' },
    { slug: 'c', title: 'C', level: 'B1', totalUnits: 16, completedUnits: 0, status: 'not_started', lastActivityAt: null },
  ];
  assert.equal(front.summarizeOverall(books).currentBook.slug, backendProgress.summarizeOverall(books).currentBook.slug);
  assert.equal(front.summarizeOverall(books).percent, backendProgress.summarizeOverall(books).percent);
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
