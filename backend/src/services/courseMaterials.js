'use strict';

const { AppError, badRequest, notFound } = require('../errors');

// Materiais de Estudo: links de apoio por curso (e, no My English Journey, por nível e unidade).
// Tudo é do usuário autenticado e independe do progresso de livros / estudo: cadastrar ou abrir
// um material nunca marca nada como concluído.

const MAX_MATERIALS_PER_COURSE = 1000;
const MAX_CUSTOM_CATEGORIES_PER_COURSE = 30;

const sameName = (a, b) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');
const iso = (value) => new Date(value).toISOString();

async function getCourse(db, slug) {
  const { rows } = await db.query('SELECT id, slug, title, kind FROM courses WHERE slug = $1', [slug]);
  if (!rows[0]) throw notFound('Curso não encontrado.', 'COURSE_NOT_FOUND');
  return rows[0];
}

const toCategory = (row) => ({ id: row.id, name: row.name, isDefault: row.user_id === null });

/** Categorias padrão (de todos) + as personalizadas do usuário neste curso. */
async function loadCategories(db, userId, courseId) {
  const { rows } = await db.query(
    `SELECT id, user_id, name, position
       FROM material_categories
      WHERE user_id IS NULL OR (user_id = $1 AND course_id = $2)
      ORDER BY position, id`,
    [userId, courseId],
  );
  return rows;
}

async function loadLevels(db, course) {
  if (course.kind !== 'english_journey') return [];
  const { rows } = await db.query('SELECT id, slug, title, level, color, position FROM books ORDER BY position');
  return rows;
}

function toMaterial(row) {
  return {
    id: row.id,
    bookSlug: row.book_slug ?? null,
    unitNumber: row.unit_number ?? null,
    categoryId: row.category_id,
    title: row.title,
    url: row.url,
    description: row.description ?? '',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

const MATERIAL_SELECT = `
  SELECT m.id, m.book_id, b.slug AS book_slug, b.position AS book_position, m.unit_number, m.category_id,
         m.title, m.url, m.description, m.created_at, m.updated_at
    FROM course_materials m
    LEFT JOIN books b ON b.id = m.book_id`;

/** Tudo o que a tela precisa de um curso: níveis, categorias e os materiais do usuário. */
async function listForCourse(db, userId, slug) {
  const course = await getCourse(db, slug);
  const [levels, categories, materials] = await Promise.all([
    loadLevels(db, course),
    loadCategories(db, userId, course.id),
    db.query(`${MATERIAL_SELECT} WHERE m.user_id = $1 AND m.course_id = $2`, [userId, course.id]),
  ]);

  // Nível, unidade em ordem crescente (sem unidade por último) e nome.
  const sorted = [...materials.rows].sort(
    (a, b) =>
      (a.book_position ?? 99) - (b.book_position ?? 99) ||
      (a.unit_number ?? 99) - (b.unit_number ?? 99) ||
      a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' }) ||
      a.id - b.id,
  );

  return {
    course: { slug: course.slug, title: course.title, kind: course.kind },
    levels: levels.map((b) => ({ slug: b.slug, title: b.title, level: b.level, color: b.color })),
    categories: categories.map(toCategory),
    materials: sorted.map(toMaterial),
  };
}

/** Confere categoria, nível e unidade contra o curso; devolve os ids a gravar. */
async function resolveReferences(db, userId, course, input) {
  const categories = await loadCategories(db, userId, course.id);
  if (!categories.some((category) => category.id === input.categoryId)) {
    throw badRequest('Categoria inválida para este curso.');
  }

  let bookId = null;
  if (course.kind === 'english_journey') {
    if (!input.bookSlug) throw badRequest('Escolha o nível.');
    const { rows } = await db.query('SELECT id FROM books WHERE slug = $1', [input.bookSlug]);
    if (!rows[0]) throw badRequest('Nível inválido.');
    bookId = rows[0].id;
  } else if (input.bookSlug) {
    throw badRequest('Este curso não tem níveis.');
  }
  if (input.unitNumber !== null && bookId === null) throw badRequest('A unidade só pode ser usada junto com um nível.');
  return { bookId, categoryId: input.categoryId };
}

async function getOwned(db, userId, course, id) {
  const { rows } = await db.query(`${MATERIAL_SELECT} WHERE m.id = $1 AND m.user_id = $2 AND m.course_id = $3`, [id, userId, course.id]);
  if (!rows[0]) throw notFound('Material não encontrado.', 'MATERIAL_NOT_FOUND');
  return rows[0];
}

async function createMaterial(db, userId, slug, input) {
  const course = await getCourse(db, slug);
  const { bookId, categoryId } = await resolveReferences(db, userId, course, input);

  const { rows: count } = await db.query(
    'SELECT COUNT(*) AS total FROM course_materials WHERE user_id = $1 AND course_id = $2',
    [userId, course.id],
  );
  if (Number(count[0].total) >= MAX_MATERIALS_PER_COURSE) {
    throw new AppError(409, 'LIMIT_REACHED', `Cada curso aceita até ${MAX_MATERIALS_PER_COURSE} materiais.`);
  }

  const { rows } = await db.query(
    `INSERT INTO course_materials (user_id, course_id, book_id, unit_number, category_id, title, url, description)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
    [userId, course.id, bookId, input.unitNumber, categoryId, input.title, input.url, input.description],
  );
  return toMaterial(await getOwned(db, userId, course, rows[0].id));
}

async function updateMaterial(db, userId, slug, id, input) {
  const course = await getCourse(db, slug);
  await getOwned(db, userId, course, id);
  const { bookId, categoryId } = await resolveReferences(db, userId, course, input);
  await db.query(
    `UPDATE course_materials
        SET book_id = $1, unit_number = $2, category_id = $3, title = $4, url = $5, description = $6, updated_at = now()
      WHERE id = $7 AND user_id = $8 AND course_id = $9`,
    [bookId, input.unitNumber, categoryId, input.title, input.url, input.description, id, userId, course.id],
  );
  return toMaterial(await getOwned(db, userId, course, id));
}

async function deleteMaterial(db, userId, slug, id) {
  const course = await getCourse(db, slug);
  await getOwned(db, userId, course, id);
  await db.query('DELETE FROM course_materials WHERE id = $1 AND user_id = $2 AND course_id = $3', [id, userId, course.id]);
}

// ---------- categorias personalizadas ----------

async function createCategory(db, userId, slug, name) {
  const course = await getCourse(db, slug);
  const existing = await loadCategories(db, userId, course.id);
  if (existing.some((category) => sameName(category.name, name))) {
    throw new AppError(409, 'CATEGORY_EXISTS', 'Já existe uma categoria com esse nome.');
  }
  if (existing.filter((category) => category.user_id !== null).length >= MAX_CUSTOM_CATEGORIES_PER_COURSE) {
    throw new AppError(409, 'LIMIT_REACHED', `Cada curso aceita até ${MAX_CUSTOM_CATEGORIES_PER_COURSE} categorias personalizadas.`);
  }
  const { rows } = await db.query(
    `INSERT INTO material_categories (user_id, course_id, name, position)
          VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, name`,
    [userId, course.id, name, 100 + existing.length],
  );
  return toCategory(rows[0]);
}

/** Categoria personalizada do usuário neste curso; as padrão são protegidas; outras não existem. */
async function getCustomCategory(db, userId, course, id) {
  const { rows } = await db.query('SELECT id, user_id, course_id, name FROM material_categories WHERE id = $1', [id]);
  const row = rows[0];
  if (row && row.user_id === null) throw new AppError(403, 'CATEGORY_PROTECTED', 'As categorias padrão não podem ser alteradas.');
  if (!row || row.user_id !== userId || row.course_id !== course.id) throw notFound('Categoria não encontrada.', 'CATEGORY_NOT_FOUND');
  return row;
}

async function renameCategory(db, userId, slug, id, name) {
  const course = await getCourse(db, slug);
  const category = await getCustomCategory(db, userId, course, id);
  const existing = await loadCategories(db, userId, course.id);
  if (existing.some((other) => other.id !== category.id && sameName(other.name, name))) {
    throw new AppError(409, 'CATEGORY_EXISTS', 'Já existe uma categoria com esse nome.');
  }
  await db.query('UPDATE material_categories SET name = $1 WHERE id = $2 AND user_id = $3', [name, id, userId]);
  return { id, name, isDefault: false };
}

async function deleteCategory(db, userId, slug, id) {
  const course = await getCourse(db, slug);
  await getCustomCategory(db, userId, course, id);
  const { rows } = await db.query('SELECT COUNT(*) AS total FROM course_materials WHERE category_id = $1', [id]);
  if (Number(rows[0].total) > 0) {
    throw new AppError(409, 'CATEGORY_IN_USE', 'Esta categoria tem materiais. Mova ou exclua os materiais antes de removê-la.');
  }
  await db.query('DELETE FROM material_categories WHERE id = $1 AND user_id = $2', [id, userId]);
}

module.exports = {
  listForCourse,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  createCategory,
  renameCategory,
  deleteCategory,
};
