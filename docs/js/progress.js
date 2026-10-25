// Regras de progresso (funções puras). Espelham backend/src/services/progress.js:
// o servidor é a fonte oficial, mas o cálculo local deixa a interface instantânea
// ao marcar/desmarcar uma atividade, antes da resposta da API.
//
// Cada unidade tem duas atividades acompanhadas: Student's Book e Workbook.
// Um nível tem 16 unidades × 2 = 32 conclusões possíveis.

export const UNITS_PER_BOOK = 16;
export const BOOK_TYPES = Object.freeze(['student_book', 'workbook']);

export const BOOK_TYPE_LABEL = Object.freeze({
  student_book: "Student's Book",
  workbook: 'Workbook',
});

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

function summarizeMaterial(numbers, totalUnits) {
  const completedUnitNumbers = [...new Set(numbers)].sort((a, b) => a - b);
  return {
    completed: completedUnitNumbers.length,
    total: totalUnits,
    percent: calculatePercent(completedUnitNumbers.length, totalUnits),
    completedUnitNumbers,
  };
}

/**
 * Progresso de um nível a partir das unidades concluídas de cada material.
 * Percentual e status do nível consideram as duas partes (32 conclusões);
 * uma unidade só é "completa" com Student's Book e Workbook concluídos.
 */
export function summarizeBookProgress({ studentBook = [], workbook = [] }, totalUnits = UNITS_PER_BOOK) {
  const sb = summarizeMaterial(studentBook, totalUnits);
  const wb = summarizeMaterial(workbook, totalUnits);
  const workbookSet = new Set(wb.completedUnitNumbers);
  const fullyCompletedUnitNumbers = sb.completedUnitNumbers.filter((n) => workbookSet.has(n));

  const totalTasks = totalUnits * BOOK_TYPES.length;
  const completedTasks = sb.completed + wb.completed;

  return {
    totalUnits,
    studentBook: sb,
    workbook: wb,
    fullyCompletedUnits: fullyCompletedUnitNumbers.length,
    fullyCompletedUnitNumbers,
    totalTasks,
    completedTasks,
    percent: calculatePercent(completedTasks, totalTasks),
    status: getStatus(completedTasks, totalTasks),
  };
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
  const completedUnits = books.reduce((sum, book) => sum + book.fullyCompletedUnits, 0);
  const totalTasks = books.reduce((sum, book) => sum + book.totalTasks, 0);
  const completedTasks = books.reduce((sum, book) => sum + book.completedTasks, 0);
  return {
    totalUnits,
    completedUnits, // unidades com Student's Book e Workbook concluídos
    totalTasks,
    completedTasks,
    percent: calculatePercent(completedTasks, totalTasks),
    currentBook: pickCurrentBook(books),
  };
}

export const STATUS_LABEL = Object.freeze({
  [STATUS.NOT_STARTED]: 'Não iniciado',
  [STATUS.STUDYING]: 'Estudando',
  [STATUS.COMPLETED]: 'Concluído',
});
