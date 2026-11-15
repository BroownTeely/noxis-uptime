import { $ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/toast.js';

/** Página de grupos: exclusão. Criação e edição são feitas no modal. */
export function init() {
  $('#groupsTable')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="delete-group"]');
    if (!btn) return;
    const row = btn.closest('tr');
    if (!(await confirmDialog(`Excluir o grupo "${row.dataset.name}"? Os monitores ficarão sem grupo.`, 'Excluir'))) return;
    try {
      await api(`/api/groups/${row.dataset.groupId}`, { method: 'DELETE' });
      toast('Grupo excluído', 'warn');
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      toast(err.message, 'down');
    }
  });
}
