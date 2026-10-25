'use strict';

const { AppError } = require('../errors');

function notFoundHandler(req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.'));
}

/** Tratamento centralizado: toda resposta de erro tem o formato { error: { code, message, details? } }. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const logger = req.app.locals.logger;

  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Erro interno do servidor.';
  let details;

  if (err instanceof AppError) {
    ({ status, code, message, details } = err);
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'O corpo da requisição não é um JSON válido.';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'O corpo da requisição é grande demais.';
  }

  if (status >= 500) {
    // Registra a causa sem expor detalhes ao cliente.
    logger?.error('Erro não tratado', {
      method: req.method,
      path: req.path,
      code: err.code,
      message: err.message,
      stack: req.app.locals.config?.isProduction ? undefined : err.stack,
    });
  }

  if (res.headersSent) return;
  const body = { error: { code, message } };
  if (details) body.error.details = details;
  res.status(status).json(body);
}

module.exports = { notFoundHandler, errorHandler };
