'use strict';

const { AppError, badRequest } = require('./errors');
const { UNITS_PER_BOOK, BOOK_TYPES } = require('./services/progress');

const MATERIAL_KINDS = ['student_book', 'workbook', 'audio'];
const MAX_MATERIALS_PER_BOOK = 30;
const MAX_NOTES_LENGTH = 20000;
const MAX_TITLE_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const BACKUP_APP_ID = 'my-english-journey';
const BACKUP_VERSION = 2; // versão gravada ao exportar
const SUPPORTED_BACKUP_VERSIONS = [1, 2]; // v1 não tinha Workbook

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Retorna mensagens de erro (vazio se válido) e o valor normalizado. */
function checkMaterial(input, label = 'material') {
  const errors = [];
  if (!isPlainObject(input)) return { errors: [`${label}: formato inválido`], value: null };

  if (!MATERIAL_KINDS.includes(input.kind)) {
    errors.push(`${label}: kind deve ser um de ${MATERIAL_KINDS.join(', ')}`);
  }

  let title = null;
  if (input.title !== undefined && input.title !== null && input.title !== '') {
    if (typeof input.title !== 'string') errors.push(`${label}: título deve ser texto`);
    else {
      title = input.title.trim();
      if (title.length > MAX_TITLE_LENGTH) {
        errors.push(`${label}: título deve ter no máximo ${MAX_TITLE_LENGTH} caracteres`);
      }
      if (title === '') title = null;
    }
  }

  let url = '';
  if (typeof input.url !== 'string' || input.url.trim() === '') {
    errors.push(`${label}: url é obrigatória`);
  } else {
    url = input.url.trim();
    if (url.length > MAX_URL_LENGTH) {
      errors.push(`${label}: url deve ter no máximo ${MAX_URL_LENGTH} caracteres`);
    } else {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errors.push(`${label}: url deve começar com http:// ou https://`);
        }
      } catch {
        errors.push(`${label}: url inválida`);
      }
    }
  }

  return { errors, value: { kind: input.kind, title, url } };
}

function validateLogin(body) {
  if (!isPlainObject(body)) throw badRequest('Corpo da requisição inválido.');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw badRequest('Informe um e-mail válido.');
  }
  if (!password || password.length > 200) throw badRequest('Informe a senha.');
  return { email, password };
}

function parseUnitNumber(raw) {
  const number = /^\d{1,3}$/.test(String(raw)) ? Number(raw) : NaN;
  if (!Number.isInteger(number) || number < 1 || number > UNITS_PER_BOOK) {
    throw badRequest(`O número da unidade deve estar entre 1 e ${UNITS_PER_BOOK}.`);
  }
  return number;
}

function parseId(raw, label = 'id') {
  const id = /^\d{1,9}$/.test(String(raw)) ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id < 1) throw badRequest(`${label} inválido.`);
  return id;
}

/** Corpo de PUT /units/:n -> { completed, bookType }. bookType é opcional (padrão: student_book). */
function validateUnitUpdate(body) {
  if (!isPlainObject(body) || typeof body.completed !== 'boolean') {
    throw badRequest('Informe "completed" como true ou false.');
  }
  const bookType = body.bookType ?? 'student_book';
  if (!BOOK_TYPES.includes(bookType)) {
    throw badRequest(`"bookType" deve ser um de: ${BOOK_TYPES.join(', ')}.`);
  }
  return { completed: body.completed, bookType };
}

/** Corpo de PUT de assunto/aula -> { completed }. */
function validateCompletedUpdate(body) {
  if (!isPlainObject(body) || typeof body.completed !== 'boolean') {
    throw badRequest('Informe "completed" como true ou false.');
  }
  return { completed: body.completed };
}

const MAX_MATERIAL_NAME_LENGTH = 160;
const MAX_MATERIAL_DESCRIPTION_LENGTH = 500;
const MAX_CATEGORY_NAME_LENGTH = 60;

/** Corpo de POST/PUT de material de curso (Materiais de Estudo). */
function validateCourseMaterial(body) {
  if (!isPlainObject(body)) throw badRequest('Corpo da requisição inválido.');
  const errors = [];

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) errors.push('Informe o nome do material.');
  else if (title.length > MAX_MATERIAL_NAME_LENGTH) errors.push(`O nome deve ter no máximo ${MAX_MATERIAL_NAME_LENGTH} caracteres.`);

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) errors.push('Informe a URL do material.');
  else if (url.length > MAX_URL_LENGTH) errors.push(`A URL deve ter no máximo ${MAX_URL_LENGTH} caracteres.`);
  else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') errors.push('A URL deve começar com http:// ou https://.');
    } catch {
      errors.push('URL inválida.');
    }
  }

  let description = '';
  if (body.description !== undefined && body.description !== null && body.description !== '') {
    if (typeof body.description !== 'string') errors.push('A descrição deve ser texto.');
    else {
      description = body.description.trim();
      if (description.length > MAX_MATERIAL_DESCRIPTION_LENGTH) {
        errors.push(`A descrição deve ter no máximo ${MAX_MATERIAL_DESCRIPTION_LENGTH} caracteres.`);
      }
    }
  }

  const categoryId = body.categoryId;
  if (!Number.isInteger(categoryId) || categoryId < 1) errors.push('Escolha a categoria.');

  const bookSlug = body.bookSlug ?? null;
  if (bookSlug !== null && (typeof bookSlug !== 'string' || bookSlug.length > 40)) errors.push('Nível inválido.');

  const unitNumber = body.unitNumber ?? null;
  if (unitNumber !== null && (!Number.isInteger(unitNumber) || unitNumber < 1 || unitNumber > UNITS_PER_BOOK)) {
    errors.push(`A unidade deve estar entre 1 e ${UNITS_PER_BOOK}.`);
  }

  if (errors.length > 0) throw badRequest(errors[0], errors);
  return { title, url, description: description || null, categoryId, bookSlug, unitNumber };
}

/** Corpo de POST/PUT de categoria -> { name }. */
function validateCategoryName(body) {
  const name = isPlainObject(body) && typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw badRequest('Informe o nome da categoria.');
  if (name.length > MAX_CATEGORY_NAME_LENGTH) throw badRequest(`O nome deve ter no máximo ${MAX_CATEGORY_NAME_LENGTH} caracteres.`);
  return { name };
}

function validateMaterial(body) {
  const { errors, value } = checkMaterial(body);
  if (errors.length > 0) throw badRequest(errors[0], errors);
  return value;
}

function validateNotes(body) {
  if (!isPlainObject(body) || typeof body.content !== 'string') {
    throw badRequest('Informe "content" como texto.');
  }
  if (body.content.length > MAX_NOTES_LENGTH) {
    throw badRequest(`As anotações devem ter no máximo ${MAX_NOTES_LENGTH} caracteres.`);
  }
  return body.content;
}

/**
 * Valida e normaliza um arquivo de backup.
 * @param {unknown} data conteúdo JSON
 * @param {string[]} validSlugs slugs de livros existentes
 */
function validateBackup(data, validSlugs) {
  const errors = [];
  const fail = () => {
    throw new AppError(400, 'INVALID_BACKUP', 'O arquivo de backup é inválido.', errors.slice(0, 20));
  };

  if (!isPlainObject(data)) {
    errors.push('O backup deve ser um objeto JSON');
    fail();
  }
  if (data.app !== BACKUP_APP_ID) errors.push(`Campo "app" deve ser "${BACKUP_APP_ID}"`);
  if (!SUPPORTED_BACKUP_VERSIONS.includes(data.version)) {
    errors.push(`Versão de backup não suportada (esperado ${SUPPORTED_BACKUP_VERSIONS.join(' ou ')})`);
  }
  if (!Array.isArray(data.books)) {
    errors.push('Campo "books" deve ser uma lista');
    fail();
  }
  if (errors.length > 0) fail();

  const seen = new Set();
  const books = [];

  data.books.forEach((entry, index) => {
    const label = `books[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${label}: formato inválido`);
      return;
    }
    if (!validSlugs.includes(entry.slug)) {
      errors.push(`${label}: livro desconhecido "${String(entry.slug).slice(0, 40)}"`);
      return;
    }
    if (seen.has(entry.slug)) {
      errors.push(`${label}: livro "${entry.slug}" repetido`);
      return;
    }
    seen.add(entry.slug);

    const unitList = (field, value) => {
      if (
        !Array.isArray(value) ||
        value.some((n) => !Number.isInteger(n) || n < 1 || n > UNITS_PER_BOOK) ||
        new Set(value).size !== value.length
      ) {
        errors.push(`${label}: ${field} deve ser uma lista de números únicos entre 1 e ${UNITS_PER_BOOK}`);
        return [];
      }
      return [...value].sort((a, b) => a - b);
    };
    // completedUnits = Student's Book (nome mantido por compatibilidade com backups v1).
    const completedUnits = unitList('completedUnits', entry.completedUnits ?? []);
    // Backups v1 não têm Workbook: null significa "não mexer no Workbook ao importar".
    const workbookCompletedUnits =
      entry.workbookCompletedUnits === undefined ? null : unitList('workbookCompletedUnits', entry.workbookCompletedUnits);

    // studyTopics = ids dos assuntos de Conteúdos de Estudo concluídos. Opcional: backups
    // anteriores não o trazem, e então o progresso de estudo existente não é alterado (null).
    let studyTopics = null;
    if (entry.studyTopics !== undefined) {
      if (
        !Array.isArray(entry.studyTopics) ||
        entry.studyTopics.length > 5000 ||
        entry.studyTopics.some((id) => !Number.isInteger(id) || id < 10101 || id > 99999) ||
        new Set(entry.studyTopics).size !== entry.studyTopics.length
      ) {
        errors.push(`${label}: studyTopics deve ser uma lista de ids únicos de assuntos`);
      } else {
        studyTopics = [...entry.studyTopics].sort((a, b) => a - b);
      }
    }

    const notes = entry.notes ?? '';
    if (typeof notes !== 'string' || notes.length > MAX_NOTES_LENGTH) {
      errors.push(`${label}: notes deve ser texto de até ${MAX_NOTES_LENGTH} caracteres`);
    }

    const rawMaterials = entry.materials ?? [];
    const materials = [];
    if (!Array.isArray(rawMaterials) || rawMaterials.length > MAX_MATERIALS_PER_BOOK) {
      errors.push(`${label}: materials deve ser uma lista com no máximo ${MAX_MATERIALS_PER_BOOK} itens`);
    } else {
      rawMaterials.forEach((raw, i) => {
        const result = checkMaterial(raw, `${label}.materials[${i}]`);
        errors.push(...result.errors);
        if (result.errors.length === 0) materials.push(result.value);
      });
    }

    books.push({
      slug: entry.slug,
      completedUnits,
      workbookCompletedUnits,
      studyTopics,
      notes: typeof notes === 'string' ? notes : '',
      materials,
    });
  });

  if (errors.length > 0) fail();
  return { books };
}

module.exports = {
  MATERIAL_KINDS,
  MAX_MATERIALS_PER_BOOK,
  BACKUP_APP_ID,
  BACKUP_VERSION,
  SUPPORTED_BACKUP_VERSIONS,
  validateLogin,
  parseUnitNumber,
  parseId,
  validateUnitUpdate,
  validateCompletedUpdate,
  validateMaterial,
  validateCourseMaterial,
  validateCategoryName,
  validateNotes,
  validateBackup,
};
