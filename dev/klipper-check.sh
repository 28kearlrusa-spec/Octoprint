#!/usr/bin/env bash
# Run the E3NG Klipper config and every macro through Klipper itself, in batch mode.
#
#   dev/klipper-check.sh <klipper source dir> <klipper.dict for the Creality 4.2.2 build>
#
# Klipper parses the whole config, expands every macro and plans every move exactly as it
# would on the printer, then writes what it would have sent to the board. Any config error,
# template error, unknown command or out-of-range move fails the run.
#
# The Pi's ADXL345 lives on a second MCU (the Pi itself). Its dictionary can only be built on
# Linux, so here the accelerometer is moved onto the board's SPI bus: same sections, same
# commands, only the bus differs.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
klipper="${1:?klipper source dir}"
dict="${2:?klipper.dict}"
python="${KLIPPY_PYTHON:-python3}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$here"/klipper/*.cfg "$work"/
sed -i.bak \
  -e 's|^\[mcu rpi\]|[mcu_unused_rpi]|' -e 's|^serial: /tmp/klipper_host_mcu|# serial: /tmp/klipper_host_mcu|' \
  -e 's|^cs_pin: rpi:None|cs_pin: PB12|' -e 's|^spi_bus: spidev0.0|spi_bus: spi2|' \
  "$work/adxl.cfg"
sed -i.bak -e '/^\[mcu_unused_rpi\]/d' "$work/adxl.cfg"
sed -i.bak -e "s|^z_offset: 0$|z_offset: 2.1|" \
  -e "s|^adaptive_margin: 5$|adaptive_margin: 5\\nzero_reference_position: 117.5, 117.5|" \
  "$work/printer.cfg"
# z_offset: as if PROBE_Z_OFFSET had run. zero_reference_position: in batch mode every probe
# "triggers" at once, so the mesh comes out as one big offset; this makes it flat.

# a second copy with the optional Stealthburner LEDs switched on
sed -e 's|^\[include adxl.cfg\]|[include adxl.cfg]\n[include leds.cfg]|' "$work/printer.cfg" > "$work/printer-leds.cfg"

status=0
bad='^(Error|Internal error)|!! |Unknown command|Error evaluating|Must home|Move out of range|Config error'
for cfg in printer printer-leds; do
for gcode in "$here"/tests/klipper/*.gcode; do
  name="$(basename "$gcode" .gcode)"
  [ "$cfg" = printer ] || name="$name+leds"
  log="$work/$name.log"
  rc=0
  "$python" "$klipper/klippy/klippy.py" "$work/$cfg.cfg" -i "$gcode" \
    -o "$work/$name.serial" -v -d "$dict" -l "$log" >/dev/null 2>&1 || rc=$?
  # Klippy keeps going after a failed command in batch mode, so the log is what counts. (Off
  # a Raspberry Pi it can't read /proc and logs that as tracebacks before starting: skip those.)
  problems="$(sed '/^Args:/,$!d' "$log" | grep -n -E "$bad|^Traceback" | head -40 || true)"
  # heater tests never finish (nothing heats in batch mode): only errors count there
  finished=1
  case "$name" in *-heaters*) rc=0 ;; *) grep -q "^Exiting (print time" "$log" || finished=0 ;; esac
  if [ "$rc" != 0 ] || [ -n "$problems" ] || [ "$finished" = 0 ]; then
    echo "FAILED: $name" >&2
    [ -n "$problems" ] && echo "$problems" >&2
    [ "$finished" = 1 ] || { echo "  (stopped before the end of the file)" >&2; tail -5 "$log" >&2; }
    status=1
  else
    echo "OK: $name ($(wc -c < "$work/$name.serial" | tr -d ' ') bytes sent to the board)"
  fi
  [ "${KEEP:-}" = 1 ] && cp "$log" "$here/klippy-$name.log"
done
done
exit "$status"
