import { canEditTask, canEditField, canEditStructure } from '../js/roles.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

const admin = { userId: 'u1', role: 'admin', scopes: [] };
const lead = { userId: 'u2', role: 'lead', scopes: ['g0'] };
const rigTask = { id: 't0', gewerk: 'g0', title: 'Rigging' };
const licTask = { id: 't1', gewerk: 'g1', title: 'Licht' };
const projTask = { id: 't9', gewerk: 'projekt', title: 'Doors' };

console.log('\nRollen — ohne Session (localStorage-Modus)');
test('ohne Session ist alles editierbar (wie heute)', () => {
  assert.equal(canEditTask(null, licTask), true);
  assert.equal(canEditField(null, licTask, 'gewerk'), true);
  assert.equal(canEditStructure(null), true);
});

console.log('\nRollen — Admin');
test('Admin darf jede Task und jedes Feld', () => {
  assert.equal(canEditTask(admin, licTask), true);
  assert.equal(canEditField(admin, licTask, 'gewerk'), true);
  assert.equal(canEditStructure(admin), true);
});

console.log('\nRollen — Lead (Scope g0)');
test('Lead darf seine Gewerk-Task', () => assert.equal(canEditTask(lead, rigTask), true));
test('Lead darf fremde Gewerk-Task NICHT', () => assert.equal(canEditTask(lead, licTask), false));
test('Lead darf Projekt-Meilenstein NICHT', () => assert.equal(canEditTask(lead, projTask), false));
test('Lead darf in seiner Task Zeiten ändern', () => {
  assert.equal(canEditField(lead, rigTask, 'start'), true);
  assert.equal(canEditField(lead, rigTask, 'end'), true);
  assert.equal(canEditField(lead, rigTask, 'progress'), true);
});
test('Lead darf das Gewerk-Feld NICHT ändern (kein Herausschieben)', () => {
  assert.equal(canEditField(lead, rigTask, 'gewerk'), false);
});
test('Lead darf keine Struktur (Gewerke/Deps/Projekt) ändern', () => {
  assert.equal(canEditStructure(lead), false);
});
test('Lead ohne Scope-Treffer darf nichts an fremder Task', () => {
  assert.equal(canEditField(lead, licTask, 'start'), false);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
