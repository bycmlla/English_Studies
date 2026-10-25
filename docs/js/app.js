// Ponto de entrada: decide entre login e painel, e cuida de carregamento/erros globais.
import * as api from './api.js';
import { h } from './dom.js';
import { loadBooks, clearStore } from './store.js';
import { renderLogin } from './login.js';
import { renderDashboard } from './dashboard.js';

const root = document.getElementById('app');
let teardown = null;

// ---------- aviso global de servidor lento ----------

const banner = h('div', { class: 'net-banner', role: 'status', 'aria-live': 'polite', hidden: true },
  'O servidor está acordando (plano gratuito). Isso pode levar até 1 minuto — não precisa recarregar a página.');
document.body.prepend(banner);

let slowCount = 0;
api.setApiHooks({
  onSlow: () => { slowCount += 1; banner.hidden = false; },
  onSlowEnd: () => { slowCount = Math.max(0, slowCount - 1); if (slowCount === 0) banner.hidden = true; },
  onUnauthorized: () => showLogin('Sua sessão expirou. Entre novamente.'),
});

// ---------- telas ----------

function leaveCurrentView() {
  teardown?.();
  teardown = null;
}

function showLoading(text = 'Carregando seus estudos…') {
  leaveCurrentView();
  root.replaceChildren(
    h('main', { id: 'main', class: 'center-screen', tabindex: '-1' },
      h('div', { class: 'spinner', 'aria-hidden': 'true' }),
      h('p', { role: 'status' }, text),
      h('p', { class: 'muted slow-hint', hidden: true }, 'Se for o primeiro acesso do dia, o servidor gratuito pode levar até 1 minuto para acordar.'),
    ),
  );
  setTimeout(() => {
    const hint = root.querySelector('.slow-hint');
    if (hint) hint.hidden = false;
  }, 4000);
}

function showError(message) {
  leaveCurrentView();
  root.replaceChildren(
    h('main', { id: 'main', class: 'center-screen', tabindex: '-1' },
      h('h1', { class: 'error-title' }, 'Não foi possível carregar'),
      h('p', { role: 'alert' }, message),
      h('p', { class: 'muted' }, 'Seus dados continuam salvos no servidor. Tente novamente em instantes.'),
      h('button', { class: 'btn btn-primary', type: 'button', onClick: start }, 'Tentar novamente'),
    ),
  );
}

function showLogin(message = '') {
  leaveCurrentView();
  clearStore();
  renderLogin(root, { message, onSuccess: () => start() });
}

function logout() {
  api.clearSession();
  showLogin();
}

async function showDashboard(session) {
  leaveCurrentView();
  teardown = renderDashboard(root, { session, onLogout: logout, onDataChanged: reloadDashboard });
  // Ao trocar de tela, leva o foco ao conteúdo (leitores de tela e teclado começam do topo).
  document.getElementById("main")?.focus({ preventScroll: true });
}

async function reloadDashboard() {
  const session = api.getSession();
  if (!session) return showLogin();
  try {
    await loadBooks();
  } catch (err) {
    if (err.status !== 401) showError(err.message);
    return;
  }
  showDashboard(session);
}

async function start() {
  const session = api.getSession();
  if (!session) return showLogin();

  showLoading();
  try {
    await loadBooks();
  } catch (err) {
    if (err.status === 401) return; // onUnauthorized já exibiu o login
    return showError(err.message);
  }
  showDashboard(session);
}

start();
