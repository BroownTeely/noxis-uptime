import { $, esc, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { formatDateTime } from '../core/format.js';

let page = 1;

async function load() {
  const qs = new URLSearchParams({ page: String(page), perPage: '50' });
  const q = $('#logSearch').value.trim();
  if (q) qs.set('q', q);
  if ($('#logSeverity').value) qs.set('severity', $('#logSeverity').value);
  if ($('#logEntity').value) qs.set('entity', $('#logEntity').value);
  const { logs, pagination } = await api(`/api/logs?${qs.toString()}`);
  const tbody = $('#logTable tbody');
  tbody.innerHTML = logs.map((l) => `<tr>
    <td class="mono">${esc(formatDateTime(l.createdAt))}</td>
    <td><span class="badge badge--${l.severity === 'error' ? 'down' : l.severity === 'warning' ? 'degraded' : l.severity === 'notice' ? 'pending' : 'unknown'}">${esc(l.severity)}</span></td>
    <td>${esc(l.username || '—')}</td>
    <td class="mono">${esc(l.action)}</td>
    <td>${esc(l.entity || '')}${l.entityId ? ` #${esc(l.entityId)}` : ''}</td>
    <td class="muted truncate">${esc(l.details ? JSON.stringify(l.details) : '')}</td>
    <td class="mono">${esc(l.ip || '')}</td></tr>`).join('')
    || '<tr><td colspan="7" class="empty">Nenhum registro</td></tr>';
  $('#logPager').innerHTML = `<span>${pagination.total} registro(s) · página ${pagination.page} de ${pagination.pages}</span>
    <span><button class="btn btn--sm" data-pg="-1" ${pagination.hasPrev ? '' : 'disabled'}>Anterior</button>
    <button class="btn btn--sm" data-pg="1" ${pagination.hasNext ? '' : 'disabled'}>Próxima</button></span>`;
}

export function init() {
  const reload = debounce(() => { page = 1; load().catch(() => {}); }, 300);
  $('#logSearch').addEventListener('input', reload);
  $('#logSeverity').addEventListener('change', reload);
  $('#logEntity').addEventListener('change', reload);
  $('#logPager').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pg]');
    if (!b) return;
    page += Number(b.dataset.pg);
    load().catch(() => {});
  });
  load().catch(() => {});
}
