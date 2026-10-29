// Tela principal: cabeçalho, visão geral e cartões dos livros.
import { h, icon, formatPercent } from './dom.js';
import { STATUS_LABEL, BOOK_TYPE_LABEL } from './progress.js';
import { store, subscribe, resetSubscribers, viewOf, overview, getBook, refreshBooks } from './store.js';
import { onSyncChange } from './sync.js';
import { createBookPanel } from './bookPanel.js';
import { openSettings } from './settings.js';
import { createStudyPanel } from './studyPanel.js';
import { clearStudy } from './studyStore.js';
import { themeButton, coverEl, logoutButton, backLink } from './chrome.js';
import { ENGLISH_SLUG, hrefTo, parseRoute, replaceHash } from './router.js';

const SYNC_TEXT = {
  saving: 'Salvando…',
  saved: 'Salvo',
  error: 'Erro ao salvar',
};

// ---------- visão geral ----------

function createOverview() {
  const stat = (label) => {
    const value = h('span', { class: 'stat-value' });
    return { value, el: h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), value) };
  };
  const total = stat('Total de unidades');
  const done = stat('Unidades completas');
  const percent = stat('Progresso geral');
  const current = stat('Estudando agora');
  current.value.classList.add('stat-text');

  const note = h('p', { class: 'overview-note' });
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
    note,
  );

  function update() {
    const o = overview();
    note.textContent = `${o.completedTasks} de ${o.totalTasks} atividades concluídas. Uma unidade completa tem Student's Book e Workbook concluídos.`;
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
  const breakdown = h('p', { class: 'breakdown' });
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
    breakdown,
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
    count.textContent = `${view.completedTasks} de ${view.totalTasks} atividades concluídas`;
    breakdown.textContent = `${BOOK_TYPE_LABEL.student_book} ${view.studentBook.completed}/${view.totalUnits} · ${BOOK_TYPE_LABEL.workbook} ${view.workbook.completed}/${view.totalUnits}`;
    fill.style.setProperty('--value', `${view.percent}%`);
    bar.setAttribute('aria-valuenow', String(view.percent));
    bar.setAttribute('aria-valuetext', `${formatPercent(view.percent)} concluído`);
  }

  return { slug, el, update };
}

// ---------- abas: Livros | Conteúdos de Estudo ----------

const TABS = [
  { id: 'books', label: 'Livros', hash: hrefTo(ENGLISH_SLUG) },
  { id: 'study', label: 'Conteúdos de Estudo', hash: hrefTo(ENGLISH_SLUG, 'estudo') },
];

function createTabs(panels, { onShow }) {
  const buttons = new Map();
  const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Seções' },
    TABS.map((tab) => {
      const button = h('button', {
        class: 'tab', type: 'button', role: 'tab', id: `tab-${tab.id}`,
        'aria-controls': `tabpanel-${tab.id}`, 'aria-selected': 'false', tabindex: '-1',
        onClick: () => select(tab.id),
        onKeydown: (event) => {
          const index = TABS.findIndex((t) => t.id === tab.id);
          const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[event.key];
          if (next === undefined) return;
          event.preventDefault();
          const target = TABS[(next + TABS.length) % TABS.length];
          select(target.id);
          buttons.get(target.id).focus();
        },
      }, tab.label);
      buttons.set(tab.id, button);
      return button;
    }));

  function select(id, { updateHash = true } = {}) {
    for (const tab of TABS) {
      const active = tab.id === id;
      const button = buttons.get(tab.id);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      panels[tab.id].hidden = !active;
    }
    if (updateHash) replaceHash(TABS.find((t) => t.id === id).hash);
    onShow(id);
  }

  const fromHash = () => (parseRoute().sub === 'estudo' ? 'study' : 'books');
  return { el: tablist, select, selectFromHash: () => select(fromHash(), { updateHash: false }) };
}

// ---------- página ----------

export function renderDashboard(root, { session, onLogout, onDataChanged }) {
  resetSubscribers();
  clearStudy(); // sempre relê o estudo do servidor (ex.: após importar um backup)

  const syncChip = h('span', { class: 'sync-chip', role: 'status', 'aria-live': 'polite' });
  const unsubscribeSync = onSyncChange((state) => {
    syncChip.hidden = state === 'idle';
    syncChip.dataset.state = state;
    syncChip.textContent = SYNC_TEXT[state] || '';
  });

  const overviewView = createOverview();
  const cards = store.books.map((book) => createCard(book.slug));
  const studyPanel = createStudyPanel();

  const booksTab = h('div', { id: 'tabpanel-books', role: 'tabpanel', 'aria-labelledby': 'tab-books' },
    overviewView.el,
    h('section', { class: 'books', 'aria-label': 'Livros da coleção Interchange' }, cards.map((card) => card.el)));
  const studyTab = h('div', { id: 'tabpanel-study', role: 'tabpanel', 'aria-labelledby': 'tab-study', hidden: true }, studyPanel.el);
  const tabs = createTabs({ books: booksTab, study: studyTab }, {
    onShow: (id) => { if (id === 'study') studyPanel.onShow(); },
  });

  const header = h(
    'header',
    { class: 'page-header' },
    h(
      'div',
      { class: 'titles' },
      h('h1', {}, 'My English Journey'),
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
      logoutButton(onLogout),
    ),
  );

  function refreshAll() {
    overviewView.update();
    cards.forEach((card) => card.update());
  }

  // Capa em largura total + ícone da página sobreposto, como em uma página do Notion.
  const main = h(
    'main',
    { id: 'main', tabindex: '-1' },
    coverEl(),
    h(
      'div',
      { class: 'page' },
      h('img', { class: 'page-icon', src: 'book.png', alt: '', width: 330, height: 326 }),
      backLink(),
      header,
      tabs.el,
      booksTab,
      studyTab,
    ),
  );

  root.replaceChildren(main);
  refreshAll();
  tabs.selectFromHash();
  const onHashChange = () => tabs.selectFromHash();
  window.addEventListener('hashchange', onHashChange);

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


  return () => {
    unsubscribeSync();
    resetSubscribers();
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('hashchange', onHashChange);
    studyPanel.destroy();
  };
}

