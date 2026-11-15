'use strict';

const { getDatabase } = require('../db/connection');
const bus = require('../events/bus');

function parseArray(text) {
  try { const v = JSON.parse(text); return Array.isArray(v) ? v.map(Number) : []; } catch (_) { return []; }
}

function map(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    monitorIds: parseArray(row.monitor_ids),
    groupIds: parseArray(row.group_ids),
    createdAt: row.created_at,
    status: statusOf(row),
  };
}

function statusOf(row) {
  const now = Date.now();
  if (now < Date.parse(row.starts_at)) return 'scheduled';
  if (now <= Date.parse(row.ends_at)) return 'active';
  return 'finished';
}

const maintenanceService = {
  list() {
    return getDatabase().prepare('SELECT * FROM maintenance_windows ORDER BY starts_at DESC').all().map(map);
  },
  findById(id) {
    const row = getDatabase().prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(id);
    return row ? map(row) : null;
  },
  create({ title, description, startsAt, endsAt, monitorIds = [], groupIds = [], userId }) {
    const info = getDatabase()
      .prepare(`INSERT INTO maintenance_windows (title, description, starts_at, ends_at, monitor_ids, group_ids, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(title, description || null, startsAt, endsAt, JSON.stringify(monitorIds),
        JSON.stringify(groupIds), userId || null);
    return maintenanceService.findById(Number(info.lastInsertRowid));
  },
  remove(id) {
    getDatabase().prepare('DELETE FROM maintenance_windows WHERE id = ?').run(id);
  },
  /** true se a manutenção ativa cobre o monitor (diretamente ou pelo grupo). */
  isMonitorInMaintenance(monitor) {
    const now = new Date().toISOString();
    const rows = getDatabase()
      .prepare('SELECT * FROM maintenance_windows WHERE starts_at <= ? AND ends_at >= ?')
      .all(now, now);
    return rows.some((row) => {
      const mIds = parseArray(row.monitor_ids);
      const gIds = parseArray(row.group_ids);
      return mIds.includes(monitor.id) || (monitor.groupId && gIds.includes(monitor.groupId));
    });
  },
  /** Emite início/fim de manutenções. Executado periodicamente pelo app. */
  tick(state = { announced: new Set(), closed: new Set() }) {
    const now = Date.now();
    for (const row of getDatabase().prepare('SELECT * FROM maintenance_windows').all()) {
      const starts = Date.parse(row.starts_at);
      const ends = Date.parse(row.ends_at);
      if (now >= starts && now <= ends && !state.announced.has(row.id)) {
        state.announced.add(row.id);
        bus.emit('maintenance:started', { maintenance: map(row) });
      }
      if (now > ends && state.announced.has(row.id) && !state.closed.has(row.id)) {
        state.closed.add(row.id);
        bus.emit('maintenance:ended', { maintenance: map(row) });
      }
    }
    return state;
  },
};

module.exports = maintenanceService;
