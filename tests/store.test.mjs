import { createStore } from '../js/store.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

// Kleinster sinnvoller Zustand: zwei Gewerke, zwei Vorgänge, eine Abhängigkeit.
const seed = () => ({
  project: { id: 'p1', name: 'Test', venue: '', start: '2026-07-13T00:00', end: '2026-07-20T00:00', timezone: 'Europe/Berlin' },
  gewerke: [
    { id: 'buehne', name: 'Bühne', sort: 0 },
    { id: 'licht', name: 'Licht', sort: 1 },
  ],
  tasks: [
    { id: 'a', gewerk: 'buehne', title: 'Podest', start: '2026-07-13T08:00', end: '2026-07-13T12:00', milestone: false, progress: 0, status: 'geplant', crew: 4 },
    { id: 'b', gewerk: 'licht', title: 'Scheinwerfer', start: '2026-07-13T12:00', end: '2026-07-13T16:00', milestone: false, progress: 0, status: 'geplant', crew: 6 },
  ],
  deps: [{ id: 'd1', from: 'a', to: 'b', type: 'FS', lag: 0 }],
});

const taskById = (s, id) => s.state.tasks.find((t) => t.id === id);

console.log('\nGrundlagen');
test('Store gibt den Ausgangszustand heraus', () => {
  const s = createStore(seed());
  assert.equal(s.state.tasks.length, 2);
  assert.equal(s.state.project.name, 'Test');
});
test('Startzustand ist nicht ungesichert', () => {
  assert.equal(createStore(seed()).dirty, false);
});
test('Abonnenten werden bei einer Änderung benachrichtigt', () => {
  const s = createStore(seed());
  let calls = 0;
  s.subscribe(() => calls++);
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'Neu' });
  assert.equal(calls, 1);
});
test('Abmelden stoppt die Benachrichtigung', () => {
  const s = createStore(seed());
  let calls = 0;
  const off = s.subscribe(() => calls++);
  off();
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'Neu' });
  assert.equal(calls, 0);
});
test('Eine Änderung markiert den Zustand als ungesichert', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'Neu' });
  assert.equal(s.dirty, true);
});
test('markSaved räumt die Ungesichert-Marke ab', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'Neu' });
  s.markSaved();
  assert.equal(s.dirty, false);
});

console.log('\nBefehle: Vorgänge');
test('addTask legt einen Vorgang an und gibt seine id zurück', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'licht', title: 'Fokus', start: '2026-07-14T08:00', end: '2026-07-14T10:00' } });
  assert.equal(s.state.tasks.length, 3);
  assert.ok(r.id, 'gibt eine id zurück');
  assert.equal(taskById(s, r.id).title, 'Fokus');
});
test('addTask füllt fehlende Felder mit sinnvollen Vorgaben', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'licht', title: 'X', start: '2026-07-14T08:00', end: '2026-07-14T10:00' } });
  const t = taskById(s, r.id);
  assert.equal(t.status, 'geplant');
  assert.equal(t.progress, 0);
  assert.equal(t.milestone, false);
});
test('removeTask entfernt den Vorgang', () => {
  const s = createStore(seed());
  s.apply({ type: 'removeTask', id: 'b' });
  assert.equal(taskById(s, 'b'), undefined);
});
test('removeTask nimmt die Abhängigkeiten des Vorgangs mit', () => {
  // Sonst zeigten Pfeile ins Leere und die Terminrechnung liefe auf undefined.
  const s = createStore(seed());
  s.apply({ type: 'removeTask', id: 'b' });
  assert.equal(s.state.deps.length, 0);
});
test('setTaskField ändert genau ein Feld', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'crew', value: 9 });
  assert.equal(taskById(s, 'a').crew, 9);
  assert.equal(taskById(s, 'a').title, 'Podest', 'andere Felder unberührt');
});
test('moveTask verschiebt Start und Ende gemeinsam', () => {
  const s = createStore(seed());
  s.apply({ type: 'moveTask', id: 'a', start: '2026-07-14T08:00', end: '2026-07-14T12:00' });
  assert.equal(taskById(s, 'a').start, '2026-07-14T08:00');
  assert.equal(taskById(s, 'a').end, '2026-07-14T12:00');
});

console.log('\nValidierung — abgelehnte Befehle dürfen nichts hinterlassen');
test('Ende vor Start wird abgelehnt', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'moveTask', id: 'a', start: '2026-07-13T12:00', end: '2026-07-13T08:00' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Ende/i);
});
test('abgelehnter Befehl lässt den Zustand unverändert', () => {
  const s = createStore(seed());
  const before = JSON.stringify(s.state);
  s.apply({ type: 'moveTask', id: 'a', start: '2026-07-13T12:00', end: '2026-07-13T08:00' });
  assert.equal(JSON.stringify(s.state), before);
});
test('abgelehnter Befehl kommt nicht auf den Undo-Stapel', () => {
  const s = createStore(seed());
  s.apply({ type: 'moveTask', id: 'a', start: '2026-07-13T12:00', end: '2026-07-13T08:00' });
  assert.equal(s.canUndo, false);
});
test('abgelehnter Befehl macht den Zustand nicht ungesichert', () => {
  const s = createStore(seed());
  s.apply({ type: 'moveTask', id: 'a', start: '2026-07-13T12:00', end: '2026-07-13T08:00' });
  assert.equal(s.dirty, false);
});
test('Befehl auf unbekannte id wird abgelehnt statt zu werfen', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'setTaskField', id: 'gibtsnicht', field: 'title', value: 'X' });
  assert.equal(r.ok, false);
});
test('Meilenstein darf Start gleich Ende haben', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'buehne', title: 'Bühne steht', start: '2026-07-13T12:00', end: '2026-07-13T12:00', milestone: true } });
  assert.notEqual(r.ok, false);
});

console.log('\nValidierung — Ringe');
test('Abhängigkeit, die einen Ring schließt, wird abgelehnt', () => {
  const s = createStore(seed());              // a → b existiert
  const r = s.apply({ type: 'addDep', dep: { from: 'b', to: 'a', type: 'FS', lag: 0 } });
  assert.equal(r.ok, false);
});
test('Ring-Fehler benennt die beteiligten Vorgänge im Klartext', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addDep', dep: { from: 'b', to: 'a', type: 'FS', lag: 0 } });
  assert.match(r.error, /Podest|Scheinwerfer/, 'nennt Titel, nicht nur ids: ' + r.error);
});
test('abgelehnter Ring hinterlässt keine Abhängigkeit', () => {
  const s = createStore(seed());
  s.apply({ type: 'addDep', dep: { from: 'b', to: 'a', type: 'FS', lag: 0 } });
  assert.equal(s.state.deps.length, 1);
});
test('Vorgang von sich selbst abhängig zu machen wird abgelehnt', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addDep', dep: { from: 'a', to: 'a', type: 'FS', lag: 0 } });
  assert.equal(r.ok, false);
});
test('doppelte Abhängigkeit wird abgelehnt', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addDep', dep: { from: 'a', to: 'b', type: 'FS', lag: 0 } });
  assert.equal(r.ok, false);
});
test('gültige Abhängigkeit wird angelegt', () => {
  const s = createStore(seed());
  s.apply({ type: 'addTask', task: { id: 'c', gewerk: 'licht', title: 'C', start: '2026-07-14T08:00', end: '2026-07-14T10:00' } });
  const r = s.apply({ type: 'addDep', dep: { from: 'b', to: 'c', type: 'FS', lag: 0 } });
  assert.notEqual(r.ok, false);
  assert.equal(s.state.deps.length, 2);
});
test('removeDep entfernt die Abhängigkeit', () => {
  const s = createStore(seed());
  s.apply({ type: 'removeDep', id: 'd1' });
  assert.equal(s.state.deps.length, 0);
});

console.log('\nBefehle: Gewerke');
test('addGewerk hängt hinten an', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addGewerk', gewerk: { name: 'Ton' } });
  assert.equal(s.state.gewerke.length, 3);
  assert.equal(s.state.gewerke[2].name, 'Ton');
  assert.ok(r.id);
});
test('removeGewerk nimmt seine Vorgänge mit', () => {
  const s = createStore(seed());
  s.apply({ type: 'removeGewerk', id: 'licht' });
  assert.equal(s.state.tasks.filter((t) => t.gewerk === 'licht').length, 0);
});
test('removeGewerk nimmt auch die Abhängigkeiten dieser Vorgänge mit', () => {
  const s = createStore(seed());
  s.apply({ type: 'removeGewerk', id: 'licht' });   // b gehört zu licht, d1 zeigt auf b
  assert.equal(s.state.deps.length, 0);
});
test('Gewerk-Namen müssen eindeutig sein', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addGewerk', gewerk: { name: 'Bühne' } });
  assert.equal(r.ok, false);
});

console.log('\nUndo / Redo');
test('undo nimmt eine Feldänderung exakt zurück', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'Neu' });
  s.undo();
  assert.equal(taskById(s, 'a').title, 'Podest');
});
test('undo nimmt ein Anlegen zurück', () => {
  const s = createStore(seed());
  s.apply({ type: 'addTask', task: { gewerk: 'licht', title: 'X', start: '2026-07-14T08:00', end: '2026-07-14T10:00' } });
  s.undo();
  assert.equal(s.state.tasks.length, 2);
});
test('undo stellt einen gelöschten Vorgang samt Abhängigkeiten wieder her', () => {
  const s = createStore(seed());
  s.apply({ type: 'removeTask', id: 'b' });
  s.undo();
  assert.equal(s.state.tasks.length, 2);
  assert.equal(s.state.deps.length, 1, 'die Abhängigkeit kommt mit zurück');
});
test('undo stellt ein gelöschtes Gewerk samt Vorgängen und Abhängigkeiten wieder her', () => {
  const s = createStore(seed());
  s.apply({ type: 'removeGewerk', id: 'licht' });
  s.undo();
  assert.equal(s.state.gewerke.length, 2);
  assert.equal(s.state.tasks.length, 2);
  assert.equal(s.state.deps.length, 1);
});
test('redo wendet den Befehl erneut an', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'Neu' });
  s.undo();
  s.redo();
  assert.equal(taskById(s, 'a').title, 'Neu');
});
test('gemischte Folge landet exakt wieder am Ausgangspunkt', () => {
  const s = createStore(seed());
  const before = JSON.stringify(s.state);
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'X' });
  s.apply({ type: 'moveTask', id: 'b', start: '2026-07-15T08:00', end: '2026-07-15T10:00' });
  s.apply({ type: 'addTask', task: { gewerk: 'buehne', title: 'Y', start: '2026-07-16T08:00', end: '2026-07-16T09:00' } });
  s.apply({ type: 'removeDep', id: 'd1' });
  s.undo(); s.undo(); s.undo(); s.undo();
  assert.equal(JSON.stringify(s.state), before);
});
test('neuer Befehl nach undo verwirft den Redo-Zweig', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'X' });
  s.undo();
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'Y' });
  assert.equal(s.canRedo, false);
  s.redo();
  assert.equal(taskById(s, 'a').title, 'Y', 'redo darf X nicht zurückholen');
});
test('undo auf leerem Stapel tut nichts statt zu werfen', () => {
  const s = createStore(seed());
  assert.equal(s.canUndo, false);
  s.undo();
  assert.equal(s.state.tasks.length, 2);
});
test('redo auf leerem Stapel tut nichts statt zu werfen', () => {
  const s = createStore(seed());
  s.redo();
  assert.equal(s.state.tasks.length, 2);
});
test('undo benachrichtigt die Abonnenten', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: 'X' });
  let calls = 0;
  s.subscribe(() => calls++);
  s.undo();
  assert.equal(calls, 1);
});

console.log('\nSammelbefehle');
test('mehrere Änderungen lassen sich als eine Einheit zurücknehmen', () => {
  // «Konflikte auflösen» verschiebt viele Vorgänge — ⌘Z muss alle zusammen holen.
  const s = createStore(seed());
  s.apply({ type: 'batch', label: 'Konflikte auflösen', cmds: [
    { type: 'moveTask', id: 'a', start: '2026-07-14T08:00', end: '2026-07-14T12:00' },
    { type: 'moveTask', id: 'b', start: '2026-07-14T12:00', end: '2026-07-14T16:00' },
  ] });
  assert.equal(taskById(s, 'a').start, '2026-07-14T08:00');
  s.undo();
  assert.equal(taskById(s, 'a').start, '2026-07-13T08:00');
  assert.equal(taskById(s, 'b').start, '2026-07-13T12:00', 'beide zusammen zurück');
});
test('scheitert ein Teil des Sammelbefehls, wird alles verworfen', () => {
  const s = createStore(seed());
  const before = JSON.stringify(s.state);
  const r = s.apply({ type: 'batch', label: 'kaputt', cmds: [
    { type: 'moveTask', id: 'a', start: '2026-07-14T08:00', end: '2026-07-14T12:00' },
    { type: 'moveTask', id: 'b', start: '2026-07-14T16:00', end: '2026-07-14T12:00' }, // Ende vor Start
  ] });
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(s.state), before, 'auch der erste Teil ist zurückgenommen');
});
test('Sammelbefehl benachrichtigt nur einmal', () => {
  const s = createStore(seed());
  let calls = 0;
  s.subscribe(() => calls++);
  s.apply({ type: 'batch', label: 'x', cmds: [
    { type: 'setTaskField', id: 'a', field: 'crew', value: 1 },
    { type: 'setTaskField', id: 'b', field: 'crew', value: 2 },
  ] });
  assert.equal(calls, 1, 'sonst zeichnet der Gantt bei jedem Teilschritt neu');
});

console.log('\nGewerke umsortieren');
const seed3 = () => ({
  project: { id: 'p1', name: 'T', start: '2026-07-13T00:00', end: '2026-07-20T00:00', timezone: 'Europe/Berlin' },
  gewerke: [
    { id: 'a', name: 'Bühne', sort: 0, slot: 0 },
    { id: 'b', name: 'Licht', sort: 1, slot: 1 },
    { id: 'c', name: 'Ton', sort: 2, slot: 2 },
  ],
  tasks: [], deps: [],
});
const order = (s) => [...s.state.gewerke].sort((x, y) => x.sort - y.sort).map((g) => g.name);
const slots = (s) => Object.fromEntries(s.state.gewerke.map((g) => [g.name, g.slot]));

test('nach oben tauscht mit dem Vorgänger', () => {
  const s = createStore(seed3());
  s.apply({ type: 'reorderGewerk', id: 'c', dir: -1 });
  assert.deepEqual(order(s), ['Bühne', 'Ton', 'Licht']);
});
test('nach unten tauscht mit dem Nachfolger', () => {
  const s = createStore(seed3());
  s.apply({ type: 'reorderGewerk', id: 'a', dir: 1 });
  assert.deepEqual(order(s), ['Licht', 'Bühne', 'Ton']);
});
test('DIE FARBE BLEIBT — sie gehört dem Gewerk, nicht seiner Position', () => {
  // Sonst färbte sich beim Sortieren der halbe Plan um und die validierte
  // Palette wäre wertlos.
  const s = createStore(seed3());
  const before = slots(s);
  s.apply({ type: 'reorderGewerk', id: 'c', dir: -1 });
  assert.deepEqual(slots(s), before);
});
test('Reihenfolge bleibt lückenlos 0,1,2 — keine Doppelten', () => {
  const s = createStore(seed3());
  s.apply({ type: 'reorderGewerk', id: 'c', dir: -1 });
  s.apply({ type: 'reorderGewerk', id: 'b', dir: 1 });
  assert.deepEqual([...s.state.gewerke].map((g) => g.sort).sort(), [0, 1, 2]);
});
test('nach oben beim obersten tut nichts', () => {
  const s = createStore(seed3());
  const r = s.apply({ type: 'reorderGewerk', id: 'a', dir: -1 });
  assert.equal(r.ok, false);
  assert.deepEqual(order(s), ['Bühne', 'Licht', 'Ton']);
});
test('nach unten beim untersten tut nichts', () => {
  const s = createStore(seed3());
  const r = s.apply({ type: 'reorderGewerk', id: 'c', dir: 1 });
  assert.equal(r.ok, false);
});
test('abgelehntes Umsortieren kommt nicht auf den Undo-Stapel', () => {
  const s = createStore(seed3());
  s.apply({ type: 'reorderGewerk', id: 'a', dir: -1 });
  assert.equal(s.canUndo, false);
});
test('Umsortieren ist rückgängig zu machen', () => {
  const s = createStore(seed3());
  s.apply({ type: 'reorderGewerk', id: 'c', dir: -1 });
  s.undo();
  assert.deepEqual(order(s), ['Bühne', 'Licht', 'Ton']);
});
test('unbekanntes Gewerk wird abgelehnt', () => {
  const s = createStore(seed3());
  assert.equal(s.apply({ type: 'reorderGewerk', id: 'weg', dir: 1 }).ok, false);
});
test('krumme sort-Werte werden beim Umsortieren begradigt', () => {
  const raw = seed3();
  raw.gewerke[0].sort = 5; raw.gewerke[1].sort = 5; raw.gewerke[2].sort = 99;
  const s = createStore(raw);
  s.apply({ type: 'reorderGewerk', id: 'c', dir: -1 });
  assert.deepEqual([...s.state.gewerke].map((g) => g.sort).sort(), [0, 1, 2]);
});

console.log('\nVorgang duplizieren');
test('Duplikat übernimmt die Felder', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'duplicateTask', id: 'a' });
  const dup = s.state.tasks.find((t) => t.id === r.id);
  assert.equal(dup.gewerk, 'buehne');
  assert.equal(dup.start, '2026-07-13T08:00');
  assert.equal(dup.crew, 4);
});
test('Duplikat bekommt eine eigene id', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'duplicateTask', id: 'a' });
  assert.notEqual(r.id, 'a');
  assert.equal(s.state.tasks.length, 3);
});
test('Duplikat ist am Namen erkennbar', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'duplicateTask', id: 'a' });
  assert.match(s.state.tasks.find((t) => t.id === r.id).title, /Kopie/);
});
test('Duplikat erbt KEINE Verknüpfungen', () => {
  // Mit denselben Vorgängern stünde es sofort im Konflikt — und niemand will
  // beim Duplizieren einen roten Plan geschenkt bekommen.
  const s = createStore(seed());
  s.apply({ type: 'duplicateTask', id: 'b' });   // b hängt an a
  assert.equal(s.state.deps.length, 1, 'die eine bestehende Verknüpfung, keine neue');
});
test('Duplizieren ist rückgängig zu machen', () => {
  const s = createStore(seed());
  s.apply({ type: 'duplicateTask', id: 'a' });
  s.undo();
  assert.equal(s.state.tasks.length, 2);
});
test('unbekannter Vorgang wird abgelehnt', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'duplicateTask', id: 'weg' }).ok, false);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
