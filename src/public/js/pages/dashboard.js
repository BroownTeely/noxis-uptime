import { $, $$, esc, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { on, onResync } from '../core/socket.js';
import { drawChart } from '../core/charts.js';
import { formatDateTime, statusMeta, pct } from '../core/format.js';

const RANGE_LABEL = { '24h': '24 h', '7d': '7 dias', '30d': '30 dias', '90d': '90 dias' };
let currentRange = '24h';

function labelFor(point, range) {
  const d = new Date(point.label.length === 10 ? `${point.label}T12:00:00Z` : `${point.label}:00Z`);
  const fmt = range === '24h' ? { hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: '2-digit' };
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', ...fmt, hour12: false }).format(d);
}

async function loadAvailability(range) {
  const data = await api(`/api/dashboard/availability?range=${range}`);
  const pts = data.points.map((p) => ({ ...p, shortLabel: labelFor(p, range), tooltipLabel: formatDateTime(`${p.label}${p.label.length === 10 ? 'T12:00' : ''}:00Z`, range === '24h') }));
  drawChart($('#chartAvailability'), pts.map((p) => ({ ...p, value: p.uptime })), { unit: '%', fixedMax: 100, color: 'var(--c-up)', emptyText: 'Sem verificações no período' });
  drawChart($('#chartLatency'), pts.map((p) => ({ ...p, value: p.latency })), { unit: 'ms', minMax: 10, color: 'var(--accent)', emptyText: 'Sem latência no período' });
  const label = $('[data-chart-range-label]');
  if (label) label.textContent = RANGE_LABEL[range];
}

async function loadIncidentsChart() {
  const data = await api('/api/dashboard/incidents?days=30');
  const pts = data.points.map((p) => ({ label: p.label, shortLabel: p.label.slice(5), tooltipLabel: p.label, value: p.value }));
  drawChart($('#chartIncidents'), pts, { type: 'bar', integer: true, color: 'var(--c-down)', emptyText: 'Nenhum incidente nos últimos 30 dias' });
}

function renderActivityRow(e) {
  const to = statusMeta(e.newStatus);
  const tr = document.createElement('tr');
  tr.className = 'is-fresh';
  tr.innerHTML = `<td class="mono">${esc(formatDateTime(e.createdAt))}</td>
    <td><a href="/monitors/${Number(e.monitorId)}">${esc(e.monitorName || '—')}</a></td>
    <td><span class="badge badge--${to.cls}">${esc(to.label)}</span></td>
    <td class="muted truncate">${esc(e.message || '')}</td>`;
  return tr;
}

function renderIncidents(list) {
  const ul = $('#latestIncidents');
  if (!ul) return;
  if (!list.length) {
    ul.innerHTML = '<li class="empty">Nenhum incidente registrado</li>';
    return;
  }
  ul.innerHTML = list.map((i) => `<li class="timeline__item">
    <span class="dot dot--${i.status === 'resolved' ? 'up' : 'down'}"></span>
    <div><a href="/incidents/${Number(i.id)}">${esc(i.title)}</a>
    <small class="muted">${esc(formatDateTime(i.startedAt))} · ${i.status === 'resolved' ? 'Resolvido' : 'Aberto'}</small></div></li>`).join('');
}

function renderGroups(groups) {
  const body = $('#groupsBody');
  if (!body) return;
  body.innerHTML = groups.map((g) => `<tr><td>${esc(g.name)}</td><td class="num">${g.total}</td>
    <td class="num c-up">${g.online}</td><td class="num c-down">${g.offline}</td>
    <td class="num mono">${pct(g.availability24h)}</td></tr>`).join('')
    || '<tr><td colspan="5" class="empty">Nenhum monitor cadastrado</td></tr>';
}

const refreshDebounced = debounce(async () => {
  try {
    const data = await api('/api/dashboard/overview');
    renderIncidents(data.incidents);
    renderGroups(data.groups);
  } catch (_) { /* mantém o estado atual */ }
}, 600);

export function init() {
  currentRange = '24h';
  loadAvailability(currentRange).catch(() => {});
  loadIncidentsChart().catch(() => {});

  $$('[data-range]').forEach((btn) => btn.addEventListener('click', () => {
    $$('[data-range]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
    currentRange = btn.dataset.range;
    loadAvailability(currentRange).catch(() => {});
  }));

  // Atualizações em tempo real (sem F5)
  on('event:new', (e) => {
    const body = $('#activityBody');
    if (!body) return;
    body.querySelector('.empty')?.closest('tr')?.remove();
    body.prepend(renderActivityRow(e));
    while (body.children.length > 12) body.lastElementChild.remove();
  });
  on('incident:update', refreshDebounced);
  on('monitor:status', () => refreshDebounced());
  onResync(() => {
    loadAvailability(currentRange).catch(() => {});
    refreshDebounced();
  });
  // Gráficos são atualizados também a cada 60s para refletir a janela deslizante.
  setInterval(() => loadAvailability(currentRange).catch(() => {}), 60000);
}
