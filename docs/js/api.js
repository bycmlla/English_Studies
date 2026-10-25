// Cliente da API REST. O banco de dados é a fonte oficial dos dados; aqui só há
// transporte, sessão (token) e tratamento de lentidão/erros de rede.

const config = window.APP_CONFIG || {};
const isLocalHost = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API_URL = String((isLocalHost ? config.LOCAL_API_URL : config.API_URL) || '').replace(/\/+$/, '');

const SESSION_KEY = 'mej.session';
const SLOW_AFTER_MS = 4000; // a partir daqui avisamos que o servidor pode estar "acordando"
const REQUEST_TIMEOUT_MS = 30000;
const RETRY_DELAYS_MS = [1500, 4000]; // novas tentativas em GET/PUT (idempotentes)

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details, network = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.network = network;
  }
}

// ---------- sessão ----------
// O token fica em localStorage: o site (GitHub Pages) e a API (Render) estão em
// domínios diferentes e cookies de terceiros são bloqueados por vários navegadores.
// Mitigações: sem scripts de terceiros, CSP restritiva, DOM sem innerHTML e token
// com expiração no servidor.

let memorySession = null; // fallback quando localStorage está bloqueado

function isValid(session) {
  return Boolean(session?.token && session.expiresAt && new Date(session.expiresAt) > new Date());
}

export function getSession() {
  try {
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    if (isValid(stored)) return stored;
    if (stored) localStorage.removeItem(SESSION_KEY); // expirada ou corrompida
  } catch {
    /* localStorage indisponível ou JSON inválido */
  }
  return isValid(memorySession) ? memorySession : null;
}

export function saveSession(session) {
  memorySession = session;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* navegação privada: a sessão vale só até recarregar */
  }
}

export function clearSession() {
  memorySession = null;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- ganchos de interface ----------

const hooks = { onSlow: () => {}, onSlowEnd: () => {}, onUnauthorized: () => {} };
export function setApiHooks(next) {
  Object.assign(hooks, next);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function attempt(path, { method, body, auth, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const session = getSession();
    if (session) headers.Authorization = `Bearer ${session.token}`;
  }

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    const timedOut = err.name === 'AbortError';
    throw new ApiError(
      timedOut
        ? 'O servidor demorou para responder.'
        : 'Não foi possível conectar ao servidor. Verifique sua internet.',
      { network: true, code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' },
    );
  } finally {
    clearTimeout(timer);
  }

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error || {};
    throw new ApiError(error.message || 'O servidor respondeu com um erro inesperado.', {
      status: response.status,
      code: error.code || 'HTTP_ERROR',
      details: error.details,
      // 502/503/504 acontecem enquanto o Render ainda está subindo o serviço.
      network: [502, 503, 504].includes(response.status),
    });
  }
  return data;
}

async function request(path, { method = 'GET', body, auth = true, timeoutMs = REQUEST_TIMEOUT_MS, retry } = {}) {
  const retryable = retry ?? (method === 'GET' || method === 'PUT');
  const slowTimer = setTimeout(() => hooks.onSlow(), SLOW_AFTER_MS);
  try {
    for (let i = 0; ; i += 1) {
      try {
        return await attempt(path, { method, body, auth, timeoutMs });
      } catch (err) {
        if (err.status === 401 && auth && err.code !== 'INVALID_CREDENTIALS') {
          clearSession();
          hooks.onUnauthorized(err);
        }
        if (!(retryable && err.network && i < RETRY_DELAYS_MS.length)) throw err;
        await sleep(RETRY_DELAYS_MS[i]);
      }
    }
  } finally {
    clearTimeout(slowTimer);
    hooks.onSlowEnd();
  }
}

const book = (slug) => `/api/books/${encodeURIComponent(slug)}`;

// ---------- endpoints ----------

export async function login(email, password) {
  const data = await request('/api/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
    timeoutMs: 60000, // cobre a "partida a frio" do Render
    retry: false,
  });
  const session = { token: data.token, expiresAt: data.expiresAt, email: data.user.email };
  saveSession(session);
  return session;
}

/** Acorda o servidor (Render free dorme após inatividade) sem exibir nada ao usuário. */
export function wakeUp() {
  return request('/health', { auth: false, timeoutMs: 70000 }).catch(() => null);
}

export const listBooks = () => request('/api/books').then((d) => d.books);
export const setUnit = (slug, number, completed) =>
  request(`${book(slug)}/units/${number}`, { method: 'PUT', body: { completed } });

export const listMaterials = (slug) => request(`${book(slug)}/materials`).then((d) => d.materials);
export const createMaterial = (slug, data) =>
  request(`${book(slug)}/materials`, { method: 'POST', body: data }).then((d) => d.material);
export const updateMaterial = (slug, id, data) =>
  request(`${book(slug)}/materials/${id}`, { method: 'PUT', body: data }).then((d) => d.material);
export const deleteMaterial = (slug, id) => request(`${book(slug)}/materials/${id}`, { method: 'DELETE', retry: false });

export const getNotes = (slug) => request(`${book(slug)}/notes`).then((d) => d.notes);
export const saveNotes = (slug, content) =>
  request(`${book(slug)}/notes`, { method: 'PUT', body: { content } }).then((d) => d.notes);

export const exportBackup = () => request('/api/backup/export');
export const importBackup = (payload, { dryRun = false } = {}) =>
  request(`/api/backup/import${dryRun ? '?dryRun=true' : ''}`, {
    method: 'POST',
    body: payload,
    timeoutMs: 60000,
    retry: false,
  });
