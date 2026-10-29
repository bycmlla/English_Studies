// Conteúdo expandido de um livro: progresso por material, unidades e Study Materials.
import * as api from './api.js';
import { h, icon, unitLabel, safeUrl, formatPercent } from './dom.js';
import { BOOK_TYPE_LABEL } from './progress.js';
import { getBook, viewOf, toggleUnit, subscribe } from './store.js';
import { track } from './sync.js';
import { toast, modal, confirmDialog } from './ui.js';

// Só este grupo aparece na interface. A chave interna `student_book` é mantida (banco/API/backups);
// a API ainda aceita `workbook` e `audio`, mas a tela não os exibe.
const MATERIAL_KINDS = [{ kind: 'student_book', label: 'Important links' }];

// ---------- seção que abre e fecha ----------

/** Seção com título clicável (abre/fecha o conteúdo). Começa fechada. */
function collapsibleSection(title, content, { open = false } = {}) {
  const toggle = h(
    'button',
    { class: 'section-toggle', type: 'button', 'aria-expanded': String(open), 'aria-controls': content.id },
    h('span', {}, title),
    h('span', { class: 'chevron' }, icon('chevron', 18)),
  );
  const section = h('section', { class: `panel-section collapsible${open ? ' is-open' : ''}` }, h('h3', { class: 'section-title' }, toggle), content);
  content.hidden = !open;
  toggle.addEventListener('click', () => {
    const next = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(next));
    section.classList.toggle('is-open', next);
    content.hidden = !next;
  });
  return section;
}

// ---------- unidades ----------

/** Bloco de progresso de um material (Student's Book ou Workbook): título, %, barra e contagem. */
function progressBlock(label) {
  const percent = h('span', { class: 'mp-pct' });
  const count = h('span', { class: 'mp-count' });
  const fill = h('div', { class: 'progress-fill' });
  const bar = h(
    'div',
    { class: 'progress progress-mid', role: 'progressbar', 'aria-label': `Progresso do ${label}`, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    fill,
  );
  const el = h('div', { class: 'mp' }, h('div', { class: 'mp-head' }, h('h4', { class: 'mp-title' }, label), percent), bar, count);

  return {
    el,
    update(summary) {
      percent.textContent = formatPercent(summary.percent);
      count.textContent = `${summary.completed} de ${summary.total} unidades`;
      fill.style.setProperty('--value', `${summary.percent}%`);
      bar.setAttribute('aria-valuenow', String(summary.percent));
      bar.setAttribute('aria-valuetext', `${formatPercent(summary.percent)} concluído`);
    },
  };
}

/**
 * Duas seções: progresso por material (cada um com barra e porcentagem) e a lista de
 * unidades com um checkbox para o Student's Book e outro para o Workbook.
 * Uma unidade só aparece como "Completa" quando os dois estão concluídos.
 */
function unitsSections(slug) {
  const book = getBook(slug);
  const inputs = new Map(); // `${bookType}:${number}` -> <input>
  const rowEls = new Map(); // number -> { row, badge }

  const blocks = {
    student_book: progressBlock(BOOK_TYPE_LABEL.student_book),
    workbook: progressBlock(BOOK_TYPE_LABEL.workbook),
  };
  const fullyLine = h('p', { class: 'muted full-line', role: 'status' });

  const list = h('ul', { id: `unit-rows-${slug}`, class: 'unit-rows', 'aria-label': `Unidades de ${book.title}` });
  for (let number = 1; number <= book.totalUnits; number += 1) {
    const toggle = (bookType) => {
      const label = BOOK_TYPE_LABEL[bookType];
      const input = h('input', {
        type: 'checkbox',
        checked: book.done[bookType].has(number),
        'aria-label': `${unitLabel(number)}: ${label} concluído`,
        onChange: () => {
          toggleUnit(slug, number, bookType, input.checked, {
            onFailure: (error, retry) =>
              toast(`Não foi possível salvar ${unitLabel(number)} (${label}). ${error.message}`, {
                type: 'error',
                actionLabel: 'Tentar novamente',
                onAction: retry,
              }),
          });
        },
      });
      inputs.set(`${bookType}:${number}`, input);
      return h('label', { class: 'unit' }, input, h('span', { class: 'box', 'aria-hidden': 'true' }), h('span', {}, label));
    };

    const badge = h('span', { class: 'unit-badge' });
    const row = h('li', { class: 'unit-row' }, h('span', { class: 'unit-name' }, unitLabel(number)), toggle('student_book'), toggle('workbook'), badge);
    rowEls.set(number, { row, badge });
    list.append(row);
  }

  // Redesenha a partir do store: reverte falhas, aplica mudanças de outro dispositivo.
  function refresh() {
    const current = getBook(slug);
    if (!current) return;
    const view = viewOf(current);

    blocks.student_book.update(view.studentBook);
    blocks.workbook.update(view.workbook);
    fullyLine.textContent = `${view.fullyCompletedUnits} de ${view.totalUnits} unidades 100% concluídas (Student's Book + Workbook).`;

    for (const [number, { row, badge }] of rowEls) {
      const sb = current.done.student_book.has(number);
      const wb = current.done.workbook.has(number);
      for (const [bookType, done] of [['student_book', sb], ['workbook', wb]]) {
        const input = inputs.get(`${bookType}:${number}`);
        if (input.checked !== done) input.checked = done;
      }
      const complete = sb && wb;
      row.classList.toggle('is-complete', complete);
      badge.dataset.state = complete ? 'complete' : sb || wb ? 'partial' : 'none';
      badge.textContent = complete ? 'Completa' : `${Number(sb) + Number(wb)}/2`;
    }
  }

  subscribe((event) => {
    if (event.type === 'reload' || (event.type === 'book' && event.slug === slug)) refresh();
  });
  refresh();

  return [
    h(
      'section',
      { class: 'panel-section' },
      h('h3', { class: 'section-title' }, 'Progresso por material'),
      h('div', { class: 'material-progress' }, blocks.student_book.el, blocks.workbook.el),
      fullyLine,
    ),
    collapsibleSection('Unidades', list),
  ];
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

/** Monta o painel de um livro. Carrega os materiais apenas quando é criado (1ª abertura). */
export function createBookPanel(slug) {
  return h('div', { class: 'panel-content' }, unitsSections(slug), materialsSection(slug));
}
