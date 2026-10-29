'use strict';

const materials = require('../services/courseMaterials');
const { parseId, validateCourseMaterial, validateCategoryName } = require('../validators');

const db = (req) => req.app.locals.db;

const list = async (req, res) => {
  res.json(await materials.listForCourse(db(req), req.user.id, req.params.courseSlug));
};

const create = async (req, res) => {
  const input = validateCourseMaterial(req.body);
  res.status(201).json({ material: await materials.createMaterial(db(req), req.user.id, req.params.courseSlug, input) });
};

const update = async (req, res) => {
  const id = parseId(req.params.materialId, 'id do material');
  const input = validateCourseMaterial(req.body);
  res.json({ material: await materials.updateMaterial(db(req), req.user.id, req.params.courseSlug, id, input) });
};

const remove = async (req, res) => {
  await materials.deleteMaterial(db(req), req.user.id, req.params.courseSlug, parseId(req.params.materialId, 'id do material'));
  res.status(204).end();
};

const createCategory = async (req, res) => {
  const { name } = validateCategoryName(req.body);
  res.status(201).json({ category: await materials.createCategory(db(req), req.user.id, req.params.courseSlug, name) });
};

const renameCategory = async (req, res) => {
  const id = parseId(req.params.categoryId, 'id da categoria');
  const { name } = validateCategoryName(req.body);
  res.json({ category: await materials.renameCategory(db(req), req.user.id, req.params.courseSlug, id, name) });
};

const removeCategory = async (req, res) => {
  await materials.deleteCategory(db(req), req.user.id, req.params.courseSlug, parseId(req.params.categoryId, 'id da categoria'));
  res.status(204).end();
};

module.exports = { list, create, update, remove, createCategory, renameCategory, removeCategory };
