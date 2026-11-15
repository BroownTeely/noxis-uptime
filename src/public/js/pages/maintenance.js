import { $ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/toast.js';

/** Página de manutenções: exclusão. Agendamento é feito no modal. */
export function init() {
  $('#maintenanceTable')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action="delete-maintenance"]');
    if (!btn) return;
    const row = btn.closest('tr');
    if (!(await confirmDialog('Remover esta manutenção?', 'Remover'))) return;
    try {
      await api(`/api/maintenance/${row.dataset.maintenanceId}`, { method: 'DELETE' });
      row.remove();
      toast('Manutenção removida', 'warn');
    } catch (err) {
      toast(err.message, 'down');
    }
  });
}
