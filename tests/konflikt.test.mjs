// Konfliktauflösung (js/konflikt.js) mit echten Datenformen: Plan aus den Fixtures,
// Änderungslisten aus der echten aenderungen().
import { aenderungen, anwenden, istLeer } from '../js/aenderungen.js';
import { abgelaufenEntscheid, eintragTitel, konfliktArt, gruppen, fremdUebernehmen, ohne, meineBehalten, wiederherstellen, offeneSchluessel, uebernehmeOhneOffene } from '../js/konflikt.js';
import { deserialize } from '../js/persistence.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};
const kl = (x) => JSON.parse(JSON.stringify(x));
const BASIS = deserialize(readFileSync(new URL('../tools/fixtures/festival-mit-daten.json', import.meta.url), 'utf8')).plan;
const task = (s, id) => s.tasks.find((t) => t.id === id);

// Meine Änderung: t1 umbenennen UND t2 verschieben (zwei Vorgänge in EINER Liste)
const meins = (() => {
  const n = kl(BASIS);
  task(n, 't1').title = 'Meine Fassung';
  task(n, 't2').title = 'Auch meine';
  return n;
})();
const aend = aenderungen(BASIS, meins);

test('eintragTitel: aus fremdem Stand, Änderungsliste, Plan; sonst Artname', () => {
  assert.equal(eintragTitel('vorgaenge', 't1', { fremd: { id: 't1', title: 'Fremd' } }), 'Fremd');
  assert.equal(eintragTitel('vorgaenge', 't1', { aend }), BASIS.tasks.find((t) => t.id === 't1').title);
  assert.equal(eintragTitel('vorgaenge', 't2', { state: BASIS }), task(BASIS, 't2').title);
  assert.equal(eintragTitel('vorgaenge', 'gibt-es-nicht', { state: BASIS }), 'Vorgang');
  assert.equal(eintragTitel('verknuepfungen', 'd0', { state: BASIS }), 'Verknüpfung');
});

test('konfliktArt: geändert, gelöscht (art oder fremd null), unbekannt (Lesefehler ist KEINE Löschung)', () => {
  assert.equal(konfliktArt({ coll: 'vorgaenge', eid: 't1', art: 'aendern', fremd: { id: 't1' } }), 'geaendert');
  assert.equal(konfliktArt({ coll: 'vorgaenge', eid: 't1', art: 'geloescht', fremd: null }), 'geloescht');
  assert.equal(konfliktArt({ coll: 'vorgaenge', eid: 't1', art: 'aendern', fremd: null }), 'geloescht');
  assert.equal(konfliktArt({ coll: 'vorgaenge', eid: 't1', art: 'aendern', fremd: null, unbekannt: true }), 'unbekannt');
});

test('gruppen: ein Eintrag je Art, Reihenfolge des ersten Auftretens', () => {
  const g = gruppen([
    { coll: 'vorgaenge', eid: 'a', art: 'geloescht', fremd: null },
    { coll: 'vorgaenge', eid: 'b', art: 'aendern', fremd: { id: 'b' } },
    { coll: 'vorgaenge', eid: 'c', art: 'geloescht', fremd: null },
  ]);
  assert.deepEqual(g.map((x) => [x.art, x.eintraege.length]), [['geloescht', 2], ['geaendert', 1]]);
});

test('fremdUebernehmen: ersetzt den Datensatz, löscht bei fremd null, ändert den Eingang nicht', () => {
  const fremd = { ...task(BASIS, 't1'), title: 'Von Anna' };
  const vorher = kl(meins);
  const r = fremdUebernehmen(meins, [{ coll: 'vorgaenge', eid: 't1', art: 'aendern', fremd }]);
  assert.equal(task(r, 't1').title, 'Von Anna');
  assert.equal(task(r, 't2').title, 'Auch meine', 'der andere Datensatz bleibt meiner');
  assert.deepEqual(meins, vorher);
  const g = fremdUebernehmen(meins, [{ coll: 'vorgaenge', eid: 't2', art: 'geloescht', fremd: null }]);
  assert.equal(task(g, 't2'), undefined);
  assert.equal(g.tasks.length, meins.tasks.length - 1);
  assert.equal(g.tasks.findIndex((t) => t.id === 't1'), meins.tasks.findIndex((t) => t.id === 't1'), 'Reihenfolge bleibt');
});

test('ohne: Rest der Änderungsliste, parallele Positionslisten bleiben gleich lang', () => {
  const r = ohne(aend, [{ coll: 'vorgaenge', eid: 't1' }]);
  assert.deepEqual(r.vorgaenge.aendern.map((e) => e.vorher.id), ['t2']);
  assert.equal(r.vorgaenge.aendernPos.length, 1);
  assert.equal(r.vorgaenge.aendernPosNeu.length, 1);
  const alle = ohne(aend, [{ coll: 'vorgaenge', eid: 't1' }, { coll: 'vorgaenge', eid: 't2' }]);
  assert.ok(istLeer(alle));
});

test('meineBehalten: «existiert» wird zum Ändern, sonst unverändert', () => {
  const n = kl(BASIS);
  n.tasks.push({ ...kl(task(BASIS, 't1')), id: 'neu1', title: 'Neu' });
  const a = aenderungen(BASIS, n);
  assert.equal(a.vorgaenge.anlegen.length, 1);
  const r = meineBehalten(a, [{ coll: 'vorgaenge', eid: 'neu1', art: 'existiert', fremd: { id: 'neu1' } }]);
  assert.equal(r.vorgaenge.anlegen.length, 0);
  assert.equal(r.vorgaenge.aendern.length, 1);
  assert.equal(r.vorgaenge.aendernPos.length, 1);
  assert.deepEqual(meineBehalten(aend, [{ coll: 'vorgaenge', eid: 't1', art: 'aendern', fremd: {} }]), aend);
});

test('wiederherstellen: fremd gelöschter, von mir geänderter Datensatz wird neu angelegt (an alter Position)', () => {
  const r = wiederherstellen(aend, [{ coll: 'vorgaenge', eid: 't1', art: 'geloescht', fremd: null }]);
  assert.deepEqual(r.vorgaenge.aendern.map((e) => e.vorher.id), ['t2']);
  assert.equal(r.vorgaenge.anlegen.length, 1);
  assert.equal(r.vorgaenge.anlegen[0].id, 't1');
  assert.equal(r.vorgaenge.anlegen[0].title, 'Meine Fassung');
  assert.equal(r.vorgaenge.anlegenPos.length, 1);
  assert.equal(r.vorgaenge.aendernPos.length, 1);
});

test('wiederherstellen: ein von beiden gelöschter Datensatz entfällt aus meinem Löschen', () => {
  const n = kl(BASIS);
  n.tasks = n.tasks.filter((t) => t.id !== 't2');
  const a = aenderungen(BASIS, n);
  assert.equal(a.vorgaenge.loeschen.length, 1);
  const r = wiederherstellen(a, [{ coll: 'vorgaenge', eid: 't2', art: 'geloescht', fremd: null }]);
  assert.equal(r.vorgaenge.loeschen.length, 0);
  assert.equal(r.vorgaenge.loeschenPos.length, 0);
});

test('Rundweg: Anna hat t1 geändert; «Ihre Fassung nehmen» + Rest senden ergibt Annas t1 und mein t2', () => {
  const fremd = { ...task(BASIS, 't1'), title: 'Von Anna' };
  const kon = [{ coll: 'vorgaenge', eid: 't1', art: 'aendern', fremd }];
  const stand = fremdUebernehmen(meins, kon);
  const rest = ohne(aend, kon);
  // Server-Stand = Annas t1 + Rest wird gesendet → Ergebnis
  const server = kl(BASIS); task(server, 't1').title = 'Von Anna';
  const ergebnis = anwenden(server, { ...rest }, { erzwingen: true }).state;
  assert.equal(task(ergebnis, 't1').title, 'Von Anna');
  assert.equal(task(ergebnis, 't2').title, 'Auch meine');
  assert.deepEqual(aenderungen(stand, ergebnis), aenderungen(ergebnis, ergebnis));
});

test('offeneSchluessel: anlegen, ändern und löschen aller Listen', () => {
  const n = kl(BASIS);
  task(n, 't1').title = 'x';
  n.tasks = n.tasks.filter((t) => t.id !== 't3');
  const k = offeneSchluessel([aenderungen(BASIS, n), null]);
  assert.ok(k.has('vorgaenge|t1') && k.has('vorgaenge|t3'));
  assert.ok(!k.has('vorgaenge|t2'));
  assert.equal(offeneSchluessel([]).size, 0);
});

test('uebernehmeOhneOffene: fremder Stand, aber Einträge mit offener eigener Änderung bleiben lokal', () => {
  const fremd = kl(BASIS);
  task(fremd, 't1').title = 'Fremd t1';
  task(fremd, 't2').title = 'Fremd t2';
  const lokal = kl(BASIS);
  task(lokal, 't1').title = 'Mein t1';
  const r = uebernehmeOhneOffene(lokal, fremd, new Set(['vorgaenge|t1']));
  assert.equal(task(r, 't1').title, 'Mein t1', 'offen → lokal bleibt');
  assert.equal(task(r, 't2').title, 'Fremd t2', 'nicht offen → fremd gilt');
  assert.equal(task(fremd, 't1').title, 'Fremd t1', 'Eingang unverändert');
  assert.equal(uebernehmeOhneOffene(lokal, fremd, new Set()), fremd, 'nichts offen → fremder Stand unverändert');
});

test('uebernehmeOhneOffene: lokal gelöschter, offener Eintrag bleibt gelöscht', () => {
  const lokal = kl(BASIS); lokal.tasks = lokal.tasks.filter((t) => t.id !== 't1');
  const r = uebernehmeOhneOffene(lokal, kl(BASIS), new Set(['vorgaenge|t1']));
  assert.equal(task(r, 't1'), undefined);
});
test('abgelaufenEntscheid: nur das ausdrückliche «login» meldet an; null (Escape/Klick daneben) und Rest = Kopie', () => {
  assert.equal(abgelaufenEntscheid('login'), 'login');
  assert.equal(abgelaufenEntscheid('kopie'), 'kopie');
  assert.equal(abgelaufenEntscheid(null), 'kopie');
  assert.equal(abgelaufenEntscheid(undefined), 'kopie');
  assert.equal(abgelaufenEntscheid(false), 'kopie');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
