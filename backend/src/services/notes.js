'use strict';

async function getNotes(db, userId, book) {
  const { rows } = await db.query(
    'SELECT content, updated_at FROM book_notes WHERE user_id = $1 AND book_id = $2',
    [userId, book.id],
  );
  if (!rows[0]) return { content: '', updatedAt: null };
  return { content: rows[0].content, updatedAt: new Date(rows[0].updated_at).toISOString() };
}

async function saveNotes(db, userId, book, content) {
  const now = new Date();
  await db.query(
    `INSERT INTO book_notes (user_id, book_id, content, updated_at)
          VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, book_id)
     DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at`,
    [userId, book.id, content, now],
  );
  return { content, updatedAt: now.toISOString() };
}

module.exports = { getNotes, saveNotes };
