import { artOf, sichtGewerke, sichtTasks, zeitraumFuer, punktLabel, ART_FUER, EBENEN } from '../js/ebene.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const T = (id, gewerk, start, end) =>
  ({ id, gewerk, title: id, start, end, milestone: false, status: 'geplant' });

const S = {
  gewerke: [
    { id: 'g0', name: 'Bühne', sort: 0, slot: 0 },                      // Altdaten: kein art
    { id: 'g1', name: 'Ton', sort: 1, slot: 1, art: 'gewerk' },
    { id: 'b0', name: 'Hauptbühne', sort: 2, slot: 0, art: 'buehne' },
    { id: 'b1', name: 'Zelt', sort: 3, slot: 1, art: 'buehne' },
  ],
  tasks: [
    T('t0', 'g0', '2026-08-21T08:00', '2026-08-21T18:00'),
    T('t1', 'g1', '2026-08-22T08:00', '2026-08-22T12:00'),
    T('p0', 'b0', '2026-08-29T14:00', '2026-08-29T14:30'),
    T('p1', 'b0', '2026-08-29T20:40', '2026-08-29T21:50'),
    T('p2', 'b1', '2026-08-30T15:00', '2026-08-30T16:00'),
  ],
};

console.log('\nEbenen');

test('Altdaten ohne art sind Gewerke', () => {
  assert.equal(artOf({ id: 'g0' }), 'gewerk');
  assert.equal(artOf({ id: 'b0', art: 'buehne' }), 'buehne');
});

test('der Bauzeitenplan zeigt nur Gewerke', () => {
  assert.deepEqual(sichtGewerke(S, 'bau').map((g) => g.id), ['g0', 'g1']);
});

test('der Showablauf zeigt nur Bühnen', () => {
  assert.deepEqual(sichtGewerke(S, 'show').map((g) => g.id), ['b0', 'b1']);
});

test('die Bänder kommen nach sort, nicht in Datei-Reihenfolge', () => {
  const durcheinander = { gewerke: [{ id: 'b1', sort: 3, art: 'buehne' }, { id: 'b0', sort: 2, art: 'buehne' }], tasks: [] };
  assert.deepEqual(sichtGewerke(durcheinander, 'show').map((g) => g.id), ['b0', 'b1']);
});

test('der Filter nimmt einzelne Bühnen heraus', () => {
  assert.deepEqual(sichtGewerke(S, 'show', new Set(['b1'])).map((g) => g.id), ['b0']);
  assert.deepEqual(sichtTasks(S, 'show', new Set(['b1'])).map((t) => t.id), ['p0', 'p1']);
});

test('Vorgänge folgen ihrem Band', () => {
  assert.deepEqual(sichtTasks(S, 'bau').map((t) => t.id), ['t0', 't1']);
  assert.deepEqual(sichtTasks(S, 'show').map((t) => t.id), ['p0', 'p1', 'p2']);
});

test('ein Vorgang ohne existierendes Band fällt aus beiden Ebenen', () => {
  const s = { gewerke: S.gewerke, tasks: [...S.tasks, T('x', 'weg', '2026-08-29T10:00', '2026-08-29T11:00')] };
  assert.equal(sichtTasks(s, 'bau').some((t) => t.id === 'x'), false);
  assert.equal(sichtTasks(s, 'show').some((t) => t.id === 'x'), false);
});

test('unbekannte Ebene fällt auf Gewerke zurück, statt leer zu sein', () => {
  assert.deepEqual(sichtGewerke(S, 'quatsch').map((g) => g.id), ['g0', 'g1']);
});

console.log('\nZeitfenster der Ebene');

test('rundet auf volle Kalendertage', () => {
  const z = zeitraumFuer(sichtTasks(S, 'show'));
  assert.equal(z.start, '2026-08-29T00:00');
  assert.equal(z.end, '2026-08-31T00:00');
});

test('ein Ende exakt auf Mitternacht hängt keinen leeren Tag an', () => {
  const z = zeitraumFuer([T('a', 'b0', '2026-08-29T12:00', '2026-08-30T00:00')]);
  assert.equal(z.start, '2026-08-29T00:00');
  assert.equal(z.end, '2026-08-30T00:00');
});

test('ein einzelner Tag bleibt ein Tag', () => {
  const z = zeitraumFuer([T('a', 'b0', '2026-08-29T14:00', '2026-08-29T14:30')]);
  assert.equal(z.start, '2026-08-29T00:00');
  assert.equal(z.end, '2026-08-30T00:00');
});

test('über den Sommerzeit-Sprung bleibt der Tag ein Tag', () => {
  // 25.10.2026 hat 25 Stunden. Aus Ziffern gerechnet käme 24 h heraus und das
  // Fenster endete eine Stunde zu früh.
  const z = zeitraumFuer([T('a', 'b0', '2026-10-25T02:00', '2026-10-25T23:00')]);
  assert.equal(z.start, '2026-10-25T00:00');
  assert.equal(z.end, '2026-10-26T00:00');
});

test('ohne Vorgänge gibt es kein Fenster', () => {
  assert.equal(zeitraumFuer([]), null);
  assert.equal(zeitraumFuer(null), null);
});

console.log('\nProgrammpunkt-Typen');

test('jeder Typ hat eine Beschriftung', () => {
  assert.equal(punktLabel('changeover'), 'Changeover');
  assert.equal(punktLabel('act'), 'Act');
});

test('ein unbekannter Typ verschwindet nicht, sondern steht da', () => {
  assert.equal(punktLabel('sonstwas'), 'sonstwas');
});

test('jede Ebene hat eine Gewerk-Art', () => {
  for (const [key] of EBENEN) assert.ok(ART_FUER[key], 'keine Art für ' + key);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
