'use strict';
/**
 * Testes de integração: sobem o Noxis Uptime como processo real, com banco temporário
 * e modo de simulação de notificações (nenhuma mensagem sai do ambiente de teste).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const PORT = 4400 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'noxis-it-'));
const PASSWORD = 'SenhaForte123';
let child;
let cookie = '';
let csrf = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 25000, stepMs = 500) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(stepMs);
  }
  throw new Error(`Tempo esgotado aguardando condição (último valor: ${JSON.stringify(last)})`);
}

async function api(method, route, body) {
  const headers = { accept: 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrf;
  const res = await fetch(`${BASE}${route}`, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual',
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* resposta não JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

test.before(async () => {
  child = spawn(process.execPath, ['app.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT), HOST: '127.0.0.1', NODE_ENV: 'development',
      DATABASE_PATH: path.join(TMP, 'noxis.db'),
      APP_SECRET: 'integration-secret-0123456789abcdef0123456789',
      NOXIS_NOTIFY_DRY_RUN: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  await waitFor(async () => {
    try { return (await fetch(`${BASE}/health`)).ok; } catch (_) { return false; }
  }, 20000);

  // Primeiro acesso: cria o owner e obtém a sessão.
  const setup = await fetch(`${BASE}/setup`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'admin', displayName: 'Admin', password: PASSWORD, confirm: PASSWORD }),
  });
  assert.equal(setup.status, 302, 'setup deve redirecionar');
  cookie = setup.headers.get('set-cookie').split(';')[0];
  const home = await fetch(`${BASE}/`, { headers: { cookie } });
  csrf = (await home.text()).match(/"csrf":"([^"]+)"/)[1];
});

test.after(async () => {
  if (child) child.kill('SIGTERM');
  await sleep(500);
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('health responde OK e o banco está operacional', async () => {
  const res = await api('GET', '/health');
  assert.equal(res.status, 200);
  assert.equal(res.json.database, 'ok');
});

test('API exige autenticação (401 em JSON, nunca página HTML)', async () => {
  const res = await fetch(`${BASE}/api/monitors`, { headers: { accept: 'application/json' } });
  assert.equal(res.status, 401);
  assert.match(res.headers.get('content-type'), /application\/json/);
});

test('mutações sem token CSRF são recusadas', async () => {
  const res = await fetch(`${BASE}/api/groups`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }),
  });
  assert.equal(res.status, 403);
});

test('canal ntfy: valida tópico e aceita configuração válida', async () => {
  const bad = await api('POST', '/api/channels', { type: 'ntfy', name: 'Push', serverUrl: 'http://ntfy.lan:8080', topic: 'com espaco', events: ['monitor.down'] });
  assert.equal(bad.status, 422);
  const ok = await api('POST', '/api/channels', { type: 'ntfy', name: 'Push', serverUrl: 'http://ntfy.lan:8080', topic: 'noxis-alertas', token: 'tk_secreto', events: ['monitor.down', 'monitor.up'] });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.channel.typeLabel, 'ntfy');
  assert.ok(!JSON.stringify(ok.json).includes('tk_secreto'), 'token nunca deve sair do servidor');
});

test('webhook assinado: segredo é mascarado nas respostas', async () => {
  const res = await api('POST', '/api/channels', { type: 'webhook', name: 'n8n', url: 'http://n8n.lan:5678/hook', secret: 'segredo-super-123', events: ['monitor.down'] });
  assert.equal(res.status, 201);
  const list = await api('GET', '/api/channels');
  assert.ok(!list.text.includes('segredo-super-123'));
  assert.ok(list.text.includes('••••••••'));
});

test('limiares de SSL são validados e salvos como lista ordenada', async () => {
  const bad = await api('PUT', '/api/settings', { sslAlertDays: 'abc, 7' });
  assert.equal(bad.status, 422);
  const ok = await api('PUT', '/api/settings', { sslAlertDays: '7, 30, 14, 3, 1' });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.settings.sslAlertDays, [30, 14, 7, 3, 1]);
});

test('teste de canal em modo simulado não contata o destino', async () => {
  const list = await api('GET', '/api/channels');
  const ntfy = list.json.channels.find((c) => c.type === 'ntfy');
  const res = await api('POST', `/api/channels/${ntfy.id}/test`, {});
  assert.equal(res.json.state, 'simulated');
});

test('sem dependentes no momento da queda: alerta normal; dependentes depois são suprimidos', async () => {
  const chan = await api('POST', '/api/channels', { type: 'ntfy', name: 'Alerta A', serverUrl: 'http://ntfy.lan:8080', topic: 'cadeia-a', events: ['monitor.down'] });
  const chanId = chan.json.channel.id;
  const banco = await api('POST', '/api/monitors', { name: 'BancoA', type: 'tcp', target: '127.0.0.1', port: await freePort(), intervalSeconds: 10, timeoutSeconds: 2, retries: 0 });
  const bancoId = banco.json.monitor.id;
  await waitFor(async () => (await api('GET', `/api/monitors/${bancoId}`)).json.monitor.status === 'DOWN');
  const apiM = await api('POST', '/api/monitors', { name: 'APIA', type: 'tcp', target: '127.0.0.1', port: await freePort(), intervalSeconds: 10, timeoutSeconds: 2, retries: 0, active: false });
  const apiId = apiM.json.monitor.id;
  await api('POST', `/api/monitors/${apiId}/dependencies`, { dependsOnId: bancoId, required: true });
  await api('POST', `/api/monitors/${apiId}/resume`, {});
  await waitFor(async () => (await api('GET', `/api/monitors/${apiId}`)).json.monitor.status === 'DOWN');

  const analysis = await api('GET', `/api/monitors/${apiId}/dependencies`);
  assert.deepEqual(analysis.json.rootCauses, ['BancoA']);

  const log = await waitFor(async () => {
    const r = await api('GET', `/api/channels/${chanId}`);
    return r.json.log.length ? r.json.log : null;
  });
  const downs = log.filter((e) => e.event === 'monitor.down');
  assert.equal(downs.length, 1, `esperado 1 alerta (somente a causa), recebido ${downs.length}`);
  assert.match(downs[0].title, /indisponível/i);
  assert.equal(downs[0].status, 'simulated');
});

test('causa raiz com dependentes já cadastrados: alerta de causa raiz e supressão em cascata', async () => {
  const chan = await api('POST', '/api/channels', { type: 'ntfy', name: 'Alerta B', serverUrl: 'http://ntfy.lan:8080', topic: 'cadeia-b', events: ['monitor.down'] });
  const chanId = chan.json.channel.id;
  const db = await api('POST', '/api/monitors', { name: 'DBB', type: 'tcp', target: '127.0.0.1', port: await freePort(), intervalSeconds: 10, timeoutSeconds: 2, retries: 0, active: false });
  const web = await api('POST', '/api/monitors', { name: 'WebB', type: 'tcp', target: '127.0.0.1', port: await freePort(), intervalSeconds: 10, timeoutSeconds: 2, retries: 0, active: false });
  const dbId = db.json.monitor.id;
  const webId = web.json.monitor.id;
  await api('POST', `/api/monitors/${webId}/dependencies`, { dependsOnId: dbId, required: true });
  // Dependentes cadastrados antes da queda: a causa raiz deve listá-los.
  await api('POST', `/api/monitors/${dbId}/resume`, {});
  const log = await waitFor(async () => {
    const r = await api('GET', `/api/channels/${chanId}`);
    return r.json.log.length ? r.json.log : null;
  });
  assert.match(log[0].title, /causa raiz/i);
  assert.equal(log[0].status, 'simulated');

  // Quando o dependente cai depois da causa raiz, nenhum alerta adicional é enviado.
  await api('POST', `/api/monitors/${webId}/resume`, {});
  await waitFor(async () => (await api('GET', `/api/monitors/${webId}`)).json.monitor.status === 'DOWN');
  await sleep(1500);
  const after = (await api('GET', `/api/channels/${chanId}`)).json.log;
  assert.equal(after.filter((e) => e.event === 'monitor.down').length, 1);
});

test('status page pública não vaza endereços; privada exige login', async () => {
  const monitors = await api('GET', '/api/monitors');
  const banco = monitors.json.monitors.find((m) => m.name === 'BancoA');
  const pub = await api('POST', '/api/status-pages', { name: 'Infra', slug: 'infra-it', title: 'Infra', isPublic: true, items: [{ monitorId: banco.id, groupLabel: 'Core' }] });
  assert.equal(pub.status, 201);
  const page = await fetch(`${BASE}/status/infra-it`);
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.ok(html.includes('Banco'));
  assert.ok(!html.includes('127.0.0.1'), 'endereço interno não pode aparecer na página pública');

  const priv = await api('POST', '/api/status-pages', { name: 'Privada', slug: 'privada-it', title: 'P', isPublic: false, items: [{ monitorId: banco.id, groupLabel: 'Core' }] });
  assert.equal(priv.status, 201);
  const anon = await fetch(`${BASE}/status/privada-it`, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /^\/login/);
});

test('backup do banco: cria, lista e baixa um arquivo SQLite válido', async () => {
  const created = await api('POST', '/api/system/backups', {});
  assert.equal(created.status, 201);
  const name = created.json.backup.name;
  assert.match(name, /^noxis-\d{8}-\d{6}(-[a-z0-9]{4})?\.db$/);
  const list = await api('GET', '/api/system/backups');
  assert.ok(list.json.backups.some((b) => b.name === name));
  const file = await fetch(`${BASE}/api/system/backups/${name}`, { headers: { cookie } });
  assert.equal(file.status, 200);
  const header = Buffer.from(await file.arrayBuffer()).subarray(0, 15).toString('utf8');
  assert.equal(header, 'SQLite format 3');
});

test('backup rejeita nomes fora do padrão (proteção contra path traversal)', async () => {
  const res = await api('GET', '/api/system/backups/..%2F..%2Fetc%2Fpasswd');
  assert.equal(res.status, 404);
});

test('discovery de portas: detecta porta aberta, recusa sem autorização e hosts públicos', async () => {
  const listener = net.createServer();
  await new Promise((r) => listener.listen(0, '127.0.0.1', r));
  const openPort = listener.address().port;
  const closedPort = await freePort();
  try {
    const semAutorizacao = await api('POST', '/api/discovery/ports', { host: '127.0.0.1', ports: String(openPort), authorized: false });
    assert.equal(semAutorizacao.status, 422);

    const scan = await api('POST', '/api/discovery/ports', { host: '127.0.0.1', ports: `${openPort},${closedPort}`, authorized: true });
    assert.equal(scan.status, 200);
    const found = scan.json.results.find((r) => r.port === openPort);
    const missed = scan.json.results.find((r) => r.port === closedPort);
    assert.equal(found.open, true);
    assert.equal(found.service, 'Desconhecido');
    assert.equal(missed.open, false);

    const publico = await api('POST', '/api/discovery/ports', { host: '8.8.8.8', ports: '53', authorized: true });
    assert.equal(publico.status, 422);
    assert.match(publico.json.error, /redes privadas/);

    const metadados = await api('POST', '/api/discovery/ports', { host: '169.254.169.254', ports: '80', authorized: true });
    assert.equal(metadados.status, 422);
  } finally {
    listener.close();
  }
});

test('monitor de API: validação de corpo, API key mascarada e chaves obrigatórias', async () => {
  const srv = require('node:http').createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.headers['x-api-key'] !== 'chave-de-teste') { res.statusCode = 401; return res.end('{"erro":"chave"}'); }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: 'ok', data: { id: 7 }, echo: body }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/api`;
  try {
    const invalido = await api('POST', '/api/monitors/test', { type: 'api', target: url, method: 'POST', requestBody: '{quebrado', timeoutSeconds: 5, intervalSeconds: 60 });
    assert.equal(invalido.status, 422);

    const ok = await api('POST', '/api/monitors/test', { type: 'api', target: url, method: 'POST', requestBody: '{"a":1}',
      authType: 'apikey', authApiKeyName: 'X-Api-Key', authApiKeyValue: 'chave-de-teste', requiredKeys: 'status, data.id',
      timeoutSeconds: 5, intervalSeconds: 60 });
    assert.equal(ok.json.ok, true, JSON.stringify(ok.json));

    const semChave = await api('POST', '/api/monitors/test', { type: 'api', target: url, method: 'GET', authType: 'apikey',
      authApiKeyName: 'X-Api-Key', authApiKeyValue: 'errada', timeoutSeconds: 5, intervalSeconds: 60 });
    assert.equal(semChave.json.ok, false);

    const faltando = await api('POST', '/api/monitors/test', { type: 'api', target: url, method: 'GET', authType: 'apikey',
      authApiKeyName: 'X-Api-Key', authApiKeyValue: 'chave-de-teste', requiredKeys: 'inexistente', timeoutSeconds: 5, intervalSeconds: 60 });
    assert.equal(faltando.json.ok, false);
    assert.match(faltando.json.message, /chaves ausentes: inexistente/);

    const criado = await api('POST', '/api/monitors', { name: 'API Clientes', type: 'api', target: url, method: 'GET',
      authType: 'apikey', authApiKeyName: 'X-Api-Key', authApiKeyValue: 'chave-de-teste-secreta', intervalSeconds: 60, timeoutSeconds: 5, retries: 0 });
    assert.equal(criado.status, 201);
    assert.ok(!criado.text.includes('chave-de-teste-secreta'), 'API key não pode sair do servidor');
    assert.ok(criado.text.includes('••••••••'));
  } finally {
    srv.close();
  }
});

test('telegram: token é validado, mascarado e o envio em simulação não contata a API', async () => {
  const bad = await api('POST', '/api/channels', { type: 'telegram', name: 'Bot', botToken: 'invalido', chatId: '-100123', events: ['monitor.down'] });
  assert.equal(bad.status, 422);
  const ok = await api('POST', '/api/channels', { type: 'telegram', name: 'Bot Casa', botToken: '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw', chatId: '-1001234567890', events: ['monitor.down'] });
  assert.equal(ok.status, 201);
  assert.ok(!ok.text.includes('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'));
  const test = await api('POST', `/api/channels/${ok.json.channel.id}/test`, {});
  assert.equal(test.json.state, 'simulated');
});

test('status page privada: token permite acesso sem login; regenerar invalida o link antigo', async () => {
  const banco = (await api('GET', '/api/monitors')).json.monitors[0];
  const page = await api('POST', '/api/status-pages', { name: 'Clientes', slug: 'clientes-token', title: 'Clientes', isPublic: false,
    items: [{ monitorId: banco.id, groupLabel: 'Core' }] });
  assert.equal(page.status, 201);
  const id = page.json.page.id;
  // Sem token: redireciona para login. A listagem da API não expõe o token.
  const semToken = await fetch(`${BASE}/status/clientes-token`, { redirect: 'manual' });
  assert.equal(semToken.status, 302);
  const lista = await api('GET', '/api/status-pages');
  assert.ok(!lista.text.includes('accessToken') && !lista.text.includes('access_token'));

  const t1 = (await api('POST', `/api/status-pages/${id}/token`, {})).json.token;
  const comToken = await fetch(`${BASE}/status/clientes-token?token=${t1}`);
  assert.equal(comToken.status, 200);
  const errado = await fetch(`${BASE}/status/clientes-token?token=errado`, { redirect: 'manual' });
  assert.equal(errado.status, 302);

  const t2 = (await api('POST', `/api/status-pages/${id}/token`, {})).json.token;
  assert.notEqual(t1, t2);
  const antigo = await fetch(`${BASE}/status/clientes-token?token=${t1}`, { redirect: 'manual' });
  assert.equal(antigo.status, 302, 'token antigo deve ser invalidado');
});

test('mapa de infraestrutura renderiza com os monitores e dependências', async () => {
  const res = await fetch(`${BASE}/map`, { headers: { cookie } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Mapa da infraestrutura/);
  assert.match(html, /<svg class="map-svg"/);
});

test('modals: formulários são entregues como fragmentos com permissão por formulário', async () => {
  const monitor = await fetch(`${BASE}/fragments/monitor-form`, { headers: { cookie } });
  const html = await monitor.text();
  assert.equal(monitor.status, 200);
  assert.match(html, /id="monitorForm"/);
  assert.ok(!html.includes('<html'), 'fragmento não deve trazer o layout completo');

  const edit = await fetch(`${BASE}/fragments/monitor-form?id=${(await api('GET', '/api/monitors')).json.monitors[0].id}`, { headers: { cookie } });
  assert.equal(edit.status, 200);
  assert.match(await edit.text(), /Salvar alterações/);

  const missing = await fetch(`${BASE}/fragments/monitor-form?id=999999`, { headers: { cookie } });
  assert.equal(missing.status, 404);

  const unknown = await fetch(`${BASE}/fragments/nao-existe`, { headers: { cookie } });
  assert.equal(unknown.status, 404);

  const group = await fetch(`${BASE}/fragments/group-form`, { headers: { cookie } });
  assert.match(await group.text(), /id="groupForm"/);
  const maint = await fetch(`${BASE}/fragments/maintenance-form`, { headers: { cookie } });
  assert.match(await maint.text(), /id="maintenanceForm"/);

  const anon = await fetch(`${BASE}/fragments/monitor-form`, { redirect: 'manual' });
  assert.equal(anon.status, 302, 'sem sessão, redireciona para login');
});

test('atualização: status disponível, aplicar é recusado sem pacote verificado, README exibido', async () => {
  const status = await api('GET', '/api/updates/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.repo, 'BroownTeely/noxis-uptime');
  assert.equal(status.json.canApply, false);
  assert.ok(status.json.current);

  const apply = await api('POST', '/api/updates/apply', {});
  assert.equal(apply.status, 409, 'sem pacote verificado, não pode aplicar');

  const sobre = await fetch(`${BASE}/sobre`, { headers: { cookie } });
  const html = await sobre.text();
  assert.equal(sobre.status, 200);
  assert.match(html, /Noxis Uptime/);
  assert.match(html, /class="md"/);

  const pagina = await fetch(`${BASE}/atualizacao`, { headers: { cookie } });
  assert.equal(pagina.status, 200);
  assert.match(await pagina.text(), /Atualização do sistema/);
});
