import { esc } from './dom.js';

/** Notificações visuais temporárias (toasts). Tipos: up, down, warn, info. */
export function toast(message, type = 'info', timeout = 4500) {
  const region = document.getElementById('toasts');
  if (!region) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'down' ? 'alert' : 'status');
  el.innerHTML = `<div class="toast__msg">${esc(message)}</div><button class="toast__close" aria-label="Fechar">×</button>`;
  const close = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector('button').addEventListener('click', close);
  region.appendChild(el);
  while (region.children.length > 4) region.firstElementChild.remove();
  if (timeout) setTimeout(close, timeout);
}

/** Diálogo de confirmação com o elemento <dialog> nativo. Retorna Promise<boolean>. */
export function confirmDialog(message, confirmLabel = 'Confirmar') {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = `
      <div class="modal__body">
        <h2>Confirmação</h2>
        <p class="muted" style="margin:8px 0 0">${esc(message)}</p>
        <div class="modal__footer" style="margin-top:18px">
          <button class="btn btn--ghost" value="cancel" type="button">Cancelar</button>
          <button class="btn btn--primary" value="ok" type="button">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
    dlg.querySelector('[value="cancel"]').addEventListener('click', () => dlg.close('cancel'));
    dlg.querySelector('[value="ok"]').addEventListener('click', () => dlg.close('ok'));
    dlg.showModal();
  });
}
