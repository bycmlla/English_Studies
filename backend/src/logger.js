'use strict';

// Logger mínimo. Nunca receba aqui senhas, tokens, cabeçalhos ou corpos de requisição.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function createLogger({ level = 'info', silent = false } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(name, message, context) {
    if (silent || LEVELS[name] < threshold) return;
    const line = `${new Date().toISOString()} ${name.toUpperCase().padEnd(5)} ${message}`;
    const out = name === 'error' || name === 'warn' ? console.error : console.log;
    if (context && Object.keys(context).length > 0) out(line, JSON.stringify(context));
    else out(line);
  }

  return {
    debug: (message, context) => write('debug', message, context),
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context),
  };
}

module.exports = { createLogger };
