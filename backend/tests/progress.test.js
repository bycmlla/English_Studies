'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { calculatePercent, getStatus, pickCurrentBook, summarizeOverall, STATUS } = require('../src/services/progress');

test('calculatePercent: exemplos do enunciado (16 unidades por livro)', () => {
  const expected = { 0: 0, 1: 6.25, 4: 25, 8: 50, 12: 75, 16: 100 };
  for (const [done, percent] of Object.entries(expected)) {
    assert.equal(calculatePercent(Number(done), 16), percent, `${done} unidades`);
  }
});

test('calculatePercent: nunca passa de 0..100 e tolera total inválido', () => {
  assert.equal(calculatePercent(-3, 16), 0);
  assert.equal(calculatePercent(99, 16), 100);
  assert.equal(calculatePercent(5, 0), 0);
});

test('calculatePercent: todas as 17 possibilidades são consistentes com (n / 16) × 100', () => {
  for (let n = 0; n <= 16; n += 1) {
    assert.equal(calculatePercent(n, 16), Math.round((n / 16) * 10000) / 100);
  }
});

test('getStatus: não iniciado, estudando e concluído', () => {
  assert.equal(getStatus(0), STATUS.NOT_STARTED);
  assert.equal(getStatus(1), STATUS.STUDYING);
  assert.equal(getStatus(15), STATUS.STUDYING);
  assert.equal(getStatus(16), STATUS.COMPLETED);
});

const { summarizeBookProgress } = require('../src/services/progress');

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
const book = (slug, sb, wb = 0, lastActivityAt = null) => ({
  slug,
  title: slug,
  level: 'A1',
  lastActivityAt,
  ...summarizeBookProgress({ studentBook: range(sb), workbook: range(wb) }),
});

test('summarizeBookProgress: 32 conclusões possíveis (16 Student\'s Book + 16 Workbook)', () => {
  const empty = summarizeBookProgress({});
  assert.equal(empty.totalTasks, 32);
  assert.equal(empty.completedTasks, 0);
  assert.equal(empty.status, STATUS.NOT_STARTED);

  const only = summarizeBookProgress({ studentBook: range(16) });
  assert.equal(only.studentBook.percent, 100);
  assert.equal(only.workbook.percent, 0);
  assert.equal(only.percent, 50);
  assert.equal(only.status, STATUS.STUDYING);
  assert.equal(only.fullyCompletedUnits, 0);

  const all = summarizeBookProgress({ studentBook: range(16), workbook: range(16) });
  assert.equal(all.percent, 100);
  assert.equal(all.status, STATUS.COMPLETED);
  assert.equal(all.fullyCompletedUnits, 16);
});

test('summarizeBookProgress: unidade completa = interseção dos dois materiais', () => {
  const r = summarizeBookProgress({ studentBook: [1, 2, 3, 5], workbook: [2, 3, 4] });
  assert.deepEqual(r.fullyCompletedUnitNumbers, [2, 3]);
  assert.equal(r.completedTasks, 7);
  assert.equal(r.percent, 21.88); // 7 / 32
  assert.equal(r.studentBook.percent, 25);
  assert.equal(r.workbook.percent, 18.75);
});

test('summarizeOverall: soma os quatro livros (64 unidades, 128 conclusões)', () => {
  const overview = summarizeOverall([book('intro', 16, 16), book('a', 8, 4), book('b', 4, 0), book('c', 0)]);
  assert.equal(overview.totalUnits, 64);
  assert.equal(overview.totalTasks, 128);
  assert.equal(overview.completedUnits, 16 + 4); // intro (16) + livro "a" (4 com os dois)
  assert.equal(overview.completedTasks, 32 + 12 + 4);
  assert.equal(overview.percent, 37.5); // 48 / 128
  assert.equal(overview.status, STATUS.STUDYING);
});

test('pickCurrentBook: prefere o livro em andamento com atividade mais recente', () => {
  const books = [
    book('intro', 16, 16, '2026-01-01T00:00:00Z'),
    book('a', 3, 0, '2026-02-01T00:00:00Z'),
    book('b', 0, 5, '2026-03-01T00:00:00Z'),
    book('c', 0),
  ];
  assert.equal(pickCurrentBook(books).slug, 'b');
});

test('pickCurrentBook: sem livro em andamento, usa o primeiro não concluído; tudo concluído → null', () => {
  assert.equal(pickCurrentBook([book('intro', 16, 16), book('a', 0), book('b', 0)]).slug, 'a');
  assert.equal(pickCurrentBook([book('intro', 16, 16), book('a', 16, 16)]), null);
});
