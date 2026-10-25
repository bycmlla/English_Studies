'use strict';

const books = require('../services/books');
const materials = require('../services/materials');
const notes = require('../services/notes');
const backup = require('../services/backup');
const {
  parseId,
  parseUnitNumber,
  validateMaterial,
  validateNotes,
  validateUnitUpdate,
} = require('../validators');

/** router.param: resolve :bookSlug e deixa o livro em req.book (404 se não existir). */
async function loadBook(req, _res, next, slug) {
  try {
    req.book = await books.getBookBySlug(req.app.locals.db, slug);
    next();
  } catch (err) {
    next(err);
  }
}

const list = async (req, res) => {
  res.json({ books: await books.listBooksWithProgress(req.app.locals.db, req.user.id) });
};

const show = async (req, res) => {
  res.json({ book: await books.getBookWithProgress(req.app.locals.db, req.user.id, req.book.slug) });
};

const listUnits = async (req, res) => {
  const { db } = req.app.locals;
  res.json({
    book: await books.getBookWithProgress(db, req.user.id, req.book.slug),
    units: await books.listUnits(db, req.user.id, req.book),
  });
};

const updateUnit = async (req, res) => {
  const number = parseUnitNumber(req.params.unitNumber);
  const { completed, bookType } = validateUnitUpdate(req.body);
  res.json(await books.setUnitCompleted(req.app.locals.db, req.user.id, req.book, number, bookType, completed));
};

const listMaterials = async (req, res) => {
  res.json({ materials: await materials.listMaterials(req.app.locals.db, req.user.id, req.book) });
};

const createMaterial = async (req, res) => {
  const data = validateMaterial(req.body);
  const material = await materials.createMaterial(req.app.locals.db, req.user.id, req.book, data);
  res.status(201).json({ material });
};

const updateMaterial = async (req, res) => {
  const id = parseId(req.params.materialId, 'id do link');
  const data = validateMaterial(req.body);
  res.json({ material: await materials.updateMaterial(req.app.locals.db, req.user.id, req.book, id, data) });
};

const deleteMaterial = async (req, res) => {
  const id = parseId(req.params.materialId, 'id do link');
  await materials.deleteMaterial(req.app.locals.db, req.user.id, req.book, id);
  res.status(204).end();
};

const getNotes = async (req, res) => {
  res.json({ notes: await notes.getNotes(req.app.locals.db, req.user.id, req.book) });
};

const saveNotes = async (req, res) => {
  const content = validateNotes(req.body);
  res.json({ notes: await notes.saveNotes(req.app.locals.db, req.user.id, req.book, content) });
};

const overview = async (req, res) => {
  res.json({ overview: await books.getOverview(req.app.locals.db, req.user.id) });
};

const exportBackup = async (req, res) => {
  const data = await backup.exportBackup(req.app.locals.db, req.user.id);
  res.set('Cache-Control', 'no-store').json(data);
};

const importBackup = async (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  res.json(await backup.importBackup(req.app.locals.db, req.user.id, req.body, { dryRun }));
};

module.exports = {
  loadBook,
  list,
  show,
  listUnits,
  updateUnit,
  listMaterials,
  createMaterial,
  updateMaterial,
  deleteMaterial,
  getNotes,
  saveNotes,
  overview,
  exportBackup,
  importBackup,
};
