'use strict';

const path = require('path');
const crypto = require('crypto');

// Raiz do projeto (onde ficam package.json, app.js e storage/) e pasta de código-fonte.
const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

function toBool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const config = {
  root: ROOT,
  srcDir: SRC,
  appName: 'Noxis Uptime',
  version: require(path.join(ROOT, 'package.json')).version,
  env: process.env.NODE_ENV || 'production',
  host: process.env.HOST || '0.0.0.0',
  // Porta padrão não óbvia (8417) para reduzir varreduras e colisões. O instalador escolhe uma aleatória.
  port: toInt(process.env.PORT, 8417),
  // Em produção, APP_SECRET deve ser definido no .env. Se ausente, gera um valor
  // efêmero (as sessões são invalidadas ao reiniciar apenas se o segredo for usado para algo persistente).
  appSecret: process.env.APP_SECRET || crypto.randomBytes(32).toString('hex'),
  appSecretGenerated: !process.env.APP_SECRET,
  databasePath: process.env.DATABASE_PATH || path.join(ROOT, 'storage', 'database', 'noxis.db'),
  cookieSecure: toBool(process.env.COOKIE_SECURE, false),
  maxConcurrentChecks: Math.max(1, toInt(process.env.MAX_CONCURRENT_CHECKS, 20)),
  dockerSocket: process.env.DOCKER_SOCKET || '',
  sessionTtlHours: 24 * 7,
  defaults: {
    timezone: 'America/Bahia',
    locale: 'pt-BR',
    siteName: 'Noxis Uptime',
    checkInterval: 60,
    checkTimeout: 10,
    retries: 2,
    retentionDays: 90,
    allowPrivateNetworks: true,
    latencyThresholdMs: 1000,
    sslWarnDays: 14,
    // Degraus de alerta de expiração (dias). Cada degrau mais urgente dispara um novo alerta.
    sslAlertDays: [30, 14, 7, 3, 1],
    // Baixa e verifica novas releases automaticamente; a aplicação é sempre manual.
    autoDownloadUpdates: true,
  },
};

module.exports = config;
