// Tela "Meus Estudos": escolha do curso. Todo percentual vem da API (calculado a partir do
// que está salvo no banco); aqui nada é fixo.
import { h, formatPercent } from './dom.js';
import { hrefTo } from './router.js';
import { themeButton, coverEl, logoutButton, topNav } from './chrome.js';

const STATUS_LABEL = { not_started: 'Não iniciado', studying: 'concluído', completed: 'Concluído' };

function countText(course) {
  const { completed, total } = course.progress;
  if (course.kind === 'english_journey') return `${completed} de ${total} atividades concluídas`;
  return total === 0 ? 'Módulos e aulas ainda não cadastrados' : `${completed} de ${total} aulas concluídas`;
}

function courseCard(course) {
  const { percent, status } = course.progress;
  const fill = h('div', { class: 'progress-fill' });
  fill.style.setProperty('--value', `${percent}%`);
  const bar = h('div', {
    class: 'progress', role: 'progressbar', 'aria-label': `Progresso em ${course.title}`,
    'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent,
    'aria-valuetext': `${formatPercent(percent)} — ${STATUS_LABEL[status]}`,
  }, fill);

  return h(
    'a',
    { class: 'course-card', href: hrefTo(course.slug), 'data-status': status, 'data-course': course.slug },
    h('div', { class: 'course-head' },
      h('div', { class: 'course-text' },
        h('h2', { class: 'course-title' }, course.title),
        h('p', { class: 'course-desc' }, course.description)),
      h('div', { class: 'course-pct' },
        h('span', { class: 'course-pct-value' }, formatPercent(percent)),
        h('span', { class: 'course-pct-label' }, STATUS_LABEL[status] || ''))),
    bar,
    h('p', { class: 'course-count' }, countText(course)),
  );
}

export function renderHub(root, { courses, onLogout }) {
  const main = h(
    'main',
    { id: 'main', tabindex: '-1' },
    topNav('hub'),
    coverEl(),
    h(
      'div',
      { class: 'page page-noicon' },
      h(
        'header',
        { class: 'page-header' },
        h('div', { class: 'titles' },
          h('h1', {}, 'Meus Estudos'),
          h('p', { class: 'subtitle' }, 'Escolha o curso que você quer acessar')),
        h('div', { class: 'header-actions' }, themeButton(), logoutButton(onLogout)),
      ),
      h('section', { class: 'course-list', 'aria-label': 'Meus cursos' }, courses.map(courseCard)),
    ),
  );
  root.replaceChildren(main);
  return () => {};
}
