'use strict';

const { BACKUP_APP_ID, BACKUP_VERSION, validateBackup } = require('../validators');
const { listBookSlugs } = require('./books');

const numbersOf = (rows, bookId, type) =>
  rows.filter((row) => row.book_id === bookId && row.book_type === type).map((row) => row.number);

async function exportBackup(db, userId) {
  const [books, done, materials, notes] = await Promise.all([
    db.query('SELECT id, slug, title FROM books ORDER BY position'),
    db.query(
      `SELECT u.book_id, u.number, up.book_type
         FROM unit_progress up JOIN units u ON u.id = up.unit_id
        WHERE up.user_id = $1 AND up.completed = true
        ORDER BY u.book_id, u.number`,
      [userId],
    ),
    db.query(
      'SELECT book_id, kind, title, url FROM study_materials WHERE user_id = $1 ORDER BY id',
      [userId],
    ),
    db.query('SELECT book_id, content FROM book_notes WHERE user_id = $1', [userId]),
  ]);

  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    books: books.rows.map((book) => ({
      slug: book.slug,
      title: book.title,
      // completedUnits = Student's Book (nome mantido por compatibilidade com backups v1).
      completedUnits: numbersOf(done.rows, book.id, 'student_book'),
      workbookCompletedUnits: numbersOf(done.rows, book.id, 'workbook'),
      materials: materials.rows
        .filter((row) => row.book_id === book.id)
        .map(({ kind, title, url }) => ({ kind, title, url })),
      notes: notes.rows.find((row) => row.book_id === book.id)?.content ?? '',
    })),
  };
}

function summarize(normalized) {
  return {
    books: normalized.books.length,
    studentBookUnits: normalized.books.reduce((sum, book) => sum + book.completedUnits.length, 0),
    workbookUnits: normalized.books.reduce((sum, book) => sum + (book.workbookCompletedUnits?.length ?? 0), 0),
    materials: normalized.books.reduce((sum, book) => sum + book.materials.length, 0),
    notes: normalized.books.filter((book) => book.notes.trim() !== '').length,
  };
}

/**
 * Valida o backup e, a menos que dryRun seja true, substitui os dados dos livros
 * incluídos no arquivo (progresso, links e anotações) dentro de uma transação.
 * Livros que não estão no arquivo permanecem intactos; backups v1 (sem Workbook) não alteram o Workbook.
 */
async function importBackup(pool, userId, payload, { dryRun = false } = {}) {
  const slugs = await listBookSlugs(pool);
  const normalized = validateBackup(payload, slugs);
  const summary = summarize(normalized);
  if (dryRun) return { dryRun: true, imported: false, summary };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date();

    const { rows: bookRows } = await client.query('SELECT id, slug FROM books');
    const bookId = new Map(bookRows.map((row) => [row.slug, row.id]));

    for (const book of normalized.books) {
      const id = bookId.get(book.slug);

      const replaced = book.workbookCompletedUnits === null ? ['student_book'] : ['student_book', 'workbook'];
      await client.query(
        `DELETE FROM unit_progress
          WHERE user_id = $1 AND book_type = ANY($3)
            AND unit_id IN (SELECT id FROM units WHERE book_id = $2)`,
        [userId, id, replaced],
      );
      await client.query('DELETE FROM study_materials WHERE user_id = $1 AND book_id = $2', [userId, id]);
      await client.query('DELETE FROM book_notes WHERE user_id = $1 AND book_id = $2', [userId, id]);

      const progress = [
        ['student_book', book.completedUnits],
        ['workbook', book.workbookCompletedUnits ?? []],
      ];
      for (const [bookType, numbers] of progress) {
        for (const number of numbers) {
          await client.query(
            `INSERT INTO unit_progress (user_id, unit_id, book_type, completed, completed_at, updated_at)
                  VALUES ($1, $2, $3, true, $4, $4)`,
            [userId, id * 100 + number, bookType, now],
          );
        }
      }
      for (const material of book.materials) {
        await client.query(
          'INSERT INTO study_materials (user_id, book_id, kind, title, url) VALUES ($1, $2, $3, $4, $5)',
          [userId, id, material.kind, material.title, material.url],
        );
      }
      if (book.notes !== '') {
        await client.query(
          'INSERT INTO book_notes (user_id, book_id, content, updated_at) VALUES ($1, $2, $3, $4)',
          [userId, id, book.notes, now],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { dryRun: false, imported: true, summary };
}

module.exports = { exportBackup, importBackup };
