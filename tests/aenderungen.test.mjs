import { COLLS, zerlegen, zusammensetzen, aenderungen, istLeer, umkehren, anwenden } from '../js/aenderungen.js';
import { createStore } from '../js/store.js';
import { deserialize } from '../js/persistence.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};
const laden = (n) => deserialize(readFileSync(new URL('../tools/fixtures/' + n + '.json', import.meta.url), 'utf8')).plan;
const KT = laden('klassentreffen-festival');
const AMK = laden('amk-singleshow');
const FEST = laden('festival-mit-daten');
const kl = (x) => JSON.parse(JSON.stringify(x));
const zaehl = (a, c) => ({ n: a[c].anlegen.length, a: a[c].aendern.length, l: a[c].loeschen.length });

console.log('\nZerlegen / Zusammensetzen');
for (const [n, p] of [['Klassentreffen', KT], ['AMK', AMK], ['Festival mit Daten', FEST]]) {
  test('Rundweg ' + n, () => assert.deepEqual(zusammensetzen(zerlegen(p)), p));
}
test('zerlegen: Plan-Datensatz ohne ressourcen, eid = project.id', () => {
  const z = zerlegen(FEST);
  assert.deepEqual([...z.plaene.keys()], [FEST.project.id]);
  assert.equal('ressourcen' in z.plaene.get(FEST.project.id), false);
  assert.equal(z.ressourcen.size, FEST.project.ressourcen.length);
  assert.equal(z.vorgaenge.size, FEST.tasks.length);
  assert.deepEqual(Object.keys(z), COLLS);
});
test('zusammensetzen mit Reihenfolge (Liste und eid→pos)', () => {
  const z = zerlegen(AMK);
  const ids = AMK.tasks.map((t) => t.id).reverse();
  assert.deepEqual(zusammensetzen(z, { vorgaenge: ids }).tasks.map((t) => t.id), ids);
  const pos = Object.fromEntries(ids.map((e, i) => [e, i]));
  assert.deepEqual(zusammensetzen(z, { vorgaenge: pos }).tasks.map((t) => t.id), ids);
});

console.log('\nÄnderungslisten');
test('moveTask = genau 1 vorgaenge.aendern, sonst nichts', () => {
  const s = createStore(AMK);
  const t = s.state.tasks.find((x) => !x.parent && !s.state.tasks.some((k) => k.parent === x.id) && x.start);
  const vor = kl(s.state);
  const r = s.apply({ type: 'moveTask', id: t.id, start: '2026-01-01T08:00', end: '2026-01-01T09:00' });
  assert.equal(r.ok, true);
  const a = aenderungen(vor, s.state);
  assert.deepEqual(zaehl(a, 'vorgaenge'), { n: 0, a: 1, l: 0 });
  for (const c of COLLS.filter((x) => x !== 'vorgaenge')) assert.equal(istLeer({ [c]: a[c] }), true, c);
});
test('addRessource = 1 ressourcen.anlegen, plaene unverändert', () => {
  const s = createStore(AMK);
  const vor = kl(s.state);
  assert.equal(s.apply({ type: 'addRessource', kind: 'personal', label: 'Neuer Helfer' }).ok, true);
  const a = aenderungen(vor, s.state);
  assert.deepEqual(zaehl(a, 'ressourcen'), { n: 1, a: 0, l: 0 });
  assert.deepEqual(zaehl(a, 'plaene'), { n: 0, a: 0, l: 0 });
});
test('removeGewerk = Gewerk + Vorgänge + Verknüpfungen gelöscht', () => {
  const s = createStore(FEST);
  const vor = kl(s.state);
  const g = vor.gewerke.find((x) => vor.tasks.some((t) => t.gewerk === x.id) && vor.deps.some((d) => vor.tasks.some((t) => t.gewerk === x.id && (t.id === d.from || t.id === d.to))));
  assert.equal(s.apply({ type: 'removeGewerk', id: g.id }).ok, true);
  const a = aenderungen(vor, s.state);
  assert.equal(a.gewerke.loeschen.length, 1);
  assert.equal(a.vorgaenge.loeschen.length, vor.tasks.length - s.state.tasks.length);
  assert.equal(a.verknuepfungen.loeschen.length, vor.deps.length - s.state.deps.length);
  assert.ok(a.vorgaenge.loeschen.length > 0 && a.verknuepfungen.loeschen.length > 0);
});
test('anwenden(nachher, umkehren(a)) ergibt vorher — auch Reihenfolge nach Löschen', () => {
  const s = createStore(FEST);
  const vor = kl(s.state);
  const g = vor.gewerke[2];
  s.apply({ type: 'removeGewerk', id: g.id });
  const a = aenderungen(vor, s.state);
  const r = anwenden(s.state, umkehren(a));
  assert.equal(r.ok, true);
  assert.deepEqual(r.state, vor);
  // und vorwärts wieder
  assert.deepEqual(anwenden(r.state, a).state, s.state);
});
test('anwenden mit abweichendem Datensatz → Konflikt geaendert; geloescht; existiert', () => {
  const s = createStore(AMK);
  const vor = kl(s.state);
  const id = vor.tasks[0].id;
  s.apply({ type: 'setTaskField', id, field: 'title', value: 'Neu' });
  const a = aenderungen(vor, s.state);
  const fremd = kl(s.state); fremd.tasks[0].title = 'Fremd';
  const r = anwenden(fremd, umkehren(a));
  assert.equal(r.ok, false);
  assert.deepEqual(r.konflikt, [{ coll: 'vorgaenge', eid: id, art: 'geaendert' }]);
  const weg = kl(s.state); weg.tasks.splice(0, 1);
  assert.equal(anwenden(weg, umkehren(a)).konflikt[0].art, 'geloescht');
  assert.equal(anwenden(vor, umkehren(aenderungen(vor, vor))).ok, true);
  assert.equal(anwenden(s.state, aenderungen(vor, s.state)).konflikt[0].art, 'geaendert');
});
test('Eingabezustand wird nie verändert', () => {
  const s = createStore(AMK);
  const vor = kl(s.state);
  s.apply({ type: 'setTaskField', id: vor.tasks[0].id, field: 'title', value: 'Neu' });
  const a = aenderungen(vor, s.state);
  const eingabe = kl(s.state);
  anwenden(s.state, umkehren(a));
  assert.deepEqual(s.state, eingabe);
});
test('Untervorgänge: Undo über die Liste stellt die Hülle des Sammelvorgangs wieder her', () => {
  const s = createStore(AMK);
  const kind = s.state.tasks.find((t) => t.parent);
  if (!kind) return;   // Fixture ohne Untervorgänge
  const vor = kl(s.state);
  const r = s.apply({ type: 'moveTask', id: kind.id, start: '2026-02-01T08:00', end: '2026-02-01T09:00' });
  assert.equal(r.ok, true);
  const a = aenderungen(vor, s.state);
  assert.ok(a.vorgaenge.aendern.length >= 2, 'Kind + Hülle');
  assert.deepEqual(anwenden(s.state, umkehren(a)).state, vor);
});
test('Leistung: Klassentreffen-Plan, Änderungsliste je Befehl', () => {
  const s = createStore(KT);
  const vor = s.state;
  const t = vor.tasks.find((x) => !x.parent && x.start);
  s.apply({ type: 'setTaskField', id: t.id, field: 'title', value: 'X' });
  const n = 20, t0 = performance.now();
  for (let i = 0; i < n; i++) aenderungen(vor, s.state);
  const ms = (performance.now() - t0) / n;
  console.log(`      aenderungen auf ~${Math.round(JSON.stringify(vor).length / 1024)} KB: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 100, 'viel zu langsam: ' + ms);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
