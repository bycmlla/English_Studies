// Rotas por hash (funcionam no GitHub Pages sem configuração de servidor):
//   (vazio) ou #/            → Meus Estudos
//   #/english-journey        → My English Journey (aba Livros)
//   #/english-journey/estudo → My English Journey (aba Conteúdos de Estudo)
//   #/<slug-do-curso>        → página do curso
export const ENGLISH_SLUG = 'english-journey';

export function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (raw === 'estudo') return { view: 'course', slug: ENGLISH_SLUG, sub: 'estudo' }; // link antigo
  const [slug = '', sub = ''] = raw.split('/');
  return slug ? { view: 'course', slug, sub } : { view: 'hub', slug: '', sub: '' };
}

export const hrefTo = (slug = '', sub = '') => (slug ? `#/${slug}${sub ? `/${sub}` : ''}` : '#/');

/** Troca o hash sem criar entrada no histórico nem disparar `hashchange`. */
export function replaceHash(hash) {
  try {
    history.replaceState(null, '', location.pathname + location.search + hash);
  } catch {
    /* sem histórico */
  }
}

/** O que identifica a "tela" atual: trocar só a aba dentro do curso não recarrega a tela. */
export const screenKey = (route = parseRoute()) => `${route.view}:${route.slug}`;
