'use strict';

const { notFound } = require('../errors');
const { calculatePercent } = require('./progress');

// Conteúdos de Estudo: assuntos de cada unidade. O progresso aqui é totalmente
// independente de unit_progress (Student's Book / Workbook): nenhuma das tabelas é lida
// ou gravada pela outra funcionalidade.

/** { completed, total, percent } — ex.: 8 de 10 assuntos = 80%. */
function summarizeTopics(completed, total) {
  return { completed, total, percent: calculatePercent(completed, total) };
}

const countDone = (topics) => topics.reduce((sum, topic) => sum + (topic.completed ? 1 : 0), 0);

/** Todos os níveis → unidades → assuntos, com o estado de cada assunto e os progressos calculados. */
async function listStudyContents(db, userId) {
  const [books, units, topics, done] = await Promise.all([
    db.query('SELECT id, slug, title, level, color, position FROM books ORDER BY position'),
    db.query('SELECT id, book_id, number, title FROM units ORDER BY id'),
    db.query('SELECT id, unit_id, category, title FROM study_topics ORDER BY unit_id, position'),
    db.query('SELECT topic_id, updated_at FROM study_topic_progress WHERE user_id = $1 AND completed = true', [userId]),
  ]);

  const doneAt = new Map(done.rows.map((row) => [row.topic_id, row.updated_at]));
  const topicsByUnit = new Map();
  for (const row of topics.rows) {
    if (!topicsByUnit.has(row.unit_id)) topicsByUnit.set(row.unit_id, []);
    topicsByUnit.get(row.unit_id).push({
      id: row.id,
      category: row.category,
      title: row.title,
      completed: doneAt.has(row.id),
    });
  }

  let lastActivityAt = null;
  for (const at of doneAt.values()) {
    const date = at ? new Date(at) : null;
    if (date && (!lastActivityAt || date > lastActivityAt)) lastActivityAt = date;
  }

  const outBooks = books.rows.map((book) => {
    const bookUnits = units.rows
      .filter((unit) => unit.book_id === book.id)
      .map((unit) => {
        const list = topicsByUnit.get(unit.id) ?? [];
        return {
          number: unit.number,
          label: `Unit ${String(unit.number).padStart(2, '0')}`,
          title: unit.title,
          progress: summarizeTopics(countDone(list), list.length),
          topics: list,
        };
      });
    const total = bookUnits.reduce((sum, unit) => sum + unit.progress.total, 0);
    const completed = bookUnits.reduce((sum, unit) => sum + unit.progress.completed, 0);
    return {
      slug: book.slug,
      title: book.title,
      level: book.level,
      color: book.color,
      position: book.position,
      progress: summarizeTopics(completed, total),
      units: bookUnits,
    };
  });

  const total = outBooks.reduce((sum, book) => sum + book.progress.total, 0);
  const completed = outBooks.reduce((sum, book) => sum + book.progress.completed, 0);
  return {
    progress: summarizeTopics(completed, total),
    lastActivityAt: lastActivityAt ? lastActivityAt.toISOString() : null,
    books: outBooks,
  };
}

/** Marca/desmarca um assunto (idempotente) e devolve os progressos recalculados. */
async function setTopicCompleted(db, userId, topicId, completed) {
  const { rows } = await db.query('SELECT id FROM study_topics WHERE id = $1', [topicId]);
  if (!rows[0]) throw notFound('Assunto não encontrado.', 'TOPIC_NOT_FOUND');

  const now = new Date();
  await db.query(
    `INSERT INTO study_topic_progress (user_id, topic_id, completed, completed_at, updated_at)
          VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, topic_id)
     DO UPDATE SET completed = EXCLUDED.completed,
                   completed_at = EXCLUDED.completed_at,
                   updated_at = EXCLUDED.updated_at`,
    [userId, topicId, completed, completed ? now : null, now],
  );

  const unitId = Math.floor(topicId / 100);
  const bookId = Math.floor(unitId / 100);
  const { rows: all } = await db.query(
    `SELECT t.unit_id, u.book_id, p.completed
       FROM study_topics t
       JOIN units u ON u.id = t.unit_id
       LEFT JOIN study_topic_progress p ON p.topic_id = t.id AND p.user_id = $1`,
    [userId],
  );
  const tally = (predicate) => {
    const scope = all.filter(predicate);
    return summarizeTopics(scope.filter((row) => row.completed === true).length, scope.length);
  };

  return {
    topic: { id: topicId, completed, updatedAt: now.toISOString() },
    progress: {
      unit: tally((row) => row.unit_id === unitId),
      book: tally((row) => row.book_id === bookId),
      overall: tally(() => true),
    },
  };
}

module.exports = { summarizeTopics, listStudyContents, setTopicCompleted };
