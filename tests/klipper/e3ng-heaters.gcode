; PID tuning can't finish in batch mode (the heaters never warm up, so Klipper reports
; "pid_calibrate interrupted"). This only checks the macros expand and send the right commands.
G28
PID_HOTEND
PID_BED TEMP=65
