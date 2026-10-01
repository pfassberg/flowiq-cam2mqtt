#!/bin/sh
# Development helper: start/stop/status of the background reading loop
# (log: reader.log). In production use the systemd service (install.sh).
cd "$(dirname "$0")"
case "$1" in
  start)
    if systemctl is-active -q flowiq-cam2mqtt 2>/dev/null; then echo "the systemd service is running - use systemctl"; exit 1; fi
    if pgrep -f '^([^ ]*/)?node src/cli\.js loop' >/dev/null; then echo "already running"; exit 0; fi
    echo "--- start $(date -Is)" >> reader.log
    setsid nohup node src/cli.js loop >> reader.log 2>&1 < /dev/null &
    echo "started" ;;
  stop) pkill -f '^([^ ]*/)?node src/cli\.js loop' && echo "stopped" ;;
  restart) "$0" stop; sleep 1; "$0" start ;;
  *) pgrep -af '^([^ ]*/)?node src/cli\.js loop' || echo "not running"; tail -5 reader.log ;;
esac
