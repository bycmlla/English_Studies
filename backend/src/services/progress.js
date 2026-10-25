'use strict';

// Regras de progresso: funções puras, sem acesso a banco, fáceis de testar.

const UNITS_PER_BOOK = 16;

const STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  STUDYING: 'studying',
  COMPLETED: 'completed',
});

/** progresso = (concluídas / total) × 100, com até 2 casas decimais (1/16 = 6.25). */
function calculatePercent(completed, total = UNITS_PER_BOOK) {
  if (!total || total <= 0) return 0;
  const safe = Math.min(Math.max(completed, 0), total);
  return Math.round((safe / total) * 10000) / 100;
}

function getStatus(completed, total = UNITS_PER_BOOK) {
  if (completed <= 0) return STATUS.NOT_STARTED;
  if (completed >= total) return STATUS.COMPLETED;
  return STATUS.STUDYING;
}

/**
 * Livro "atual": entre os que estão em andamento, o de atividade mais recente;
 * se nenhum estiver em andamento, o primeiro ainda não concluído; null se tudo concluído.
 */
function pickCurrentBook(books) {
  const studying = books.filter((book) => book.status === STATUS.STUDYING);
  if (studying.length > 0) {
    return studying.reduce((latest, book) => {
      const a = latest.lastActivityAt ? new Date(latest.lastActivityAt).getTime() : 0;
      const b = book.lastActivityAt ? new Date(book.lastActivityAt).getTime() : 0;
      return b > a ? book : latest;
    });
  }
  return books.find((book) => book.status !== STATUS.COMPLETED) || null;
}

function summarizeOverall(books) {
  const totalUnits = books.reduce((sum, book) => sum + book.totalUnits, 0);
  const completedUnits = books.reduce((sum, book) => sum + book.completedUnits, 0);
  const current = pickCurrentBook(books);
  return {
    totalUnits,
    completedUnits,
    percent: calculatePercent(completedUnits, totalUnits),
    status: getStatus(completedUnits, totalUnits),
    currentBook: current ? { slug: current.slug, title: current.title, level: current.level } : null,
  };
}

module.exports = { UNITS_PER_BOOK, STATUS, calculatePercent, getStatus, pickCurrentBook, summarizeOverall };
