'use strict';

const { unauthorized } = require('../errors');
const { verifyToken } = require('../services/auth');

/** Exige "Authorization: Bearer <token>" e preenche req.user. */
function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) return next(unauthorized('Faça login para continuar.', 'AUTH_REQUIRED'));

  try {
    req.user = verifyToken(req.app.locals.config, match[1]);
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth };
