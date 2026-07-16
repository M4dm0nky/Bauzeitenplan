import { plan } from '../tools/make-klassentreffen.mjs';
import { createStore } from '../js/store.js';
import { findConflicts } from '../js/conflicts.js';
import { computeSchedule, toMin } from '../js/schedule.js';
import { gewerkVar, gewerkTexture, slotsExhausted } from '../js/palette.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};
const byTitle = (t) => plan.tasks.find((x) => x.title === t);
const gwName = (t) => plan.gewerke.find((g) => g.id === byTitle(t).gewerk)?.name;

const WIN_S = toMin('2026-08-21T00:00');
const WIN_E = toMin('2026-09-03T23:59');

console.log('\nKlassentreffen — Struktur');
test('17 Gewerke, Festival-8 zuerst, dann die neun Baustellen-Gewerke', () => {
  assert.deepEqual(plan.gewerke.map((g) => g.name), [
    'Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Pyro', 'Catering', 'Sanitär',
    'Produktion', 'Strom', 'Zäune & Absperrung', 'Zelte', 'Security', 'Branding',
    'Artist Care', 'Show', 'Logistik',
  ]);
});
test('Video und Pyro bleiben leer (im PDF nicht genannt)', () => {
  const leer = ['Video', 'Pyro'].map((n) => plan.gewerke.find((g) => g.name === n).id);
  for (const g of leer) assert.ok(!plan.tasks.some((t) => t.gewerk === g), 'Gewerk hat Vorgänge');
});
test('genau ein Meilenstein: Baufrei am 23.08. auf Projekt-Ebene', () => {
  const ms = plan.tasks.filter((t) => t.milestone);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].gewerk, 'projekt');
  assert.match(ms[0].title, /Baufrei/);
  assert.ok(ms[0].start.startsWith('2026-08-23'));
});

console.log('\nKlassentreffen — quellentreu');
test('der Zeitraum stammt aus dem PDF (21.08.–03.09.2026)', () => {
  assert.equal(plan.project.start, '2026-08-21T00:00');
  assert.equal(plan.project.end, '2026-09-03T23:59');
});
test('jeder Vorgang liegt im PDF-Fenster', () => {
  for (const t of plan.tasks) {
    assert.ok(toMin(t.start) >= WIN_S, t.title + ' beginnt vor dem Fenster');
    assert.ok(toMin(t.end) <= WIN_E, t.title + ' endet nach dem Fenster');
  }
});
test('PDF-Tage sind unverändert übernommen', () => {
  assert.equal(byTitle('Übergabe Gelände (Betreiber → Veranstalter)').start, '2026-08-21T08:00');
  assert.equal(byTitle('Aufbau StageCo — Tag 1').start, '2026-08-24T08:00');
  assert.equal(byTitle('Aufbau StageCo — Tag 3').start, '2026-08-26T08:00');
  assert.equal(byTitle('Geländerückgabe').start, '2026-09-03T13:00');
});
test('alle Dauern sind als geschätzt markiert (das PDF nennt keine Uhrzeiten)', () => {
  for (const t of plan.tasks.filter((x) => !x.milestone)) {
    assert.equal(t.estimated, true, t.title + ' ist nicht als Schätzung markiert');
  }
});
test('der Meilenstein ist keine geschätzte Dauer', () => {
  assert.equal(plan.tasks.find((t) => t.milestone).estimated, false);
});

console.log('\nKlassentreffen — abgestimmte Zuordnungen');
test('StageCo Tag 1–3 und Stahl gehören zu Bühne', () => {
  for (const t of ['Aufbau StageCo — Tag 1', 'Aufbau StageCo — Tag 2', 'Aufbau StageCo — Tag 3',
                   'Anlieferung Stahl', 'Abbau Stahl']) assert.equal(gwName(t), 'Bühne', t);
});
test('Besucher-Gastronomie läuft unter Catering', () => {
  assert.equal(gwName('Aufbau Besucher-Gastronomie'), 'Catering');
  assert.equal(gwName('Abbau Besucher-Gastronomie'), 'Catering');
});
test('Artist-Bereiche sind das Gewerk Artist Care', () => {
  assert.equal(gwName('Einrichten Artist-Bereiche'), 'Artist Care');
});
test('Wasser-Infrastruktur läuft unter Sanitär', () => {
  assert.equal(gwName('Aufbau Wasser-Infrastruktur'), 'Sanitär');
  assert.equal(gwName('Abbau Wasser-Infrastruktur'), 'Sanitär');
});
test('Line-Up ist das eigene Gewerk Show, an beiden Showtagen', () => {
  const show = plan.tasks.filter((t) => gwName(t.title) === 'Show');
  assert.equal(show.length, 2);
  assert.ok(show.some((t) => t.start.startsWith('2026-08-29')));
  assert.ok(show.some((t) => t.start.startsWith('2026-08-30')));
});
test('Fuhrpark und Container sind das Gewerk Logistik', () => {
  for (const t of ['Anlieferung Fuhrpark', 'Anlieferung Container Produktion',
                   'Abholung Container Teil 1']) assert.equal(gwName(t), 'Logistik', t);
});
test('„Ausbau Technik" ist auf Rigging, Licht und Ton aufgeteilt', () => {
  assert.equal(gwName('Ausbau Technik — Rigging'), 'Rigging');
  assert.equal(gwName('Ausbau Technik — Licht'), 'Licht');
  assert.equal(gwName('Ausbau Technik — Ton'), 'Ton');
});

console.log('\nKlassentreffen — nichts erfunden');
test('keine Abhängigkeiten — das PDF nennt keine', () => {
  assert.equal(plan.deps.length, 0);
});

console.log('\nKlassentreffen — Palette trägt 17 Gewerke eindeutig');
test('17 Gewerke erschöpfen die Palette nicht (max 18)', () => {
  assert.equal(slotsExhausted(plan.gewerke.length), false);
});
test('jedes Gewerk hat eine eindeutige Farbton-Schraffur-Kombination', () => {
  const ids = plan.gewerke.map((g) => gewerkVar(g.slot) + '|' + gewerkTexture(g.slot));
  assert.equal(new Set(ids).size, plan.gewerke.length, 'zwei Gewerke sehen gleich aus');
});

console.log('\nKlassentreffen — in sich stimmig');
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
test('Projektzeitraum umschließt alle Vorgänge', () => {
  const s = Math.min(...plan.tasks.map((t) => toMin(t.start)));
  const e = Math.max(...plan.tasks.map((t) => toMin(t.end)));
  assert.ok(toMin(plan.project.start) <= s && toMin(plan.project.end) >= e);
});
test('der Store nimmt jedes Gewerk und jeden Vorgang an', () => {
  const st = createStore({ project: plan.project, gewerke: [], tasks: [], deps: [] });
  for (const g of plan.gewerke) assert.notEqual(st.apply({ type: 'addGewerk', gewerk: g }).ok, false, g.name);
  for (const t of plan.tasks.filter((x) => x.gewerk !== 'projekt')) {
    const res = st.apply({ type: 'addTask', task: t });
    assert.notEqual(res.ok, false, '«' + t.title + '»: ' + res.error);
  }
});
test('WIDERSPRUCHSFREI — der Plan startet nicht rot', () => {
  const c = findConflicts(plan);
  assert.deepEqual(c, [], c.map((x) => {
    const t = plan.tasks.find((y) => y.id === x.taskId);
    return '«' + (t && t.title) + '» ' + x.message;
  }).join(' | '));
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
