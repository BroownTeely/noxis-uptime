'use strict';

const monitorsRepo = require('../db/repositories/monitors');
const { checksRepo, eventsRepo } = require('../db/repositories/checks');
const incidentsRepo = require('../db/repositories/incidents');
const { getDatabase } = require('../db/connection');

const RANGE_HOURS = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30, '90d': 24 * 90 };
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

const dashboardService = {
  /** Resumo consolidado: usado pelo painel e pelo Socket.IO. Todos os valores vêm do banco. */
  summary() {
    const counts = monitorsRepo.countByStatus();
    const monitors = monitorsRepo.list();
    const total = monitors.length;
    const online = (counts.UP || 0) + (counts.DEGRADED || 0);
    const offline = counts.DOWN || 0;
    const paused = counts.PAUSED || 0;
    const problems = offline + (counts.PENDING || 0) + (counts.DEGRADED || 0);
    const maintenance = counts.MAINTENANCE || 0;
    const global24 = checksRepo.globalAvailability(hoursAgo(24));
    const latencies = monitors.filter((m) => m.lastLatencyMs !== null && m.active).map((m) => m.lastLatencyMs);
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
    const uptimeValues = monitors.map((m) => checksRepo.availability(m.id, hoursAgo(24 * 30)).uptimePercent).filter((v) => v !== null);
    const avgUptime30 = uptimeValues.length ? Math.round((uptimeValues.reduce((a, b) => a + b, 0) / uptimeValues.length) * 100) / 100 : null;

    return {
      total,
      up: counts.UP || 0,
      degraded: counts.DEGRADED || 0,
      online,
      offline,
      pending: counts.PENDING || 0,
      paused,
      maintenance,
      problems,
      availability24h: global24.uptimePercent,
      avgLatencyMs: avgLatency,
      avgUptime30d: avgUptime30,
      openIncidents: incidentsRepo.countOpen(),
      generatedAt: new Date().toISOString(),
    };
  },

  /** Série de disponibilidade global para gráficos (por hora ou por dia). */
  availabilitySeries(range = '24h') {
    const hours = RANGE_HOURS[range] || 24;
    const bucket = hours <= 48 ? 'hour' : 'day';
    const fmt = bucket === 'hour' ? '%Y-%m-%dT%H:00' : '%Y-%m-%d';
    const rows = getDatabase().prepare(`
      SELECT strftime('${fmt}', checked_at) AS bucket,
             COUNT(*) AS total, SUM(ok) AS up, AVG(latency_ms) AS avg_latency
      FROM monitor_checks WHERE checked_at >= ?
      GROUP BY bucket ORDER BY bucket ASC`).all(hoursAgo(hours));
    return {
      range,
      bucket,
      points: rows.map((r) => ({
        label: r.bucket,
        uptime: r.total ? Math.round((r.up / r.total) * 10000) / 100 : null,
        latency: r.avg_latency !== null ? Math.round(r.avg_latency) : null,
        samples: r.total,
      })),
    };
  },

  /** Quantidade de incidentes e de quedas por dia nos últimos N dias. */
  incidentSeries(days = 30) {
    const rows = getDatabase().prepare(`
      SELECT substr(started_at, 1, 10) AS day, COUNT(*) AS n
      FROM incidents WHERE started_at >= ? GROUP BY day ORDER BY day ASC`).all(hoursAgo(days * 24));
    return rows.map((r) => ({ label: r.day, value: r.n }));
  },

  /** Top listas: maior latência, menor disponibilidade e problemas recentes. */
  rankings() {
    const monitors = monitorsRepo.list().filter((m) => m.active);
    const withStats = monitors.map((m) => {
      const a = checksRepo.availability(m.id, hoursAgo(24 * 7));
      return { id: m.id, name: m.name, status: m.status, latency: m.lastLatencyMs, uptime7d: a.uptimePercent, groupName: m.groupName };
    });
    const topLatency = withStats.filter((m) => m.latency !== null).sort((a, b) => b.latency - a.latency).slice(0, 5);
    const lowUptime = withStats.filter((m) => m.uptime7d !== null).sort((a, b) => a.uptime7d - b.uptime7d).slice(0, 5);
    const recentProblems = getDatabase().prepare(`
      SELECT m.id, m.name, COUNT(*) AS n FROM monitor_events e JOIN monitors m ON m.id = e.monitor_id
      WHERE e.new_status IN ('DOWN','PENDING','DEGRADED') AND e.created_at >= ?
      GROUP BY m.id ORDER BY n DESC LIMIT 5`).all(hoursAgo(24 * 7));
    return { topLatency, lowUptime, recentProblems };
  },

  /** Resumo por grupo com contagem e disponibilidade de 24h. */
  groupSummary() {
    const groups = getDatabase().prepare('SELECT id, name FROM monitor_groups ORDER BY position, name').all();
    const monitors = monitorsRepo.list();
    const result = groups.map((g) => {
      const members = monitors.filter((m) => m.groupId === g.id);
      const online = members.filter((m) => m.status === 'UP' || m.status === 'DEGRADED').length;
      const offline = members.filter((m) => m.status === 'DOWN').length;
      return { id: g.id, name: g.name, total: members.length, online, offline, paused: members.filter((m) => m.status === 'PAUSED').length,
        availability24h: average(members.map((m) => checksRepo.availability(m.id, hoursAgo(24)).uptimePercent)) };
    });
    const ungrouped = monitors.filter((m) => !m.groupId);
    if (ungrouped.length) {
      result.push({ id: null, name: 'Sem grupo', total: ungrouped.length,
        online: ungrouped.filter((m) => m.status === 'UP' || m.status === 'DEGRADED').length,
        offline: ungrouped.filter((m) => m.status === 'DOWN').length,
        paused: ungrouped.filter((m) => m.status === 'PAUSED').length,
        availability24h: average(ungrouped.map((m) => checksRepo.availability(m.id, hoursAgo(24)).uptimePercent)) });
    }
    return result;
  },

  /** Atividade recente: eventos de estado e incidentes. */
  activity(limit = 15) {
    return eventsRepo.recent({ limit });
  },

  /** Últimos incidentes e status de cada monitor, para o painel. */
  latestIncidents(limit = 5) {
    return incidentsRepo.list({ limit }).rows;
  },
};

function average(values) {
  const v = values.filter((x) => x !== null && x !== undefined);
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
}

module.exports = { dashboardService, RANGE_HOURS };
