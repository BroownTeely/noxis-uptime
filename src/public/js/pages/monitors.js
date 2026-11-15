import { $, $$ } from '../core/dom.js';
import { api } from '../core/api.js';
import { toast, confirmDialog } from '../core/toast.js';

function applyFilters() {
  const q = ($('#monitorSearch')?.value || '').trim().toLowerCase();
  const status = $('#filterStatus')?.value || '';
  const group = $('#filterGroup')?.value || '';
  let visible = 0;
  $$('#monitorTable tbody tr[data-monitor-id]').forEach((row) => {
    const ok = (!q || row.dataset.search.includes(q))
      && (!status || row.dataset.status === status)
      && (!group || row.dataset.group === group);
    row.hidden = !ok;
    if (ok) visible += 1;
  });
  const count = $('#monitorCount');
  if (count) count.textContent = `${visible} monitor${visible === 1 ? '' : 'es'}`;
}

async function action(btn, row) {
  const id = row.dataset.monitorId;
  const act = btn.dataset.action;
  try {
    if (act === 'run') {
      await api(`/api/monitors/${id}/run`, { method: 'POST', body: {} });
      toast('Verificação enfileirada', 'info', 2500);
    } else if (act === 'toggle') {
      const active = btn.dataset.active === 'true';
      await api(`/api/monitors/${id}/${active ? 'pause' : 'resume'}`, { method: 'POST', body: {} });
      toast(active ? 'Monitor pausado' : 'Monitor retomado', 'info', 2500);
      setTimeout(() => window.location.reload(), 300);
    } else if (act === 'duplicate') {
      const { monitor } = await api(`/api/monitors/${id}/duplicate`, { method: 'POST', body: {} });
      toast(`Monitor duplicado: ${monitor.name}`, 'up');
      setTimeout(() => window.location.reload(), 500);
    } else if (act === 'delete') {
      const name = row.querySelector('.strong')?.textContent || '';
      if (!(await confirmDialog(`Excluir o monitor "${name}" e todo o seu histórico?`, 'Excluir'))) return;
      await api(`/api/monitors/${id}`, { method: 'DELETE' });
      row.remove();
      applyFilters();
      toast('Monitor excluído', 'warn');
    }
  } catch (err) {
    toast(err.message, 'down');
  }
}

export function init() {
  ['#monitorSearch', '#filterStatus', '#filterGroup'].forEach((sel) => {
    $(sel)?.addEventListener(sel === '#monitorSearch' ? 'input' : 'change', applyFilters);
  });
  $('#monitorTable')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    action(btn, btn.closest('tr'));
  });
  applyFilters();
}
