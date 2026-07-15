import { findConflicts, resolveConflictsCmd, parseDuration, fmtDuration } from '../js/conflicts.js';
import { createStore } from '../js/store.js';
import { computeSchedule } from '../js/schedule.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const T = (id, gewerk, title, start, end, extra = {}) =>
  ({ id, gewerk, title, start, end, milestone: false, progress: 0, status: 'geplant', crew: null, ...extra });

const seed = (tasks, deps) => ({
  project: { id: 'p', name: 'T', start: '2026-07-13T00:00', end: '2026-07-20T00:00', timezone: 'Europe/Berlin' },
  gewerke: [{ id: 'g1', name: 'Bühne', sort: 0, slot: 0 }, { id: 'g2', name: 'Licht', sort: 1, slot: 1 }],
  tasks, deps,
});

console.log('\nKonflikte finden');
test('stimmiger Plan hat keine Konflikte', () => {
  const s = seed(
    [T('a', 'g1', 'Podest', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'Licht', '2026-07-13T12:00', '2026-07-13T16:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  assert.deepEqual(findConflicts(s), []);
});

test('Nachfolger startet zu früh → Konflikt', () => {
  // b müsste um 12:00 starten, startet aber um 10:00
  const s = seed(
    [T('a', 'g1', 'Podest', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'Licht', '2026-07-13T10:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  const c = findConflicts(s);
  assert.equal(c.length, 1);
  assert.equal(c[0].taskId, 'b');
});

test('Konflikt beziffert die Verspätung', () => {
  const s = seed(
    [T('a', 'g1', 'Podest', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'Licht', '2026-07-13T10:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  assert.equal(findConflicts(s)[0].shortByMin, 120, '2 Stunden zu früh');
});

test('Konflikt nennt den Vorgänger beim Namen', () => {
  const s = seed(
    [T('a', 'g1', 'Podest & Unterbau', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'Licht', '2026-07-13T10:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  const c = findConflicts(s)[0];
  assert.match(c.message, /Podest & Unterbau/, 'Meldung: ' + c.message);
});

test('mehrere Vorgänger: der bindende wird genannt', () => {
  const s = seed(
    [T('a', 'g1', 'Früh', '2026-07-13T08:00', '2026-07-13T10:00'),
     T('b', 'g1', 'Spät', '2026-07-13T08:00', '2026-07-13T16:00'),
     T('c', 'g2', 'Ziel', '2026-07-13T12:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'c', type: 'FS', lag: 0 },
     { id: 'd2', from: 'b', to: 'c', type: 'FS', lag: 0 }]);
  const conf = findConflicts(s)[0];
  assert.match(conf.message, /Spät/, 'der spätere Vorgänger bindet: ' + conf.message);
});

test('Konflikt über Lag hinweg', () => {
  const s = seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T12:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 180 }]); // muss 15:00 starten
  assert.equal(findConflicts(s)[0].shortByMin, 180);
});

test('negativer Lag erlaubt Überlappung ohne Konflikt', () => {
  const s = seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T10:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: -120 }]);
  assert.deepEqual(findConflicts(s), []);
});

test('unverknüpfter Vorgang erzeugt nie einen Konflikt', () => {
  const s = seed([T('a', 'g1', 'Allein', '2026-07-13T08:00', '2026-07-13T12:00')], []);
  assert.deepEqual(findConflicts(s), []);
});

test('Konflikt pflanzt sich die Kette hinunter fort', () => {
  // a→b→c. b startet 2h zu früh. Sobald b korrekt läge, endete es 2h später —
  // dann stimmt auch c nicht mehr. Beide zu melden ist ehrlich: nur b zu zeigen
  // wäre Hase-und-Igel, c tauchte erst nach dem Verschieben von b auf.
  const s = seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g1', 'B', '2026-07-13T10:00', '2026-07-13T14:00'),
     T('c', 'g2', 'C', '2026-07-13T14:00', '2026-07-13T16:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 },
     { id: 'd2', from: 'b', to: 'c', type: 'FS', lag: 0 }]);
  const c = findConflicts(s);
  assert.deepEqual(c.map((x) => x.taskId), ['b', 'c']);
  assert.equal(c[0].shortByMin, 120);
  assert.equal(c[1].shortByMin, 120, 'die Verspätung wandert mit, sie summiert sich nicht');
});

test('Ring wirft nicht, sondern liefert eine Meldung', () => {
  // Der Store lässt Ringe nicht zu, aber ein importiertes JSON könnte einen haben.
  const s = seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T12:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 },
     { id: 'd2', from: 'b', to: 'a', type: 'FS', lag: 0 }]);
  let r;
  assert.doesNotThrow(() => { r = findConflicts(s); });
  assert.equal(r.length, 1);
  assert.match(r[0].message, /Ring/i);
});

test('vorab gerechneter Terminplan liefert dasselbe Ergebnis', () => {
  // Der Gantt reicht seine Rechnung weiter, statt sie zu wiederholen. Beide
  // Wege müssen deckungsgleich sein, sonst zeigt die Tabelle etwas anderes
  // als der Gantt.
  const s = seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T10:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  const ohne = findConflicts(s);
  const mit = findConflicts(s, computeSchedule(s.tasks, s.deps));
  assert.deepEqual(mit, ohne);
});
test('ohne vorab rechnet findConflicts weiterhin selbst', () => {
  const s = seed([T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00')], []);
  assert.deepEqual(findConflicts(s), []);
});

console.log('\nKonflikte auflösen');
test('Auflösen liefert einen Sammelbefehl', () => {
  const s = seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T10:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  const cmd = resolveConflictsCmd(s);
  assert.equal(cmd.type, 'batch');
  assert.equal(cmd.cmds.length, 1);
  assert.equal(cmd.cmds[0].type, 'moveTask');
});

test('Auflösen behebt den Konflikt tatsächlich', () => {
  const st = createStore(seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T10:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]));
  st.apply(resolveConflictsCmd(st.state));
  assert.deepEqual(findConflicts(st.state), [], 'danach keine Konflikte mehr');
});

test('Auflösen erhält die Dauer des Vorgangs', () => {
  const st = createStore(seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T10:00', '2026-07-13T14:00')],  // 4h
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]));
  st.apply(resolveConflictsCmd(st.state));
  const b = st.state.tasks.find((t) => t.id === 'b');
  const h = (new Date(b.end) - new Date(b.start)) / 3600000;
  assert.equal(h, 4);
});

test('Auflösen einer Kette braucht nur einen Durchgang', () => {
  const st = createStore(seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g1', 'B', '2026-07-13T08:00', '2026-07-13T10:00'),
     T('c', 'g2', 'C', '2026-07-13T08:00', '2026-07-13T09:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 },
     { id: 'd2', from: 'b', to: 'c', type: 'FS', lag: 0 }]));
  st.apply(resolveConflictsCmd(st.state));
  assert.deepEqual(findConflicts(st.state), [], 'die ganze Kette sitzt');
});

test('Auflösen ist mit einem ⌘Z zurückgenommen', () => {
  const st = createStore(seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T10:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]));
  const before = JSON.stringify(st.state);
  st.apply(resolveConflictsCmd(st.state));
  st.undo();
  assert.equal(JSON.stringify(st.state), before);
});

test('ohne Konflikte ist der Sammelbefehl leer', () => {
  const s = seed(
    [T('a', 'g1', 'A', '2026-07-13T08:00', '2026-07-13T12:00'),
     T('b', 'g2', 'B', '2026-07-13T12:00', '2026-07-13T14:00')],
    [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }]);
  assert.equal(resolveConflictsCmd(s).cmds.length, 0);
});

console.log('\nDauer-Kurzform (Tabelleneingabe)');
test('Stunden', () => { assert.equal(parseDuration('4h'), 240); });
test('Stunden mit Komma', () => { assert.equal(parseDuration('1,5h'), 90); });
test('Stunden mit Punkt', () => { assert.equal(parseDuration('1.5h'), 90); });
test('führende Null darf fehlen: «.5h» ist eine halbe Stunde', () => {
  // Regression: die Regex verlangte eine Ziffer VOR dem Punkt und las «.5h»
  // als «5h» — ein stiller Faktor 10. Genau die Sorte Fehler, die man erst
  // bemerkt, wenn der Plan nicht aufgeht.
  assert.equal(parseDuration('.5h'), 30);
});
test('führende Null darf auch beim Komma fehlen', () => {
  assert.equal(parseDuration(',5h'), 30);
});
test('führende Null bei Tagen', () => {
  assert.equal(parseDuration('.5t'), 720);
});
test('ein einzelner Punkt ist keine Zahl', () => {
  assert.equal(parseDuration('.h'), null);
});
test('mehrfach dieselbe Einheit wird nicht heimlich summiert', () => {
  // «4h 4h» ist ein Vertipper, keine Angabe von 8 Stunden.
  assert.equal(parseDuration('4h 4h'), null);
});
test('doppelte Einheit ist Unfug', () => {
  assert.equal(parseDuration('4hh'), null);
});
test('absurde Dauern werden abgelehnt', () => {
  // «99999t» sind 273 Jahre — das ist ein Vertipper, kein Vorgang.
  assert.equal(parseDuration('99999t'), null);
});
test('ein Jahr ist gerade noch erlaubt', () => {
  assert.equal(parseDuration('365t'), 365 * 1440);
});
test('Minuten', () => { assert.equal(parseDuration('90m'), 90); });
test('Tage', () => { assert.equal(parseDuration('2t'), 2880); });
test('Tage englisch', () => { assert.equal(parseDuration('2d'), 2880); });
test('blanke Zahl gilt als Stunden', () => { assert.equal(parseDuration('8'), 480); });
test('Leerzeichen stören nicht', () => { assert.equal(parseDuration(' 4 h '), 240); });
test('Großschreibung stört nicht', () => { assert.equal(parseDuration('4H'), 240); });
test('kombiniert: Tage und Stunden', () => { assert.equal(parseDuration('1t 4h'), 1680); });
test('Unsinn liefert null statt zu raten', () => { assert.equal(parseDuration('bald'), null); });
test('leer liefert null', () => { assert.equal(parseDuration(''), null); });
test('negativ liefert null', () => { assert.equal(parseDuration('-2h'), null); });
test('null liefert null statt zu werfen', () => { assert.equal(parseDuration(null), null); });

console.log('\nDauer anzeigen');
test('Minuten unter einer Stunde', () => { assert.equal(fmtDuration(45), '45m'); });
test('glatte Stunden', () => { assert.equal(fmtDuration(240), '4h'); });
test('krumme Stunden mit Komma', () => { assert.equal(fmtDuration(90), '1,5h'); });
test('Stunden und Minuten', () => { assert.equal(fmtDuration(100), '1h 40m'); });
test('glatte Tage', () => { assert.equal(fmtDuration(2880), '2t'); });
test('Tage und Stunden', () => { assert.equal(fmtDuration(1680), '1t 4h'); });
test('null Minuten = Meilenstein', () => { assert.equal(fmtDuration(0), '0m'); });
test('Hin und zurück bleibt gleich', () => {
  for (const m of [15, 45, 90, 100, 240, 480, 1440, 1680, 2880]) {
    assert.equal(parseDuration(fmtDuration(m)), m, 'bei ' + m + ' min → ' + fmtDuration(m));
  }
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
