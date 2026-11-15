'use strict';

const config = require('../config');
const { getDatabase } = require('../db/connection');

/** Verifica o estado da aplicação e do banco. Usado por /health e pelo Docker healthcheck. */
function checkHealth(engine) {
  let dbOk = true;
  try {
    getDatabase().prepare('SELECT 1 AS ok').get();
  } catch (_) {
    dbOk = false;
  }
  return {
    ok: dbOk,
    service: 'noxis-uptime',
    version: config.version,
    database: dbOk ? 'ok' : 'error',
    engine: engine.snapshot(),
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  };
}

module.exports = { checkHealth };
