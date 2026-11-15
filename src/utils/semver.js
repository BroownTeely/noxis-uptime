'use strict';

/** Compara versões no formato X.Y.Z (aceita prefixo "v"). Retorna -1, 0 ou 1. */
function parse(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) throw new Error(`Versão inválida: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

module.exports = { compare, parse, isValid: (v) => parse(v) !== null };
