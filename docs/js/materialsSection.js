// Seção "Materiais" de um curso: cartão recolhível com o quadro de materiais daquele curso.
// Começa fechada e só carrega os materiais na primeira abertura.
import { h, icon } from './dom.js';
import { createMaterialsBoard } from './materialsBoard.js';

/** @param {{ slug: string, title: string }} course */
export function createMaterialsSection(course) {
  const bodyId = `materials-body-${course.slug}`;
  const titleId = `materials-title-${course.slug}`;
  const toggle = h('button', { class: 'section-toggle', type: 'button', 'aria-expanded': 'false', 'aria-controls': bodyId },
    h('span', {}, 'Materiais'),
    h('span', { class: 'chevron' }, icon('chevron', 18)));
  const body = h('div', { id: bodyId, class: 'materials-section-body', hidden: true });
  const section = h('section', { class: 'overview materials-section', 'aria-labelledby': titleId },
    h('h2', { id: titleId, class: 'overview-title' }, toggle),
    body);

  let board = null;
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    section.classList.toggle('is-open', open);
    body.hidden = !open;
    if (open && !board) {
      board = createMaterialsBoard({ course });
      body.append(
        h('p', { class: 'overview-note mat-intro' },
          `Seus links de apoio de ${course.title}. Abrir um link não conclui nenhuma unidade nem altera o progresso.`),
        board.el);
      board.start();
    }
  });
  return section;
}
