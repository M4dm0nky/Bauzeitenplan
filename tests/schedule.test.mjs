import { computeSchedule, topoSort, toMin, byStart, candidateGroups, seriesRows, tagesScheiben, reachable } from '../js/schedule.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const H = (h) => h * 60;
const t = (id, start, end) => ({ id, start, end });

console.log('\ntopoSort');
test('sortiert lineare Kette', () => {
  const o = topoSort(['c', 'a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]);
  assert.deepEqual(o.indexOf('a') < o.indexOf('b'), true);
  assert.deepEqual(o.indexOf('b') < o.indexOf('c'), true);
});
test('erkennt Zyklus und wirft', () => {
  assert.throws(
    () => topoSort(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]),
    /Zyklus/
  );
});
test('Zyklus-Fehler nennt die beteiligten Vorgänge', () => {
  try { topoSort(['a', 'b'], [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]); }
  catch (e) { assert.deepEqual(e.cycle.sort(), ['a', 'b']); }
});
test('Selbstbezug ist ein Zyklus', () => {
  assert.throws(() => topoSort(['a'], [{ from: 'a', to: 'a' }]), /Zyklus/);
});

console.log('\nForward-Pass: die vier Abhängigkeitstypen');
test('FS ohne Lag: Nachfolger startet am Ende des Vorgängers', () => {
  const tasks = [t('a', '2026-07-13T08:00', '2026-07-13T12:00'), t('b', '2026-07-13T08:00', '2026-07-13T10:00')];
  const R = computeSchedule(tasks, [{ from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  assert.equal(R.get('b').es, toMin('2026-07-13T12:00'));
  assert.equal(R.get('b').ef, toMin('2026-07-13T14:00'), 'Dauer bleibt 2h erhalten');
});
test('FS mit negativem Lag erlaubt Überlappung', () => {
  const tasks = [t('a', '2026-07-13T08:00', '2026-07-13T12:00'), t('b', '2026-07-13T06:00', '2026-07-13T08:00')];
  const R = computeSchedule(tasks, [{ from: 'a', to: 'b', type: 'FS', lag: -H(4) }]);
  assert.equal(R.get('b').es, toMin('2026-07-13T08:00'));
});
test('SS mit Lag: Start nach Start des Vorgängers', () => {
  const tasks = [t('a', '2026-07-13T08:00', '2026-07-13T18:00'), t('b', '2026-07-13T08:00', '2026-07-13T10:00')];
  const R = computeSchedule(tasks, [{ from: 'a', to: 'b', type: 'SS', lag: H(4) }]);
  assert.equal(R.get('b').es, toMin('2026-07-13T12:00'));
});
test('FF: Ende des Nachfolgers richtet sich am Ende des Vorgängers aus', () => {
  const tasks = [t('a', '2026-07-13T08:00', '2026-07-13T18:00'), t('b', '2026-07-13T08:00', '2026-07-13T10:00')];
  const R = computeSchedule(tasks, [{ from: 'a', to: 'b', type: 'FF', lag: H(2) }]);
  assert.equal(R.get('b').ef, toMin('2026-07-13T20:00'), 'EF = a.EF + 2h');
  assert.equal(R.get('b').es, toMin('2026-07-13T18:00'), 'ES = EF - Dauer');
});
test('SF: Ende des Nachfolgers richtet sich am Start des Vorgängers aus', () => {
  const tasks = [t('a', '2026-07-13T08:00', '2026-07-13T18:00'), t('b', '2026-07-13T04:00', '2026-07-13T06:00')];
  const R = computeSchedule(tasks, [{ from: 'a', to: 'b', type: 'SF', lag: H(2) }]);
  assert.equal(R.get('b').ef, toMin('2026-07-13T10:00'), 'EF = a.ES + 2h');
});
test('mehrere Vorgänger: der späteste bindet', () => {
  const tasks = [
    t('a', '2026-07-13T08:00', '2026-07-13T12:00'),
    t('b', '2026-07-13T08:00', '2026-07-13T16:00'),
    t('c', '2026-07-13T08:00', '2026-07-13T10:00'),
  ];
  const R = computeSchedule(tasks, [
    { from: 'a', to: 'c', type: 'FS', lag: 0 },
    { from: 'b', to: 'c', type: 'FS', lag: 0 },
  ]);
  assert.equal(R.get('c').es, toMin('2026-07-13T16:00'), 'b endet später und bindet');
});

console.log('\nBackward-Pass & Puffer');
test('straffe Kette hat Puffer 0 und ist kritisch', () => {
  const tasks = [t('a', '2026-07-13T08:00', '2026-07-13T12:00'), t('b', '2026-07-13T12:00', '2026-07-13T16:00')];
  const R = computeSchedule(tasks, [{ from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  assert.equal(R.get('a').float, 0);
  assert.equal(R.get('a').critical, true);
  assert.equal(R.get('b').critical, true);
});
test('Vorgänger mit Luft bekommt echten Puffer ausgewiesen', () => {
  // a endet 12:00, b startet erst 20:00 → 8h Puffer für a
  const tasks = [t('a', '2026-07-13T08:00', '2026-07-13T12:00'), t('b', '2026-07-13T20:00', '2026-07-13T22:00')];
  const R = computeSchedule(tasks, [{ from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  assert.equal(R.get('a').float, H(8));
  // Einziges Netz aus einer Kette: die Kette IST der kritische Pfad, auch wenn
  // gegenüber dem Anker Luft bleibt.
  assert.equal(R.get('a').critical, true);
});

test('konkurrierende Ketten: nur die mit dem geringsten Puffer ist kritisch', () => {
  const tasks = [
    t('eng1', '2026-07-13T08:00', '2026-07-13T12:00'),
    t('eng2', '2026-07-13T12:00', '2026-07-13T23:00'), // endet 1h vor Ziel
    t('lose1', '2026-07-13T08:00', '2026-07-13T10:00'),
    t('lose2', '2026-07-13T18:00', '2026-07-13T20:00'), // endet 4h vor Ziel
    t('ziel', '2026-07-14T00:00', '2026-07-14T00:00'),
  ];
  const R = computeSchedule(tasks, [
    { from: 'eng1', to: 'eng2', type: 'FS', lag: 0 },
    { from: 'eng2', to: 'ziel', type: 'FS', lag: 0 },
    { from: 'lose1', to: 'lose2', type: 'FS', lag: 0 },
    { from: 'lose2', to: 'ziel', type: 'FS', lag: 0 },
  ]);
  assert.equal(R.get('eng1').critical, true, 'engere Kette ist kritisch');
  assert.equal(R.get('lose1').critical, false, 'lockere Kette hat mehr Puffer');
  assert.equal(R.get('lose1').float > R.get('eng1').float, true);
});

test('verankerter Zielmeilenstein zieht den minFloat nicht auf 0', () => {
  // Regressionstest: `ziel` ist Senke → Puffer 0 per Ankerregel. Zählte er in
  // den minFloat, wäre kein einziger Vorgänger je kritisch.
  const tasks = [
    t('a', '2026-07-13T08:00', '2026-07-13T12:00'),
    t('ziel', '2026-07-15T00:00', '2026-07-15T00:00'),
  ];
  const R = computeSchedule(tasks, [{ from: 'a', to: 'ziel', type: 'FS', lag: 0 }]);
  assert.equal(R.get('ziel').float, 0, 'Anker selbst hat Puffer 0');
  assert.ok(R.get('a').float > 0, 'a hat echten Puffer bis zum Ziel');
  assert.equal(R.get('a').critical, true, 'trotzdem kritisch — es ist die bindende Kette');
});

test('Puffer erbt sich nicht über eine SF-Kante an eine Senke rückwärts', () => {
  // Regressionstest aus den Demo-Daten: fehlte c2→c3, galt c2 als Senke,
  // wurde auf sein eigenes Ende verankert und zog den Vorgänger auf Puffer 0.
  const tasks = [
    t('ms',   '2026-07-14T14:00', '2026-07-14T14:00'),
    t('zelt', '2026-07-14T08:00', '2026-07-14T16:00'),
    t('strom','2026-07-14T16:00', '2026-07-14T20:00'),
    t('ziel', '2026-07-17T00:00', '2026-07-17T00:00'),
  ];
  const R = computeSchedule(tasks, [
    { from: 'ms', to: 'zelt', type: 'SF', lag: H(2) },
    { from: 'zelt', to: 'strom', type: 'FS', lag: 0 },
    { from: 'strom', to: 'ziel', type: 'FS', lag: 0 },
  ]);
  assert.ok(R.get('zelt').float > 0, 'zelt ist keine Senke und hat echten Puffer bis zum Ziel');
});
test('isolierter Vorgang ist nie kritisch', () => {
  const R = computeSchedule([t('a', '2026-07-13T08:00', '2026-07-13T12:00')], []);
  assert.equal(R.get('a').float, 0, 'Senke → auf eigenem Ende verankert');
  assert.equal(R.get('a').critical, false, 'aber ohne Verknüpfung kein kritischer Pfad');
});
test('Meilenstein (Dauer 0) bricht die Kette nicht', () => {
  const tasks = [
    t('a', '2026-07-13T08:00', '2026-07-13T12:00'),
    t('m', '2026-07-13T12:00', '2026-07-13T12:00'),
    t('b', '2026-07-13T12:00', '2026-07-13T16:00'),
  ];
  const R = computeSchedule(tasks, [
    { from: 'a', to: 'm', type: 'FS', lag: 0 },
    { from: 'm', to: 'b', type: 'FS', lag: 0 },
  ]);
  assert.equal(R.get('m').es, R.get('m').ef, 'Meilenstein hat Dauer 0');
  assert.equal(R.get('a').critical, true);
  assert.equal(R.get('m').critical, true);
});
test('Puffer über eine Kette bleibt konsistent (kein Doppelzählen)', () => {
  const tasks = [
    t('a', '2026-07-13T08:00', '2026-07-13T10:00'),
    t('b', '2026-07-13T10:00', '2026-07-13T12:00'),
    t('c', '2026-07-13T16:00', '2026-07-13T18:00'),
  ];
  const R = computeSchedule(tasks, [
    { from: 'a', to: 'b', type: 'FS', lag: 0 },
    { from: 'b', to: 'c', type: 'FS', lag: 0 },
  ]);
  assert.equal(R.get('a').float, H(4), 'a erbt denselben Puffer wie b');
  assert.equal(R.get('b').float, H(4), 'nicht 8h — Puffer wird geteilt, nicht summiert');
});

console.log('\nRobustheit');
test('Abhängigkeit auf unbekannte ID wird ignoriert statt zu werfen', () => {
  const R = computeSchedule([t('a', '2026-07-13T08:00', '2026-07-13T12:00')], [{ from: 'a', to: 'weg', type: 'FS', lag: 0 }]);
  assert.equal(R.get('a').critical, false);
});
test('Sommerzeit: Dauer über den DST-Sprung bleibt in Echtzeit korrekt', () => {
  // 2026-10-25 03:00 CEST → 02:00 CET. 01:00–04:00 lokal sind real 4h.
  const tasks = [t('a', '2026-10-25T01:00', '2026-10-25T04:00')];
  const R = computeSchedule(tasks, []);
  const hours = (R.get('a').ef - R.get('a').es) / 60;
  assert.ok(hours === 3 || hours === 4, 'Dauer aus echten Zeitstempeln, nicht aus Ziffernarithmetik: ' + hours);
});

console.log('\nbyStart — eine Reihenfolge für Tabelle und Gantt');
const tt = (id, start, end, title = id) => ({ id, start, end, title });
test('sortiert nach Startzeit (08:00 vor 08:05)', () => {
  const list = [
    tt('spät', '2026-07-13T08:05', '2026-07-13T09:00'),
    tt('früh', '2026-07-13T08:00', '2026-07-13T09:00'),
  ].sort(byStart);
  assert.deepEqual(list.map((x) => x.id), ['früh', 'spät']);
});
test('gleicher Start: kürzeres Ende zuerst', () => {
  const list = [
    tt('lang', '2026-07-13T08:00', '2026-07-13T12:00'),
    tt('kurz', '2026-07-13T08:00', '2026-07-13T09:00'),
  ].sort(byStart);
  assert.deepEqual(list.map((x) => x.id), ['kurz', 'lang']);
});
test('gleicher Start und gleiches Ende: nach Titel (stabil, deckungsgleich)', () => {
  const list = [
    tt('b', '2026-07-13T08:00', '2026-07-13T09:00', 'Bravo'),
    tt('a', '2026-07-13T08:00', '2026-07-13T09:00', 'Alpha'),
  ].sort(byStart);
  assert.deepEqual(list.map((x) => x.title), ['Alpha', 'Bravo']);
});
test('Sommerzeit: Reihenfolge aus echten Zeitstempeln (toMin), nicht aus Ziffern', () => {
  // 02:30 CEST liegt real VOR 02:30 CET nach der Rückstellung am 2026-10-25.
  const list = [
    tt('nach', '2026-10-25T02:30+01:00', '2026-10-25T03:00+01:00'),
    tt('vor', '2026-10-25T02:30+02:00', '2026-10-25T03:00+02:00'),
  ].sort(byStart);
  assert.deepEqual(list.map((x) => x.id), ['vor', 'nach']);
});

console.log('\nreachable — wer hängt (mittelbar) an wem');
// Kette a → b → c, dazu d ganz für sich.
const rDeps = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];

test('vorwärts: alles, was NACH dem Vorgang kommt — inklusive er selbst', () => {
  assert.deepEqual([...reachable(rDeps, 'a', 'nach')].sort(), ['a', 'b', 'c']);
});
test('rückwärts: alles, was VOR dem Vorgang liegt — inklusive er selbst', () => {
  assert.deepEqual([...reachable(rDeps, 'c', 'vor')].sort(), ['a', 'b', 'c']);
});
test('mitten in der Kette sieht jede Richtung nur ihre Hälfte', () => {
  assert.deepEqual([...reachable(rDeps, 'b', 'nach')].sort(), ['b', 'c']);
  assert.deepEqual([...reachable(rDeps, 'b', 'vor')].sort(), ['a', 'b']);
});
test('ohne Verknüpfungen bleibt nur der Vorgang selbst', () => {
  assert.deepEqual([...reachable([], 'a', 'nach')], ['a']);
  assert.deepEqual([...reachable(rDeps, 'd', 'nach')], ['d']);
});
test('Raute: beide Zweige zählen, jeder Knoten nur einmal', () => {
  // a → b → d und a → c → d
  const raute = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'c', to: 'd' }];
  assert.deepEqual([...reachable(raute, 'a', 'nach')].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...reachable(raute, 'd', 'vor')].sort(), ['a', 'b', 'c', 'd']);
});
test('ein Ring in den Daten lässt die Suche nicht hängen', () => {
  // Der Store verbietet Ringe, aber reachable darf an Altdaten nicht ewig laufen.
  const ring = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }];
  assert.deepEqual([...reachable(ring, 'a', 'nach')].sort(), ['a', 'b']);
});

console.log('\ncandidateGroups — Verknüpfungs-Picker');
const cgTasks = [
  { id: 's', gewerk: 'g1', title: 'Selbst', start: '2026-07-13T08:00', end: '2026-07-13T09:00' },
  { id: 'a', gewerk: 'g1', title: 'Anlieferung', start: '2026-07-13T10:00', end: '2026-07-13T12:00' },
  { id: 'b', gewerk: 'g1', title: 'Podest', start: '2026-07-13T08:30', end: '2026-07-13T09:30' },
  { id: 'c', gewerk: 'g2', title: 'Motoren hängen', start: '2026-07-13T07:00', end: '2026-07-13T08:00' },
  { id: 'p', gewerk: 'projekt', title: 'Doors', start: '2026-07-14T18:00', end: '2026-07-14T18:00' },
];
const cgGewerke = [{ id: 'g1', name: 'Bühne', sort: 0 }, { id: 'g2', name: 'Rigging', sort: 1 }];
const cg = (extra) => candidateGroups({ tasks: cgTasks, gewerke: cgGewerke, deps: [], selfId: 's', ...extra });

test('lässt den Vorgang selbst weg', () => {
  const ids = cg().flatMap((g) => g.items.map((t) => t.id));
  assert.equal(ids.includes('s'), false);
});
test('lässt bereits Verknüpfte weg (beide Richtungen)', () => {
  const g = cg({ deps: [{ from: 'a', to: 's' }, { from: 's', to: 'c' }] });
  const ids = g.flatMap((x) => x.items.map((t) => t.id));
  assert.deepEqual(ids.includes('a'), false);
  assert.deepEqual(ids.includes('c'), false);
});
test('gruppiert nach Gewerk (nach sort), je Gewerk nach Start', () => {
  const g = cg();
  assert.deepEqual(g.map((x) => x.gewerk.id), ['g1', 'g2', 'projekt']);
  assert.deepEqual(g[0].items.map((t) => t.id), ['b', 'a'], 'Podest 08:30 vor Anlieferung 10:00');
});
test('Query filtert auf Titel', () => {
  const g = cg({ query: 'moto' });
  const ids = g.flatMap((x) => x.items.map((t) => t.id));
  assert.deepEqual(ids, ['c']);
});
test('Query filtert auch auf Gewerkname', () => {
  const g = cg({ query: 'rigg' });
  assert.deepEqual(g.map((x) => x.gewerk.id), ['g2']);
});
test('leeres Query = alle Kandidaten', () => {
  const n = cg({ query: '' }).flatMap((x) => x.items).length;
  assert.equal(n, 4, 'a, b, c, p (ohne selbst)');
});
test('Projekt-Zieltermine als eigene Gruppe am Ende', () => {
  const g = cg();
  assert.equal(g[g.length - 1].gewerk.id, 'projekt');
});
test('bietet keinen Kandidaten an, der einen Ring ergäbe', () => {
  // Der Kandidat wird VORGÄNGER des gewählten Vorgangs (inspector.js:
  // dep {from: Kandidat, to: t}). Ein Ring entsteht also, wenn der Kandidat
  // schon HINTER t hängt — hier: s → a → b, also wäre b → s ein Ring.
  // «Bereits verknüpft» greift nicht: b und s hängen nicht direkt zusammen.
  const ids = cg({ deps: [{ from: 's', to: 'a' }, { from: 'a', to: 'b' }] })
    .flatMap((x) => x.items.map((t) => t.id));
  assert.equal(ids.includes('b'), false, 'b hängt hinter s — b → s wäre ein Ring');
  assert.equal(ids.includes('c'), true, 'c hängt an nichts und bleibt wählbar');
});
test('die Gegenrichtung bleibt erlaubt', () => {
  // Nur weil t hinter etwas hängt, ist das nichts wert für die Sperre: hier
  // liegt a VOR s, ein zweiter Weg a → s wäre bloß eine Dopplung, kein Ring.
  // Gesperrt wird ausschließlich, was hinter s liegt.
  const ids = cg({ deps: [{ from: 'a', to: 'c' }, { from: 'c', to: 's' }] })
    .flatMap((x) => x.items.map((t) => t.id));
  assert.equal(ids.includes('a'), true, 'a liegt vor s — als Vorgänger unbedenklich');
});

// ── Serien: eine Zeile je Vorgangsname, ein Balken je Termin ─────────────────
console.log('\nSerien & Spuren');

const s = (id, title, start, end) => ({ id, title, start, end });

test('gleicher Titel = eine Serie, ein Balken je Termin', () => {
  const r = seriesRows([
    s('a', 'Aufbau Bühne', '2026-08-24T08:00', '2026-08-24T18:00'),
    s('b', 'Aufbau Bühne', '2026-08-25T08:00', '2026-08-25T18:00'),
    s('c', 'Aufbau Bühne', '2026-08-26T08:00', '2026-08-26T18:00'),
  ]);
  assert.equal(r.length, 1, 'drei Tage, eine Zeile');
  assert.equal(r[0].title, 'Aufbau Bühne');
  assert.equal(r[0].tasks.length, 3);
  assert.equal(r[0].lanes, 1, 'aufeinanderfolgende Tage brauchen keine zweite Spur');
});

test('verschiedene Titel bleiben getrennt', () => {
  const r = seriesRows([
    s('a', 'Aufbau Bühne', '2026-08-24T08:00', '2026-08-24T18:00'),
    s('b', 'Abbau Bühne', '2026-08-31T08:00', '2026-08-31T18:00'),
  ]);
  assert.deepEqual(r.map((x) => x.title), ['Aufbau Bühne', 'Abbau Bühne']);
});

test('Serien stehen nach dem frühesten Termin — wie byStart', () => {
  const r = seriesRows([
    s('spaet', 'Abbau', '2026-08-31T08:00', '2026-08-31T18:00'),
    s('frueh2', 'Aufbau', '2026-08-25T08:00', '2026-08-25T18:00'),
    s('frueh1', 'Aufbau', '2026-08-24T08:00', '2026-08-24T18:00'),
  ]);
  assert.deepEqual(r.map((x) => x.title), ['Aufbau', 'Abbau']);
  assert.deepEqual(r[0].tasks.map((t) => t.id), ['frueh1', 'frueh2'], 'innerhalb der Serie nach Start');
});

test('überlappende Balken bekommen eine zweite Spur', () => {
  // Der echte Fall: am 29.08. laufen zwei SITECREW-Trupps parallel.
  const r = seriesRows([
    s('lang', 'SITECREW', '2026-08-29T08:00', '2026-08-29T23:00'),
    s('kurz', 'SITECREW', '2026-08-29T08:00', '2026-08-29T14:00'),
  ]);
  assert.equal(r[0].lanes, 2);
  assert.notEqual(r[0].laneOf.get('lang'), r[0].laneOf.get('kurz'), 'dürfen nicht übereinanderliegen');
});

test('Balken, die sich nur berühren, teilen sich eine Spur', () => {
  const r = seriesRows([
    s('a', 'Schicht', '2026-08-29T08:00', '2026-08-29T14:00'),
    s('b', 'Schicht', '2026-08-29T14:00', '2026-08-29T20:00'),
  ]);
  assert.equal(r[0].lanes, 1, 'Ende = Start ist keine Überlappung');
  assert.equal(r[0].laneOf.get('a'), r[0].laneOf.get('b'));
});

test('die Spur wird wiederverwendet, sobald sie frei ist', () => {
  const r = seriesRows([
    s('a', 'X', '2026-08-24T08:00', '2026-08-24T18:00'),
    s('b', 'X', '2026-08-24T09:00', '2026-08-24T12:00'),   // überlappt a → Spur 1
    s('c', 'X', '2026-08-25T08:00', '2026-08-25T18:00'),   // frei → wieder Spur 0
  ]);
  assert.equal(r[0].lanes, 2, 'nicht drei Spuren für drei Balken');
  assert.equal(r[0].laneOf.get('c'), r[0].laneOf.get('a'));
});

test('zwei Meilensteine am selben Termin liegen nicht übereinander', () => {
  const r = seriesRows([
    s('a', 'Abnahme', '2026-08-28T16:00', '2026-08-28T16:00'),
    s('b', 'Abnahme', '2026-08-28T16:00', '2026-08-28T16:00'),
  ]);
  assert.equal(r[0].lanes, 2, 'Rauten ohne Dauer brauchen trotzdem getrennte Spuren');
});

test('leere Eingabe liefert keine Zeilen statt zu werfen', () => {
  assert.deepEqual(seriesRows([]), []);
});

// ── Tageszuschnitt für die Druckblätter ─────────────────────────────────────
console.log('\nTagesscheiben');

const TAG = '2026-08-30';
const A = toMin(TAG + 'T00:00');
const ts = (id, start, end, title = id) => ({ id, title, start, end });

test('ein Vorgang mitten am Tag bleibt unangetastet', () => {
  const r = tagesScheiben([ts('a', '2026-08-30T08:00', '2026-08-30T18:00')], TAG);
  assert.equal(r.length, 1);
  assert.equal(r[0].von, A + 8 * 60);
  assert.equal(r[0].bis, A + 18 * 60);
  assert.equal(r[0].schnittLinks, false);
  assert.equal(r[0].schnittRechts, false);
});

test('was in die Nacht läuft, wird rechts angeschnitten', () => {
  // HELFER tse am 30.08.: 22:00 bis 04:00 am Folgetag
  const r = tagesScheiben([ts('a', '2026-08-30T22:00', '2026-08-31T04:00')], TAG);
  assert.equal(r[0].von, A + 22 * 60);
  assert.equal(r[0].bis, A + 1440, 'endet an der Blattkante');
  assert.equal(r[0].schnittRechts, true);
  assert.equal(r[0].schnittLinks, false);
});

test('derselbe Vorgang erscheint am Folgetag links angeschnitten', () => {
  const r = tagesScheiben([ts('a', '2026-08-30T22:00', '2026-08-31T04:00')], '2026-08-31');
  const B = toMin('2026-08-31T00:00');
  assert.equal(r[0].von, B, 'beginnt an der Blattkante');
  assert.equal(r[0].bis, B + 4 * 60);
  assert.equal(r[0].schnittLinks, true);
  assert.equal(r[0].schnittRechts, false);
});

test('ein Vorgang über den ganzen Tag ist beidseitig angeschnitten', () => {
  const r = tagesScheiben([ts('a', '2026-08-29T23:00', '2026-08-31T08:00')], TAG);
  assert.equal(r[0].von, A);
  assert.equal(r[0].bis, A + 1440);
  assert.equal(r[0].schnittLinks, true);
  assert.equal(r[0].schnittRechts, true);
});

test('was den Tag nicht berührt, fällt weg', () => {
  const r = tagesScheiben([
    ts('davor', '2026-08-29T08:00', '2026-08-29T18:00'),
    ts('danach', '2026-08-31T08:00', '2026-08-31T18:00'),
  ], TAG);
  assert.deepEqual(r, []);
});

test('Mitternacht gehört dem Folgetag, nicht dem Vortag', () => {
  // Ein Balken, der um 00:00 endet, gehört NICHT mehr auf das Blatt des Vortags —
  // sonst hinge an dessen rechter Kante ein Strich ohne Dauer.
  assert.deepEqual(tagesScheiben([ts('a', '2026-08-29T22:00', '2026-08-30T00:00')], TAG), []);
  const r = tagesScheiben([ts('a', '2026-08-30T00:00', '2026-08-30T08:00')], TAG);
  assert.equal(r.length, 1, 'der um 00:00 beginnt, gehört auf dieses Blatt');
});

test('ein Meilenstein ohne Dauer fällt nicht durchs Raster', () => {
  const r = tagesScheiben([ts('m', '2026-08-30T00:00', '2026-08-30T00:00')], TAG);
  assert.equal(r.length, 1, 'Raute um 00:00');
  assert.equal(r[0].von, r[0].bis);
});

test('nach Beginn sortiert', () => {
  const r = tagesScheiben([
    ts('spaet', '2026-08-30T18:00', '2026-08-30T20:00'),
    ts('frueh', '2026-08-30T08:00', '2026-08-30T10:00'),
  ], TAG);
  assert.deepEqual(r.map((x) => x.task.id), ['frueh', 'spaet']);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
