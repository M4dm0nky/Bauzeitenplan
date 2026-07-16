// ── Klassentreffen Festival 2026 ──────────────────────────────────────────────
// Baut aus dem PDF „Grob-Bauzeitenplan – Entwurf Stand 06.07.26" eine
// importierbare JSON auf Basis der Festival-Vorlage.
//
//   node tools/make-klassentreffen.mjs   →  klassentreffen-festival.json
//
// QUELLENTREUE ist die oberste Regel:
//   • Der TAG jedes Vorgangs stammt aus dem PDF (21.08.–03.09.2026).
//   • Die UHRZEIT nennt das PDF NIE (nur Vormittag/Nachmittag). Sie ist die
//     Annahme: Vormittag = 08–13, Nachmittag = 13–18 Uhr. Deshalb ist JEDE
//     Dauer geschätzt (estimated: true → gestrichelte Kante im Gantt).
//   • KEINE erfundenen Abhängigkeiten. Das PDF ist ein Kalender, kein Netzplan;
//     die Lage auf den Tagen trägt die Reihenfolge. deps ist leer.
//
// Gewerk-Modell (mit Marco abgestimmt): die acht Festival-Gewerke plus neun
// Baustellen-Gewerke = 17. Video und Pyro nennt das PDF nicht → leere Gewerke,
// unberührt. Nicht offensichtliche Zuordnungen tragen eine Notiz:
//   • StageCo + Stahl → Bühne          • Besucher-Gastronomie → Catering
//   • Artist-Bereiche → Artist Care    • Wasser-Infrastruktur → Sanitär
//   • Line-Up → eigenes Gewerk Show    • Fuhrpark/Container → Logistik
//   • „Ausbau Technik" → aufgeteilt auf Rigging/Licht/Ton

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serialize } from '../js/persistence.js';

const here = dirname(fileURLToPath(import.meta.url));

// ── Gewerke ─────────────────────────────────────────────────────────────────
// Reihenfolge = Farbplatz. 0–7 = Festival-Palette (validiert), 8 = Ocker
// (Handergänzung), 9–16 wiederholen die Farbtöne mit Schraffur.
const GEWERKE = [
  'Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Pyro', 'Catering', 'Sanitär',
  'Produktion', 'Strom', 'Zäune & Absperrung', 'Zelte', 'Security', 'Branding',
  'Artist Care', 'Show', 'Logistik',
];
// Video und Pyro stehen nicht im PDF und bleiben leer.
const LEER = ['Video', 'Pyro'];

// ── Zeit-Bausteine ──────────────────────────────────────────────────────────
const VM = (d) => ({ s: d + 'T08:00', e: d + 'T13:00' });   // Vormittag
const NM = (d) => ({ s: d + 'T13:00', e: d + 'T18:00' });   // Nachmittag
const TAG = (d) => ({ s: d + 'T08:00', e: d + 'T18:00' });  // ganzer Tag
const VON = (s, e) => ({ s, e });                           // durchlaufender Balken

// r(Gewerk, Titel, Zeit, Notiz?) — normale Vorgänge (Dauer geschätzt)
const r = (gw, t, zeit, note = '') => ({ gw, t, ...zeit, note });
// mss(Titel, Zeitpunkt, Notiz) — projekt-Meilenstein (Dauer 0, nicht geschätzt)
const mss = (t, at, note = '') => ({ gw: 'projekt', t, s: at, e: at, ms: true, note });

const PDF = '\nSteht so im PDF.';
const FRAGE = '\nIm PDF mit „?" — noch offen.';

// ── Vorgänge, chronologisch nach PDF ────────────────────────────────────────
const ROWS = [
  // ── 21.08. Freitag ────────────────────────────────────────────────────────
  r('Produktion', 'Übergabe Gelände (Betreiber → Veranstalter)', VM('2026-08-21')),
  r('Strom', 'Übergabe & Ablesen Strom', VM('2026-08-21')),
  r('Logistik', 'Anlieferung Container Produktion', NM('2026-08-21'),
    'Fuhrpark/Container → Logistik (mit Marco abgestimmt).'),
  r('Sanitär', 'Anlieferung WC-Container Teil 1', NM('2026-08-21')),
  r('Logistik', 'Anlieferung Fuhrpark', NM('2026-08-21'), FRAGE),

  // ── 22.08. Samstag ──────────────────────────────────────────────────────────
  r('Produktion', 'Einmessen', VM('2026-08-22')),
  r('Zelte', 'Zelte aufbauen: Crew-Catering / Produktion / Artist', TAG('2026-08-22')),

  // ── 23.08. Sonntag ────────────────────────────────────────────────────────
  mss('Baufrei — kein Aufbau', '2026-08-23T12:00', PDF),

  // ── 24.08. Montag ─────────────────────────────────────────────────────────
  r('Zäune & Absperrung', 'Anlieferung Zäune', VM('2026-08-24')),
  r('Strom', 'Anlieferung Strom', VM('2026-08-24')),
  r('Bühne', 'Anlieferung Stahl', VM('2026-08-24'),
    'Stahl → Bühne (StageCo/Stahl-Unterbau, mit Marco abgestimmt).'),
  r('Logistik', 'Anlieferung Container Teil 2', VM('2026-08-24'),
    'Im PDF auch am 25.08. gelistet — hier einmal geführt.'),
  r('Bühne', 'Aufbau StageCo — Tag 1', TAG('2026-08-24'),
    'StageCo (Bühnenbaufirma) → Bühne (mit Marco abgestimmt).'),
  r('Zelte', 'Zelte aufbauen: Produktion / Artist / Crew / Check-In', TAG('2026-08-24')),
  r('Zäune & Absperrung', 'Aufbau Zäune', TAG('2026-08-24')),
  r('Catering', 'Crew-Catering einrichten', VM('2026-08-24')),

  // ── 25.08. Dienstag ───────────────────────────────────────────────────────
  r('Bühne', 'Aufbau StageCo — Tag 2', TAG('2026-08-25')),
  r('Sanitär', 'Anlieferung WC-Container Teil 2', VM('2026-08-25')),

  // ── 26.08. Mittwoch ───────────────────────────────────────────────────────
  r('Bühne', 'Aufbau StageCo — Tag 3', TAG('2026-08-26')),
  r('Zelte', 'Einrichten Zelte: Einlass / Gastro / VIP / Nebenflächen',
    VON('2026-08-26T08:00', '2026-08-27T18:00')),

  // ── 27.08. Donnerstag ─────────────────────────────────────────────────────
  r('Rigging', 'Einbau Rigging', TAG('2026-08-27')),
  r('Licht', 'Einbau Licht', VON('2026-08-27T08:00', '2026-08-28T18:00'),
    'PDF-Zeile „Einbau Licht / Ton" — auf Licht und Ton aufgeteilt.'),
  r('Ton', 'Einbau Ton', VON('2026-08-27T08:00', '2026-08-28T18:00'),
    'PDF-Zeile „Einbau Licht / Ton" — auf Licht und Ton aufgeteilt.'),
  r('Sanitär', 'Einrichten Besucher-WCs', VM('2026-08-27')),

  // ── mehrtägige Aufbau-Vorgänge (im PDF an mehreren Tagen genannt) ──────────
  r('Branding', 'Branding / Look&Feel', VON('2026-08-26T08:00', '2026-08-28T18:00'),
    'Im PDF am 26.–28.08. — als durchlaufender Vorgang geführt.'),
  r('Artist Care', 'Einrichten Artist-Bereiche', VON('2026-08-26T08:00', '2026-08-28T18:00'),
    'Artist-Bereiche → eigenes Gewerk Artist Care (mit Marco abgestimmt). Im PDF am 26.–28.08.'),
  r('Zäune & Absperrung', 'Aufbau Absperrungen / Barriers / Infield',
    VON('2026-08-27T08:00', '2026-08-28T18:00'), 'Im PDF am 27.–28.08.'),
  r('Catering', 'Aufbau Besucher-Gastronomie', VON('2026-08-27T08:00', '2026-08-28T18:00'),
    'Besucher-Gastronomie → Catering (mit Marco abgestimmt). Im PDF am 27.–28.08.'),

  // ── 28.08. Freitag ────────────────────────────────────────────────────────
  r('Produktion', 'Einbau Produktion', VM('2026-08-28')),
  r('Produktion', 'Behördliche Geländeabnahme', NM('2026-08-28'),
    'Im PDF am 27. und 28.08., jeweils mit „?".'),

  // ── durchlaufende Balken über den ganzen Aufbau/Betrieb ───────────────────
  r('Security', '24/7 Objektschutz', VON('2026-08-22T00:00', '2026-09-03T18:00'),
    'Im PDF ab 22.08. (22./23.08. mit „?"), dann durchgehend bis Geländerückgabe.'),
  r('Catering', 'Crew-Catering Betrieb', VON('2026-08-24T08:00', '2026-09-03T13:00'),
    'Läuft vom Einrichten bis zum Abbau.'),
  r('Strom', 'Aufbau Strom-Infrastruktur', VON('2026-08-24T08:00', '2026-08-25T18:00'),
    'Im PDF am 24. und 25.08.'),
  r('Sanitär', 'Aufbau Wasser-Infrastruktur', VON('2026-08-24T08:00', '2026-08-25T18:00'),
    'Wasser-Infrastruktur → Sanitär (mit Marco abgestimmt). Im PDF am 24. und 25.08.'),

  // ── 29.08. Samstag — Showtag 1 ────────────────────────────────────────────
  r('Produktion', 'Restarbeiten Produktion', VM('2026-08-29')),
  r('Zäune & Absperrung', 'Restarbeiten Infield', VM('2026-08-29')),
  r('Catering', 'Restarbeiten Besucher-Gastronomie', VM('2026-08-29')),
  r('Show', 'Veranstaltungsablauf gemäß Line-Up — Tag 1', VON('2026-08-29T13:00', '2026-08-29T23:00'),
    'Line-Up → eigenes Gewerk Show (mit Marco abgestimmt).'),

  // ── 30.08. Sonntag — Showtag 2 ────────────────────────────────────────────
  r('Produktion', 'Nacharbeiten Produktion', VM('2026-08-30')),
  r('Zäune & Absperrung', 'Nacharbeiten Infield', VM('2026-08-30')),
  r('Catering', 'Nacharbeiten Besucher-Gastronomie', VM('2026-08-30')),
  r('Show', 'Veranstaltungsablauf gemäß Line-Up — Tag 2', VON('2026-08-30T13:00', '2026-08-30T23:00')),
  // Nacht 30. → 31.08.
  r('Rigging', 'Ausbau Technik — Rigging', VON('2026-08-30T23:00', '2026-08-31T03:00'),
    'PDF-Zeile „Ausbau Technik" — auf Rigging/Licht/Ton aufgeteilt (mit Marco abgestimmt).'),
  r('Licht', 'Ausbau Technik — Licht', VON('2026-08-30T23:00', '2026-08-31T03:00'),
    'PDF-Zeile „Ausbau Technik" — auf Rigging/Licht/Ton aufgeteilt.'),
  r('Ton', 'Ausbau Technik — Ton', VON('2026-08-30T23:00', '2026-08-31T03:00'),
    'PDF-Zeile „Ausbau Technik" — auf Rigging/Licht/Ton aufgeteilt.'),
  r('Catering', 'Rückbau Besucher-Gastronomie', VON('2026-08-30T23:00', '2026-08-31T03:00')),

  // ── 31.08. Montag ─────────────────────────────────────────────────────────
  r('Branding', 'Abbau Branding / Look&Feel', VM('2026-08-31')),
  r('Artist Care', 'Abbau Artist-Bereiche', VM('2026-08-31')),
  r('Zäune & Absperrung', 'Abbau Absperrungen / Barriers / Infield', VM('2026-08-31')),
  r('Catering', 'Abbau Besucher-Gastronomie', VM('2026-08-31')),
  r('Sanitär', 'Abholung Besucher-WCs', VM('2026-08-31')),
  r('Logistik', 'Abholung Container Teil 1', VM('2026-08-31')),

  // ── 01.09. Dienstag ───────────────────────────────────────────────────────
  r('Bühne', 'Abbau Stahl', VON('2026-09-01T08:00', '2026-09-02T18:00'),
    'Im PDF am 01. und 02.09.'),
  r('Zelte', 'Abbau Zelte: Einlass / Gastro / VIP / Nebenflächen', TAG('2026-09-01')),
  r('Logistik', 'Abholung Container Teil 2', VM('2026-09-01')),

  // ── 02.09. Mittwoch ───────────────────────────────────────────────────────
  r('Zelte', 'Abbau Zelte: Artist / Produktion', TAG('2026-09-02')),

  // ── Abbau Strom/Wasser (im PDF am 01.–03.09.) ─────────────────────────────
  r('Strom', 'Abbau Strom-Infrastruktur', VON('2026-09-01T08:00', '2026-09-03T13:00'),
    'Im PDF am 01.–03.09.'),
  r('Sanitär', 'Abbau Wasser-Infrastruktur', VON('2026-09-01T08:00', '2026-09-03T13:00'),
    'Im PDF am 01.–03.09.'),

  // ── 03.09. Donnerstag ─────────────────────────────────────────────────────
  r('Logistik', 'Abholung Container Teil 3', VM('2026-09-03')),
  r('Catering', 'Abbau Crew-Catering', VM('2026-09-03')),
  r('Zelte', 'Abbau Crew-Catering-Zelt', VM('2026-09-03')),
  r('Produktion', 'Geländerückgabe', NM('2026-09-03')),
  r('Strom', 'Ablesen Strom- / Wasserzähler', NM('2026-09-03')),
];

// ── Bauen ───────────────────────────────────────────────────────────────────
const gewerke = GEWERKE.map((name, i) => ({ id: 'g' + i, name, sort: i, slot: i }));
const gid = new Map(gewerke.map((g) => [g.name, g.id]));

const tasks = ROWS.map((x, i) => ({
  id: 't' + i,
  gewerk: x.gw === 'projekt' ? 'projekt' : gid.get(x.gw),
  title: x.t,
  start: x.s,
  end: x.e,
  milestone: !!x.ms,
  progress: 0,
  status: 'geplant',
  crew: null,
  notes: x.note.trim(),
  // Tag aus dem PDF, Uhrzeit geschätzt → jede echte Dauer ist eine Schätzung.
  estimated: !x.ms,
}));

// Keine erfundenen Abhängigkeiten (siehe Kopf).
const deps = [];

const plan = {
  project: {
    id: 'klassentreffen-festival-2026',
    name: 'Klassentreffen Festival 2026',
    venue: '',
    start: '2026-08-21T00:00',
    end: '2026-09-03T23:59',
    timezone: 'Europe/Berlin',
  },
  gewerke,
  tasks,
  deps,
};

export { plan };

// Nur schreiben, wenn direkt aufgerufen — der Test importiert diese Datei, und
// ein Import darf nichts auf die Platte schreiben.
if (process.argv[1] && process.argv[1].endsWith('make-klassentreffen.mjs')) {
  writeFileSync(join(here, '..', 'klassentreffen-festival.json'), serialize(plan));
  const leer = gewerke.filter((g) => LEER.includes(g.name)).length;
  const est = tasks.filter((t) => t.estimated).length;
  console.log('  ✓ klassentreffen-festival.json');
  console.log(`    ${gewerke.length} Gewerke (davon ${leer} leer: ${LEER.join(', ')})`);
  console.log(`    ${tasks.length} Vorgänge · ${tasks.filter((t) => t.milestone).length} Meilenstein · ${deps.length} Verknüpfungen`);
  console.log(`    ${est} Vorgänge mit geschätzter Dauer (gestrichelte Kante)`);
}
