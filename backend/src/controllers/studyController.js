'use strict';

const study = require('../services/study');
const { parseId, validateCompletedUpdate } = require('../validators');

const list = async (req, res) => {
  res.json(await study.listStudyContents(req.app.locals.db, req.user.id));
};

const updateTopic = async (req, res) => {
  const topicId = parseId(req.params.topicId, 'id do assunto');
  const { completed } = validateCompletedUpdate(req.body);
  res.json(await study.setTopicCompleted(req.app.locals.db, req.user.id, topicId, completed));
};

module.exports = { list, updateTopic };
