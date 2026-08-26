import { gewerkVar, gewerkTexture, hueVon, slotAus, HUES, MAX_SLOTS } from '../js/palette.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

console.log('\nFarbplätze: Farbton × Schraffur');

test('ein Platz ist genau ein Paar aus Farbton und Schraffur', () => {
  // Deshalb reichen zehn Punkte und ein Schalter, um alle zwanzig zu erreichen.
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    assert.equal(slotAus(hueVon(slot), gewerkTexture(slot)), slot, 'Platz ' + slot);
  }
});

test('die ersten zehn Plätze tragen keine Schraffur, die zweiten zehn schon', () => {
  for (let i = 0; i < HUES; i++) {
    assert.equal(gewerkTexture(i), false, 'Platz ' + i);
    assert.equal(gewerkTexture(i + HUES), true, 'Platz ' + (i + HUES));
  }
});

test('derselbe Farbton, einmal mit und einmal ohne Schraffur', () => {
  // Genau der Fall, um den es geht: «aus rot auch rot/schraffur machen».
  const rot = 3;
  assert.equal(slotAus(rot, false), 3);
  assert.equal(slotAus(rot, true), 13);
  assert.equal(gewerkVar(3), gewerkVar(13), 'derselbe Farbton');
  assert.notEqual(gewerkTexture(3), gewerkTexture(13), 'aber unterscheidbar');
});

test('jede der zwanzig Kombinationen sieht anders aus', () => {
  const gesehen = new Set();
  for (let slot = 0; slot < MAX_SLOTS; slot++) gesehen.add(gewerkVar(slot) + '|' + gewerkTexture(slot));
  assert.equal(gesehen.size, MAX_SLOTS);
});

console.log('\nRobustheit — kein Platz darf ins Leere zeigen');

test('negative Farbtöne landen wieder in der Palette', () => {
  // `var(--gw--1)` gäbe es nicht, und der Balken bliebe ungefärbt.
  assert.equal(hueVon(-1), HUES - 1);
  assert.equal(hueVon(-11), HUES - 1);
  assert.ok(/--gw-\d/.test(gewerkVar(-1)));
});

test('zu große Farbtöne laufen um', () => {
  assert.equal(hueVon(HUES), 0);
  assert.equal(hueVon(HUES + 3), 3);
  assert.equal(slotAus(HUES + 3, true), 3 + HUES);
});

test('Kommazahlen werden auf einen ganzen Platz gebracht', () => {
  assert.equal(hueVon(3.7), 3);
  assert.equal(slotAus(3.7, false), 3);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
