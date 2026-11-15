#!/usr/bin/env bash
# Atualiza uma instalação existente para a última release (ou VERSION=vX.Y.Z).
# Mantém .env e storage/ (banco de dados). Faz backup do banco antes.
# Uso: sudo bash update.sh   |   sudo VERSION=v1.1.0 bash update.sh
set -euo pipefail
REPO="${REPO:-BroownTeely/noxis-uptime}"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/noxis-uptime}"
API="https://api.github.com/repos/${REPO}/releases"
log() { printf '\033[1;34m[noxis]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Execute como root."
[[ -f "$INSTALL_DIR/app.js" ]] || die "Instalação não encontrada em $INSTALL_DIR"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if [[ "$VERSION" == "latest" ]]; then URL="${API}/latest"; else URL="${API}/tags/${VERSION}"; fi
curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: noxis-update' "$URL" -o "$TMP/release.json"
read -r TAG ZIP_URL ZIP_NAME SUMS_URL < <(node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const a = r.assets || [];
  const z = a.find(x => /\.zip$/i.test(x.name) && /noxis/i.test(x.name));
  const s = a.find(x => x.name === "SHA256SUMS.txt");
  if (!r.tag_name || !z || !s) process.exit(2);
  console.log([r.tag_name, z.browser_download_url, z.name, s.browser_download_url].join(" "));
' "$TMP/release.json") || die "Release sem pacote ou SHA256SUMS.txt"
log "Atualizando para ${TAG}"
curl -fsSL "$ZIP_URL" -o "$TMP/$ZIP_NAME"
curl -fsSL "$SUMS_URL" -o "$TMP/SHA256SUMS.txt"
( cd "$TMP" && grep " ${ZIP_NAME}\$" SHA256SUMS.txt | sha256sum -c - >/dev/null ) || die "Checksum não confere; nada foi alterado."
mkdir -p "$INSTALL_DIR/storage/backups"
if [[ -f "$INSTALL_DIR/storage/database/noxis.db" ]]; then
  cp "$INSTALL_DIR/storage/database/noxis.db" "$INSTALL_DIR/storage/backups/pre-update-$(date +%Y%m%d-%H%M%S).db"
  log "Backup do banco criado em storage/backups/"
fi
systemctl stop noxis-uptime.service || true
unzip -q "$TMP/$ZIP_NAME" -d "$TMP/pkg"
SRC="$TMP/pkg"; [[ -f "$SRC/app.js" ]] || SRC="$(find "$TMP/pkg" -maxdepth 2 -name app.js -printf '%h\n' | head -1)"
rm -rf "$INSTALL_DIR/src" "$INSTALL_DIR/app.js" "$INSTALL_DIR/package.json" "$INSTALL_DIR/package-lock.json" "$INSTALL_DIR/README.md" "$INSTALL_DIR/LICENSE"
cp -a "$SRC"/. "$INSTALL_DIR"/
( cd "$INSTALL_DIR" && npm_config_cache="$INSTALL_DIR/storage/npm-cache" npm ci --omit=dev --no-audit --no-fund )
chown -R noxis:noxis "$INSTALL_DIR"
systemctl start noxis-uptime.service
PORT="$(grep -E '^PORT=' "$INSTALL_DIR/.env" | cut -d= -f2)"
sleep 3
curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null && log "Atualização concluída: ${TAG}" || die "Serviço não respondeu. Veja: journalctl -u noxis-uptime -e"
