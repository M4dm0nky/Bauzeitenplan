import { plan } from '../tools/make-klassentreffen.mjs';
import { createStore } from '../js/store.js';
import { findConflicts } from '../js/conflicts.js';
import { computeSchedule, toMin } from '../js/schedule.js';
import { gewerkVar, gewerkTexture, slotsExhausted } from '../js/palette.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };
const on = (title, day) => plan.tasks.find((x) => x.title === title && x.start.startsWith(day));
const gwOf = (task) => plan.gewerke.find((g) => g.id === task.gewerk)?.name;

const WIN_S = toMin('2026-08-21T00:00');
const WIN_E = toMin('2026-09-03T23:59');

console.log('\nKlassentreffen V03 — Struktur');
test('19 Gewerke in der abgestimmten Reihenfolge', () => {
  assert.deepEqual(plan.gewerke.map((g) => g.name), [
    'Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Pyro', 'Catering', 'Sanitär',
    'Produktion', 'Strom', 'Zäune & Absperrung', 'Zelte', 'Security', 'Branding',
    'Artist Care', 'Show', 'Logistik', 'Besucher-Gastro', 'Sanitätsdienst',
  ]);
});
test('jedes Gewerk ist belegt (V03 füllt auch Video und Pyro)', () => {
  for (const g of plan.gewerke) assert.ok(plan.tasks.some((t) => t.gewerk === g.id), g.name + ' ist leer');
});
test('Besucher-Gastro und Sanitätsdienst sind eigene, belegte Gewerke', () => {
  for (const n of ['Besucher-Gastro', 'Sanitätsdienst']) {
    const g = plan.gewerke.find((x) => x.name === n);
    assert.ok(g && plan.tasks.some((t) => t.gewerk === g.id), n);
  }
});
test('genau ein Meilenstein: Baufrei am 23.08. auf Projekt-Ebene', () => {
  const ms = plan.tasks.filter((t) => t.milestone);
  assert.equal(ms.length, 1);
  assert.equal(ms[0].gewerk, 'projekt');
  assert.match(ms[0].title, /Baufrei/);
  assert.ok(ms[0].start.startsWith('2026-08-23'));
});

console.log('\nKlassentreffen V03 — quellentreu (echte Zeiten)');
test('der Zeitraum stammt aus V03 (21.08.–03.09.2026)', () => {
  assert.equal(plan.project.start, '2026-08-21T00:00');
  assert.equal(plan.project.end, '2026-09-03T23:59');
});
test('jeder Vorgang liegt im Fenster', () => {
  for (const t of plan.tasks) {
    assert.ok(toMin(t.start) >= WIN_S, t.title + ' beginnt vor dem Fenster');
    assert.ok(toMin(t.end) <= WIN_E, t.title + ' endet nach dem Fenster');
  }
});
test('Uhrzeiten sind unverändert aus V03 übernommen', () => {
  assert.equal(on('Übergabe Gelände', '2026-08-21').start, '2026-08-21T08:00');
  assert.equal(on('Übergabe Gelände', '2026-08-21').end, '2026-08-21T09:00');
  assert.equal(on('Aufbau Bühne Tag 1', '2026-08-24').start, '2026-08-24T08:00');
  assert.equal(on('Aufbau Bühne Tag 1', '2026-08-24').end, '2026-08-24T18:00');
  assert.equal(on('Fahrverbot auf dem Gelände', '2026-08-29').start, '2026-08-29T11:30');
  assert.equal(on('Geländerückgabe', '2026-09-03').end, '2026-09-03T14:00');
});
test('Über-Nacht-Zeiten rollen in den Folgetag', () => {
  assert.equal(on('Ausbau SFX', '2026-08-30').end, '2026-08-31T00:00');        // Einzelvorgang 22–00
  assert.equal(on('Ausbau Rigging', '2026-08-30').end, '2026-08-31T03:00');    // 23–00 + 00–03 verschmolzen
});
test('Vorgänge mit V03-Zeit sind NICHT als geschätzt markiert', () => {
  for (const [t, d] of [['Aufbau Bühne Tag 1', '2026-08-24'], ['Fahrverbot auf dem Gelände', '2026-08-29'],
                        ['Einbau / Restarbeiten Licht', '2026-08-28'], ['Abbau Bühne Tag 3', '2026-09-02']]) {
    assert.equal(on(t, d).estimated, false, t);
  }
});
test('nur die Zeilen ohne V03-Uhrzeit sind geschätzt', () => {
  assert.equal(on('Einbau Rigging', '2026-08-27').estimated, true);
  assert.equal(on('Behördliche Abnahme', '2026-08-28').estimated, true);
  assert.equal(plan.tasks.filter((t) => t.estimated).length, 9);
});
test('Dienstleister/Anmerkung stehen in der Notiz', () => {
  assert.match(on('Aufbau Bühne Tag 1', '2026-08-24').notes, /StageCo/);
  assert.match(plan.tasks.find((t) => t.title === 'Staplerfahrer vor Ort').notes, /mehrtägig/);
  assert.match(on('Übergabe Gelände', '2026-08-21').notes, /Carsten Langenfeld/);
  assert.match(on('Fahrverbot auf dem Gelände', '2026-08-29').notes, /ALLE/);
});
test('abgestimmte Zuordnungen', () => {
  assert.equal(gwOf(on('Einbau SFX', '2026-08-28')), 'Pyro');
  assert.equal(gwOf(on('Aufbau Besuchergastro', '2026-08-26')), 'Besucher-Gastro');
  assert.equal(gwOf(on('Sanitätsdienst VA-Begleitung', '2026-08-29')), 'Sanitätsdienst');
  assert.equal(gwOf(on('Ablesen Strom Zählerstände', '2026-08-21')), 'Strom');
  assert.equal(gwOf(on('Ablesen Wasser Zählerstände', '2026-08-21')), 'Sanitär');
  assert.equal(gwOf(on('Anlieferung WC-Container Artist', '2026-08-21')), 'Logistik');
});

console.log('\nKlassentreffen V03 — keine gleichnamigen Dopplungen');
test('kein (Gewerk, Titel) kommt mehr als einmal vor', () => {
  const seen = new Set(); const dups = [];
  for (const t of plan.tasks) { const k = t.gewerk + '|' + t.title; if (seen.has(k)) dups.push(t.title); seen.add(k); }
  assert.deepEqual(dups, [], 'doppelt: ' + dups.join(', '));
});
test('Objektbewachung ist EIN durchgehender Balken (22.08.–02.09.)', () => {
  const s = plan.tasks.filter((t) => t.title === 'Sicherheitsdienst / Objektbewachung');
  assert.equal(s.length, 1);
  assert.equal(s[0].start, '2026-08-22T14:00');
  assert.equal(s[0].end, '2026-09-02T08:00');
  assert.equal(gwOf(s[0]), 'Security');
});
test('mehrtägige Tätigkeiten sind je eine Zeile', () => {
  const prod = plan.tasks.find((t) => t.title === 'Produktion vor Ort');
  assert.equal(prod.start, '2026-08-21T08:00');
  assert.equal(prod.end, '2026-09-03T18:00');
  const bg = plan.tasks.filter((t) => t.title === 'Aufbau Besuchergastro');
  assert.equal(bg.length, 1);
  assert.equal(bg[0].start, '2026-08-26T08:00');
});
test('verschiedene Titel bleiben getrennt (Bühne Tag 1/2/3)', () => {
  assert.equal(plan.tasks.filter((t) => /^Aufbau Bühne Tag/.test(t.title)).length, 3);
});
test('Show-Tag-Begleitdienste bleiben eigene Vorgänge', () => {
  assert.ok(plan.tasks.some((t) => t.title === 'Sicherheitsdienst VA-Begleitung'));
  assert.ok(plan.tasks.some((t) => t.title === 'Sanitätsdienst VA-Begleitung'));
});

console.log('\nKlassentreffen V03 — nichts erfunden');
test('keine Abhängigkeiten — V03 ist ein terminierter Kalender', () => assert.equal(plan.deps.length, 0));

console.log('\nKlassentreffen V03 — Palette trägt 19 Gewerke');
test('19 Gewerke erschöpfen die Palette nicht (max 20)', () => assert.equal(slotsExhausted(plan.gewerke.length), false));
test('jedes Gewerk hat eine eindeutige Farbton-Schraffur-Kombination', () => {
  const ids = plan.gewerke.map((g) => gewerkVar(g.slot) + '|' + gewerkTexture(g.slot));
  assert.equal(new Set(ids).size, plan.gewerke.length, 'zwei Gewerke sehen gleich aus');
});

console.log('\nKlassentreffen V03 — in sich stimmig');
test('jeder Vorgang zeigt auf ein vorhandenes Gewerk', () => {
  const ids = new Set(plan.gewerke.map((g) => g.id));
  for (const t of plan.tasks) assert.ok(t.gewerk === 'projekt' || ids.has(t.gewerk), t.title);
});
test('Ende nie vor Start', () => {
  for (const t of plan.tasks) {
    const d = toMin(t.end) - toMin(t.start);
    if (t.milestone) assert.equal(d, 0, t.title);
    else assert.ok(d > 0, t.title + ' @ ' + t.start + ': ' + d);
  }
});
test('keine Ringe', () => assert.doesNotThrow(() => computeSchedule(plan.tasks, plan.deps)));
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
