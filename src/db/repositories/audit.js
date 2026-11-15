'use strict';

const { getDatabase } = require('../connection');

const auditRepo = {
  write({ userId = null, username = null, action, entity = null, entityId = null, severity = 'info', details = null, ip = null }) {
    // Nunca registrar segredos: os chamadores devem omitir senhas, tokens e webhooks.
    getDatabase()
      .prepare(`INSERT INTO audit_logs (user_id, username, action, entity, entity_id, severity, details, ip)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, username, action, entity, entityId === null ? null : String(entityId), severity,
        details === null ? null : JSON.stringify(details), ip);
  },
  search({ q = '', severity = '', entity = '', limit = 50, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (q) {
      where.push('(action LIKE ? OR username LIKE ? OR details LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (severity) {
      where.push('severity = ?');
      params.push(severity);
    }
    if (entity) {
      where.push('entity = ?');
      params.push(entity);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = getDatabase()
      .prepare(`SELECT * FROM audit_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM audit_logs ${clause}`)
      .get(...params).n;
    return { rows, total };
  },
  purgeOlderThan(days) {
    return getDatabase()
      .prepare("DELETE FROM audit_logs WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)")
      .run(`-${Number(days)} days`).changes;
  },
};

module.exports = auditRepo;
