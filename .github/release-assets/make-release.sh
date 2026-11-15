#!/usr/bin/env bash
# Gera os arquivos de uma release a partir do repositório do projeto.
# Uso: bash make-release.sh /caminho/do/noxis-uptime v1.0.1
# Saída: dist/noxis-uptime-<tag>.zip, dist/SHA256SUMS.txt e dist/install.sh.
# Anexe os três arquivos à release no GitHub (e também noxis-uptime.service).
set -euo pipefail
PROJECT="${1:?informe o diretório do projeto}"
TAG="${2:?informe a tag, ex.: v1.0.1}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/dist"
rm -rf "$OUT" && mkdir -p "$OUT/stage/noxis-uptime"
( cd "$PROJECT" && tar --exclude=node_modules --exclude='storage' --exclude='.env' --exclude='*.log' -cf - app.js package.json package-lock.json README.md LICENSE src ) \
  | tar -xf - -C "$OUT/stage/noxis-uptime"
( cd "$OUT/stage" && zip -qr "$OUT/noxis-uptime-${TAG}.zip" noxis-uptime )
( cd "$OUT" && sha256sum "noxis-uptime-${TAG}.zip" > SHA256SUMS.txt )
cp "$HERE/install.sh" "$HERE/noxis-uptime.service" "$OUT/"
rm -rf "$OUT/stage"
echo "Release pronta em $OUT:"; ls -1 "$OUT"
