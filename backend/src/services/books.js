'use strict';

const { notFound } = require('../errors');
const { UNITS_PER_BOOK, calculatePercent, getStatus, summarizeOverall } = require('./progress');

function toBook(row) {
  return { id: row.id, slug: row.slug, title: row.title, level: row.level, color: row.color, position: row.position };
}

function buildSummary(book, totalUnits, completedRows) {
  const completedUnitNumbers = completedRows.map((row) => row.number).sort((a, b) => a - b);
  const completedUnits = completedUnitNumbers.length;
  const lastActivityAt = completedRows.reduce((latest, row) => {
    const at = row.updated_at ? new Date(row.updated_at) : null;
    return at && (!latest || at > latest) ? at : latest;
  }, null);

  return {
    slug: book.slug,
    title: book.title,
    level: book.level,
    color: book.color,
    position: book.position,
    totalUnits,
    completedUnits,
    completedUnitNumbers,
    percent: calculatePercent(completedUnits, totalUnits),
    status: getStatus(completedUnits, totalUnits),
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

/** Todos os livros com progresso calculado a partir do banco. */
async function listBooksWithProgress(db, userId) {
  const [booksResult, unitsResult, doneResult] = await Promise.all([
    db.query('SELECT id, slug, title, level, color, position FROM books ORDER BY position'),
    db.query('SELECT book_id, COUNT(*) AS total FROM units GROUP BY book_id'),
    db.query(
      `SELECT u.book_id, u.number, up.updated_at
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

/** Unidades 01..16 de um livro com o estado de conclusão do usuário. */
async function listUnits(db, userId, book) {
  const { rows } = await db.query(
    `SELECT u.number, COALESCE(up.completed, false) AS completed, up.completed_at, up.updated_at
       FROM units u
       LEFT JOIN unit_progress up ON up.unit_id = u.id AND up.user_id = $1
      WHERE u.book_id = $2
      ORDER BY u.number`,
    [userId, book.id],
  );
  return rows.map((row) => ({
    number: row.number,
    label: `Unit ${String(row.number).padStart(2, '0')}`,
    completed: row.completed === true,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }));
}

/** Marca/desmarca uma unidade (idempotente). */
async function setUnitCompleted(db, userId, book, number, completed) {
  const { rows } = await db.query('SELECT id FROM units WHERE book_id = $1 AND number = $2', [book.id, number]);
  if (!rows[0]) throw notFound('Unidade não encontrada.', 'UNIT_NOT_FOUND');

  const now = new Date();
  await db.query(
    `INSERT INTO unit_progress (user_id, unit_id, completed, completed_at, updated_at)
          VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, unit_id)
     DO UPDATE SET completed = EXCLUDED.completed,
                   completed_at = EXCLUDED.completed_at,
                   updated_at = EXCLUDED.updated_at`,
    [userId, rows[0].id, completed, completed ? now : null, now],
  );

  return {
    unit: { number, completed, updatedAt: now.toISOString() },
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
