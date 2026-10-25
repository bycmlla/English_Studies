// Conteúdo expandido de um livro: unidades, Study Materials e anotações.
import * as api from './api.js';
import { h, icon, unitLabel, safeUrl, formatTime } from './dom.js';
import { getBook, toggleUnit, subscribe } from './store.js';
import { track } from './sync.js';
import { toast, modal, confirmDialog } from './ui.js';

const MATERIAL_KINDS = [
  { kind: 'student_book', label: "Student's Book" },
  { kind: 'workbook', label: 'Workbook' },
  { kind: 'audio', label: 'Audio Materials' },
];

const NOTES_AUTOSAVE_MS = 1000;
const dirtyNotes = new Set(); // slugs com anotações ainda não salvas
export const hasUnsavedNotes = () => dirtyNotes.size > 0;

// ---------- unidades ----------

function unitsSection(slug) {
  const book = getBook(slug);
  const inputs = new Map();

  const grid = h('ul', { class: 'units', 'aria-label': `Unidades de ${book.title}` });
  for (let number = 1; number <= book.totalUnits; number += 1) {
    const input = h('input', {
      type: 'checkbox',
      checked: book.done.has(number),
      'aria-label': `${unitLabel(number)} de ${book.title}`,
      onChange: () => {
        const wanted = input.checked;
        toggleUnit(slug, number, wanted, {
          onFailure: (error, retry) =>
            toast(`Não foi possível salvar ${unitLabel(number)}. ${error.message}`, {
              type: 'error',
              actionLabel: 'Tentar novamente',
              onAction: retry,
            }),
        });
      },
    });
    inputs.set(number, input);
    grid.append(
      h('li', {}, h('label', { class: 'unit' }, input, h('span', { class: 'box', 'aria-hidden': 'true' }), h('span', {}, unitLabel(number)))),
    );
  }

  // Mantém as caixas fiéis ao estado do store (reverte falhas, aplica mudanças de outro dispositivo).
  subscribe((event) => {
    if (event.type === 'reload' || (event.type === 'book' && event.slug === slug)) {
      const current = getBook(slug);
      if (!current) return;
      for (const [number, input] of inputs) {
        const done = current.done.has(number);
        if (input.checked !== done) input.checked = done;
      }
    }
  });

  return h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, 'Unidades'), grid);
}

// ---------- study materials ----------

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

async function openMaterialForm(slug, kindInfo, material) {
  const editing = Boolean(material);
  const titleInput = h('input', {
    id: `m-title-${slug}`, class: 'input', type: 'text', maxlength: 120, autocomplete: 'off',
    value: material?.title || '', placeholder: kindInfo.label,
  });
  const urlInput = h('input', {
    id: `m-url-${slug}`, class: 'input', type: 'url', required: true, maxlength: 2048,
    autocomplete: 'off', inputmode: 'url', value: material?.url || '', placeholder: 'https://…',
  });

  const body = h(
    'div',
    { class: 'modal-body' },
    h('div', { class: 'field' }, h('label', { for: titleInput.id }, 'Título (opcional)'), titleInput),
    h('div', { class: 'field' }, h('label', { for: urlInput.id }, 'Link'), urlInput),
  );

  return modal({
    title: `${editing ? 'Editar' : 'Adicionar'} link — ${kindInfo.label}`,
    body,
    buttons: [
      { label: 'Cancelar', kind: 'ghost' },
      {
        label: editing ? 'Salvar' : 'Adicionar',
        kind: 'primary',
        onClick: async (ctx) => {
          const url = urlInput.value.trim();
          if (!safeUrl(url)) {
            urlInput.focus();
            throw new Error('Informe um link válido, começando com http:// ou https://.');
          }
          ctx.setBusy(true);
          const data = { kind: kindInfo.kind, title: titleInput.value.trim() || null, url };
          const saved = await track(
            editing ? api.updateMaterial(slug, material.id, data) : api.createMaterial(slug, data),
          );
          ctx.close(saved);
        },
      },
    ],
  });
}

function materialsSection(slug) {
  const state = { status: 'loading', items: [], error: '' };
  const content = h('div', { class: 'materials' });
  const section = h('section', { class: 'panel-section' }, h('h3', { class: 'section-title' }, 'Study Materials'), content);

  async function load() {
    state.status = 'loading';
    render();
    try {
      state.items = await api.listMaterials(slug);
      state.status = 'ready';
    } catch (err) {
      state.status = 'error';
      state.error = err.message;
    }
    render();
  }

  function linkRow(item, kindInfo) {
    const href = safeUrl(item.url);
    const name = item.title || hostOf(item.url);
    return h(
      'li',
      { class: 'link-row' },
      h('div', { class: 'link-text' }, h('span', { class: 'link-title' }, name), item.title ? h('span', { class: 'link-host' }, hostOf(item.url)) : null),
      h(
        'div',
        { class: 'link-actions' },
        href
          ? h('a', { class: 'btn btn-small', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Abrir ${name} em nova aba` }, 'Abrir', icon('external', 14))
          : null,
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Editar', 'aria-label': `Editar ${name}`,
          onClick: async () => {
            const saved = await openMaterialForm(slug, kindInfo, item);
            if (saved) { state.items = state.items.map((m) => (m.id === saved.id ? saved : m)); render(); toast('Link atualizado.', { type: 'success' }); }
          },
        }, icon('edit')),
        h('button', {
          class: 'icon-btn', type: 'button', title: 'Remover', 'aria-label': `Remover ${name}`,
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Remover link?', message: `"${name}" será removido de ${kindInfo.label}.`, confirmLabel: 'Remover', danger: true,
            });
            if (!ok) return;
            try {
              await track(api.deleteMaterial(slug, item.id));
              state.items = state.items.filter((m) => m.id !== item.id);
              render();
              toast('Link removido.', { type: 'success' });
            } catch (err) {
              toast(`Não foi possível remover o link. ${err.message}`, { type: 'error' });
            }
          },
        }, icon('trash')),
      ),
    );
  }

  function render() {
    if (state.status === 'loading') {
      content.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'Carregando materiais…'));
      return;
    }
    if (state.status === 'error') {
      content.replaceChildren(
        h('p', { class: 'form-error', role: 'alert' }, `Não foi possível carregar os materiais. ${state.error}`),
        h('button', { class: 'btn btn-small', type: 'button', onClick: load }, 'Tentar novamente'),
      );
      return;
    }
    content.replaceChildren(
      ...MATERIAL_KINDS.map((kindInfo) => {
        const items = state.items.filter((m) => m.kind === kindInfo.kind);
        return h(
          'div',
          { class: 'material-group' },
          h(
            'div',
            { class: 'material-head' },
            h('h4', {}, kindInfo.label),
            h('button', {
              class: 'btn btn-small', type: 'button', 'aria-label': `Adicionar link em ${kindInfo.label}`,
              onClick: async () => {
                const saved = await openMaterialForm(slug, kindInfo, null);
                if (saved) { state.items = [...state.items, saved]; render(); toast('Link adicionado.', { type: 'success' }); }
              },
            }, icon('plus', 14), 'Adicionar'),
          ),
          items.length > 0
            ? h('ul', { class: 'link-list' }, items.map((item) => linkRow(item, kindInfo)))
            : h('p', { class: 'muted empty' }, 'Nenhum link cadastrado.'),
        );
      }),
    );
  }

  load();
  return section;
}

// ---------- anotações ----------

function notesSection(slug) {
  const status = h('span', { class: 'note-status', role: 'status', 'aria-live': 'polite' }, 'Carregando…');
  const retry = h('button', { class: 'btn btn-small', type: 'button', hidden: true }, 'Tentar novamente');
  const textarea = h('textarea', {
    id: `notes-${slug}`, class: 'input notes', rows: 6, maxlength: 20000, disabled: true,
    placeholder: 'Escreva aqui suas anotações sobre este livro…',
  });

  let timer = null;
  let saving = false;
  let lastSaved = '';

  const setStatus = (text, { error = false, canRetry = false } = {}) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
    retry.hidden = !canRetry;
  };

  async function save() {
    clearTimeout(timer);
    if (saving) return;
    const text = textarea.value;
    if (text === lastSaved) { dirtyNotes.delete(slug); return; }
    saving = true;
    setStatus('Salvando…');
    try {
      const saved = await track(api.saveNotes(slug, text));
      lastSaved = text;
      if (textarea.value === text) {
        dirtyNotes.delete(slug);
        setStatus(`Salvo ${formatTime(saved.updatedAt)}`);
      }
    } catch (err) {
      setStatus(`Não salvo: ${err.message}`, { error: true, canRetry: true });
      saving = false;
      return;
    }
    saving = false;
    if (textarea.value !== lastSaved) timer = setTimeout(save, NOTES_AUTOSAVE_MS);
  }

  let retryAction = save;
  retry.addEventListener('click', () => retryAction());
  textarea.addEventListener('input', () => {
    dirtyNotes.add(slug);
    setStatus('Alterações não salvas…');
    clearTimeout(timer);
    timer = setTimeout(save, NOTES_AUTOSAVE_MS);
  });
  textarea.addEventListener('blur', save);

  async function load() {
    setStatus('Carregando…');
    try {
      const notes = await api.getNotes(slug);
      textarea.value = notes.content;
      lastSaved = notes.content;
      textarea.disabled = false;
      retryAction = save;
      setStatus(notes.updatedAt ? `Última atualização ${formatTime(notes.updatedAt)}` : 'As anotações são salvas automaticamente.');
    } catch (err) {
      retryAction = load;
      setStatus(`Não foi possível carregar as anotações. ${err.message}`, { error: true, canRetry: true });
    }
  }

  load();
  return h(
    'section',
    { class: 'panel-section' },
    h('h3', { class: 'section-title' }, h('label', { for: textarea.id }, 'Anotações')),
    textarea,
    h('div', { class: 'note-footer' }, status, retry),
  );
}

/** Monta o painel de um livro. Carrega materiais e anotações apenas quando é criado (1ª abertura). */
export function createBookPanel(slug) {
  return h('div', { class: 'panel-content' }, unitsSection(slug), materialsSection(slug), notesSection(slug));
}
