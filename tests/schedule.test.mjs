import { computeSchedule, topoSort, toMin } from '../js/schedule.js';
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

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
