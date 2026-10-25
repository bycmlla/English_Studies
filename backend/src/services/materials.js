'use strict';

const { AppError, notFound } = require('../errors');
const { MAX_MATERIALS_PER_BOOK, MATERIAL_KINDS } = require('../validators');

const KIND_ORDER = Object.fromEntries(MATERIAL_KINDS.map((kind, index) => [kind, index]));

function toMaterial(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function listMaterials(db, userId, book) {
  const { rows } = await db.query(
    `SELECT id, kind, title, url, created_at, updated_at
       FROM study_materials
      WHERE user_id = $1 AND book_id = $2
      ORDER BY id`,
    [userId, book.id],
  );
  return rows.map(toMaterial).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id - b.id);
}

async function createMaterial(db, userId, book, { kind, title, url }) {
  const { rows: count } = await db.query(
    'SELECT COUNT(*) AS total FROM study_materials WHERE user_id = $1 AND book_id = $2',
    [userId, book.id],
  );
  if (Number(count[0].total) >= MAX_MATERIALS_PER_BOOK) {
    throw new AppError(409, 'LIMIT_REACHED', `Cada livro aceita até ${MAX_MATERIALS_PER_BOOK} links.`);
  }
  const { rows } = await db.query(
    `INSERT INTO study_materials (user_id, book_id, kind, title, url)
          VALUES ($1, $2, $3, $4, $5)
       RETURNING id, kind, title, url, created_at, updated_at`,
    [userId, book.id, kind, title, url],
  );
  return toMaterial(rows[0]);
}

async function updateMaterial(db, userId, book, id, { kind, title, url }) {
  const { rows } = await db.query(
    `UPDATE study_materials
        SET kind = $1, title = $2, url = $3, updated_at = now()
      WHERE id = $4 AND user_id = $5 AND book_id = $6
  RETURNING id, kind, title, url, created_at, updated_at`,
    [kind, title, url, id, userId, book.id],
  );
  if (!rows[0]) throw notFound('Link não encontrado.', 'MATERIAL_NOT_FOUND');
  return toMaterial(rows[0]);
}

async function deleteMaterial(db, userId, book, id) {
  const { rowCount } = await db.query(
    'DELETE FROM study_materials WHERE id = $1 AND user_id = $2 AND book_id = $3',
    [id, userId, book.id],
  );
  if (rowCount === 0) throw notFound('Link não encontrado.', 'MATERIAL_NOT_FOUND');
}

module.exports = { listMaterials, createMaterial, updateMaterial, deleteMaterial };
