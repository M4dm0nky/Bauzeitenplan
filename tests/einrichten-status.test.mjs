// ── Einrichten: Statusrechnung (DOM-frei) ───────────────────────────────────
import assert from 'node:assert/strict';
import { ausserhalb, zeitraumHuelle, einrichtStatus } from '../js/einrichten-status.js';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const plan = ({ phases = [], tasks = [], gewerke = [], project = {} } = {}) => ({
  project: { id: 'p1', name: 'Festwiese', venue: '', start: '2027-08-01T00:00', end: '2027-08-12T00:00', timezone: 'Europe/Berlin', ...project },
  gewerke, tasks, deps: [], phases,
});
const phase = (id, art, name, start, end) => ({ id, art, name, start, end });
const festwiese = () => plan({
  phases: [phase('ph1', 'aufbau', 'Aufbau', '2027-08-02T08:00', '2027-08-05T18:00'), phase('ph2', 'abbau', 'Abbau', '2027-08-10T08:00', '2027-08-30T18:00')],
});

console.log('\nEinrichten: Status und Zeitraum-Hülle');
test('Festwiese: Ende 12.08., Phase bis 30.08. → phasen warn, ausserhalb.phasen === 1', () => {
  const s = festwiese();
  assert.equal(ausserhalb(s).phasen, 1);
  assert.equal(einrichtStatus(s).phasen, 'warn');
});
test('Hülle reicht bis zum Ende der letzten Phase', () => {
  assert.deepEqual(zeitraumHuelle(festwiese()), { start: '2027-08-01T00:00', end: '2027-08-30T18:00' });
});
test('Phase vor project.start zählt als außerhalb', () => {
  const s = plan({ phases: [phase('ph1', 'planung', 'Planung', '2027-07-20T08:00', '2027-07-25T08:00')] });
  assert.equal(ausserhalb(s).phasen, 1);
  assert.equal(zeitraumHuelle(s).start, '2027-07-20T08:00');
});
test('terminloser Vorgang zählt nicht als außerhalb', () => {
  const s = plan({ tasks: [{ id: 't1', gewerk: 'g', title: 'X' }] });
  assert.deepEqual(ausserhalb(s), { phasen: 0, vorgaenge: 0 });
});
test('Vorgang genau auf project.end zählt nicht als außerhalb (Grenze)', () => {
  const s = plan({ tasks: [{ id: 't1', gewerk: 'g', title: 'X', start: '2027-08-11T00:00', end: '2027-08-12T00:00' }] });
  assert.equal(ausserhalb(s).vorgaenge, 0);
  s.tasks[0].end = '2027-08-12T00:01';
  assert.equal(ausserhalb(s).vorgaenge, 1);
});
test('leerer Plan: projekt ok, phasen leer, baender leer, res leer, arten leer', () => {
  assert.deepEqual(einrichtStatus(plan()), { projekt: 'ok', phasen: 'leer', baender: 'leer', res: 'leer', arten: 'leer' });
});
test('Projekt ohne Namen → projekt leer', () => {
  assert.equal(einrichtStatus(plan({ project: { name: '  ' } })).projekt, 'leer');
});
test('nur Bühnen → baender leer; Gewerk ohne art zählt als Gewerk', () => {
  const s = plan({ gewerke: [{ id: 'b', name: 'Hauptbühne', art: 'buehne' }] });
  assert.equal(einrichtStatus(s).baender, 'leer');
  s.gewerke.push({ id: 'g', name: 'Licht' });
  assert.equal(einrichtStatus(s).baender, 'ok');
});
test('Phase im Zeitraum → phasen ok; Ressource / Art / Abschnitt → ok', () => {
  const s = plan({ phases: [phase('ph1', 'aufbau', 'Aufbau', '2027-08-02T08:00', '2027-08-05T18:00')], project: { ressourcen: [{ id: 'crew', label: 'Crew', kind: 'personal' }] } });
  const st = einrichtStatus(s);
  assert.equal(st.phasen, 'ok'); assert.equal(st.res, 'ok'); assert.equal(st.arten, 'leer');
  s.project.abschnitte = [{ id: 'x', label: 'X' }];
  assert.equal(einrichtStatus(s).arten, 'ok');
  delete s.project.abschnitte; s.project.punktTypen = [{ id: 'y', label: 'Y' }];
  assert.equal(einrichtStatus(s).arten, 'ok');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
