'use strict';

const { TYPES } = require('../monitors/checks');
const { isSafeHostToken, parseHostPort } = require('../utils/network');
const { RECORD_TYPES } = require('../monitors/checks/dns');

const TYPE_VALUES = TYPES.map((t) => t.value);
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const toInt = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function normalizeTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  return [...new Set(list.map((t) => String(t).trim().toLowerCase().slice(0, 32)).filter(Boolean))].slice(0, 10);
}

function parseHeaders(raw) {
  if (!raw) return {};
  const lines = Array.isArray(raw) ? raw : String(raw).split(/\r?\n/);
  const headers = {};
  for (const line of lines) {
    const idx = String(line).indexOf(':');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key)) continue;
    headers[key.toLowerCase()] = line.slice(idx + 1).trim().slice(0, 2000);
    if (Object.keys(headers).length >= 20) break;
  }
  return headers;
}

/**
 * Valida e normaliza a entrada de um monitor. Retorna { value, errors }.
 * `value` contém apenas campos reconhecidos, prontos para o repositório.
 */
function validateMonitor(body = {}) {
  const errors = [];
  const type = str(body.type, 20);
  if (!TYPE_VALUES.includes(type)) errors.push('Tipo de monitor inválido.');

  const name = str(body.name, 120);
  if (name.length < 2) errors.push('Informe um nome com pelo menos 2 caracteres.');

  const intervalSeconds = toInt(body.intervalSeconds) ?? 60;
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 86400) {
    errors.push('O intervalo deve estar entre 10 e 86400 segundos.');
  }
  const timeoutSeconds = toInt(body.timeoutSeconds) ?? 10;
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) {
    errors.push('O timeout deve estar entre 1 e 60 segundos.');
  }
  if (timeoutSeconds >= intervalSeconds) errors.push('O timeout deve ser menor que o intervalo.');
  const retries = toInt(body.retries) ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) errors.push('Tentativas devem estar entre 0 e 10.');

  const latencyRaw = toInt(body.latencyThresholdMs);
  const latencyThresholdMs = latencyRaw === null ? null : latencyRaw;
  if (latencyThresholdMs !== null && (!Number.isInteger(latencyThresholdMs) || latencyThresholdMs < 1 || latencyThresholdMs > 60000)) {
    errors.push('O limite de latência deve estar entre 1 e 60000 ms.');
  }

  const groupId = toInt(body.groupId);
  const config = {};
  let target = str(body.target, 2048);

  if (type === 'api') {
    // Corpo, quando informado, precisa ser JSON válido.
    const raw = str(body.requestBody, 10000);
    if (raw) {
      try { JSON.parse(raw); } catch (_) { errors.push('O corpo da requisição precisa ser JSON válido.'); }
    }
  }
  if (type === 'http' || type === 'keyword' || type === 'json' || type === 'api') {
    try {
      const u = new URL(target);
      if (!['http:', 'https:'].includes(u.protocol)) errors.push('A URL deve usar http ou https.');
    } catch (_) {
      errors.push('Informe uma URL válida (ex.: https://servico.local:8080/health).');
    }
    const method = str(body.method, 6).toUpperCase() || 'GET';
    if (!METHODS.includes(method)) errors.push('Método HTTP não suportado.');
    config.method = method;
    config.headers = parseHeaders(body.headers);
    config.body = str(body.requestBody, 10000);
    config.expectedStatus = str(body.expectedStatus, 40) || '200-299';
    config.followRedirects = body.followRedirects !== 'false' && body.followRedirects !== false;
    const authType = str(body.authType, 10);
    if (authType === 'basic') {
      config.auth = { type: 'basic', username: str(body.authUsername, 120), password: String(body.authPassword || '').slice(0, 300) };
    } else if (authType === 'bearer') {
      config.auth = { type: 'bearer', token: String(body.authToken || '').slice(0, 2000) };
    } else if (authType === 'apikey') {
      config.auth = {
        type: 'apikey',
        name: str(body.authApiKeyName, 80) || 'X-Api-Key',
        value: String(body.authApiKeyValue || '').slice(0, 2000),
      };
      if (!/^[A-Za-z0-9-]{1,80}$/.test(config.auth.name)) errors.push('Nome do cabeçalho da API key inválido.');
    }
    if (type === 'api') config.requiredKeys = str(body.requiredKeys, 300);
    if (type === 'keyword' || (type === 'http' && body.keyword)) {
      config.keyword = {
        value: str(body.keyword, 300),
        caseSensitive: !!body.keywordCaseSensitive,
        mustExist: body.keywordMustExist !== 'false' && body.keywordMustExist !== false,
      };
      if (!config.keyword.value) errors.push('Informe a palavra-chave.');
    }
    if (type === 'json') {
      config.jsonPath = str(body.jsonPath, 200);
      config.jsonOperator = ['equals', 'notEquals', 'exists'].includes(body.jsonOperator) ? body.jsonOperator : 'equals';
      config.jsonExpected = str(body.jsonExpected, 500);
      if (!config.jsonPath) errors.push('Informe o caminho JSON (ex.: data.status).');
    }
  }

  if (type === 'tcp') {
    try {
      const { host, port } = parseHostPort(target, Number(body.port));
      if (!isSafeHostToken(host)) errors.push('Host inválido.');
      if (!port || port < 1 || port > 65535) errors.push('Porta inválida.');
      target = port ? `${host}:${port}` : host;
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (type === 'ping' && !isSafeHostToken(target)) errors.push('Informe um IP ou hostname válido.');
  if (type === 'dns') {
    if (!isSafeHostToken(target)) errors.push('Informe um domínio válido.');
    const recordType = str(body.recordType, 8).toUpperCase() || 'A';
    if (!RECORD_TYPES.includes(recordType)) errors.push('Tipo de registro DNS inválido.');
    config.recordType = recordType;
    config.server = str(body.dnsServer, 255);
    if (config.server && !isSafeHostToken(config.server)) errors.push('Servidor DNS inválido.');
    config.expected = str(body.expected, 300);
  }
  if (type === 'ssl') {
    try {
      const { host, port } = parseHostPort(target, 443);
      if (!isSafeHostToken(host)) errors.push('Host inválido.');
      target = `${host}:${port}`;
    } catch (err) {
      errors.push(err.message);
    }
  }
  if (type === 'docker') {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(target)) errors.push('Nome ou ID de container inválido.');
  }
  if (type === 'push') {
    target = str(body.target, 200) || 'heartbeat';
  }

  return {
    errors,
    value: {
      name, type, target, config,
      tags: normalizeTags(body.tags),
      groupId: Number.isInteger(groupId) && groupId > 0 ? groupId : null,
      intervalSeconds, timeoutSeconds, retries, latencyThresholdMs,
      active: body.active !== false && body.active !== 'false',
    },
  };
}

/** Remove segredos de uma configuração antes de enviar ao cliente. */
function maskConfig(config = {}) {
  const copy = JSON.parse(JSON.stringify(config));
  if (copy.auth?.password) copy.auth.password = '••••••••';
  if (copy.auth?.token) copy.auth.token = '••••••••';
  if (copy.auth?.value) copy.auth.value = '••••••••';
  if (copy.headers) {
    for (const key of Object.keys(copy.headers)) {
      if (/authorization|token|secret|api-key|cookie/i.test(key)) copy.headers[key] = '••••••••';
    }
  }
  return copy;
}

module.exports = { validateMonitor, maskConfig, normalizeTags, TYPE_VALUES };
