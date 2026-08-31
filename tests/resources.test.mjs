import { ressourcen, resLabel, resKind, deckung, bedarfsRaster } from '../js/resources.js';
import { toMin } from '../js/schedule.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
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

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
