// Aplica o tema salvo antes da primeira pintura, evitando o "flash" de tema errado.
// Sem preferência salva, o CSS segue o tema do sistema (prefers-color-scheme).
(function () {
  try {
    var saved = localStorage.getItem('mej.theme');
    if (saved === 'light' || saved === 'dark') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {
    /* localStorage indisponível: segue o tema do sistema */
  }
})();
