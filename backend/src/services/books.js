'use strict';

const { notFound } = require('../errors');
const { UNITS_PER_BOOK, summarizeBookProgress, summarizeOverall } = require('./progress');

function toBook(row) {
  return { id: row.id, slug: row.slug, title: row.title, level: row.level, color: row.color, position: row.position };
}

/** rows: unidades concluídas do livro ({ number, book_type, updated_at }). */
function buildSummary(book, totalUnits, rows) {
  const numbersOf = (type) => rows.filter((row) => row.book_type === type).map((row) => row.number);
  const progress = summarizeBookProgress(
    { studentBook: numbersOf('student_book'), workbook: numbersOf('workbook') },
    totalUnits,
  );

  const lastActivityAt = rows.reduce((latest, row) => {
    const at = row.updated_at ? new Date(row.updated_at) : null;
    return at && (!latest || at > latest) ? at : latest;
  }, null);

  return {
    slug: book.slug,
    title: book.title,
    level: book.level,
    color: book.color,
    position: book.position,
    ...progress,
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
  };
}

async function getBookBySlug(db, slug) {
  const { rows } = await db.query(
    'SELECT id, slug, title, level, color, position FROM books WHERE slug = $1',
    [slug],
  );
  if (!rows[0]) throw notFound('Livro não encontrado.', 'BOOK_NOT_FOUND');
  return toBook(rows[0]);
}

async function listBookSlugs(db) {
  const { rows } = await db.query('SELECT slug FROM books ORDER BY position');
  return rows.map((row) => row.slug);
}

/** Todos os livros com progresso (Student's Book + Workbook) calculado a partir do banco. */
async function listBooksWithProgress(db, userId) {
  const [booksResult, unitsResult, doneResult] = await Promise.all([
    db.query('SELECT id, slug, title, level, color, position FROM books ORDER BY position'),
    db.query('SELECT book_id, COUNT(*) AS total FROM units GROUP BY book_id'),
    db.query(
      `SELECT u.book_id, u.number, up.book_type, up.updated_at
         FROM unit_progress up
         JOIN units u ON u.id = up.unit_id
        WHERE up.user_id = $1 AND up.completed = true`,
      [userId],
    ),
  ]);

  const totals = new Map(unitsResult.rows.map((row) => [row.book_id, Number(row.total)]));
  return booksResult.rows.map((row) =>
    buildSummary(
      toBook(row),
      totals.get(row.id) ?? UNITS_PER_BOOK,
      doneResult.rows.filter((done) => done.book_id === row.id),
    ),
  );
}

async function getBookWithProgress(db, userId, slug) {
  const books = await listBooksWithProgress(db, userId);
  const book = books.find((item) => item.slug === slug);
  if (!book) throw notFound('Livro não encontrado.', 'BOOK_NOT_FOUND');
  return book;
}

async function getOverview(db, userId) {
  return summarizeOverall(await listBooksWithProgress(db, userId));
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

/** Unidades 01..16 de um livro com o estado de cada material (Student's Book e Workbook). */
async function listUnits(db, userId, book) {
  const [units, progress] = await Promise.all([
    db.query('SELECT number FROM units WHERE book_id = $1 ORDER BY number', [book.id]),
    db.query(
      `SELECT u.number, up.book_type, up.completed, up.completed_at, up.updated_at
         FROM unit_progress up JOIN units u ON u.id = up.unit_id
        WHERE up.user_id = $1 AND u.book_id = $2`,
      [userId, book.id],
    ),
  ]);

  const stateOf = (number, type) => {
    const row = progress.rows.find((r) => r.number === number && r.book_type === type);
    return {
      completed: row?.completed === true,
      completedAt: row?.completed ? iso(row.completed_at) : null,
      updatedAt: iso(row?.updated_at),
    };
  };

  return units.rows.map(({ number }) => {
    const studentBook = stateOf(number, 'student_book');
    const workbook = stateOf(number, 'workbook');
    return {
      number,
      label: `Unit ${String(number).padStart(2, '0')}`,
      studentBook,
      workbook,
      completed: studentBook.completed && workbook.completed, // 100% só com os dois materiais
    };
  });
}

/** Marca/desmarca o Student's Book ou o Workbook de uma unidade (idempotente). */
async function setUnitCompleted(db, userId, book, number, bookType, completed) {
  const { rows } = await db.query('SELECT id FROM units WHERE book_id = $1 AND number = $2', [book.id, number]);
  if (!rows[0]) throw notFound('Unidade não encontrada.', 'UNIT_NOT_FOUND');

  const now = new Date();
  await db.query(
    `INSERT INTO unit_progress (user_id, unit_id, book_type, completed, completed_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, unit_id, book_type)
     DO UPDATE SET completed = EXCLUDED.completed,
                   completed_at = EXCLUDED.completed_at,
                   updated_at = EXCLUDED.updated_at`,
    [userId, rows[0].id, bookType, completed, completed ? now : null, now],
  );

  return {
    unit: { number, bookType, completed, updatedAt: now.toISOString() },
    book: await getBookWithProgress(db, userId, book.slug),
  };
}

module.exports = {
  getBookBySlug,
  listBookSlugs,
  listBooksWithProgress,
  getBookWithProgress,
  getOverview,
  listUnits,
  setUnitCompleted,
};
