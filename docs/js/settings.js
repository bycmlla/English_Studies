// Diálogo "Backup e conta": exportar, importar e sair.
import * as api from './api.js';
import { h, icon } from './dom.js';
import { modal, confirmDialog, toast } from './ui.js';
import { track } from './sync.js';

const MAX_BACKUP_BYTES = 1_500_000;

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportBackup(ctx) {
  ctx.setBusy(true);
  try {
    const data = await api.exportBackup();
    downloadJson(data, `my-english-journey-backup-${new Date().toISOString().slice(0, 10)}.json`);
    toast('Backup exportado.', { type: 'success' });
  } catch (err) {
    toast(`Não foi possível exportar o backup. ${err.message}`, { type: 'error' });
  } finally {
    ctx.setBusy(false);
  }
}

async function readBackupFile(file) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('O arquivo é grande demais para ser um backup válido.');
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  return payload;
}

function summaryList(summary) {
  return h(
    'ul',
    { class: 'summary-list' },
    h('li', {}, `${summary.books} livro(s)`),
    h('li', {}, `${summary.studentBookUnits} unidade(s) do Student's Book`),
    h('li', {}, `${summary.workbookUnits} unidade(s) do Workbook`),
    h('li', {}, `${summary.materials} link(s) de materiais`),
    h('li', {}, `${summary.studyTopics ?? 0} assunto(s) de Conteúdos de Estudo`),
  );
}

async function importBackup(file, ctx, onDataChanged) {
  ctx.setBusy(true);
  try {
    const payload = await readBackupFile(file);

    // 1) Valida no servidor sem gravar nada.
    let check;
    try {
      check = await api.importBackup(payload, { dryRun: true });
    } catch (err) {
      const details = Array.isArray(err.details) ? err.details.slice(0, 5).join(' · ') : '';
      throw new Error(details ? `${err.message} ${details}` : err.message);
    }

    // 2) Confirma com o usuário antes de substituir.
    ctx.setBusy(false);
    const ok = await confirmDialog({
      title: 'Substituir dados atuais?',
      message: 'Este backup substituirá o progresso e os links dos livros incluídos nele. Esta ação não pode ser desfeita.',
      confirmLabel: 'Importar e substituir',
      danger: true,
      details: summaryList(check.summary),
    });
    if (!ok) return;

    ctx.setBusy(true);
    await track(api.importBackup(payload));
    ctx.close('imported');
    toast('Backup importado com sucesso.', { type: 'success' });
    await onDataChanged();
  } catch (err) {
    ctx.setError(err.message);
  } finally {
    ctx.setBusy(false);
  }
}

export function openSettings({ session, onLogout, onDataChanged }) {
  let modalCtx;
  const fileInput = h('input', {
    id: 'backup-file', class: 'visually-hidden', type: 'file', accept: 'application/json,.json',
    onChange: () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (file && modalCtx) importBackup(file, modalCtx, onDataChanged);
    },
  });

  const body = h(
    'div',
    { class: 'modal-body' },
    h('p', { class: 'muted' }, 'Conectado como ', h('strong', {}, session.email)),
    h(
      'div',
      { class: 'settings-group' },
      h('h3', { class: 'section-title' }, 'Backup'),
      h('p', { class: 'muted' }, 'Inclui o progresso dos livros, os links de materiais e o progresso de Conteúdos de Estudo.'),
      h(
        'div',
        { class: 'settings-actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => exportBackup(modalCtx) }, icon('download', 16), 'Exportar JSON'),
        h('button', { class: 'btn', type: 'button', onClick: () => fileInput.click() }, icon('upload', 16), 'Importar JSON'),
        fileInput,
      ),
    ),
  );

  return modal({
    title: 'Backup e conta',
    body,
    onReady: (ctx) => { modalCtx = ctx; },
    buttons: [
      {
        label: 'Sair da conta', kind: 'ghost',
        onClick: async (ctx) => {
          ctx.close('logout');
          onLogout();
        },
      },
      { label: 'Fechar', kind: 'primary', value: 'closed' },
    ],
  });
}
