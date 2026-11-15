'use strict';

const { getDatabase } = require('../connection');

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const ROLES = Object.keys(ROLE_RANK);

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: !!row.active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
  };
}

const usersRepo = {
  ROLES,
  ROLE_RANK,
  count() {
    return getDatabase().prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },
  findById(id) {
    return getDatabase().prepare('SELECT * FROM users WHERE id = ?').get(id);
  },
  findByUsername(username) {
    return getDatabase().prepare('SELECT * FROM users WHERE username = ?').get(username);
  },
  list() {
    return getDatabase()
      .prepare('SELECT * FROM users ORDER BY id ASC')
      .all()
      .map(publicUser);
  },
  create({ username, displayName, passwordHash, role }) {
    const info = getDatabase()
      .prepare(`INSERT INTO users (username, display_name, password_hash, role)
                VALUES (?, ?, ?, ?)`)
      .run(username, displayName, passwordHash, role);
    return publicUser(usersRepo.findById(Number(info.lastInsertRowid)));
  },
  updateRole(id, role) {
    getDatabase().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  },
  setActive(id, active) {
    getDatabase().prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  },
  setPasswordHash(id, passwordHash) {
    getDatabase().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  },
  touchLogin(id) {
    getDatabase()
      .prepare("UPDATE users SET last_login_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
      .run(id);
  },
  publicUser,
};

module.exports = usersRepo;
