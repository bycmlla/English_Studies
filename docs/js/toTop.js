// Botão flutuante "Voltar ao topo": aparece depois de rolar a página, em qualquer tela.
import { h, icon } from './dom.js';

const SHOW_AFTER_PX = 400;

export function initToTop() {
  const button = h('button', { class: 'to-top', type: 'button', 'aria-label': 'Voltar ao topo da página', title: 'Voltar ao topo' },
    icon('up', 22));

  button.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });

  let ticking = false;
  const update = () => {
    ticking = false;
    button.classList.toggle('is-visible', window.scrollY > SHOW_AFTER_PX);
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });

  document.body.append(button);
  update();
}
