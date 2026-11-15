import { $, $$ } from '../../core/dom.js';
import { api } from '../../core/api.js';
import { toast } from '../../core/toast.js';
import { finishSave } from '../../core/modal.js';

export function init() {
  const form = $('#maintenanceForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const toIso = (v) => (v ? new Date(v).toISOString() : null);
    const err = $('#maintenanceFormError');
    err.hidden = true;
    try {
      await api('/api/maintenance', {
        method: 'POST',
        body: {
          title: fd.get('title'),
          description: fd.get('description'),
          startsAt: toIso(fd.get('startsAt')),
          endsAt: toIso(fd.get('endsAt')),
          monitorIds: $$('input[name="monitorIds"]:checked', form).map((i) => Number(i.value)),
          groupIds: $$('input[name="groupIds"]:checked', form).map((i) => Number(i.value)),
        },
      });
      toast('Manutenção agendada', 'up');
      finishSave(form, '/maintenance');
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.details?.error || ex.message;
    }
  });
}
