// ── Demo-Datensatz: Nordlicht Festival 2026 ───────────────────────────────────
// Realistischer Festival-Aufbau. Planung ab Mai (Monatszoom), Load-In stunden-
// genau (Stundenzoom), Show, Abbau. "Heute" liegt mitten im Aufbau.

export const PROJECT = {
  name: 'Nordlicht Festival 2026',
  venue: 'Messegelände Hannover · Freigelände Nord',
  start: '2026-05-04T00:00:00',
  end:   '2026-07-22T23:59:00',
  now:   '2026-07-15T11:20:00',
};

// Phasen für die Hintergrundbänder / Minimap
export const PHASES = [
  { name: 'Planung',   start: '2026-05-04T00:00:00', end: '2026-07-10T00:00:00' },
  { name: 'Aufbau',    start: '2026-07-13T06:00:00', end: '2026-07-16T23:59:00' },
  { name: 'Show',      start: '2026-07-17T00:00:00', end: '2026-07-19T23:59:00' },
  { name: 'Abbau',     start: '2026-07-20T00:00:00', end: '2026-07-21T23:59:00' },
];

// Slot-Reihenfolge = validierte CVD-Anordnung (siehe find-order.mjs).
// Farben sind Identität des Gewerks und über alle vier Designs identisch.
export const GEWERKE = [
  { id: 'buehne',   name: 'Bühne',     lead: 'M. Brandt',   light: '#eb6834', dark: '#d95926' },
  { id: 'rigging',  name: 'Rigging',   lead: 'S. Költzsch', light: '#1baf7a', dark: '#199e70' },
  { id: 'licht',    name: 'Licht',     lead: 'A. Reuter',   light: '#eda100', dark: '#c98500' },
  { id: 'ton',      name: 'Ton',       lead: 'J. Vahle',    light: '#e87ba4', dark: '#d55181' },
  { id: 'video',    name: 'Video',     lead: 'P. Osei',     light: '#2a78d6', dark: '#3987e5' },
  { id: 'pyro',     name: 'Pyro',      lead: 'K. Lindqvist',light: '#e34948', dark: '#e66767' },
  { id: 'catering', name: 'Catering',  lead: 'D. Hoffmann', light: '#4a3aa7', dark: '#9085e9' },
  { id: 'sanitaer', name: 'Sanitär',   lead: 'R. Ammann',   light: '#008300', dark: '#008300' },
];

const T = (id, g, title, start, end, extra = {}) =>
  ({ id, gewerk: g, title, start, end, milestone: false, progress: 0, status: 'geplant', ...extra });
const M = (id, g, title, at, extra = {}) =>
  ({ id, gewerk: g, title, start: at, end: at, milestone: true, progress: 0, status: 'geplant', ...extra });

export const TASKS = [
  // ── Projekt-Zielmeilenstein ─────────────────────────────────────────────────
  // Der Punkt, auf den alle Gewerke hinarbeiten. Ohne ihn hätte jede Kette ihr
  // eigenes Ende als Deadline und wäre dadurch zwangsläufig kritisch.
  M('doors', 'projekt', 'Doors — Publikum rein', '2026-07-17T00:00'),

  // ── Bühne ───────────────────────────────────────────────────────────────────
  T('b1', 'buehne', 'Statik & Genehmigung',      '2026-05-04T08:00', '2026-05-29T17:00', { progress: 100, status: 'fertig' }),
  T('b2', 'buehne', 'Anlieferung Bühnenteile',   '2026-07-13T06:00', '2026-07-13T12:00', { progress: 100, status: 'fertig', crew: 6 }),
  T('b3', 'buehne', 'Podest & Unterbau',         '2026-07-13T08:00', '2026-07-13T18:00', { progress: 100, status: 'fertig', crew: 12 }),
  T('b4', 'buehne', 'Dach & Traversentürme',     '2026-07-13T12:00', '2026-07-14T14:00', { progress: 100, status: 'fertig', crew: 10 }),
  M('b5', 'buehne', 'Bühne steht',               '2026-07-14T14:00', { progress: 100, status: 'fertig' }),
  T('b6', 'buehne', 'Bühne abbauen',             '2026-07-20T08:00', '2026-07-21T18:00', { crew: 14 }),

  // ── Rigging ─────────────────────────────────────────────────────────────────
  T('r1', 'rigging', 'Rigging-Plan & Lastenberechnung', '2026-05-11T09:00', '2026-06-12T17:00', { progress: 100, status: 'fertig' }),
  T('r2', 'rigging', 'Motoren hängen',           '2026-07-14T07:00', '2026-07-14T15:00', { progress: 100, status: 'fertig', crew: 8 }),
  T('r3', 'rigging', 'Traversen fliegen',        '2026-07-14T10:00', '2026-07-14T20:00', { progress: 100, status: 'fertig', crew: 8 }),
  M('r4', 'rigging', 'Rigging freigegeben',      '2026-07-14T20:00', { progress: 100, status: 'fertig' }),

  // ── Licht ───────────────────────────────────────────────────────────────────
  T('l1', 'licht', 'Lichtdesign & Plot',         '2026-05-18T09:00', '2026-06-26T17:00', { progress: 100, status: 'fertig' }),
  T('l2', 'licht', 'Anlieferung Licht',          '2026-07-14T14:00', '2026-07-14T18:00', { progress: 100, status: 'fertig', crew: 4 }),
  T('l3', 'licht', 'Scheinwerfer hängen',        '2026-07-15T06:00', '2026-07-15T16:00', { progress: 62, status: 'laeuft', crew: 9 }),
  T('l4', 'licht', 'Verkabelung & DMX',          '2026-07-15T08:00', '2026-07-15T18:00', { progress: 40, status: 'laeuft', crew: 5 }),
  T('l5', 'licht', 'Fokus & Programmierung',     '2026-07-15T18:00', '2026-07-16T02:00', { crew: 3 }),
  M('l6', 'licht', 'Licht fertig',               '2026-07-16T02:00'),

  // ── Ton ─────────────────────────────────────────────────────────────────────
  T('t1', 'ton', 'Beschallungskonzept',          '2026-05-25T09:00', '2026-06-19T17:00', { progress: 100, status: 'fertig' }),
  T('t2', 'ton', 'PA anliefern',                 '2026-07-15T08:00', '2026-07-15T12:00', { progress: 100, status: 'fertig', crew: 5 }),
  T('t3', 'ton', 'PA fliegen',                   '2026-07-15T12:00', '2026-07-15T20:00', { progress: 15, status: 'laeuft', crew: 7 }),
  T('t4', 'ton', 'FOH & Monitorwelt',            '2026-07-15T14:00', '2026-07-15T19:00', { crew: 4 }),
  T('t5', 'ton', 'Systemcheck & Einmessen',      '2026-07-16T08:00', '2026-07-16T14:00', { crew: 3 }),
  T('t6', 'ton', 'Soundcheck',                   '2026-07-16T14:00', '2026-07-16T18:00', { crew: 6 }),

  // ── Video ───────────────────────────────────────────────────────────────────
  T('v1', 'video', 'LED-Wand Planung',           '2026-06-01T09:00', '2026-06-30T17:00', { progress: 100, status: 'fertig' }),
  T('v2', 'video', 'LED-Wand aufbauen',          '2026-07-15T10:00', '2026-07-16T12:00', { progress: 20, status: 'laeuft', crew: 8 }),
  T('v3', 'video', 'Medienserver & Signalweg',   '2026-07-16T09:00', '2026-07-16T16:00', { crew: 3 }),
  T('v4', 'video', 'Kameratest',                 '2026-07-16T16:00', '2026-07-16T18:00', { crew: 4 }),

  // ── Pyro ────────────────────────────────────────────────────────────────────
  T('p1', 'pyro', 'Genehmigung Pyrotechnik',     '2026-05-04T09:00', '2026-06-15T17:00', { progress: 100, status: 'fertig' }),
  T('p2', 'pyro', 'Sicherheitsabstände abstecken','2026-07-16T08:00', '2026-07-16T11:00', { crew: 2 }),
  T('p3', 'pyro', 'Pyro-Aufbau',                 '2026-07-16T11:00', '2026-07-16T17:00', { crew: 4 }),
  M('p4', 'pyro', 'Abnahme Brandschutz',         '2026-07-16T18:00'),

  // ── Catering ────────────────────────────────────────────────────────────────
  T('c1', 'catering', 'Ausschreibung & Vergabe', '2026-05-11T09:00', '2026-06-05T17:00', { progress: 100, status: 'fertig' }),
  T('c2', 'catering', 'Küchenzelt stellen',      '2026-07-14T08:00', '2026-07-14T16:00', { progress: 100, status: 'fertig', crew: 6 }),
  T('c3', 'catering', 'Kühlung & Stromanschluss','2026-07-14T16:00', '2026-07-14T20:00', { progress: 100, status: 'fertig', crew: 3 }),
  T('c4', 'catering', 'Crew-Catering Betrieb',   '2026-07-13T06:00', '2026-07-21T20:00', { progress: 45, status: 'laeuft', crew: 8 }),

  // ── Sanitär ─────────────────────────────────────────────────────────────────
  T('s1', 'sanitaer', 'Bedarfsplanung WC-Einheiten', '2026-05-18T09:00', '2026-06-05T17:00', { progress: 100, status: 'fertig' }),
  T('s2', 'sanitaer', 'WC-Container liefern',    '2026-07-13T07:00', '2026-07-13T11:00', { progress: 100, status: 'fertig', crew: 3 }),
  T('s3', 'sanitaer', 'Wasser & Abwasser',       '2026-07-13T11:00', '2026-07-13T17:00', { progress: 100, status: 'fertig', crew: 4 }),
  M('s4', 'sanitaer', 'Sanitär betriebsbereit',  '2026-07-13T17:00', { progress: 100, status: 'fertig' }),
  T('s5', 'sanitaer', 'Service & Reinigung',     '2026-07-14T06:00', '2026-07-21T20:00', { progress: 30, status: 'laeuft', crew: 2 }),
];

// type: FS = Ende→Start, SS = Start→Start, FF = Ende→Ende, SF = Start→Ende
// lag in Minuten (darf negativ sein = Überlappung)
export const DEPS = [
  // Planung → Aufbau. Ohne diese Kanten wären die Planungsvorgänge Senken und
  // würden von der Ankerregel fälschlich als kritisch markiert.
  { from: 'b1', to: 'b2', type: 'FS', lag: 0 },
  { from: 'r1', to: 'r2', type: 'FS', lag: 0 },
  { from: 'l1', to: 'l2', type: 'FS', lag: 0 },
  { from: 't1', to: 't2', type: 'FS', lag: 0 },
  { from: 'v1', to: 'v2', type: 'FS', lag: 0 },
  { from: 'c1', to: 'c2', type: 'FS', lag: 0 },
  { from: 'c2', to: 'c3', type: 'FS', lag: 0 },
  { from: 's1', to: 's2', type: 'FS', lag: 0 },

  { from: 'b2', to: 'b3', type: 'FS', lag: -240 },
  { from: 'b3', to: 'b4', type: 'SS', lag: 240 },
  { from: 'b4', to: 'b5', type: 'FS', lag: 0 },
  { from: 'b5', to: 'r2', type: 'FS', lag: -420 },
  { from: 'r2', to: 'r3', type: 'SS', lag: 180 },
  { from: 'r3', to: 'r4', type: 'FS', lag: 0 },
  { from: 'r4', to: 'l3', type: 'FS', lag: 600 },
  { from: 'l2', to: 'l3', type: 'FS', lag: 720 },
  { from: 'l3', to: 'l4', type: 'SS', lag: 120 },
  { from: 'l3', to: 'l5', type: 'FS', lag: 120 },
  { from: 'l4', to: 'l5', type: 'FS', lag: 0 },
  { from: 'l5', to: 'l6', type: 'FS', lag: 0 },
  { from: 'r4', to: 't3', type: 'FS', lag: 960 },
  { from: 't2', to: 't3', type: 'FS', lag: 0 },
  { from: 't3', to: 't5', type: 'FS', lag: 720 },
  { from: 't4', to: 't5', type: 'FS', lag: 780 },
  { from: 't5', to: 't6', type: 'FS', lag: 0 },
  { from: 'v2', to: 'v3', type: 'FF', lag: 240 },
  { from: 'v3', to: 'v4', type: 'FS', lag: 0 },
  { from: 'p1', to: 'p2', type: 'FS', lag: 0 },
  { from: 'p2', to: 'p3', type: 'FS', lag: 0 },
  { from: 'p3', to: 'p4', type: 'FS', lag: 60 },
  { from: 's2', to: 's3', type: 'FS', lag: 0 },
  { from: 's3', to: 's4', type: 'FS', lag: 0 },
  { from: 'b5', to: 'c2', type: 'SF', lag: 120 },

  // Alle Gewerke münden in Doors. Der Abstand zwischen dem eigenen Ende und
  // Doors ist der Puffer des jeweiligen Gewerks.
  { from: 'l6', to: 'doors', type: 'FS', lag: 0 },
  { from: 't6', to: 'doors', type: 'FS', lag: 0 },
  { from: 'v4', to: 'doors', type: 'FS', lag: 0 },
  { from: 'p4', to: 'doors', type: 'FS', lag: 0 },
  { from: 's4', to: 'doors', type: 'FS', lag: 0 },
  { from: 'c3', to: 'doors', type: 'FS', lag: 0 },
];
