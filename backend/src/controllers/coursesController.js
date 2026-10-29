'use strict';

const courses = require('../services/courses');
const { parseId, validateCompletedUpdate } = require('../validators');

const list = async (req, res) => {
  res.json({ courses: await courses.listCourses(req.app.locals.db, req.user.id) });
};

const show = async (req, res) => {
  res.json({ course: await courses.getCourse(req.app.locals.db, req.user.id, req.params.courseSlug) });
};

const updateLesson = async (req, res) => {
  const lessonId = parseId(req.params.lessonId, 'id da aula');
  const { completed } = validateCompletedUpdate(req.body);
  res.json(await courses.setLessonCompleted(req.app.locals.db, req.user.id, req.params.courseSlug, lessonId, completed));
};

module.exports = { list, show, updateLesson };
