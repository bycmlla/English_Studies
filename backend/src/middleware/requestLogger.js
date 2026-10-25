'use strict';

// Registra método, rota (sem query string), status e duração.
// Não registra cabeçalhos (Authorization) nem corpo (senhas, anotações).
function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.app.locals.logger?.[level](`${req.method} ${req.baseUrl}${req.path} ${res.statusCode}`, {
      ms: Math.round(ms),
    });
  });
  next();
}

module.exports = { requestLogger };
