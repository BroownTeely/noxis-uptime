'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let db = null;

/** Abre (ou cria) o banco SQLite com pragmas para uso concorrente leve (WAL). */
function openDatabase(file) {
  if (db) return db;
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

function getDatabase() {
  if (!db) throw new Error('Banco de dados não inicializado');
  return db;
}

function closeDatabase() {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (_) {
    /* checkpoint é best-effort no encerramento */
  }
  db.close();
  db = null;
}

/** Executa fn dentro de BEGIN IMMEDIATE / COMMIT com rollback automático. */
function transaction(fn) {
  const conn = getDatabase();
  conn.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn(conn);
    conn.exec('COMMIT;');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK;');
    throw err;
  }
}

module.exports = { openDatabase, getDatabase, closeDatabase, transaction };
