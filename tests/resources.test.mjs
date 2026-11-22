import { ressourcen, resLabel, resKind, deckung, bedarfsRaster, rasterGrenzen, scheibeIndex } from '../js/resources.js';
import { toMin } from '../js/schedule.js';
import { createStore } from '../js/store.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async-Test im synchronen Helfer — nicht erlaubt'); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const state = () => ({
  project: {
    ressourcen: [
      { id: 'stagehand', label: 'Stagehand', kind: 'personal', sort: 0 },
      { id: 'rigger', label: 'Rigger', kind: 'personal', sort: 1 },
      { id: 'stapler', label: 'Gabelstapler', kind: 'maschine', sort: 0 },
    ],
  },
});

console.log('\nRessourcen: Bezeichnungen');
test('ressourcen(state, kind) filtert nach Art', () => {
  const s = state();
  assert.deepEqual(ressourcen(s, 'maschine').map((r) => r.id), ['stapler']);
  assert.equal(ressourcen(s, 'personal').length, 2);
});
test('resLabel gibt den Namen, Unbekanntes bleibt die Kennung', () => {
  const s = state();
  assert.equal(resLabel('stagehand', s), 'Stagehand');
  assert.equal(resLabel('nix', s), 'nix');
});
test('resKind: Unbekanntes zählt als Personal', () => {
  const s = state();
  assert.equal(resKind('stapler', s), 'maschine');
  assert.equal(resKind('nix', s), 'personal');
});

console.log('\nDeckung eines Vorgangs');
const task = (res, over = {}) => ({
  start: '2026-08-30T10:00', end: '2026-08-30T20:00', res, ...over,
});

test('kein Vorgang ohne Zuweisung meldet eine Lücke — er sagt nichts über Personal aus', () => {
  const t = task([]);
  assert.equal(deckung(t, 'personal', state()), null);
});
test('eine Zuweisung über den ganzen Vorgang ergibt keine Lücke', () => {
  const t = task([{ rid: 'stagehand', n: 10, von: null, bis: null }]);
  const d = deckung(t, 'personal', state());
  assert.equal(d.luecktMin, 0);
});
test('Bühnenbau 10–20 Uhr, Helfer nur bis 18 Uhr — 2 Std Lücke am Ende', () => {
  const t = task([{ rid: 'stagehand', n: 10, von: '2026-08-30T10:00', bis: '2026-08-30T18:00' }]);
  const d = deckung(t, 'personal', state());
  assert.equal(d.luecktMin, 120);
  assert.deepEqual(d.luecken, [[toMin('2026-08-30T18:00'), toMin('2026-08-30T20:00')]]);
});
test('zwei überlappende Zuweisungen derselben Art werden vereinigt', () => {
  const t = task([
    { rid: 'stagehand', n: 6, von: '2026-08-30T10:00', bis: '2026-08-30T15:00' },
    { rid: 'rigger', n: 2, von: '2026-08-30T13:00', bis: '2026-08-30T20:00' },
  ]);
  const d = deckung(t, 'personal', state());
  assert.equal(d.luecktMin, 0);
});
test('Maschinen zählen nicht als Personal-Deckung', () => {
  const t = task([{ rid: 'stapler', n: 1, von: null, bis: null }]);
  assert.equal(deckung(t, 'personal', state()), null);
  assert.equal(deckung(t, 'maschine', state()).luecktMin, 0);
});

console.log('\nBedarfsraster');
test('Bereitstellung zählt als verfügbar, ein normaler Vorgang als Bedarf', () => {
  const s = state();
  const pool = { id: 'p', bereitstellung: true, start: '2026-08-30T08:00', end: '2026-08-30T22:00',
    res: [{ rid: 'stagehand', n: 10, von: null, bis: null }] };
  const sido = { id: 'sido', bereitstellung: false, start: '2026-08-30T20:00', end: '2026-08-30T21:00',
    res: [{ rid: 'stagehand', n: 6, von: null, bis: null }] };
  const raster = bedarfsRaster([pool, sido], ressourcen(s, 'personal'),
    { kind: 'personal', von: toMin('2026-08-30T08:00'), bis: toMin('2026-08-30T22:00'), schritt: 60 });
  const row = raster.find((r) => r.rid === 'stagehand');
  const i20 = (toMin('2026-08-30T20:00') - toMin('2026-08-30T08:00')) / 60;
  assert.equal(row.slots[i20].verfuegbar, 10);
  assert.equal(row.slots[i20].bedarf, 6);
  assert.equal(row.slots[i20].frei, 4);   // genau das SIDO-Beispiel aus dem Auftrag
});
test('Überbuchung ergibt eine negative Frei-Zahl', () => {
  const s = state();
  const pool = { id: 'p', bereitstellung: true, start: '2026-08-30T08:00', end: '2026-08-30T22:00',
    res: [{ rid: 'stagehand', n: 4, von: null, bis: null }] };
  const bedarf = { id: 'x', bereitstellung: false, start: '2026-08-30T10:00', end: '2026-08-30T11:00',
    res: [{ rid: 'stagehand', n: 6, von: null, bis: null }] };
  const raster = bedarfsRaster([pool, bedarf], ressourcen(s, 'personal'),
    { kind: 'personal', von: toMin('2026-08-30T08:00'), bis: toMin('2026-08-30T22:00'), schritt: 60 });
  const row = raster.find((r) => r.rid === 'stagehand');
  const i10 = (toMin('2026-08-30T10:00') - toMin('2026-08-30T08:00')) / 60;
  assert.equal(row.slots[i10].frei, -2);
});
test('bedarfsRaster ohne kind-Filter nimmt die übergebene Liste wie sie ist', () => {
  const s = state();
  const raster = bedarfsRaster([], ressourcen(s), { von: 0, bis: 60, schritt: 60 });
  assert.equal(raster.length, 3);
});

test('bedarfsRaster folgt einem verschobenen Vorgang', () => {
  const st = createStore({
    project: { id: 'p', name: 'T', venue: '', start: '2026-08-30T00:00', end: '2026-08-31T00:00', timezone: 'Europe/Berlin' },
    gewerke: [{ id: 'g', name: 'G', sort: 0 }],
    tasks: [{ id: 'x', gewerk: 'g', title: 'X', start: '2026-08-30T08:00', end: '2026-08-30T12:00', milestone: false, progress: 0, status: 'geplant' }],
    deps: [],
  });
  st.apply({ type: 'addRessource', label: 'Stagehand', kind: 'personal' });
  const rid = st.state.project.ressourcen[0].id;
  st.apply({ type: 'setTaskRes', id: 'x', index: null, value: { rid, n: 3, von: '2026-08-30T09:00', bis: '2026-08-30T10:00' } });
  st.apply({ type: 'moveTask', id: 'x', start: '2026-08-30T14:00', end: '2026-08-30T18:00' });
  const v = toMin('2026-08-30T08:00');
  const raster = bedarfsRaster(st.state.tasks, ressourcen(st.state, 'personal'), { kind: 'personal', von: v, bis: v + 600, schritt: 60 });
  const slots = raster.find((r) => r.rid === rid).slots;
  assert.equal(slots[1].bedarf, 0);   // altes Fenster 09–10: leer
  assert.equal(slots[7].bedarf, 3);   // neues Fenster 15–16
});

console.log('\nOhne Termin');
test('deckung: ein terminloser Vorgang sagt nichts über Deckung aus (null)', () => {
  const t = task([{ rid: 'stagehand', n: 2, von: null, bis: null }], { start: null, end: null });
  assert.equal(deckung(t, 'personal', state()), null);
});
test('bedarfsRaster: terminlose Vorgänge und Bereitstellungen tragen nichts bei, nichts wird NaN', () => {
  const von = toMin('2026-08-30T08:00');
  const l = [
    task([{ rid: 'stagehand', n: 3, von: null, bis: null }], { start: null, end: null }),
    task([{ rid: 'stagehand', n: 9, von: null, bis: null }], { start: null, end: null, bereitstellung: true }),
    task([{ rid: 'stagehand', n: 2, von: null, bis: null }]),
  ];
  const r = bedarfsRaster(l, state().project.ressourcen, { kind: 'personal', von, bis: von + 600, schritt: 60 });
  const sh = r.find((x) => x.rid === 'stagehand');
  assert.deepEqual(sh.slots.map((s) => s.bedarf), [0, 0, 2, 2, 2, 2, 2, 2, 2, 2]);
  assert.ok(sh.slots.every((s) => s.verfuegbar === 0 && Number.isFinite(s.frei)));
});

// ── Kalendertage ─────────────────────────────────────────────────────────────
console.log('\nKalendertage');
// Der 25.10.2026 hat 25 Stunden (Zeitumstellung): ein Tag ist NICHT immer 1440 min.
test('rasterGrenzen mit «tag»: gleiche Uhrzeit am Folgetag, 24.→25.10. = 1500 min', () => {
  const g = rasterGrenzen(toMin('2026-10-24T08:00'), toMin('2026-10-27T08:00'), 'tag');
  assert.equal(g.length, 4);
  ['2026-10-24T08:00', '2026-10-25T08:00', '2026-10-26T08:00', '2026-10-27T08:00'].forEach((iso, i) => assert.equal(g[i], toMin(iso)));
  assert.equal(g[1] - g[0], 1500);   // 24.→25.10. überspannt die Umstellung (03:00 → 02:00)
  assert.equal(g[2] - g[1], 1440);
});
test('rasterGrenzen: von === bis → nur [von]; Zahl-Schritt 60 = von + i*60', () => {
  const v = toMin('2026-10-24T08:00');
  assert.deepEqual(rasterGrenzen(v, v, 'tag'), [v]);
  assert.deepEqual(rasterGrenzen(v, v + 180, 60), [v, v + 60, v + 120, v + 180]);
});
for (const [name, bereit] of [['Bedarf', false], ['Bereitstellung', true]]) {
  test('bedarfsRaster «tag»: ' + name + ', der genau auf der Tagesgrenze endet, zählt nicht im Folgetag', () => {
    const t = { id: 't', start: '2026-10-24T10:00', end: '2026-10-25T00:00', res: [{ rid: 'r1', n: 2 }], ...(bereit ? { bereitstellung: true } : {}) };
    const [row] = bedarfsRaster([t], [{ id: 'r1', label: 'R', kind: 'personal' }],
      { kind: 'personal', von: toMin('2026-10-24T00:00'), bis: toMin('2026-10-28T00:00'), schritt: 'tag' });
    assert.deepEqual(row.slots.map((s) => (bereit ? s.verfuegbar : s.bedarf)), [2, 0, 0, 0]);
  });
}
test('bedarfsRaster «tag»: Bedarf um 23:30 am 26.10. landet in Scheibe 2, nicht 3', () => {
  const t = { id: 't', start: '2026-10-26T23:30', end: '2026-10-26T23:45', res: [{ rid: 'r1', n: 2 }] };
  const [row] = bedarfsRaster([t], [{ id: 'r1', label: 'R', kind: 'personal' }],
    { kind: 'personal', von: toMin('2026-10-24T00:00'), bis: toMin('2026-10-28T00:00'), schritt: 'tag' });
  assert.deepEqual(row.slots.map((s) => s.bedarf), [0, 0, 2, 0]);
});

// Lineare Referenz (Bezugswert für die binäre Suche): größtes i in [0, len-2]
// mit g[i] <= m (exklusiv: g[i] < m); 0, wenn keins passt.
const scheibeLinear = (g, m, exklusiv = false) => {
  let i = 0;
  for (let k = 0; k <= g.length - 2; k++) {
    if (exklusiv ? g[k] < m : g[k] <= m) i = k;
  }
  return i;
};

console.log('\nScheibensuche (scheibeIndex)');
test('scheibeIndex entspricht der linearen Referenz (200 Zufallsfälle, fester Seed)', () => {
  let seed = 12345;
  const zufall = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let f = 0; f < 200; f++) {
    const len = 2 + Math.floor(zufall() * 30);
    const g = [Math.floor(zufall() * 1000)];
    for (let k = 1; k < len; k++) g.push(g[k - 1] + 1 + Math.floor(zufall() * 60));
    const m = g[0] - 5 + Math.floor(zufall() * (g[len - 1] - g[0] + 10));
    for (const exklusiv of [false, true]) {
      const soll = scheibeLinear(g, m, exklusiv);
      const ist = scheibeIndex(g, m, exklusiv);
      assert.equal(ist, soll, `Grenzen=${JSON.stringify(g)} m=${m} exklusiv=${exklusiv}`);
    }
  }
});
test('scheibeIndex: m genau auf einer Grenze (beide Modi)', () => {
  const g = [600, 660, 720, 780, 840];
  for (let k = 0; k < g.length; k++) {
    const erwartetNormal = Math.min(k, g.length - 2);
    const erwartetExkl = Math.max(0, Math.min(k - 1, g.length - 2));
    assert.equal(scheibeIndex(g, g[k]), erwartetNormal, `m=${g[k]} normal`);
    assert.equal(scheibeIndex(g, g[k], true), erwartetExkl, `m=${g[k]} exklusiv`);
  }
});
test('scheibeIndex: m vor dem Anfang und hinter dem Ende', () => {
  const g = [600, 660, 720];
  assert.equal(scheibeIndex(g, 599), 0);
  assert.equal(scheibeIndex(g, 599, true), 0);
  assert.equal(scheibeIndex(g, 5000), 1);
  assert.equal(scheibeIndex(g, 5000, true), 1);
});
test('scheibeIndex: grenzen.length === 1 und === 2 → 0', () => {
  assert.equal(scheibeIndex([600], 600), 0);
  assert.equal(scheibeIndex([600], 700, true), 0);
  assert.equal(scheibeIndex([600, 660], 700), 0);
  assert.equal(scheibeIndex([600, 660], 600, true), 0);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
