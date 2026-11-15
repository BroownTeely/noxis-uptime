'use strict';

const { getDatabase } = require('../connection');

const STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'];
const SEVERITIES = ['minor', 'major', 'critical'];

function map(row) {
  if (!row) return null;
  return {
    id: row.id,
    monitorId: row.monitor_id,
    monitorName: row.monitor_name || null,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    autoCreated: !!row.auto_created,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedBy: row.acknowledged_by,
  };
}

const SELECT = `SELECT i.*, m.name AS monitor_name FROM incidents i
                LEFT JOIN monitors m ON m.id = i.monitor_id`;

const incidentsRepo = {
  STATUSES,
  SEVERITIES,
  list({ open = null, limit = 50, offset = 0 } = {}) {
    let clause = '';
    if (open === true) clause = "WHERE i.status != 'resolved'";
    if (open === false) clause = "WHERE i.status = 'resolved'";
    const rows = getDatabase()
      .prepare(`${SELECT} ${clause} ORDER BY i.started_at DESC, i.id DESC LIMIT ? OFFSET ?`)
      .all(limit, offset);
    const total = getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM incidents i ${clause}`).get().n;
    return { rows: rows.map(map), total };
  },
  findById(id) {
    return map(getDatabase().prepare(`${SELECT} WHERE i.id = ?`).get(id));
  },
  openForMonitor(monitorId) {
    return map(getDatabase()
      .prepare(`${SELECT} WHERE i.monitor_id = ? AND i.status != 'resolved'
                ORDER BY i.id DESC LIMIT 1`)
      .get(monitorId));
  },
  create({ monitorId, title, description, severity, startedAt }) {
    const info = getDatabase()
      .prepare(`INSERT INTO incidents (monitor_id, title, description, severity, status, started_at)
                VALUES (?, ?, ?, ?, 'investigating', ?)`)
      .run(monitorId, title, description || null, severity, startedAt);
    return incidentsRepo.findById(Number(info.lastInsertRowid));
  },
  update(id, { status, severity, description }) {
    const current = incidentsRepo.findById(id);
    if (!current) return null;
    getDatabase()
      .prepare('UPDATE incidents SET status = ?, severity = ?, description = ? WHERE id = ?')
      .run(status || current.status, severity || current.severity,
        description !== undefined ? description : current.description, id);
    return incidentsRepo.findById(id);
  },
  resolve(id, { userId = null, resolvedAt }) {
    getDatabase()
      .prepare(`UPDATE incidents SET status = 'resolved', resolved_at = ?, resolved_by = ? WHERE id = ?`)
      .run(resolvedAt, userId, id);
    return incidentsRepo.findById(id);
  },
  acknowledge(id, userId) {
    getDatabase()
      .prepare(`UPDATE incidents SET acknowledged_by = ?, acknowledged_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(userId, id);
    return incidentsRepo.findById(id);
  },
  addUpdate({ incidentId, status, message, userId = null }) {
    getDatabase()
      .prepare('INSERT INTO incident_updates (incident_id, status, message, user_id) VALUES (?, ?, ?, ?)')
      .run(incidentId, status || null, message, userId);
  },
  updates(incidentId) {
    return getDatabase()
      .prepare(`SELECT u.*, usr.display_name AS author FROM incident_updates u
                LEFT JOIN users usr ON usr.id = u.user_id
                WHERE u.incident_id = ? ORDER BY u.id ASC`)
      .all(incidentId)
      .map((u) => ({
        id: u.id, status: u.status, message: u.message, author: u.author, createdAt: u.created_at,
      }));
  },
  listForMonitor(monitorId, limit = 20) {
    return getDatabase()
      .prepare(`${SELECT} WHERE i.monitor_id = ? ORDER BY i.started_at DESC, i.id DESC LIMIT ?`)
      .all(monitorId, limit)
      .map(map);
  },
  countSince(sinceIso) {
    return getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM incidents WHERE started_at >= ?').get(sinceIso).n;
  },
  countOpen() {
    return getDatabase().prepare("SELECT COUNT(*) AS n FROM incidents WHERE status != 'resolved'").get().n;
  },
};

module.exports = incidentsRepo;
