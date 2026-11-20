// ── Phasen: Datenmodell, Migration, Store, Import, Show-Tage ────────────────
import assert from 'node:assert/strict';
import { createStore } from '../js/store.js';
import { migrate, serialize, deserialize } from '../js/persistence.js';
import { PHASEN_ARTEN, artAusName, showTage, phasenHeute, phaseFehler, phasenFehler, aufbauPhase, phaseLabel } from '../js/phasen.js';
import { toMin } from '../js/schedule.js';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async-Test nicht erlaubt'); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const plan = (phases) => ({
  project: { id: 'p1', name: 'T', venue: '', start: '2026-09-01T00:00', end: '2026-09-30T00:00', timezone: 'Europe/Berlin' },
  gewerke: [{ id: 'b', name: 'Bühne', sort: 0 }],
  tasks: [{ id: 'a', gewerk: 'b', title: 'X', start: '2026-09-14T08:00', end: '2026-09-14T12:00' }],
  deps: [],
  ...(phases ? { phases } : {}),
});

console.log('\nPhasen: Arten und Namen');
test('fünf Arten in der Reihenfolge des Projekts', () => {
  assert.deepEqual(PHASEN_ARTEN.map((a) => a.id), ['planung', 'vorbereitung', 'aufbau', 'show', 'abbau']);
});
test('artAusName rät aus dem Namen, sonst null', () => {
  assert.equal(artAusName('Planung'), 'planung');
  assert.equal(artAusName('Vorbereitung vor Ort'), 'vorbereitung');
  assert.equal(artAusName('Aufbau'), 'aufbau');
  assert.equal(artAusName('Load-in'), 'aufbau');
  assert.equal(artAusName('Show'), 'show');
  assert.equal(artAusName('Abbau'), 'abbau');
  assert.equal(artAusName('Load-out'), 'abbau');
  assert.equal(artAusName('Irgendwas'), null);
});

console.log('\nPhasen: Migration');
test('migrate: Altdaten ohne art/id bekommen beides (Name → Art)', () => {
  const m = migrate(plan([
    { name: 'Planung', start: '2026-09-01T08:00', end: '2026-09-10T08:00' },
    { name: 'Aufbau', start: '2026-09-14T06:00', end: '2026-09-16T06:00' },
    { name: 'Show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' },
  ]));
  assert.deepEqual(m.phases.map((p) => p.art), ['planung', 'aufbau', 'show']);
  assert.equal(new Set(m.phases.map((p) => p.id)).size, 3);
  assert.ok(m.phases.every((p) => p.id));
});
test('migrate: unbekannter Name → aufbau', () => {
  const m = migrate(plan([{ name: 'Sonstiges', start: '2026-09-01T08:00', end: '2026-09-02T08:00' }]));
  assert.equal(m.phases[0].art, 'aufbau');
});
test('migrate: ohne Phasen → leeres Array; idempotent', () => {
  assert.deepEqual(migrate(plan()).phases, []);
  const a = migrate(plan([{ name: 'Show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' }]));
  assert.deepEqual(migrate(a).phases, a.phases);
});
test('migrate: eine vorhandene art bleibt (auch bei anderem Namen)', () => {
  const m = migrate(plan([{ id: 'x', art: 'abbau', name: 'Aufbau?', start: '2026-09-01T08:00', end: '2026-09-02T08:00' }]));
  assert.equal(m.phases[0].art, 'abbau');
  assert.equal(m.phases[0].id, 'x');
});

console.log('\nPhasen: Import');
test('deserialize behält Phasen samt art und id', () => {
  const p = migrate(plan([{ name: 'Show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' }]));
  const back = deserialize(serialize(p));
  assert.equal(back.ok, true);
  assert.deepEqual(back.plan.phases, p.phases);
});
test('deserialize lehnt eine Phase mit Ende vor Start ab und nennt sie', () => {
  const p = plan([{ id: 'p1', art: 'show', name: 'Hauptshow', start: '2026-09-18T12:00', end: '2026-09-16T12:00' }]);
  const r = deserialize(JSON.stringify(p));
  assert.equal(r.ok, false);
  assert.match(r.error, /Hauptshow/);
});
test('deserialize lehnt unbekannte Art, fehlende Zeit und Überlappung gleicher Art ab', () => {
  const eine = (ph) => deserialize(JSON.stringify(plan(ph)));
  assert.equal(eine([{ id: 'p1', art: 'party', start: '2026-09-01T08:00', end: '2026-09-02T08:00' }]).ok, false);
  assert.equal(eine([{ id: 'p1', art: 'show', start: null, end: null }]).ok, false);
  assert.equal(eine([
    { id: 'p1', art: 'show', name: 'A', start: '2026-09-01T08:00', end: '2026-09-03T08:00' },
    { id: 'p2', art: 'show', name: 'B', start: '2026-09-02T08:00', end: '2026-09-04T08:00' },
  ]).ok, false);
  assert.equal(eine([
    { id: 'p1', art: 'show', start: '2026-09-01T08:00', end: '2026-09-03T08:00' },
    { id: 'p2', art: 'aufbau', start: '2026-09-02T08:00', end: '2026-09-04T08:00' },
  ]).ok, true, 'verschiedene Arten dürfen sich überlappen');
});

console.log('\nPhasen: Store');
const store = (phases) => createStore(migrate(plan(phases)));
test('addPhase legt an, vergibt id, ist ein Undo-Schritt', () => {
  const s = store();
  const r = s.apply({ type: 'addPhase', phase: { art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' } });
  assert.equal(r.ok, true);
  assert.ok(r.id);
  assert.equal(s.state.phases.length, 1);
  assert.equal(s.state.phases[0].art, 'show');
  assert.equal(s.undo(), true);
  assert.equal(s.state.phases.length, 0);
  assert.equal(s.canUndo, false);
});
test('addPhase lehnt ab: Art, Zeit, Ende<=Start; nichts bleibt zurück', () => {
  const s = store();
  const gut = { art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' };
  for (const kaputt of [{ art: 'party' }, { start: null, end: null }, { start: '2026-09-18T12:00' }, { end: gut.start }, { start: 'x' }]) {
    const r = s.apply({ type: 'addPhase', phase: { ...gut, ...kaputt } });
    assert.equal(r.ok, false, JSON.stringify(kaputt));
  }
  assert.equal(s.state.phases.length, 0);
  assert.equal(s.canUndo, false);
  assert.equal(s.dirty, false);
});
test('Phasen derselben Art dürfen sich nicht überlappen — andere Arten schon', () => {
  const s = store([{ id: 'a', art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' }]);
  assert.equal(s.apply({ type: 'addPhase', phase: { art: 'show', start: '2026-09-17T12:00', end: '2026-09-19T12:00' } }).ok, false);
  assert.equal(s.apply({ type: 'addPhase', phase: { art: 'show', start: '2026-09-18T12:00', end: '2026-09-19T12:00' } }).ok, true, 'aneinander ist keine Überlappung');
  assert.equal(s.apply({ type: 'addPhase', phase: { art: 'aufbau', start: '2026-09-17T12:00', end: '2026-09-19T12:00' } }).ok, true);
});
test('setPhase ändert Felder, prüft die ganze Phase, lehnt Überlappung ab', () => {
  const s = store([
    { id: 'a', art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' },
    { id: 'b', art: 'show', start: '2026-09-20T12:00', end: '2026-09-21T12:00' },
  ]);
  assert.equal(s.apply({ type: 'setPhase', id: 'a', end: '2026-09-19T12:00' }).ok, true);
  assert.equal(s.state.phases.find((p) => p.id === 'a').end, '2026-09-19T12:00');
  const r = s.apply({ type: 'setPhase', id: 'a', end: '2026-09-20T18:00' });
  assert.equal(r.ok, false);
  assert.match(r.error, /überschneid/i);
  assert.equal(s.apply({ type: 'setPhase', id: 'a', end: '2026-09-10T12:00' }).ok, false, 'Ende vor Start');
  assert.equal(s.apply({ type: 'setPhase', id: 'a', art: 'party' }).ok, false);
  assert.equal(s.apply({ type: 'setPhase', id: 'a', art: 'abbau', name: ' Rückbau ' }).ok, true);
  const a = s.state.phases.find((p) => p.id === 'a');
  assert.equal(a.art, 'abbau'); assert.equal(a.name, 'Rückbau');
  assert.equal(s.apply({ type: 'setPhase', id: 'nix', name: 'x' }).ok, false);
});
test('setPhase: Start UND Ende in einem Befehl (Entwurf-Haken) = ein Undo-Schritt', () => {
  const s = store([{ id: 'a', art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' }]);
  assert.equal(s.apply({ type: 'setPhase', id: 'a', start: '2026-09-20T12:00', end: '2026-09-22T12:00' }).ok, true);
  s.undo();
  assert.equal(s.state.phases[0].start, '2026-09-16T12:00');
  assert.equal(s.canUndo, false);
});
test('removePhase löscht (Undo bringt sie zurück), unbekannte id wird abgelehnt', () => {
  const s = store([{ id: 'a', art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' }]);
  assert.equal(s.apply({ type: 'removePhase', id: 'x' }).ok, false);
  assert.equal(s.apply({ type: 'removePhase', id: 'a' }).ok, true);
  assert.equal(s.state.phases.length, 0);
  s.undo();
  assert.equal(s.state.phases.length, 1);
});
test('ein Store aus einem Plan ohne phases-Feld kennt addPhase', () => {
  const s = createStore(plan());
  assert.equal(s.apply({ type: 'addPhase', phase: { art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' } }).ok, true);
});
test('Phasen überleben Export → Import', () => {
  const s = store();
  s.apply({ type: 'addPhase', phase: { art: 'aufbau', name: 'Load-in', start: '2026-09-14T06:00', end: '2026-09-16T06:00' } });
  const back = deserialize(serialize(s.state));
  assert.equal(back.ok, true);
  assert.deepEqual(back.plan.phases, s.state.phases);
});

console.log('\nPhasen: Prüfung');
test('phaseFehler / phasenFehler nennen die Phase beim Namen', () => {
  const p = { id: 'a', art: 'show', name: 'Hauptshow', start: '2026-09-18T12:00', end: '2026-09-18T12:00' };
  assert.match(phaseFehler(p), /Hauptshow/);
  assert.equal(phasenFehler([{ id: 'a', art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' }]), null);
  assert.match(phasenFehler([p]), /Hauptshow/);
  assert.match(phasenFehler([{ id: 'a', art: 'show', start: '2026-09-16T12:00', end: '2026-09-18T12:00' }, { id: 'a', art: 'abbau', start: '2026-09-19T12:00', end: '2026-09-20T12:00' }]), /id/);
});

console.log('\nPhasen: Show-Tage');
const SHOW = (id, s, e) => ({ id, art: 'show', start: s, end: e });
test('showTage zählt jeden Kalendertag der Show-Phasen fortlaufend', () => {
  const t = showTage([SHOW('a', '2026-09-18T12:00', '2026-09-20T23:00')]);
  assert.deepEqual(t.map((x) => [x.tag, x.n]), [['2026-09-18', 1], ['2026-09-19', 2], ['2026-09-20', 3]]);
});
test('showTage: Ende exakt 00:00 zählt den Folgetag nicht; andere Arten zählen nicht', () => {
  const t = showTage([SHOW('a', '2026-09-18T12:00', '2026-09-20T00:00'), { id: 'b', art: 'aufbau', start: '2026-09-10T00:00', end: '2026-09-12T00:00' }]);
  assert.deepEqual(t.map((x) => x.tag), ['2026-09-18', '2026-09-19']);
});
test('showTage: mehrere Show-Phasen, nach Start sortiert, durchnummeriert; geteilter Tag nur einmal', () => {
  const t = showTage([
    SHOW('b', '2026-09-25T10:00', '2026-09-25T23:00'),
    SHOW('a', '2026-09-18T12:00', '2026-09-19T12:00'),
    SHOW('c', '2026-09-19T14:00', '2026-09-20T12:00'),
  ]);
  assert.deepEqual(t.map((x) => [x.tag, x.n, x.phase]), [['2026-09-18', 1, 'a'], ['2026-09-19', 2, 'a'], ['2026-09-20', 3, 'c'], ['2026-09-25', 4, 'b']]);
});
test('showTage über die Zeitumstellung (25.10.2026) liefert drei Tage, nicht vier', () => {
  const t = showTage([SHOW('a', '2026-10-24T20:00', '2026-10-26T06:00')]);
  assert.deepEqual(t.map((x) => x.tag), ['2026-10-24', '2026-10-25', '2026-10-26']);
});
test('showTage: leer, ohne Phasen, kaputte Phase bricht nichts', () => {
  assert.deepEqual(showTage([]), []);
  assert.deepEqual(showTage(undefined), []);
  assert.deepEqual(showTage([SHOW('a', null, null), SHOW('b', 'x', 'y')]), []);
});

console.log('\nPhasen: heute');
const PH = [
  { id: 'p', art: 'planung', start: '2026-09-01T08:00', end: '2026-09-14T06:00' },
  { id: 'a', art: 'aufbau', name: 'Load-in', start: '2026-09-14T06:00', end: '2026-09-18T12:00' },
  SHOW('s', '2026-09-18T12:00', '2026-09-21T12:00'),
];
test('phasenHeute: «Aufbau» mit Namen, «Show-Tag 2» nummeriert, sonst leer', () => {
  assert.deepEqual(phasenHeute(PH, toMin('2026-09-15T10:00')), ['Load-in']);
  assert.deepEqual(phasenHeute(PH, toMin('2026-09-19T10:00')), ['Show-Tag 2']);
  assert.deepEqual(phasenHeute(PH, toMin('2026-10-30T10:00')), []);
  assert.deepEqual(phasenHeute(PH, toMin('2026-09-14T06:00')), ['Load-in'], 'Start zählt, Ende nicht');
  assert.deepEqual(phasenHeute([], toMin('2026-09-19T10:00')), []);
});
test('phaseLabel: Name, sonst Art; Show-Phasen ohne Name «Show»', () => {
  assert.equal(phaseLabel({ art: 'show', name: '' }), 'Show');
  assert.equal(phaseLabel({ art: 'abbau', name: 'Rückbau' }), 'Rückbau');
});
test('aufbauPhase: die früheste Phase der Art aufbau', () => {
  assert.equal(aufbauPhase(PH).id, 'a');
  assert.equal(aufbauPhase([]), undefined);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
