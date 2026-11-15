'use strict';

const { getDatabase } = require('../connection');
const { generateToken, sha256 } = require('../../auth/security');

const SCOPES = ['read', 'write'];
const PREFIX = 'nxu_';

const apiKeysRepo = {
  SCOPES,
  list() {
    return getDatabase().prepare('SELECT id, name, key_prefix, scopes, last_used_at, revoked_at, created_at FROM api_keys ORDER BY id DESC')
      .all().map((k) => ({
        id: k.id, name: k.name, prefix: k.key_prefix, scopes: k.scopes.split(','),
        lastUsedAt: k.last_used_at, revokedAt: k.revoked_at, createdAt: k.created_at,
      }));
  },
  /** Cria uma chave. O valor completo é retornado apenas nesta chamada. */
  create({ name, scopes, userId }) {
    const { token } = generateToken(32);
    const raw = `${PREFIX}${token}`;
    const info = getDatabase()
      .prepare('INSERT INTO api_keys (name, key_prefix, key_hash, scopes, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(name, raw.slice(0, 12), sha256(raw), scopes.join(','), userId || null);
    return { id: Number(info.lastInsertRowid), key: raw };
  },
  /** Valida a chave e retorna os escopos, atualizando o último uso. */
  authenticate(raw) {
    if (typeof raw !== 'string' || !raw.startsWith(PREFIX)) return null;
    const row = getDatabase()
      .prepare('SELECT id, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL')
      .get(sha256(raw));
    if (!row) return null;
    getDatabase().prepare("UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
    return { id: row.id, scopes: row.scopes.split(',') };
  },
  revoke(id) {
    getDatabase().prepare("UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(id);
  },
};

module.exports = apiKeysRepo;
