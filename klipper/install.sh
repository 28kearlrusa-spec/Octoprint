#!/usr/bin/env bash
# MakerPrint E3NG: set up Klipper on the Raspberry Pi next to OctoPrint.
#
# Run on the Pi (over SSH), from a copy of this repository:
#
#   git clone https://github.com/28kearlrusa-spec/Octoprint.git ~/makerprint
#   bash ~/makerprint/klipper/install.sh
#
# It is safe to run again: it updates the config, keeps your calibration (the SAVE_CONFIG
# block at the end of printer.cfg) and backs up anything it replaces.
#
# What it does:
#   1. installs Klipper (only if it isn't installed yet), in the same layout KIAUH uses
#   2. installs numpy, so the ADXL345 can measure resonances
#   3. copies printer.cfg, macros.cfg, calibration.cfg and adxl.cfg into the config folder,
#      and fills in the board's USB port when it's plugged in
#   4. turns on SPI and sets the Pi up as a second Klipper MCU (for the ADXL345)
#   5. builds klipper.bin for the Creality 4.2.2 board, for you to flash from an SD card
#   6. points OctoPrint and OctoKlipper at Klipper, and sets OctoPrint's pause / resume /
#      cancel scripts to the Klipper macros
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KLIPPER_DIR="${KLIPPER_DIR:-$HOME/klipper}"
KLIPPY_ENV="${KLIPPY_ENV:-$HOME/klippy-env}"
DATA="${PRINTER_DATA:-$HOME/printer_data}"
STAMP="$(date +%Y%m%d-%H%M%S)"

say()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!  %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mxx  %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" != 0 ] || die "Run this as your normal user (pi), not with sudo. It asks for sudo when it needs it."
command -v sudo >/dev/null || die "sudo is needed."

# ~~ 1. packages and Klipper ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
say "Installing packages (this can take a few minutes the first time)"
sudo apt-get update -qq
sudo apt-get install -y -qq git python3-venv python3-dev libffi-dev build-essential \
  libncurses-dev libusb-dev stm32flash gcc-arm-none-eabi binutils-arm-none-eabi \
  libnewlib-arm-none-eabi libopenblas-dev python3-numpy >/dev/null

klipper_service_exists() { systemctl list-unit-files 2>/dev/null | grep -q '^klipper\.service'; }

if [ ! -d "$KLIPPER_DIR/.git" ]; then
  say "Downloading Klipper"
  git clone -q https://github.com/Klipper3d/klipper.git "$KLIPPER_DIR"
fi
if [ ! -x "$KLIPPY_ENV/bin/python" ]; then
  say "Creating Klipper's Python environment"
  python3 -m venv "$KLIPPY_ENV"
  "$KLIPPY_ENV/bin/pip" install -q --upgrade pip
  "$KLIPPY_ENV/bin/pip" install -q -r "$KLIPPER_DIR/scripts/klippy-requirements.txt"
fi
say "Installing numpy for input shaper calibration"
"$KLIPPY_ENV/bin/pip" install -q numpy || warn "numpy didn't install. SHAPER_CALIBRATE needs it: $KLIPPY_ENV/bin/pip install numpy"

mkdir -p "$DATA/config" "$DATA/logs" "$DATA/comms" "$DATA/gcodes" "$DATA/systemd"

if ! klipper_service_exists; then
  say "Creating the Klipper service"
  cat > "$DATA/systemd/klipper.env" <<EOF
KLIPPER_ARGS="$KLIPPER_DIR/klippy/klippy.py $DATA/config/printer.cfg -I $DATA/comms/klippy.serial -l $DATA/logs/klippy.log -a $DATA/comms/klippy.sock"
EOF
  sudo tee /etc/systemd/system/klipper.service >/dev/null <<EOF
[Unit]
Description=Klipper 3D printer firmware
Documentation=https://www.klipper3d.org/
After=network-online.target
Wants=udev.target

[Install]
WantedBy=multi-user.target

[Service]
Type=simple
User=$USER
RemainAfterExit=yes
WorkingDirectory=$KLIPPER_DIR
EnvironmentFile=$DATA/systemd/klipper.env
ExecStart=$KLIPPY_ENV/bin/python \$KLIPPER_ARGS
Restart=always
RestartSec=10
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable -q klipper
fi

# Where this Klipper reads printer.cfg and where its serial link for OctoPrint is
service_args="$( (cat "$DATA/systemd/klipper.env" 2>/dev/null; cat /etc/default/klipper 2>/dev/null; systemctl cat klipper 2>/dev/null) | tr ' "' '\n\n')"
CFG_FILE="$(printf '%s\n' "$service_args" | grep -m1 'printer\.cfg$' || true)"
CFG_FILE="${CFG_FILE:-$DATA/config/printer.cfg}"
CFG_DIR="$(dirname "$CFG_FILE")"
SERIAL_LINK="$(printf '%s\n' "$service_args" | grep -A1 -m1 '^-I$' | tail -1 || true)"
[ -n "$SERIAL_LINK" ] && [ "$SERIAL_LINK" != "-I" ] || SERIAL_LINK="/tmp/printer"
LOG_FILE="$(printf '%s\n' "$service_args" | grep -A1 -m1 '^-l$' | tail -1 || true)"
[ -n "$LOG_FILE" ] && [ "$LOG_FILE" != "-l" ] || LOG_FILE="/tmp/klippy.log"
say "Klipper config: $CFG_FILE   OctoPrint port: $SERIAL_LINK"
mkdir -p "$CFG_DIR"

# ~~ 3. config files ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
say "Installing the E3NG config"
backup() { [ -f "$1" ] && ! cmp -s "$1" "$2" && cp "$1" "$1.bak-$STAMP" && echo "   backed up $(basename "$1") to $(basename "$1").bak-$STAMP"; true; }
for f in macros.cfg calibration.cfg adxl.cfg; do
  backup "$CFG_DIR/$f" "$HERE/$f"
  cp "$HERE/$f" "$CFG_DIR/$f"
done

new_cfg="$(mktemp)"
cp "$HERE/printer.cfg" "$new_cfg"
# keep the board's port if it is plugged in (or was set before)
port=""
if [ -f "$CFG_FILE" ]; then
  port="$(awk '/^\[mcu\]/{m=1;next} /^\[/{m=0} m && /^serial:/{print $2; exit}' "$CFG_FILE")"
fi
found="$(ls /dev/serial/by-id/* 2>/dev/null | grep -v -i 'adxl\|rp2040\|klipper_host' | head -1 || true)"
[ -n "$found" ] && port="$found"
if [ -n "$port" ]; then
  sed -i "0,/^serial: .*/s||serial: $port|" "$new_cfg"
  echo "   board port: $port"
else
  warn "The printer board isn't plugged in. Plug it in, then run this script again (or put the path from ls /dev/serial/by-id/ in [mcu] serial:)."
fi
# keep calibration from the old printer.cfg
if [ -f "$CFG_FILE" ] && grep -q '^#\*# <-* SAVE_CONFIG' "$CFG_FILE"; then
  printf '\n' >> "$new_cfg"
  sed -n '/^#\*# <-* SAVE_CONFIG/,$p' "$CFG_FILE" >> "$new_cfg"
  echo "   kept your saved calibration (PID, Z offset, mesh, input shaper)"
fi
backup "$CFG_FILE" "$new_cfg"
cp "$new_cfg" "$CFG_FILE"
rm -f "$new_cfg"

# ~~ 4. the Pi as a second MCU, for the ADXL345 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
say "Setting up the ADXL345 (SPI and the Pi's host MCU)"
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_spi 0 || warn "Couldn't turn SPI on. Do it in sudo raspi-config > Interface Options > SPI."
else
  warn "raspi-config not found: turn SPI on yourself (dtparam=spi=on in /boot/firmware/config.txt)."
fi
build_dir="$(mktemp -d)"
cp "$HERE/firmware/linux-host-mcu.config" "$build_dir/.config"
make -s -C "$KLIPPER_DIR" KCONFIG_CONFIG="$build_dir/.config" OUT="$build_dir/out/" olddefconfig >/dev/null
make -s -C "$KLIPPER_DIR" KCONFIG_CONFIG="$build_dir/.config" OUT="$build_dir/out/" -j"$(nproc)" >/dev/null
sudo systemctl stop klipper-mcu 2>/dev/null || true
sudo install -m 755 "$build_dir/out/klipper.elf" /usr/local/bin/klipper_mcu
sudo cp "$KLIPPER_DIR/scripts/klipper-mcu.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable -q --now klipper-mcu
rm -rf "$build_dir"

# ~~ 5. firmware for the Creality board ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
say "Building klipper.bin for the Creality 4.2.2 board"
build_dir="$(mktemp -d)"
cp "$HERE/firmware/creality-v4.2.2.config" "$build_dir/.config"
make -s -C "$KLIPPER_DIR" KCONFIG_CONFIG="$build_dir/.config" OUT="$build_dir/out/" olddefconfig >/dev/null
make -s -C "$KLIPPER_DIR" KCONFIG_CONFIG="$build_dir/.config" OUT="$build_dir/out/" -j"$(nproc)" >/dev/null
fw="$DATA/firmware-e3ng-$STAMP.bin"
cp "$build_dir/out/klipper.bin" "$fw"
rm -rf "$build_dir"
echo "   $fw"

# ~~ 6. OctoPrint and OctoKlipper ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
OCTO="$(command -v octoprint || true)"
[ -n "$OCTO" ] || OCTO="$(ls "$HOME"/oprint/bin/octoprint "$HOME"/OctoPrint/venv/bin/octoprint 2>/dev/null | head -1 || true)"
if [ -n "$OCTO" ]; then
  say "Pointing OctoPrint at Klipper"
  set_cfg() { "$OCTO" config set "$@" >/dev/null 2>&1 || warn "couldn't set $1"; }
  set_cfg serial.port "$SERIAL_LINK"
  set_cfg serial.baudrate 250000 --int
  set_cfg serial.additionalPorts "[\"$SERIAL_LINK\"]" --json
  set_cfg serial.autoconnect true --bool
  set_cfg serial.disconnectOnErrors false --bool      # Klipper's "!!" errors are handled by Klipper
  set_cfg serial.firmwareDetection false --bool
  set_cfg serial.neverSendChecksum true --bool
  set_cfg serial.sdAlwaysAvailable false --bool
  set_cfg plugins.klipper.connection.port "$SERIAL_LINK"
  set_cfg plugins.klipper.configuration.config_path "$CFG_DIR"
  set_cfg plugins.klipper.configuration.baseconfig "$(basename "$CFG_FILE")"
  set_cfg plugins.klipper.configuration.logpath "$LOG_FILE"
  set_cfg plugins.klipper.configuration.reload_command "RESTART"
  # Bed Level Visualizer (if installed) draws Klipper's current mesh without re-probing
  if "$(dirname "$OCTO")/python" -c "import octoprint_bedlevelvisualizer" >/dev/null 2>&1; then
    set_cfg plugins.bedlevelvisualizer.command "@BEDLEVELVISUALIZER
BED_MESH_OUTPUT"
  fi

  # pause / resume / cancel from OctoPrint run the Klipper macros (park, retract, reheat)
  scripts="$("$OCTO" config get folder.scripts 2>/dev/null | tr -d "'\"" | tail -1 || true)"
  [ -n "$scripts" ] && [ "$scripts" != "None" ] || scripts="$HOME/.octoprint/scripts"
  mkdir -p "$scripts/gcode"
  for pair in "afterPrintPaused:PAUSE" "beforePrintResumed:RESUME" "afterPrintCancelled:CANCEL_PRINT"; do
    name="${pair%%:*}"; cmd="${pair#*:}"
    [ -f "$scripts/gcode/$name" ] && cp "$scripts/gcode/$name" "$scripts/gcode/$name.bak-$STAMP"
    printf '%s\n' "$cmd" > "$scripts/gcode/$name"
  done
  echo "   OctoPrint pause/resume/cancel scripts set to PAUSE / RESUME / CANCEL_PRINT"
else
  warn "OctoPrint wasn't found, so it wasn't configured. Set its serial port to $SERIAL_LINK yourself."
fi

say "Restarting Klipper and OctoPrint"
sudo systemctl restart klipper
sudo systemctl restart octoprint 2>/dev/null || warn "Restart OctoPrint yourself (Settings > Restart)."

cat <<EOF

$(printf '\033[1;32m')All set.$(printf '\033[0m') What's left:

  1. Flash the board (only once, and again only when you update Klipper):
       copy $fw
       to an SD card as  firmware-$STAMP.bin  (the name must differ from last time),
       put it in the printer, switch it on, wait 30 seconds, switch off, take the card out.
     From your computer:  scp $USER@$(hostname).local:$fw .

  2. Plug the printer's USB into the Pi and run this script once more (it finds the port).

  3. Open OctoPrint. MakerPrint connects to $SERIAL_LINK. Then follow klipper/README.md
     ("First power-on"), or run CALIBRATION_WIZARD from the Terminal.

EOF
