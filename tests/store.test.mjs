import { createStore, STATUS_IDS, verschiebeZeit, RES_STATUS } from '../js/store.js';
import { toMin, toDate } from '../js/schedule.js';
import { local } from '../js/conflicts.js';
import assert from 'node:assert/strict';
import { ABSCHNITTE, PUNKT_TYPEN } from '../js/ebene.js';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async-Test im synchronen Helfer — nicht erlaubt'); pass++; console.log('  ✓ ' + name); }
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
test('removeTask: Sammelvorgang nimmt Soundcheck seines Kind-Acts mit', () => {
  // Zwei Stufen: P -(parent)-> A -(fuer)-> S. Die einstufige Kaskade ließ S als
  // Waise mit totem `fuer` zurück.
  const z = seed();
  const mk = (id, extra) => ({ id, gewerk: 'buehne', title: id, start: '2026-07-13T08:00', end: '2026-07-13T09:00',
    milestone: false, progress: 0, status: 'geplant', ...extra });
  z.tasks.push(mk('P', {}), mk('A', { parent: 'P' }), mk('S', { fuer: 'A' }));
  z.deps.push({ id: 'd2', from: 'a', to: 'S', type: 'FS', lag: 0 });
  const s = createStore(z);
  assert.equal(s.apply({ type: 'removeTask', id: 'P' }).ok, true);
  for (const id of ['P', 'A', 'S']) assert.equal(taskById(s, id), undefined, id + ' müsste weg sein');
  assert.equal(s.state.deps.some((d) => d.id === 'd2'), false, 'Dep auf S müsste weg sein');
  assert.ok(taskById(s, 'a') && taskById(s, 'b'), 'Unbeteiligte bleiben');
  s.undo();
  for (const id of ['P', 'A', 'S']) assert.ok(taskById(s, id), id + ' müsste zurück sein');
  assert.ok(s.state.deps.some((d) => d.id === 'd2'), 'Dep müsste zurück sein');
});
test('setTaskField ändert genau ein Feld', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'notes', value: 'neu' });
  assert.equal(taskById(s, 'a').notes, 'neu');
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
    { type: 'setTaskField', id: 'a', field: 'notes', value: '1' },
    { type: 'setTaskField', id: 'b', field: 'notes', value: '2' },
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

test('Programmpunkt-Typ und Kontakt sind normale Felder', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'punktTyp', value: 'changeover' });
  s.apply({ type: 'setTaskField', id: 'a', field: 'kontakt', value: 'Max' });
  assert.equal(taskById(s, 'a').punktTyp, 'changeover');
  assert.equal(taskById(s, 'a').kontakt, 'Max');
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

console.log('\nAuswahlwerte verwalten — umbenennen, löschen, sortieren');

// Ein Plan mit zwei eigenen Arten und einem Eintrag, der die erste benutzt.
const mitAuswahl = () => {
  const s = createStore(seed());
  s.apply({ type: 'addPunktTyp', label: 'Line-Check' });
  s.apply({ type: 'addPunktTyp', label: 'Catering' });
  s.apply({ type: 'setTaskField', id: 'a', field: 'punktTyp', value: 'linecheck' });
  return s;
};

test('umbenennen ändert das Label und LÄSST DIE ID STEHEN', () => {
  // Die id ist die Zuordnung. Änderte sie sich mit, verlöre jeder Eintrag seine
  // Art — und zwar still, weil punktLabel den Rohwert einfach durchreicht.
  const s = mitAuswahl();
  const r = s.apply({ type: 'setAuswahlLabel', liste: 'punktTypen', id: 'linecheck', label: 'Linecheck Bühne' });
  assert.equal(r.ok, true);
  assert.deepEqual(s.state.project.punktTypen[0], { id: 'linecheck', label: 'Linecheck Bühne', kompakt: false });
  assert.equal(taskById(s, 'a').punktTyp, 'linecheck', 'der Eintrag hängt weiter an derselben id');
});

test('umbenennen auf einen vergebenen Namen wird abgelehnt', () => {
  const s = mitAuswahl();
  assert.equal(s.apply({ type: 'setAuswahlLabel', liste: 'punktTypen', id: 'linecheck', label: 'Catering' }).ok, false);
  assert.equal(s.apply({ type: 'setAuswahlLabel', liste: 'punktTypen', id: 'linecheck', label: 'Act' }).ok,
    false, 'auch gegen die eingebauten');
  // Sich selbst darf man behalten (etwa nur Groß-/Kleinschreibung ändern).
  assert.equal(s.apply({ type: 'setAuswahlLabel', liste: 'punktTypen', id: 'linecheck', label: 'LINE-CHECK' }).ok, true);
});

test('umbenennen auf leer wird abgelehnt', () => {
  const s = mitAuswahl();
  assert.equal(s.apply({ type: 'setAuswahlLabel', liste: 'punktTypen', id: 'linecheck', label: '  ' }).ok, false);
  assert.equal(s.state.project.punktTypen[0].label, 'Line-Check');
});

test('EINE BENUTZTE ART LÄSST SICH NICHT LÖSCHEN — und die Meldung zählt', () => {
  const s = mitAuswahl();
  const r = s.apply({ type: 'removeAuswahl', liste: 'punktTypen', id: 'linecheck' });
  assert.equal(r.ok, false);
  assert.match(r.error, /1 /, 'die Meldung nennt die Zahl: ' + r.error);
  assert.equal(s.state.project.punktTypen.length, 2, 'nichts gelöscht');
});

test('eine unbenutzte Art lässt sich löschen', () => {
  const s = mitAuswahl();
  assert.equal(s.apply({ type: 'removeAuswahl', liste: 'punktTypen', id: 'catering' }).ok, true);
  assert.deepEqual(s.state.project.punktTypen.map((x) => x.id), ['linecheck']);
});

test('ein benutzter ABSCHNITT lässt sich ebenso wenig löschen', () => {
  const s = createStore(seed());
  s.apply({ type: 'addAbschnitt', label: 'Load-in' });
  s.apply({ type: 'setTaskField', id: 'a', field: 'abschnitt', value: 'loadin' });
  assert.equal(s.apply({ type: 'removeAuswahl', liste: 'abschnitte', id: 'loadin' }).ok, false);
  s.apply({ type: 'setTaskField', id: 'a', field: 'abschnitt', value: 'show' });
  assert.equal(s.apply({ type: 'removeAuswahl', liste: 'abschnitte', id: 'loadin' }).ok, true);
});

test('eingebaute lassen sich weder umbenennen noch löschen', () => {
  const s = mitAuswahl();
  assert.equal(s.apply({ type: 'setAuswahlLabel', liste: 'punktTypen', id: 'act', label: 'Auftritt' }).ok, false);
  assert.equal(s.apply({ type: 'removeAuswahl', liste: 'abschnitte', id: 'show' }).ok, false);
});

test('sortieren setzt sort in der übergebenen Reihenfolge', () => {
  const s = mitAuswahl();
  const r = s.apply({ type: 'reorderAuswahl', liste: 'punktTypen', ids: ['catering', 'linecheck'] });
  assert.equal(r.ok, true);
  assert.deepEqual(s.state.project.punktTypen.map((x) => [x.id, x.sort]),
    [['linecheck', 1], ['catering', 0]]);
});

test('WER NACH DEM SORTIEREN ANLEGT, BEKOMMT DEN NEUEN WERT HINTEN', () => {
  // Vorher landete er mittendrin: `neuerEintrag` setzte kein `sort`, und die
  // Sortierung las `(x.sort ?? 0)` — der neue Wert bekam damit 0 und rutschte
  // vor alles mit sort >= 1. Bei Gleichstand entschied sogar die Array-Position.
  const s = mitAuswahl();
  s.apply({ type: 'reorderAuswahl', liste: 'punktTypen', ids: ['catering', 'linecheck'] });
  s.apply({ type: 'addPunktTyp', label: 'Zuletzt' });
  const neu = s.state.project.punktTypen.find((x) => x.label === 'Zuletzt');
  const hoechste = Math.max(...s.state.project.punktTypen
    .filter((x) => x.label !== 'Zuletzt').map((x) => x.sort));
  assert.notEqual(neu.sort, undefined, 'ohne sort rutscht der neue Wert nach vorn');
  assert.ok(neu.sort > hoechste, `sort ${neu.sort} liegt nicht hinter ${hoechste}`);
});

test('ohne vorheriges Sortieren bleibt der neue Wert ohne sort', () => {
  // Sonst trüge die Liste eine Reihenfolge, die niemand gewählt hat — und die
  // Uhrzeit-Automatik der Abschnitte wäre ab dem ersten Anlegen aus.
  const s = createStore(seed());
  s.apply({ type: 'addAbschnitt', label: 'Load-in' });
  assert.equal(s.state.project.abschnitte[0].sort, undefined);
});

test('eine unvollständige Reihenfolge wird abgelehnt', () => {
  // Sonst hätte die Hälfte ein sort und die andere nicht — die Liste stünde
  // danach in einer Reihenfolge, die niemand gewählt hat.
  const s = mitAuswahl();
  assert.equal(s.apply({ type: 'reorderAuswahl', liste: 'punktTypen', ids: ['linecheck'] }).ok, false);
  assert.equal(s.apply({ type: 'reorderAuswahl', liste: 'punktTypen', ids: ['linecheck', 'gibtsnicht'] }).ok, false);
  assert.equal(s.state.project.punktTypen.some((x) => x.sort != null), false, 'nichts angefasst');
});

test('eine unbekannte Liste wird abgelehnt', () => {
  const s = mitAuswahl();
  for (const cmd of [
    { type: 'setAuswahlLabel', liste: 'gewerke', id: 'x', label: 'y' },
    { type: 'removeAuswahl', liste: 'tasks', id: 'a' },
    { type: 'reorderAuswahl', liste: 'quatsch', ids: [] },
  ]) assert.equal(s.apply(cmd).ok, false, cmd.type);
});

test('⌘Z nimmt umbenennen, löschen und sortieren zurück', () => {
  const s = mitAuswahl();
  s.apply({ type: 'setAuswahlLabel', liste: 'punktTypen', id: 'catering', label: 'Buffet' });
  s.undo();
  assert.equal(s.state.project.punktTypen[1].label, 'Catering');
  s.apply({ type: 'removeAuswahl', liste: 'punktTypen', id: 'catering' });
  s.undo();
  assert.equal(s.state.project.punktTypen.length, 2);
  s.apply({ type: 'reorderAuswahl', liste: 'punktTypen', ids: ['catering', 'linecheck'] });
  s.undo();
  assert.equal(s.state.project.punktTypen[0].sort, undefined);
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

test('DIE KOPIE DER EINGEBAUTEN ABSCHNITTE LÄUFT NICHT AUSEINANDER', () => {
  // Dieselbe Begründung wie bei den Arten: store.js darf nicht auf ebene.js
  // zeigen, also steht die Liste zweimal — und wird geprüft.
  const src = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const roh = /const ABSCHNITTE_EINGEBAUT = \[([\s\S]*?)\];/.exec(src);
  assert.ok(roh, 'ABSCHNITTE_EINGEBAUT nicht gefunden — wurde es umbenannt?');
  const imStore = [...roh[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(imStore, ABSCHNITTE.map(([k, l]) => [k, l]),
    'store.js und ebene.js führen verschiedene eingebaute Abschnitte');
});

test('DIE KOPIE DER EINGEBAUTEN ARTEN LÄUFT NICHT AUSEINANDER', () => {
  // store.js führt die eingebauten Arten bewusst doppelt: ein Import aus
  // ebene.js liefe verkehrt herum (Kern → Ansichtsschicht), dieselbe Begründung
  // wie bei `clone` und `artVon`. Doppelt geführt ist erlaubt, ungeprüft
  // doppelt nicht — genau wie bei den Versionsstellen.
  const src = readFileSync(new URL('../js/store.js', import.meta.url), 'utf8');
  const roh = /const TYPEN_EINGEBAUT = \[([\s\S]*?)\];/.exec(src);
  assert.ok(roh, 'TYPEN_EINGEBAUT nicht gefunden — wurde es umbenannt?');
  const imStore = [...roh[1].matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(imStore, PUNKT_TYPEN.map(([k, l]) => [k, l]),
    'store.js und ebene.js führen verschiedene eingebaute Arten');
});

console.log('\nPersonal & Maschinen');

test('addRessource legt eine Bezeichnung an, die im Plan bleibt', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  assert.equal(r.ok, true);
  assert.equal(s.state.project.ressourcen.length, 1);
  assert.equal(s.state.project.ressourcen[0].kind, 'personal');
});

test('addRessource ohne Namen wird abgelehnt', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'addRessource', label: '  ', kind: 'personal' }).ok, false);
});

test('addRessource lehnt doppelte Bezeichnungen ab, unabhängig von Groß/Klein', () => {
  const s = createStore(seed());
  s.apply({ type: 'addRessource', label: 'Stapler', kind: 'maschine' });
  assert.equal(s.apply({ type: 'addRessource', label: 'stapler', kind: 'maschine' }).ok, false);
});

test('setTaskRes hängt eine Zuweisung an, für den ganzen Vorgang', () => {
  const s = createStore(seed());
  s.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  const rid = s.state.project.ressourcen[0].id;
  const r = s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: 6, von: null, bis: null } });
  assert.equal(r.ok, true);
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 6, von: null, bis: null }]);
});

test('setTaskRes lehnt eine unbekannte Bezeichnung ab', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid: 'nix', n: 1, von: null, bis: null } }).ok, false);
});

test('setTaskRes lehnt eine Anzahl von 0 oder darunter ab', () => {
  const s = createStore(seed());
  s.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  const rid = s.state.project.ressourcen[0].id;
  assert.equal(s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: 0, von: null, bis: null } }).ok, false);
  assert.equal(s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: -2, von: null, bis: null } }).ok, false);
});

test('setTaskRes lehnt ein Zeitfenster außerhalb des Vorgangs ab', () => {
  // Vorgang a läuft 08:00–12:00 — ein Helfer, der vor dem Vorgang anfängt, ist
  // ein Tippfehler, kein Fall (docs/entscheidungen.md).
  const s = createStore(seed());
  s.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  const rid = s.state.project.ressourcen[0].id;
  const r = s.apply({ type: 'setTaskRes', id: 'a', index: null,
    value: { rid, n: 2, von: '2026-07-13T07:00', bis: '2026-07-13T10:00' } });
  assert.equal(r.ok, false);
});

test('setTaskRes: die Lücke bleibt aus, wenn das Fenster den ganzen Vorgang deckt', () => {
  const s = createStore(seed());
  s.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  const rid = s.state.project.ressourcen[0].id;
  const r = s.apply({ type: 'setTaskRes', id: 'a', index: null,
    value: { rid, n: 2, von: '2026-07-13T08:00', bis: '2026-07-13T10:00' } });
  assert.equal(r.ok, true);
});

test('setTaskRes mit value:null löscht die Zuweisung am Index', () => {
  const s = createStore(seed());
  s.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  const rid = s.state.project.ressourcen[0].id;
  s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: 2, von: null, bis: null } });
  const r = s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: null });
  assert.equal(r.ok, true);
  assert.deepEqual(taskById(s, 'a').res, []);
});

test('setTaskField lehnt das Feld res ab — Zuweisungen laufen über setTaskRes', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'res', value: [] }).ok, false);
});

test('Ressourcen gehen denselben Verwaltungsweg wie Arten und Abschnitte', () => {
  const s = createStore(seed());
  s.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  const rid = s.state.project.ressourcen[0].id;
  assert.equal(s.apply({ type: 'setAuswahlLabel', liste: 'ressourcen', id: rid, label: 'Helfer' }).ok, true);
  assert.equal(s.state.project.ressourcen[0].label, 'Helfer');
  // Benutzt → nicht löschbar, genau wie bei Arten/Abschnitten.
  s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: 1, von: null, bis: null } });
  assert.equal(s.apply({ type: 'removeAuswahl', liste: 'ressourcen', id: rid }).ok, false);
  s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: null });
  assert.equal(s.apply({ type: 'removeAuswahl', liste: 'ressourcen', id: rid }).ok, true);
});

test('addDep lehnt eine Verknüpfung an oder von einer Bereitstellung ab', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'bereitstellung', value: true });
  const r = s.apply({ type: 'addDep', dep: { from: 'a', to: 'b', type: 'FS' } });
  assert.equal(r.ok, false);
});

test('bereitstellung lässt sich nicht setzen, solange Verknüpfungen bestehen', () => {
  const s = createStore(seed());   // a → b ist schon verknüpft (seed)
  const r = s.apply({ type: 'setTaskField', id: 'a', field: 'bereitstellung', value: true });
  assert.equal(r.ok, false);
});

test('ein abgelehnter setTaskRes-Befehl hinterlässt nichts', () => {
  const s = createStore(seed());
  const vorher = s.canUndo;
  s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid: 'nix', n: 1, von: null, bis: null } });
  assert.equal(s.canUndo, vorher);
  assert.deepEqual(taskById(s, 'a').res, []);
});

console.log('\nFeldprüfung');

// Top-Level-await statt async-Tests: `test` wartet nicht auf Promises, ein
// async-Test würde also nie als ✗ zählen.
const { serialize, deserialize } = await import('../js/persistence.js');

test('setTaskField lehnt unbekannte Felder und id ab', () => {
  const s = createStore(seed());
  for (const field of ['id', 'quatsch', 'res']) {
    const r = s.apply({ type: 'setTaskField', id: 'a', field, value: 'x' });
    assert.equal(r.ok, false, field);
  }
  assert.equal(taskById(s, 'a').id, 'a');
  assert.equal(taskById(s, 'a').quatsch, undefined);
  assert.equal(s.canUndo, false);
});
test('setTaskField prüft status und punktTyp', () => {
  const s = createStore(seed());
  s.apply({ type: 'addPunktTyp', label: 'Line-Check' });
  const eigene = s.state.project.punktTypen[0].id;
  const set = (field, value) => s.apply({ type: 'setTaskField', id: 'a', field, value });
  assert.equal(set('status', 'kaputt').ok, false);
  assert.equal(set('status', 'fertig').ok, true);
  assert.equal(set('punktTyp', 'gibtsnicht').ok, false);
  assert.equal(set('punktTyp', 'changeover').ok, true);
  assert.equal(set('punktTyp', eigene).ok, true);
  assert.equal(taskById(s, 'a').punktTyp, eigene);
});
test('setTaskField trimmt den Titel', () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskField', id: 'a', field: 'title', value: '  Neu  ' });
  assert.equal(taskById(s, 'a').title, 'Neu');
});
test('setTaskField: Vorgang mit veraltetem punktTyp bleibt in anderen Feldern bearbeitbar', () => {
  const st = seed();
  st.tasks[0].punktTyp = 'geloescht';
  const s = createStore(st);
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'notes', value: 'x' }).ok, true);
  assert.equal(taskById(s, 'a').notes, 'x');
});
test('addTask übernimmt slot, punktTyp, estimated, anforderungen, material, kontakt', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: {
    gewerk: 'buehne', title: 'Act', start: '2026-07-14T20:00', end: '2026-07-14T21:00',
    slot: 3, punktTyp: 'doors', estimated: true,
    anforderungen: 'Strom', material: 'Riser', kontakt: 'Max',
  } });
  const gewuenscht = { slot: 3, punktTyp: 'doors', estimated: true, anforderungen: 'Strom', material: 'Riser', kontakt: 'Max' };
  const hat = (t) => { for (const [k, v] of Object.entries(gewuenscht)) assert.equal(t[k], v, k); };
  hat(taskById(s, r.id));
  const zurueck = deserialize(serialize(s.state)).plan;
  hat(zurueck.tasks.find((t) => t.id === r.id));
});
test('addTask setzt die Defaults von migrate', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'buehne', title: 'X', start: '2026-07-14T08:00', end: '2026-07-14T09:00' } });
  const t = taskById(s, r.id);
  assert.equal(t.punktTyp, 'act');
  assert.equal(t.slot, null);
  assert.equal(t.estimated, false);
  assert.equal('ackCrit' in t, false);
  assert.equal(t.ackConflictMin, null);
  for (const k of ['anforderungen', 'material', 'kontakt']) assert.equal(t[k], '', k);
});
test('addTask prüft slot, punktTyp und status wie setTaskField', () => {
  const s = createStore(seed());
  const basis = { gewerk: 'buehne', title: 'X', start: '2026-07-14T08:00', end: '2026-07-14T09:00' };
  for (const extra of [{ slot: 99 }, { punktTyp: 'x' }, { status: 'kaputt' }]) {
    const r = s.apply({ type: 'addTask', task: { ...basis, ...extra } });
    assert.equal(r.ok, false, JSON.stringify(extra));
  }
  assert.equal(s.state.tasks.length, 2);
  assert.equal(s.canUndo, false);
});
test('STATUS_IDS deckt sich mit STATUS aus dom.js', () => {
  // dom.js greift auf Modulebene nicht aufs DOM zu, importiert wird trotzdem
  // nicht: der Text genügt und bleibt unabhängig von document.
  const src = readFileSync(new URL('../js/dom.js', import.meta.url), 'utf8');
  const roh = /export const STATUS = \[(.*)\];/.exec(src);
  assert.ok(roh, 'STATUS in dom.js nicht gefunden');
  const ids = [...roh[1].matchAll(/\['([^']+)',/g)].map((m) => m[1]);
  assert.deepEqual(STATUS_IDS, ids);
});

console.log('\nZuweisungs-Fenster folgen dem Vorgang');
// Vorgang 'a' (13.07. 08–12) bekommt eine Zuweisung mit Fenster.
const mitFenster = (von, bis) => {
  const s = createStore(seed());
  s.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  const rid = s.state.project.ressourcen[0].id;
  const r = s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: 2, von, bis } });
  assert.equal(r.ok, true, r.error);
  return { s, rid };
};
test('moveTask verschiebt Zuweisungs-Fenster um dieselbe Differenz', () => {
  const { s, rid } = mitFenster('2026-07-13T09:00', '2026-07-13T10:00');
  assert.equal(s.apply({ type: 'moveTask', id: 'a', start: '2026-07-13T14:00', end: '2026-07-13T18:00' }).ok, true);
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 2, von: '2026-07-13T15:00', bis: '2026-07-13T16:00' }]);
  // ein Undo holt Vorgang UND Fenster zurück
  s.undo();
  assert.equal(taskById(s, 'a').start, '2026-07-13T08:00');
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 2, von: '2026-07-13T09:00', bis: '2026-07-13T10:00' }]);
});
test('Sammelvorgang: Hüllen-Wechsel zieht das Zuweisungs-Fenster des Elternvorgangs nach', () => {
  // Elternvorgang a (08–12) mit Fenster 10–12; ein Kind 14–18 setzt die Hülle auf
  // 14–18 (gleich lang = Verschiebung um 6 h). Ohne Nachziehen läge das Fenster
  // außerhalb seines Vorgangs, und setTaskRes hätte es nie zugelassen.
  const { s, rid } = mitFenster('2026-07-13T10:00', '2026-07-13T12:00');
  const r = s.apply({ type: 'addTask', task: { gewerk: 'buehne', parent: 'a', title: 'Kind', start: '2026-07-13T14:00', end: '2026-07-13T18:00' } });
  assert.notEqual(r.ok, false, r.error);
  assert.equal(taskById(s, 'a').start, '2026-07-13T14:00');
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 2, von: '2026-07-13T16:00', bis: '2026-07-13T18:00' }]);
  s.undo();
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 2, von: '2026-07-13T10:00', bis: '2026-07-13T12:00' }]);
});
test('Dauer ändern beschneidet Fenster auf den Vorgang', () => {
  const { s, rid } = mitFenster('2026-07-13T10:00', '2026-07-13T12:00');
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'end', value: '2026-07-13T11:00' }).ok, true);
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 2, von: '2026-07-13T10:00', bis: '2026-07-13T11:00' }]);
});
test('Fenster ganz außerhalb wird zum ganzen Vorgang', () => {
  const { s, rid } = mitFenster('2026-07-13T11:00', '2026-07-13T12:00');
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'end', value: '2026-07-13T10:00' }).ok, true);
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 2, von: null, bis: null }]);
});
test('Fenster null bleibt null beim Verschieben', () => {
  const { s, rid } = mitFenster(null, null);
  s.apply({ type: 'moveTask', id: 'a', start: '2026-07-14T08:00', end: '2026-07-14T12:00' });
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 2, von: null, bis: null }]);
});
test('Start ändern beschneidet von des Fensters', () => {
  const { s, rid } = mitFenster('2026-07-13T09:00', '2026-07-13T11:00');
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'start', value: '2026-07-13T10:00' }).ok, true);
  assert.deepEqual(taskById(s, 'a').res, [{ rid, n: 2, von: '2026-07-13T10:00', bis: '2026-07-13T11:00' }]);
});
test('Verschieben über den Sommerzeit-Wechsel 25.10.2026 behält die Differenz in echten Minuten', () => {
  // Vorgang 25.10. 01:00–05:00 (5 echte Stunden nur in Europe/Berlin, der Wechsel 03:00→02:00 liegt mittendrin),
  // Fenster 02:30–04:00 überspannt den Wechsel (nur in Europe/Berlin); verschoben um 24 echte
  // Stunden bei gleicher echter Dauer. Das Ziel wird aus echten Minuten gerechnet und gilt so in jeder Zone.
  const { s } = mitFenster('2026-07-13T09:00', '2026-07-13T10:00');
  s.apply({ type: 'moveTask', id: 'a', start: '2026-10-25T01:00', end: '2026-10-25T05:00' });
  const rid = taskById(s, 'a').res[0].rid;
  s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: { rid, n: 2, von: '2026-10-25T02:30', bis: '2026-10-25T04:00' } });
  const t0 = { ...taskById(s, 'a') }, w0 = { ...taskById(s, 'a').res[0] };
  // Ziel aus echten Minuten: ein Tag später, gleiche echte Dauer — in jeder Zone.
  const dauer = toMin(t0.end) - toMin(t0.start);
  const neuStart = local(toDate(toMin(t0.start) + 1440));
  const neuEnde = local(toDate(toMin(neuStart) + dauer));
  assert.equal(s.apply({ type: 'moveTask', id: 'a', start: neuStart, end: neuEnde }).ok, true);
  const t = taskById(s, 'a'), w = t.res[0];
  const delta = toMin(t.start) - toMin(t0.start);
  assert.equal(toMin(w.von) - toMin(w0.von), delta);
  assert.equal(toMin(w.bis) - toMin(w0.bis), delta);
  assert.equal(toMin(w.bis) - toMin(w.von), toMin(w0.bis) - toMin(w0.von));
});

console.log('\nOhne Termin (start und end beide null)');
const neu = (extra = {}) => ({ type: 'addTask', task: { gewerk: 'buehne', title: 'Rigging', start: null, end: null, ...extra } });
test('addTask: ein Vorgang ohne Termin ist erlaubt, auch als Meilenstein', () => {
  const s = createStore(seed());
  assert.equal(s.apply(neu()).ok, true);
  assert.equal(s.apply(neu({ title: 'Marke', milestone: true })).ok, true);
  const t = s.state.tasks.at(-2);
  assert.equal(t.start, null);
  assert.equal(t.end, null);
});
test('addTask: ein einzelnes null wird abgelehnt und hinterlässt nichts', () => {
  const s = createStore(seed());
  assert.equal(s.apply(neu({ start: '2026-07-13T08:00' })).ok, false);
  assert.equal(s.apply(neu({ end: '2026-07-13T08:00' })).ok, false);
  assert.equal(s.state.tasks.length, 2);
  assert.equal(s.dirty, false);
});
test('moveTask start/end null: macht ohne Termin, EIN Befehl, ein Undo-Schritt', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'moveTask', id: 'a', start: null, end: null }).ok, true);
  assert.equal(taskById(s, 'a').start, null);
  assert.equal(taskById(s, 'a').end, null);
  s.undo();
  assert.equal(taskById(s, 'a').start, '2026-07-13T08:00');
  assert.equal(taskById(s, 'a').end, '2026-07-13T12:00');
});
test('moveTask: aus «ohne Termin» einen Termin setzen', () => {
  const s = createStore(seed());
  s.apply({ type: 'moveTask', id: 'a', start: null, end: null });
  assert.equal(s.apply({ type: 'moveTask', id: 'a', start: '2026-07-14T08:00', end: '2026-07-14T09:00' }).ok, true);
  assert.equal(taskById(s, 'a').end, '2026-07-14T09:00');
});
test('moveTask: ein einzelnes null wird abgelehnt', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'moveTask', id: 'a', start: null, end: '2026-07-13T12:00' }).ok, false);
  assert.equal(taskById(s, 'a').start, '2026-07-13T08:00');
});
test('setTaskField: einzelnes start/end null wird abgelehnt (dafür gibt es moveTask)', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'start', value: null }).ok, false);
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'end', value: null }).ok, false);
  assert.equal(s.dirty, false);
});
test('setTaskField: bei einem terminlosen Vorgang bleibt ein einzelnes Datum ungültig', () => {
  const s = createStore(seed());
  s.apply({ type: 'moveTask', id: 'a', start: null, end: null });
  assert.equal(s.apply({ type: 'setTaskField', id: 'a', field: 'start', value: '2026-07-14T08:00' }).ok, false);
});
test('Zuweisungsfenster: ohne Termin werden sie zu «ganzer Vorgang», ein Fenster ist dort nicht setzbar', () => {
  const s = createStore(seed());
  s.apply({ type: "addRessource", label: 'Hallenhelfer', kind: "personal" });
  const rid = s.state.project.ressourcen[0].id;
  s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: 2, von: '2026-07-13T09:00', bis: '2026-07-13T10:00' } });
  s.apply({ type: 'moveTask', id: 'a', start: null, end: null });
  assert.deepEqual(taskById(s, 'a').res.map((z) => [z.von, z.bis]), [[null, null]]);
  assert.equal(s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: 1, von: '2026-07-13T09:00', bis: '2026-07-13T10:00' } }).ok, false);
  assert.equal(s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid, n: 1, von: null, bis: null } }).ok, true);
});
test('Hülle: alle Kinder terminlos → Eltern terminlos; ein terminiertes Kind setzt die Hülle', () => {
  const s = createStore(seed());
  s.apply({ type: 'addTask', task: { gewerk: 'buehne', title: 'K1', parent: 'a', start: null, end: null, id: 'k1' } });
  assert.equal(taskById(s, 'a').start, null);
  assert.equal(taskById(s, 'a').end, null);
  s.apply({ type: 'addTask', task: { gewerk: 'buehne', title: 'K2', parent: 'a', start: '2026-07-15T08:00', end: '2026-07-15T10:00', id: 'k2' } });
  assert.equal(taskById(s, 'a').start, '2026-07-15T08:00');
  assert.equal(taskById(s, 'a').end, '2026-07-15T10:00');
  s.apply({ type: 'moveTask', id: 'k2', start: null, end: null });
  assert.equal(taskById(s, 'a').start, null);
  s.undo();
  assert.equal(taskById(s, 'a').start, '2026-07-15T08:00');
});

console.log('\nPrüfpaket');
test('setDepField lehnt fremde Felder und krummen Lag ab', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setDepField', id: 'd1', field: 'from', value: 'b' }).ok, false);
  assert.equal(s.apply({ type: 'setDepField', id: 'd1', field: 'lag', value: 1.5 }).ok, false);
  assert.equal(s.canUndo, false);
  assert.equal(s.apply({ type: 'setDepField', id: 'd1', field: 'lag', value: -120 }).ok, true);
  assert.equal(s.state.deps[0].from, 'a'); assert.equal(s.canUndo, true);
});
test('setGewerkField schreibt nur den Namen', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setGewerkField', id: 'buehne', field: 'slot', value: 7 }).ok, false);
  assert.equal(s.apply({ type: 'setGewerkField', id: 'buehne', field: 'id', value: 'x' }).ok, false);
  assert.equal(s.state.gewerke[0].id, 'buehne');
  assert.equal(s.apply({ type: 'setGewerkField', id: 'buehne', field: 'name', value: 'Hauptbühne' }).ok, true);
});
test('removeGewerk nimmt Soundchecks auf anderen Bühnen mit (fuer)', () => {
  const st = seed();
  st.gewerke.push({ id: 'b2', name: 'Bühne 2', art: 'buehne', sort: 2 });
  const mk = (id, gewerk, fuer) => ({ id, gewerk, title: id, start: '2026-07-13T08:00', end: '2026-07-13T09:00', milestone: false, progress: 0, status: 'geplant', fuer });
  st.tasks.push(mk('act', 'buehne', null), mk('sc', 'b2', 'act'));
  const s = createStore(st);
  assert.equal(s.apply({ type: 'removeGewerk', id: 'buehne' }).ok, true);
  assert.equal(taskById(s, 'sc'), undefined);
  assert.equal(taskById(s, 'act'), undefined);
});
test('shiftPlan verschiebt alles um Tage und Minuten, Uhrzeit bleibt über die Sommerzeit', () => {
  const st = seed();
  st.project.start = '2026-10-20T00:00'; st.project.end = '2026-10-27T00:00';
  st.tasks[0].start = '2026-10-24T22:00'; st.tasks[0].end = '2026-10-25T04:00';
  st.tasks[0].res = [{ rid: 'crew', n: 2, von: '2026-10-24T23:00', bis: '2026-10-25T01:00' }, { rid: 'crew', n: 1, von: null, bis: null }];
  st.tasks[1].start = null; st.tasks[1].end = null;
  st.phases = [{ id: 'ph1', art: 'aufbau', start: '2026-10-24T08:00', end: '2026-10-26T08:00' }];
  const s = createStore(st);
  assert.equal(s.apply({ type: 'shiftPlan', tage: 7, minuten: 30 }).ok, true);
  const a = taskById(s, 'a');
  assert.equal(a.start, '2026-10-31T22:30'); assert.equal(a.end, '2026-11-01T04:30');
  assert.equal(a.res[0].von, '2026-10-31T23:30'); assert.equal(a.res[0].bis, '2026-11-01T01:30');
  assert.equal(a.res[1].von, null); assert.equal(a.res[1].bis, null);
  assert.equal(s.state.phases[0].start, '2026-10-31T08:30'); assert.equal(s.state.phases[0].end, '2026-11-02T08:30');
  assert.equal(s.state.project.start, '2026-10-27T00:30'); assert.equal(s.state.project.end, '2026-11-03T00:30');
  const b = taskById(s, 'b'); assert.equal(b.start, null); assert.equal(b.end, null);
  s.undo();
  assert.equal(taskById(s, 'a').start, '2026-10-24T22:00');
  assert.equal(s.state.phases[0].end, '2026-10-26T08:00');
  assert.equal(s.state.project.start, '2026-10-20T00:00');
});
test('shiftPlan lehnt 0/0 und Nicht-Ganzzahlen ab, ohne Undo-Eintrag', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'shiftPlan', tage: 0, minuten: 0 }).ok, false);
  assert.equal(s.apply({ type: 'shiftPlan', tage: 1.5, minuten: 0 }).ok, false);
  assert.equal(s.apply({ type: 'shiftPlan', tage: 1, minuten: 'x' }).ok, false);
  assert.equal(s.canUndo, false);
});
test('shiftPlan lehnt Werte über der Obergrenze ab: Zustand unverändert, kein Undo', () => {
  const s = createStore(seed());
  const vor = JSON.stringify(s.state);
  for (const cmd of [{ tage: 36501, minuten: 0 }, { tage: -36501, minuten: 0 }, { tage: 0, minuten: 10081 }, { tage: 1, minuten: -10081 }]) {
    const r = s.apply({ type: 'shiftPlan', ...cmd });
    assert.equal(r.ok, false);
    assert.match(r.error, /Höchstens/);
  }
  assert.equal(JSON.stringify(s.state), vor);
  assert.equal(s.canUndo, false);
  assert.equal(s.apply({ type: 'shiftPlan', tage: 36500, minuten: 10080 }).ok, true);
});
test('verschiebeZeit: Tage nach Wanduhr, Minuten echt (Umstellung 25./26.10.2026)', () => {
  assert.equal(verschiebeZeit('2026-10-24T22:00', 1, 0), '2026-10-25T22:00');
  assert.equal(verschiebeZeit('2026-10-24T22:00', 2, 0), '2026-10-26T22:00');   // 25 h dazwischen, Uhr bleibt
  assert.equal(verschiebeZeit('2026-10-25T00:30', 0, 240), '2026-10-25T03:30');  // 4 echte Stunden = 3 Wanduhrstunden (die Stunde 02–03 gibt es zweimal)
  assert.equal(verschiebeZeit('2026-10-25T00:30', 1, 0), '2026-10-26T00:30');
  assert.equal(verschiebeZeit(null, 3, 3), null);
});

console.log('\nProjektangaben');
test('setProjectField lehnt unbekannte Felder ab', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'setProjectField', field: 'id', value: 'x' });
  assert.equal(r.ok, false); assert.equal(s.canUndo, false);
  assert.equal(s.state.project.id, 'p1');
});
test('setProjectField prüft kontakte', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setProjectField', field: 'kontakte', value: 'x' }).ok, false);
  assert.equal(s.apply({ type: 'setProjectField', field: 'kontakte', value: [{ name: 'A' }] }).ok, false);
  assert.equal(s.canUndo, false);
  const r = s.apply({ type: 'setProjectField', field: 'kontakte', value: [{ id: 'k1', name: ' Ann ', rolle: null, tel: 12 }] });
  assert.equal(r.ok, true);
  assert.deepEqual(s.state.project.kontakte, [{ id: 'k1', name: 'Ann', rolle: '', tel: '12' }]);
  s.undo();
  assert.equal(s.canUndo, false);
  assert.equal(s.state.project.kontakte, undefined);
});
test('setProjectField lehnt leeres/ungültiges Datum für Beginn und Ende ab', () => {
  for (const [field, value] of [['start', ''], ['end', ''], ['end', 'quatsch'], ['start', 'quatsch']]) {
    const s = createStore(seed());
    const vorher = JSON.stringify(s.state.project);
    const r = s.apply({ type: 'setProjectField', field, value });
    assert.equal(r.ok, false, field + '=' + value);
    assert.equal(JSON.stringify(s.state.project), vorher);
    assert.equal(s.canUndo, false);
  }
});
test('setProjectField prüft die Zeitzone', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setProjectField', field: 'timezone', value: 'Europe/Berlin' }).ok, true);
  const r = s.apply({ type: 'setProjectField', field: 'timezone', value: 'Mars/Olymp' });
  assert.equal(r.ok, false); assert.equal(r.error, 'Unbekannte Zeitzone: Mars/Olymp');
});
test('setProjectField eingerichtet nur boolesch', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setProjectField', field: 'eingerichtet', value: 'ja' }).ok, false);
  assert.equal(s.apply({ type: 'setProjectField', field: 'eingerichtet', value: false }).ok, true);
});
test('Zeitraum ändern verschiebt nichts', () => {
  const s = createStore(seed());
  const vor = JSON.stringify([s.state.tasks, s.state.phases]);
  assert.equal(s.apply({ type: 'setProjectField', field: 'start', value: '2026-07-01T00:00' }).ok, true);
  assert.equal(s.apply({ type: 'setProjectField', field: 'end', value: '2026-08-01T00:00' }).ok, true);
  assert.equal(JSON.stringify([s.state.tasks, s.state.phases]), vor);
});

console.log('\nEingebaute Bezeichnungen (Store)');
test('setTaskRes mit eingebauter Bezeichnung geht ohne eigene Liste', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid: 'p-stagehand', n: 2, von: null, bis: null } }).ok, true);
  assert.equal((s.state.project.ressourcen || []).length, 0);
});
test('addRessource gegen eingebaute: doppelter Name abgelehnt', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addRessource', label: 'Gabelstapler bis 3,5 t', kind: 'maschine' });
  assert.equal(r.ok, false);
  assert.ok(String(r.error || r.fehler || r.message || JSON.stringify(r)).includes('Diese Bezeichnung gibt es schon: '));
});
test('addRessource mit kat wird mit kat gespeichert, ohne kat → eigene-m', () => {
  const s = createStore(seed());
  assert.equal(s.apply({ type: 'addRessource', label: 'Bagger', kind: 'maschine', kat: 'stapler' }).ok, true);
  assert.equal(s.state.project.ressourcen[0].kat, 'stapler');
  s.apply({ type: 'addRessource', label: 'Walze', kind: 'maschine' });
  assert.equal(s.state.project.ressourcen[1].kat, 'eigene-m');
});
test('addRessource: Kategorie einer anderen Art wird abgelehnt, nichts angelegt', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addRessource', label: 'Bagger', kind: 'maschine', kat: 'helfer' });
  assert.equal(r.ok, false);
  assert.ok(JSON.stringify(r).includes('Unbekannte Kategorie: helfer'));
  assert.equal((s.state.project.ressourcen || []).length, 0);
});
test('removeAuswahl einer eingebauten Bezeichnung: «fest eingebaut»', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'removeAuswahl', liste: 'ressourcen', id: 'm-raupe' });
  assert.equal(r.ok, false);
  assert.ok(JSON.stringify(r).includes('fest eingebaut'));
});

console.log('\nBedarfsstatus');
const mitRes = () => {
  const s = createStore(seed());
  s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid: 'p-stagehand', n: 4, von: null, bis: null } });
  s.apply({ type: 'setTaskRes', id: 'a', index: null, value: { rid: 'p-runner', n: 2, von: null, bis: null } });
  return s;
};
const AM = '2026-07-01T10:00:00.000Z';
test('setResStatus bestätigt, Undo holt angefragt zurück', () => {
  const s = mitRes();
  const r = s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'bestaetigt', am: AM, notiz: 'Mail von Herrn X' });
  assert.equal(r.ok, true);
  const z = taskById(s, 'a').res[0];
  assert.equal(z.status, 'bestaetigt'); assert.equal(z.bestaetigtAm, AM); assert.equal(z.notiz, 'Mail von Herrn X');
  assert.ok(s.undo());
  assert.equal('status' in taskById(s, 'a').res[0], false);
  assert.equal('bestaetigtAm' in taskById(s, 'a').res[0], false);
});
test('angefragt entfernt bestaetigtAm; Notiz wird gekürzt, leer entfernt', () => {
  const s = mitRes();
  s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'abgelehnt', am: AM, notiz: 'x'.repeat(300) });
  assert.equal(taskById(s, 'a').res[0].notiz.length, 200);
  s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'angefragt', notiz: '  ' });
  const z = taskById(s, 'a').res[0];
  assert.deepEqual(Object.keys(z).sort(), ['bis', 'n', 'rid', 'von']);
});
test('RES_STATUS: genau die drei Werte', () => {
  assert.deepEqual(RES_STATUS, ['angefragt', 'bestaetigt', 'abgelehnt']);
});
test('unbekannter Status hinterlässt nichts', () => {
  const s = mitRes();
  const undoVorher = s.canUndo; s.markSaved();
  const r = s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'vielleicht' });
  assert.equal(r.ok, false);
  assert.ok(JSON.stringify(r).includes('Unbekannter Status: vielleicht'));
  assert.equal(s.canUndo, undoVorher); assert.equal(s.dirty, false);
});
test('Anzahl ändern setzt bestätigt zurück, gleiche Werte nicht', () => {
  const s = mitRes();
  s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'bestaetigt', am: AM });
  s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: { rid: 'p-stagehand', n: 4, von: null, bis: null } });
  assert.equal(taskById(s, 'a').res[0].status, 'bestaetigt');
  s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: { rid: 'p-stagehand', n: 5, von: null, bis: null } });
  assert.equal('status' in taskById(s, 'a').res[0], false);
  assert.equal('bestaetigtAm' in taskById(s, 'a').res[0], false);
});
test('Vorgang verschieben setzt bestätigt zurück, gleiche Zeit nicht', () => {
  const s = mitRes();
  s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'bestaetigt', am: AM });
  s.apply({ type: 'moveTask', id: 'a', start: '2026-07-13T08:00', end: '2026-07-13T12:00' });
  assert.equal(taskById(s, 'a').res[0].status, 'bestaetigt');
  s.apply({ type: 'moveTask', id: 'a', start: '2026-07-13T09:00', end: '2026-07-13T13:00' });
  assert.equal('status' in taskById(s, 'a').res[0], false);
});
test('Ende ändern (setTaskField end) setzt zurück, gleiche Zeit nicht', () => {
  const s = mitRes();
  s.apply({ type: 'setResStatus', id: 'a', index: 1, status: 'abgelehnt', am: AM });
  s.apply({ type: 'setTaskField', id: 'a', field: 'end', value: '2026-07-13T12:00' });
  assert.equal(taskById(s, 'a').res[1].status, 'abgelehnt');
  s.apply({ type: 'setTaskField', id: 'a', field: 'end', value: '2026-07-13T13:00' });
  assert.equal('status' in taskById(s, 'a').res[1], false);
});
test('shiftPlan setzt Status zurück', () => {
  const s = mitRes();
  s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'bestaetigt', am: AM });
  assert.equal(s.apply({ type: 'shiftPlan', tage: 1, minuten: 0 }).ok, true);
  assert.equal('status' in taskById(s, 'a').res[0], false);
});
test('duplicateTask: Kopie ohne Status, Original behält ihn', () => {
  const s = mitRes();
  s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'bestaetigt', am: AM, notiz: 'ok' });
  const id = s.apply({ type: 'duplicateTask', id: 'a' }).id;
  assert.equal(taskById(s, 'a').res[0].status, 'bestaetigt');
  assert.deepEqual(Object.keys(taskById(s, id).res[0]).sort(), ['bis', 'n', 'rid', 'von']);
});
test('Bereitstellung lehnt setResStatus ab', () => {
  const s = mitRes();
  s.apply({ type: 'removeDep', id: 'd1' });   // Bereitstellung verträgt keine Verknüpfung
  assert.equal(s.apply({ type: 'setTaskField', id: 'b', field: 'bereitstellung', value: true }).ok, true);
  s.apply({ type: 'setTaskRes', id: 'b', index: null, value: { rid: 'p-runner', n: 1, von: null, bis: null } });
  const r = s.apply({ type: 'setResStatus', id: 'b', index: 0, status: 'bestaetigt', am: AM });
  assert.equal(r.ok, false);
  assert.ok(JSON.stringify(r).includes('Eine Bereitstellung hat keinen Status.'));
});
test('Untervorgang verschieben: eigener Status fällt zurück, Geschwister bleibt', () => {
  const sd = seed();
  sd.tasks = [
    { id: 'p', gewerk: 'buehne', title: 'Sammel', start: '2026-07-13T08:00', end: '2026-07-13T16:00', milestone: false, progress: 0, status: 'geplant' },
    { id: 'k1', gewerk: 'buehne', parent: 'p', title: 'K1', start: '2026-07-13T08:00', end: '2026-07-13T12:00', milestone: false, progress: 0, status: 'geplant',
      res: [{ rid: 'p-runner', n: 1, von: null, bis: null, status: 'bestaetigt', bestaetigtAm: AM }] },
    { id: 'k2', gewerk: 'buehne', parent: 'p', title: 'K2', start: '2026-07-13T12:00', end: '2026-07-13T16:00', milestone: false, progress: 0, status: 'geplant',
      res: [{ rid: 'p-runner', n: 1, von: null, bis: null, status: 'bestaetigt', bestaetigtAm: AM }] },
  ];
  sd.deps = [];
  const s = createStore(sd);
  assert.equal(s.apply({ type: 'moveTask', id: 'k1', start: '2026-07-13T07:00', end: '2026-07-13T11:00' }).ok, true);
  assert.equal('status' in taskById(s, 'k1').res[0], false);
  assert.equal(taskById(s, 'k2').res[0].status, 'bestaetigt');
});
test('Sammelvorgang: ändert sich die Hülle, fällt ein Status am Elternvorgang zurück (reflowParents)', () => {
  const sd = seed();
  sd.tasks = [
    { id: 'p', gewerk: 'buehne', title: 'Sammel', start: '2026-07-13T08:00', end: '2026-07-13T16:00', milestone: false, progress: 0, status: 'geplant',
      res: [{ rid: 'p-runner', n: 1, von: null, bis: null, status: 'bestaetigt', bestaetigtAm: AM }] },
    { id: 'k1', gewerk: 'buehne', parent: 'p', title: 'K1', start: '2026-07-13T08:00', end: '2026-07-13T12:00', milestone: false, progress: 0, status: 'geplant' },
    { id: 'k2', gewerk: 'buehne', parent: 'p', title: 'K2', start: '2026-07-13T12:00', end: '2026-07-13T16:00', milestone: false, progress: 0, status: 'geplant' },
  ];
  sd.deps = [];
  const s = createStore(sd);
  // Hülle bleibt gleich (K1 wandert innerhalb): Status bleibt.
  s.apply({ type: 'moveTask', id: 'k1', start: '2026-07-13T08:00', end: '2026-07-13T11:00' });
  assert.equal(taskById(s, 'p').res[0].status, 'bestaetigt');
  // Hülle ändert sich (K2 endet später): Status fällt zurück.
  s.apply({ type: 'moveTask', id: 'k2', start: '2026-07-13T12:00', end: '2026-07-13T18:00' });
  assert.equal(taskById(s, 'p').end, '2026-07-13T18:00');
  assert.equal('status' in taskById(s, 'p').res[0], false);
});
test('setTaskRes: value ohne von/bis-Felder behält den Status (undefined = null)', () => {
  const s = mitRes();
  s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'bestaetigt', am: AM });
  assert.equal(s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: { rid: 'p-stagehand', n: 4 } }).ok, true);
  assert.equal(taskById(s, 'a').res[0].status, 'bestaetigt');
});
test('setResStatus: Index außerhalb / unbekannter Vorgang werden abgelehnt, nichts bleibt', () => {
  const s = mitRes(); s.markSaved();
  const u = s.canUndo;
  assert.equal(s.apply({ type: 'setResStatus', id: 'a', index: 7, status: 'bestaetigt' }).ok, false);
  assert.equal(s.apply({ type: 'setResStatus', id: 'a', index: -1, status: 'bestaetigt' }).ok, false);
  assert.equal(s.apply({ type: 'setResStatus', id: 'nix', index: 0, status: 'bestaetigt' }).ok, false);
  assert.equal(s.canUndo, u); assert.equal(s.dirty, false);
});
test('setResStatusMehrere: alles oder nichts, ein Undo-Schritt', () => {
  const s = mitRes();
  s.markSaved();
  const undoVorher = s.canUndo;
  const schlecht = s.apply({ type: 'setResStatusMehrere', status: 'bestaetigt', am: AM, eintraege: [{ id: 'a', index: 0 }, { id: 'a', index: 9 }] });
  assert.equal(schlecht.ok, false);
  assert.equal(s.dirty, false); assert.equal(s.canUndo, undoVorher);
  assert.equal('status' in taskById(s, 'a').res[0], false);
  const r = s.apply({ type: 'setResStatusMehrere', status: 'bestaetigt', am: AM, eintraege: [{ id: 'a', index: 0 }, { id: 'a', index: 1 }] });
  assert.equal(r.ok, true);
  assert.deepEqual(taskById(s, 'a').res.map((z) => z.status), ['bestaetigt', 'bestaetigt']);
  assert.ok(s.undo());
  assert.deepEqual(taskById(s, 'a').res.map((z) => 'status' in z), [false, false]);
});

console.log('\nBedarfsstatus: Fensterform, Ablehnung, addTask (Issue #10)');
const bestaetigt = () => {
  const s = mitRes();
  s.apply({ type: 'setResStatus', id: 'a', index: 0, status: 'bestaetigt', am: AM, notiz: 'ok' });
  return s;
};
test('Fenster = ganzer Vorgang behält den Status (null -> exakt start/end)', () => {
  const s = bestaetigt();
  const r = s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: { rid: 'p-stagehand', n: 4, von: '2026-07-13T08:00', bis: '2026-07-13T12:00' } });
  assert.equal(r.ok, true);
  assert.equal(taskById(s, 'a').res[0].status, 'bestaetigt');
});
test('anderes Stringformat derselben Minute behält den Status', () => {
  const s = bestaetigt();
  s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: { rid: 'p-stagehand', n: 4, von: '2026-07-13T08:00', bis: '2026-07-13T12:00' } });
  const r = s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: { rid: 'p-stagehand', n: 4, von: '2026-07-13T08:00:00', bis: '2026-07-13T12:00:00' } });
  assert.equal(r.ok, true);
  assert.equal(taskById(s, 'a').res[0].status, 'bestaetigt');
});
test('echte Zeitänderung des Fensters setzt auf angefragt zurück (Gegenprobe)', () => {
  const s = bestaetigt();
  const r = s.apply({ type: 'setTaskRes', id: 'a', index: 0, value: { rid: 'p-stagehand', n: 4, von: '2026-07-13T09:00', bis: '2026-07-13T12:00' } });
  assert.equal(r.ok, true);
  assert.equal('status' in taskById(s, 'a').res[0], false);
});
test('setTaskRes ohne value / mit kaputtem Wert: Ablehnung, nichts hinterlassen', () => {
  const s = bestaetigt();
  s.markSaved();
  const undoVorher = s.canUndo;
  for (const value of [undefined, 'x', 42, [], { n: 1 }]) {
    let r;
    assert.doesNotThrow(() => { r = s.apply({ type: 'setTaskRes', id: 'a', index: 0, value }); });
    assert.equal(r.ok, false);
  }
  assert.equal(s.canUndo, undoVorher); assert.equal(s.dirty, false);
  assert.equal(taskById(s, 'a').res[0].status, 'bestaetigt');
});
test('addTask reicht gültigen Bedarfsstatus durch', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'licht', title: 'X', start: '2026-07-14T08:00', end: '2026-07-14T10:00',
    res: [{ rid: 'p-stagehand', n: 2, von: null, bis: null, status: 'bestaetigt', notiz: 'Mail', bestaetigtAm: AM }] } });
  const z = taskById(s, r.id).res[0];
  assert.deepEqual([z.status, z.notiz, z.bestaetigtAm], ['bestaetigt', 'Mail', AM]);
});
test('addTask verwirft unbekannten Status samt Notiz, kürzt lange Notiz', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'licht', title: 'X', start: '2026-07-14T08:00', end: '2026-07-14T10:00',
    res: [{ rid: 'p-stagehand', n: 2, status: 'quatsch', notiz: 'weg', bestaetigtAm: AM },
          { rid: 'p-runner', n: 1, status: 'abgelehnt', notiz: 'y'.repeat(300) }] } });
  const [a, b] = taskById(s, r.id).res;
  assert.deepEqual(Object.keys(a).sort(), ['bis', 'n', 'rid', 'von']);
  assert.equal(b.notiz.length, 200);
});
test('addTask: Bereitstellung bekommt keinen Status', () => {
  const s = createStore(seed());
  const r = s.apply({ type: 'addTask', task: { gewerk: 'licht', title: 'Pool', start: '2026-07-14T08:00', end: '2026-07-14T10:00',
    bereitstellung: true, res: [{ rid: 'p-stagehand', n: 2, status: 'bestaetigt' }] } });
  assert.equal('status' in taskById(s, r.id).res[0], false);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
