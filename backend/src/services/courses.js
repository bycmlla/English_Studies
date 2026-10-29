'use strict';

const { notFound } = require('../errors');
const { calculatePercent, getStatus } = require('./progress');
const { getOverview } = require('./books');

// Cursos da tela "Meus Estudos". Cada curso tem progresso independente, sempre calculado
// a partir do que está salvo no banco (nenhum percentual fixo no código).

const toCourse = (row) => ({
  slug: row.slug,
  title: row.title,
  description: row.description,
  kind: row.kind,
  position: row.position,
});

function summarize(completed, total) {
  return { completed, total, percent: calculatePercent(completed, total), status: getStatus(completed, total) };
}

/** Progresso de cada curso 'lessons': aulas concluídas / total de aulas. Sem aulas = 0%, não iniciado. */
async function lessonProgressByCourse(db, userId) {
  const { rows } = await db.query(
    `SELECT m.course_id, p.completed
       FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
       LEFT JOIN course_lesson_progress p ON p.lesson_id = l.id AND p.user_id = $1`,
    [userId],
  );
  const byCourse = new Map();
  for (const row of rows) {
    const tally = byCourse.get(row.course_id) ?? { completed: 0, total: 0 };
    tally.total += 1;
    if (row.completed === true) tally.completed += 1;
    byCourse.set(row.course_id, tally);
  }
  return byCourse;
}

async function progressOf(db, userId, course, lessonTallies) {
  if (course.kind === 'english_journey') {
    // Mesma lógica do painel dos livros: atividades (Student's Book + Workbook) concluídas.
    const overview = await getOverview(db, userId);
    return summarize(overview.completedTasks, overview.totalTasks);
  }
  const tally = lessonTallies.get(course.id) ?? { completed: 0, total: 0 };
  return summarize(tally.completed, tally.total);
}

async function loadCourses(db) {
  const { rows } = await db.query('SELECT id, slug, title, description, kind, position FROM courses ORDER BY position');
  return rows;
}

/** Todos os cursos com o progresso do usuário (tela Meus Estudos). */
async function listCourses(db, userId) {
  const [courses, tallies] = await Promise.all([loadCourses(db), lessonProgressByCourse(db, userId)]);
  return Promise.all(
    courses.map(async (course) => ({ ...toCourse(course), progress: await progressOf(db, userId, course, tallies) })),
  );
}

/** Um curso com progresso e, nos cursos de aulas, módulos → aulas com o estado de cada uma. */
async function getCourse(db, userId, slug) {
  const courses = await loadCourses(db);
  const course = courses.find((item) => item.slug === slug);
  if (!course) throw notFound('Curso não encontrado.', 'COURSE_NOT_FOUND');

  const tallies = await lessonProgressByCourse(db, userId);
  const result = { ...toCourse(course), progress: await progressOf(db, userId, course, tallies), modules: [] };
  if (course.kind !== 'lessons') return result;

  const [modules, lessons] = await Promise.all([
    db.query('SELECT id, position, title FROM course_modules WHERE course_id = $1 ORDER BY position', [course.id]),
    db.query(
      `SELECT l.id, l.module_id, l.position, l.title, p.completed
         FROM course_lessons l
         JOIN course_modules m ON m.id = l.module_id
         LEFT JOIN course_lesson_progress p ON p.lesson_id = l.id AND p.user_id = $2
        WHERE m.course_id = $1
        ORDER BY m.position, l.position`,
      [course.id, userId],
    ),
  ]);

  result.modules = modules.rows.map((module) => {
    const items = lessons.rows
      .filter((lesson) => lesson.module_id === module.id)
      .map((lesson) => ({ id: lesson.id, position: lesson.position, title: lesson.title, completed: lesson.completed === true }));
    return {
      id: module.id,
      position: module.position,
      title: module.title,
      progress: summarize(items.filter((lesson) => lesson.completed).length, items.length),
      lessons: items,
    };
  });
  return result;
}

/** Marca/desmarca uma aula de um curso de aulas (idempotente) e devolve o progresso do curso. */
async function setLessonCompleted(db, userId, slug, lessonId, completed) {
  const { rows } = await db.query(
    `SELECT l.id
       FROM course_lessons l
       JOIN course_modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
      WHERE c.slug = $1 AND c.kind = 'lessons' AND l.id = $2`,
    [slug, lessonId],
  );
  if (!rows[0]) throw notFound('Aula não encontrada.', 'LESSON_NOT_FOUND');

  const now = new Date();
  await db.query(
    `INSERT INTO course_lesson_progress (user_id, lesson_id, completed, completed_at, updated_at)
          VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, lesson_id)
     DO UPDATE SET completed = EXCLUDED.completed,
                   completed_at = EXCLUDED.completed_at,
                   updated_at = EXCLUDED.updated_at`,
    [userId, lessonId, completed, completed ? now : null, now],
  );

  const course = await getCourse(db, userId, slug);
  return { lesson: { id: lessonId, completed, updatedAt: now.toISOString() }, progress: course.progress };
}

module.exports = { listCourses, getCourse, setLessonCompleted };
