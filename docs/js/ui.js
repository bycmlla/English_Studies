// Componentes de interface compartilhados: toasts e diálogos modais.
import { h, icon } from './dom.js';

let toastRoot;

function ensureToastRoot() {
  if (!toastRoot) {
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastRoot);
  }
  return toastRoot;
}

/**
 * @param {string} message
 * @param {{type?: 'success'|'error'|'info', actionLabel?: string, onAction?: Function, duration?: number}} [options]
 */
export function toast(message, { type = 'info', actionLabel, onAction, duration } = {}) {
  const root = ensureToastRoot();
  const el = h(
    'div',
    { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : undefined },
    type === 'error' ? icon('alert', 18) : null,
    h('span', { class: 'toast-text' }, message),
  );

  const dismiss = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 200);
  };
  if (actionLabel && onAction) {
    el.append(
      h('button', { class: 'toast-action', type: 'button', onClick: () => { dismiss(); onAction(); } }, actionLabel),
    );
  }
  el.append(h('button', { class: 'toast-close', type: 'button', 'aria-label': 'Fechar aviso', onClick: dismiss }, '×'));

  root.append(el);
  const ms = duration ?? (type === 'error' ? 9000 : 3500);
  if (ms > 0) setTimeout(dismiss, ms);
  return dismiss;
}

let dialogCounter = 0;

/**
 * Abre um diálogo modal (elemento <dialog>: foco preso e Esc fecham nativamente).
 * Cada botão pode ter `onClick(ctx)` assíncrono, onde ctx = { close, setError, setBusy }.
 * `onReady(ctx)` recebe o mesmo ctx assim que o diálogo abre.
 * Resolve com o valor passado a close() ou `undefined` ao cancelar.
 */
export function modal({ title, body, buttons, wide = false, onReady }) {
  return new Promise((resolve) => {
    const titleId = `dialog-title-${(dialogCounter += 1)}`;
    const errorEl = h('p', { class: 'form-error', role: 'alert', hidden: true });
    let result;

    const dialog = h('dialog', { class: wide ? 'modal modal-wide' : 'modal', 'aria-labelledby': titleId });
    const buttonEls = [];

    const ctx = {
      close(value) {
        result = value;
        dialog.close();
      },
      setError(message) {
        errorEl.textContent = message || '';
        errorEl.hidden = !message;
      },
      setBusy(busy) {
        buttonEls.forEach((el) => { el.disabled = busy; });
        dialog.toggleAttribute('aria-busy', busy);
      },
    };

    const primary = buttons.find((b) => b.kind === 'primary' || b.kind === 'danger');
    const run = async (button) => {
      ctx.setError('');
      if (!button.onClick) return ctx.close(button.value);
      try {
        await button.onClick(ctx);
      } catch (err) {
        ctx.setBusy(false);
        ctx.setError(err.message || 'Algo deu errado.');
      }
    };

    // O botão principal é "submit": Enter em qualquer campo aciona o formulário.
    for (const button of buttons) {
      const isPrimary = button === primary;
      buttonEls.push(
        h('button', {
          type: isPrimary ? 'submit' : 'button',
          class: `btn btn-${button.kind || 'ghost'}`,
          onClick: isPrimary ? undefined : () => run(button),
        }, button.label),
      );
    }

    const form = h(
      'form',
      { class: 'modal-form', novalidate: true, onSubmit: (event) => { event.preventDefault(); if (primary) run(primary); } },
      h('h2', { id: titleId, class: 'modal-title' }, title),
      body,
      errorEl,
      h('div', { class: 'modal-actions' }, buttonEls),
    );
    dialog.append(form);

    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(result);
    });
    // Clique no fundo (fora da caixa) cancela.
    dialog.addEventListener('mousedown', (event) => {
      if (event.target === dialog) dialog.close();
    });

    document.body.append(dialog);
    dialog.showModal();
    onReady?.(ctx);
  });
}

/** Pergunta de confirmação; resolve true/false. */
export async function confirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false, details }) {
  const body = h('div', { class: 'modal-body' }, h('p', {}, message), details || null);
  const result = await modal({
    title,
    body,
    buttons: [
      { label: 'Cancelar', kind: 'ghost', value: false },
      { label: confirmLabel, kind: danger ? 'danger' : 'primary', value: true },
    ],
  });
  return result === true;
}
