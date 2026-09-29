#!/usr/bin/env bash
# Drive the sandbox OctoPrint from the command line (connect the virtual printer, heat, print ...).
#   dev/fixture.sh connect            connect the virtual printer with a Voron-sized profile
#   dev/fixture.sh heat [nozzle bed]  heat up
#   dev/fixture.sh print <file>       select and start a print
#   dev/fixture.sh cancel | cool | disconnect | state
set -euo pipefail
HOST="${MF_HOST:-http://127.0.0.1:5055}"
JAR="$(mktemp)"; trap 'rm -f "$JAR"' EXIT
tok() { awk '$6 ~ /^csrf_token/ {print $7}' "$JAR" | head -1; }
curl -s -c "$JAR" -o /dev/null "$HOST/"
curl -s -b "$JAR" -c "$JAR" -H "X-CSRF-Token: $(tok)" -H "Content-Type: application/json" \
  -d '{"user":"dev","pass":"forge-dev-only-1"}' "$HOST/api/login" -o /dev/null
J() { curl -s -b "$JAR" -H "X-CSRF-Token: $(tok)" -H "Content-Type: application/json" "$@"; }
case "${1:-state}" in
  connect)
    J -X PATCH -d '{"profile":{"name":"Voron 2.4 350","model":"Voron 2.4r2","heatedChamber":true,"volume":{"width":350,"depth":350,"height":330,"origin":"lowerleft","formFactor":"rectangular"}}}' "$HOST/api/printerprofiles/_default" -o /dev/null
    J -d '{"command":"connect","port":"VIRTUAL","baudrate":115200,"printerProfile":"_default"}' "$HOST/api/connection" -o /dev/null -w "connect %{http_code}\n" ;;
  heat)
    J -d "{\"command\":\"target\",\"targets\":{\"tool0\":${2:-215}}}" "$HOST/api/printer/tool" -o /dev/null
    J -d "{\"command\":\"target\",\"target\":${3:-60}}" "$HOST/api/printer/bed" -o /dev/null
    J -d '{"command":"target","target":40}' "$HOST/api/printer/chamber" -o /dev/null; echo heating ;;
  print) J -d '{"command":"select","print":true}' "$HOST/api/files/local/${2:?file}" -o /dev/null -w "print %{http_code}\n" ;;
  cancel) J -d '{"command":"cancel"}' "$HOST/api/job" -o /dev/null -w "cancel %{http_code}\n" ;;
  cool)
    J -d '{"command":"target","targets":{"tool0":0}}' "$HOST/api/printer/tool" -o /dev/null
    J -d '{"command":"target","target":0}' "$HOST/api/printer/bed" -o /dev/null
    J -d '{"command":"target","target":0}' "$HOST/api/printer/chamber" -o /dev/null; echo cooling ;;
  disconnect) J -d '{"command":"disconnect"}' "$HOST/api/connection" -o /dev/null -w "disconnect %{http_code}\n" ;;
  state) J "$HOST/api/job" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['state'], d['progress'])" ;;
esac
