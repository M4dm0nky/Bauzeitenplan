import { ressourcen, resGruppen, resLabel, resKind, deckung, zaehltAlsDeckung, bedarfsRaster, offeneBedarfe, genutzteRessourcen, rasterGrenzen, scheibeIndex } from '../js/resources.js';
import { toMin } from '../js/schedule.js';
import { RES_EINGEBAUT, RES_KATEGORIEN } from '../js/res-katalog.js';
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
  const eigene = (k) => ressourcen(s, k).filter((r) => !r.eingebaut);
  assert.deepEqual(eigene('maschine').map((r) => r.id), ['stapler']);
  assert.equal(eigene('personal').length, 2);
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
  const raster = bedarfsRaster([pool, sido], ressourcen(s, 'personal').filter((r) => !r.eingebaut),
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
  const raster = bedarfsRaster([pool, bedarf], ressourcen(s, 'personal').filter((r) => !r.eingebaut),
    { kind: 'personal', von: toMin('2026-08-30T08:00'), bis: toMin('2026-08-30T22:00'), schritt: 60 });
  const row = raster.find((r) => r.rid === 'stagehand');
  const i10 = (toMin('2026-08-30T10:00') - toMin('2026-08-30T08:00')) / 60;
  assert.equal(row.slots[i10].frei, -2);
});
test('bedarfsRaster ohne kind-Filter nimmt die übergebene Liste wie sie ist', () => {
  const s = state();
  const raster = bedarfsRaster([], ressourcen(s).filter((r) => !r.eingebaut), { von: 0, bis: 60, schritt: 60 });
  assert.equal(raster.length, 3);
});

test('bedarfsRaster folgt einem verschobenen Vorgang', () => {
  const st = createStore({
    project: { id: 'p', name: 'T', venue: '', start: '2026-08-30T00:00', end: '2026-08-31T00:00', timezone: 'Europe/Berlin' },
    gewerke: [{ id: 'g', name: 'G', sort: 0 }],
    tasks: [{ id: 'x', gewerk: 'g', title: 'X', start: '2026-08-30T08:00', end: '2026-08-30T12:00', milestone: false, progress: 0, status: 'geplant' }],
    deps: [],
  });
  st.apply({ type: 'addRessource', label: 'Hallenhelfer', kind: 'personal' });
  const rid = st.state.project.ressourcen[0].id;
  st.apply({ type: 'setTaskRes', id: 'x', index: null, value: { rid, n: 3, von: '2026-08-30T09:00', bis: '2026-08-30T10:00' } });
  st.apply({ type: 'moveTask', id: 'x', start: '2026-08-30T14:00', end: '2026-08-30T18:00' });
  const v = toMin('2026-08-30T08:00');
  const raster = bedarfsRaster(st.state.tasks, ressourcen(st.state, 'personal').filter((r) => !r.eingebaut), { kind: 'personal', von: v, bis: v + 600, schritt: 60 });
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

console.log('\nEingebaute Bezeichnungen');
test('eingebaute ids sind stabil (Export-Lesbarkeit)', () => {
  assert.deepEqual(RES_EINGEBAUT.map((r) => r.id), [
    'm-stapler-bis35','m-stapler-ueber35','m-gelstapler-bis35','m-gelstapler-ueber35',
    'm-tele-7','m-tele-14','m-tele-17','m-tele-rotor',
    'm-schere-8','m-schere-10','m-schere-12','m-schere-14',
    'm-gelschere-10','m-gelschere-12','m-gelschere-15','m-gelschere-18',
    'm-gelenk-16','m-gelenk-20','m-gelenk-26','m-raupe','m-lkw-buehne',
    'm-mobilkran','m-radlader','m-hubwagen',
    'p-stagehand','p-rigger','p-groundrigger','p-staplerfahrer','p-elektro','p-runner']);
});
test('jede eingebaute zeigt auf eine Kategorie derselben Art', () => {
  for (const r of RES_EINGEBAUT) {
    const k = RES_KATEGORIEN.find((c) => c.id === r.kat);
    assert.ok(k, r.id + ' ohne Kategorie');
    assert.equal(k.kind, r.kind, r.id);
  }
  assert.deepEqual(RES_KATEGORIEN.slice(-2).map((k) => k.id), ['eigene-m', 'eigene-p']);
});
test('ressourcen ohne eigene = eingebaute einer Art', () => {
  assert.equal(ressourcen({ project: {} }, 'maschine').length, 24);
  assert.equal(ressourcen({ project: {} }, 'personal').length, 6);
});
test('eigene ohne kat landen in eigene-m, hinter den eingebauten', () => {
  const l = ressourcen({ project: { ressourcen: [{ id: 'x', label: 'Bagger', kind: 'maschine' }] } }, 'maschine');
  const z = l[l.length - 1];
  assert.equal(z.id, 'x'); assert.equal(z.kat, 'eigene-m'); assert.equal(z.eingebaut, false);
  assert.equal(l[0].eingebaut, true);
});
test('eigene mit gültigem kat stehen hinter den eingebauten ihrer Kategorie', () => {
  const l = ressourcen({ project: { ressourcen: [{ id: 'x', label: 'Bagger', kind: 'maschine', kat: 'stapler' }] } }, 'maschine');
  assert.deepEqual(l.slice(0, 5).map((r) => r.id), ['m-stapler-bis35','m-stapler-ueber35','m-gelstapler-bis35','m-gelstapler-ueber35','x']);
});
test('resGruppen «12» findet Halle 12 m und Gelände 12 m, Köpfe bleiben', () => {
  const g = resGruppen({ project: {} }, 'maschine', '12');
  assert.deepEqual(g.map((x) => x.kat), ['schere-halle', 'schere-gelaende']);
  assert.deepEqual(g.flatMap((x) => x.items.map((i) => i.id)), ['m-schere-12', 'm-gelschere-12']);
});
test('resGruppen Treffer im Kategorienamen liefert die ganze Kategorie', () => {
  const g = resGruppen({ project: {} }, 'maschine', ' Stapler ');
  assert.deepEqual(g.map((x) => x.kat), ['stapler']);
  assert.equal(g[0].items.length, 4);
});
test('resGruppen ohne Treffer ist leer; ohne query alle Gruppen der Art', () => {
  assert.deepEqual(resGruppen({ project: {} }, 'maschine', 'zzz'), []);
  assert.equal(resGruppen({ project: {} }, 'personal').length, 1);
});
test('resLabel/resKind kennen eingebaute', () => {
  assert.equal(resLabel('m-tele-14', { project: {} }), 'Teleskoplader starr 14 m');
  assert.equal(resKind('m-tele-14', { project: {} }), 'maschine');
});


console.log('\nBedarfsstatus: offeneBedarfe / bestaetigt im Raster');
const stS = (tasks) => ({ project: {}, gewerke: [{ id: 'g1', name: 'A', sort: 1 }, { id: 'g2', name: 'B', sort: 0 }], tasks });
const tk = (id, gewerk, start, end, res, over = {}) => ({ id, gewerk, title: id, start, end, res, ...over });
test('zaehltAlsDeckung: abgelehnt zählt nicht, angefragt/fehlend/bestätigt schon', () => {
  assert.equal(zaehltAlsDeckung({ rid: 'stagehand', n: 1, status: 'abgelehnt' }), false);
  assert.equal(zaehltAlsDeckung({ rid: 'stagehand', n: 1 }), true);
  assert.equal(zaehltAlsDeckung({ rid: 'stagehand', n: 1, status: 'angefragt' }), true);
  assert.equal(zaehltAlsDeckung({ rid: 'stagehand', n: 1, status: 'bestaetigt' }), true);
});
test('deckung: abgelehnte Zeile deckt nicht ab — Lücke bleibt', () => {
  const t = task([
    { rid: 'stagehand', n: 4, von: '2026-08-30T10:00', bis: '2026-08-30T15:00' },
    { rid: 'rigger', n: 2, von: '2026-08-30T15:00', bis: '2026-08-30T20:00', status: 'abgelehnt' },
  ]);
  const d = deckung(t, 'personal', state());
  assert.equal(d.luecktMin, 300);
  assert.deepEqual(d.luecken, [[toMin('2026-08-30T15:00'), toMin('2026-08-30T20:00')]]);
});
test('deckung: nur abgelehnte Zeilen — volle Lücke, nicht null', () => {
  const t = task([{ rid: 'stagehand', n: 10, von: null, bis: null, status: 'abgelehnt' }]);
  const d = deckung(t, 'personal', state());
  assert.notEqual(d, null);
  assert.equal(d.luecktMin, 600);
  assert.deepEqual(d.gedeckt, []);
});
test('bedarfsRaster: abgelehnter Bedarf zählt als bedarf, nicht als bestaetigt', () => {
  const t = tk('a', 'g1', '2026-05-04T08:00', '2026-05-04T10:00', [{ rid: 'p-runner', n: 3, von: null, bis: null, status: 'abgelehnt' }]);
  const r = bedarfsRaster([t], [{ id: 'p-runner', label: 'Runner', kind: 'personal' }], { kind: 'personal', von: toMin('2026-05-04T08:00'), bis: toMin('2026-05-04T10:00'), schritt: 60 });
  assert.equal(r[0].slots[0].bedarf, 3);
  assert.equal(r[0].slots[0].bestaetigt, 0);
});

test('offeneBedarfe: nur angefragte (oder fehlende) Zeilen, keine bestätigten, keine Bereitstellung, kein ohneTermin', () => {
  const s = stS([
    tk('a', 'g1', '2026-05-04T08:00', '2026-05-04T12:00', [
      { rid: 'p-runner', n: 2, von: null, bis: null },
      { rid: 'p-elektro', n: 1, von: null, bis: null, status: 'bestaetigt' },
      { rid: 'p-rigger', n: 1, von: null, bis: null, status: 'abgelehnt' },
      { rid: 'p-stagehand', n: 1, von: null, bis: null, status: 'angefragt' },
    ]),
    tk('b', 'g1', '2026-05-04T08:00', '2026-05-04T12:00', [{ rid: 'p-runner', n: 9, von: null, bis: null }], { bereitstellung: true }),
    tk('c', 'g1', null, null, [{ rid: 'p-runner', n: 4, von: null, bis: null }]),
  ]);
  const o = offeneBedarfe(s);
  assert.equal(o.length, 1);
  assert.deepEqual(o[0].eintraege.map((e) => [e.taskId, e.index, e.rid, e.n]), [['a', 0, 'p-runner', 2], ['a', 3, 'p-stagehand', 1]]);
});
test('offeneBedarfe gruppiert nach Gewerk (sort), Tag, Beginn; Tag aus von, sonst Vorgangsstart', () => {
  const s = stS([
    tk('a', 'g1', '2026-05-05T09:00', '2026-05-05T10:00', [{ rid: 'p-runner', n: 1, von: null, bis: null }]),
    tk('b', 'g2', '2026-05-06T09:00', '2026-05-06T10:00', [{ rid: 'p-runner', n: 1, von: null, bis: null }]),
    tk('c', 'g2', '2026-05-04T22:00', '2026-05-05T02:00', [{ rid: 'p-runner', n: 1, von: '2026-05-05T00:30', bis: '2026-05-05T02:00' }]),
    tk('d', 'g2', '2026-05-05T08:00', '2026-05-05T10:00', [{ rid: 'p-runner', n: 1, von: null, bis: null }]),
  ]);
  const o = offeneBedarfe(s);
  assert.deepEqual(o.map((g) => [g.gewerk, g.tag]), [['g2', '2026-05-05'], ['g2', '2026-05-06'], ['g1', '2026-05-05']]);
  assert.deepEqual(o[0].eintraege.map((e) => e.taskId), ['c', 'd']);
});
test('bedarfsRaster zählt bestaetigt nur für bestätigte Bedarfszeilen', () => {
  const t = [
    tk('a', 'g1', '2026-05-04T08:00', '2026-05-04T10:00', [
      { rid: 'p-runner', n: 3, von: null, bis: null, status: 'bestaetigt' },
      { rid: 'p-runner', n: 2, von: null, bis: null },
      { rid: 'p-runner', n: 5, von: null, bis: null, status: 'abgelehnt' },
    ]),
  ];
  const von = toMin('2026-05-04T08:00');
  const r = bedarfsRaster(t, [{ id: 'p-runner', label: 'Runner', kind: 'personal' }], { kind: 'personal', von, bis: von + 120, schritt: 60 });
  assert.deepEqual(r[0].slots.map((x) => [x.bedarf, x.bestaetigt]), [[10, 3], [10, 3]]);
});

test('genutzteRessourcen: nur Bezeichnungen mit Zuweisung (Bedarf oder Bereitstellung), ohne Termin zählt nicht', () => {
  const list = [{ id: 'a', kind: 'maschine' }, { id: 'b', kind: 'maschine' }, { id: 'c', kind: 'maschine' }, { id: 'd', kind: 'maschine' }];
  const t = [
    tk('x', 'g1', '2026-05-04T08:00', '2026-05-04T10:00', [{ rid: 'a', n: 1, von: null, bis: null }]),
    tk('y', 'g1', '2026-05-04T08:00', '2026-05-04T10:00', [{ rid: 'b', n: 2, von: null, bis: null }], { bereitstellung: true }),
    tk('z', 'g1', null, null, [{ rid: 'c', n: 1, von: null, bis: null }]),
  ];
  assert.deepEqual(genutzteRessourcen(t, list).map((r) => r.id), ['a', 'b']);
  assert.deepEqual(genutzteRessourcen([], list), []);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
