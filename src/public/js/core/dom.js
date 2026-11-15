export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escapa texto antes de inserir em HTML (proteção contra XSS). */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export function readAppData() {
  try {
    return JSON.parse(document.getElementById('app-data')?.textContent || '{}');
  } catch (_) {
    return {};
  }
}

export function readSeed(id) {
  try {
    return JSON.parse(document.getElementById(id)?.textContent || 'null');
  } catch (_) {
    return null;
  }
}

/** Debounce simples para evitar recálculos em rajadas de eventos. */
export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Anima a troca de valor de um elemento (indicador visual de atualização). */
export function flash(el) {
  if (!el) return;
  el.classList.remove('is-changed');
  void el.offsetWidth; // reinicia a animação
  el.classList.add('is-changed');
}

export function setText(el, value) {
  if (!el) return;
  const next = String(value ?? '—');
  if (el.textContent !== next) {
    el.textContent = next;
    flash(el);
  }
}
