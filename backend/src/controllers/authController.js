'use strict';

const authService = require('../services/auth');
const { validateLogin } = require('../validators');

async function login(req, res) {
  const credentials = validateLogin(req.body);
  const { db, config } = req.app.locals;
  res.json(await authService.login(db, config, credentials));
}

function me(req, res) {
  res.json({ user: { email: req.user.email } });
}

module.exports = { login, me };
