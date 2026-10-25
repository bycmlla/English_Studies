// Estado global de sincronização ("Salvando…", "Salvo", "Erro ao salvar"),
// exibido no cabeçalho. Só indica "Salvo" depois que a API confirmou.

const listeners = new Set();
let pending = 0;
let failed = false;
let savedTimer = null;
let state = 'idle'; // idle | saving | saved | error

function set(next) {
  state = next;
  listeners.forEach((fn) => fn(state));
}

export function onSyncChange(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function hasPendingSaves() {
  return pending > 0;
}

/** Acompanha uma operação de gravação e atualiza o indicador. */
export function track(promise) {
  pending += 1;
  clearTimeout(savedTimer);
  set('saving');
  return promise.then(
    (value) => {
      pending -= 1;
      if (pending === 0) {
        failed = false;
        set('saved');
        savedTimer = setTimeout(() => set('idle'), 2500);
      }
      return value;
    },
    (error) => {
      pending -= 1;
      failed = true;
      set(pending === 0 ? 'error' : 'saving');
      throw error;
    },
  );
}

export function hasSyncError() {
  return failed;
}
