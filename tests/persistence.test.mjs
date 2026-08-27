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
  gewerke: [{ id: 'g1', name: 'Bühne', sort: 0, slot: 0, art: 'gewerk' }],
  tasks: [{ id: 't1', gewerk: 'g1', title: 'Podest', start: '2026-07-13T08:00', end: '2026-07-13T12:00', milestone: false, progress: 0, status: 'geplant', crew: 4, notes: '', estimated: false, parent: null, ackCrit: false, ackConflictMin: null, punktTyp: 'act', anforderungen: '', material: '', kontakt: '', slot: null, abschnitt: 'show', fuer: null }],
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

console.log('\nShowablauf-Ebene');
test('ein Altplan ohne art besteht nur aus Gewerken', () => {
  const raw = plan();
  delete raw.gewerke[0].art;
  assert.equal(migrate(raw).gewerke[0].art, 'gewerk');
});
test('eine Bühne bleibt eine Bühne', () => {
  const raw = plan();
  raw.gewerke[0].art = 'buehne';
  assert.equal(migrate(raw).gewerke[0].art, 'buehne');
});
test('der Abschnitt überlebt Export → Import', () => {
  const raw = plan();
  raw.tasks[0].abschnitt = 'setup';
  assert.equal(deserialize(serialize(raw)).plan.tasks[0].abschnitt, 'setup');
});
test('erfundene Abschnitte gelten als Show', () => {
  const raw = plan();
  raw.tasks[0].abschnitt = 'quatsch';
  assert.equal(migrate(raw).tasks[0].abschnitt, 'show');
});

console.log('\nMigration v0.9.3 → der Soundcheck wird ein eigener Zeiteintrag');
test('aus einer Soundcheck-Zeit wird ein Setup-Eintrag, dem Act zugeordnet', () => {
  // Als Feld tauchte er in keiner Zeitachse auf; zwei sich überschneidende
  // Soundchecks sah niemand.
  const raw = plan();
  raw.tasks[0].soundcheck = '2026-07-13T09:30';
  const m = migrate(raw);
  assert.equal(m.tasks.length, 2);
  const sc = m.tasks.find((t) => t.id !== 't1');
  assert.equal(sc.title, 'Soundcheck Podest');
  assert.equal(sc.start, '2026-07-13T09:30');
  assert.equal(sc.end, '2026-07-13T10:30', '60 min als Vorgabe');
  assert.equal(sc.abschnitt, 'setup');
  assert.equal(sc.fuer, 't1');
  assert.equal(sc.gewerk, 't1' && m.tasks[0].gewerk, 'auf derselben Bühne');
  assert.equal('soundcheck' in m.tasks[0], false, 'das Feld ist weg');
});
test('ein ZWEITER Ladevorgang erzeugt KEINEN zweiten Soundcheck', () => {
  // migrate() läuft bei jedem Laden. Eine Migration, die Vorgänge ERZEUGT, legt
  // sonst bei jedem Öffnen einen weiteren an.
  const raw = plan();
  raw.tasks[0].soundcheck = '2026-07-13T09:30';
  const einmal = migrate(raw);
  assert.equal(migrate(einmal).tasks.length, 2);
  assert.deepEqual(migrate(einmal), einmal);
});
test('ohne Soundcheck-Zeit entsteht nichts', () => {
  assert.equal(migrate(plan()).tasks.length, 1);
});

console.log('\nMigration v0.9.1 → der Abschnitt wandert von der Bühne zum Eintrag');
test('eine Setup-Bühne gibt ihren Abschnitt an ihre Einträge weiter', () => {
  // Bis v0.9.1 trug die BÜHNE den Abschnitt. Es gibt aber EINE Bühne mit zwei
  // Abläufen, nicht zwei Bühnen.
  const raw = plan();
  raw.gewerke[0].art = 'buehne';
  raw.gewerke[0].abschnitt = 'setup';
  delete raw.tasks[0].abschnitt;          // so sah ein v0.9.1-Plan aus
  const m = migrate(raw);
  assert.equal(m.tasks[0].abschnitt, 'setup', 'der Eintrag hat den Abschnitt geerbt');
  assert.equal('abschnitt' in m.gewerke[0], false, 'am Gewerk ist er weg');
});
test('eine Show-Bühne aus v0.9.1 bleibt Show', () => {
  const raw = plan();
  raw.gewerke[0].art = 'buehne';
  raw.gewerke[0].abschnitt = 'show';
  delete raw.tasks[0].abschnitt;
  assert.equal(migrate(raw).tasks[0].abschnitt, 'show');
});
test('die Wanderung ist idempotent — ein zweiter Lauf ändert nichts', () => {
  // migrate() läuft bei JEDEM Laden. Ein Durchlauf, der beim zweiten Mal etwas
  // anderes tut, verschiebt Daten hinter dem Rücken des Nutzers.
  const raw = plan();
  raw.gewerke[0].art = 'buehne';
  raw.gewerke[0].abschnitt = 'setup';
  delete raw.tasks[0].abschnitt;
  const einmal = migrate(raw);
  assert.deepEqual(migrate(einmal), einmal);
  assert.equal(migrate(einmal).tasks[0].abschnitt, 'setup');
});
test('ein bereits gesetzter Eintrags-Abschnitt schlägt die alte Bühne', () => {
  const raw = plan();
  raw.gewerke[0].art = 'buehne';
  raw.gewerke[0].abschnitt = 'setup';
  raw.tasks[0].abschnitt = 'show';
  assert.equal(migrate(raw).tasks[0].abschnitt, 'show');
});
test('erfundene Arten fallen auf Gewerk zurück, statt unsichtbar zu werden', () => {
  const raw = plan();
  raw.gewerke[0].art = 'quatsch';
  assert.equal(migrate(raw).gewerke[0].art, 'gewerk');
});
test('Vorgänge ohne die Showablauf-Felder bekommen leere', () => {
  const raw = plan();
  for (const f of ['punktTyp', 'anforderungen', 'material', 'kontakt', 'slot', 'abschnitt']) delete raw.tasks[0][f];
  const t = migrate(raw).tasks[0];
  assert.equal(t.punktTyp, 'act');
  assert.equal(t.anforderungen, '');
  assert.equal(t.material, '');
  assert.equal(t.kontakt, '');
  assert.equal(t.fuer, null);
  assert.equal(t.slot, null, 'ohne eigenen Platz erbt der Punkt die Farbe seiner Bühne');
  assert.equal(t.abschnitt, 'show');
});
test('der eigene Farbplatz überlebt Export → Import', () => {
  const raw = plan();
  raw.tasks[0].slot = 13;                  // roter Ton mit Schraffur
  assert.equal(deserialize(serialize(raw)).plan.tasks[0].slot, 13);
});
test('Anforderungen und Material überleben Export → Import', () => {
  const raw = plan();
  Object.assign(raw.tasks[0], {
    punktTyp: 'changeover', anforderungen: '2× Wedge, Drehleiter',
    material: '1 Riser 2×1 m', kontakt: 'Max Mustermann', slot: 13,
  });
  const back = deserialize(serialize(raw));
  assert.deepEqual(back.plan.tasks[0], raw.tasks[0]);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
