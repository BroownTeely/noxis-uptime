'use strict';

const { getDatabase } = require('../connection');

function parse(text, fallback) {
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function map(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: parse(row.config, {}),
    events: parse(row.events, []),
    monitorIds: parse(row.monitor_ids, []),
    groupIds: parse(row.group_ids, []),
    enabled: !!row.enabled,
    lastSentAt: row.last_sent_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

const channelsRepo = {
  list() {
    return getDatabase().prepare('SELECT * FROM notification_channels ORDER BY id').all().map(map);
  },
  listEnabled() {
    return getDatabase()
      .prepare('SELECT * FROM notification_channels WHERE enabled = 1 ORDER BY id')
      .all().map(map);
  },
  findById(id) {
    return map(getDatabase().prepare('SELECT * FROM notification_channels WHERE id = ?').get(id));
  },
  create(data) {
    const info = getDatabase()
      .prepare(`INSERT INTO notification_channels (name, type, config, events, monitor_ids, group_ids, enabled)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(data.name, data.type || 'discord', JSON.stringify(data.config || {}),
        JSON.stringify(data.events || []), JSON.stringify(data.monitorIds || []),
        JSON.stringify(data.groupIds || []), data.enabled === false ? 0 : 1);
    return channelsRepo.findById(Number(info.lastInsertRowid));
  },
  update(id, data) {
    getDatabase()
      .prepare(`UPDATE notification_channels SET name = ?, config = ?, events = ?, monitor_ids = ?,
                  group_ids = ?, enabled = ? WHERE id = ?`)
      .run(data.name, JSON.stringify(data.config || {}), JSON.stringify(data.events || []),
        JSON.stringify(data.monitorIds || []), JSON.stringify(data.groupIds || []),
        data.enabled ? 1 : 0, id);
    return channelsRepo.findById(id);
  },
  remove(id) {
    getDatabase().prepare('DELETE FROM notification_channels WHERE id = ?').run(id);
  },
  recordResult(id, { ok, error }) {
    getDatabase()
      .prepare(`UPDATE notification_channels SET last_sent_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_sent_at END,
                  last_error = ? WHERE id = ?`)
      .run(ok ? 1 : 0, ok ? null : String(error || '').slice(0, 500), id);
  },
  logDelivery({ channelId, event, title, status, httpStatus, attempts, error }) {
    getDatabase()
      .prepare(`INSERT INTO notification_log (channel_id, event, title, status, http_status, attempts, error)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(channelId, event, title || null, status, httpStatus ?? null, attempts || 0,
        error ? String(error).slice(0, 500) : null);
  },
  recentLog(channelId, limit = 20) {
    return getDatabase()
      .prepare('SELECT * FROM notification_log WHERE channel_id = ? ORDER BY id DESC LIMIT ?')
      .all(channelId, limit)
      .map((l) => ({
        id: l.id, event: l.event, title: l.title, status: l.status, httpStatus: l.http_status,
        attempts: l.attempts, error: l.error, createdAt: l.created_at,
      }));
  },
};

const groupsRepo = {
  list() {
    return getDatabase().prepare(`
      SELECT g.*, (SELECT COUNT(*) FROM monitors m WHERE m.group_id = g.id) AS monitor_count
      FROM monitor_groups g ORDER BY g.position, g.name COLLATE NOCASE`).all()
      .map((g) => ({
        id: g.id, name: g.name, description: g.description, position: g.position,
        monitorCount: g.monitor_count,
      }));
  },
  findById(id) {
    const g = getDatabase().prepare('SELECT * FROM monitor_groups WHERE id = ?').get(id);
    return g ? { id: g.id, name: g.name, description: g.description, position: g.position } : null;
  },
  create({ name, description }) {
    const info = getDatabase()
      .prepare('INSERT INTO monitor_groups (name, description) VALUES (?, ?)')
      .run(name, description || null);
    return groupsRepo.findById(Number(info.lastInsertRowid));
  },
  update(id, { name, description }) {
    getDatabase().prepare('UPDATE monitor_groups SET name = ?, description = ? WHERE id = ?')
      .run(name, description || null, id);
    return groupsRepo.findById(id);
  },
  remove(id) {
    getDatabase().prepare('DELETE FROM monitor_groups WHERE id = ?').run(id);
  },
};

module.exports = { channelsRepo, groupsRepo };
