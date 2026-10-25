'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { unauthorized } = require('../errors');
const { findByEmail } = require('./users');

// Hash descartável para que e-mails inexistentes gastem o mesmo tempo de bcrypt
// que e-mails existentes (evita enumeração de usuários por tempo de resposta).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 4);

const INVALID_CREDENTIALS = 'E-mail ou senha incorretos.';

async function login(db, config, { email, password }) {
  const user = await findByEmail(db, email);
  const valid = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !valid) throw unauthorized(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');

  const token = jwt.sign({ email: user.email }, config.jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    expiresIn: config.jwtExpiresIn,
  });
  const { exp } = jwt.decode(token);

  return {
    token,
    tokenType: 'Bearer',
    expiresAt: new Date(exp * 1000).toISOString(),
    user: { email: user.email },
  };
}

function verifyToken(config, token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) throw new Error('bad subject');
    return { id, email: payload.email };
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    throw unauthorized(
      expired ? 'Sua sessão expirou. Entre novamente.' : 'Sessão inválida. Entre novamente.',
      expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
    );
  }
}

module.exports = { login, verifyToken };
