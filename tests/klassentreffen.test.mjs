import { plan, ROWS } from '../tools/make-klassentreffen.mjs';
import { createStore } from '../js/store.js';
import { findConflicts } from '../js/conflicts.js';
import { computeSchedule, toMin } from '../js/schedule.js';
import { gewerkVar, gewerkTexture, slotsExhausted } from '../js/palette.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };
const on = (title, day) => plan.tasks.find((x) => x.title === title && x.start.startsWith(day));
const allOn = (title, day) => plan.tasks.filter((x) => x.title === title && x.start.startsWith(day));
const gwOf = (task) => plan.gewerke.find((g) => g.id === task.gewerk)?.name;

const WIN_S = toMin('2026-08-21T00:00');
const WIN_E = toMin('2026-09-03T23:59');

console.log('\nKlassentreffen V07 — Struktur');
test('20 Gewerke, «Crew» als letztes', () => {
  assert.deepEqual(plan.gewerke.map((g) => g.name), [
    'Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Pyro', 'Catering', 'Sanitär',
    'Produktion', 'Strom', 'Zäune & Absperrung', 'Zelte', 'Security', 'Branding',
    'Artist Care', 'Show', 'Logistik', 'Besucher-Gastro', 'Sanitätsdienst', 'Crew',
  ]);
});
test('jedes Gewerk ist belegt', () => {
  for (const g of plan.gewerke) assert.ok(plan.tasks.some((t) => t.gewerk === g.id), g.name + ' ist leer');
});
test('kein Meilenstein — auch V07 hat keinen baufreien Tag', () => {
  assert.equal(plan.tasks.filter((t) => t.milestone).length, 0);
  assert.ok(plan.tasks.some((t) => t.start.startsWith('2026-08-23')), '23.08. ist in V07 ein Arbeitstag');
});
test('der Personal-Block steckt im Gewerk «Crew»', () => {
  const crew = plan.gewerke.find((g) => g.name === 'Crew');
  for (const titel of ['SITECREW', 'STAPLERFAHRER stageco', 'CLIMBER stageco', 'STEELHANDS stageco',
                       'HELFER complete audio', 'TELESTAPLERFAHRER tse', 'SHOW CREW SIDO', 'ABBAU SIDO',
                       'CATERING RUNNER morsh', 'KAMERA SIDO', 'HELFER HypeIT', 'STAPLERFAHRER HypeIT',
                       'CATERING ASSISTANT 1314Productions', 'Sitecrew vor Ort', 'Staplerfahrer vor Ort']) {
    const t = plan.tasks.find((x) => x.title === titel);
    assert.ok(t, titel + ' fehlt');
    assert.equal(t.gewerk, crew.id, titel);
  }
});

console.log('\nKlassentreffen V07 — quellentreu (echte Zeiten)');
test('der Zeitraum stammt aus V07 (21.08.–03.09.2026)', () => {
  assert.equal(plan.project.start, '2026-08-21T00:00');
  assert.equal(plan.project.end, '2026-09-03T23:59');
});
test('jeder Vorgang liegt im Fenster', () => {
  for (const t of plan.tasks) {
    assert.ok(toMin(t.start) >= WIN_S, t.title + ' beginnt vor dem Fenster');
    assert.ok(toMin(t.end) <= WIN_E, t.title + ' endet nach dem Fenster');
  }
});
test('Uhrzeiten sind unverändert aus V07 übernommen', () => {
  assert.equal(on('Übergabe Gelände', '2026-08-21').start, '2026-08-21T08:00');
  assert.equal(on('Übergabe Gelände', '2026-08-21').end, '2026-08-21T09:00');
  assert.equal(on('Aufbau Bühne Tag 1', '2026-08-24').start, '2026-08-24T08:00');
  assert.equal(on('Aufbau Bühne Tag 1', '2026-08-24').end, '2026-08-24T18:00');
  assert.equal(on('Behördliche Abnahme', '2026-08-28').start, '2026-08-28T16:00');
  assert.equal(on('Behördliche Abnahme', '2026-08-28').end, '2026-08-28T17:30');
  assert.equal(on('Geländerückgabe', '2026-09-03').start, '2026-09-03T08:00');
  assert.equal(on('Geländerückgabe', '2026-09-03').end, '2026-09-03T12:00');
});
test('über zwei Zeilen gedruckte Zeiten sind richtig zusammengesetzt', () => {
  // In V07 steht Beginn und Ende dieser Zeilen auf zwei getrennten Druckzeilen.
  assert.equal(on('Verstromung Bühne / Backstage', '2026-08-24').start, '2026-08-24T10:00');
  assert.equal(on('Verstromung Bühne / Backstage', '2026-08-24').end, '2026-08-24T18:00');
  for (const d of ['2026-08-29', '2026-08-30']) {
    assert.equal(on('Promotion / Non-Food-Aktivitäten', d).start, d + 'T12:00');
    assert.equal(on('Promotion / Non-Food-Aktivitäten', d).end, d + 'T23:00');
  }
});
test('ZWEI Showtage — der Betriebs-Block steht am 29. UND am 30.08.', () => {
  for (const d of ['2026-08-29', '2026-08-30']) {
    assert.equal(on('Fahrverbot auf dem Gelände', d).start, d + 'T11:30');
    assert.equal(on('Fahrverbot auf dem Gelände', d).end, d + 'T23:00', d);
    assert.ok(on('Öffnung VA-Gelände', d), 'Öffnung VA-Gelände fehlt am ' + d);
    assert.ok(on('Bespielung der Hauptbühne / Beschallung', d), 'Bespielung fehlt am ' + d);
  }
});
test('Über-Nacht-Zeiten rollen in den Folgetag', () => {
  assert.equal(on('Einleuchten / Programmierung', '2026-08-27').end, '2026-08-28T00:00');
  assert.equal(on('Ausbau SFX', '2026-08-30').end, '2026-08-31T00:00');
  assert.equal(on('HELFER tse', '2026-08-30').end, '2026-08-31T04:00');
  assert.equal(on('Sanitäter vor Ort', '2026-08-29').end, '2026-08-30T03:00');
});
test('Vorgänge mit V07-Zeit sind NICHT als geschätzt markiert', () => {
  for (const [t, d] of [['Aufbau Bühne Tag 1', '2026-08-24'], ['Fahrverbot auf dem Gelände', '2026-08-29'],
                        ['Einbau / Restarbeiten Licht', '2026-08-28'], ['Abbau Bühne Tag 2', '2026-09-01'],
                        ['Test Sicherheitsbeleuchtung', '2026-08-28']]) {
    assert.equal(on(t, d).estimated, false, t);
  }
});
test('nur die Zeilen ohne V07-Uhrzeit sind geschätzt', () => {
  assert.equal(on('Kran vor Ort', '2026-08-21').estimated, true);
  assert.equal(on('Aufbau Einlasschleusen', '2026-08-28').estimated, true);
  assert.equal(on('Gelenk-Teleskop-Bühne vor Ort', '2026-08-27').estimated, true);
  assert.equal(on('Kran vor Ort', '2026-08-25').estimated, false, '25.08. hat eine gedruckte Zeit');
  assert.equal(plan.tasks.filter((t) => t.estimated).length, 19);
  for (const t of plan.tasks.filter((x) => x.estimated)) {
    assert.match(t.notes, /nicht angegeben|«open»/, t.title + ' sagt nicht, warum geschätzt');
  }
});
test('der Sanitätsdienst hat in V07 an fast allen Tagen echte Zeiten', () => {
  // In V06 war «Sanitäter vor Ort» durchgehend geschätzt; V07 nennt Pandemedics
  // und Uhrzeiten ab dem 24.08.
  assert.equal(on('Sanitäter vor Ort', '2026-08-24').estimated, false);
  assert.match(on('Sanitäter vor Ort', '2026-08-24').notes, /Pandemedics/);
  assert.equal(on('Sanitäter vor Ort', '2026-08-27').end, '2026-08-27T20:00');
  assert.equal(on('Sanitäter vor Ort', '2026-08-30').notes.includes('Abbaubegleitung'), true);
});
test('Dienstleister, Anmerkung und Kopfzahl stehen in der Notiz', () => {
  assert.match(on('Aufbau Bühne Tag 1', '2026-08-24').notes, /StageCo/);
  assert.match(on('Übergabe Gelände', '2026-08-21').notes, /Carsten Langenfeld/);
  assert.match(on('Fahrverbot auf dem Gelände', '2026-08-29').notes, /ALLE/);
  assert.match(on('CLIMBER stageco', '2026-08-25').notes, /36StageXL · 10 Climber/);
  assert.match(on('Kran vor Ort', '2026-08-26').notes, /60 to Kran/);
});
test('Container-Zeilen tragen die volle Stückliste in der Notiz', () => {
  // V07 druckt die Liste in die Spalte «Aktion»; als Balkenbeschriftung wäre das
  // unbrauchbar, also kurzer Titel + vollständige Liste in der Notiz.
  assert.match(on('Anlieferung Container', '2026-08-21').notes, /1x Trio Anlage \(Team Spindler\)/);
  assert.match(on('Anlieferung Container', '2026-08-21').notes, /2x WC Container \(Produktion, Stage\)/);
  assert.match(on('Anlieferung Container', '2026-08-25').notes, /12x Raketen/);
  assert.match(on('Abholung Container', '2026-08-31').notes, /alle Kabinen/);
  assert.match(on('Anlieferung Kabinen', '2026-08-26').notes, /86x Toilettenkabine/);
  for (const t of plan.tasks.filter((x) => /^(Anlieferung|Abholung) (Container|Kabinen)$/.test(x.title))) {
    assert.match(t.notes, /^Wölkchen · /, t.title + ' @ ' + t.start);
  }
});
test('abgestimmte Zuordnungen', () => {
  assert.equal(gwOf(on('Einbau SFX', '2026-08-28')), 'Pyro');
  assert.equal(gwOf(on('Aufbau Besuchergastro', '2026-08-26')), 'Besucher-Gastro');
  assert.equal(gwOf(on('Sanitätsdienst VA-Begleitung', '2026-08-29')), 'Sanitätsdienst');
  assert.equal(gwOf(on('Aufbau Sanitätsstationen', '2026-08-28')), 'Sanitätsdienst');
  assert.equal(gwOf(on('Ablesen Strom Zählerstände', '2026-08-21')), 'Strom');
  assert.equal(gwOf(on('Ablesen Wasser Zählerstände', '2026-08-21')), 'Sanitär');
  assert.equal(gwOf(on('Anlieferung Container', '2026-08-21')), 'Logistik');
  assert.equal(gwOf(on('Soundcheck Zeiten gemäß Genehmigung', '2026-08-28')), 'Ton');
  assert.equal(gwOf(on('Abnahme Fliegende Bauten', '2026-08-27')), 'Produktion');
  assert.equal(gwOf(on('Brandsicherheitswachdienst VA-Begleitung', '2026-08-29')), 'Security');
  assert.equal(gwOf(on('Aufbau CCTV', '2026-08-27')), 'Security');
});

console.log('\nKlassentreffen V07 — was sich gegenüber V06 geändert hat');
test('die in V06 durchgestrichene SHOWCREW-Zeile steht in V07 regulär drin', () => {
  const t = on('SHOWCREW SIDO complete audio', '2026-08-28');
  assert.ok(t, 'SHOWCREW SIDO complete audio fehlt am 28.08.');
  assert.equal(t.start, '2026-08-28T16:00');
  assert.equal(t.end, '2026-08-28T23:00');
  assert.match(t.notes, /1 CC \+ 12 Helfer/);
});
test('CCTV ist neu — Aufbau am 27.08., Abbau am 31.08.', () => {
  assert.equal(on('Aufbau CCTV', '2026-08-27').notes, 'Movetos');
  assert.equal(on('Abbau CCTV', '2026-08-31').notes, 'Movetos');
});
test('CATERING ASSISTANT steht an beiden Showtagen', () => {
  for (const d of ['2026-08-29', '2026-08-30']) {
    const t = on('CATERING ASSISTANT 1314Productions', d);
    assert.ok(t, 'fehlt am ' + d);
    assert.equal(t.start, d + 'T10:00');
    assert.equal(t.end, d + 'T16:00');
  }
});
test('die Wasserversorgung ist auf den 21.08. vorgezogen', () => {
  assert.ok(on('Aufbau Wasserversorgung Crew Catering', '2026-08-21'));
  assert.ok(on('Aufbau Wasserversorgung WC Container Artist', '2026-08-21'));
  assert.equal(allOn('Aufbau Wasserversorgung Crew Catering', '2026-08-22').length, 0);
});
test('«Einrichten Crew Catering Zelt» ist auf den 24.08. gerutscht', () => {
  assert.ok(on('Einrichten Crew Catering Zelt', '2026-08-24'));
  assert.equal(allOn('Einrichten Crew Catering Zelt', '2026-08-23').length, 0);
});
test('am 22.08. kommt eine Container-Anlieferung dazu', () => {
  const t = on('Anlieferung Container', '2026-08-22');
  assert.ok(t, 'fehlt');
  assert.match(t.notes, /1x Duo Anlage \(Security\)/);
});

console.log('\nKlassentreffen V07 — nur echte Fortsetzungen verschmolzen');
test('was sich berührt, wird EIN Balken', () => {
  // 30.08. 23:00–00:00 + 31.08. 00:00–03:00
  const licht = on('Ausbau Licht', '2026-08-30');
  assert.equal(licht.end, '2026-08-31T03:00');
  assert.equal(allOn('Ausbau Licht', '2026-08-31').length, 0, '31.08. darf keinen eigenen Balken mehr haben');
  const rig = on('Ausbau Rigging', '2026-08-30');
  assert.equal(rig.end, '2026-08-31T03:00');
  // Objektbewachung 29.08. 23:00–00:00 + 30.08. 00:00–08:00
  const wache = plan.tasks.find((t) => t.title === 'Sicherheitsdienst / Objektbewachung' && t.start === '2026-08-29T23:00');
  assert.equal(wache.end, '2026-08-30T08:00');
});
test('die Nachtschichten der Objektbewachung sind alle verschmolzen', () => {
  for (const [start, end] of [['2026-08-29T23:00', '2026-08-30T08:00'], ['2026-08-30T23:00', '2026-08-31T08:00'],
                              ['2026-08-31T18:00', '2026-09-01T08:00'], ['2026-09-01T18:00', '2026-09-02T08:00']]) {
    const t = plan.tasks.find((x) => x.title === 'Sicherheitsdienst / Objektbewachung' && x.start === start);
    assert.ok(t, 'keine Schicht ab ' + start);
    assert.equal(t.end, end, start);
  }
});
test('eine Wiederholung am Folgetag ist KEINE Fortsetzung', () => {
  // sonst sähe die Nacht dazwischen nach Durcharbeiten aus
  assert.equal(allOn('Einleuchten / Programmierung', '2026-08-27').length, 1);
  assert.equal(allOn('Einleuchten / Programmierung', '2026-08-28').length, 1);
  assert.equal(allOn('Fahrverbot auf dem Gelände', '2026-08-29')[0].end, '2026-08-29T23:00');
  assert.equal(allOn('Produktion vor Ort', '2026-08-25')[0].end, '2026-08-25T18:00');
});
test('wechselnde Kopfzahlen bleiben getrennte Zeilen', () => {
  const sc = plan.tasks.filter((t) => t.title === 'SITECREW');
  for (const n of ['Michael + 2 Helfer', 'Michael + 4 Helfer', 'Michael + 6 Helfer']) {
    assert.ok(sc.some((t) => t.notes.includes(n)), n + ' fehlt');
  }
  // 27.08. hat ZWEI STAPLERFAHRER-stageco-Zeilen mit verschiedener Besetzung
  const sf = allOn('STAPLERFAHRER stageco', '2026-08-27');
  assert.equal(sf.length, 2);
  assert.deepEqual(sf.map((t) => t.end).sort(), ['2026-08-27T12:00', '2026-08-27T15:00']);
});
// Gleicher Titel zur gleichen Zeit gibt es in V07 wirklich — etwa zwei
// SITECREW-Zeilen am 29.08. ab 08:00 mit verschiedener Besetzung. Die Notiz
// unterscheidet sie; identisch bis in die Notiz wäre dagegen eine Dopplung.
test('kein (Gewerk, Titel, Start, Notiz) kommt zweimal vor', () => {
  const seen = new Set(); const dups = [];
  for (const t of plan.tasks) {
    const k = [t.gewerk, t.title, t.start, t.notes].join('|');
    if (seen.has(k)) dups.push(t.title + ' @ ' + t.start);
    seen.add(k);
  }
  assert.deepEqual(dups, [], 'doppelt: ' + dups.join(', '));
});

console.log('\nKlassentreffen V07 — nichts erfunden, nichts vergessen');
test('keine Abhängigkeiten — V07 ist ein terminierter Kalender', () => assert.equal(plan.deps.length, 0));
test('353 Vorgänge aus 361 V07-Zeilen (8 echte Fortsetzungen verschmolzen)', () => {
  assert.equal(ROWS.length, 361);
  assert.equal(plan.tasks.length, 353);
});
test('alle 14 Tage sind belegt', () => {
  const tage = new Set(plan.tasks.map((t) => t.start.slice(0, 10)));
  for (const d of ['2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26',
                   '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01',
                   '2026-09-02', '2026-09-03']) {
    assert.ok(tage.has(d), d + ' hat keinen Vorgang');
  }
});

console.log('\nKlassentreffen V07 — Palette am Limit');
test('20 Gewerke passen gerade noch (MAX_SLOTS = 20)', () => {
  assert.equal(slotsExhausted(plan.gewerke.length), false);
  assert.equal(slotsExhausted(plan.gewerke.length + 1), true, 'ein 21. Gewerk verlangt eine neue Farbsuche');
});
test('jedes Gewerk hat eine eindeutige Farbton-Schraffur-Kombination', () => {
  const ids = plan.gewerke.map((g) => gewerkVar(g.slot) + '|' + gewerkTexture(g.slot));
  assert.equal(new Set(ids).size, plan.gewerke.length, 'zwei Gewerke sehen gleich aus');
});
test('zehn Gewerke tragen Schraffur (Plätze 10–19)', () => {
  assert.equal(plan.gewerke.filter((g) => gewerkTexture(g.slot)).length, 10);
});

console.log('\nKlassentreffen V07 — in sich stimmig');
test('jeder Vorgang zeigt auf ein vorhandenes Gewerk', () => {
  const ids = new Set(plan.gewerke.map((g) => g.id));
  for (const t of plan.tasks) assert.ok(ids.has(t.gewerk), t.title);
});
test('Ende nie vor Start', () => {
  for (const t of plan.tasks) {
    const d = toMin(t.end) - toMin(t.start);
    assert.ok(d > 0, t.title + ' @ ' + t.start + ': ' + d);
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
  for (const t of plan.tasks) {
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
