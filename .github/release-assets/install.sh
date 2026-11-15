#!/usr/bin/env bash
# Noxis Uptime - instalação da última release (ou de uma versão específica) em Linux com systemd.
# Uso:
#   curl -fsSL https://github.com/BroownTeely/noxis-uptime/releases/latest/download/install.sh | sudo bash
#   sudo VERSION=v1.0.0 bash install.sh          # versão específica
#   sudo INSTALL_DIR=/srv/noxis bash install.sh  # outro diretório
set -euo pipefail

REPO="${REPO:-BroownTeely/noxis-uptime}"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-/opt/noxis-uptime}"
SERVICE_USER="noxis"
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=13
API="https://api.github.com/repos/${REPO}/releases"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"

log()  { printf '\033[1;34m[noxis]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Execute como root: sudo bash install.sh"
command -v systemctl >/dev/null || die "systemd não encontrado. Use Docker ou instale manualmente."
# Lê o sistema operacional em um subshell: /etc/os-release define VERSION, que sobrescreveria a versão pedida.
OS_NAME="$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-desconhecido}" || echo desconhecido)"
log "Sistema: ${OS_NAME}"

# 1) Dependências do sistema
apt-get update -qq
apt-get install -y -qq curl ca-certificates unzip iputils-ping coreutils >/dev/null

node_ok() {
  command -v node >/dev/null || return 1
  local v; v="$(node -p 'process.versions.node')"
  local major minor
  major="${v%%.*}"; minor="$(echo "$v" | cut -d. -f2)"
  [[ "$major" -gt "$NODE_MIN_MAJOR" ]] || { [[ "$major" -eq "$NODE_MIN_MAJOR" ]] && [[ "$minor" -ge "$NODE_MIN_MINOR" ]]; }
}
if ! node_ok; then
  log "Instalando Node.js ${NODE_MIN_MAJOR}.x (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node_ok || die "Node.js ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR}+ é necessário"
log "Node.js $(node -v) e npm $(npm -v)"

# 2) Localiza a release e o pacote verificável
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [[ "$VERSION" == "latest" ]]; then URL="${API}/latest"; else URL="${API}/tags/${VERSION}"; fi
log "Consultando a release (${VERSION})"
curl -fsSL -H 'Accept: application/vnd.github+json' -H 'User-Agent: noxis-install' "$URL" -o "$TMP/release.json" \
  || die "Não foi possível consultar a release em ${REPO}"

read -r TAG ZIP_URL ZIP_NAME SUMS_URL < <(node -e '
  const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const a = r.assets || [];
  const z = a.find(x => /\.zip$/i.test(x.name) && /noxis/i.test(x.name));
  const s = a.find(x => x.name === "SHA256SUMS.txt");
  if (!r.tag_name || !z || !s) { process.exit(2); }
  console.log([r.tag_name, z.browser_download_url, z.name, s.browser_download_url].join(" "));
' "$TMP/release.json") || die "A release não tem o pacote ou o SHA256SUMS.txt"
log "Versão: ${TAG}"

curl -fsSL "$ZIP_URL" -o "$TMP/$ZIP_NAME"
curl -fsSL "$SUMS_URL" -o "$TMP/SHA256SUMS.txt"
( cd "$TMP" && grep " ${ZIP_NAME}\$" SHA256SUMS.txt | sha256sum -c - >/dev/null ) \
  || die "Checksum SHA-256 não confere. Instalação cancelada."
log "Checksum SHA-256 verificado"

# 3) Usuário e arquivos
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$INSTALL_DIR"
unzip -q "$TMP/$ZIP_NAME" -d "$TMP/pkg"
SRC="$TMP/pkg"
[[ -f "$SRC/app.js" ]] || SRC="$(find "$TMP/pkg" -maxdepth 2 -name app.js -printf '%h\n' | head -1)"
[[ -n "$SRC" && -f "$SRC/app.js" ]] || die "Pacote inválido: app.js não encontrado"
cp -a "$SRC"/. "$INSTALL_DIR"/
mkdir -p "$INSTALL_DIR/storage/database" "$INSTALL_DIR/storage/logs" "$INSTALL_DIR/storage/backups" "$INSTALL_DIR/storage/npm-cache" "$INSTALL_DIR/storage/home"

# 4) Dependências do Node (produção)
log "Instalando dependências (npm ci)"
( cd "$INSTALL_DIR" && npm_config_cache="$INSTALL_DIR/storage/npm-cache" npm ci --omit=dev --no-audit --no-fund )

# 5) Configuração (.env criado apenas na primeira instalação)
# Porta aleatória de 4 dígitos (1000-9999), livre no momento da instalação.
pick_port() {
  local p i
  for i in $(seq 1 200); do
    p=$(( (RANDOM % 9000) + 1000 ))
    if ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}\$"; then echo "$p"; return; fi
  done
  echo 8417
}
PORT_CHOSEN="${PORT:-$(pick_port)}"
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  SECRET="$(node -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')"
  cat > "$INSTALL_DIR/.env" <<ENV
PORT=${PORT_CHOSEN}
HOST=0.0.0.0
NODE_ENV=production
APP_SECRET=${SECRET}
DATABASE_PATH=${INSTALL_DIR}/storage/database/noxis.db
COOKIE_SECURE=false
TRUST_PROXY=1
MAX_CONCURRENT_CHECKS=20
ENV
  log "Arquivo .env criado (APP_SECRET gerado)"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod 600 "$INSTALL_DIR/.env"

# 6) Serviço systemd (reinicia sempre: após uma atualização o processo sai e volta na nova versão)
UNIT_SRC="$SELF_DIR/noxis-uptime.service"
if [[ ! -f "$UNIT_SRC" ]]; then
  curl -fsSL "https://github.com/${REPO}/releases/latest/download/noxis-uptime.service" -o "$TMP/noxis-uptime.service"
  UNIT_SRC="$TMP/noxis-uptime.service"
fi
sed "s#/opt/noxis-uptime#${INSTALL_DIR}#g" "$UNIT_SRC" > /etc/systemd/system/noxis-uptime.service
systemctl daemon-reload
systemctl enable --now noxis-uptime.service

PORT="$(grep -E '^PORT=' "$INSTALL_DIR/.env" | cut -d= -f2)"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    log "Noxis Uptime ${TAG} instalado e ativo."
    log "Acesse: http://IP-DO-SERVIDOR:${PORT}  (crie a conta owner em /setup)"
    exit 0
  fi
  sleep 1
done
die "Serviço não respondeu. Veja: journalctl -u noxis-uptime -e"
