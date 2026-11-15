'use strict';

const monitorsRepo = require('../db/repositories/monitors');
const { checksRepo, eventsRepo } = require('../db/repositories/checks');
const incidentsRepo = require('../db/repositories/incidents');
const audit = require('../db/repositories/audit');
const { validateMonitor, maskConfig } = require('../validators/monitor.validator');
const { TYPES } = require('../monitors/checks');

const WINDOWS = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);

/**
 * Segredos deixados em branco no formulário de edição mantêm o valor salvo;
 * cabeçalhos mascarados também são preservados.
 */
function keepSavedSecrets(next, prev = {}) {
  if (next.auth && prev.auth && next.auth.type === prev.auth.type) {
    for (const key of ['password', 'token', 'value']) {
      if (!next.auth[key] && prev.auth[key]) next.auth[key] = prev.auth[key];
    }
  }
  if (next.headers && prev.headers) {
    for (const [k, v] of Object.entries(prev.headers)) {
      if (/authorization|token|secret|api-key|cookie/i.test(k) && next.headers[k] === undefined) next.headers[k] = v;
      if (next.headers[k] === '••••••••') next.headers[k] = v;
    }
  }
  return next;
}

function presentMonitor(m) {
  if (!m) return null;
  return { ...m, config: maskConfig(m.config) };
}

/**
 * Regras de negócio de monitores. Controladores chamam este serviço; o serviço
 * persiste, audita e delega o agendamento ao motor.
 */
/** Monta o detalhe completo de um monitor (métricas, histórico e incidentes). */
function buildDetail(id) {
  const monitor = monitorsRepo.findById(id);
  if (!monitor) return null;
  const windows = {};
  for (const [label, days] of Object.entries(WINDOWS)) {
    const a = checksRepo.availability(id, daysAgo(days));
    windows[label] = { uptimePercent: a.uptimePercent, samples: a.total };
  }
  const latency = checksRepo.availability(id, daysAgo(7));
  return {
    monitor: presentMonitor(monitor),
    uptime: windows,
    latency: {
      current: monitor.lastLatencyMs,
      average7d: latency.avgLatencyMs,
      max7d: latency.maxLatencyMs,
      min7d: minLatency(id),
    },
    series: checksRepo.series(id, hoursAgo(24), 'hour'),
    seriesWeek: checksRepo.series(id, daysAgo(7), 'day'),
    checks: checksRepo.recent(id, 60),
    events: eventsRepo.recent({ monitorId: id, limit: 50 }),
    incidents: incidentsRepo.listForMonitor(id, 20),
    bars: heartbeatBars(id, 90),
  };
}

function createMonitorService(engine) {
  return {
    types: TYPES,

    list(filters) {
      return monitorsRepo.list(filters).map((m) => {
        const avail24 = checksRepo.availability(m.id, hoursAgo(24));
        return { ...presentMonitor(m), uptime24h: avail24.uptimePercent };
      });
    },

    get(id) {
      return buildDetail(id);
    },

    create(body, user, ip) {
      const { value, errors } = validateMonitor(body);
      if (errors.length) return { errors };
      const monitor = monitorsRepo.create(value, user.id);
      engine.reschedule(monitor.id);
      audit.write({ userId: user.id, username: user.username, action: 'monitor.created', entity: 'monitor',
        entityId: monitor.id, details: { name: monitor.name, type: monitor.type }, ip });
      return { monitor: presentMonitor(monitorsRepo.findById(monitor.id)) };
    },

    update(id, body, user, ip) {
      const existing = monitorsRepo.findById(id);
      if (!existing) return { notFound: true };
      const { value, errors } = validateMonitor({ ...body, type: body.type || existing.type });
      if (errors.length) return { errors };
      keepSavedSecrets(value.config, existing.config);
      const monitor = monitorsRepo.update(id, value);
      engine.reschedule(id);
      audit.write({ userId: user.id, username: user.username, action: 'monitor.updated', entity: 'monitor',
        entityId: id, details: { name: monitor.name }, ip });
      return { monitor: presentMonitor(monitor) };
    },

    duplicate(id, user, ip) {
      const source = monitorsRepo.findById(id);
      if (!source) return { notFound: true };
      const copy = monitorsRepo.create({
        name: `${source.name} (cópia)`.slice(0, 120), type: source.type, target: source.target,
        config: source.config, tags: source.tags, groupId: source.groupId,
        intervalSeconds: source.intervalSeconds, timeoutSeconds: source.timeoutSeconds,
        retries: source.retries, latencyThresholdMs: source.latencyThresholdMs, active: source.active,
      }, user.id);
      engine.reschedule(copy.id);
      audit.write({ userId: user.id, username: user.username, action: 'monitor.duplicated', entity: 'monitor',
        entityId: copy.id, details: { from: id }, ip });
      return { monitor: presentMonitor(monitorsRepo.findById(copy.id)) };
    },

    remove(id, user, ip) {
      const existing = monitorsRepo.findById(id);
      if (!existing) return false;
      engine.unschedule(id);
      monitorsRepo.remove(id);
      audit.write({ userId: user.id, username: user.username, action: 'monitor.deleted', severity: 'notice',
        entity: 'monitor', entityId: id, details: { name: existing.name }, ip });
      return true;
    },

    setActive(id, active, user, ip) {
      const monitor = engine.setActive(id, active);
      if (!monitor) return null;
      audit.write({ userId: user.id, username: user.username, action: active ? 'monitor.resumed' : 'monitor.paused',
        entity: 'monitor', entityId: id, ip });
      return presentMonitor(monitor);
    },

    runNow(id, user, ip) {
      const monitor = monitorsRepo.findById(id);
      if (!monitor) return null;
      engine.runNow(id);
      audit.write({ userId: user.id, username: user.username, action: 'monitor.check_requested', entity: 'monitor',
        entityId: id, ip });
      return true;
    },

    rotatePushToken(id, user, ip) {
      const monitor = monitorsRepo.findById(id);
      if (!monitor || monitor.type !== 'push') return null;
      const token = monitorsRepo.rotatePushToken(id);
      audit.write({ userId: user.id, username: user.username, action: 'monitor.push_token_rotated',
        entity: 'monitor', entityId: id, severity: 'notice', ip });
      return token;
    },
  };
}

function minLatency(monitorId) {
  const { getDatabase } = require('../db/connection');
  const row = getDatabase()
    .prepare('SELECT MIN(latency_ms) AS m FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ? AND ok = 1')
    .get(monitorId, daysAgo(7));
  return row.m ?? null;
}

/** Barras de disponibilidade diária (últimos N dias): 'up' | 'down' | 'partial' | 'nodata'. */
function heartbeatBars(monitorId, days) {
  const { getDatabase } = require('../db/connection');
  const rows = getDatabase().prepare(`
    SELECT substr(checked_at, 1, 10) AS day, COUNT(*) AS total, SUM(ok) AS up
    FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ? GROUP BY day`).all(monitorId, daysAgo(days));
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const bars = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    let state = 'nodata';
    let uptime = null;
    if (r && r.total) {
      uptime = Math.round((r.up / r.total) * 10000) / 100;
      state = r.up === r.total ? 'up' : (r.up === 0 ? 'down' : 'partial');
    }
    bars.push({ day, state, uptime });
  }
  return bars;
}

module.exports = { createMonitorService, buildDetail, heartbeatBars };
