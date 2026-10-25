'use strict';

const bcrypt = require('bcryptjs');

async function findByEmail(db, email) {
  const { rows } = await db.query(
    'SELECT id, email, password_hash FROM users WHERE email = $1',
    [email],
  );
  return rows[0] || null;
}

/**
 * Garante que o usuário configurado por ADMIN_EMAIL / ADMIN_PASSWORD exista.
 * Não há cadastro público: este é o único jeito de criar uma conta.
 *  - Sem usuário: cria.
 *  - Mesmo e-mail com senha diferente da variável: atualiza o hash (rotação de senha).
 *  - E-mail diferente e exatamente 1 usuário no banco: troca o e-mail, preservando os dados.
 */
async function ensureAdminUser(db, config, logger) {
  const { adminEmail, adminPassword, bcryptRounds } = config;

  if (!adminEmail || !adminPassword) {
    const { rows } = await db.query('SELECT COUNT(*) AS total FROM users');
    if (Number(rows[0].total) === 0) {
      logger?.warn('Nenhum usuário existe e ADMIN_EMAIL/ADMIN_PASSWORD não foram definidos: ninguém conseguirá entrar');
    }
    return null;
  }

  const existing = await findByEmail(db, adminEmail);
  if (existing) {
    if (!(await bcrypt.compare(adminPassword, existing.password_hash))) {
      const hash = await bcrypt.hash(adminPassword, bcryptRounds);
      await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, existing.id]);
      logger?.info('Senha do usuário atualizada a partir das variáveis de ambiente');
    }
    return existing.id;
  }

  const hash = await bcrypt.hash(adminPassword, bcryptRounds);
  const { rows: all } = await db.query('SELECT id FROM users');
  if (all.length === 1) {
    await db.query(
      'UPDATE users SET email = $1, password_hash = $2, updated_at = now() WHERE id = $3',
      [adminEmail, hash, all[0].id],
    );
    logger?.info('E-mail do usuário atualizado a partir das variáveis de ambiente');
    return all[0].id;
  }

  const { rows } = await db.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
    [adminEmail, hash],
  );
  logger?.info('Usuário inicial criado');
  return rows[0].id;
}

module.exports = { findByEmail, ensureAdminUser };
