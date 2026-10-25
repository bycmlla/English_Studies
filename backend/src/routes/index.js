'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const { AppError } = require('../errors');
const { requireAuth } = require('../middleware/auth');
const auth = require('../controllers/authController');
const c = require('../controllers/booksController');

function createApiRouter(config) {
  const router = express.Router();

  // Limite de tentativas: só conta logins que falham, por IP.
  const loginLimiter = rateLimit({
    windowMs: config.loginWindowMs,
    limit: config.loginMaxAttempts,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) =>
      next(new AppError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.')),
  });

  router.post('/auth/login', loginLimiter, auth.login);
  router.get('/auth/me', requireAuth, auth.me);

  // Tudo abaixo exige autenticação.
  router.use(requireAuth);

  router.param('bookSlug', c.loadBook);

  router.get('/books', c.list);
  router.get('/books/:bookSlug', c.show);
  router.get('/books/:bookSlug/units', c.listUnits);
  router.put('/books/:bookSlug/units/:unitNumber', c.updateUnit);

  router.get('/books/:bookSlug/materials', c.listMaterials);
  router.post('/books/:bookSlug/materials', c.createMaterial);
  router.put('/books/:bookSlug/materials/:materialId', c.updateMaterial);
  router.delete('/books/:bookSlug/materials/:materialId', c.deleteMaterial);

  router.get('/books/:bookSlug/notes', c.getNotes);
  router.put('/books/:bookSlug/notes', c.saveNotes);

  router.get('/progress/overview', c.overview);

  router.get('/backup/export', c.exportBackup);
  router.post('/backup/import', c.importBackup);

  return router;
}

module.exports = { createApiRouter };
