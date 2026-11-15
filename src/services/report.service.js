'use strict';

const monitorsRepo = require('../db/repositories/monitors');
const { checksRepo, eventsRepo } = require('../db/repositories/checks');
const { getDatabase } = require('../db/connection');
const { RANGE_HOURS } = require('./dashboard.service');

const PERIODS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 };

/**
 * Relatórios de disponibilidade.
 * Método: disponibilidade = verificações ok / verificações registradas no período.
 * Períodos sem registros não entram no cálculo (são reportados como "sem dados"),
 * evitando tratar lacunas como indisponibilidade ou disponibilidade artificial.
 */
function periodStart(period, from, to) {
  if (from && to) return { start: new Date(from).toISOString(), end: new Date(to).toISOString(), label: `${from} a ${to}` };
  const hours = PERIODS[period] || PERIODS['7d'];
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), label: period || '7d' };
}

function incidentStats(monitorId, start, end) {
  const row = getDatabase().prepare(`
    SELECT COUNT(*) AS n,
           AVG(CASE WHEN resolved_at IS NOT NULL
                 THEN (julianday(resolved_at) - julianday(started_at)) * 86400 END) AS mttr
    FROM incidents WHERE (? IS NULL OR monitor_id = ?) AND started_at >= ? AND started_at <= ?`)
    .get(monitorId, monitorId, start, end);
  return { count: row.n || 0, mttrSeconds: row.mttr !== null ? Math.round(row.mttr) : null };
}

function downtimeSeconds(monitorId, start, end) {
  const rows = getDatabase().prepare(`
    SELECT previous_status, new_status, created_at FROM monitor_events
    WHERE monitor_id = ? AND created_at <= ? AND created_at >= ?
       OR (monitor_id = ? AND created_at < ? AND id = (
            SELECT MAX(id) FROM monitor_events WHERE monitor_id = ? AND created_at < ?))
    ORDER BY created_at ASC`).all(monitorId, end, start, monitorId, start, monitorId, start);
  let total = 0;
  let openSince = null;
  for (const r of rows) {
    const isDown = r.new_status === 'DOWN';
    if (isDown && openSince === null) openSince = Math.max(Date.parse(r.created_at), Date.parse(start));
    if (!isDown && openSince !== null) {
      total += Date.parse(r.created_at) - openSince;
      openSince = null;
    }
  }
  if (openSince !== null) total += Date.parse(end) - openSince;
  return Math.max(0, Math.round(total / 1000));
}

const reportService = {
  periods: Object.keys(PERIODS),

  monitorReport(monitor, { period, from, to }) {
    const { start, end, label } = periodStart(period, from, to);
    const avail = checksRepo.availability(monitor.id, start);
    const incidents = incidentStats(monitor.id, start, end);
    return {
      monitorId: monitor.id,
      name: monitor.name,
      groupName: monitor.groupName || 'Sem grupo',
      type: monitor.type,
      period: label,
      start, end,
      samples: avail.total,
      uptimePercent: avail.uptimePercent,
      avgLatencyMs: avail.avgLatencyMs,
      maxLatencyMs: avail.maxLatencyMs,
      downtimeSeconds: downtimeSeconds(monitor.id, start, end),
      incidents: incidents.count,
      mttrSeconds: incidents.mttrSeconds,
    };
  },

  report({ period = '7d', from, to, groupId = null } = {}) {
    const monitors = monitorsRepo.list({ groupId: groupId || null }).filter((m) => m.type !== 'push' || true);
    const rows = monitors.map((m) => reportService.monitorReport(m, { period, from, to }));
    const withData = rows.filter((r) => r.uptimePercent !== null);
    const overall = withData.length
      ? Math.round((withData.reduce((a, r) => a + r.uptimePercent, 0) / withData.length) * 100) / 100
      : null;
    return {
      period: rows[0]?.period || period,
      overallUptime: overall,
      monitorsWithoutData: rows.length - withData.length,
      rows,
      methodology: 'Disponibilidade = verificações bem-sucedidas / verificações registradas no período. '
        + 'Períodos sem verificações são excluídos do cálculo e contabilizados como "sem dados".',
    };
  },

  toCsv(report) {
    const header = ['monitor', 'grupo', 'tipo', 'periodo', 'verificacoes', 'disponibilidade_%', 'latencia_media_ms', 'latencia_max_ms', 'tempo_indisponivel_s', 'incidentes', 'mttr_s'];
    const esc = (v) => {
      const s = v === null || v === undefined ? '' : String(v);
      return /[";\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(';')];
    for (const r of report.rows) {
      lines.push([r.name, r.groupName, r.type, r.period, r.samples, r.uptimePercent, r.avgLatencyMs, r.maxLatencyMs,
        r.downtimeSeconds, r.incidents, r.mttrSeconds].map(esc).join(';'));
    }
    return '\ufeff' + lines.join('\n');
  },

  recentEvents(monitorId, limit = 100) {
    return eventsRepo.recent({ monitorId, limit });
  },
  RANGE_HOURS,
};

module.exports = reportService;
