'use strict';

const net = require('net');
const { assertSafeHost, parseHostPort } = require('../../utils/network');

function runTcp(monitor, { signal, allowPrivate }) {
  const timeoutMs = Math.max(1, monitor.timeoutSeconds) * 1000;
  const { host, port } = parseHostPort(monitor.target, Number(monitor.config?.port) || 80);
  if (!port) throw new Error('Porta obrigatória');

  return assertSafeHost(host, { allowPrivate }).then(
    () => new Promise((resolve) => {
      const started = Date.now();
      const socket = net.connect({ host, port });
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeoutMs, () => finish({
        ok: false, latencyMs: null, message: `Timeout após ${monitor.timeoutSeconds}s`, details: { host, port },
      }));
      socket.once('connect', () => {
        const latencyMs = Date.now() - started;
        finish({ ok: true, latencyMs, message: `Porta ${port} acessível em ${latencyMs} ms`, details: { host, port } });
      });
      socket.once('error', (err) => finish({
        ok: false, latencyMs: null, message: `Conexão recusada ou falhou: ${err.code || err.message}`,
        details: { host, port },
      }));
      if (signal) signal.addEventListener('abort', () => finish({
        ok: false, latencyMs: null, message: 'Verificação cancelada', details: { host, port },
      }));
    })
  );
}

module.exports = { runTcp };
