'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('../config');
const bus = require('../events/bus');
const semver = require('../utils/semver');
const { render: renderMarkdown } = require('../utils/markdown');
const { extractRelease } = require('../utils/zip');
const settingsRepo = require('../db/repositories/settings');
const audit = require('../db/repositories/audit');
const backupService = require('./backup.service');
const { genericEmbed } = require('../notifications/templates/discord.embeds');

const REPO = process.env.NOXIS_UPDATE_REPO || 'BroownTeely/noxis-uptime';
const UPDATES_DIR = path.join(config.root, 'storage', 'updates');
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const REMIND_EVERY_MS = 24 * 60 * 60 * 1000;
const MAX_ZIP_BYTES = 150 * 1024 * 1024;
// Downloads só podem vir destes hosts (inclusive após redirecionamentos do GitHub).
const ALLOWED_HOSTS = ['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const CODE_PATHS = ['src', 'app.js', 'package.json', 'package-lock.json', 'README.md', 'LICENSE'];

const isDocker = () => fs.existsSync('/.dockerenv') || process.env.NOXIS_DOCKER === '1';

/** Interpreta a resposta da API de releases. Função pura (testável). */
function parseRelease(json) {
  if (!json || !json.tag_name) throw new Error('Resposta de release sem tag');
  const assets = Array.isArray(json.assets) ? json.assets : [];
  const zip = assets.find((a) => /\.zip$/i.test(a.name) && /noxis/i.test(a.name));
  const sums = assets.find((a) => a.name === 'SHA256SUMS.txt');
  const version = String(json.tag_name).replace(/^v/, '');
  if (!semver.isValid(version)) throw new Error(`Tag de versão inválida: ${json.tag_name}`);
  return {
    version,
    tag: json.tag_name,
    name: json.name || json.tag_name,
    notes: String(json.body || ''),
    publishedAt: json.published_at || null,
    url: json.html_url || `https://github.com/${REPO}/releases`,
    zip: zip ? { name: zip.name, url: zip.browser_download_url, size: zip.size } : null,
    sums: sums ? { url: sums.browser_download_url } : null,
  };
}

/** Procura o SHA-256 do arquivo no SHA256SUMS.txt ("hash  nome"). */
function findSha256(sumsText, fileName) {
  for (const line of String(sumsText).split(/\r?\n/)) {
    const m = /^([a-f0-9]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2] === fileName) return m[1].toLowerCase();
  }
  return null;
}

function assertAllowedUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.hostname)) throw new Error(`Host não permitido para atualização: ${u.hostname}`);
  return u;
}

async function httpGet(url, { accept = 'application/vnd.github+json', maxBytes = 1024 * 1024, timeoutMs = 60000 } = {}) {
  assertAllowedUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept, 'user-agent': `noxis-uptime/${config.version}` },
      redirect: 'follow',
      signal: controller.signal,
    });
    assertAllowedUrl(res.url);
    if (!res.ok) throw new Error(`GitHub respondeu HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('Arquivo maior que o limite permitido');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('Arquivo maior que o limite permitido');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

const state = {
  status: 'idle',          // idle | checking | downloading | applying | error
  checkedAt: null,
  latest: null,
  available: false,
  downloadedVersion: null,
  verified: false,
  lastError: null,
  // Preenchidos ao iniciar o agendador (o banco ainda não está aberto ao carregar o módulo).
  lastNotifiedVersion: null,
  lastNotifiedAt: null,
};
let notifier = null;
let timer = null;

function publicStatus() {
  const canApply = !isDocker() && state.available && state.verified && state.downloadedVersion === state.latest?.version && state.status !== 'applying';
  return {
    current: config.version,
    repo: REPO,
    status: state.status,
    available: state.available,
    latest: state.latest && {
      version: state.latest.version, tag: state.latest.tag, name: state.latest.name,
      publishedAt: state.latest.publishedAt, url: state.latest.url,
      notesHtml: renderMarkdown(state.latest.notes),
    },
    downloaded: state.downloadedVersion,
    verified: state.verified,
    checkedAt: state.checkedAt,
    lastError: state.lastError,
    docker: isDocker(),
    canApply,
    autoDownload: !!settingsRepo.get('autoDownloadUpdates', true),
  };
}

function emit() {
  bus.emit('update:changed', publicStatus());
}

function setStatus(status, error = null) {
  state.status = status;
  state.lastError = error;
  emit();
}

async function check({ force = false } = {}) {
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'applying') return publicStatus();
  setStatus('checking');
  try {
    const json = JSON.parse((await httpGet(`https://api.github.com/repos/${REPO}/releases/latest`)).toString('utf8'));
    const latest = parseRelease(json);
    state.latest = latest;
    state.checkedAt = new Date().toISOString();
    state.available = semver.compare(latest.version, config.version) > 0;
    if (!state.available) {
      state.downloadedVersion = null;
      state.verified = false;
    }
    if (state.available && settingsRepo.get('autoDownloadUpdates', true)) {
      await download(latest);
    }
    if (state.available) await notifyPending(force);
    setStatus('idle');
  } catch (err) {
    setStatus('error', `Não foi possível verificar atualizações: ${err.message}`);
  }
  return publicStatus();
}

/** Baixa o ZIP da release e confere o SHA-256 publicado junto dela. */
async function download(latest = state.latest) {
  if (!latest?.zip || !latest.sums) throw new Error('A release não possui o pacote ou o SHA256SUMS.txt');
  const dir = path.join(UPDATES_DIR, latest.version);
  fs.mkdirSync(dir, { recursive: true });
  const zipPath = path.join(dir, latest.zip.name);
  if (state.downloadedVersion === latest.version && state.verified && fs.existsSync(zipPath)) return;
  setStatus('downloading');
  const sums = (await httpGet(latest.sums.url, { accept: 'application/octet-stream', maxBytes: 64 * 1024 })).toString('utf8');
  const expected = findSha256(sums, latest.zip.name);
  if (!expected) throw new Error('SHA256SUMS.txt não lista o pacote da release');
  const zip = await httpGet(latest.zip.url, { accept: 'application/octet-stream', maxBytes: MAX_ZIP_BYTES, timeoutMs: 300000 });
  const actual = crypto.createHash('sha256').update(zip).digest('hex');
  if (actual !== expected) throw new Error('Checksum SHA-256 do pacote não confere: download descartado');
  fs.writeFileSync(zipPath, zip);
  state.downloadedVersion = latest.version;
  state.verified = true;
  audit.write({ action: 'update.downloaded', entity: 'release', entityId: latest.tag, details: { sha256: actual, size: zip.length } });
}

/** Aviso de atualização pendente: uma vez por versão e a cada 24 h enquanto estiver pendente. */
async function notifyPending(force = false) {
  if (!notifier || !state.latest) return;
  const version = state.latest.version;
  const last = state.lastNotifiedAt ? Date.parse(state.lastNotifiedAt) : 0;
  const due = state.lastNotifiedVersion !== version || Date.now() - last >= REMIND_EVERY_MS || force;
  if (!due) return;
  const embed = genericEmbed({
    kind: 'maintenance',
    title: '🆕 Noxis Uptime — Atualização disponível',
    description: `Versão **${state.latest.version}** disponível (instalada: ${config.version}). Abra o painel em Atualização para aplicar quando quiser.`,
    fields: [
      { name: '📦 Versão', value: state.latest.version },
      { name: '🔗 Notas da release', value: state.latest.url, inline: false },
      { name: '✅ Pacote', value: state.verified ? 'Baixado e verificado' : 'Aguardando download' },
    ],
  });
  notifier.broadcast('system.update', { key: `update:${version}:${Date.now() >> 16}`, embed });
  state.lastNotifiedVersion = version;
  state.lastNotifiedAt = new Date().toISOString();
  settingsRepo.set('updateLastNotifiedVersion', version);
  settingsRepo.set('updateLastNotifiedAt', state.lastNotifiedAt);
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, npm_config_cache: path.join(config.root, 'storage', 'npm-cache'), npm_config_update_notifier: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 10 * 60 * 1000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args[0]} terminou com código ${code}: ${err.slice(-300)}`));
    });
  });
}

function copyCode(fromRoot, toRoot) {
  for (const p of CODE_PATHS) {
    const src = path.join(fromRoot, p);
    const dst = path.join(toRoot, p);
    if (!fs.existsSync(src)) continue;
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
  }
}

/**
 * Aplica a atualização já baixada e verificada. Faz backup do banco e do código,
 * instala a release, roda `npm ci` e, se algo falhar, restaura o código anterior.
 * Ao concluir, encerra o processo: o gerenciador (systemd ou Docker) o reinicia na nova versão.
 */
async function apply(user, ip) {
  if (isDocker()) throw Object.assign(new Error('Em Docker, atualize refazendo a imagem: docker compose up -d --build'), { status: 409 });
  if (!state.available || !state.verified || !state.latest) throw Object.assign(new Error('Nenhuma atualização verificada para aplicar'), { status: 409 });
  if (state.status === 'applying') throw Object.assign(new Error('Atualização já em andamento'), { status: 409 });

  const version = state.latest.version;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rollbackDir = path.join(UPDATES_DIR, `rollback-${stamp}`);
  const stagingDir = path.join(UPDATES_DIR, `staging-${stamp}`);
  setStatus('applying');
  audit.write({ userId: user.id, username: user.username, action: 'update.apply_started', severity: 'notice', entity: 'release', entityId: version, ip });
  try {
    const backup = backupService.create();
    fs.mkdirSync(rollbackDir, { recursive: true });
    copyCode(config.root, rollbackDir);

    fs.mkdirSync(stagingDir, { recursive: true });
    const zipPath = path.join(UPDATES_DIR, version, state.latest.zip.name);
    await extractRelease(zipPath, stagingDir);
    if (!fs.existsSync(path.join(stagingDir, 'app.js'))) throw new Error('Pacote da release sem app.js');

    try {
      copyCode(stagingDir, config.root);
      await run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], config.root);
    } catch (installErr) {
      copyCode(rollbackDir, config.root);
      await run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], config.root).catch(() => {});
      throw new Error(`Falha ao instalar a versão ${version}; versão anterior restaurada. ${installErr.message}`);
    }

    settingsRepo.set('updateInstalledAt', new Date().toISOString());
    settingsRepo.set('updateLastNotifiedVersion', null);
    audit.write({ userId: user.id, username: user.username, action: 'update.applied', severity: 'notice', entity: 'release', entityId: version, details: { from: config.version, backup: backup.name }, ip });
    notifier?.broadcast('system.update_applied', {
      key: `applied:${version}`,
      embed: genericEmbed({ kind: 'up', title: '✅ Noxis Uptime — Atualização aplicada',
        description: `Sistema atualizado de ${config.version} para ${version}. Reiniciando.`, fields: [] }),
    });
    fs.rmSync(stagingDir, { recursive: true, force: true });
    setStatus('idle');
    // Encerra após a resposta HTTP; o gerenciador reinicia o processo na nova versão.
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 2000).unref();
    return publicStatus();
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    audit.write({ userId: user.id, username: user.username, action: 'update.apply_failed', severity: 'error', entity: 'release', entityId: version, details: { error: err.message }, ip });
    setStatus('error', err.message);
    throw Object.assign(err, { status: 500 });
  }
}

function startScheduler(notificationManager) {
  notifier = notificationManager;
  if (timer) return;
  state.lastNotifiedVersion = settingsRepo.get('updateLastNotifiedVersion', null);
  state.lastNotifiedAt = settingsRepo.get('updateLastNotifiedAt', null);
  const first = setTimeout(() => check().catch(() => {}), 30 * 1000);
  first.unref();
  timer = setInterval(() => check().catch(() => {}), CHECK_EVERY_MS);
  timer.unref();
}

module.exports = {
  REPO, check, download, apply, publicStatus, startScheduler,
  parseRelease, findSha256, isDocker, CODE_PATHS,
};
