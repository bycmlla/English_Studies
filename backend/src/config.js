'use strict';

const DEV_CORS_ORIGINS = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
  'http://localhost:3000',
];

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function parseInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
}

function resolveSsl(env, isProduction) {
  const flag = String(env.DATABASE_SSL || '').toLowerCase();
  const enabled = flag === '' ? isProduction : flag === 'true' || flag === '1';
  // Provedores gerenciados (Render, Neon, ...) usam certificados que o Node não
  // consegue validar com a CA padrão; a conexão continua criptografada.
  return enabled ? { rejectUnauthorized: false } : false;
}

/** Configuração mínima para scripts que só falam com o banco (ex.: migrate). */
function loadDatabaseConfig(env = process.env) {
  if (!env.DATABASE_URL) {
    throw new Error('Configuração inválida: DATABASE_URL é obrigatória.');
  }
  const isProduction = (env.NODE_ENV || 'development') === 'production';
  return { databaseUrl: env.DATABASE_URL, databaseSsl: resolveSsl(env, isProduction) };
}

/** Configuração completa da API. Lança um erro listando o que está faltando (sem valores). */
function loadConfig(env = process.env) {
  const errors = [];
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  if (!env.DATABASE_URL) errors.push('DATABASE_URL é obrigatória');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET é obrigatória e deve ter pelo menos 32 caracteres');
  }

  const port = parseInteger(env.PORT, 3000, { min: 1, max: 65535 });
  const bcryptRounds = parseInteger(env.BCRYPT_ROUNDS, 12, { min: 4, max: 15 });
  const loginMaxAttempts = parseInteger(env.LOGIN_MAX_ATTEMPTS, 10, { min: 1, max: 1000 });
  const loginWindowMinutes = parseInteger(env.LOGIN_WINDOW_MINUTES, 15, { min: 1, max: 1440 });
  if (Number.isNaN(port)) errors.push('PORT inválida');
  if (Number.isNaN(bcryptRounds)) errors.push('BCRYPT_ROUNDS deve ser um inteiro entre 4 e 15');
  if (Number.isNaN(loginMaxAttempts)) errors.push('LOGIN_MAX_ATTEMPTS inválida');
  if (Number.isNaN(loginWindowMinutes)) errors.push('LOGIN_WINDOW_MINUTES inválida');

  const adminEmail = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = env.ADMIN_PASSWORD || '';
  if (adminPassword && adminPassword.length < 10) {
    errors.push('ADMIN_PASSWORD deve ter pelo menos 10 caracteres');
  }
  if (Boolean(adminEmail) !== Boolean(adminPassword)) {
    errors.push('ADMIN_EMAIL e ADMIN_PASSWORD devem ser definidos juntos');
  }

  const corsOrigins = parseList(env.CORS_ORIGINS);

  if (errors.length > 0) {
    throw new Error(`Configuração inválida:\n - ${errors.join('\n - ')}`);
  }

  return {
    nodeEnv,
    isProduction,
    port,
    databaseUrl: env.DATABASE_URL,
    databaseSsl: resolveSsl(env, isProduction),
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '7d',
    bcryptRounds,
    adminEmail,
    adminPassword,
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : isProduction ? [] : DEV_CORS_ORIGINS,
    trustProxy: parseInteger(env.TRUST_PROXY, 1, { min: 0, max: 10 }),
    loginMaxAttempts,
    loginWindowMs: loginWindowMinutes * 60 * 1000,
    runMigrationsOnStart: String(env.RUN_MIGRATIONS_ON_START || 'true').toLowerCase() !== 'false',
  };
}

module.exports = { loadConfig, loadDatabaseConfig };
