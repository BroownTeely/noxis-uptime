'use strict';

const net = require('net');
const { assertSafeHost, classifyIp, isSafeHostToken } = require('../utils/network');
const settingsRepo = require('../db/repositories/settings');
const audit = require('../db/repositories/audit');

/**
 * Discovery de portas TCP para hosts da rede local.
 *
 * Princípios:
 *  - Só redes privadas (LAN e loopback). Hosts públicos são recusados: o recurso não
 *    serve para varrer a internet.
 *  - Conexão TCP simples; nenhum banner, payload ou tentativa de autenticação é enviado.
 *  - Lista de portas limitada, concorrência baixa, timeout curto.
 *  - Uma varredura por vez no servidor e limite por usuário.
 *  - Confirmação explícita do administrador, registrada na auditoria.
 *  - O resultado é apenas uma sugestão: nenhum monitor é criado automaticamente.
 */

// Portas conhecidas e nomes de serviço para identificação básica por número de porta.
const WELL_KNOWN = {
  22: 'SSH', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 389: 'LDAP',
  443: 'HTTPS', 445: 'SMB', 548: 'AFP', 554: 'RTSP', 631: 'IPP (impressora)',
  1883: 'MQTT', 2375: 'Docker API (sem TLS)', 2376: 'Docker API (TLS)',
  3000: 'Aplicação web', 3306: 'MySQL / MariaDB', 3389: 'RDP', 5000: 'Aplicação web',
  5432: 'PostgreSQL', 5900: 'VNC', 6379: 'Redis', 8000: 'Aplicação web',
  8006: 'Proxmox', 8080: 'HTTP alternativo', 8096: 'Jellyfin', 8123: 'Home Assistant',
  8443: 'HTTPS alternativo', 8888: 'Jupyter / web', 9000: 'Portainer / web', 9090: 'Prometheus',
  9100: 'Node Exporter / impressão', 9443: 'Portainer (TLS)', 25565: 'Minecraft',
  32400: 'Plex', 51413: 'Transmission',
};

const MAX_PORTS = 200;
const MAX_RANGE = 1000;
const TIMEOUT_MS = 1500;
const CONCURRENCY = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 10;

const COMMON_PORTS = Object.keys(WELL_KNOWN).map(Number).sort((a, b) => a - b);

let scanning = false;
const scansByUser = new Map();

/** Interpreta "common", "22,80,443" ou faixas "8000-8010". Lança erro se inválido. */
function parsePorts(spec) {
  const text = String(spec ?? '').trim();
  if (!text || text === 'common') return [...COMMON_PORTS];
  const out = new Set();
  for (const raw of text.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(raw);
    if (!m) throw new Error(`Porta inválida: ${raw}`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b > 65535 || a > b) throw new Error(`Faixa de portas inválida: ${raw}`);
    if (b - a + 1 > MAX_RANGE) throw new Error(`Faixa grande demais (máximo ${MAX_RANGE} portas): ${raw}`);
    for (let p = a; p <= b; p += 1) out.add(p);
    if (out.size > MAX_PORTS) throw new Error(`Máximo de ${MAX_PORTS} portas por varredura`);
  }
  return [...out].sort((x, y) => x - y);
}

const serviceName = (port) => WELL_KNOWN[port] || 'Desconhecido';

/** Uma tentativa de conexão TCP, com timeout. Não envia dados. */
function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (open) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve({ port, open, latencyMs: open ? Date.now() - started : null, service: open ? serviceName(port) : null });
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

async function scan(host, ports, { allowPrivate = true } = {}) {
  const addresses = await assertSafeHost(host, { allowPrivate: true });
  if (!addresses.every((ip) => classifyIp(ip) === 'private')) {
    throw Object.assign(new Error('A descoberta funciona apenas em redes privadas (LAN ou loopback).'), { status: 422 });
  }
  const results = [];
  const queue = [...ports];
  const worker = async () => {
    while (queue.length) results.push(await probe(host, queue.shift(), TIMEOUT_MS));
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ports.length) }, worker));
  return results.sort((a, b) => a.port - b.port);
}

const discoveryService = {
  WELL_KNOWN, COMMON_PORTS, MAX_PORTS, parsePorts, serviceName,

  /**
   * Executa a varredura com todas as validações. Lança erro com `status` quando recusada.
   */
  async run({ host, ports, authorized }, user, ip) {
    if (authorized !== true) throw Object.assign(new Error('Confirme que você está autorizado a verificar este host.'), { status: 422 });
    const target = String(host || '').trim().toLowerCase();
    if (!isSafeHostToken(target)) throw Object.assign(new Error('Host inválido.'), { status: 422 });
    let portList;
    try {
      portList = parsePorts(ports);
    } catch (err) {
      throw Object.assign(err, { status: 422 });
    }

    const now = Date.now();
    const recent = (scansByUser.get(user.id) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      throw Object.assign(new Error('Limite de varreduras atingido. Aguarde alguns minutos.'), { status: 429 });
    }
    if (scanning) throw Object.assign(new Error('Já existe uma varredura em andamento.'), { status: 429 });

    scanning = true;
    const started = Date.now();
    try {
      const allowPrivate = !!settingsRepo.get('allowPrivateNetworks', true);
      let results;
      try {
        results = await scan(target, portList, { allowPrivate });
      } catch (err) {
        // Erros de destino (bloqueado, não resolvido, público) são de entrada do usuário.
        if (!err.status) err.status = 422;
        throw err;
      }
      recent.push(now);
      scansByUser.set(user.id, recent);
      const openCount = results.filter((r) => r.open).length;
      audit.write({
        userId: user.id, username: user.username, action: 'discovery.ports', entity: 'discovery',
        details: { host: target, scanned: portList.length, open: openCount }, severity: 'notice', ip,
      });
      return { host: target, scannedPorts: portList.length, openCount, durationMs: Date.now() - started, results };
    } finally {
      scanning = false;
    }
  },

  /** Limpa o estado de limite (usado em testes). */
  _resetLimits() {
    scansByUser.clear();
    scanning = false;
  },
};

module.exports = discoveryService;
