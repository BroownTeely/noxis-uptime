'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const semver = require('../../utils/semver');
const { parseRelease, findSha256 } = require('../../services/update.service');
const { projectPath, isSafeName } = require('../../utils/zip');

test('versões: compara X.Y.Z e aceita prefixo v', () => {
  assert.equal(semver.compare('1.2.0', '1.1.9'), 1);
  assert.equal(semver.compare('v1.0.0', '1.0.0'), 0);
  assert.equal(semver.compare('1.0.9', '1.1.0'), -1);
  assert.equal(semver.isValid('1.0'), false);
  assert.throws(() => semver.compare('x', '1.0.0'));
});

test('release: extrai versão, pacote e SHA256SUMS da resposta da API', () => {
  const r = parseRelease({
    tag_name: 'v1.2.0', name: 'Versão 1.2.0', body: '## Novidades', html_url: 'https://github.com/BroownTeely/noxis-uptime/releases/tag/v1.2.0',
    assets: [
      { name: 'noxis-uptime-v1.2.0.zip', browser_download_url: 'https://github.com/x.zip', size: 10 },
      { name: 'SHA256SUMS.txt', browser_download_url: 'https://github.com/sums.txt' },
    ],
  });
  assert.equal(r.version, '1.2.0');
  assert.equal(r.zip.name, 'noxis-uptime-v1.2.0.zip');
  assert.ok(r.sums);
});

test('release: sem tag válida ou sem pacote é tratada', () => {
  assert.throws(() => parseRelease({}), /sem tag/);
  assert.throws(() => parseRelease({ tag_name: 'latest' }), /inválida/);
  assert.equal(parseRelease({ tag_name: 'v1.0.1', assets: [] }).zip, null);
});

test('checksum: encontra o hash do pacote e recusa arquivo ausente', () => {
  const sums = `${'a'.repeat(64)}  outro.zip\n${'b'.repeat(64)}  noxis-uptime-v1.2.0.zip\n`;
  assert.equal(findSha256(sums, 'noxis-uptime-v1.2.0.zip'), 'b'.repeat(64));
  assert.equal(findSha256(sums, 'nao-existe.zip'), null);
});

test('extração: só caminhos do projeto são aceitos; dados e segredos ficam de fora', () => {
  assert.equal(projectPath('noxis-uptime/app.js'), 'app.js');
  assert.equal(projectPath('noxis-uptime/src/services/x.js'), 'src/services/x.js');
  assert.equal(projectPath('src/x.js'), 'src/x.js');
  assert.equal(projectPath('noxis-uptime/storage/noxis.db'), null);
  assert.equal(projectPath('noxis-uptime/.env'), null);
  assert.equal(projectPath('noxis-uptime/node_modules/x/index.js'), null);
  assert.equal(projectPath('../../etc/passwd'), null);
  assert.equal(isSafeName('/abs/path'), false);
  assert.equal(isSafeName('a\\b'), false);
});
