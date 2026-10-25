// Regras de progresso (funções puras). Espelham backend/src/services/progress.js:
// o servidor é a fonte oficial, mas o cálculo local deixa a interface instantânea
// ao marcar/desmarcar uma unidade, antes da resposta da API.

export const UNITS_PER_BOOK = 16;

export const STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  STUDYING: 'studying',
  COMPLETED: 'completed',
});

/** progresso = (concluídas / total) × 100, com até 2 casas decimais (1/16 = 6.25). */
export function calculatePercent(completed, total = UNITS_PER_BOOK) {
  if (!total || total <= 0) return 0;
  const safe = Math.min(Math.max(completed, 0), total);
  return Math.round((safe / total) * 10000) / 100;
}

export function getStatus(completed, total = UNITS_PER_BOOK) {
  if (completed <= 0) return STATUS.NOT_STARTED;
  if (completed >= total) return STATUS.COMPLETED;
  return STATUS.STUDYING;
}

/** Livro em andamento com atividade mais recente; senão o primeiro não concluído; senão null. */
export function pickCurrentBook(books) {
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

export function summarizeOverall(books) {
  const totalUnits = books.reduce((sum, book) => sum + book.totalUnits, 0);
  const completedUnits = books.reduce((sum, book) => sum + book.completedUnits, 0);
  return {
    totalUnits,
    completedUnits,
    percent: calculatePercent(completedUnits, totalUnits),
    currentBook: pickCurrentBook(books),
  };
}

export const STATUS_LABEL = Object.freeze({
  [STATUS.NOT_STARTED]: 'Não iniciado',
  [STATUS.STUDYING]: 'Estudando',
  [STATUS.COMPLETED]: 'Concluído',
});
