#!/usr/bin/env bash
# Remove o serviço. Os dados são mantidos, a menos que --purge seja usado.
# Uso: sudo bash uninstall.sh [--purge]
set -euo pipefail
INSTALL_DIR="${INSTALL_DIR:-/opt/noxis-uptime}"
[[ $EUID -eq 0 ]] || { echo "Execute como root."; exit 1; }
systemctl disable --now noxis-uptime.service 2>/dev/null || true
rm -f /etc/systemd/system/noxis-uptime.service
systemctl daemon-reload
if [[ "${1:-}" == "--purge" ]]; then
  rm -rf "$INSTALL_DIR"; userdel noxis 2>/dev/null || true
  echo "Noxis Uptime removido por completo, inclusive os dados."
else
  rm -rf "$INSTALL_DIR/src" "$INSTALL_DIR/app.js" "$INSTALL_DIR/node_modules"
  echo "Serviço removido. Dados mantidos em $INSTALL_DIR/storage e $INSTALL_DIR/.env."
fi
