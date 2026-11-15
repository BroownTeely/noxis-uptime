import { $, $$, readSeed, esc, debounce } from '../core/dom.js';
import { api } from '../core/api.js';
import { on } from '../core/socket.js';
import { drawChart } from '../core/charts.js';
import { toast, confirmDialog } from '../core/toast.js';
import { formatDateTime, pct, statusMeta } from '../core/format.js';
import { setText } from '../core/dom.js';

let monitorId = null;

function hourLabel(iso) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Bahia', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(new Date(`${iso}:00Z`));
}

function drawLatency(series) {
  const points = series.map((p) => ({ label: p.bucket, shortLabel: hourLabel(p.bucket), tooltipLabel: formatDateTime(`${p.bucket}:00Z`, true), value: p.avg_latency !== null ? Math.round(p.avg_latency) : null }));
  drawChart($('#chartMonitorLatency'), points, { unit: 'ms', minMax: 10, color: 'var(--accent)', emptyText: 'Sem latência nas últimas 24 h' });
}

const refreshDetail = debounce(async () => {
  if (!monitorId) return;
  try {
    const d = await api(`/api/monitors/${monitorId}`);
    for (const key of ['24h', '7d', '30d', '90d']) {
      const el = document.querySelector(`[data-uptime="${key}"]`);
      if (el) setText(el, pct(d.uptime[key]?.uptimePercent));
    }
    const lat = d.latency;
    const fmt = (v) => (v === null || v === undefined ? '—' : `${v} ms`);
    setText(document.querySelector('[data-latency="avg"]'), fmt(lat.average7d));
    setText(document.querySelector('[data-latency="min"]'), fmt(lat.min7d));
    setText(document.querySelector('[data-latency="max"]'), fmt(lat.max7d));
    setText(document.querySelector('[data-latency="current"]'), fmt(lat.current));
    drawLatency(d.series);
    const checks = $('[data-list="checks"]');
    if (checks) {
      checks.innerHTML = d.checks.map((c) => `<tr><td class="mono">${esc(formatDateTime(c.checkedAt))}</td>
        <td><span class="badge badge--${c.ok ? 'up' : 'down'}">${c.ok ? 'OK' : 'Falha'}</span></td>
        <td class="num mono">${c.latencyMs !== null ? `${c.latencyMs} ms` : '—'}</td>
        <td class="muted truncate">${esc(c.message || '')}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Sem verificações</td></tr>';
    }
  } catch (_) { /* mantém valores atuais */ }
}, 1200);

export function init({ user }) {
  import('./monitor-dependencies.js').then((m) => m.init()).catch(() => {});
  const seed = readSeed('monitor-seed');
  monitorId = seed?.id ?? null;
  if (seed) drawLatency(seed.series || []);
  refreshDetail();

  // Atualizações em tempo real para este monitor.
  on('monitor:check', (c) => {
    if (c.id !== monitorId) return;
    refreshDetail();
  });
  on('monitor:update', (m) => {
    if (!m || m.id !== monitorId) return;
    const badge = document.querySelector('.detail-head [data-field="status"]');
    if (badge) {
      const meta = statusMeta(m.status);
      badge.className = `badge badge--${meta.cls} badge--lg`;
      badge.innerHTML = `<span class="badge__dot"></span>${esc(meta.label)}`;
    }
    setText(document.querySelector('[data-field="message"]'), m.message || '—');
    setText(document.querySelector('[data-field="lastCheck"]'), formatDateTime(m.lastCheckAt));
    setText(document.querySelector('[data-field="nextCheck"]'), formatDateTime(m.nextCheckAt));
  });
  on('event:new', (e) => {
    if (e.monitorId !== monitorId) return;
    const body = document.querySelector('[data-list="events"]');
    if (!body) return;
    const meta = statusMeta(e.newStatus);
    body.querySelector('.empty')?.closest('tr')?.remove();
    const tr = document.createElement('tr');
    tr.className = 'is-fresh';
    tr.innerHTML = `<td class="mono">${esc(formatDateTime(e.createdAt))}</td><td><span class="badge badge--${meta.cls}">${esc(meta.label)}</span></td><td class="mono">—</td><td class="muted truncate">${esc(e.message || '')}</td>`;
    body.prepend(tr);
  });

  const root = document.querySelector('.detail-head');
  root?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    const id = btn.dataset.id || monitorId;
    try {
      if (act === 'run') {
        await api(`/api/monitors/${id}/run`, { method: 'POST', body: {} });
        toast('Verificação enfileirada', 'info', 2000);
      } else if (act === 'toggle') {
        const active = btn.dataset.active === 'true';
        await api(`/api/monitors/${id}/${active ? 'pause' : 'resume'}`, { method: 'POST', body: {} });
        window.location.reload();
      } else if (act === 'duplicate') {
        const { monitor } = await api(`/api/monitors/${id}/duplicate`, { method: 'POST', body: {} });
        window.location.href = `/monitors/${monitor.id}`;
      } else if (act === 'rotate-push') {
        if (!(await confirmDialog('Gerar novo token? A URL antiga deixará de funcionar.', 'Gerar token'))) return;
        await api(`/api/monitors/${id}/rotate-push`, { method: 'POST', body: {} });
        window.location.reload();
      } else if (act === 'delete') {
        if (!(await confirmDialog('Excluir este monitor e todo o histórico?', 'Excluir'))) return;
        await api(`/api/monitors/${id}`, { method: 'DELETE' });
        window.location.href = '/monitors';
      }
    } catch (err) {
      toast(err.message, 'down');
    }
  });

  $('#pushUrl')?.addEventListener('click', async () => {
    const url = `${window.location.origin}${$('#pushUrl').dataset.pushPath}`;
    $('#pushUrl').textContent = url;
    try { await navigator.clipboard.writeText(url); toast('URL copiada', 'info', 2000); } catch (_) { /* clipboard indisponível */ }
  });
  void user; void $$;
}
