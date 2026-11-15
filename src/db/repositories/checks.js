'use strict';

const { getDatabase } = require('../connection');

const checksRepo = {
  insert({ monitorId, checkedAt, ok, status, latencyMs, message, details }) {
    getDatabase()
      .prepare(`INSERT INTO monitor_checks (monitor_id, checked_at, ok, status, latency_ms, message, details)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(monitorId, checkedAt, ok ? 1 : 0, status, latencyMs ?? null,
        message ? String(message).slice(0, 1000) : null,
        details ? JSON.stringify(details) : null);
  },
  recent(monitorId, limit = 100) {
    return getDatabase()
      .prepare(`SELECT * FROM monitor_checks WHERE monitor_id = ?
                ORDER BY checked_at DESC, id DESC LIMIT ?`)
      .all(monitorId, limit)
      .map((r) => ({
        id: r.id, checkedAt: r.checked_at, ok: !!r.ok, status: r.status,
        latencyMs: r.latency_ms, message: r.message,
      }));
  },
  /**
   * Série temporal de latência e disponibilidade agregada por hora (ou por dia).
   * Períodos sem registros não são contados como disponíveis nem indisponíveis.
   */
  series(monitorId, sinceIso, bucket = 'hour') {
    const fmt = bucket === 'day' ? '%Y-%m-%d' : '%Y-%m-%dT%H:00';
    return getDatabase()
      .prepare(`SELECT strftime('${fmt}', checked_at) AS bucket,
                       COUNT(*) AS total,
                       SUM(ok) AS up,
                       AVG(latency_ms) AS avg_latency,
                       MIN(latency_ms) AS min_latency,
                       MAX(latency_ms) AS max_latency
                FROM monitor_checks
                WHERE monitor_id = ? AND checked_at >= ?
                GROUP BY bucket ORDER BY bucket ASC`)
      .all(monitorId, sinceIso);
  },
  /** Disponibilidade (%) entre dois instantes, considerando apenas verificações registradas. */
  availability(monitorId, sinceIso) {
    const row = getDatabase()
      .prepare(`SELECT COUNT(*) AS total, SUM(ok) AS up, AVG(latency_ms) AS avg_latency,
                       MAX(latency_ms) AS max_latency
                FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ?`)
      .get(monitorId, sinceIso);
    const total = row.total || 0;
    return {
      total,
      uptimePercent: total ? Math.round(((row.up || 0) / total) * 10000) / 100 : null,
      avgLatencyMs: row.avg_latency !== null ? Math.round(row.avg_latency) : null,
      maxLatencyMs: row.max_latency,
    };
  },
  /** Disponibilidade agregada de todos os monitores (últimas N horas). */
  globalAvailability(sinceIso) {
    const row = getDatabase()
      .prepare(`SELECT COUNT(*) AS total, SUM(ok) AS up, AVG(latency_ms) AS avg_latency
                FROM monitor_checks WHERE checked_at >= ?`)
      .get(sinceIso);
    return {
      total: row.total || 0,
      uptimePercent: row.total ? Math.round(((row.up || 0) / row.total) * 10000) / 100 : null,
      avgLatencyMs: row.avg_latency !== null ? Math.round(row.avg_latency) : null,
    };
  },
  purgeOlderThan(isoDate) {
    return getDatabase().prepare('DELETE FROM monitor_checks WHERE checked_at < ?').run(isoDate).changes;
  },
};

const eventsRepo = {
  insert({ monitorId, previousStatus, newStatus, message, durationSeconds, createdAt }) {
    getDatabase()
      .prepare(`INSERT INTO monitor_events (monitor_id, previous_status, new_status, message, duration_seconds, created_at)
                VALUES (?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
      .run(monitorId, previousStatus || null, newStatus, message || null,
        durationSeconds ?? null, createdAt || null);
  },
  recent({ monitorId = null, limit = 50, offset = 0, onlyChanges = true } = {}) {
    const where = [];
    const params = [];
    if (monitorId) { where.push('e.monitor_id = ?'); params.push(monitorId); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return getDatabase()
      .prepare(`SELECT e.*, m.name AS monitor_name FROM monitor_events e
                LEFT JOIN monitors m ON m.id = e.monitor_id
                ${clause} ORDER BY e.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
      .map((e) => ({
        id: e.id, monitorId: e.monitor_id, monitorName: e.monitor_name,
        previousStatus: e.previous_status, newStatus: e.new_status,
        message: e.message, durationSeconds: e.duration_seconds, createdAt: e.created_at,
      }));
  },
  purgeOlderThan(isoDate) {
    return getDatabase().prepare('DELETE FROM monitor_events WHERE created_at < ?').run(isoDate).changes;
  },
};

module.exports = { checksRepo, eventsRepo };
