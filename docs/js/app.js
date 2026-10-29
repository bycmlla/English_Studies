// Ponto de entrada: login → Meus Estudos → curso. Decide a tela pela sessão e pela rota (hash)
// e cuida de carregamento/erros globais.
import * as api from './api.js';
import { h } from './dom.js';
import { loadBooks, clearStore } from './store.js';
import { clearStudy } from './studyStore.js';
import { renderLogin } from './login.js';
import { renderDashboard } from './dashboard.js';
import { renderHub } from './hub.js';
import { renderCoursePage } from './coursePage.js';
import { renderMaterialsPage } from './materialsPage.js';
import { initToTop } from './toTop.js';
import { ENGLISH_SLUG, hrefTo, parseRoute, replaceHash, screenKey } from './router.js';

const root = document.getElementById('app');
let teardown = null;
let navToken = 0; // invalida navegações antigas quando o usuário muda de tela ou sai
let currentKey = '';

// ---------- aviso global de servidor lento ----------

const banner = h('div', { class: 'net-banner', role: 'status', 'aria-live': 'polite', hidden: true },
  'O servidor está acordando (plano gratuito). Isso pode levar até 1 minuto — não precisa recarregar a página.');
document.body.prepend(banner);

initToTop();

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
  navToken += 1;
  clearStore();
  clearStudy();
  // Todo login novo começa em Meus Estudos.
  renderLogin(root, { message, onSuccess: () => { replaceHash(''); start(); } });
}

function logout() {
  api.clearSession();
  replaceHash('');
  showLogin();
}

const focusMain = () => document.getElementById('main')?.focus({ preventScroll: true });

function showNotFound() {
  leaveCurrentView();
  root.replaceChildren(
    h('main', { id: 'main', class: 'center-screen', tabindex: '-1' },
      h('h1', { class: 'error-title' }, 'Curso não encontrado'),
      h('p', { class: 'muted' }, 'Esse curso não existe ou foi removido.'),
      h('a', { class: 'btn btn-primary', href: hrefTo() }, 'Voltar aos meus estudos'),
    ),
  );
}

function showDashboard(session) {
  leaveCurrentView();
  teardown = renderDashboard(root, { session, onLogout: logout, onDataChanged: reloadDashboard });
  // Ao trocar de tela, leva o foco ao conteúdo (leitores de tela e teclado começam do topo).
  focusMain();
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

/** Mostra a tela da rota atual: Meus Estudos, My English Journey ou outro curso. */
async function start() {
  const session = api.getSession();
  if (!session) return showLogin();

  const route = parseRoute();
  const token = (navToken += 1);
  currentKey = screenKey(route);
  const stale = () => token !== navToken;
  const failed = (err) => {
    if (stale() || err.status === 401) return; // 401: onUnauthorized já exibiu o login
    showError(err.message);
  };

  if (route.view === 'hub') {
    showLoading('Carregando seus cursos…');
    let courses;
    try {
      courses = await api.listCourses();
    } catch (err) {
      return failed(err);
    }
    if (stale()) return;
    leaveCurrentView();
    teardown = renderHub(root, { courses, onLogout: logout });
    return focusMain();
  }

  if (route.view === 'materials') {
    showLoading('Carregando seus materiais…');
    let courses;
    try {
      courses = await api.listCourses();
    } catch (err) {
      return failed(err);
    }
    if (stale()) return;
    leaveCurrentView();
    teardown = renderMaterialsPage(root, { courses, courseSlug: route.sub, onLogout: logout });
    return focusMain();
  }

  if (route.slug === ENGLISH_SLUG) {
    showLoading();
    try {
      await loadBooks();
    } catch (err) {
      return failed(err);
    }
    if (stale()) return;
    return showDashboard(session);
  }

  showLoading('Carregando o curso…');
  let course;
  try {
    course = await api.getCourse(route.slug);
  } catch (err) {
    if (!stale() && err.status === 404) return showNotFound();
    return failed(err);
  }
  if (stale()) return;
  leaveCurrentView();
  teardown = renderCoursePage(root, { course, onLogout: logout });
  focusMain();
}

// Botão voltar do navegador e links "Voltar aos meus estudos": só troca de tela quando a tela
// muda (trocar de aba dentro do My English Journey não recarrega nada).
window.addEventListener('hashchange', () => {
  if (api.getSession() && screenKey() !== currentKey) start();
});

start();
