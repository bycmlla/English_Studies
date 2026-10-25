// Tela de login (sem cadastro público: a conta é criada no servidor por variáveis de ambiente).
import * as api from './api.js';
import { h } from './dom.js';

export function renderLogin(root, { message = '', onSuccess }) {
  // Acorda o servidor enquanto a pessoa digita (Render free hiberna por inatividade).
  api.wakeUp();

  const emailInput = h('input', {
    id: 'login-email', class: 'input', type: 'email', name: 'email', required: true,
    autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', inputmode: 'email',
  });
  const passwordInput = h('input', {
    id: 'login-password', class: 'input', type: 'password', name: 'password', required: true,
    autocomplete: 'current-password',
  });
  const error = h('p', { class: 'form-error', role: 'alert', hidden: !message }, message);
  const hint = h('p', { class: 'muted login-hint', role: 'status', 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Entrar');

  let slowTimer;
  const setBusy = (busy) => {
    submit.disabled = busy;
    emailInput.disabled = busy;
    passwordInput.disabled = busy;
    submit.textContent = busy ? 'Entrando…' : 'Entrar';
    clearTimeout(slowTimer);
    hint.textContent = '';
    if (busy) {
      slowTimer = setTimeout(() => {
        hint.textContent = 'O servidor está acordando. No plano gratuito isso pode levar cerca de 1 minuto…';
      }, 4000);
    }
  };

  const form = h(
    'form',
    {
      class: 'login-card', novalidate: true,
      onSubmit: async (event) => {
        event.preventDefault();
        error.hidden = true;
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        if (!email || !password) {
          error.textContent = 'Informe e-mail e senha.';
          error.hidden = false;
          (email ? passwordInput : emailInput).focus();
          return;
        }
        setBusy(true);
        try {
          const session = await api.login(email, password);
          passwordInput.value = '';
          onSuccess(session);
        } catch (err) {
          setBusy(false);
          error.textContent = err.message;
          error.hidden = false;
          passwordInput.select();
        }
      },
    },
    h('img', { class: 'login-icon', src: 'book.png', alt: '', width: 330, height: 326 }),
    h('h1', { class: 'login-title' }, 'My English Journey'),
    h('p', { class: 'subtitle' }, 'Meu painel de estudos de inglês'),
    h('div', { class: 'field' }, h('label', { for: 'login-email' }, 'E-mail'), emailInput),
    h('div', { class: 'field' }, h('label', { for: 'login-password' }, 'Senha'), passwordInput),
    error,
    submit,
    hint,
  );

  root.replaceChildren(h('main', { id: 'main', class: 'login-page', tabindex: '-1' }, form));
  emailInput.focus();
}
