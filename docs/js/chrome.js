// Peças de interface compartilhadas pelas telas (Meus Estudos, My English Journey, cursos).
import { h, icon } from './dom.js';
import { hrefTo } from './router.js';

// ---------- tema ----------

const effectiveTheme = () =>
  document.documentElement.getAttribute('data-theme') ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('mej.theme', theme); } catch { /* preferência vale só nesta sessão */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#191919' : '#fbfbfa');
}

export function themeButton() {
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

// ---------- capa, navegação e conta ----------

/** Capa em largura total (desktop: capa larga; celular: capa estreita). */
export function coverEl() {
  return h(
    'picture',
    { class: 'cover' },
    h('source', { media: '(min-width: 721px)', srcset: 'cover_desktop.png' }),
    h('img', { src: 'cover.jpg', alt: '', width: 736, height: 149, decoding: 'async' }),
  );
}

export function logoutButton(onLogout) {
  return h('button', { class: 'btn btn-ghost btn-small logout-btn', type: 'button', title: 'Sair da conta', onClick: onLogout },
    icon('logout', 16), h('span', {}, 'Sair'));
}

/** Link para a tela Meus Estudos (sem novo login). */
export function backLink() {
  return h('a', { class: 'back-link', href: hrefTo() }, icon('back', 16), 'Voltar aos meus estudos');
}
