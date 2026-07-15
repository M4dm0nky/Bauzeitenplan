// ── AnnenMayKantereit · Outdoor Singleshow ────────────────────────────────────
// Baut aus den beiden PDFs (Stand 260710) eine importierbare JSON.
//
//   node tools/make-amk.mjs   →  amk-singleshow.json
//
// QUELLENTREUE ist hier die oberste Regel. Was im PDF steht, steht hier.
// Was NICHT im PDF steht, ist als solches gekennzeichnet:
//   est: true      → Dauer/Zeit von mir geschätzt (im Gantt gestrichelte Kante)
//   gw: true       → Gewerk war im Original leer, von Marco einzeln bestätigt
// Bemerkung, Bereich, Ansprechpartner und Firma landen in der Notiz, damit
// nichts aus dem Original verlorengeht.
//
// Abgestimmt: Show Fr 17.07.2026 · Showende 22:30 · Abbau 22:30–01:30 (3 h).

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize } from '../js/persistence.js';

const here = dirname(fileURLToPath(import.meta.url));
const SHOW = '2026-07-17';          // Freitag
const NEXT = '2026-07-18';          // der Abbau läuft in die Nacht

const at = (tag, hhmm) => tag + 'T' + hhmm;

// Acht Gewerke — exakt die validierte Palette, keine Schraffur nötig.
const GEWERKE = ['Rigging', 'Licht', 'LED', 'Set', 'Backline', 'FoH', 'C1', 'Local Crew'];

// n(Bemerkung, Bereich, Ansprechpartner, Firma) → Notiz aus den PDF-Spalten
const n = (...teile) => teile.filter(Boolean).join(' · ');

// ── AUFBAU · 17.07.2026, 07:15–12:45 ────────────────────────────────────────
// Spalten im PDF: Start ab | Fertigstellung | Gewerk | Tätigkeit | Bemerkung |
//                 Bereich | Ansprechpartner | Firma
const AUFBAU = [
  { k: 'r-motoren', gw_: 'Rigging', t: 'Motoren LoadIn & Setup', s: '07:15', e: '08:45', est: true,
    no: n('am Dock', 'Bühne', 'Jens', 'BigRig'),
    warum: 'Ende geschätzt: muss vor «C1 Motoren hängen» (endet 09:30) fertig sein' },
  { k: 'li-dimmer', gw_: 'Licht', t: 'DimmerCity setup', s: '07:30', e: '09:00', est: true,
    no: n(null, null, 'Marco'), warum: 'Ende geschätzt: im PDF keine Fertigstellung, kein Anhaltspunkt' },
  { k: 'li-kabel', gw_: 'Licht', t: 'KabelTruss oben', s: '07:30', e: '08:30', est: true, gw: true,
    warum: 'Ende geschätzt: im PDF keine Fertigstellung, kein Anhaltspunkt' },
  { k: 'led-load', gw_: 'LED', t: 'LED Load In', s: '08:30', e: '09:00', est: true, gw: true,
    no: n(null, null, 'Jan-Hendrik / Martin / Hacki'),
    warum: 'Ende geschätzt: «Aufbau LED Backwall» beginnt 09:00' },
  { k: 'set-setup', gw_: 'Set', t: 'SetUp', s: '08:45', e: '09:30', est: true,
    no: n(null, 'SL', 'Lolle'), warum: 'Ende geschätzt: «verlegen schwarzer Teppich» endet 09:30' },
  { k: 'led-backwall', gw_: 'LED', t: 'Aufbau LED Backwall', s: '09:00', e: '12:00' },
  { k: 'r-vorhangschiene', gw_: 'Rigging', t: 'Vorhangschine hängt', s: '09:15', e: '10:00', est: true,
    warum: 'Ende geschätzt: «Vorhang oben» ist 10:00' },
  { k: 'r-c1motoren', gw_: 'Rigging', t: 'C1 Motoren hängen', s: '08:45', e: '09:30', est: true,
    no: n('Original-Gewerk: C1 — C1 bezeichnet hier die Traverse, nicht die Crew'),
    warum: 'Start geschätzt (im PDF nur Fertigstellung 09:30)' },
  { k: 'set-teppich', gw_: 'Set', t: 'verlegen schwarzer Teppich', s: '09:00', e: '09:30', est: true,
    no: n(null, 'Bühne SL / SR', 'Jenny'), warum: 'Start geschätzt (im PDF nur Fertigstellung 09:30)' },
  { k: 'c1-kreise', gw_: 'C1', t: 'kl. Kreise', s: '09:30', e: '10:30', gw: true, no: n(null, 'Bühne') },
  { k: 'set-vorhangoben', gw_: 'Set', t: 'Vorhang oben', s: '10:00', ms: true, gw: true,
    no: n('Im PDF nur Fertigstellung 10:00 — als Zustand gelesen') },
  { k: 'li-leitern', gw_: 'Licht', t: 'Leitern fertig', s: '10:00', ms: true,
    no: n(null, 'SL', 'Marco', null) + ' · Im PDF nur Fertigstellung 10:00 — als Zustand gelesen' },
  { k: 'r-pods', gw_: 'Rigging', t: 'Pods (gr. Kreis) auf Bühne', s: '09:30', e: '10:30', gw: true },
  { k: 'r-lx1', gw_: 'Rigging', t: 'Lx1 oben', s: '09:50', e: '10:05' },
  { k: 'set-riser', gw_: 'Set', t: 'Aufbau Riser', s: '10:30', e: '12:30', gw: true },
  { k: 'r-lx3', gw_: 'Rigging', t: 'Lx3 oben', s: '10:45', e: '11:00' },
  { k: 'set-trussvorhang', gw_: 'Set', t: 'Bau Truss Vorhang hinten', s: '11:00', e: '11:15', gw: true },
  { k: 'set-vorhangein', gw_: 'Set', t: 'Einhängen Vorhang hinten', s: '12:00', e: '12:10', gw: true },
  { k: 'li-floorset', gw_: 'Licht', t: 'Floorset bauen', s: '12:15', e: '12:45', gw: true },
];

// ── ABBAU · 17.07. 22:30 – 18.07. 01:30 ─────────────────────────────────────
// Das PDF hat KEINE einzige Uhrzeit. Reihenfolge wie gedruckt, Dauern und Lage
// vollständig geschätzt — deshalb ist hier alles est: true.
const ABBAU = [
  { k: 'a-barriers', gw_: 'Local Crew', t: 'Barriers weg', s: ['22:30', SHOW], e: ['22:45', SHOW], gw: true },
  { k: 'a-backline', gw_: 'Backline', t: 'Laden an Dock', s: ['22:30', SHOW], e: ['23:30', SHOW] },
  { k: 'a-foh', gw_: 'FoH', t: 'Laden an FoH', s: ['22:30', SHOW], e: ['23:15', SHOW], no: n('1 Stapler FoH', 'FoH') },
  { k: 'a-setbvk', gw_: 'Set', t: 'Abbau über BVK', s: ['22:45', SHOW], e: ['00:00', NEXT], no: n('1 Stapler BVK', 'BVK') },
  { k: 'a-led', gw_: 'LED', t: 'Abbau LED', s: ['22:45', SHOW], e: ['00:15', NEXT], no: n(null, 'Bühne') },
  { k: 'a-floorlights', gw_: 'Licht', t: 'Laden Floorlights', s: ['22:45', SHOW], e: ['23:30', SHOW], no: n(null, 'Bühne') },
  { k: 'a-vorhang-r', gw_: 'Rigging', t: 'Vorhang hinten runter fahren', s: ['23:00', SHOW], e: ['23:15', SHOW],
    no: n('Im PDF eine Zeile «Rigging/Set» — aufgeteilt, weil ein Vorgang nur ein Gewerk haben kann', 'Bühne') },
  { k: 'a-lx3', gw_: 'Rigging', t: 'Lx3 runter fahren und abbauen', s: ['23:00', SHOW], e: ['23:45', SHOW], no: n(null, 'Bühne') },
  { k: 'a-kreise', gw_: 'C1', t: 'kl. Kreise', s: ['23:00', SHOW], e: ['23:30', SHOW], gw: true, no: n(null, 'Bühne') },
  { k: 'a-pods', gw_: 'Rigging', t: 'Pods (gr. Kreis)', s: ['23:00', SHOW], e: ['23:45', SHOW], gw: true, no: n(null, 'Bühne') },
  { k: 'a-setweg', gw_: 'Set', t: 'Set weg → Abbau', s: ['23:00', SHOW], e: ['00:00', NEXT], no: n(null, 'Bühne') },
  { k: 'a-vorhang-s', gw_: 'Set', t: 'Vorhang hinten abbauen', s: ['23:15', SHOW], e: ['23:45', SHOW],
    no: n('Zweite Hälfte der PDF-Zeile «Rigging/Set»', 'Bühne') },
  { k: 'a-setdock', gw_: 'Set', t: 'Laden NICHT am Dock', s: ['00:00', NEXT], e: ['00:45', NEXT], no: n(null, 'BVK') },
  { k: 'a-teppich', gw_: 'Set', t: 'Abbau schw. Teppich', s: ['00:00', NEXT], e: ['00:30', NEXT], no: n(null, 'Bühne') },
  { k: 'a-leitern', gw_: 'Licht', t: 'Leitern runter', s: ['00:00', NEXT], e: ['00:30', NEXT],
    no: n('PDF: «sobald Backline und Set weg von Bühne» — als Verknüpfung gebaut', 'Bühne') },
  { k: 'a-lx1', gw_: 'Rigging', t: 'Lx1 runter fahren und abbauen', s: ['00:30', NEXT], e: ['01:15', NEXT], no: n(null, 'Bühne') },
  { k: 'a-sonderbau', gw_: 'Set', t: 'Sonderbau und Platten Dolly', s: ['00:45', NEXT], e: ['01:30', NEXT], gw: true },
];

// Die EINZIGEN Verknüpfungen: eine steht wörtlich im PDF, eine entsteht aus dem
// Aufteilen der «Rigging/Set»-Zeile. Sonst nichts — der Aufbau LEGT eine
// Reihenfolge nahe, aber das PDF behauptet sie nicht, und ein erfundenes Netz
// erzeugt rote Konflikte, die mit der Wirklichkeit nichts zu tun haben.
const DEPS = [
  ['a-backline', 'a-leitern', 'FS', 30],   // «sobald Backline … weg von Bühne»
  ['a-setweg', 'a-leitern', 'FS', 0],      // «… und Set weg von Bühne»
  ['a-vorhang-r', 'a-vorhang-s', 'FS', 0], // Runterfahren → Abbauen
];

// ── Bauen ───────────────────────────────────────────────────────────────────
const gewerke = GEWERKE.map((name, i) => ({ id: 'g' + i, name, sort: i, slot: i }));
const gid = new Map(gewerke.map((g) => [g.name, g.id]));

const notiz = (r) => {
  const teile = [];
  if (r.no) teile.push(r.no);
  if (r.gw) teile.push('Gewerk im Original leer — nach Rücksprache zugeordnet');
  if (r.warum) teile.push(r.warum);
  return teile.join('\n');
};

const tasks = [];
const keyToId = new Map();
const add = (r, tag) => {
  const id = 't' + tasks.length;
  keyToId.set(r.k, id);
  const s = Array.isArray(r.s) ? at(r.s[1], r.s[0]) : at(tag, r.s);
  const e = r.ms ? s : (Array.isArray(r.e) ? at(r.e[1], r.e[0]) : at(tag, r.e));
  tasks.push({
    id, gewerk: gid.get(r.gw_), title: r.t, start: s, end: e,
    milestone: !!r.ms, progress: 0, status: 'geplant', crew: null,
    notes: notiz(r), estimated: !!r.est && !r.ms,
  });
};

for (const r of AUFBAU) add(r, SHOW);
// Showende: der Anker, an dem der Abbau hängt.
tasks.push({
  id: 't' + tasks.length, gewerk: 'projekt', title: 'Showende', start: at(SHOW, '22:30'),
  end: at(SHOW, '22:30'), milestone: true, progress: 0, status: 'geplant', crew: null,
  notes: 'Steht nicht im PDF — von dir angegeben. Der Abbau hängt daran.', estimated: false,
});
for (const r of ABBAU) add({ ...r, est: true }, NEXT);

const deps = DEPS.map(([f, t, type, lag], i) => ({
  id: 'd' + i, from: keyToId.get(f), to: keyToId.get(t), type, lag,
}));

const plan = {
  project: {
    id: 'amk-singleshow-2026',
    name: 'AnnenMayKantereit — Outdoor Singleshow',
    venue: 'Outdoor',
    start: at(SHOW, '06:00'),
    end: at(NEXT, '03:00'),
    timezone: 'Europe/Berlin',
  },
  gewerke,
  tasks,
  deps,
  phases: [
    { name: 'Aufbau', start: at(SHOW, '07:15'), end: at(SHOW, '12:45') },
    { name: 'Show', start: at(SHOW, '12:45'), end: at(SHOW, '22:30') },
    { name: 'Abbau', start: at(SHOW, '22:30'), end: at(NEXT, '01:30') },
  ],
};

export { plan };

// Nur schreiben, wenn direkt aufgerufen. Der Test importiert diese Datei —
// ein Import darf nichts auf die Platte schreiben.
if (process.argv[1] && process.argv[1].endsWith('make-amk.mjs')) {
  writeFileSync(join(here, '..', 'amk-singleshow.json'), serialize(plan));
  const est = tasks.filter((t) => t.estimated).length;
  const gwl = [...AUFBAU, ...ABBAU].filter((r) => r.gw).length;
  console.log('  ✓ amk-singleshow.json');
  console.log(`    ${gewerke.length} Gewerke · ${tasks.length} Vorgänge · ${deps.length} Verknüpfungen`);
  console.log(`    ${tasks.filter((t) => t.milestone).length} Meilensteine`);
  console.log(`    ${est} Vorgänge mit geschätzter Dauer (gestrichelte Kante im Gantt)`);
  console.log(`    ${gwl} Zeilen, deren Gewerk im PDF leer war`);
}
