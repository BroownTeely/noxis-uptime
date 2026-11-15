import { $ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/toast.js';

export function init() {
  $('#statusPagesTable')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="delete-page"]');
    if (!btn) return;
    const row = btn.closest('tr');
    if (!(await confirmDialog('Excluir esta status page? O endereço público deixará de funcionar.', 'Excluir'))) return;
    try {
      await api(`/api/status-pages/${row.dataset.pageId}`, { method: 'DELETE' });
      row.remove();
      toast('Status page excluída', 'warn');
    } catch (err) {
      toast(err.message, 'down');
    }
  });
}
