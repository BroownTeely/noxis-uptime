'use strict';

const { getDatabase } = require('../connection');

const sessionsRepo = {
  create({ id, userId, csrfToken, ip, userAgent, expiresAt }) {
    getDatabase()
      .prepare(`INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, userId, csrfToken, ip || null, (userAgent || '').slice(0, 255), expiresAt);
  },
  /** Retorna sessão válida (não expirada) com dados do usuário ativo. */
  findValid(id) {
    return getDatabase()
      .prepare(`SELECT s.id, s.csrf_token, s.expires_at, u.id AS user_id, u.username,
                       u.display_name, u.role, u.active
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.id = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
      .get(id);
  },
  remove(id) {
    getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(id);
  },
  removeForUser(userId) {
    getDatabase().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  },
  purgeExpired() {
    return getDatabase()
      .prepare("DELETE FROM sessions WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')")
      .run().changes;
  },
};

module.exports = sessionsRepo;
