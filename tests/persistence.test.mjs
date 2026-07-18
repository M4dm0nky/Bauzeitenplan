import { createRepo, serialize, deserialize, migrate, SCHEMA_VERSION } from '../js/persistence.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

// Minimaler localStorage-Ersatz für Node. Kein Mock des Prüflings, sondern der
// Browser-Umgebung — das Verhalten von persistence.js bleibt echt.
const fakeStorage = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i],
    get length() { return m.size; },
    _dump: () => Object.fromEntries(m),
  };
};

const plan = (name = 'Test') => ({
  project: { id: 'p1', name, venue: 'Halle', start: '2026-07-13T00:00', end: '2026-07-20T00:00', timezone: 'Europe/Berlin' },
  gewerke: [{ id: 'g1', name: 'Bühne', sort: 0, slot: 0 }],
  tasks: [{ id: 't1', gewerk: 'g1', title: 'Podest', start: '2026-07-13T08:00', end: '2026-07-13T12:00', milestone: false, progress: 0, status: 'geplant', crew: 4, notes: '', estimated: false, parent: null }],
  deps: [],
});

console.log('\nSpeichern & Laden');
test('gespeichertes Projekt lässt sich identisch zurücklesen', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  assert.deepEqual(r.load('p1'), plan());
});
test('unbekanntes Projekt liefert null statt zu werfen', () => {
  assert.equal(createRepo(fakeStorage()).load('gibtsnicht'), null);
});
test('Speichern trägt das Projekt in den Index ein', () => {
  const r = createRepo(fakeStorage());
  r.save(plan('Nordlicht'));
  const list = r.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'p1');
  assert.equal(list[0].name, 'Nordlicht');
});
test('erneutes Speichern legt keinen zweiten Indexeintrag an', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  r.save(plan('Umbenannt'));
  assert.equal(r.list().length, 1);
  assert.equal(r.list()[0].name, 'Umbenannt');
});
test('Index merkt sich den Änderungszeitpunkt', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  assert.ok(r.list()[0].modified, 'kein Zeitstempel');
});
test('Liste ist nach zuletzt geändert sortiert', () => {
  const s = fakeStorage();
  const r = createRepo(s);
  const a = plan('Alt'); a.project.id = 'pa';
  const b = plan('Neu'); b.project.id = 'pb';
  r.save(a);
  // Zeitstempel von a künstlich zurückdatieren
  const idx = JSON.parse(s.getItem('bzp_projects'));
  idx[0].modified = '2020-01-01T00:00:00.000Z';
  s.setItem('bzp_projects', JSON.stringify(idx));
  r.save(b);
  assert.deepEqual(r.list().map((x) => x.name), ['Neu', 'Alt']);
});
test('Löschen entfernt Projekt und Indexeintrag', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  r.remove('p1');
  assert.equal(r.load('p1'), null);
  assert.equal(r.list().length, 0);
});
test('mehrere Projekte stören sich nicht', () => {
  const r = createRepo(fakeStorage());
  const a = plan('A'); a.project.id = 'pa';
  const b = plan('B'); b.project.id = 'pb';
  r.save(a); r.save(b);
  assert.equal(r.load('pa').project.name, 'A');
  assert.equal(r.load('pb').project.name, 'B');
  assert.equal(r.list().length, 2);
});
test('Löschen eines Projekts lässt die anderen unberührt', () => {
  const r = createRepo(fakeStorage());
  const a = plan('A'); a.project.id = 'pa';
  const b = plan('B'); b.project.id = 'pb';
  r.save(a); r.save(b);
  r.remove('pa');
  assert.equal(r.load('pb').project.name, 'B');
});
test('zuletzt geöffnetes Projekt wird gemerkt', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  r.setActive('p1');
  assert.equal(r.getActive(), 'p1');
});
test('gelöschtes Projekt bleibt nicht als aktiv stehen', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  r.setActive('p1');
  r.remove('p1');
  assert.equal(r.getActive(), null);
});

console.log('\nRobustheit — kaputte Daten dürfen die App nicht töten');
test('beschädigtes JSON liefert null statt zu werfen', () => {
  const s = fakeStorage();
  s.setItem('bzp_p_p1', '{kaputt');
  assert.equal(createRepo(s).load('p1'), null);
});
test('beschädigter Index liefert eine leere Liste statt zu werfen', () => {
  const s = fakeStorage();
  s.setItem('bzp_projects', 'nicht mal json');
  assert.deepEqual(createRepo(s).list(), []);
});
test('volles localStorage wird als Fehler gemeldet, nicht verschluckt', () => {
  // Ohne Rückmeldung glaubte man, es sei gesichert — und verlöre alles.
  const s = fakeStorage();
  s.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  const r = createRepo(s);
  const res = r.save(plan());
  assert.equal(res.ok, false);
  assert.match(res.error, /Speicher/i);
});
test('erfolgreiches Speichern meldet ok', () => {
  assert.equal(createRepo(fakeStorage()).save(plan()).ok, true);
});

console.log('\nExport & Import');
test('Export enthält Schema-Version und Plan', () => {
  const j = JSON.parse(serialize(plan()));
  assert.equal(j.schema, SCHEMA_VERSION);
  assert.equal(j.project.name, 'Test');
});
test('Export → Import ergibt denselben Plan', () => {
  const back = deserialize(serialize(plan()));
  assert.deepEqual(back.plan, plan());
});
test('Import von Unsinn meldet einen Fehler', () => {
  const r = deserialize('kein json');
  assert.equal(r.ok, false);
});
test('Import ohne Projekt meldet einen Fehler', () => {
  const r = deserialize(JSON.stringify({ schema: SCHEMA_VERSION, tasks: [] }));
  assert.equal(r.ok, false);
});
test('Import aus der Zukunft wird abgelehnt statt falsch gelesen', () => {
  const j = JSON.parse(serialize(plan()));
  j.schema = SCHEMA_VERSION + 5;
  const r = deserialize(JSON.stringify(j));
  assert.equal(r.ok, false);
  assert.match(r.error, /neuer/i);
});
test('Import repariert fehlende Felder statt zu scheitern', () => {
  const j = JSON.parse(serialize(plan()));
  delete j.deps;
  delete j.tasks[0].notes;
  const r = deserialize(JSON.stringify(j));
  assert.notEqual(r.ok, false);
  assert.deepEqual(r.plan.deps, []);
});
test('Import vergibt eine neue id, wenn gewünscht', () => {
  // Sonst überschriebe ein importierter Plan ein bestehendes gleichnamiges Projekt.
  const r = deserialize(serialize(plan()), { newId: true });
  assert.notEqual(r.plan.project.id, 'p1');
});

test('geschätzte Dauer überlebt Export und Import', () => {
  // Sonst wüsste nach einem Import niemand mehr, welche Zahl geraten ist.
  const raw = plan();
  raw.tasks[0].estimated = true;
  const back = deserialize(serialize(raw));
  assert.equal(back.plan.tasks[0].estimated, true);
});

console.log('\nMigration');
test('Plan ohne Schema-Version wird als Version 1 gelesen', () => {
  const raw = plan();
  const m = migrate({ ...raw });
  assert.equal(m.project.name, 'Test');
});
test('Vorgang ohne estimated-Feld gilt als nicht geschätzt', () => {
  const raw = plan();
  delete raw.tasks[0].estimated;
  assert.equal(migrate(raw).tasks[0].estimated, false);
});
test('Gewerk ohne Farbplatz bekommt einen', () => {
  const raw = plan();
  delete raw.gewerke[0].slot;
  assert.equal(migrate(raw).gewerke[0].slot, 0);
});
test('Migration ist idempotent', () => {
  const once = migrate(plan());
  assert.deepEqual(migrate(once), once);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
