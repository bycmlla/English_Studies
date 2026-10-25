// Tela principal: cabeçalho, visão geral e cartões dos livros.
import { h, icon, formatPercent } from './dom.js';
import { STATUS_LABEL } from './progress.js';
import { store, subscribe, resetSubscribers, viewOf, overview, getBook, refreshBooks } from './store.js';
import { onSyncChange } from './sync.js';
import { createBookPanel, hasUnsavedNotes } from './bookPanel.js';
import { openSettings } from './settings.js';

const SYNC_TEXT = {
  saving: 'Salvando…',
  saved: 'Salvo',
  error: 'Erro ao salvar',
};

// ---------- tema ----------

const effectiveTheme = () =>
  document.documentElement.getAttribute('data-theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('mej.theme', theme); } catch { /* preferência vale só nesta sessão */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#191919' : '#fbfbfa');
}

function themeButton() {
  const button = h('button', { class: 'icon-btn icon-btn-lg', type: 'button' });
  const refresh = () => {
    const dark = effectiveTheme() === 'dark';
    button.replaceChildren(icon(dark ? 'sun' : 'moon', 20));
    button.setAttribute('aria-label', dark ? 'Mudar para o modo claro' : 'Mudar para o modo escuro');
    button.title = dark ? 'Modo claro' : 'Modo escuro';
  };
  button.addEventListener('click', () => { applyTheme(effectiveTheme() === 'dark' ? 'light' : 'dark'); refresh(); });
  refresh();
  return button;
}

// ---------- visão geral ----------

function createOverview() {
  const stat = (label) => {
    const value = h('span', { class: 'stat-value' });
    return { value, el: h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), value) };
  };
  const total = stat('Total de unidades');
  const done = stat('Unidades concluídas');
  const percent = stat('Progresso geral');
  const current = stat('Estudando agora');
  current.value.classList.add('stat-text');

  const fill = h('div', { class: 'progress-fill' });
  const bar = h('div', {
    class: 'progress progress-thin', role: 'progressbar', 'aria-label': 'Progresso geral',
    'aria-valuemin': 0, 'aria-valuemax': 100,
  }, fill);

  const el = h(
    'section',
    { class: 'overview', 'aria-labelledby': 'overview-title' },
    h('h2', { id: 'overview-title', class: 'overview-title' }, 'Visão geral'),
    h('div', { class: 'stats' }, total.el, done.el, percent.el, current.el),
    bar,
  );

  function update() {
    const o = overview();
    total.value.textContent = String(o.totalUnits);
    done.value.textContent = String(o.completedUnits);
    percent.value.textContent = formatPercent(o.percent);
    current.value.textContent = o.currentBook ? o.currentBook.title : 'Tudo concluído 🎉';
    fill.style.setProperty('--value', `${o.percent}%`);
    bar.setAttribute('aria-valuenow', String(o.percent));
  }
  return { el, update };
}

// ---------- cartão de livro ----------

function createCard(slug) {
  const book = getBook(slug);
  const panelId = `panel-${slug}`;
  let panelBuilt = false;

  const statusPill = h('span', { class: 'status-pill' });
  const percent = h('span', { class: 'percent' });
  const count = h('span', { class: 'count' });
  const fill = h('div', { class: 'progress-fill' });
  const bar = h('div', {
    class: 'progress', role: 'progressbar', 'aria-label': `Progresso em ${book.title}`,
    'aria-valuemin': 0, 'aria-valuemax': 100,
  }, fill);

  const toggleButton = h(
    'button',
    { class: 'card-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
    h('span', { class: 'dot', 'aria-hidden': 'true' }),
    h('span', { class: 'card-title' }, book.title),
    h('span', { class: 'level' }, book.level),
    h('span', { class: 'chevron' }, icon('chevron', 20)),
  );

  const panelInner = h('div', { class: 'panel-inner' });
  const panel = h('div', { id: panelId, class: 'panel', role: 'region', 'aria-label': `Detalhes de ${book.title}`, inert: true }, panelInner);

  const summary = h(
    'div',
    { class: 'card-summary' },
    h('h3', { class: 'card-heading' }, toggleButton),
    h('p', { class: 'status-line' }, 'Status: ', statusPill),
    bar,
    h('div', { class: 'progress-meta' }, percent, count),
  );

  const el = h('article', { class: 'card', 'data-color': book.color, 'data-slug': slug }, summary, panel);

  function setOpen(open) {
    if (open && !panelBuilt) {
      panelInner.append(createBookPanel(slug));
      panelBuilt = true;
    }
    el.classList.toggle('open', open);
    toggleButton.setAttribute('aria-expanded', String(open));
    panel.toggleAttribute('inert', !open);
  }

  // O cartão inteiro é clicável; o botão do título garante teclado e leitores de tela.
  summary.addEventListener('click', (event) => {
    if (event.target.closest('a, input')) return;
    setOpen(!el.classList.contains('open'));
  });

  function update() {
    const view = viewOf(getBook(slug));
    el.dataset.status = view.status;
    statusPill.textContent = STATUS_LABEL[view.status];
    statusPill.className = `status-pill status-${view.status}`;
    percent.textContent = formatPercent(view.percent);
    count.textContent = `${view.completedUnits} de ${view.totalUnits} unidades concluídas`;
    fill.style.setProperty('--value', `${view.percent}%`);
    bar.setAttribute('aria-valuenow', String(view.percent));
    bar.setAttribute('aria-valuetext', `${formatPercent(view.percent)} concluído`);
  }

  return { slug, el, update };
}

// ---------- página ----------

export function renderDashboard(root, { session, onLogout, onDataChanged }) {
  resetSubscribers();

  const syncChip = h('span', { class: 'sync-chip', role: 'status', 'aria-live': 'polite' });
  const unsubscribeSync = onSyncChange((state) => {
    syncChip.hidden = state === 'idle';
    syncChip.dataset.state = state;
    syncChip.textContent = SYNC_TEXT[state] || '';
  });

  const overviewView = createOverview();
  const cards = store.books.map((book) => createCard(book.slug));

  const header = h(
    'header',
    { class: 'page-header' },
    h(
      'div',
      { class: 'titles' },
      h('h1', {}, h('span', { class: 'title-emoji', 'aria-hidden': 'true' }, '📚'), 'My English Journey'),
      h('p', { class: 'subtitle' }, 'Meu painel de estudos de inglês'),
    ),
    h(
      'div',
      { class: 'header-actions' },
      syncChip,
      themeButton(),
      h('button', {
        class: 'icon-btn icon-btn-lg', type: 'button', title: 'Backup e conta', 'aria-label': 'Abrir backup e conta',
        onClick: () => openSettings({ session, onLogout, onDataChanged }),
      }, icon('settings', 20)),
    ),
  );

  function refreshAll() {
    overviewView.update();
    cards.forEach((card) => card.update());
  }

  const main = h(
    'main',
    { id: 'main', class: 'page', tabindex: '-1' },
    header,
    overviewView.el,
    h('section', { class: 'books', 'aria-label': 'Livros da coleção Interchange' }, cards.map((card) => card.el)),
  );

  root.replaceChildren(main);
  refreshAll();

  subscribe((event) => {
    if (event.type === 'reload') {
      // Dados vindos do servidor (backup importado, sincronização): redesenha os cartões.
      refreshAll();
    } else if (event.type === 'book') {
      overviewView.update();
      cards.find((card) => card.slug === event.slug)?.update();
    }
  });

  // Ao voltar para a aba, busca o estado oficial (útil após usar outro dispositivo).
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || Date.now() - store.loadedAt < 60_000) return;
    refreshBooks().catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisible);

  const onBeforeUnload = (event) => {
    if (hasUnsavedNotes()) { event.preventDefault(); event.returnValue = ''; }
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  return () => {
    unsubscribeSync();
    resetSubscribers();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}

