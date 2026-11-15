'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getDatabase } = require('../db/connection');

/**
 * Backups consistentes do SQLite via VACUUM INTO (seguro com o sistema em uso).
 * Restauração não é feita pela interface: ver docs/CONFIGURATION.md (parar o serviço,
 * substituir o arquivo do banco e iniciar novamente).
 */
const DIR = path.join(config.root, 'storage', 'backups');
const NAME_RE = /^noxis-\d{8}-\d{6}(-[a-z0-9]{4})?\.db$/;
const RETAIN = 10;

const pad = (n) => String(n).padStart(2, '0');
function stamp() {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true });
}

function list() {
  ensureDir();
  return fs.readdirSync(DIR)
    .filter((f) => NAME_RE.test(f))
    .map((name) => {
      const st = fs.statSync(path.join(DIR, name));
      return { name, sizeKb: Math.round(st.size / 1024), createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

function prune() {
  for (const f of list().slice(RETAIN)) fs.unlinkSync(path.join(DIR, f.name));
}

const backupService = {
  list,
  DIR,

  create() {
    ensureDir();
    let name = `noxis-${stamp()}.db`;
    if (fs.existsSync(path.join(DIR, name))) {
      name = `noxis-${stamp()}-${Math.random().toString(36).slice(2, 6)}.db`;
    }
    const file = path.join(DIR, name);
    // O caminho é gerado pelo servidor (apenas caracteres seguros); aspas são escapadas por garantia.
    getDatabase().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    prune();
    return list().find((b) => b.name === name);
  },

  /** Caminho absoluto de um backup existente, ou null. Protege contra path traversal. */
  resolve(name) {
    if (!NAME_RE.test(String(name || ''))) return null;
    const file = path.join(DIR, name);
    return fs.existsSync(file) ? file : null;
  },
};

module.exports = backupService;
