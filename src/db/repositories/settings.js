'use strict';

const { getDatabase } = require('../connection');
const config = require('../../config');

/**
 * Configurações persistidas na tabela settings. Valores são serializados em JSON
 * e mesclados com os padrões definidos em config.defaults.
 */
const settingsRepo = {
  get(key, fallback) {
    const row = getDatabase().prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) {
      return fallback !== undefined ? fallback : config.defaults[key];
    }
    try {
      return JSON.parse(row.value);
    } catch (_) {
      return row.value;
    }
  },
  set(key, value) {
    getDatabase()
      .prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(key, JSON.stringify(value));
  },
  all() {
    const result = { ...config.defaults };
    for (const row of getDatabase().prepare('SELECT key, value FROM settings').all()) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch (_) {
        result[row.key] = row.value;
      }
    }
    return result;
  },
};

module.exports = settingsRepo;
