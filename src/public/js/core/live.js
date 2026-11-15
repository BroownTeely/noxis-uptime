import { $, $$, setText } from './dom.js';
import { on, onResync } from './socket.js';
import { pct, ms } from './format.js';
import { api } from './api.js';

/**
 * Atualizações globais em tempo real: resumo da sidebar, contadores, badges
 * de incidentes e indicadores de estado — todos sem recarregar a página.
 */
export function applySummary(s) {
  if (!s) return;
  const set = (key, value) => $$(`[data-live="${key}"]`).forEach((el) => setText(el, value));
  set('total', s.total);
  set('online', s.online);
  set('offline', s.offline);
  set('paused', s.paused);
  set('problems', s.problems);
  set('availability', pct(s.availability24h));
  set('availability24h', pct(s.availability24h));
  set('avgLatency', s.avgLatencyMs !== null && s.avgLatencyMs !== undefined ? `${s.avgLatencyMs} ms` : '—');
  set('avgUptime30d', pct(s.avgUptime30d));
  set('openIncidents', s.openIncidents);

  const total = s.total || 0;
  const share = (n) => (total ? `${(n / total) * 100}%` : '0%');
  const bar = (key, n) => $$(`[data-live="${key}"]`).forEach((el) => { el.style.width = share(n); });
  bar('barUp', s.online);
  bar('barDown', s.offline);
  bar('barPaused', s.paused);

  // Oculta apenas o badge da sidebar quando não há incidentes; o KPI continua visível.
  $$('.nav-item__badge[data-live="openIncidents"]').forEach((el) => {
    el.hidden = !s.openIncidents;
  });
  $$('[data-live="problemDot"]').forEach((el) => { el.hidden = !s.offline; });
}

/** Atualiza a linha de um monitor (tabela ou detalhe) a partir do evento. */
export function applyMonitorUpdate(m) {
  if (!m) return;
  $$(`[data-monitor-id="${m.id}"]`).forEach((row) => {
    row.dataset.status = m.status;
    const badge = row.querySelector('[data-field="status"]');
    if (badge) {
      const label = { UP: 'Online', DOWN: 'Offline', PENDING: 'Pendente', DEGRADED: 'Degradado', MAINTENANCE: 'Manutenção', PAUSED: 'Pausado' }[m.status] || m.status;
      const cls = { UP: 'up', DOWN: 'down', PENDING: 'pending', DEGRADED: 'degraded', MAINTENANCE: 'maintenance', PAUSED: 'paused' }[m.status] || 'unknown';
      badge.className = `badge badge--${cls}`;
      if (badge.textContent.trim() !== label) badge.innerHTML = `<span class="badge__dot"></span>${label}`;
    }
    const lat = row.querySelector('[data-field="latency"]');
    if (lat) setText(lat, ms(m.latencyMs));
    const msg = row.querySelector('[data-field="message"]');
    if (msg) setText(msg, m.message || '—');
  });
}

/** Banner e indicador de atualização pendente, atualizados ao vivo. */
export function applyUpdateStatus(s) {
  if (!s) return;
  const banner = document.getElementById('updateBanner');
  if (banner) banner.hidden = !s.available;
  $$('.nav-item__badge[data-live="updatePending"]').forEach((el) => {
    el.textContent = '1';
    el.hidden = !s.available;
  });
}

export function initLiveSummary() {
  on('update:status', applyUpdateStatus);
  on('summary', applySummary);
  on('monitor:update', applyMonitorUpdate);
  on('system:stats', () => {});
  onResync(async () => {
    try {
      const { summary } = await api('/api/dashboard/summary');
      applySummary(summary);
    } catch (_) { /* a próxima atualização do servidor resolverá */ }
  });
}
