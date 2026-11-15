'use strict';

const dns = require('dns').promises;
const { isSafeHostToken } = require('../../utils/network');

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];

function flattenRecords(type, answer) {
  if (type === 'MX') return answer.map((r) => `${r.priority} ${r.exchange}`);
  if (type === 'TXT') return answer.map((r) => r.join(''));
  if (type === 'SRV') return answer.map((r) => `${r.priority} ${r.weight} ${r.port} ${r.name}`);
  if (type === 'CAA') return answer.map((r) => `${r.issue || r.issuewild || ''}`);
  return answer.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
}

async function runDns(monitor) {
  const cfg = monitor.config || {};
  const domain = String(monitor.target || '').trim().toLowerCase();
  if (!isSafeHostToken(domain)) throw new Error('Domínio inválido');
  const type = String(cfg.recordType || 'A').toUpperCase();
  if (!RECORD_TYPES.includes(type)) throw new Error(`Tipo de registro não suportado: ${type}`);

  const resolver = new dns.Resolver();
  if (cfg.server) {
    if (!isSafeHostToken(cfg.server)) throw new Error('Servidor DNS inválido');
    resolver.setServers([cfg.server]);
  }
  const timeoutMs = Math.max(1, monitor.timeoutSeconds) * 1000;
  const started = Date.now();
  let records;
  try {
    records = await Promise.race([
      resolver.resolve(domain, type),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs)),
    ]);
  } catch (err) {
    const latencyMs = Date.now() - started;
    return {
      ok: false, latencyMs: null,
      message: `Falha na resolução (${type}): ${err.code || err.message}`,
      details: { server: cfg.server || 'padrão do sistema', recordType: type, durationMs: latencyMs },
    };
  }
  const latencyMs = Date.now() - started;
  const values = flattenRecords(type, records);

  let ok = values.length > 0;
  let note = `${values.length} registro(s) ${type} em ${latencyMs} ms`;
  if (ok && cfg.expected) {
    const expected = String(cfg.expected).toLowerCase();
    ok = values.some((v) => v.toLowerCase().includes(expected));
    if (!ok) note = `Resultado não contém o valor esperado "${cfg.expected}"`;
  }
  return {
    ok, latencyMs, message: note,
    details: { server: cfg.server || 'padrão do sistema', recordType: type, records: values.slice(0, 20) },
  };
}

module.exports = { runDns, RECORD_TYPES };
