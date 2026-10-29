// Materiais de Estudo: links de apoio (vídeos, áudios ...) por curso, nível, categoria e unidade.
// Nada é fixo no código: tudo vem do banco e é cadastrado pelo usuário. Abrir um link não marca
// nenhuma unidade como concluída (os links são âncoras simples para uma nova aba).
import * as api from './api.js';
import { h, icon, safeUrl } from './dom.js';
import { themeButton, coverEl, logoutButton, topNav } from './chrome.js';
import { materialsHref, replaceHash } from './router.js';
import { onSyncChange, track } from './sync.js';
import { toast, modal, confirmDialog } from './ui.js';

const SYNC_TEXT = { saving: 'Salvando…', saved: 'Salvo', error: 'Erro ao salvar' };
const NEW_CATEGORY = '__new__';
const UNITS = Array.from({ length: 16 }, (_, i) => i + 1);

/** Minúsculas e sem acentos, para pesquisar "video" e achar "Vídeo". */
const normalize = (text) => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const option = (value, label) => h('option', { value: String(value) }, label);
const field = (id, label, control, extra = {}) =>
  h('div', { class: 'field', ...extra }, h('label', { for: id }, label), control);

export function renderMaterialsPage(root, { courses, courseSlug, onLogout }) {
  const state = {
    slug: courses.some((c) => c.slug === courseSlug) ? courseSlug : courses[0]?.slug,
    data: new Map(), // slug do curso -> { course, levels, categories, materials }
    status: 'loading', // loading | ready | error
    error: '',
    filters: { q: '', category: '', unit: '' },
    open: new Map(), // `${curso}:${nível}` -> aberto/fechado escolhido pelo usuário
  };
  const current = () => state.data.get(state.slug);

  // ---------- dados ----------
  async function load(slug, { force = false } = {}) {
    if (!force && state.data.has(slug)) return state.data.get(slug);
    const payload = await api.getCourseMaterials(slug);
    state.data.set(slug, payload);
    return payload;
  }

  async function selectCourse(slug, { force = false } = {}) {
    state.slug = slug;
    state.filters = { q: '', category: '', unit: '' };
    searchInput.value = '';
    replaceHash(materialsHref(slug));
    courseButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === slug)));
    state.status = 'loading';
    renderAll();
    try {
      await load(slug, { force });
      if (state.slug !== slug) return;
      state.status = 'ready';
    } catch (err) {
      if (state.slug !== slug) return;
      state.status = 'error';
      state.error = err.message;
    }
    renderAll();
  }

  // ---------- cabeçalho, seletor de curso e barra de ferramentas ----------
  const syncChip = h('span', { class: 'sync-chip', role: 'status', 'aria-live': 'polite' });
  const unsubscribeSync = onSyncChange((s) => {
    syncChip.hidden = s === 'idle';
    syncChip.dataset.state = s;
    syncChip.textContent = SYNC_TEXT[s] || '';
  });

  const courseButtons = new Map();
  const picker = h('div', { class: 'filter course-picker', role: 'group', 'aria-label': 'Curso' },
    courses.map((course) => {
      const button = h('button', {
        class: 'filter-btn', type: 'button', 'aria-pressed': String(course.slug === state.slug),
        onClick: () => { if (course.slug !== state.slug) selectCourse(course.slug); },
      }, course.title);
      courseButtons.set(course.slug, button);
      return button;
    }));

  const searchInput = h('input', {
    id: 'mat-search', class: 'input', type: 'search', placeholder: 'Pesquisar pelo nome…', autocomplete: 'off',
    maxlength: 160, onInput: () => { state.filters.q = searchInput.value; renderContent(); },
  });
  const categorySelect = h('select', {
    id: 'mat-category', class: 'input', 'aria-label': 'Filtrar por categoria',
    onChange: () => { state.filters.category = categorySelect.value; renderContent(); },
  });
  const unitSelect = h('select', {
    id: 'mat-unit', class: 'input', 'aria-label': 'Filtrar por unidade',
    onChange: () => { state.filters.unit = unitSelect.value; renderContent(); },
  });
  const addButton = h('button', { class: 'btn btn-primary', type: 'button', onClick: () => addMaterial() },
    icon('plus', 16), 'Adicionar material');
  const categoriesButton = h('button', { class: 'btn', type: 'button', onClick: () => manageCategories() }, 'Categorias');

  const toolbar = h('div', { class: 'mat-toolbar' },
    h('label', { class: 'visually-hidden', for: 'mat-search' }, 'Pesquisar materiais pelo nome'),
    searchInput, categorySelect, unitSelect, addButton, categoriesButton);

  const summary = h('p', { class: 'muted mat-summary', role: 'status', 'aria-live': 'polite' });
  const content = h('div', { class: 'mat-content' });

  // ---------- filtros ----------
  const filtersActive = () => Boolean(state.filters.q.trim() || state.filters.category || state.filters.unit);

  function matches(material) {
    const { q, category, unit } = state.filters;
    if (category && String(material.categoryId) !== category) return false;
    if (unit === 'none' ? material.unitNumber !== null : unit && String(material.unitNumber) !== unit) return false;
    const needle = normalize(q.trim());
    return !needle || normalize(`${material.title} ${material.description}`).includes(needle);
  }

  function renderFilterOptions() {
    const data = current();
    if (!data) return;
    categorySelect.replaceChildren(option('', 'Todas as categorias'), ...data.categories.map((c) => option(c.id, c.name)));
    categorySelect.value = state.filters.category;
    const hasLevels = data.levels.length > 0;
    unitSelect.hidden = !hasLevels;
    toolbar.classList.toggle('no-unit', !hasLevels);
    unitSelect.replaceChildren(option('', 'Todas as unidades'), ...UNITS.map((n) => option(n, `Unit ${n}`)), option('none', 'Sem unidade'));
    unitSelect.value = state.filters.unit;
  }

  // ---------- lista ----------
  function itemRow(material) {
    const href = safeUrl(material.url);
    const name = material.title;
    return h('li', { class: 'mat-item', 'data-id': material.id },
      h('div', { class: 'mat-main' },
        h('p', { class: 'mat-title-line' },
          material.unitNumber !== null ? h('span', { class: 'mat-unit' }, `Unit ${material.unitNumber} — `) : null,
          h('span', { class: 'mat-title' }, name)),
        h('p', { class: 'mat-desc' }, material.description || hostOf(material.url))),
      h('div', { class: 'mat-actions' },
        href
          ? h('a', { class: 'btn btn-small', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Abrir ${name} em nova aba` }, 'Abrir link', icon('external', 14))
          : null,
        h('button', { class: 'icon-btn', type: 'button', title: 'Editar', 'aria-label': `Editar ${name}`, onClick: () => editMaterial(material) }, icon('edit')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Excluir', 'aria-label': `Excluir ${name}`, onClick: () => removeMaterial(material) }, icon('trash'))));
  }

  /** Um bloco (nível ou, em cursos sem níveis, "Materiais") com os grupos por categoria. */
  function groupBlock(data, { key, title, level, color, items, levelSlug }) {
    const hasItems = items.length > 0;
    const stored = state.open.get(`${state.slug}:${key}`);
    const isOpen = filtersActive() ? hasItems : stored ?? hasItems;
    const bodyId = `mat-body-${state.slug}-${key || 'all'}`;

    const body = h('div', { id: bodyId, class: 'mat-level-body', hidden: !isOpen });
    if (!hasItems) {
      body.append(h('p', { class: 'muted mat-empty' }, 'Nenhum material cadastrado aqui ainda.'));
    }
    for (const category of data.categories) {
      const inCategory = items.filter((m) => m.categoryId === category.id);
      if (inCategory.length === 0) continue;
      body.append(h('div', { class: 'mat-cat' },
        h('h4', { class: 'mat-cat-title' }, category.name, h('span', { class: 'mat-count' }, String(inCategory.length))),
        h('ul', { class: 'mat-list', 'aria-label': `${category.name}${title ? ` — ${title}` : ''}` }, inCategory.map(itemRow))));
    }

    const toggle = h('button', { class: 'mat-level-toggle', type: 'button', 'aria-expanded': String(isOpen), 'aria-controls': bodyId },
      color ? h('span', { class: 'dot', 'aria-hidden': 'true' }) : null,
      h('span', { class: 'mat-level-name' }, title || 'Materiais'),
      level ? h('span', { class: 'level' }, level) : null,
      h('span', { class: 'mat-count' }, String(items.length)),
      h('span', { class: 'chevron' }, icon('chevron', 18)));
    const article = h('article', { class: `card mat-level${isOpen ? ' open' : ''}`, 'data-color': color || undefined },
      h('div', { class: 'mat-level-head' },
        h('h3', { class: 'mat-level-heading' }, toggle),
        h('button', {
          class: 'btn btn-small', type: 'button', 'aria-label': `Adicionar material${title ? ` em ${title}` : ''}`,
          onClick: () => addMaterial({ book: levelSlug }),
        }, icon('plus', 14), 'Adicionar')),
      body);
    toggle.addEventListener('click', () => {
      const next = toggle.getAttribute('aria-expanded') !== 'true';
      state.open.set(`${state.slug}:${key}`, next);
      toggle.setAttribute('aria-expanded', String(next));
      article.classList.toggle('open', next);
      body.hidden = !next;
    });
    return article;
  }

  function renderContent() {
    const data = current();
    if (state.status === 'loading') {
      summary.textContent = '';
      content.replaceChildren(h('p', { class: 'muted', role: 'status' }, 'Carregando materiais…'));
      return;
    }
    if (state.status === 'error' || !data) {
      summary.textContent = '';
      content.replaceChildren(
        h('p', { class: 'form-error', role: 'alert' }, `Não foi possível carregar os materiais. ${state.error}`),
        h('button', { class: 'btn btn-small', type: 'button', onClick: () => selectCourse(state.slug, { force: true }) }, 'Tentar novamente'));
      return;
    }

    const shown = data.materials.filter(matches);
    const total = data.materials.length;
    summary.textContent = total === 0
      ? ''
      : filtersActive()
        ? `${shown.length} de ${total} ${total === 1 ? 'material' : 'materiais'}`
        : `${total} ${total === 1 ? 'material' : 'materiais'}`;

    if (total === 0) {
      content.replaceChildren(h('div', { class: 'empty-state' },
        h('h3', {}, 'Nenhum material cadastrado'),
        h('p', { class: 'muted' }, 'Clique em "Adicionar material" para cadastrar seus vídeos, áudios e links de apoio deste curso.')));
      return;
    }
    if (shown.length === 0) {
      content.replaceChildren(h('div', { class: 'empty-state' },
        h('h3', {}, 'Nenhum resultado'),
        h('p', { class: 'muted' }, 'Nenhum material corresponde à pesquisa e aos filtros escolhidos.'),
        h('button', { class: 'btn btn-small', type: 'button', onClick: clearFilters }, 'Limpar filtros')));
      return;
    }

    const blocks = data.levels.length > 0
      ? data.levels.map((lv) => ({ key: lv.slug, title: lv.title, level: lv.level, color: lv.color, levelSlug: lv.slug, items: shown.filter((m) => m.bookSlug === lv.slug) }))
        .filter((block) => !filtersActive() || block.items.length > 0)
      : [{ key: '', title: '', level: '', color: '', levelSlug: undefined, items: shown }];
    content.replaceChildren(...blocks.map((block) => groupBlock(data, block)));
  }

  function clearFilters() {
    state.filters = { q: '', category: '', unit: '' };
    searchInput.value = '';
    renderFilterOptions();
    renderContent();
  }

  function renderAll() {
    renderFilterOptions();
    const ready = state.status === 'ready';
    toolbar.hidden = false;
    addButton.disabled = !ready;
    categoriesButton.disabled = !ready;
    renderContent();
  }

  // ---------- cadastro / edição ----------
  async function openForm({ material = null, preset = {} } = {}) {
    const editing = Boolean(material);
    let slug = state.slug;

    const courseSel = h('select', { id: 'mf-course', class: 'input', disabled: editing },
      courses.map((c) => option(c.slug, c.title)));
    courseSel.value = slug;
    const levelSel = h('select', { id: 'mf-level', class: 'input' });
    const unitSel = h('select', { id: 'mf-unit', class: 'input' });
    const catSel = h('select', { id: 'mf-category', class: 'input' });
    const newCat = h('input', { id: 'mf-newcat', class: 'input', type: 'text', maxlength: 60, placeholder: 'Nome da nova categoria', autocomplete: 'off' });
    const titleInput = h('input', { id: 'mf-title', class: 'input', type: 'text', maxlength: 160, required: true, autocomplete: 'off', value: material?.title || '', placeholder: 'Ex.: Welcome!' });
    const urlInput = h('input', { id: 'mf-url', class: 'input', type: 'url', maxlength: 2048, required: true, autocomplete: 'off', inputmode: 'url', value: material?.url || '', placeholder: 'https://…' });
    const descInput = h('textarea', { id: 'mf-desc', class: 'input mf-desc', maxlength: 500, rows: 3, placeholder: 'Opcional' });
    descInput.value = material?.description || '';

    const levelField = field('mf-level', 'Nível', levelSel);
    const unitField = field('mf-unit', 'Unidade', unitSel);
    const newCatField = field('mf-newcat', 'Nova categoria', newCat, { hidden: true });

    function fill(values = {}) {
      const data = state.data.get(slug);
      const hasLevels = data.levels.length > 0;
      levelField.hidden = !hasLevels;
      unitField.hidden = !hasLevels;
      levelSel.replaceChildren(option('', 'Selecione o nível'), ...data.levels.map((l) => option(l.slug, `${l.title} — ${l.level}`)));
      unitSel.replaceChildren(option('', 'Sem unidade específica'), ...UNITS.map((n) => option(n, `Unit ${n}`)));
      catSel.replaceChildren(...data.categories.map((c) => option(c.id, c.name)), option(NEW_CATEGORY, '＋ Nova categoria…'));
      levelSel.value = values.book ?? '';
      unitSel.value = values.unit == null ? '' : String(values.unit);
      catSel.value = String(values.categoryId ?? data.categories[0]?.id ?? '');
      syncDependents();
    }
    function syncDependents() {
      unitSel.disabled = !levelSel.value;
      if (unitSel.disabled) unitSel.value = '';
      newCatField.hidden = catSel.value !== NEW_CATEGORY;
    }
    levelSel.addEventListener('change', syncDependents);
    catSel.addEventListener('change', () => { syncDependents(); if (!newCatField.hidden) newCat.focus(); });
    courseSel.addEventListener('change', async () => {
      try {
        slug = courseSel.value;
        await load(slug);
        fill();
      } catch (err) {
        slug = state.slug;
        courseSel.value = slug;
        toast(`Não foi possível carregar o curso. ${err.message}`, { type: 'error' });
      }
    });

    fill({
      book: material?.bookSlug ?? preset.book,
      unit: material?.unitNumber ?? preset.unit,
      categoryId: material?.categoryId ?? preset.categoryId,
    });

    const body = h('div', { class: 'modal-body' },
      field('mf-course', 'Curso', courseSel),
      levelField, unitField,
      field('mf-category', 'Categoria', catSel), newCatField,
      field('mf-title', 'Nome do material', titleInput),
      field('mf-url', 'URL do conteúdo', urlInput),
      field('mf-desc', 'Descrição (opcional)', descInput));

    const result = await modal({
      title: editing ? 'Editar material' : 'Adicionar material',
      body,
      wide: true,
      buttons: [
        { label: 'Cancelar', kind: 'ghost' },
        {
          label: editing ? 'Salvar' : 'Adicionar',
          kind: 'primary',
          onClick: async (ctx) => {
            const data = state.data.get(slug);
            const title = titleInput.value.trim();
            const url = urlInput.value.trim();
            if (!title) { titleInput.focus(); throw new Error('Informe o nome do material.'); }
            if (!safeUrl(url)) { urlInput.focus(); throw new Error('Informe uma URL válida, começando com http:// ou https://.'); }
            if (data.levels.length > 0 && !levelSel.value) { levelSel.focus(); throw new Error('Escolha o nível.'); }
            if (catSel.value === NEW_CATEGORY && !newCat.value.trim()) { newCat.focus(); throw new Error('Informe o nome da nova categoria.'); }

            ctx.setBusy(true);
            let categoryId = Number(catSel.value);
            if (catSel.value === NEW_CATEGORY) {
              const created = await track(api.createMaterialCategory(slug, newCat.value.trim()));
              data.categories.push(created);
              categoryId = created.id;
            }
            const payload = {
              categoryId,
              bookSlug: data.levels.length > 0 ? levelSel.value : null,
              unitNumber: data.levels.length > 0 && unitSel.value ? Number(unitSel.value) : null,
              title,
              url,
              description: descInput.value.trim(),
            };
            await track(editing ? api.updateCourseMaterial(slug, material.id, payload) : api.createCourseMaterial(slug, payload));
            ctx.close({ slug });
          },
        },
      ],
      onReady: () => titleInput.focus(),
    });

    if (!result) return;
    toast(editing ? 'Material atualizado.' : 'Material adicionado.', { type: 'success' });
    // Recarrega do servidor (ordem e dados oficiais) e mostra o curso onde o material foi salvo.
    state.data.delete(result.slug);
    await selectCourse(result.slug, { force: true });
  }

  const addMaterial = (preset = {}) => {
    const { category, unit } = state.filters;
    return openForm({
      preset: {
        ...preset,
        categoryId: category ? Number(category) : undefined,
        unit: unit && unit !== 'none' ? Number(unit) : undefined,
      },
    });
  };
  const editMaterial = (material) => openForm({ material });

  async function removeMaterial(material) {
    const ok = await confirmDialog({
      title: 'Excluir material?',
      message: `"${material.title}" será removido. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await track(api.deleteCourseMaterial(state.slug, material.id));
      const data = current();
      data.materials = data.materials.filter((m) => m.id !== material.id);
      renderContent();
      toast('Material excluído.', { type: 'success' });
    } catch (err) {
      toast(`Não foi possível excluir o material. ${err.message}`, { type: 'error' });
    }
  }

  // ---------- categorias ----------
  async function askName({ title, value = '', label = 'Nome da categoria' }) {
    const input = h('input', { id: 'cat-name', class: 'input', type: 'text', maxlength: 60, autocomplete: 'off', value });
    return modal({
      title,
      body: h('div', { class: 'modal-body' }, field('cat-name', label, input)),
      buttons: [
        { label: 'Cancelar', kind: 'ghost' },
        {
          label: 'Salvar',
          kind: 'primary',
          onClick: (ctx) => {
            const name = input.value.trim();
            if (!name) { input.focus(); throw new Error('Informe o nome da categoria.'); }
            ctx.close(name);
          },
        },
      ],
      onReady: () => { input.focus(); input.select(); },
    });
  }

  async function manageCategories() {
    const slug = state.slug;
    const data = current();
    const list = h('ul', { class: 'cat-list', 'aria-label': 'Categorias' });
    const newInput = h('input', { id: 'cat-new', class: 'input', type: 'text', maxlength: 60, placeholder: 'Nova categoria', autocomplete: 'off' });
    const errorEl = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const showError = (message) => { errorEl.textContent = message || ''; errorEl.hidden = !message; };
    const usage = (id) => data.materials.filter((m) => m.categoryId === id).length;

    function renderList() {
      list.replaceChildren(...data.categories.map((category) => h('li', { class: 'cat-row' },
        h('span', { class: 'cat-name' }, category.name,
          category.isDefault ? h('span', { class: 'cat-tag' }, 'padrão') : h('span', { class: 'cat-tag' }, `${usage(category.id)} em uso`)),
        category.isDefault ? null : h('div', { class: 'link-actions' },
          h('button', {
            class: 'icon-btn', type: 'button', title: 'Renomear', 'aria-label': `Renomear ${category.name}`,
            onClick: async () => {
              const name = await askName({ title: 'Renomear categoria', value: category.name });
              if (!name || name === category.name) return;
              try {
                const saved = await track(api.renameMaterialCategory(slug, category.id, name));
                category.name = saved.name;
                showError('');
                renderList(); renderAll();
              } catch (err) { showError(err.message); }
            },
          }, icon('edit')),
          h('button', {
            class: 'icon-btn', type: 'button', title: 'Excluir', 'aria-label': `Excluir ${category.name}`,
            onClick: async () => {
              const ok = await confirmDialog({ title: 'Excluir categoria?', message: `A categoria "${category.name}" será removida.`, confirmLabel: 'Excluir', danger: true });
              if (!ok) return;
              try {
                await track(api.deleteMaterialCategory(slug, category.id));
                data.categories = data.categories.filter((c) => c.id !== category.id);
                showError('');
                renderList(); renderAll();
              } catch (err) { showError(err.message); }
            },
          }, icon('trash'))))));
    }

    async function addCategory() {
      const name = newInput.value.trim();
      if (!name) { newInput.focus(); return showError('Informe o nome da categoria.'); }
      try {
        const created = await track(api.createMaterialCategory(slug, name));
        data.categories.push(created);
        newInput.value = '';
        showError('');
        renderList(); renderAll();
      } catch (err) { showError(err.message); }
    }
    newInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addCategory(); } });
    renderList();

    await modal({
      title: `Categorias — ${data.course.title}`,
      body: h('div', { class: 'modal-body' },
        h('p', { class: 'muted' }, 'As categorias padrão não podem ser alteradas. Uma categoria só pode ser excluída quando não tiver materiais.'),
        list,
        h('div', { class: 'cat-add' }, newInput, h('button', { class: 'btn', type: 'button', onClick: addCategory }, icon('plus', 14), 'Adicionar')),
        errorEl),
      buttons: [{ label: 'Fechar', kind: 'ghost' }],
    });
  }

  // ---------- montagem ----------
  const main = h('main', { id: 'main', tabindex: '-1' },
    topNav('materials'),
    coverEl(),
    h('div', { class: 'page page-noicon materials-page' },
      h('header', { class: 'page-header' },
        h('div', { class: 'titles' },
          h('h1', {}, 'Materiais de Estudo'),
          h('p', { class: 'subtitle' }, 'Seus links de apoio, organizados por curso, nível e categoria')),
        h('div', { class: 'header-actions' }, syncChip, themeButton(), logoutButton(onLogout))),
      picker,
      toolbar,
      summary,
      content));
  root.replaceChildren(main);

  if (!state.slug) {
    content.replaceChildren(h('p', { class: 'muted' }, 'Nenhum curso disponível.'));
  } else {
    selectCourse(state.slug);
  }

  return () => unsubscribeSync();
}
