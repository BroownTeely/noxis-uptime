'use strict';

const { getDatabase } = require('../connection');
const { generateToken } = require('../../auth/security');

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function mapMonitor(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    target: row.target,
    config: parseJson(row.config, {}),
    tags: parseJson(row.tags, []),
    groupId: row.group_id,
    groupName: row.group_name || null,
    intervalSeconds: row.interval_seconds,
    timeoutSeconds: row.timeout_seconds,
    retries: row.retries,
    latencyThresholdMs: row.latency_threshold_ms,
    active: !!row.active,
    status: row.status,
    consecutiveFailures: row.consecutive_failures,
    lastLatencyMs: row.last_latency_ms,
    lastMessage: row.last_message,
    lastCheckAt: row.last_check_at,
    nextCheckAt: row.next_check_at,
    lastStatusChangeAt: row.last_status_change_at,
    pushToken: row.push_token,
    lastPushAt: row.last_push_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BASE_SELECT = `
  SELECT m.*, g.name AS group_name
  FROM monitors m LEFT JOIN monitor_groups g ON g.id = m.group_id`;

const monitorsRepo = {
  list({ groupId = null, status = null, tag = null } = {}) {
    const where = [];
    const params = [];
    if (groupId) { where.push('m.group_id = ?'); params.push(groupId); }
    if (status) { where.push('m.status = ?'); params.push(status); }
    if (tag) { where.push("m.tags LIKE ?"); params.push(`%"${tag}"%`); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return getDatabase()
      .prepare(`${BASE_SELECT} ${clause} ORDER BY m.name COLLATE NOCASE ASC`)
      .all(...params)
      .map(mapMonitor);
  },
  activeMonitors() {
    return getDatabase()
      .prepare(`${BASE_SELECT} WHERE m.active = 1 ORDER BY m.id`)
      .all()
      .map(mapMonitor);
  },
  findById(id) {
    return mapMonitor(getDatabase().prepare(`${BASE_SELECT} WHERE m.id = ?`).get(id));
  },
  findByPushToken(token) {
    return mapMonitor(getDatabase().prepare(`${BASE_SELECT} WHERE m.push_token = ?`).get(token));
  },
  create(data, userId) {
    const pushToken = data.type === 'push' ? generateToken(24).token : null;
    const info = getDatabase()
      .prepare(`INSERT INTO monitors (name, type, target, config, tags, group_id, interval_seconds,
                  timeout_seconds, retries, latency_threshold_ms, active, status, push_token, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`)
      .run(data.name, data.type, data.target, JSON.stringify(data.config || {}),
        JSON.stringify(data.tags || []), data.groupId || null, data.intervalSeconds,
        data.timeoutSeconds, data.retries, data.latencyThresholdMs ?? null,
        data.active === false ? 0 : 1, pushToken, userId || null);
    return monitorsRepo.findById(Number(info.lastInsertRowid));
  },
  update(id, data) {
    getDatabase()
      .prepare(`UPDATE monitors SET name = ?, type = ?, target = ?, config = ?, tags = ?, group_id = ?,
                  interval_seconds = ?, timeout_seconds = ?, retries = ?, latency_threshold_ms = ?,
                  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(data.name, data.type, data.target, JSON.stringify(data.config || {}),
        JSON.stringify(data.tags || []), data.groupId || null, data.intervalSeconds,
        data.timeoutSeconds, data.retries, data.latencyThresholdMs ?? null, id);
    return monitorsRepo.findById(id);
  },
  setActive(id, active) {
    getDatabase()
      .prepare(`UPDATE monitors SET active = ?, status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .run(active ? 1 : 0, active ? 'PENDING' : 'PAUSED', id);
    return monitorsRepo.findById(id);
  },
  /** Atualiza o estado operacional após uma verificação. */
  saveCheckState(id, patch) {
    const fields = [];
    const params = [];
    const map = {
      status: 'status', consecutiveFailures: 'consecutive_failures', lastLatencyMs: 'last_latency_ms',
      lastMessage: 'last_message', lastCheckAt: 'last_check_at', nextCheckAt: 'next_check_at',
      lastStatusChangeAt: 'last_status_change_at', lastPushAt: 'last_push_at', lastSslAlertAt: 'last_ssl_alert_at',
    };
    for (const [key, column] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        fields.push(`${column} = ?`);
        params.push(patch[key]);
      }
    }
    if (!fields.length) return;
    getDatabase().prepare(`UPDATE monitors SET ${fields.join(', ')} WHERE id = ?`).run(...params, id);
  },
  rotatePushToken(id) {
    const { token } = generateToken(24);
    getDatabase().prepare('UPDATE monitors SET push_token = ? WHERE id = ?').run(token, id);
    return token;
  },
  remove(id) {
    getDatabase().prepare('DELETE FROM monitors WHERE id = ?').run(id);
  },
  countByStatus() {
    const rows = getDatabase()
      .prepare('SELECT status, COUNT(*) AS n FROM monitors GROUP BY status')
      .all();
    const result = {};
    for (const row of rows) result[row.status] = row.n;
    return result;
  },
  mapMonitor,
};

module.exports = monitorsRepo;
