'use strict';

const net = require('net');
const dns = require('dns').promises;

/** Erro lançado quando um destino é bloqueado pela política de segurança. */
class BlockedTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BlockedTargetError';
  }
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);
}

function inCidr(ip, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((ipv4ToInt(ip) & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

const PRIVATE_V4 = [
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8],
  ['100.64.0.0', 10], ['0.0.0.0', 8],
];
// Sempre bloqueados, independentemente da política de redes privadas
// (link-local inclui o endpoint de metadados de nuvem 169.254.169.254).
const ALWAYS_BLOCKED_V4 = [['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]];

function mappedV4(ip) {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m ? m[1] : null;
}

/** Classifica um IP: 'always' (bloqueio fixo), 'private' (rede interna) ou 'public'. */
function classifyIp(ip) {
  const mapped = mappedV4(ip);
  if (mapped) return classifyIp(mapped);
  if (net.isIPv4(ip)) {
    if (ALWAYS_BLOCKED_V4.some(([b, bits]) => inCidr(ip, b, bits))) return 'always';
    if (PRIVATE_V4.some(([b, bits]) => inCidr(ip, b, bits))) return 'private';
    return 'public';
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return 'private';
    if (/^fe[89ab]/.test(lower)) return 'private'; // link-local fe80::/10
    if (/^f[cd]/.test(lower)) return 'private';    // unique local fc00::/7
    if (/^ff/.test(lower)) return 'always';        // multicast
    if (/^fe80/.test(lower)) return 'always';
    return 'public';
  }
  return 'always';
}

/**
 * Valida um host antes de conectar. Resolve todos os endereços e bloqueia
 * destinos perigosos. Retorna a lista de endereços validados.
 */
async function assertSafeHost(hostname, { allowPrivate = true } = {}) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (!host) throw new BlockedTargetError('Host vazio');

  let addresses;
  if (net.isIP(host)) {
    addresses = [{ address: host }];
  } else {
    if (/[\s/\\@]/.test(host)) throw new BlockedTargetError('Host inválido');
    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch (err) {
      throw new Error(`Falha de resolução DNS para ${host}: ${err.code || err.message}`);
    }
  }

  for (const { address } of addresses) {
    const kind = classifyIp(address);
    if (kind === 'always') {
      throw new BlockedTargetError(`Destino bloqueado por política (${address})`);
    }
    if (kind === 'private' && !allowPrivate) {
      throw new BlockedTargetError(`Redes privadas desativadas nas configurações (${address})`);
    }
  }
  return addresses.map((a) => a.address);
}

/** Valida formato de hostname/IP usado em comandos externos (ex.: ping). */
function isSafeHostToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,253}$/.test(value);
}

/** Valida host:porta e retorna { host, port }. */
function parseHostPort(target, defaultPort) {
  const raw = String(target || '').trim();
  if (!raw) throw new Error('Endereço vazio');
  if (raw.startsWith('[')) {
    const m = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(raw);
    if (!m) throw new Error('Endereço IPv6 inválido');
    return { host: m[1], port: m[2] ? Number(m[2]) : defaultPort };
  }
  const colon = raw.lastIndexOf(':');
  if (colon > 0 && raw.indexOf(':') === colon) {
    const port = Number(raw.slice(colon + 1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida');
    return { host: raw.slice(0, colon), port };
  }
  return { host: raw, port: defaultPort };
}

module.exports = {
  BlockedTargetError,
  classifyIp,
  assertSafeHost,
  isSafeHostToken,
  parseHostPort,
};
