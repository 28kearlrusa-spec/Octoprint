# Slicer settings for the MakerPrint E3NG

These match `printer.cfg` and `macros.cfg`. They start sensible; tune them after the calibration steps in [README.md](README.md). Speeds are capped by two things: the standalone TMC2208 motors (find your limit with `SPEED_TEST`) and the Volcano on the stock 40 W heater (about **15 mm³/s of PLA**).

## Printer

| Setting | Value |
| --- | --- |
| Bed shape | 0,0 to **229 × 230** mm (what the nozzle can reach with the Stealthburner; the plate is 235) |
| Max print height | 240 mm |
| G-code flavour | **Klipper** (Orca), **Klipper** / Marlin 2 (Prusa), Marlin 2 (Cura) |
| Nozzle | 0.4 mm |
| Retraction | 0.6 mm at 45 mm/s, no extra restart, wipe on |
| Z hop | 0.2 mm, "spiral" in Orca, only above 0.4 mm |
| Use relative E distances | on (the macros send `M83`) |
| Label objects / Exclude objects | **on**: adaptive mesh, adaptive purge and cancelling one object all use it |
| Arc fitting | off (Klipper smooths fine without it) |
| Thumbnails | 300×300 PNG (MakerPrint shows them) |

### Start G-code

OrcaSlicer and PrusaSlicer:
```
START_PRINT BED=[first_layer_bed_temperature] EXTRUDER=[first_layer_temperature] MATERIAL=[filament_type]
```
Cura:
```
START_PRINT BED={material_bed_temperature_layer_0} EXTRUDER={material_print_temperature_layer_0} MATERIAL={material_type}
```
Do **not** add `M190`/`M109` or a purge line of your own: `START_PRINT` heats, homes, meshes only where the print goes, then purges beside it.

### End G-code (all slicers)
```
END_PRINT
```

### Before layer change (Orca / Prusa, optional)
```
;LAYER:[layer_num]
```

## Speeds and acceleration

Pick the column that matches the `PRINT_MODE` you use (MakerPrint has buttons for it).

| | Quiet (night) | Normal | Fast |
| --- | --- | --- | --- |
| Outer wall | 60 mm/s | 120 | 150 |
| Inner wall | 100 | 200 | 250 |
| Sparse infill | 120 | 250 | 300 |
| Top / bottom solid | 80 | 150 | 200 |
| First layer | 30 | 40 | 50 |
| Travel | 150 | 300 | 300 |
| Outer wall accel | 1500 | 3000 | 4000 |
| Default accel | 2500 | input shaper's suggested max (start 5000) | same |
| Max volumetric speed | 15 mm³/s PLA, 12 PETG, 8 TPU | | |

The volumetric cap is what keeps prints perfect at high speed: the slicer slows any move the Volcano can't melt fast enough for.

## Filaments

| | Nozzle | Bed (CryoGrip) | Fan | Pressure advance |
| --- | --- | --- | --- | --- |
| PLA | 210 (first layer 215) | 55-60 | 100% from layer 3 | 0.06 |
| PETG | 235 (first layer 240) | 70-75 | 30-50% | 0.09 |
| TPU | 225 | 40-45 | 50% | 0.20, and print at 25 mm/s |
| ABS / ASA | 240 | 100 | 0-20% | 0.07 (needs an enclosure) |

- Leave **pressure advance off in the slicer**: `START_PRINT` sets it from `MATERIAL=` using the table at the top of `macros.cfg`. After `PA_CALIBRATE`, update that table.
- Keep nozzle temperatures at **240 °C or below**: the stock hotend has a PTFE liner.
- The CryoGrip plate is a frosty PEI-style surface: no glue for PLA/PETG. For PETG use a thin layer of glue stick as a release agent so it doesn't bond too hard.

## OrcaSlicer quick setup

1. *Add printer* → *Custom printer*, set the bed shape and height above, flavour **Klipper**, nozzle 0.4.
2. Paste the start and end G-code into *Printer settings → Machine G-code*.
3. *Printer settings → Motion ability*: max speed X/Y 300, max acceleration X/Y 6000 (or the input shaper result).
4. In the process profile, set the speeds and accelerations for your mode, and turn on *Others → Exclude objects*.
5. In each filament profile set *Max volumetric speed*, the temperatures above, and leave *Pressure advance* unticked.
