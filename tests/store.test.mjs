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

console.log('\nGewerke per Drag an beliebige Position (moveGewerk)');
test('ganz nach oben: vor das erste Gewerk', () => {
  const s = createStore(seed3());
  s.apply({ type: 'moveGewerk', id: 'c', before: 'a' });
  assert.deepEqual(order(s), ['Ton', 'Bühne', 'Licht']);
});
test('ans Ende: before = null', () => {
  const s = createStore(seed3());
  s.apply({ type: 'moveGewerk', id: 'a', before: null });
  assert.deepEqual(order(s), ['Licht', 'Ton', 'Bühne']);
});
test('in die Mitte: vor ein späteres Gewerk', () => {
  const s = createStore(seed3());
  s.apply({ type: 'moveGewerk', id: 'a', before: 'c' });
  assert.deepEqual(order(s), ['Licht', 'Bühne', 'Ton']);
});
test('DIE FARBE BLEIBT auch beim Verschieben an beliebige Position', () => {
  const s = createStore(seed3());
  const before = slots(s);
  s.apply({ type: 'moveGewerk', id: 'c', before: 'a' });
  assert.deepEqual(slots(s), before);
});
test('sort bleibt lückenlos 0,1,2 nach moveGewerk', () => {
  const s = createStore(seed3());
  s.apply({ type: 'moveGewerk', id: 'c', before: 'a' });
  assert.deepEqual([...s.state.gewerke].map((g) => g.sort).sort(), [0, 1, 2]);
});
test('an dieselbe Stelle ziehen wird abgelehnt (kein Undo-Eintrag)', () => {
  const s = createStore(seed3());
  // b steht schon vor c → b vor c einfügen ändert nichts
  const r = s.apply({ type: 'moveGewerk', id: 'b', before: 'c' });
  assert.equal(r.ok, false);
  assert.equal(s.canUndo, false);
});
test('vor sich selbst ziehen wird abgelehnt', () => {
  const s = createStore(seed3());
  assert.equal(s.apply({ type: 'moveGewerk', id: 'b', before: 'b' }).ok, false);
});
test('unbekanntes Zielgewerk wird abgelehnt', () => {
  const s = createStore(seed3());
  assert.equal(s.apply({ type: 'moveGewerk', id: 'a', before: 'weg' }).ok, false);
});
test('moveGewerk ist rückgängig zu machen', () => {
  const s = createStore(seed3());
  s.apply({ type: 'moveGewerk', id: 'c', before: 'a' });
  s.undo();
  assert.deepEqual(order(s), ['Bühne', 'Licht', 'Ton']);
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

console.log('\nUntervorgänge (Eltern = Hülle)');
// Elternvorgang «pa» ohne eigene sinnvolle Dauer; zwei Kinder tragen die echten
// Zeiten. Die Hülle des Elternteils muss sich daraus ergeben.
const seedSub = () => ({
  project: { id: 'p1', name: 'Test', venue: '', start: '2026-07-13T00:00', end: '2026-07-20T00:00', timezone: 'Europe/Berlin' },
  gewerke: [{ id: 'ton', name: 'Ton', sort: 0, slot: 0 }],
  tasks: [
    { id: 'pa', gewerk: 'ton', title: 'PA hängen', start: '2026-07-13T08:00', end: '2026-07-13T09:00', milestone: false, progress: 0, status: 'geplant', crew: null, parent: null },
  ],
  deps: [],
});
const addKid = (s, title, start, end) =>
  s.apply({ type: 'addTask', task: { gewerk: 'ton', parent: 'pa', title, start, end } });

test('Untervorgang erbt das Gewerk des Elternvorgangs', () => {
  const s = createStore(seedSub());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'gibtsnicht', parent: 'pa', title: 'Main SL', start: '2026-07-13T10:00', end: '2026-07-13T12:00' } });
  assert.equal(r.ok, true);
  assert.equal(taskById(s, r.id).gewerk, 'ton');
});
test('Eltern-Zeiten sind die Hülle der Kinder (frühester Start … spätestes Ende)', () => {
  const s = createStore(seedSub());
  addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  addKid(s, 'Main SR', '2026-07-13T09:30', '2026-07-13T13:30');
  const pa = taskById(s, 'pa');
  assert.equal(pa.start, '2026-07-13T09:30', 'frühester Kindstart');
  assert.equal(pa.end, '2026-07-13T13:30', 'spätestes Kindende');
  assert.equal(pa.milestone, false);
});
test('ein neues Kind außerhalb dehnt die Hülle', () => {
  const s = createStore(seedSub());
  addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  addKid(s, 'Sidefill', '2026-07-13T14:00', '2026-07-13T16:00');
  assert.equal(taskById(s, 'pa').end, '2026-07-13T16:00');
});
test('Kind verschieben zieht die Eltern-Hülle nach', () => {
  const s = createStore(seedSub());
  const r = addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  s.apply({ type: 'moveTask', id: r.id, start: '2026-07-13T06:00', end: '2026-07-13T08:00' });
  assert.equal(taskById(s, 'pa').start, '2026-07-13T06:00');
});
test('nur EINE Ebene: ein Untervorgang bekommt keine eigenen Untervorgänge', () => {
  const s = createStore(seedSub());
  const r = addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  const bad = s.apply({ type: 'addTask', task: { gewerk: 'ton', parent: r.id, title: 'Enkel', start: '2026-07-13T10:00', end: '2026-07-13T11:00' } });
  assert.equal(bad.ok, false);
});
test('unbekannter Elternvorgang wird abgelehnt', () => {
  const s = createStore(seedSub());
  assert.equal(s.apply({ type: 'addTask', task: { gewerk: 'ton', parent: 'weg', title: 'x', start: '2026-07-13T10:00', end: '2026-07-13T11:00' } }).ok, false);
});
test('Eltern-Zeit lässt sich nicht von Hand setzen (Hülle gewinnt)', () => {
  const s = createStore(seedSub());
  addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  const r = s.apply({ type: 'setTaskField', id: 'pa', field: 'start', value: '2026-07-13T05:00' });
  assert.equal(r.ok, false);
  assert.equal(taskById(s, 'pa').start, '2026-07-13T10:00', 'unverändert');
});
test('Sammelvorgang lässt sich nicht direkt verschieben', () => {
  const s = createStore(seedSub());
  addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  assert.equal(s.apply({ type: 'moveTask', id: 'pa', start: '2026-07-13T05:00', end: '2026-07-13T06:00' }).ok, false);
});
test('Untervorgang bleibt im Gewerk des Elternvorgangs (kein Wechsel)', () => {
  const s = createStore(seedSub());
  s.apply({ type: 'addGewerk', gewerk: { id: 'licht', name: 'Licht' } });
  const r = addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  assert.equal(s.apply({ type: 'setTaskField', id: r.id, field: 'gewerk', value: 'licht' }).ok, false);
});
test('Elternvorgang löschen nimmt die Kinder mit (Kaskade)', () => {
  const s = createStore(seedSub());
  addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  addKid(s, 'Main SR', '2026-07-13T09:30', '2026-07-13T13:30');
  s.apply({ type: 'removeTask', id: 'pa' });
  assert.equal(s.state.tasks.length, 0);
});
test('Kaskaden-Löschen ist mit einem ⌘Z komplett zurück', () => {
  const s = createStore(seedSub());
  addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  addKid(s, 'Main SR', '2026-07-13T09:30', '2026-07-13T13:30');
  s.apply({ type: 'removeTask', id: 'pa' });
  s.undo();
  assert.equal(s.state.tasks.length, 3);
  assert.equal(taskById(s, 'pa').end, '2026-07-13T13:30', 'Hülle wieder da');
});
test('parent lässt sich nicht über setTaskField umbiegen', () => {
  const s = createStore(seedSub());
  const r = addKid(s, 'Main SL', '2026-07-13T10:00', '2026-07-13T12:00');
  assert.equal(s.apply({ type: 'setTaskField', id: r.id, field: 'parent', value: null }).ok, false);
});

console.log('\nBühnen — die Showablauf-Ebene');

const mitBuehne = () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addGewerk', gewerk: { name: 'Hauptbühne', art: 'buehne' } });
  return { s, id: r.id };
};

test('eine Bühne wird als Bühne angelegt', () => {
  const { s, id } = mitBuehne();
  const g = s.state.gewerke.find((x) => x.id === id);
  assert.equal(g.art, 'buehne');
  assert.equal(g.name, 'Hauptbühne');
});

test('Farbplätze werden je Ebene vergeben — die erste Bühne bekommt Platz 0', () => {
  const { s, id } = mitBuehne();
  // Die zwei Gewerke belegen 0 und 1. Zählte man alles zusammen, käme hier 2
  // heraus — und im Klassentreffen-Plan (20 Gewerke) wäre die Palette erschöpft.
  assert.equal(s.state.gewerke.find((x) => x.id === id).slot, 0);
});

test('zwei Bühnen bekommen verschiedene Plätze', () => {
  const { s } = mitBuehne();
  const r = s.apply({ type: 'addGewerk', gewerk: { name: 'Zeltbühne', art: 'buehne' } });
  assert.equal(s.state.gewerke.find((x) => x.id === r.id).slot, 1);
});

test('derselbe Name darf in beiden Ebenen stehen', () => {
  const s = createStore(seed());
  // «Bühne» gibt es schon als Gewerk — als Spielstätte ist das etwas anderes.
  assert.equal(s.apply({ type: 'addGewerk', gewerk: { name: 'Bühne', art: 'buehne' } }).ok, true);
});

test('zwei Bühnen gleichen Namens werden abgelehnt', () => {
  const { s } = mitBuehne();
  const r = s.apply({ type: 'addGewerk', gewerk: { name: 'hauptbühne', art: 'buehne' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /Bühne gibt es schon/);
});

test('eine Bühne bekommt KEINEN Abschnitt — den trägt der Zeiteintrag', () => {
  // Es gibt eine Bühne mit zwei Abläufen, nicht zwei Bühnen.
  const { s, id } = mitBuehne();
  assert.equal('abschnitt' in s.state.gewerke.find((x) => x.id === id), false);
  const r = s.apply({ type: 'setGewerkField', id, field: 'abschnitt', value: 'setup' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Zeiteintrag/);
});

test('addTask reicht den Abschnitt durch', () => {
  // Fiel er weg, landete ein im Setup angelegter Eintrag in der Show — und war
  // im gerade gezeigten Abschnitt sofort unsichtbar.
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'licht', title: 'Line-Check',
    start: '2026-07-14T08:00', end: '2026-07-14T09:00', abschnitt: 'setup' } });
  assert.equal(taskById(s, r.id).abschnitt, 'setup');
});

test('ohne Angabe gehört ein neuer Eintrag zur Show', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'licht', title: 'X',
    start: '2026-07-14T08:00', end: '2026-07-14T09:00' } });
  assert.equal(taskById(s, r.id).abschnitt, 'show');
});

test('der Abschnitt eines Zeiteintrags lässt sich setzen und zurücknehmen', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'abschnitt', value: 'setup' }).ok, true);
  assert.equal(taskById(s, 'a').abschnitt, 'setup');
  s.undo();
  assert.equal(taskById(s, 'a').abschnitt, undefined);
});

test('erfundene Abschnitte werden abgelehnt und hinterlassen nichts', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'setTaskField', id: 'a', field: 'abschnitt', value: 'quatsch' });
  assert.equal(r.ok, false);
  assert.equal(taskById(s, 'a').abschnitt, undefined);
  assert.equal(s.canUndo, false);
  assert.equal(s.dirty, false);
});

test('ein Gewerk wird nicht nachträglich zur Bühne', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'setGewerkField', id: 'buehne', field: 'art', value: 'buehne' });
  assert.equal(r.ok, false);
  assert.equal(s.state.gewerke.find((g) => g.id === 'buehne').art, undefined);
});

test('erfundene Arten werden zu Gewerken, nicht zu einer dritten Ebene', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addGewerk', gewerk: { name: 'Quatsch', art: 'ufo' } });
  assert.equal(s.state.gewerke.find((g) => g.id === r.id).art, 'gewerk');
});

console.log('\nShowablauf-Felder am Vorgang');

test('Anforderungen und Material laufen über den Store', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'anforderungen', value: '2× Wedge' }).ok, true);
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'material', value: '1 Riser' }).ok, true);
  assert.equal(taskById(s, 'a').anforderungen, '2× Wedge');
  assert.equal(taskById(s, 'a').material, '1 Riser');
});

test('⌘Z nimmt eine Anforderung zurück', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'anforderungen', value: '2× Wedge' });
  s.undo();
  assert.equal(taskById(s, 'a').anforderungen, undefined);
});

test('Programmpunkt-Typ und Soundcheck sind normale Felder', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'punktTyp', value: 'changeover' });
  s.apply({ type: 'setTaskField', id: 'a', field: 'soundcheck', value: '2026-07-13T09:30' });
  assert.equal(taskById(s, 'a').punktTyp, 'changeover');
  assert.equal(taskById(s, 'a').soundcheck, '2026-07-13T09:30');
});

console.log('\nZuordnung: der Soundcheck gehört zu seinem Act');

test('addTask reicht `fuer` durch', () => {
  // Was der Handler nicht aufzählt, fällt beim Anlegen still weg — genau das
  // ist `abschnitt` schon passiert.
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'buehne', title: 'Soundcheck Podest',
    start: '2026-07-13T06:00', end: '2026-07-13T07:00', abschnitt: 'setup', fuer: 'a' } });
  assert.equal(taskById(s, r.id).fuer, 'a');
});

test('eine Zuordnung auf einen unbekannten Eintrag wird abgelehnt', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'setTaskField', id: 'b', field: 'fuer', value: 'gibtsnicht' });
  assert.equal(r.ok, false);
  assert.equal(taskById(s, 'b').fuer, undefined);
});

test('ein Eintrag gehört nicht zu sich selbst', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskField', id: 'b', field: 'fuer', value: 'b' }).ok, false);
});

test('den Act löschen nimmt seinen Soundcheck mit', () => {
  // Sonst bliebe eine Waise mit totem `fuer` zurück, die niemand mehr findet.
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'buehne', title: 'Soundcheck Podest',
    start: '2026-07-13T06:00', end: '2026-07-13T07:00', abschnitt: 'setup', fuer: 'a' } });
  s.apply({ type: 'removeTask', id: 'a' });
  assert.equal(taskById(s, r.id), undefined);
  assert.equal(taskById(s, 'a'), undefined);
});

test('ein ⌘Z holt Act und Soundcheck zusammen zurück', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'buehne', title: 'Soundcheck Podest',
    start: '2026-07-13T06:00', end: '2026-07-13T07:00', abschnitt: 'setup', fuer: 'a' } });
  s.apply({ type: 'removeTask', id: 'a' });
  s.undo();
  assert.ok(taskById(s, 'a'));
  assert.ok(taskById(s, r.id));
});

console.log('\nFarbplatz am Programmpunkt');

test('ein Programmpunkt darf eine eigene Farbe tragen', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'slot', value: 13 }).ok, true);
  assert.equal(taskById(s, 'a').slot, 13);
});

test('null bedeutet «wie Bühne» und ist erlaubt', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'slot', value: 5 });
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'slot', value: null }).ok, true);
  assert.equal(taskById(s, 'a').slot, null);
});

test('ein Platz außerhalb der Palette wird abgelehnt', () => {
  // Ohne die Prüfung landete er still im Export und der Balken zeigte auf
  // `var(--gw-NaN)` — also auf gar keine Farbe.
  const s = createStore(seed());
  for (const wert of [20, -1, 1.5, '3', NaN, undefined]) {
    const r = s.apply({ type: 'setTaskField', id: 'a', field: 'slot', value: wert });
    assert.equal(r.ok, false, JSON.stringify(wert) + ' wurde angenommen');
  }
  assert.equal(taskById(s, 'a').slot, undefined, 'nichts hinterlassen');
  assert.equal(s.canUndo, false, 'nichts auf dem Undo-Stapel');
  assert.equal(s.dirty, false, 'nicht als ungesichert markiert');
});

test('die Ränder der Palette sind gültig — 0 und MAX_SLOTS-1', () => {
  // Intern 0-basiert, in der Oberfläche 1-basiert («Platz 1 von 20»). Die
  // Meldung darf deshalb keinen Bereich nennen, der bei 1 anfängt: sie behauptete
  // «zwischen 1 und 20», während 0 gültig und 20 ungültig ist.
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'slot', value: 0 }).ok, true, 'Platz 0 ist gültig');
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'slot', value: 19 }).ok, true, 'Platz 19 ist gültig');
  const r = s.apply({ type: 'setTaskField', id: 'a', field: 'slot', value: 20 });
  assert.equal(r.ok, false);
  assert.doesNotMatch(String(r.error), /zwischen 1/, 'Meldung nennt keinen Bereich, der 0 ausschließt');
});

test('⌘Z nimmt eine Farbe zurück', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'slot', value: 7 });
  s.undo();
  assert.equal(taskById(s, 'a').slot, undefined);
});

console.log('\nEigene Eintragsarten');

test('anlegen liefert eine id und hängt sie an den Plan', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addPunktTyp', label: 'Line-Check' });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'linecheck', 'lesbare id aus dem Namen');
  assert.deepEqual(s.state.project.punktTypen, [{ id: 'linecheck', label: 'Line-Check', kompakt: false }]);
});

test('«tritt auf dem Blatt zurück» wird mitgeführt', () => {
  const s = createStore(seed());
  s.apply({ type: 'addPunktTyp', label: 'Umbaupause', kompakt: true });
  assert.equal(s.state.project.punktTypen[0].kompakt, true);
});

test('ein leerer Name wird abgelehnt und hinterlässt NICHTS', () => {
  const s = createStore(seed());
  const vorher = s.canUndo;
  const r = s.apply({ type: 'addPunktTyp', label: '   ' });
  assert.equal(r.ok, false);
  assert.deepEqual(s.state.project.punktTypen, undefined, 'keine halbe Liste angelegt');
  assert.equal(s.canUndo, vorher, 'kein Undo-Eintrag für einen abgelehnten Befehl');
});

test('derselbe Name zweimal wird abgelehnt — auch anders geschrieben', () => {
  const s = createStore(seed());
  s.apply({ type: 'addPunktTyp', label: 'Line-Check' });
  const r = s.apply({ type: 'addPunktTyp', label: 'line-check' });
  assert.equal(r.ok, false);
  assert.equal(s.state.project.punktTypen.length, 1);
});

test('eine EINGEBAUTE Art lässt sich nicht nachbauen', () => {
  // Sonst stünde «Changeover» zweimal im Auswahlfeld und niemand wüsste, welches
  // welches ist.
  const s = createStore(seed());
  for (const n of ['Changeover', 'changeover', 'Act', 'Show-Ende']) {
    assert.equal(s.apply({ type: 'addPunktTyp', label: n }).ok, false, n);
  }
});

test('ein Name ohne brauchbare Zeichen bekommt trotzdem eine id', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addPunktTyp', label: '★★★' });
  assert.equal(r.ok, true);
  assert.ok(r.id && r.id.length > 1, 'id: ' + r.id);
});

test('⌘Z nimmt die Art wieder zurück', () => {
  const s = createStore(seed());
  s.apply({ type: 'addPunktTyp', label: 'Line-Check' });
  s.undo();
  assert.deepEqual(s.state.project.punktTypen || [], []);
});

console.log('\nEigene Abschnitte');

test('anlegen liefert eine id und hängt ihn an den Plan', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addAbschnitt', label: 'Load-in' });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'loadin');
  assert.deepEqual(s.state.project.abschnitte, [{ id: 'loadin', label: 'Load-in' }]);
});

test('ein Abschnitt trägt KEIN kompakt-Feld', () => {
  // Er bestimmt keine Zeilenhöhe auf dem Blatt — ein Feld ohne Wirkung wäre
  // beim Diff zweier Sicherungen nur Rauschen.
  const s = createStore(seed());
  s.apply({ type: 'addAbschnitt', label: 'Load-in', kompakt: true });
  assert.equal('kompakt' in s.state.project.abschnitte[0], false);
});

test('Setup und Show lassen sich nicht nachbauen', () => {
  const s = createStore(seed());
  for (const n of ['Setup', 'setup', 'Show']) {
    assert.equal(s.apply({ type: 'addAbschnitt', label: n }).ok, false, n);
  }
});

test('ein leerer Abschnittsname wird abgelehnt und hinterlässt NICHTS', () => {
  const s = createStore(seed());
  const vorher = s.canUndo;
  assert.equal(s.apply({ type: 'addAbschnitt', label: '  ' }).ok, false);
  assert.deepEqual(s.state.project.abschnitte, undefined);
  assert.equal(s.canUndo, vorher);
});

test('Arten und Abschnitte kommen sich nicht in die Quere', () => {
  // Zwei getrennte Listen: ein Abschnitt «Act» ist erlaubt, auch wenn es die
  // Eintragsart «Act» gibt — sie stehen in verschiedenen Auswahlfeldern.
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'addPunktTyp', label: 'Line-Check' }).ok, true);
  assert.equal(s.apply({ type: 'addAbschnitt', label: 'Line-Check' }).ok, true);
  assert.equal(s.state.project.punktTypen.length, 1);
  assert.equal(s.state.project.abschnitte.length, 1);
});

test('⌘Z nimmt den Abschnitt wieder zurück', () => {
  const s = createStore(seed());
  s.apply({ type: 'addAbschnitt', label: 'Load-in' });
  s.undo();
  assert.deepEqual(s.state.project.abschnitte || [], []);
});

test('DIE KOPIE DER EINGEBAUTEN ABSCHNITTE LÄUFT NICHT AUSEINANDER', async () => {
  // Dieselbe Begründung wie bei den Arten: store.js darf nicht auf ebene.js
  // zeigen, also steht die Liste zweimal — und wird geprüft.
  const { ABSCHNITTE } = await import('../js/ebene.js');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const roh = /const ABSCHNITTE_EINGEBAUT = \[([\s\S]*?)\];/.exec(src);
  assert.ok(roh, 'ABSCHNITTE_EINGEBAUT nicht gefunden — wurde es umbenannt?');
  const imStore = [...roh[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(imStore, ABSCHNITTE.map(([k, l]) => [k, l]),
    'store.js und ebene.js führen verschiedene eingebaute Abschnitte');
});

test('DIE KOPIE DER EINGEBAUTEN ARTEN LÄUFT NICHT AUSEINANDER', async () => {
  // store.js führt die eingebauten Arten bewusst doppelt: ein Import aus
  // ebene.js liefe verkehrt herum (Kern → Ansichtsschicht), dieselbe Begründung
  // wie bei `clone` und `artVon`. Doppelt geführt ist erlaubt, ungeprüft
  // doppelt nicht — genau wie bei den Versionsstellen.
  const { PUNKT_TYPEN } = await import('../js/ebene.js');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const roh = /const TYPEN_EINGEBAUT = \[([\s\S]*?)\];/.exec(src);
  assert.ok(roh, 'TYPEN_EINGEBAUT nicht gefunden — wurde es umbenannt?');
  const imStore = [...roh[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(imStore, PUNKT_TYPEN.map(([k, l]) => [k, l]),
    'store.js und ebene.js führen verschiedene eingebaute Arten');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
