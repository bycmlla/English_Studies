// Aba "Conteúdos de Estudo": níveis → unidades expansíveis → assuntos por categoria,
// cada assunto com seu próprio checkbox. Não compartilha estado com Student's Book / Workbook.
import { h, icon, formatPercent } from './dom.js';
import { toast } from './ui.js';
import { ENGLISH_SLUG } from './router.js';
import { createMaterialsSection } from './materialsSection.js';
import {
  study, loadStudy, subscribeStudy, toggleTopic, groupByCategory,
  unitProgress, bookProgress, overallProgress,
} from './studyStore.js';

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'pending', label: 'Pendentes' },
  { id: 'done', label: 'Concluídos' },
];

const EMPTY_TEXT = {
  pending: 'Tudo estudado nesta unidade. 🎉',
  done: 'Nenhum assunto concluído nesta unidade ainda.',
};

/** Barra de progresso com texto acessível (a cor #fed353 vem do CSS: .study-panel .progress-fill). */
function progressBar(label, extraClass = '') {
  const fill = h('div', { class: 'progress-fill' });
  const el = h('div', {
    class: `progress ${extraClass}`.trim(), role: 'progressbar', 'aria-label': label,
    'aria-valuemin': 0, 'aria-valuemax': 100,
  }, fill);
  return {
    el,
    set({ percent }) {
      fill.style.setProperty('--value', `${percent}%`);
      el.setAttribute('aria-valuenow', String(percent));
      el.setAttribute('aria-valuetext', `${formatPercent(percent)} estudado`);
    },
  };
}

const countText = (p) => `${p.completed} de ${p.total} assuntos estudados`;

export function createStudyPanel() {
  const state = { filter: 'all' };
  const cards = []; // { book, el, update(), applyFilter() }

  const root = h('div', { class: 'study-panel' });

  // ---------- cabeçalho fixo da aba ----------
  const overallPct = h('span', { class: 'stat-value' });
  const overallCount = h('span', { class: 'count' });
  const overallBar = progressBar('Progresso total de Conteúdos de Estudo', 'progress-thin');
  const overview = h(
    'section',
    { class: 'overview', 'aria-labelledby': 'study-overview-title' },
    h('h2', { id: 'study-overview-title', class: 'overview-title' }, 'Progresso de estudo'),
    h('div', { class: 'study-total' }, overallPct, overallCount),
    overallBar.el,
    h('p', { class: 'overview-note' },
      "Este progresso é independente do Student's Book e do Workbook: marcar um assunto não conclui a unidade do livro, e concluir uma unidade não marca assuntos."),
    h('p', { class: 'overview-note' },
      'Por enquanto estão cadastrados Gramática, Vocabulário e Comunicação. Listening, Reading, Writing e Pronunciation entram quando forem confirmados no livro.'),
  );

  const filterButtons = new Map();
  const filterBar = h('div', { class: 'filter', role: 'group', 'aria-label': 'Mostrar assuntos' },
    FILTERS.map((f) => {
      const button = h('button', {
        class: 'filter-btn', type: 'button', 'aria-pressed': String(f.id === state.filter),
        onClick: () => setFilter(f.id),
      }, f.label);
      filterButtons.set(f.id, button);
      return button;
    }));

  const booksEl = h('section', { class: 'books', 'aria-label': 'Conteúdos de estudo por nível' });
  const status = h('div', { class: 'study-status' });

  const materialsSection = createMaterialsSection({ slug: ENGLISH_SLUG, title: 'My English Journey' });

  root.append(overview, materialsSection, filterBar, status, booksEl);

  function setFilter(id) {
    state.filter = id;
    filterButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === id)));
    cards.forEach((card) => card.applyFilter());
  }

  // ---------- unidade ----------
  function createUnit(book, unit, card) {
    const bodyId = `study-${book.slug}-${unit.number}`;
    const count = h('span', { class: 'study-unit-count' });
    const bar = progressBar(`Progresso de ${unit.label}`, 'progress-thin');
    const toggleBtn = h('button', { class: 'study-unit-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId },
      h('span', { class: 'study-unit-name' },
        h('span', { class: 'study-unit-num' }, unit.label),
        h('span', { class: 'study-unit-title' }, unit.title || '')),
      count,
      h('span', { class: 'chevron' }, icon('chevron', 18)));
    const body = h('div', { id: bodyId, class: 'study-unit-body', role: 'region', 'aria-label': `Assuntos de ${unit.label}`, hidden: true });
    const el = h('li', { class: 'study-unit' }, toggleBtn, bar.el, body);

    const inputs = new Map(); // id -> { input, item }
    const groups = []; // { el, ids }
    let empty = null;
    let built = false;

    function build() {
      built = true;
      for (const group of groupByCategory(unit)) {
        const items = group.topics.map((topic) => {
          const input = h('input', {
            type: 'checkbox', checked: topic.done, 'aria-label': `${group.label}: ${topic.title}`,
            onChange: () => {
              toggleTopic(topic.id, input.checked, {
                onFailure: (error, retry) =>
                  toast(`Não foi possível salvar "${topic.title}". ${error.message}`, { type: 'error', actionLabel: 'Tentar novamente', onAction: retry }),
              });
            },
          });
          const item = h('li', { class: 'topic' },
            h('label', { class: 'unit' }, input, h('span', { class: 'box', 'aria-hidden': 'true' }), h('span', { class: 'topic-title' }, topic.title)));
          inputs.set(topic.id, { input, item, topic });
          return item;
        });
        const groupEl = h('div', { class: 'topic-group' },
          h('h4', { class: 'topic-cat' }, group.label),
          h('ul', { class: 'topics', 'aria-label': `${group.label} — ${unit.label}` }, items));
        groups.push({ el: groupEl, ids: group.topics.map((t) => t.id) });
        body.append(groupEl);
      }
      empty = h('p', { class: 'muted study-empty', role: 'status', hidden: true });
      body.append(empty);
    }

    const visible = (topic) => state.filter === 'all' || (state.filter === 'pending' ? !topic.done : topic.done);

    /** Mostra/oculta assuntos conforme o filtro. Chamado ao trocar o filtro ou abrir a unidade. */
    function applyFilter() {
      const shown = unit.topics.filter(visible).length;
      // Com filtro ativo, unidades sem nada a mostrar saem da lista.
      el.hidden = state.filter !== 'all' && shown === 0;
      if (!built) return;
      for (const { input, item, topic } of inputs.values()) {
        item.hidden = !visible(topic);
        if (input.checked !== topic.done) input.checked = topic.done;
      }
      for (const group of groups) group.el.hidden = group.ids.every((id) => !visible(inputs.get(id).topic));
      empty.hidden = shown !== 0;
      empty.textContent = EMPTY_TEXT[state.filter] || '';
    }

    function setOpen(open) {
      if (open && !built) build();
      toggleBtn.setAttribute('aria-expanded', String(open));
      el.classList.toggle('open', open);
      body.hidden = !open;
      if (open) applyFilter();
    }
    toggleBtn.addEventListener('click', () => setOpen(toggleBtn.getAttribute('aria-expanded') !== 'true'));

    /** Atualiza contagem, barra e checkboxes sem mexer na visibilidade (evita itens sumindo ao clicar). */
    function update() {
      const p = unitProgress(unit);
      count.textContent = `${p.completed}/${p.total}`;
      count.title = countText(p);
      el.classList.toggle('is-complete', p.total > 0 && p.completed === p.total);
      bar.set(p);
      if (built) {
        for (const { input, topic } of inputs.values()) if (input.checked !== topic.done) input.checked = topic.done;
      }
    }

    return { el, update, applyFilter };
  }

  // ---------- cartão de nível ----------
  function createCard(book) {
    const panelId = `study-panel-${book.slug}`;
    const percent = h('span', { class: 'percent' });
    const count = h('span', { class: 'count' });
    const bar = progressBar(`Progresso de estudo em ${book.title}`);

    const toggleButton = h('button', { class: 'card-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
      h('span', { class: 'dot', 'aria-hidden': 'true' }),
      h('span', { class: 'card-title' }, book.title),
      h('span', { class: 'level' }, book.level),
      h('span', { class: 'chevron' }, icon('chevron', 20)));

    const unitList = h('ul', { class: 'study-units', 'aria-label': `Unidades de ${book.title}` });
    const panel = h('div', { id: panelId, class: 'panel', role: 'region', 'aria-label': `Conteúdos de ${book.title}`, inert: true },
      h('div', { class: 'panel-inner' }, h('div', { class: 'panel-content' }, unitList)));

    const summary = h('div', { class: 'card-summary' },
      h('h3', { class: 'card-heading' }, toggleButton),
      bar.el,
      h('div', { class: 'progress-meta' }, percent, count));
    const el = h('article', { class: 'card', 'data-color': book.color, 'data-slug': book.slug }, summary, panel);

    const card = { book, el, units: [] };
    card.units = book.units.map((unit) => createUnit(book, unit, card));
    unitList.append(...card.units.map((u) => u.el));

    function setOpen(open) {
      el.classList.toggle('open', open);
      toggleButton.setAttribute('aria-expanded', String(open));
      panel.toggleAttribute('inert', !open);
    }
    summary.addEventListener('click', (event) => {
      if (event.target.closest('a, input')) return;
      setOpen(!el.classList.contains('open'));
    });

    card.update = () => {
      const p = bookProgress(book);
      percent.textContent = formatPercent(p.percent);
      count.textContent = countText(p);
      bar.set(p);
      card.units.forEach((u) => u.update());
    };
    card.applyFilter = () => card.units.forEach((u) => u.applyFilter());
    return card;
  }

  // ---------- atualização ----------
  function updateOverall() {
    const p = overallProgress();
    overallPct.textContent = formatPercent(p.percent);
    overallCount.textContent = countText(p);
    overallBar.set(p);
  }

  function renderStatus() {
    if (study.status === 'loading' || study.status === 'idle') {
      status.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'Carregando conteúdos de estudo…'));
    } else if (study.status === 'error') {
      status.replaceChildren(
        h('p', { class: 'form-error', role: 'alert' }, `Não foi possível carregar os conteúdos. ${study.error}`),
        h('button', { class: 'btn btn-small', type: 'button', onClick: () => loadStudy() }, 'Tentar novamente'));
    } else {
      status.replaceChildren();
    }
    const ready = study.status === 'ready';
    overview.hidden = !ready;
    filterBar.hidden = !ready;
    if (ready && cards.length === 0) {
      study.books.forEach((book) => cards.push(createCard(book)));
      booksEl.append(...cards.map((c) => c.el));
      cards.forEach((c) => { c.update(); c.applyFilter(); });
      updateOverall();
    }
  }

  const unsubscribe = subscribeStudy((event) => {
    if (event.type === 'status') renderStatus();
    else if (event.type === 'topic') {
      updateOverall();
      cards.forEach((c) => c.update());
    }
  });
  renderStatus();

  return {
    el: root,
    /** Chamado quando a aba é aberta: carrega os dados na primeira vez (ou após erro). */
    onShow() {
      if (study.status === 'idle' || study.status === 'error') loadStudy();
    },
    destroy: unsubscribe,
  };
}
