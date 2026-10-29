// Página Materiais de Estudo (menu superior): escolha do curso + o quadro de materiais.
import { h } from './dom.js';
import { themeButton, coverEl, logoutButton, topNav } from './chrome.js';
import { materialsHref, replaceHash } from './router.js';
import { onSyncChange } from './sync.js';
import { createMaterialsBoard } from './materialsBoard.js';

const SYNC_TEXT = { saving: 'Salvando…', saved: 'Salvo', error: 'Erro ao salvar' };

export function renderMaterialsPage(root, { courses, courseSlug, onLogout }) {
  const syncChip = h('span', { class: 'sync-chip', role: 'status', 'aria-live': 'polite' });
  const unsubscribeSync = onSyncChange((state) => {
    syncChip.hidden = state === 'idle';
    syncChip.dataset.state = state;
    syncChip.textContent = SYNC_TEXT[state] || '';
  });

  const board = createMaterialsBoard({
    courses,
    slug: courseSlug,
    onCourseChange: (slug) => replaceHash(materialsHref(slug)),
  });

  const main = h('main', { id: 'main', tabindex: '-1' },
    topNav('materials'),
    coverEl(),
    h('div', { class: 'page page-noicon materials-page' },
      h('header', { class: 'page-header' },
        h('div', { class: 'titles' },
          h('h1', {}, 'Materiais de Estudo'),
          h('p', { class: 'subtitle' }, 'Seus links de apoio, organizados por curso, nível e categoria')),
        h('div', { class: 'header-actions' }, syncChip, themeButton(), logoutButton(onLogout))),
      board.el));
  root.replaceChildren(main);
  board.start();

  return () => unsubscribeSync();
}
