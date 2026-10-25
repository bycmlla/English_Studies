'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { createApiRouter } = require('./routes');
const { requestLogger } = require('./middleware/requestLogger');
const { notFoundHandler, errorHandler } = require('./middleware/error');

/**
 * @param {{ db: import('pg').Pool, config: object, logger: object }} deps
 */
function createApp({ db, config, logger }) {
  const app = express();
  app.locals.db = db;
  app.locals.config = config;
  app.locals.logger = logger;

  app.disable('x-powered-by');
  // Atrás do proxy do Render, usa o IP real do cliente (rate limit) e HTTPS.
  app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(requestLogger);

  // Autenticação é por token no cabeçalho Authorization (sem cookies), então
  // não há "credentials": o CORS só precisa liberar as origens configuradas.
  const allowed = new Set(config.corsOrigins);
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || allowed.has(origin)),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: '1mb' }));

  const health = async (_req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', database: 'up', uptime: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  };
  app.get('/health', health);
  app.get('/api/health', health);

  app.use('/api', createApiRouter(config));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
