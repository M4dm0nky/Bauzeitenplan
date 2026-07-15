import { plan } from '../tools/make-amk.mjs';
import { createStore } from '../js/store.js';
import { findConflicts } from '../js/conflicts.js';
import { computeSchedule, toMin } from '../js/schedule.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};
const byTitle = (t) => plan.tasks.find((x) => x.title === t);

console.log('\nAMK — Struktur');
test('acht Gewerke, exakt die validierte Palette ohne Schraffur', () => {
  assert.equal(plan.gewerke.length, 8);
  assert.deepEqual(plan.gewerke.map((g) => g.name),
    ['Rigging', 'Licht', 'LED', 'Set', 'Backline', 'FoH', 'C1', 'Local Crew']);
  assert.ok(plan.gewerke.every((g) => g.slot < 8), 'kein Gewerk braucht Schraffur');
});
test('19 Aufbau-Zeilen aus dem PDF', () => {
  const auf = plan.tasks.filter((t) => t.start.startsWith('2026-07-17') && toMin(t.start) < toMin('2026-07-17T13:00'));
  assert.equal(auf.length, 19);
});
test('Abbau: 16 PDF-Zeilen + 1 aus der Aufteilung = 17', () => {
  const ab = plan.tasks.filter((t) => toMin(t.start) >= toMin('2026-07-17T22:30') && t.gewerk !== 'projekt');
  assert.equal(ab.length, 17);
});
test('drei Meilensteine', () => {
  assert.deepEqual(plan.tasks.filter((t) => t.milestone).map((t) => t.title).sort(),
    ['Leitern fertig', 'Showende', 'Vorhang oben']);
});

console.log('\nAMK — quellentreu');
test('Zeiten aus dem PDF sind unverändert übernommen', () => {
  assert.equal(byTitle('Aufbau LED Backwall').start, '2026-07-17T09:00');
  assert.equal(byTitle('Aufbau LED Backwall').end, '2026-07-17T12:00');
  assert.equal(byTitle('Lx1 oben').start, '2026-07-17T09:50');
  assert.equal(byTitle('Lx1 oben').end, '2026-07-17T10:05');
  assert.equal(byTitle('Floorset bauen').start, '2026-07-17T12:15');
  assert.equal(byTitle('Einhängen Vorhang hinten').end, '2026-07-17T12:10');
});
test('Vorgänge mit PDF-Zeiten sind NICHT als geschätzt markiert', () => {
  for (const t of ['Aufbau LED Backwall', 'Lx1 oben', 'Lx3 oben', 'Bau Truss Vorhang hinten',
                   'Einhängen Vorhang hinten', 'Floorset bauen', 'Aufbau Riser', 'kl. Kreise']) {
    assert.equal(byTitle(t).estimated, false, t + ' ist fälschlich als Schätzung markiert');
  }
});
test('alles Geschätzte IST markiert', () => {
  for (const t of ['Motoren LoadIn & Setup', 'DimmerCity setup', 'KabelTruss oben', 'LED Load In',
                   'SetUp', 'Vorhangschine hängt', 'C1 Motoren hängen', 'verlegen schwarzer Teppich']) {
    assert.equal(byTitle(t).estimated, true, t + ' ist nicht als Schätzung markiert');
  }
  // Der ganze Abbau hat im PDF keine Zeiten
  assert.equal(byTitle('Barriers weg').estimated, true);
  assert.equal(byTitle('Lx1 runter fahren und abbauen').estimated, true);
});
test('Bemerkung, Bereich, Ansprechpartner und Firma sind erhalten', () => {
  assert.match(byTitle('Motoren LoadIn & Setup').notes, /am Dock.*Bühne.*Jens.*BigRig/s);
  assert.match(byTitle('Laden an FoH').notes, /1 Stapler FoH/);
  assert.match(byTitle('verlegen schwarzer Teppich').notes, /Jenny/);
  assert.match(byTitle('LED Load In').notes, /Jan-Hendrik/);
});
test('Zeilen mit leerem Gewerk sind als solche vermerkt', () => {
  for (const t of ['KabelTruss oben', 'Vorhang oben', 'Aufbau Riser', 'Floorset bauen', 'Barriers weg']) {
    assert.match(byTitle(t).notes, /Gewerk im Original leer/, t);
  }
});
test('Schätz-Anker aus dem PDF sind genutzt, nicht geraten', () => {
  // «LED Load In» endet, wenn «Aufbau LED Backwall» beginnt.
  assert.equal(byTitle('LED Load In').end, byTitle('Aufbau LED Backwall').start);
  // «Vorhangschine hängt» endet, wenn «Vorhang oben» steht.
  assert.equal(byTitle('Vorhangschine hängt').end, byTitle('Vorhang oben').start);
  // «SetUp» endet, wenn «verlegen schwarzer Teppich» endet.
  assert.equal(byTitle('SetUp').end, byTitle('verlegen schwarzer Teppich').end);
});

console.log('\nAMK — nichts erfunden');
test('nur DREI Verknüpfungen — die aus dem PDF plus die Vorhang-Aufteilung', () => {
  assert.equal(plan.deps.length, 3);
});
test('«Leitern runter» hängt an Backline UND Set — so steht es im PDF', () => {
  const leitern = byTitle('Leitern runter');
  const vor = plan.deps.filter((d) => d.to === leitern.id).map((d) => byTitle(plan.tasks.find((t) => t.id === d.from).title).title);
  assert.deepEqual(vor.sort(), ['Laden an Dock', 'Set weg → Abbau']);
});
test('die «Rigging/Set»-Zeile wurde aufgeteilt und wieder verknüpft', () => {
  const r = byTitle('Vorhang hinten runter fahren');
  const s = byTitle('Vorhang hinten abbauen');
  assert.equal(plan.gewerke.find((g) => g.id === r.gewerk).name, 'Rigging');
  assert.equal(plan.gewerke.find((g) => g.id === s.gewerk).name, 'Set');
  assert.ok(plan.deps.some((d) => d.from === r.id && d.to === s.id), 'nicht verknüpft');
});
test('«C1 Motoren hängen» macht Rigging, «kl. Kreise» ist C1', () => {
  const gw = (t) => plan.gewerke.find((g) => g.id === byTitle(t).gewerk).name;
  assert.equal(gw('C1 Motoren hängen'), 'Rigging');
  assert.equal(gw('kl. Kreise'), 'C1');
});

console.log('\nAMK — in sich stimmig');
test('jeder Vorgang zeigt auf ein vorhandenes Gewerk', () => {
  const ids = new Set(plan.gewerke.map((g) => g.id));
  for (const t of plan.tasks) assert.ok(t.gewerk === 'projekt' || ids.has(t.gewerk), t.title);
});
test('Ende nie vor Start', () => {
  for (const t of plan.tasks) {
    const d = toMin(t.end) - toMin(t.start);
    if (t.milestone) assert.equal(d, 0, t.title);
    else assert.ok(d > 0, t.title + ': ' + d);
  }
});
test('keine Ringe', () => { assert.doesNotThrow(() => computeSchedule(plan.tasks, plan.deps)); });
test('Projektzeitraum umschließt alles', () => {
  const s = Math.min(...plan.tasks.map((t) => toMin(t.start)));
  const e = Math.max(...plan.tasks.map((t) => toMin(t.end)));
  assert.ok(toMin(plan.project.start) <= s && toMin(plan.project.end) >= e);
});
test('der Store nimmt jeden Vorgang an', () => {
  const st = createStore({ project: plan.project, gewerke: [], tasks: [], deps: [] });
  for (const g of plan.gewerke) assert.notEqual(st.apply({ type: 'addGewerk', gewerk: g }).ok, false, g.name);
  for (const t of plan.tasks.filter((x) => x.gewerk !== 'projekt')) {
    const r = st.apply({ type: 'addTask', task: t });
    assert.notEqual(r.ok, false, '«' + t.title + '»: ' + r.error);
  }
});
test('WIDERSPRUCHSFREI — der Plan startet nicht rot', () => {
  // Wäre er es, stimmte meine Schätzung nicht mit der PDF-Verknüpfung überein.
  const c = findConflicts(plan);
  assert.deepEqual(c, [], c.map((x) => {
    const t = plan.tasks.find((y) => y.id === x.taskId);
    return '«' + (t && t.title) + '» ' + x.message;
  }).join(' | '));
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
