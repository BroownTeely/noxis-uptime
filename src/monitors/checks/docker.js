'use strict';

const http = require('http');
const config = require('../../config');

/**
 * Consulta a Docker Engine API somente leitura através do socket Unix.
 * O socket não é exposto a clientes: é usado apenas pelo processo do servidor.
 * Requer DOCKER_SOCKET configurado (ex.: /var/run/docker.sock com permissão de leitura).
 */
function dockerGet(path, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: config.dockerSocket, path, method: 'GET', timeout: timeoutMs }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode === 404) return reject(new Error('container não encontrado'));
        if (res.statusCode >= 400) return reject(new Error(`Docker API HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout na Docker API')));
    req.on('error', reject);
    req.end();
  });
}

function cpuPercent(stats) {
  const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
  const sysDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
  const cpus = stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
  if (sysDelta <= 0 || cpuDelta < 0) return 0;
  return Math.round((cpuDelta / sysDelta) * cpus * 1000) / 10;
}

async function runDocker(monitor) {
  if (!config.dockerSocket) {
    return { ok: false, latencyMs: null, message: 'Docker não configurado (defina DOCKER_SOCKET)', details: {} };
  }
  const name = String(monitor.target || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(name)) throw new Error('Nome de container inválido');
  const started = Date.now();
  const timeoutMs = Math.max(1, monitor.timeoutSeconds) * 1000;

  const inspect = await dockerGet(`/containers/${encodeURIComponent(name)}/json`, timeoutMs);
  const state = inspect.State || {};
  const health = state.Health?.Status || null;
  const running = !!state.Running;
  const latencyMs = Date.now() - started;

  let cpu = null;
  let memory = null;
  if (running) {
    try {
      const stats = await dockerGet(`/containers/${inspect.Id}/stats?stream=false`, timeoutMs);
      cpu = cpuPercent(stats);
      memory = { usageBytes: stats.memory_stats?.usage || 0, limitBytes: stats.memory_stats?.limit || 0 };
    } catch (_) { /* estatísticas são opcionais */ }
  }

  const ok = running && (!health || health === 'healthy');
  const details = {
    id: String(inspect.Id || '').slice(0, 12),
    image: inspect.Config?.Image,
    state: state.Status,
    status: state.Status,
    health,
    startedAt: state.StartedAt,
    restartCount: inspect.RestartCount ?? 0,
    lastStateChangeAt: state.FinishedAt || state.StartedAt || null,
    cpuPercent: cpu,
    memory,
  };
  return {
    ok,
    latencyMs,
    message: ok ? `Container em execução (${state.Status})` : `Container ${state.Status || 'parado'}${health ? ` · saúde: ${health}` : ''}`,
    details,
  };
}

module.exports = { runDocker };
