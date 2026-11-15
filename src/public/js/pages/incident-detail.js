import { $ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast } from '../core/toast.js';

export function init() {
  const root = document.querySelector('[data-incident-id]');
  const id = root?.dataset.incidentId;
  if (!id) return;

  document.querySelector('[data-action="ack"]')?.addEventListener('click', async () => {
    try {
      await api(`/api/incidents/${id}/ack`, { method: 'POST', body: {} });
      toast('Incidente reconhecido', 'info');
      setTimeout(() => window.location.reload(), 300);
    } catch (err) { toast(err.message, 'down'); }
  });

  $('#incidentUpdateForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      status: fd.get('status') || undefined,
      severity: fd.get('severity') || undefined,
      message: (fd.get('message') || '').trim(),
    };
    if (body.status === 'resolved') {
      await api(`/api/incidents/${id}/resolve`, { method: 'POST', body: { message: body.message } });
    } else if (body.status || body.severity) {
      await api(`/api/incidents/${id}/update`, { method: 'POST', body });
    } else if (body.message) {
      await api(`/api/incidents/${id}/comment`, { method: 'POST', body: { message: body.message } });
    } else {
      toast('Informe uma atualização', 'warn');
      return;
    }
    toast('Atualização registrada', 'up');
    setTimeout(() => window.location.reload(), 300);
  });
}
