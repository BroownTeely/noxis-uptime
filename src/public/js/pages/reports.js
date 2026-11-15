import { $, $$, esc } from '../core/dom.js';
import { api } from '../core/api.js';
import { pct } from '../core/format.js';

let period = '7d';

function fmtSec(s) {
  if (s === null || s === undefined) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}min`;
  return `${(s / 3600).toFixed(1)}h`;
}

async function load() {
  const group = $('#reportGroup').value;
  const qs = new URLSearchParams({ period });
  if (group) qs.set('groupId', group);
  $('#exportCsv').href = `/api/reports/export.csv?${qs.toString()}`;
  const body = $('#reportTable tbody');
  body.innerHTML = '<tr><td colspan="9" class="empty">Carregando</td></tr>';
  const data = await api(`/api/reports?${qs.toString()}`);
  $('#rOverall').textContent = pct(data.overallUptime);
  $('#rCount').textContent = String(data.rows.length);
  $('#rNoData').textContent = String(data.monitorsWithoutData);
  $('#methodology').textContent = data.methodology;
  body.innerHTML = data.rows.map((r) => `<tr>
    <td><a href="/monitors/${Number(r.monitorId)}">${esc(r.name)}</a></td>
    <td>${esc(r.groupName)}</td>
    <td class="num mono">${r.samples}</td>
    <td class="num mono">${pct(r.uptimePercent)}</td>
    <td class="num mono">${r.avgLatencyMs !== null ? `${r.avgLatencyMs} ms` : '—'}</td>
    <td class="num mono">${r.maxLatencyMs !== null ? `${r.maxLatencyMs} ms` : '—'}</td>
    <td class="num mono">${fmtSec(r.downtimeSeconds)}</td>
    <td class="num mono">${r.incidents}</td>
    <td class="num mono">${fmtSec(r.mttrSeconds)}</td></tr>`).join('')
    || '<tr><td colspan="9" class="empty">Nenhum monitor</td></tr>';
}

export function init() {
  $$('#periodTabs button').forEach((btn) => btn.addEventListener('click', () => {
    period = btn.dataset.period;
    $$('#periodTabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    load().catch((err) => { $('#reportTable tbody').innerHTML = `<tr><td colspan="9" class="empty">${esc(err.message)}</td></tr>`; });
  }));
  $('#reportGroup').addEventListener('change', () => load().catch(() => {}));
  load().catch(() => {});
}
