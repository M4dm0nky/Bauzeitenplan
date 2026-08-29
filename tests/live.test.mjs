import { runningAt, delaysAt, nextUp, liveStats, verschoben, versatzText } from '../js/live.js';
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

console.log('\nVersatz — die Ansage vom Pult');
test('Delay ist plus und rot', () => {
  assert.deepEqual(versatzText(5), { text: '5 Min Delay', klasse: 'is-late' });
});
test('Vorlauf ist minus und grün', () => {
  assert.deepEqual(versatzText(-3), { text: '3 Min vor Plan', klasse: 'is-early' });
});
test('null Versatz sagt «im Plan», ohne Farbe', () => {
  assert.deepEqual(versatzText(0), { text: 'im Plan', klasse: '' });
});
test('immer in MINUTEN, nie in Stunden', () => {
  // Bei einem Ablauf zählt man Minuten — «1,5h Delay» müsste man erst umrechnen.
  assert.equal(versatzText(90).text, '90 Min Delay');
});
test('fehlender Wert ist kein Absturz, sondern «im Plan»', () => {
  assert.equal(versatzText(undefined).text, 'im Plan');
  assert.equal(versatzText(null).text, 'im Plan');
});

console.log('\nVerschobene Zeiten');
test('fünf Minuten später', () => {
  assert.equal(verschoben('2026-07-15T20:00', 5), '2026-07-15T20:05');
});
test('Vorlauf schiebt zurück', () => {
  assert.equal(verschoben('2026-07-15T20:00', -3), '2026-07-15T19:57');
});
test('über Mitternacht wandert das Datum mit', () => {
  assert.equal(verschoben('2026-07-15T23:58', 5), '2026-07-16T00:03');
});
test('ohne Versatz bleibt der Zeitstempel unangetastet', () => {
  assert.equal(verschoben('2026-07-15T20:00', 0), '2026-07-15T20:00');
});
test('addiert ECHTE Minuten, nicht Ziffern auf dem String', () => {
  // Der eigentliche Punkt: die Differenz muss in jeder Zone und über jeden
  // Zeitumstellungs-Sprung exakt der Versatz sein. Rechnete verschoben() auf
  // den Datumsziffern, wäre sie einmal im Jahr um 60 Minuten falsch.
  // (Die Rückstellungsnacht steht im Test darunter — dort ist die Wanduhrzeit
  // selbst zweideutig, und zwar unabhängig vom Versatz.)
  for (const iso of ['2026-03-29T01:30', '2026-10-25T04:00', '2026-07-15T12:00']) {
    for (const v of [5, -5, 90, 1440]) {
      assert.equal(toMin(verschoben(iso, v)) - toMin(iso), v, `${iso} um ${v}`);
    }
  }
});
test('in der doppelten Stunde stimmt die ANZEIGE, der Rückweg bleibt zweideutig', () => {
  // Bekannte Grenze des Datenmodells, keine Eigenheit des Versatzes: Zeiten
  // sind lokale Strings OHNE Zone, und am 25.10.2026 gibt es 02:00 bis 03:00
  // zweimal. Die Anzeige ist trotzdem richtig — 01:30 plus 90 echte Minuten
  // IST die zweite 02:00. Nur wer diesen String wieder einliest, bekommt die
  // erste zurück und verliert eine Stunde. Angezeigt wird er, eingelesen nicht.
  const jan = new Date('2026-01-15T12:00').getTimezoneOffset();
  const jul = new Date('2026-07-15T12:00').getTimezoneOffset();
  if (jan === jul) { console.log('      (übersprungen: Systemzone ohne Sommerzeit)'); return; }
  assert.equal(verschoben('2026-10-25T01:30', 90), '2026-10-25T02:00');
  assert.equal(verschoben('2026-10-25T01:30', 30), '2026-10-25T02:00', 'dieselbe Wanduhrzeit, 60 Min früher');
});
test('an der Zeitumstellung springt die UHRZEIT anders als die Minuten', () => {
  // Nur dort aussagekräftig, wo die Systemzone wirklich umstellt — auf einem
  // Rechner in UTC gibt es keinen Sprung, und der Test hätte nichts zu zeigen.
  const jan = new Date('2026-01-15T12:00').getTimezoneOffset();
  const jul = new Date('2026-07-15T12:00').getTimezoneOffset();
  if (jan === jul) { console.log('      (übersprungen: Systemzone ohne Sommerzeit)'); return; }
  // 2026 stellt Europa am 29.03. um 02:00 auf 03:00 vor: 01:30 + 60 echte
  // Minuten ist 03:30 nach der Uhr, nicht 02:30.
  const raus = verschoben('2026-03-29T01:30', 60);
  assert.equal(toMin(raus) - toMin('2026-03-29T01:30'), 60, 'echte Minuten stimmen');
  assert.notEqual(raus.slice(11), '02:30', 'die Wanduhr springt über die Lücke');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
