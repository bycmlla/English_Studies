// Estado em memória de Conteúdos de Estudo + marcar/desmarcar assuntos.
// Totalmente separado do store dos livros: o progresso de estudo nunca altera (nem é alterado
// por) Student's Book / Workbook. O servidor é a fonte oficial; a tela atualiza de forma
// otimista e, se a gravação falhar, volta ao último estado confirmado pela API.
import * as api from './api.js';
import { calculatePercent } from './progress.js';
import { track } from './sync.js';

export const CATEGORY_LABEL = Object.freeze({
  grammar: 'Gramática',
  vocabulary: 'Vocabulário',
  communication: 'Comunicação',
  listening: 'Listening',
  reading: 'Reading',
  writing: 'Writing',
  pronunciation: 'Pronunciation',
});
export const CATEGORY_ORDER = Object.freeze(Object.keys(CATEGORY_LABEL));

export const study = {
  status: 'idle', // idle | loading | ready | error
  error: '',
  /** @type {Array<{slug, title, level, color, units: Array<{number, label, title, topics: Array<object>}>}>} */
  books: [],
};

/** id -> { id, category, title, done (exibido), confirmed (último estado salvo) } */
const topics = new Map();
const pending = new Map(); // id -> gravações em andamento
const chains = new Map(); // id -> Promise (serializa gravações do mesmo assunto)

const listeners = new Set();
export function subscribeStudy(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const emit = (event) => listeners.forEach((fn) => fn(event));

export function clearStudy() {
  study.status = 'idle';
  study.error = '';
  study.books = [];
  topics.clear();
  pending.clear();
  chains.clear();
}

function ingest(data) {
  topics.clear();
  study.books = data.books.map((book) => ({
    slug: book.slug,
    title: book.title,
    level: book.level,
    color: book.color,
    units: book.units.map((unit) => ({
      number: unit.number,
      label: unit.label,
      title: unit.title,
      topics: unit.topics.map((topic) => {
        const entry = { id: topic.id, category: topic.category, title: topic.title, done: topic.completed, confirmed: topic.completed };
        topics.set(topic.id, entry);
        return entry;
      }),
    })),
  }));
}

export async function loadStudy() {
  if (study.status === 'loading') return;
  study.status = 'loading';
  study.error = '';
  emit({ type: 'status' });
  try {
    ingest(await api.getStudy());
    study.status = 'ready';
  } catch (error) {
    study.status = 'error';
    study.error = error.message;
  }
  emit({ type: 'status' });
}

// ---------- progresso (mesma fórmula do backend: concluídos / total × 100) ----------

const tally = (list) => {
  const completed = list.reduce((sum, topic) => sum + (topic.done ? 1 : 0), 0);
  return { completed, total: list.length, percent: calculatePercent(completed, list.length) };
};

export const unitProgress = (unit) => tally(unit.topics);
export const bookProgress = (book) => tally(book.units.flatMap((unit) => unit.topics));
export const overallProgress = () => tally(study.books.flatMap((book) => book.units.flatMap((unit) => unit.topics)));

/** Agrupa os assuntos de uma unidade por categoria, na ordem de exibição. */
export function groupByCategory(unit) {
  return CATEGORY_ORDER
    .map((category) => ({ category, label: CATEGORY_LABEL[category], topics: unit.topics.filter((topic) => topic.category === category) }))
    .filter((group) => group.topics.length > 0);
}

/**
 * Marca/desmarca um assunto. Retorna uma Promise com true (salvo) ou false (falhou).
 * `onFailure(error, retry)` permite à tela avisar o usuário e oferecer nova tentativa.
 */
export function toggleTopic(id, completed, { onFailure } = {}) {
  const topic = topics.get(id);
  if (!topic) return Promise.resolve(false);

  topic.done = completed;
  pending.set(id, (pending.get(id) || 0) + 1);
  emit({ type: 'topic', id });

  const run = async () => {
    try {
      await track(api.setStudyTopic(id, completed));
      topic.confirmed = completed;
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const current = (chains.get(id) || Promise.resolve()).then(run).then((outcome) => {
    pending.set(id, pending.get(id) - 1);
    // Só reverte quando não há mais gravações pendentes deste assunto (cliques rápidos).
    if (pending.get(id) === 0) topic.done = topic.confirmed;
    emit({ type: 'topic', id });
    if (!outcome.ok) onFailure?.(outcome.error, () => toggleTopic(id, completed, { onFailure }));
    return outcome.ok;
  });
  chains.set(id, current);
  return current;
}
