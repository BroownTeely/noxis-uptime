import { esc } from './dom.js';
import { toast } from './toast.js';

/**
 * Modals do painel. Um formulário (fragmento do servidor) é carregado e exibido
 * dentro de um <dialog>. Ao salvar, o modal fecha e a lista é atualizada.
 *
 * Gatilhos no HTML:
 *   <button data-open-fragment="/fragments/monitor-form?id=3"
 *           data-fragment="monitor-form" data-title="Editar monitor">
 */

// Módulo JavaScript que liga o formulário carregado (cada um exporta init()).
const MOUNTS = {
  'monitor-form': () => import('../pages/monitor-form.js'),
  'status-page-form': () => import('../pages/status-page-form.js'),
  'group-form': () => import('../pages/fragments/group-form.js'),
  'maintenance-form': () => import('../pages/fragments/maintenance-form.js'),
};

let open = null;

export async function openFragment(url, { title = '', fragment = '' } = {}) {
  if (open) open.close();
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
  if (res.status === 401) { window.location.href = '/login'; return null; }
  if (!res.ok) throw new Error((await res.text()).slice(0, 200) || 'Não foi possível abrir o formulário');
  const html = await res.text();

  const dlg = document.createElement('dialog');
  dlg.className = 'modal modal--xl';
  dlg.setAttribute('aria-label', title);
  dlg.innerHTML = `
    <div class="modal__head">
      <h2>${esc(title)}</h2>
      <button class="icon-btn" type="button" data-modal-close aria-label="Fechar">×</button>
    </div>
    <div class="modal__content">${html}</div>`;
  document.body.appendChild(dlg);
  open = dlg;

  dlg.addEventListener('close', () => {
    dlg.remove();
    if (open === dlg) open = null;
  });
  dlg.querySelector('[data-modal-close]').addEventListener('click', () => dlg.close());
  // Clique no fundo escuro fecha; clique dentro do conteúdo não.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
    const cancel = e.target.closest('[data-cancel-link]');
    if (cancel) { e.preventDefault(); dlg.close(); }
  });

  // Inicializa o formulário ANTES de exibir o modal: assim as regras de campos
  // (por tipo de monitor, por exemplo) já estão ativas quando o usuário interage.
  const mount = MOUNTS[fragment];
  if (mount) {
    const mod = await mount();
    mod.init?.();
  }
  dlg.showModal();
  dlg.querySelector('input, select, textarea')?.focus();
  return dlg;
}

/** Após salvar: fecha o modal (e atualiza a lista) ou navega, quando fora de modal. */
export function finishSave(form, url) {
  const dlg = form.closest('dialog');
  if (dlg) {
    dlg.close();
    setTimeout(() => window.location.reload(), 200);
  } else {
    window.location.href = url;
  }
}

/** Liga todos os gatilhos data-open-fragment da página (delegação de eventos). */
export function initModalTriggers() {
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-open-fragment]');
    if (!trigger) return;
    e.preventDefault();
    openFragment(trigger.dataset.openFragment, {
      title: trigger.dataset.title || '',
      fragment: trigger.dataset.fragment || '',
    }).catch((err) => toast(err.message, 'down'));
  });
}
