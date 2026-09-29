#!/usr/bin/env bash
# Local OctoPrint sandbox for working on the MakerForge UI.
#
# It runs a real OctoPrint with its *virtual printer*, so nothing here can ever touch real
# hardware. Everything lives in $MF_SANDBOX (default ~/.makerforge-dev), outside this repo.
#
#   dev/dev-instance.sh setup     create the venv, install OctoPrint + this plugin, seed a test user
#   dev/dev-instance.sh start     run in the foreground on http://127.0.0.1:5055
#   dev/dev-instance.sh bg        run in the background (log: $MF_SANDBOX/octoprint.log)
#   dev/dev-instance.sh stop      stop the background instance
#   dev/dev-instance.sh sample    copy the sample G-code files into the sandbox
#
# The test account below only exists inside the sandbox.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${MF_SANDBOX:-$HOME/.makerforge-dev}"
VENV="$SANDBOX/octo-venv"
BASE="$SANDBOX/octo-base"
# macOS uses port 5000 for the AirPlay receiver, which answers with random 403s, so avoid it
PORT="${MF_PORT:-5055}"
DEV_USER="dev"
DEV_PASS="forge-dev-only-1"

need_sandbox() {
  [ -x "$VENV/bin/octoprint" ] || { echo "No sandbox in $SANDBOX yet. Run: dev/dev-instance.sh setup  (or point MF_SANDBOX at an existing one)" >&2; exit 1; }
}
octo() { "$VENV/bin/octoprint" --basedir "$BASE" "$@"; }

write_config() {
  mkdir -p "$BASE"
  if [ ! -f "$BASE/config.yaml" ]; then
    cat > "$BASE/config.yaml" <<EOF
server:
  host: 127.0.0.1
  port: $PORT
  firstRun: false
  onlineCheck:
    enabled: false
  pluginBlacklist:
    enabled: false
  seenWizards:
    backup: null
    corewizard: 4
    tracking: null
plugins:
  virtual_printer:
    enabled: true
  tracking:
    enabled: false
    unique_id: dev
  _disabled:
  - softwareupdate
  - announcements
serial:
  autoconnect: false
EOF
  fi
}

case "${1:-}" in
  setup)
    mkdir -p "$SANDBOX"
    [ -d "$VENV" ] || python3 -m venv "$VENV"
    "$VENV/bin/python" -m pip install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet octoprint
    "$VENV/bin/pip" install --quiet -e "$ROOT"
    write_config
    if [ ! -f "$BASE/users.yaml" ]; then
      octo user add "$DEV_USER" --admin --password "$DEV_PASS" >/dev/null 2>&1 || true
    fi
    echo "Sandbox ready in $SANDBOX  (user: $DEV_USER)"
    ;;
  start)
    need_sandbox
    write_config
    exec "$VENV/bin/octoprint" serve --basedir "$BASE" --host 127.0.0.1 --port "$PORT"
    ;;
  bg)
    need_sandbox
    write_config
    nohup "$VENV/bin/octoprint" serve --basedir "$BASE" --host 127.0.0.1 --port "$PORT" \
      > "$SANDBOX/octoprint.log" 2>&1 &
    echo $! > "$SANDBOX/octoprint.pid"
    echo "OctoPrint starting on http://127.0.0.1:$PORT (pid $(cat "$SANDBOX/octoprint.pid"))"
    ;;
  stop)
    # the pid file can be stale (a server started with `start`, or one that re-spawned), so also
    # stop anything serving this sandbox's basedir
    if [ -f "$SANDBOX/octoprint.pid" ]; then
      kill "$(cat "$SANDBOX/octoprint.pid")" 2>/dev/null || true
      rm -f "$SANDBOX/octoprint.pid"
    fi
    pkill -f "octoprint serve --basedir $BASE" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -f "octoprint serve --basedir $BASE" >/dev/null || break; sleep 1; done
    echo "stopped"
    ;;
  sample)
    mkdir -p "$BASE/uploads"
    cp "$ROOT"/dev/samples/*.gcode "$BASE/uploads/" 2>/dev/null || echo "no samples yet"
    ;;
  *)
    sed -n '2,15p' "$0"
    ;;
esac
