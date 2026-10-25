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

const book = (slug, completedUnits, lastActivityAt = null) => ({
  slug,
  title: slug,
  level: 'A1',
  totalUnits: 16,
  completedUnits,
  status: getStatus(completedUnits),
  lastActivityAt,
});

test('summarizeOverall: soma os quatro livros (64 unidades)', () => {
  const overview = summarizeOverall([book('intro', 16), book('a', 8), book('b', 4), book('c', 0)]);
  assert.equal(overview.totalUnits, 64);
  assert.equal(overview.completedUnits, 28);
  assert.equal(overview.percent, 43.75);
  assert.equal(overview.status, STATUS.STUDYING);
});

test('pickCurrentBook: prefere o livro em andamento com atividade mais recente', () => {
  const books = [
    book('intro', 16, '2026-01-01T00:00:00Z'),
    book('a', 3, '2026-02-01T00:00:00Z'),
    book('b', 5, '2026-03-01T00:00:00Z'),
    book('c', 0),
  ];
  assert.equal(pickCurrentBook(books).slug, 'b');
});

test('pickCurrentBook: sem livro em andamento, usa o primeiro não concluído; tudo concluído → null', () => {
  assert.equal(pickCurrentBook([book('intro', 16), book('a', 0), book('b', 0)]).slug, 'a');
  assert.equal(pickCurrentBook([book('intro', 16), book('a', 16)]), null);
});
