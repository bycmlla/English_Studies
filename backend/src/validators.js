'use strict';

const { AppError, badRequest } = require('./errors');
const { UNITS_PER_BOOK } = require('./services/progress');

const MATERIAL_KINDS = ['student_book', 'workbook', 'audio'];
const MAX_MATERIALS_PER_BOOK = 30;
const MAX_NOTES_LENGTH = 20000;
const MAX_TITLE_LENGTH = 120;
const MAX_URL_LENGTH = 2048;
const BACKUP_APP_ID = 'my-english-journey';
const BACKUP_VERSION = 1;

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

function validateUnitUpdate(body) {
  if (!isPlainObject(body) || typeof body.completed !== 'boolean') {
    throw badRequest('Informe "completed" como true ou false.');
  }
  return body.completed;
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
  if (data.version !== BACKUP_VERSION) errors.push(`Versão de backup não suportada (esperado ${BACKUP_VERSION})`);
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

    const completedUnits = entry.completedUnits ?? [];
    if (
      !Array.isArray(completedUnits) ||
      completedUnits.some((n) => !Number.isInteger(n) || n < 1 || n > UNITS_PER_BOOK) ||
      new Set(completedUnits).size !== completedUnits.length
    ) {
      errors.push(`${label}: completedUnits deve ser uma lista de números únicos entre 1 e ${UNITS_PER_BOOK}`);
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
      completedUnits: Array.isArray(completedUnits) ? [...completedUnits].sort((a, b) => a - b) : [],
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
  validateLogin,
  parseUnitNumber,
  parseId,
  validateUnitUpdate,
  validateMaterial,
  validateNotes,
  validateBackup,
};
