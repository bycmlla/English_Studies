'use strict';

const { Pool } = require('pg');

function createPool({ databaseUrl, databaseSsl }, logger) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseSsl,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Conexões ociosas podem ser derrubadas pelo provedor; sem este handler o
  // processo cairia com "unhandled error".
  pool.on('error', (err) => {
    logger?.error('Erro em conexão ociosa do pool', { code: err.code, message: err.message });
  });

  return pool;
}

module.exports = { createPool };
