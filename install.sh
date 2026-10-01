#!/bin/sh
# Install (or remove) flowiq-cam2mqtt as a systemd service running from this
# directory as the current user. Run as that user, not as root: sudo is only
# used for the steps that need it (the unit file and systemctl).
#
#   ./install.sh              install / update and (re)start
#   ./install.sh uninstall    stop, disable and remove the service
set -eu

NAME=flowiq-cam2mqtt
UNIT=/etc/systemd/system/$NAME.service
DIR=$(cd "$(dirname "$0")" && pwd)
SERVICE_USER=$(id -un)

die() { echo "error: $*" >&2; exit 1; }
[ "$(id -u)" -ne 0 ] || die "run as the user the service should run as, not as root (sudo is used where needed)"

if [ "${1:-}" = uninstall ]; then
  sudo systemctl disable --now "$NAME" 2>/dev/null || true
  sudo rm -f "$UNIT"
  sudo systemctl daemon-reload
  echo "$NAME removed (files in $DIR left untouched)"
  exit 0
fi

[ -f "$DIR/.env" ] || die "$DIR/.env missing - copy .env.example and fill it in"
grep -q '^HA_TOKEN=.' "$DIR/.env" || die "HA_TOKEN is empty in .env"
grep -q '^MQTT_URL=.' "$DIR/.env" || echo "warning: MQTT_URL not set in .env - the service will only log readings (dry run)"

NODE=$(command -v node || true)
[ -n "$NODE" ] || die "node not found"
NODE_MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "node >= 20 required (found $("$NODE" -v))"

echo "installing dependencies..."
(cd "$DIR" && npm install --omit=dev --no-audit --no-fund --silent)

# The development loop (run.sh) would fight the service over the LED.
if ! systemctl is-active -q "$NAME"; then
  pkill -f '^([^ ]*/)?node src/cli\.js loop' 2>/dev/null && echo "stopped loop started by run.sh" || true
fi

sed -e "s|@USER@|$SERVICE_USER|" -e "s|@DIR@|$DIR|" -e "s|@NODE@|$NODE|" "$DIR/$NAME.service" |
  sudo tee "$UNIT" >/dev/null
sudo chmod 644 "$UNIT"
sudo systemctl daemon-reload
sudo systemctl enable "$NAME" >/dev/null
sudo systemctl restart "$NAME"

sleep 3
systemctl --no-pager --full --lines=5 status "$NAME" || true
echo
echo "installed $UNIT (user $SERVICE_USER, dir $DIR)"
echo "logs:    journalctl -u $NAME -f"
echo "control: sudo systemctl stop|start|restart $NAME"
