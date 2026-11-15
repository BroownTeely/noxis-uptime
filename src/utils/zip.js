'use strict';

const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

// Apenas estes caminhos são extraídos de uma release. Tudo o mais é ignorado,
// inclusive storage/, .env e node_modules: dados do usuário nunca são sobrescritos.
const ALLOWED_TOP = ['app.js', 'package.json', 'package-lock.json', 'README.md', 'LICENSE'];
const ALLOWED_DIRS = ['src/'];
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
const MAX_ENTRIES = 8000;

/** Caminho relativo seguro (sem absoluto, sem "..", sem barra invertida). */
function isSafeName(name) {
  if (!name || name.startsWith('/') || name.includes('\\') || /^[A-Za-z]:/.test(name)) return false;
  return !name.split('/').some((part) => part === '..');
}

/**
 * Remove a pasta de topo quando a release a contém (ex.: noxis-uptime/app.js) e
 * retorna o caminho relativo à raiz do projeto, ou null se o arquivo não é permitido.
 */
function projectPath(entryName) {
  const name = entryName.replace(/^\.\//, '');
  if (!isSafeName(name)) return null;
  const parts = name.split('/');
  // Uma pasta de topo única ("noxis-uptime/") é descartada.
  const rel = parts.length > 1 && !ALLOWED_TOP.includes(parts[0]) && !ALLOWED_DIRS.includes(parts[0] + '/')
    ? parts.slice(1).join('/') : name;
  if (!rel) return null;
  const allowed = ALLOWED_TOP.includes(rel) || ALLOWED_DIRS.some((d) => rel.startsWith(d));
  return allowed ? rel : null;
}

/** Extrai a release para um diretório de preparação, somente com arquivos permitidos. */
function extractRelease(zipFile, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err) return reject(err);
      let total = 0;
      let count = 0;
      let extracted = 0;
      zip.readEntry();
      zip.on('entry', (entry) => {
        count += 1;
        if (count > MAX_ENTRIES) { zip.close(); return reject(new Error('Release com entradas demais')); }
        const rel = projectPath(entry.fileName);
        if (!rel || /\/$/.test(entry.fileName)) { zip.readEntry(); return; }
        total += entry.uncompressedSize;
        if (total > MAX_TOTAL_BYTES) { zip.close(); return reject(new Error('Release grande demais')); }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2) { zip.close(); return reject(e2); }
          const target = path.join(destDir, rel);
          if (!target.startsWith(path.resolve(destDir) + path.sep) && target !== path.resolve(destDir)) {
            zip.close();
            return reject(new Error('Caminho inválido na release'));
          }
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const out = fs.createWriteStream(target);
          stream.pipe(out);
          out.on('finish', () => { extracted += 1; zip.readEntry(); });
          out.on('error', (e3) => { zip.close(); reject(e3); });
        });
      });
      zip.on('end', () => resolve({ extracted, entries: count }));
      zip.on('error', reject);
    });
  });
}

module.exports = { extractRelease, projectPath, isSafeName, ALLOWED_TOP };
