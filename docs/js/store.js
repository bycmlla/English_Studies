// Estado em memória dos livros + lógica de marcar/desmarcar unidades.
// O servidor é a fonte oficial: a interface atualiza de forma otimista e, se a
// gravação falhar, volta ao último estado confirmado pela API.
import * as api from './api.js';
import { calculatePercent, getStatus, summarizeOverall } from './progress.js';
import { track } from './sync.js';

export const store = {
  /** @type {Array<object>} */
  books: [],
  loadedAt: 0,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const resetSubscribers = () => listeners.clear();
const emit = (event) => listeners.forEach((fn) => fn(event));

const pendingByBook = new Map(); // slug -> operações em andamento
const pendingByUnit = new Map(); // `${slug}:${n}` -> operações em andamento
const queues = new Map(); // slug -> Promise (serializa gravações do mesmo livro)

const bump = (map, key, delta) => map.set(key, (map.get(key) || 0) + delta);

function fromApi(book) {
  return {
    slug: book.slug,
    title: book.title,
    level: book.level,
    color: book.color,
    totalUnits: book.totalUnits,
    lastActivityAt: book.lastActivityAt,
    done: new Set(book.completedUnitNumbers), // estado exibido (otimista)
    confirmed: new Set(book.completedUnitNumbers), // último estado confirmado pelo servidor
  };
}

/** Visão derivada: porcentagem, status e contagem sempre calculados a partir de `done`. */
export function viewOf(book) {
  const completedUnits = book.done.size;
  return {
    ...book,
    completedUnits,
    percent: calculatePercent(completedUnits, book.totalUnits),
    status: getStatus(completedUnits, book.totalUnits),
  };
}

export const getBook = (slug) => store.books.find((book) => book.slug === slug);
export const overview = () => summarizeOverall(store.books.map(viewOf));
export const hasPendingWrites = () => [...pendingByBook.values()].some((n) => n > 0);

export async function loadBooks() {
  const books = await api.listBooks();
  store.books = books.map(fromApi);
  store.loadedAt = Date.now();
  emit({ type: 'reload' });
}

/** Recarrega do servidor (ex.: ao voltar para a aba), sem sobrescrever gravações em andamento. */
export async function refreshBooks() {
  if (hasPendingWrites()) return;
  const books = await api.listBooks();
  if (hasPendingWrites()) return;
  store.books = books.map(fromApi);
  store.loadedAt = Date.now();
  emit({ type: 'reload' });
}

export function clearStore() {
  store.books = [];
  store.loadedAt = 0;
  pendingByBook.clear();
  pendingByUnit.clear();
  queues.clear();
}

/**
 * Marca/desmarca uma unidade. Retorna uma Promise que resolve com true (salvo) ou false (falhou).
 * `onFailure(retry)` é chamado quando a gravação falha, para a interface avisar o usuário.
 */
export function toggleUnit(slug, number, completed, { onFailure } = {}) {
  const book = getBook(slug);
  if (!book) return Promise.resolve(false);

  const unitKey = `${slug}:${number}`;
  if (completed) book.done.add(number);
  else book.done.delete(number);
  bump(pendingByBook, slug, 1);
  bump(pendingByUnit, unitKey, 1);
  emit({ type: 'book', slug });

  const run = async () => {
    try {
      const result = await track(api.setUnit(slug, number, completed));
      if (result.unit.completed) book.confirmed.add(number);
      else book.confirmed.delete(number);
      book.lastActivityAt = result.unit.updatedAt;
      return { ok: true, server: result.book };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const previous = queues.get(slug) || Promise.resolve();
  const current = previous.then(run).then((outcome) => {
    bump(pendingByBook, slug, -1);
    bump(pendingByUnit, unitKey, -1);

    // Só reverte/ajusta quando não há mais gravações pendentes desta unidade,
    // para que cliques rápidos não briguem entre si.
    if (pendingByUnit.get(unitKey) === 0) {
      if (book.confirmed.has(number)) book.done.add(number);
      else book.done.delete(number);
    }
    // Sem nada pendente no livro, adota o estado oficial devolvido pelo servidor
    // (inclui mudanças feitas em outro dispositivo).
    if (outcome.ok && pendingByBook.get(slug) === 0) {
      book.done = new Set(outcome.server.completedUnitNumbers);
      book.confirmed = new Set(outcome.server.completedUnitNumbers);
    }
    emit({ type: 'book', slug });

    if (!outcome.ok) onFailure?.(outcome.error, () => toggleUnit(slug, number, completed, { onFailure }));
    return outcome.ok;
  });
  queues.set(slug, current);
  return current;
}
