// Página de um curso baseado em módulos e aulas (ex.: Make 10 Hundred).
// A estrutura (módulos → aulas com checkbox e progresso) já está pronta; o conteúdo vem do
// banco. Enquanto não houver módulos cadastrados, a página mostra 0% / "Não iniciado".
import * as api from './api.js';
import { h, formatPercent } from './dom.js';
import { themeButton, coverEl, logoutButton, backLink, topNav } from './chrome.js';
import { onSyncChange, track } from './sync.js';
import { toast } from './ui.js';

const SYNC_TEXT = { saving: 'Salvando…', saved: 'Salvo', error: 'Erro ao salvar' };
const STATUS_TEXT = { not_started: 'Não iniciado', studying: 'Em andamento', completed: 'Concluído' };

const countText = ({ completed, total }) =>
  total === 0 ? 'Nenhuma aula cadastrada ainda' : `${completed} de ${total} aulas concluídas`;

function progressBar(label) {
  const fill = h('div', { class: 'progress-fill' });
  const el = h('div', {
    class: 'progress progress-thin', role: 'progressbar', 'aria-label': label,
    'aria-valuemin': 0, 'aria-valuemax': 100,
  }, fill);
  return {
    el,
    set(percent, text) {
      fill.style.setProperty('--value', `${percent}%`);
      el.setAttribute('aria-valuenow', String(percent));
      el.setAttribute('aria-valuetext', text);
    },
  };
}

export function renderCoursePage(root, { course, onLogout }) {
  const syncChip = h('span', { class: 'sync-chip', role: 'status', 'aria-live': 'polite' });
  const unsubscribeSync = onSyncChange((state) => {
    syncChip.hidden = state === 'idle';
    syncChip.dataset.state = state;
    syncChip.textContent = SYNC_TEXT[state] || '';
  });

  // ---------- progresso do curso ----------
  const pct = h('span', { class: 'stat-value' });
  const status = h('span', { class: 'status-pill' });
  const count = h('span', { class: 'count' });
  const bar = progressBar(`Progresso em ${course.title}`);

  function showProgress(progress) {
    pct.textContent = formatPercent(progress.percent);
    status.textContent = STATUS_TEXT[progress.status];
    status.className = `status-pill status-${progress.status}`;
    count.textContent = countText(progress);
    bar.set(progress.percent, `${formatPercent(progress.percent)} — ${STATUS_TEXT[progress.status]}`);
  }

  const overview = h('section', { class: 'overview', 'aria-labelledby': 'course-progress-title' },
    h('h2', { id: 'course-progress-title', class: 'overview-title' }, 'Progresso do curso'),
    h('div', { class: 'study-total' }, h('span', { class: 'course-pct-line' }, pct, status), count),
    bar.el);

  // ---------- módulos e aulas ----------
  const modulesEl = h('section', { class: 'course-modules', 'aria-label': 'Módulos do curso' });

  function moduleCard(module) {
    const chip = h('span', { class: 'study-unit-count' });
    const inputs = [];

    const updateChip = () => {
      chip.textContent = `${inputs.filter((i) => i.checked).length}/${inputs.length}`;
    };

    const items = module.lessons.map((lesson) => {
      const input = h('input', {
        type: 'checkbox', checked: lesson.completed, 'aria-label': `${module.title}: ${lesson.title}`,
        onChange: async () => {
          const wanted = input.checked;
          input.disabled = true;
          try {
            const result = await track(api.setCourseLesson(course.slug, lesson.id, wanted));
            showProgress(result.progress);
          } catch (error) {
            input.checked = !wanted;
            toast(`Não foi possível salvar "${lesson.title}". ${error.message}`, { type: 'error' });
          } finally {
            input.disabled = false;
            updateChip();
          }
        },
      });
      inputs.push(input);
      return h('li', { class: 'topic' },
        h('label', { class: 'unit' }, input, h('span', { class: 'box', 'aria-hidden': 'true' }), h('span', { class: 'topic-title' }, lesson.title)));
    });
    updateChip();

    return h('article', { class: 'module-card' },
      h('div', { class: 'module-head' }, h('h3', { class: 'module-title' }, module.title), chip),
      h('ul', { class: 'topics lessons', 'aria-label': `Aulas de ${module.title}` }, items));
  }

  if (course.modules.length === 0) {
    modulesEl.append(
      h('div', { class: 'empty-state' },
        h('h3', {}, 'Conteúdo em breve'),
        h('p', { class: 'muted' },
          'Os módulos e as aulas deste curso ainda não foram cadastrados. Quando forem adicionados, você poderá marcar cada aula como concluída e acompanhar o progresso aqui.')),
    );
  } else {
    modulesEl.append(...course.modules.map(moduleCard));
  }

  showProgress(course.progress);

  const main = h(
    'main',
    { id: 'main', tabindex: '-1' },
    topNav('hub'),
    coverEl(),
    h(
      'div',
      { class: 'page page-noicon course-page' },
      backLink(),
      h('header', { class: 'page-header' },
        h('div', { class: 'titles' },
          h('h1', {}, course.title),
          h('p', { class: 'subtitle' }, course.description)),
        h('div', { class: 'header-actions' }, syncChip, themeButton(), logoutButton(onLogout))),
      overview,
      modulesEl,
    ),
  );
  root.replaceChildren(main);

  return () => unsubscribeSync();
}
