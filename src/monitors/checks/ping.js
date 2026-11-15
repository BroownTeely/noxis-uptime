'use strict';

const { spawn } = require('child_process');
const { assertSafeHost, isSafeHostToken } = require('../../utils/network');

const PACKETS = 3;

/**
 * Executa o utilitário ping do sistema (ICMP). Em Linux, o ping normal funciona
 * para usuários sem root graças ao sysctl net.ipv4.ping_group_range ou
 * capacidade cap_net_raw. Quando indisponível, a falha é reportada de forma clara.
 */
function runPing(monitor, { signal, allowPrivate }) {
  const host = String(monitor.target || '').trim();
  if (!isSafeHostToken(host)) throw new Error('Host inválido para ICMP');
  const timeoutSec = Math.max(1, Math.min(10, monitor.timeoutSeconds || 5));

  return assertSafeHost(host, { allowPrivate }).then(
    () => new Promise((resolve) => {
      const args = ['-n', '-c', String(PACKETS), '-W', String(timeoutSec), host];
      const child = spawn('ping', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const killTimer = setTimeout(() => child.kill('SIGKILL'), (timeoutSec * PACKETS + 5) * 1000);
      const onAbort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', onAbort);

      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => {
        clearTimeout(killTimer);
        resolve({
          ok: false, latencyMs: null,
          message: e.code === 'ENOENT'
            ? 'Utilitário ping não instalado (instale iputils-ping)'
            : `Falha ao executar ping: ${e.message}`,
          details: {},
        });
      });
      child.on('close', () => {
        clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
        const lossMatch = /(\d+(?:\.\d+)?)% packet loss/.exec(out);
        const rttMatch = /=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(out);
        const loss = lossMatch ? Number(lossMatch[1]) : null;
        const avg = rttMatch ? Math.round(Number(rttMatch[2])) : null;
        if (loss === null) {
          const hint = /operation not permitted|permission denied/i.test(err + out)
            ? 'sem permissão ICMP (ajuste net.ipv4.ping_group_range ou capacidade cap_net_raw)'
            : (err || out).trim().split('\n').pop() || 'sem resposta';
          resolve({ ok: false, latencyMs: null, message: `ICMP falhou: ${hint}`, details: { lossPercent: 100 } });
          return;
        }
        const ok = loss < 100;
        resolve({
          ok,
          latencyMs: avg,
          message: ok ? `Perda ${loss}% · média ${avg ?? '-'} ms` : 'Sem resposta ICMP (100% de perda)',
          details: { lossPercent: loss, packets: PACKETS, avgMs: avg },
        });
      });
    })
  );
}

module.exports = { runPing };
