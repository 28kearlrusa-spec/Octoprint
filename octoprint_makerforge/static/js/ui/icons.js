// Icon set. 24x24 grid, 1.75px stroke, round joins. Printer-specific glyphs are custom.
// Names ending in "!" in the map below are filled shapes rather than outlines.

const S = {
  // ~~ navigation ~~
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  control: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
  "folder-plus": '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/><path d="M12 10.5v5M9.5 13h5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
  tune: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 005 5l-9.4 9.4a2.1 2.1 0 01-3-3l9.4-9.4a4 4 0 00-2-2z"/><path d="M14.7 6.3l2.6-2.6a4 4 0 00-3.9 1"/>',

  // ~~ transport / actions ~~
  "play!": '<path d="M7 4.6v14.8a.6.6 0 00.9.5l12-7.4a.6.6 0 000-1L7.9 4.1a.6.6 0 00-.9.5z"/>',
  "pause!": '<rect x="6" y="4" width="4.2" height="16" rx="1"/><rect x="13.8" y="4" width="4.2" height="16" rx="1"/>',
  "stop!": '<rect x="5" y="5" width="14" height="14" rx="1.6"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/>',
  power: '<path d="M12 3v9"/><path d="M6.3 6.3a8 8 0 1011.4 0"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  upload: '<path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  download: '<path d="M12 4v12"/><path d="M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  x: '<path d="M5 5l14 14M19 5L5 19"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4L3 5z"/>',
  sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M3 3l18 18"/><path d="M10.6 6.1A10 10 0 0112 5c6.4 0 10 7 10 7a17 17 0 01-3.1 4M6.6 6.7A17 17 0 002 12s3.6 7 10 7a10 10 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  logout: '<path d="M9 4H5a1 1 0 00-1 1v14a1 1 0 001 1h4"/><path d="M16 8l4 4-4 4M20 12H9"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5"/>',
  maximize: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  minimize: '<path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
  flame: '<path d="M12 3c.6 3.6 5 5.4 5 10a5 5 0 01-10 0c0-1.9.9-3.1 2-4.1.1 1.8.9 2.6 2 2.9C10.5 8.7 11 5.7 12 3z"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>',
  thermo: '<path d="M10 14.2V5a2 2 0 114 0v9.2a4 4 0 11-4 0z"/><path d="M12 9v7.5"/>',
  fan: '<circle cx="12" cy="12" r="1.6"/><path d="M12 10.4C10.6 7.4 10.8 4 13 3.2c2.2-.8 4 1.4 3 4.2-.5 1.5-1.8 2.5-3 3z"/><g transform="rotate(120 12 12)"><path d="M12 10.4C10.6 7.4 10.8 4 13 3.2c2.2-.8 4 1.4 3 4.2-.5 1.5-1.8 2.5-3 3z"/></g><g transform="rotate(240 12 12)"><path d="M12 10.4C10.6 7.4 10.8 4 13 3.2c2.2-.8 4 1.4 3 4.2-.5 1.5-1.8 2.5-3 3z"/></g>',
  gauge: '<path d="M4 18a9 9 0 1116 0"/><path d="M12 18l4-6"/><path d="M12 5v1.5M5.6 8l1.1 1M18.4 8l-1.1 1"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  history: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',

  // ~~ arrows ~~
  "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
  "arrow-down": '<path d="M12 5v14M6 13l6 6 6-6"/>',
  "arrow-left": '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "chev-up": '<path d="M6 15l6-6 6 6"/>',
  "chev-down": '<path d="M6 9l6 6 6-6"/>',
  "chev-left": '<path d="M15 6l-6 6 6 6"/>',
  "chev-right": '<path d="M9 6l6 6-6 6"/>',
  "chev-dbl-up": '<path d="M6 12l6-6 6 6M6 19l6-6 6 6"/>',
  "chev-dbl-down": '<path d="M6 5l6 6 6-6M6 12l6 6 6-6"/>',
  "rot-cw": '<path d="M20 12a8 8 0 11-2.6-5.9"/><path d="M20 4v5h-5"/>',
  "rot-ccw": '<path d="M4 12a8 8 0 102.6-5.9"/><path d="M4 4v5h5"/>',

  // ~~ status ~~
  alert: '<path d="M12 3.5l9.5 16.5h-19L12 3.5z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  octagon: '<path d="M8 3h8l5 5v8l-5 5H8l-5-5V8l5-5z"/><path d="M12 8v5M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 015 .8c0 1.7-2.5 2.2-2.5 3.7M12 17h.01"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4l2-2z"/><path d="M10 21h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.2 0 1.8-.9 1.8-1.7 0-.9-.6-1.3-.6-2.2 0-1 .8-1.6 1.8-1.6H17a4 4 0 004-4c0-4.4-4-8.5-9-8.5z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7" r="1"/>',
  wifi: '<path d="M2.5 9a15 15 0 0119 0M5.5 12.5a10.5 10.5 0 0113 0M8.7 16a5.5 5.5 0 016.6 0"/><path d="M12 19.5h.01"/>',
  "wifi-off": '<path d="M3 3l18 18"/><path d="M2.5 9a15 15 0 015-3M10 4.2A15 15 0 0121.5 9M5.5 12.5a10.5 10.5 0 013-2M14 9.5a10.5 10.5 0 014.5 3M8.7 16a5.5 5.5 0 013-1.3M14.5 15a5.5 5.5 0 011 .9"/><path d="M12 19.5h.01"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0V8z"/><path d="M12 17v4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  save: '<path d="M5 3h11l4 4v13a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
  file: '<path d="M6 3h8l5 5v12a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5"/>',
  "file-code": '<path d="M6 3h8l5 5v12a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5"/><path d="M10 13l-2 2 2 2M14 13l2 2-2 2"/>',
  "more-h": '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="2.6"/>',
  "more-v": '<path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="2.6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  drag: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="2.6"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8L12 3.5z"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  book: '<path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3V4z"/><path d="M5 17a3 3 0 013-3h10"/>',
  command: '<path d="M9 9V6a3 3 0 10-3 3h12a3 3 0 10-3-3v12a3 3 0 103-3H6a3 3 0 103 3V9z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  bug: '<path d="M9 7a3 3 0 016 0v1H9V7z"/><rect x="7" y="8" width="10" height="11" rx="5"/><path d="M12 8v11M3 12h4M17 12h4M4 6l3 2M20 6l-3 2M4 19l3-2M20 19l-3-2"/>',
  flask: '<path d="M9 3h6M10 3v6l-5.5 9.5A1.6 1.6 0 006 21h12a1.6 1.6 0 001.5-2.5L14 9V3"/><path d="M7.5 15h9"/>',
  scan: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M4 12h16"/>',
  "list-checks": '<path d="M9 6h12M9 12h12M9 18h12"/><path d="M3 6l1.5 1.5L7 5M3 12l1.5 1.5L7 11M3 18l1.5 1.5L7 17"/>',
  queue: '<rect x="3" y="4" width="14" height="5" rx="1"/><rect x="3" y="11" width="14" height="5" rx="1"/><path d="M3 19h9M19 12v8M16 17l3 3 3-3"/>',
  plugin: '<path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 01-10 0V7z"/><path d="M12 16v5"/>',
  spark: '<path d="M12 3v5.2M12 15.8V21M3 12h5.2M15.8 12H21M5.6 5.6l3.7 3.7M14.7 14.7l3.7 3.7M18.4 5.6l-3.7 3.7M9.3 14.7l-3.7 3.7"/>',

  // ~~ printer specific ~~
  nozzle: '<path d="M8 3h8v5H8z"/><path d="M9 8v3l3 5 3-5V8"/><path d="M12 16v2.5"/><path d="M9.5 21h5"/>',
  bed: '<path d="M3 15h18v3H3z"/><path d="M5 18v2.5M19 18v2.5"/><path d="M8 4c0 1.4 1 1.6 1 3s-1 1.6-1 3M12 4c0 1.4 1 1.6 1 3s-1 1.6-1 3M16 4c0 1.4 1 1.6 1 3s-1 1.6-1 3"/>',
  chamber: '<path d="M4 7l8-4 8 4v10l-8 4-8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>',
  extruder: '<circle cx="12" cy="12" r="3.4"/><path d="M12 8.6V6M12 18v-2.6M8.6 12H6M18 12h-2.6"/><path d="M3 20h6M15 20h6M12 20v-1.5"/>',
  spool: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  layers: '<path d="M12 3l9 4.8-9 4.8-9-4.8L12 3z"/><path d="M3 12.2l9 4.8 9-4.8"/><path d="M3 16.4l9 4.8 9-4.8"/>',
  toolhead: '<path d="M7 3h10v9l-2 2H9l-2-2V3z"/><path d="M12 14v4l-1.5 3h3L12 18"/><path d="M10 7h4"/>',
  probe: '<path d="M12 3v11"/><path d="M9 14h6l-3 6-3-6z"/><path d="M5 21h14"/>',
  qgl: '<path d="M4 6h16M4 18h16"/><path d="M6 6v12M18 6v12"/><path d="M6 10l12 4" stroke-dasharray="2 2"/><circle cx="6" cy="6" r="1.5"/><circle cx="18" cy="6" r="1.5"/><circle cx="6" cy="18" r="1.5"/><circle cx="18" cy="18" r="1.5"/>',
  mesh: '<path d="M3 8c3-3 6 1 9-1s6 1 9-1v12c-3 2-6-1-9 1s-6-1-9 1V8z"/><path d="M9 6.5v12M15 6v12M3 13c3-2 6 1 9-1s6 1 9-1"/>',
  waves: '<path d="M2 12c2-6 4-6 5 0s3 6 5 0 3-6 5 0 3 6 5 0"/>',
  ruler: '<rect x="3" y="8" width="18" height="8" rx="1.2" transform="rotate(-20 12 12)"/><path d="M7.4 11.5l1 2.7M10.6 10.3l1 2.7M13.8 9.1l1 2.7" transform="rotate(-20 12 12)"/>',
  led: '<circle cx="12" cy="11" r="4"/><path d="M12 2.5v2M4.5 6l1.5 1.5M19.5 6L18 7.5M3 12h2M19 12h2"/><path d="M9.5 18h5M10.5 21h3"/>',
  light: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z"/>',
  flow: '<path d="M12 3c3.5 4.5 6 7.5 6 11a6 6 0 01-12 0c0-3.5 2.5-6.5 6-11z"/><path d="M9.5 15a2.6 2.6 0 002.5 2.5"/>',
  zoffset: '<path d="M4 20h16"/><path d="M12 4v11"/><path d="M8.5 11.5L12 15l3.5-3.5"/><path d="M8 20l4-2 4 2"/>',
  filament: '<path d="M4 17c0-6 5-6 8-6s8 0 8-5"/><circle cx="4" cy="17" r="1.6"/><circle cx="20" cy="6" r="1.6"/>',
  shaper: '<path d="M2 14h4l2-7 3 12 3-9 2 4h6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3v3.5a5 5 0 002.2 4.1L12 12l-2.8 1.4A5 5 0 007 17.5V21M17 3v3.5a5 5 0 01-2.2 4.1L12 12l2.8 1.4A5 5 0 0117 17.5V21"/>',
  eject: '<path d="M12 4l8 10H4L12 4z"/><path d="M5 19h14"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
};

const NS = 'xmlns="http://www.w3.org/2000/svg"';

/** icon("play") -> '<svg ...>' string (trusted markup: pass through raw() in templates). */
export function icon(name, cls = "i") {
  let body = S[name];
  let filled = false;
  if (body == null && S[name + "!"] != null) { body = S[name + "!"]; filled = true; }
  if (body == null) { body = S.help; }
  if (filled) {
    return `<svg ${NS} class="${cls}" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false">${body}</svg>`;
  }
  return `<svg ${NS} class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const iconNames = () => Object.keys(S).map((n) => n.replace(/!$/, ""));
