import { runningAt, delaysAt, nextUp, liveStats } from '../js/live.js';
import { toMin } from '../js/schedule.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const T = (id, title, start, end, extra = {}) =>
  ({ id, gewerk: 'g1', title, start, end, milestone: false, progress: 0, status: 'geplant', crew: null, ...extra });
const M = (id, title, at, extra = {}) =>
  ({ id, gewerk: 'g1', title, start: at, end: at, milestone: true, progress: 0, status: 'geplant', ...extra });

const NOW = toMin('2026-07-15T12:00');

console.log('\nWas läuft gerade?');
test('Vorgang um den Zeitpunkt herum läuft', () => {
  const t = [T('a', 'A', '2026-07-15T10:00', '2026-07-15T14:00')];
  assert.deepEqual([...runningAt(t, NOW)], ['a']);
});
test('Vorgang davor läuft nicht', () => {
  const t = [T('a', 'A', '2026-07-15T08:00', '2026-07-15T10:00')];
  assert.deepEqual([...runningAt(t, NOW)], []);
});
test('Vorgang danach läuft nicht', () => {
  const t = [T('a', 'A', '2026-07-15T14:00', '2026-07-15T16:00')];
  assert.deepEqual([...runningAt(t, NOW)], []);
});
test('Start genau jetzt zählt als laufend', () => {
  const t = [T('a', 'A', '2026-07-15T12:00', '2026-07-15T14:00')];
  assert.deepEqual([...runningAt(t, NOW)], ['a']);
});
test('Ende genau jetzt zählt NICHT mehr als laufend', () => {
  // Sonst leuchtete ein Vorgang noch, dessen Zeit abgelaufen ist.
  const t = [T('a', 'A', '2026-07-15T10:00', '2026-07-15T12:00')];
  assert.deepEqual([...runningAt(t, NOW)], []);
});
test('Meilensteine laufen nie — sie haben keine Dauer', () => {
  const t = [M('m', 'Doors', '2026-07-15T12:00')];
  assert.deepEqual([...runningAt(t, NOW)], []);
});
test('Meilenstein mit Dauer (aus kaputtem Import) läuft trotzdem nicht', () => {
  // Der Store lässt das nicht zu, ein importiertes JSON schon. Ohne die
  // Meilenstein-Abfrage in runningAt würde so einer als «läuft» leuchten —
  // der Test oben deckt das NICHT ab, weil dort Start = Ende ist und die
  // Zeitprüfung ihn schon herausfiltert.
  const t = [{ id: 'm', gewerk: 'g1', title: 'Kaputt', start: '2026-07-15T10:00',
               end: '2026-07-15T14:00', milestone: true, status: 'geplant' }];
  assert.deepEqual([...runningAt(t, NOW)], []);
});
test('fertige Vorgänge laufen nicht, auch wenn ihre Zeit noch läuft', () => {
  const t = [T('a', 'A', '2026-07-15T10:00', '2026-07-15T14:00', { status: 'fertig' })];
  assert.deepEqual([...runningAt(t, NOW)], []);
});
test('mehrere gleichzeitig', () => {
  const t = [
    T('a', 'A', '2026-07-15T10:00', '2026-07-15T14:00'),
    T('b', 'B', '2026-07-15T11:00', '2026-07-15T13:00'),
    T('c', 'C', '2026-07-15T14:00', '2026-07-15T16:00'),
  ];
  assert.deepEqual([...runningAt(t, NOW)].sort(), ['a', 'b']);
});

console.log('\nVerzug — Plan gegen Wirklichkeit');
test('geplant, Start liegt zurück → sollte laufen', () => {
  const t = [T('a', 'A', '2026-07-15T11:40', '2026-07-15T14:00')];
  const d = delaysAt(t, NOW);
  assert.equal(d.length, 1);
  assert.equal(d[0].taskId, 'a');
  assert.equal(d[0].kind, 'start');
  assert.equal(d[0].byMin, 20);
  assert.match(d[0].message, /sollte seit 20m laufen/);
});
test('läuft, Ende liegt zurück → sollte fertig sein', () => {
  const t = [T('a', 'A', '2026-07-15T08:00', '2026-07-15T11:20', { status: 'laeuft' })];
  const d = delaysAt(t, NOW);
  assert.equal(d[0].kind, 'ende');
  assert.equal(d[0].byMin, 40);
  assert.match(d[0].message, /sollte seit 40m fertig sein/);
});
test('fertig ist NIE im Verzug, egal wie alt', () => {
  // Der Status ist eine Aussage von Menschen und schlägt die Uhr.
  const t = [T('a', 'A', '2026-01-01T08:00', '2026-01-01T09:00', { status: 'fertig' })];
  assert.deepEqual(delaysAt(t, NOW), []);
});
test('geplant, Start liegt in der Zukunft → kein Verzug', () => {
  const t = [T('a', 'A', '2026-07-15T14:00', '2026-07-15T16:00')];
  assert.deepEqual(delaysAt(t, NOW), []);
});
test('läuft und ist noch in der Zeit → kein Verzug', () => {
  const t = [T('a', 'A', '2026-07-15T10:00', '2026-07-15T14:00', { status: 'laeuft' })];
  assert.deepEqual(delaysAt(t, NOW), []);
});
test('läuft, aber der Start lag zurück → kein Verzug, es läuft ja', () => {
  const t = [T('a', 'A', '2026-07-15T08:00', '2026-07-15T14:00', { status: 'laeuft' })];
  assert.deepEqual(delaysAt(t, NOW), []);
});
test('überfälliger Meilenstein', () => {
  const t = [M('m', 'Bühne steht', '2026-07-15T09:00')];
  const d = delaysAt(t, NOW);
  assert.equal(d[0].kind, 'meilenstein');
  assert.equal(d[0].byMin, 180);
  assert.match(d[0].message, /überfällig/i);
});
test('erledigter Meilenstein ist nicht überfällig', () => {
  const t = [M('m', 'Bühne steht', '2026-07-15T09:00', { status: 'fertig' })];
  assert.deepEqual(delaysAt(t, NOW), []);
});
test('Verzug ist nach Größe sortiert — das Schlimmste zuerst', () => {
  const t = [
    T('klein', 'Klein', '2026-07-15T11:50', '2026-07-15T14:00'),
    T('gross', 'Groß', '2026-07-15T09:00', '2026-07-15T14:00'),
  ];
  assert.deepEqual(delaysAt(t, NOW).map((x) => x.taskId), ['gross', 'klein']);
});
test('eine Minute Verzug wird noch nicht gemeldet', () => {
  // Sonst ist ab Sekunde 1 nach dem Start alles rot.
  const t = [T('a', 'A', '2026-07-15T11:59', '2026-07-15T14:00')];
  assert.deepEqual(delaysAt(t, NOW), []);
});
test('Verzugsmeldung nennt den Vorgang beim Namen', () => {
  const t = [T('a', 'Scheinwerfer hängen', '2026-07-15T11:00', '2026-07-15T14:00')];
  assert.match(delaysAt(t, NOW)[0].title, /Scheinwerfer hängen/);
});

console.log('\nWas kommt als Nächstes?');
test('nächster Vorgang mit Vorlaufzeit', () => {
  const t = [
    T('a', 'A', '2026-07-15T14:00', '2026-07-15T16:00'),
    T('b', 'B', '2026-07-15T13:00', '2026-07-15T15:00'),
  ];
  const n = nextUp(t, NOW);
  assert.equal(n.taskId, 'b', 'der frühere zuerst');
  assert.equal(n.inMin, 60);
});
test('nichts mehr → null statt Absturz', () => {
  const t = [T('a', 'A', '2026-07-15T08:00', '2026-07-15T10:00')];
  assert.equal(nextUp(t, NOW), null);
});
test('fertige Vorgänge kommen nicht als Nächstes', () => {
  const t = [T('a', 'A', '2026-07-15T14:00', '2026-07-15T16:00', { status: 'fertig' })];
  assert.equal(nextUp(t, NOW), null);
});

console.log('\nZusammenfassung für den Kopf');
test('zählt laufend und im Verzug', () => {
  const t = [
    T('a', 'A', '2026-07-15T10:00', '2026-07-15T14:00', { status: 'laeuft' }),
    T('b', 'B', '2026-07-15T11:00', '2026-07-15T13:00'),          // läuft laut Plan, aber geplant → Verzug
    T('c', 'C', '2026-07-15T14:00', '2026-07-15T16:00'),
  ];
  const s = liveStats(t, NOW);
  assert.equal(s.running, 2, 'a und b laufen laut Plan');
  assert.equal(s.late, 1, 'nur b hängt');
});
test('leerer Plan stürzt nicht ab', () => {
  const s = liveStats([], NOW);
  assert.equal(s.running, 0);
  assert.equal(s.late, 0);
  assert.equal(s.next, null);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
