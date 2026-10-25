'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);
const unauthorized = (message = 'Autenticação necessária.', code = 'UNAUTHORIZED') =>
  new AppError(401, code, message);
const notFound = (message, code = 'NOT_FOUND') => new AppError(404, code, message);

module.exports = { AppError, badRequest, unauthorized, notFound };
