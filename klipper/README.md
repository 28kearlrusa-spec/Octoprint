# Klipper for the MakerPrint E3NG

Klipper config for an **Ender 3 NG (CoreXY)** running on the **stock Creality 4.2.2 "silent" board**, with a BLTouch, a Volcano hotend on the stock heater and thermistor, a Voron Stealthburner shroud for Ender printers, a CryoGrip bed and an ADXL345 on the Raspberry Pi. It works with OctoPrint, OctoKlipper and the MakerPrint UI: every macro here has a button in the UI.

| File | What it is |
| --- | --- |
| `printer.cfg` | The machine: pins, motion, heaters, probe, mesh, input shaper |
| `macros.cfg` | `START_PRINT`, `END_PRINT`, pause / resume / cancel, `M600`, load / unload, park, print modes |
| `calibration.cfg` | Every calibration as a macro, plus `CALIBRATION_WIZARD`, which shows them all as buttons |
| `adxl.cfg` | The ADXL345 on the Pi's SPI pins, for measuring resonances |
| `leds.cfg` | Optional Stealthburner LEDs on the stock screen connector, with status colours |
| `SLICER.md` | Slicer settings (OrcaSlicer, PrusaSlicer, Cura) that match this config |
| `install.sh` | Sets up the Pi: Klipper, the config, the ADXL345, the board firmware, OctoPrint's settings |
| `firmware/klipper.bin` | Firmware for the board, built from Klipper master on 9 Oct 2026 (`install.sh` builds a fresh one that matches your Pi's Klipper) |
| `prints/` | Klipper's ringing tower and pressure-advance tower test models |

Everything here has been run through Klipper's own code in batch mode: the config loads, and every macro runs and plans its moves (`dev/klipper-check.sh`).

## Install

1. On the Pi, over SSH:
   ```bash
   git clone https://github.com/28kearlrusa-spec/Octoprint.git ~/makerprint
   bash ~/makerprint/klipper/install.sh
   ```
2. **Flash the board.** The script prints where it put `firmware-e3ng-….bin`. Copy that file to a FAT32 SD card (8 GB or smaller works best), with a name the board hasn't seen before, such as `firmware-0901.bin`. Put the card in the printer, switch it on, wait 30 seconds, switch it off and take the card out. The screen stays blank from now on: Klipper doesn't drive the Ender 3 V2's stock display, and the MakerPrint UI takes its place.
3. Plug the printer's USB cable into the Pi and **run `install.sh` once more**. It finds the board's port and puts it in `printer.cfg`.
4. Open OctoPrint. MakerPrint connects by itself. If it doesn't, press **Connect** and pick the Klipper port (`/home/pi/printer_data/comms/klippy.serial` with this install, or `/tmp/printer` with an older one).

Not sure which chip your board has? It doesn't matter. The STM32F103 build runs on the GD32F303 chip that later 4.2.2 boards have.

## First power-on: the checks only your printer can answer

Lines marked `>>> CHECK` in `printer.cfg` are these. Go in this order. `CALIBRATION_WIZARD` (Terminal, or the Macros panel) shows the same steps as buttons.

1. **Endstops.** Yours are confirmed: X is the microswitch on the carriage (wired COM + NC) and homes right, Y sits on the back XY joint and homes back. Send `QUERY_ENDSTOPS` with nothing pressed (both `open`), then hold each switch and send it again (that one `TRIGGERED`). If one reads backwards, its wires are on COM + NO: move the wire to NC.
2. **Motor directions:** `DIRECTION_TEST`. Move the head to the middle by hand first. It moves without homing, so keep a hand on the power switch. CoreXY fixes:
   - X+ goes left: invert both `dir_pin`s (add or remove the `!`)
   - X+ goes towards the back: invert `stepper_y`'s `dir_pin`
   - X+ goes towards the front: invert `stepper_x`'s `dir_pin`
   - X is right but Y+ goes to the front: swap the X and Y motor plugs on the board
   - Z goes the wrong way: invert `stepper_z`'s `dir_pin`
3. **Z distance:** `Z_CHECK` moves Z up 20 mm. If it moves ~9.5 mm, your lead screw is driven directly: delete `gear_ratio: 42:20` from `[stepper_z]`. If it moves 20 mm, leave it alone.
4. **Probe offsets.** Put a mark on the bed under the nozzle, move the head until the BLTouch pin is over the mark, and compare the two positions (`GET_POSITION`). `x_offset` = probe X − nozzle X, `y_offset` = probe Y − nozzle Y. The config starts with the E3NG Stealthburner mount's `0, -18`. If you change them, update `home_xy_position` in `[safe_z_home]` to (117.5 − x_offset, 117.5 − y_offset).
5. **Heaters:** `PID_HOTEND` (220°, part fan at 25%), then `PID_BED` (60°). Press **Save config** after each one.
6. **Probe:** `PROBE_CHECK` probes the middle 10 times. The range should be under 0.02 mm. If it isn't, set `probe_with_touch_mode: False` in `[bltouch]` (clone BLTouches need that) and try again.
7. **Z offset: the paper test.** `PROBE_Z_OFFSET` heats the bed and nozzle and opens the paper test. **Your Volcano is longer than the stock nozzle, so this one matters.** `START_PRINT` refuses to run until it's done. Accept, then **Save config**.
8. **Bed screws:** `BED_SCREWS` tells you how far to turn each screw (for example `CW 00:15` = a quarter turn clockwise). Repeat until every screw says under `00:05`. A CryoGrip plate is magnetic, so probe with it on.
9. **Extruder:** mark the filament 120 mm above the extruder, run `EXTRUDER_CALIBRATE`, measure what's left and send `EXTRUDER_RESULT LEFT=<mm>`. It prints the corrected `rotation_distance` for `[extruder]`. The config assumes the stock Ender extruder (34.406). If your Stealthburner holds a Clockwork 2, use `rotation_distance: 22.6789511` with `gear_ratio: 50:10` instead.
10. **Vibration compensation:** see below.
11. **Pressure advance:** run `PA_CALIBRATE`, then print `prints/square_tower.stl` at 100 mm/s with 0.2 mm layers. Measure the height (mm) where the corners look sharpest. PA = height × 0.005. Put it in the `pa` table in `_MP` at the top of `macros.cfg`, by material.
12. **Speed:** `SPEED_TEST` (see "Fast and quiet").

## Vibration compensation (what Bambu calls it)

Bambu's "vibration compensation" is input shaping, and Klipper has the same thing.

**With the ADXL345 (you have one):** mount it firmly on the toolhead, then run `INPUT_SHAPER_AUTO`. It checks the sensor (`ACCELEROMETER_QUERY`, `MEASURE_AXES_NOISE`), shakes each axis through 5–133 Hz, picks the best shaper per axis and prints the highest acceleration that won't smooth corners. The Tune page shows the result with a ready-made `[input_shaper]` block. Press **Save config**, then set `max_accel` in `[printer]` to the lower of the two suggested values.

Wiring (ADXL345 → Pi header): GND → pin 6, 3V3 → pin 1, CS → pin 24, SDO → pin 21, SDA → pin 19, SCL → pin 23. Twisted or shielded wire under 1 m. If `ACCELEROMETER_QUERY` says "Invalid adxl345 id", check SDO and SDA.

**Without it:** `RINGING_TOWER`, then print `prints/ringing_tower.stl` (one wall, 0.2 mm layers, 80 mm/s, no cooling slow-down). [Klipper's guide](https://www.klipper3d.org/Resonance_Compensation.html) shows how to read the result.

## Motor noise cancellation: what's possible on this board

Bambu's motor noise cancellation measures each motor's electrical behaviour and tunes its driver to match. That needs drivers the firmware can talk to. **The 4.2.2 board's TMC2208s are wired in standalone mode** (no UART), so Klipper can't read or tune them. No firmware can do it on this board. What you already have, and what helps:

- **stealthChop is always on.** That's why the board is "silent": it's the quietest mode those drivers have. The 2208s also interpolate the 16 microsteps to 256 by themselves.
- **Input shaping** (above) removes most of the ringing hum at speed.
- `PRINT_MODE MODE=quiet` caps speed at 150 mm/s and acceleration at 2500 for overnight prints. `MODE=normal` is the config's limits, and `MODE=fast` is the same with crisper corners. The UI has buttons for all three.
- **NEMA17 vibration dampers** on the X/Y motors and soft feet under the frame take out most of the remaining buzz for a few dollars.
- **The real upgrade, if you ever want it:** a BTT SKR Mini E3 V3 (same size and plugs as the 4.2.2) has TMC2209s on UART. Klipper can then tune each motor (`[tmc2209]` settings, or the [klipper_tmc_autotune](https://github.com/andrewmcgr/klipper_tmc_autotune) extension, which is the closest thing to Bambu's feature). It also gives you sensorless homing and more torque at speed.

## Fast and quiet: realistic numbers

Standalone TMC2208s in stealthChop lose torque quickly above ~250 mm/s, and on CoreXY a skipped step shifts the whole layer. `printer.cfg` starts at 300 mm/s and 6000 mm/s². Find your machine's real limit:

1. `SPEED_TEST` runs fast diagonals, then re-homes and prints the motor positions before and after. If `stepper_x` or `stepper_y` moved more than about 16 steps, that speed skips.
2. Try `SPEED_TEST SPEED=350 ACCEL=8000`, then lower values, until it's clean. Keep 20% below the first failing speed. Put the result in `[printer]`.

The other limit is the hotend: a Volcano on the stock 40 W heater melts about **15 mm³/s of PLA** reliably. Set **max volumetric speed to 15 mm³/s** in the slicer (12 for PETG) and let it slow the moves down when needed. Good starting slicer settings for a 0.4 mm nozzle:

| | |
| --- | --- |
| Layer height | 0.2–0.28 mm (the Volcano likes thick layers) |
| Outer wall / inner wall / infill | 120 / 200 / 250 mm/s |
| Travel | 300 mm/s |
| Acceleration | outer wall 3000, everything else the shaper's suggested max |
| Max volumetric speed | 15 mm³/s PLA, 12 PETG |
| Retraction | 0.6 mm at 45 mm/s (or "use firmware retraction") |
| Start G-code | `START_PRINT BED=[first_layer_bed_temperature] EXTRUDER=[first_layer_temperature] MATERIAL=[filament_type]` |
| End G-code | `END_PRINT` |
| Label objects | on (adaptive mesh, adaptive purge and cancel object use it) |

## Temperature limits

The stock Ender 3 V2 hotend has a PTFE tube down to the nozzle, and PTFE gives off fumes above about 240 °C. `max_temp` is 250 and the MakerPrint material presets stay at 240 or below. With an all-metal heat break you can raise `max_temp` to 285.

## Your OctoPrint plugins with Klipper

| Plugin | With Klipper |
| --- | --- |
| **BLTouch Plugin** | **Turn it off.** Its buttons send Marlin commands (`M280`, `M401`) that Klipper ignores. The same buttons are in MakerPrint under Macros > BLTouch, using Klipper's `BLTOUCH_DEBUG`. |
| **Power Failure Recovery** | **Turn it off, or test it before trusting it.** It was written for Marlin: to resume it re-homes and replays the file, and on this printer homing Z puts the probe down in the middle of the print. Klipper also forgets its position on power loss. |
| **Cancel Objects** | Works, but Klipper's own object cancelling (`[exclude_object]`, already on, with "Label objects" in the slicer) is more reliable. Keep Cancel Objects for now: its panel is on MakerPrint's Print page. To use Klipper's instead, send `EXCLUDE_OBJECT NAME=<object>` from the Terminal (`EXCLUDE_OBJECT_STATUS` lists the names). |
| **OctoKlipper** | Needed. `install.sh` points it at Klipper's port, config folder and log. Its Klipper page is on MakerPrint's Tune page. |
| **TP-Link Smartplug** | Handy as the printer's power switch (its button is in MakerPrint's top bar). After switching the printer on, MakerPrint reconnects. If Klipper says `mcu 'mcu': Unable to connect`, press Firmware restart. |
| **Firmware Check, File Check** | Fine to keep. |
| **PrintTimeGenius, Cost Estimation, Print History, Slicer Thumbnails, Resource Monitor, WiFi Status** | Fine. They show up on the Files, Print and top-bar spots in MakerPrint. |

## OctoPrint settings `install.sh` makes

- Serial port: Klipper's link (`klippy.serial` or `/tmp/printer`), 250000 baud, autoconnect, no firmware detection, and no disconnecting on errors (Klipper handles its own).
- OctoPrint's pause / resume / cancel scripts call `PAUSE`, `RESUME` and `CANCEL_PRINT`, so pausing from anywhere parks the head, and resuming reheats and returns. Filament changes (`M600` in the G-code, or the button) pause OctoPrint by themselves.
- OctoKlipper's port, config folder and log file.

## When something goes wrong

| Message | Cause |
| --- | --- |
| `mcu 'mcu': Unable to connect` | Wrong `serial:` path, or the board isn't flashed. `ls /dev/serial/by-id/`. |
| `mcu 'rpi': Unable to connect` | `klipper-mcu` service isn't running: `sudo systemctl status klipper-mcu` |
| `Invalid adxl345 id` | SPI off (`sudo raspi-config` > Interface Options > SPI) or a wiring mistake |
| `Heater extruder not heating at expected rate` | The Volcano block heats slower than stock. Run `PID_HOTEND`; if it still happens, raise `check_gain_time` in `[verify_heater extruder]` to 40 |
| `The probe's Z offset hasn't been calibrated yet` | Run `PROBE_Z_OFFSET`, then **Save config** |
| `Probe samples exceed samples_tolerance` | Clone BLTouch: set `probe_with_touch_mode: False` |
| `Move out of range` while probing | The probe offsets or `mesh_max` put the probe off the bed. Check step 4 |
| Layer shifts | Too fast for standalone 2208s. Run `SPEED_TEST` and lower `max_velocity` / `max_accel` |

## Testing the config without a printer

```bash
dev/klipper-check.sh <klipper source> <klipper.dict from the 4.2.2 build>
```

This runs `tests/klipper/*.gcode` through Klipper in batch mode. That's every macro, a whole print with labelled objects, pause, `M600`, resume and cancel, and every calibration macro. Any config, template or range error fails it.
