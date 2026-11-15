import { $, $$ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/toast.js';

/** Gerencia dependências na tela do monitor (adicionar, remover). */
export function init() {
  const card = $('#depsCard');
  if (!card) return;
  const monitorId = card.dataset.monitorId;

  $('#depForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    if (!f.dependsOnId.value) { toast('Selecione um monitor', 'warn'); return; }
    try {
      await api(`/api/monitors/${monitorId}/dependencies`, {
        method: 'POST',
        body: { dependsOnId: Number(f.dependsOnId.value), required: f.required.checked },
      });
      toast('Dependência adicionada', 'up');
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      toast(err.message, 'down');
    }
  });

  $$('[data-dep-remove]', card).forEach((btn) => btn.addEventListener('click', async () => {
    if (!(await confirmDialog('Remover esta dependência?', 'Remover'))) return;
    try {
      await api(`/api/monitors/${monitorId}/dependencies/${btn.dataset.depRemove}`, { method: 'DELETE' });
      setTimeout(() => window.location.reload(), 200);
    } catch (err) {
      toast(err.message, 'down');
    }
  }));
}
