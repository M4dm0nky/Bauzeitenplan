import { createRepo, istServerKopie, serialize, deserialize, migrate, SCHEMA_VERSION } from '../js/persistence.js';
import { createStore } from '../js/store.js';
import { spanFehler } from '../js/schedule.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('async-Test im synchronen Helfer — nicht erlaubt'); pass++; console.log('  ✓ ' + name); }
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
  project: { id: 'p1', name, venue: 'Halle', start: '2026-07-13T00:00', end: '2026-07-20T00:00', timezone: 'Europe/Berlin', punktTypen: [], abschnitte: [] },
  gewerke: [{ id: 'g1', name: 'Bühne', sort: 0, slot: 0, art: 'gewerk' }],
  tasks: [{ id: 't1', gewerk: 'g1', title: 'Podest', start: '2026-07-13T08:00', end: '2026-07-13T12:00', milestone: false, progress: 0, status: 'geplant', crew: 4, notes: '', estimated: false, parent: null, ackConflictMin: null, punktTyp: 'act', anforderungen: '', material: '', kontakt: '', slot: null, abschnitt: 'show', fuer: null }],
  deps: [],
});

// `plan()` trägt die alte blanke Zahl `crew` — bewusst, sie steht für Pläne aus
// der Zeit vor den Ressourcen. `migrate()` wandelt sie beim Laden in eine
// Ressourcen-Zuweisung um (siehe persistence.js). Wer den zurückgelesenen
// Stand gegen die Eingabe vergleicht, muss also gegen die MIGRIERTE Form
// vergleichen, nicht gegen `plan()` selbst.
const migriert = (p) => {
  const q = JSON.parse(JSON.stringify(p));
  q.project.ressourcen = [{ id: 'crew', label: 'Crew', kind: 'personal' }];
  q.phases = [];   // migrate legt die Liste immer an
  Object.assign(q.project, { adresse: '', anfahrt: '', kunde: '', kontakte: [], eingerichtet: true });   // ebenso die Projektangaben
  for (const t of q.tasks) {
    if (!t.crew) continue;
    t.res = [{ rid: 'crew', n: t.crew, von: null, bis: null }];
    t.bereitstellung = false;
    delete t.crew;
  }
  return q;
};

console.log('\nSpeichern & Laden');
test('gespeichertes Projekt lässt sich identisch zurücklesen', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  assert.deepEqual(r.load('p1'), migriert(plan()));
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
test('vergessenRemote: remoteSha null, dirty unverändert (Abgleich lädt wieder hoch)', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  r.markSynced('p1', 's1');
  r.vergessenRemote('p1');
  assert.deepEqual(r.syncListe(), [{ id: 'p1', remoteSha: null, dirty: false }]);
});

test('vergessenRemote: unbekannte id → ok false, Index unverändert', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  assert.equal(r.vergessenRemote('gibtsnicht').ok, false);
  assert.equal(r.vergessenRemote('p1').ok, true);
  assert.equal(r.syncListe().length, 1);
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

console.log('\nServer-Kopie oder alter lokaler Plan');
test('ein Plan aus der alten Fassung (Index ohne Marke) ist ein alter Plan, keine Server-Kopie', () => {
  const sp = fakeStorage();
  // so legte die bisherige Fassung ihn ab: Plan + Indexeintrag mit Sync-Feldern, ohne `server`
  const alt = plan('Alt'); alt.project.id = 'alt1';
  sp.setItem('bzp_p_alt1', JSON.stringify(alt));
  sp.setItem('bzp_projects', JSON.stringify([{ id: 'alt1', name: 'Alt', venue: '', modified: '2026-01-01T00:00:00Z', remoteSha: null, dirty: false }]));
  const r = createRepo(sp);
  assert.deepEqual(r.listAlt().map((x) => x.id), ['alt1']);
  assert.deepEqual(r.listServer(), []);
});
test('save mit server:true markiert die Kopie, ein späteres Speichern ohne Option behält die Marke', () => {
  const r = createRepo(fakeStorage());
  r.save(plan('S'), { server: true });
  assert.equal(istServerKopie(r.list()[0]), true);
  r.save({ ...plan('S'), tasks: [] });
  assert.equal(r.listServer().length, 1);
  assert.equal(r.listAlt().length, 0);
});
test('alte und Server-Pläne bleiben getrennt; remove der Server-Kopien lässt den alten Plan stehen', () => {
  const r = createRepo(fakeStorage());
  const a = plan('Alt'); a.project.id = 'alt';
  const s = plan('Srv'); s.project.id = 'srv';
  r.save(a); r.save(s, { server: true });
  for (const x of r.listServer()) r.remove(x.id);
  assert.deepEqual(r.list().map((x) => x.id), ['alt']);
  assert.ok(r.load('alt'));
});
test('istServerKopie: nur true zählt', () => {
  assert.equal(istServerKopie(undefined), false);
  assert.equal(istServerKopie({ id: 'x' }), false);
  assert.equal(istServerKopie({ id: 'x', server: 'ja' }), false);
  assert.equal(istServerKopie({ id: 'x', server: true }), true);
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
test('Bedarfsstatus (status, notiz, bestaetigtAm) reist durch Export → Import', () => {
  const p = plan();
  p.tasks[0].res = [{ rid: 'p-runner', n: 2, von: null, bis: null, status: 'bestaetigt', notiz: 'Mail', bestaetigtAm: '2026-07-01T10:00:00.000Z' }];
  const z = deserialize(serialize(p)).plan.tasks[0].res[0];
  assert.deepEqual([z.status, z.notiz, z.bestaetigtAm], ['bestaetigt', 'Mail', '2026-07-01T10:00:00.000Z']);
});
test('Export → Import ergibt denselben Plan', () => {
  const back = deserialize(serialize(plan()));
  assert.deepEqual(back.plan, migriert(plan()));
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
  assert.deepEqual(back.plan.tasks[0], migriert(raw).tasks[0]);
});

test('Altplan mit ackCrit lädt ohne Fehler, das Feld entfällt', () => {
  const raw = plan();
  raw.tasks[0].ackCrit = true;
  const r = deserialize(serialize(raw));
  assert.equal(r.ok, true);
  assert.equal('ackCrit' in r.plan.tasks[0], false);
});

test('eigene Eintragsarten überleben Export → Import', () => {
  // Der ganze Grund, warum sie im Plan stehen und nicht im Browser: ein Eintrag
  // trägt nur `punktTyp: "linecheck"`. Ohne die Namensliste in derselben Datei
  // sähe der Empfänger genau das statt «Line-Check».
  const raw = plan();
  raw.project.punktTypen = [{ id: 'linecheck', label: 'Line-Check', kompakt: true }];
  raw.tasks[0].punktTyp = 'linecheck';
  const back = deserialize(serialize(raw));
  assert.deepEqual(back.plan.project.punktTypen, raw.project.punktTypen);
  assert.equal(back.plan.tasks[0].punktTyp, 'linecheck');
});

test('eigene Abschnitte überleben Export → Import', () => {
  const raw = plan();
  raw.project.abschnitte = [{ id: 'loadin', label: 'Load-in' }];
  raw.tasks[0].abschnitt = 'loadin';
  const back = deserialize(serialize(raw));
  assert.deepEqual(back.plan.project.abschnitte, raw.project.abschnitte);
  assert.equal(back.plan.tasks[0].abschnitt, 'loadin',
    'der eigene Abschnitt darf beim Import nicht auf «show» normalisiert werden');
});

test('ein Abschnitt, den der Plan nicht kennt, fällt auf «show» zurück', () => {
  // Die Gegenrichtung zum Test darüber: eine tote Kennung darf keine Waise
  // erzeugen, die in keiner Ansicht auftaucht. Bekannt heißt: eingebaut oder in
  // project.abschnitte.
  const roh = plan();
  roh.tasks[0].abschnitt = 'gibtsnichtmehr';
  assert.equal(migrate(roh).tasks[0].abschnitt, 'show');
});

test('ein Altplan bekommt eine leere Abschnittsliste, keine fehlende', () => {
  const roh = plan();
  delete roh.project.abschnitte;
  assert.deepEqual(migrate(roh).project.abschnitte, []);
});

test('ein Altplan bekommt eine leere Artenliste, keine fehlende', () => {
  // Ein Feld, das mal da ist und mal nicht, ist beim Diff zweier Sicherungen
  // Rauschen — dieselbe Begründung wie bei den übrigen Showablauf-Feldern.
  const roh = plan();
  delete roh.project.punktTypen;
  assert.deepEqual(migrate(roh).project.punktTypen, []);
});

// ── Sync-Metadaten im Index ────────────────────────────────────────────────
test('save ohne Option: dirty true, remoteSha bleibt erhalten', () => {
  const r = createRepo(fakeStorage());
  r.save(plan(), { remoteSha: 'abc' });
  r.save(plan('Neu'));
  assert.deepEqual(r.syncInfo('p1'), { remoteSha: 'abc', dirty: true });
});
test('save gleicher Inhalt nach markSynced → dirty bleibt false', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  r.markSynced('p1', 's1');
  const vorher = r.list()[0];
  r.save(plan());
  assert.deepEqual(r.syncInfo('p1'), { remoteSha: 's1', dirty: false });
  assert.equal(r.list()[0].modified, vorher.modified);
});
test('save geänderter Inhalt → dirty true', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  r.markSynced('p1', 's1');
  r.save(plan('Anders'));
  assert.deepEqual(r.syncInfo('p1'), { remoteSha: 's1', dirty: true });
});
test('neues Projekt (nicht im Speicher) → dirty true', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  assert.equal(r.syncInfo('p1').dirty, true);
});
test('save mit remoteSha: dirty false', () => {
  const r = createRepo(fakeStorage());
  r.save(plan());
  r.save(plan(), { remoteSha: 'x1' });
  assert.deepEqual(r.syncInfo('p1'), { remoteSha: 'x1', dirty: false });
});
test('markSynced: dirty false, sha gesetzt, name/modified unveraendert', () => {
  const r = createRepo(fakeStorage());
  r.save(plan('Eins'));
  const vorher = r.list()[0];
  r.markSynced('p1', 's2');
  const nachher = r.list()[0];
  assert.equal(nachher.name, vorher.name);
  assert.equal(nachher.modified, vorher.modified);
  assert.deepEqual(r.syncInfo('p1'), { remoteSha: 's2', dirty: false });
});
test('markSynced auf unbekannte id: kein Eintrag', () => {
  const r = createRepo(fakeStorage());
  r.markSynced('nix', 's');
  assert.deepEqual(r.list(), []);
});
test('Altindex ohne Felder: syncInfo {null, dirty true}', () => {
  const s = fakeStorage();
  s.setItem('bzp_projects', JSON.stringify([{ id: 'p1', name: 'A', venue: '', modified: '2026-01-01T00:00:00.000Z' }]));
  const r = createRepo(s);
  assert.deepEqual(r.syncInfo('p1'), { remoteSha: null, dirty: true });
  assert.deepEqual(r.syncListe(), [{ id: 'p1', remoteSha: null, dirty: true }]);
});
test('syncInfo unbekannte id: {null, dirty true}', () => {
  assert.deepEqual(createRepo(fakeStorage()).syncInfo('x'), { remoteSha: null, dirty: true });
});
test('Metadaten nie im Plan: weder gespeichert noch serialisiert', () => {
  const s = fakeStorage();
  const r = createRepo(s);
  r.save(plan(), { remoteSha: 'abc' });
  r.markSynced('p1', 'def');
  const roh = s.getItem('bzp_p_p1');
  assert.ok(!/remoteSha|dirty/.test(roh));
  assert.ok(!/remoteSha|dirty/.test(serialize(r.load('p1'))));
});

// ── Speichern und Import ehrlich (#3, #4) ───────────────────────────────────
test('save meldet Fehler, wenn der Index nicht geschrieben werden kann', () => {
  const s = fakeStorage();
  const roh = s.setItem;
  // Quota nur für den Index: der Plan liegt, aber dirty/sha wären veraltet.
  s.setItem = (k, v) => {
    if (k === 'bzp_projects') { const e = new Error('voll'); e.name = 'QuotaExceededError'; throw e; }
    roh(k, v);
  };
  const r = createRepo(s).save(plan());
  assert.equal(r.ok, false);
  assert.match(r.error, /Speicher/);
});
const textMit = (mut) => {
  const p = plan();
  p.tasks.push({ ...p.tasks[0], id: 't2', title: 'Zweiter' }, { ...p.tasks[0], id: 't3', title: 'Dritter' });
  mut(p);
  return JSON.stringify({ schema: 1, ...p });
};
test('deserialize lehnt kaputte Zeit ab und nennt den Vorgang', () => {
  const r = deserialize(textMit((p) => { p.tasks[1].start = 'x'; p.tasks[1].title = 'Kaputt'; }));
  assert.equal(r.ok, false);
  assert.match(r.error, /Kaputt/);
});
test('deserialize lehnt Ende vor Start ab (kein Meilenstein)', () => {
  const r = deserialize(textMit((p) => { p.tasks[1].end = '2026-07-13T07:00'; p.tasks[1].title = 'Rueckwaerts'; }));
  assert.equal(r.ok, false);
  assert.match(r.error, /Rueckwaerts/);
});
test('deserialize akzeptiert Meilenstein mit start === end', () => {
  const r = deserialize(textMit((p) => { Object.assign(p.tasks[1], { milestone: true, end: p.tasks[1].start }); }));
  assert.equal(r.ok, true);
});
test('deserialize lehnt doppelte Task-ids ab', () => {
  const r = deserialize(textMit((p) => { p.tasks[2].id = 't2'; }));
  assert.equal(r.ok, false);
  assert.match(r.error, /t2/);
});
test('deserialize entfernt Verknüpfungen auf unbekannte Vorgänge', () => {
  const r = deserialize(textMit((p) => {
    p.deps = [{ id: 'd1', from: 't1', to: 't2', type: 'FS', lag: 0 }, { id: 'd2', from: 't1', to: 'weg', type: 'FS', lag: 0 }, { id: 'd3', from: 'weg', to: 't3', type: 'FS', lag: 0 }];
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.plan.deps.map((d) => d.id), ['d1']);
});
test('deserialize lehnt eine halb fehlende Zeit ab (nur das Paar null/null ist «ohne Termin»)', () => {
  const a = deserialize(textMit((p) => { Object.assign(p.tasks[1], { start: null, title: 'OhneStart' }); }));
  assert.equal(a.ok, false);
  assert.match(a.error, /OhneStart/);
  const b = deserialize(textMit((p) => { p.tasks[1].end = ''; p.tasks[1].title = 'OhneEnde'; }));
  assert.equal(b.ok, false);
  assert.match(b.error, /OhneEnde/);
});
test('Beispielpläne (tools/fixtures) bestehen die Prüfung', () => {
  for (const f of ['klassentreffen-festival.json', 'amk-singleshow.json']) {
    const r = deserialize(readFileSync(new URL('../tools/fixtures/' + f, import.meta.url), 'utf8'));
    assert.equal(r.ok, true, f + ': ' + r.error);
  }
});

// Rundlauf: was der Store zulässt, muss sich exportieren UND wieder importieren
// lassen. Sonst scheitert der Sync auf dem zweiten Gerät an einem Plan, den das
// erste Gerät problemlos gebaut hat.
test('Rundlauf: Sammelvorgang mit Meilenstein-Kind lässt sich zurückimportieren', () => {
  const st = createStore(plan());
  const p = st.apply({ type: 'addTask', task: { gewerk: 'g1', title: 'Sammel', start: '2026-07-14T08:00', end: '2026-07-14T09:00' } });
  const k = st.apply({ type: 'addTask', task: { gewerk: 'g1', title: 'Raute', start: '2026-07-14T10:00', end: '2026-07-14T10:00', milestone: true, parent: p.id } });
  assert.ok(p.ok !== false && k.ok !== false, 'Store muss beides zulassen');
  const r = deserialize(serialize(st.state));
  assert.equal(r.ok, true, r.error);
});

// Eine Regel, zwei Aufrufer (store.checkSpan, persistence.inhaltFehler): die
// gemeinsame Fallliste hängt an der einen Funktion.
test('spanFehler: gemeinsame Fallliste', () => {
  const F = [
    [['2026-07-13T08:00', '2026-07-13T09:00', {}], null],
    [['2026-07-13T09:00', '2026-07-13T08:00', {}], 'Das Ende muss nach dem Start liegen.'],
    [['2026-07-13T08:00', '2026-07-13T08:00', {}], 'Das Ende muss nach dem Start liegen.'],
    [['2026-07-13T08:00', '2026-07-13T08:00', { milestone: true }], null],
    [['2026-07-13T08:00', '2026-07-13T09:00', { milestone: true }], 'Ein Meilenstein hat keine Dauer — Start und Ende müssen gleich sein.'],
    [['2026-07-13T08:00', '2026-07-13T08:00', { sammel: true }], null],
    [['2026-07-13T09:00', '2026-07-13T08:00', { sammel: true }], 'Das Ende muss nach dem Start liegen.'],
    [[null, '2026-07-13T08:00', {}], 'Start und Ende müssen gesetzt sein.'],
    [['x', '2026-07-13T08:00', {}], 'Ungültiges Datum.'],
  ];
  for (const [[a, b, o], erwartet] of F) assert.equal(spanFehler(a, b, o), erwartet, `${a} ${b} ${JSON.stringify(o)}`);
});

test('createRepo übersteht einen Speicher, der bei jedem Zugriff wirft', () => {
  const wirf = () => { throw new DOMException('gesperrt', 'SecurityError'); };
  const r = createRepo({ getItem: wirf, setItem: wirf, removeItem: wirf });
  assert.deepEqual(r.list(), []);
  assert.equal(r.getActive(), null);
  assert.equal(r.load('x'), null);
  assert.equal(r.save({ project: { id: 'x', name: 'X' }, tasks: [], deps: [], gewerke: [] }).ok, false);
  assert.doesNotThrow(() => r.remove('x'));
  assert.doesNotThrow(() => r.setActive('x'));
});

test('gesperrter Speicher (SecurityError) wird verständlich gemeldet', () => {
  const s = new Map();
  const st = { getItem: (k) => s.get(k) ?? null, setItem: () => { throw new DOMException('The operation is insecure.', 'SecurityError'); }, removeItem: (k) => s.delete(k) };
  const r = createRepo(st).save({ project: { id: 'x', name: 'X' }, tasks: [], deps: [], gewerke: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /Speicher gesperrt/);
  assert.match(r.error, /exportieren/i);
  assert.doesNotMatch(r.error, /insecure/);
});

test('remove() meldet ok bzw. den Schreibfehler des Index', () => {
  const s = new Map();
  let sperre = false;
  const st = {
    getItem: (k) => s.get(k) ?? null,
    setItem: (k, v) => { if (sperre) { const e = new Error('voll'); e.name = 'QuotaExceededError'; throw e; } s.set(k, v); },
    removeItem: (k) => s.delete(k),
  };
  const repo = createRepo(st);
  repo.save({ project: { id: 'x', name: 'X' }, tasks: [], deps: [], gewerke: [] });
  repo.save({ project: { id: 'y', name: 'Y' }, tasks: [], deps: [], gewerke: [] });
  assert.deepEqual(repo.remove('x'), { ok: true });
  sperre = true;
  const r = repo.remove('y');
  assert.equal(r.ok, false);
  assert.match(r.error, /Speicher/);
});

console.log('\nOhne Termin');
test('Rundlauf: ein Vorgang ohne Termin übersteht serialize → deserialize unverändert', () => {
  const p = plan();
  p.tasks.push({ ...p.tasks[0], id: 't2', title: 'Rigging', start: null, end: null });
  const back = deserialize(serialize(p));
  assert.equal(back.ok, true);
  const t2 = back.plan.tasks.find((t) => t.id === 't2');
  assert.equal(t2.start, null);
  assert.equal(t2.end, null);
});
test('Import: ein einzelnes null in start/end wird abgelehnt', () => {
  const p = plan();
  p.tasks[0].end = null;
  const r = deserialize(JSON.stringify({ ...JSON.parse(serialize(plan())), tasks: p.tasks }));
  assert.equal(r.ok, false);
});
test('Meilenstein ohne Termin wird importiert', () => {
  const p = plan();
  p.tasks.push({ ...p.tasks[0], id: 't3', milestone: true, start: null, end: null });
  assert.equal(deserialize(serialize(p)).ok, true);
});

test('migrate: fehlende start/end-Schlüssel werden zu null (nicht undefined)', () => {
  const p = plan();
  delete p.tasks[0].start; delete p.tasks[0].end;
  const m = migrate(p);
  assert.equal(m.tasks[0].start, null);
  assert.equal(m.tasks[0].end, null);
});
test('Import behält Phasen (Altform ohne art/id wird migriert)', () => {
  const p = plan();
  p.phases = [{ name: 'Aufbau', start: '2026-09-14T06:00', end: '2026-09-16T06:00' }];
  const back = deserialize(serialize(p));
  assert.equal(back.ok, true);
  assert.equal(back.plan.phases.length, 1);
  assert.equal(back.plan.phases[0].art, 'aufbau');
  assert.equal(back.plan.phases[0].start, p.phases[0].start);
});
test('Altphase mit Ende <= Start sperrt den Import nicht: sie entfällt und wird gemeldet', () => {
  const p = plan();
  p.phases = [
    { name: 'Aufbau', start: '2026-09-14T06:00', end: '2026-09-16T06:00' },
    { name: 'Show', start: '2026-09-18T20:00', end: '2026-09-18T20:00' },
    { name: 'Abbau', start: '2026-09-20T12:00', end: '2026-09-19T12:00' },
  ];
  const back = deserialize(serialize(p));
  assert.equal(back.ok, true, back.error);
  assert.deepEqual(back.plan.phases.map((x) => x.name), ['Aufbau']);
  assert.match(back.hinweis, /2 Phasen/);
  assert.match(back.hinweis, /Show/);
  assert.equal(migrate(p).phases.length, 1);
});

// ── Import: kaputte Form, Ringe, Waisen, project.now ──────────────────────────
const lade = (mut) => { const p = plan(); mut(p); return deserialize(JSON.stringify({ schema: 1, ...p })); };
const zweiTasks = (p) => {
  p.tasks.push({ ...p.tasks[0], id: 't2', title: 'Licht' });
};

test('deserialize: falsche Form liefert ok:false statt einer Ausnahme', () => {
  for (const mut of [(p) => { p.tasks = 'abc'; }, (p) => { p.tasks = [null]; }, (p) => { p.project = 'x'; },
    (p) => { p.gewerke = {}; }, (p) => { p.deps = 5; }, (p) => { p.phases = 'x'; }]) {
    const r = lade(mut);
    assert.equal(r.ok, false);
    assert.match(r.error, /^Die Datei ist beschädigt: /);
  }
});

test('deserialize: Ring in den Verknüpfungen nennt beide Titel', () => {
  const r = lade((p) => { zweiTasks(p); p.deps = [
    { id: 'd1', from: 't1', to: 't2', type: 'FS', lag: 0 }, { id: 'd2', from: 't2', to: 't1', type: 'FS', lag: 0 }]; });
  assert.equal(r.ok, false);
  assert.match(r.error, /Ring in den Verknüpfungen/);
  assert.match(r.error, /Podest/); assert.match(r.error, /Licht/);
});

test('deserialize: unbekanntes Gewerk wird abgelehnt, «projekt» bleibt gültig', () => {
  const r = lade((p) => { p.tasks[0].gewerk = 'nix'; });
  assert.equal(r.ok, false);
  assert.match(r.error, /Vorgang «Podest»: Unbekanntes Gewerk nix\./);
  assert.equal(lade((p) => { p.tasks[0].gewerk = 'projekt'; }).ok, true);
});

test('deserialize: totes parent und parent-Kette werden abgelehnt', () => {
  const tot = lade((p) => { p.tasks[0].parent = 'weg'; });
  assert.equal(tot.ok, false);
  assert.match(tot.error, /Vorgang «Podest»: Übergeordneter Vorgang nicht gefunden\./);
  const kette = lade((p) => {
    zweiTasks(p); p.tasks.push({ ...p.tasks[0], id: 't3', title: 'Ton' });
    p.tasks[0].parent = null; p.tasks[1].parent = 't1'; p.tasks[2].parent = 't2';
  });
  assert.equal(kette.ok, false);
  assert.match(kette.error, /nur eine Ebene/);
  assert.equal(lade((p) => { zweiTasks(p); p.tasks[1].parent = 't1'; }).ok, true);
});

test('migrate: project.now (Demo-Uhr) fällt weg', () => {
  const p = plan(); p.project.now = '2026-08-05T12:00';
  assert.equal('now' in migrate(p).project, false);
});

test('migrate ergänzt fehlende Projektangaben', () => {
  const m = migrate(plan()).project;
  assert.equal(m.adresse, ''); assert.equal(m.anfahrt, ''); assert.equal(m.kunde, '');
  assert.deepEqual(m.kontakte, []);
  assert.equal(m.eingerichtet, true);
});
test('migrate lässt vorhandene Projektangaben stehen', () => {
  const k = [{ id: 'k1', name: 'Ann', rolle: 'PL', tel: '0171' }];
  const p = plan(); Object.assign(p.project, { eingerichtet: false, kontakte: k, adresse: 'A', anfahrt: 'B', kunde: 'C' });
  const m = migrate(p).project;
  assert.equal(m.eingerichtet, false); assert.deepEqual(m.kontakte, k);
  assert.equal(m.adresse, 'A'); assert.equal(m.anfahrt, 'B'); assert.equal(m.kunde, 'C');
  const q = plan(); q.project.kontakte = 'kaputt';
  assert.deepEqual(migrate(q).project.kontakte, []);
});
test('kontakte überstehen Export und Import', () => {
  const k = [{ id: 'k1', name: 'Ann', rolle: 'PL', tel: '0171' }];
  const p = plan(); p.project.kontakte = k;
  assert.deepEqual(deserialize(serialize(p)).plan.project.kontakte, k);
});

console.log('\nEingebaute Bezeichnungen (Migration)');
const altMitRes = (res, ressourcen) => {
  const p = JSON.parse(JSON.stringify(plan()));
  p.tasks[0].crew = 0;
  p.tasks[0].res = res;
  p.project.ressourcen = ressourcen;
  return p;
};
test('eigene «Stagehand» geht in der eingebauten auf, Anzahl bleibt', () => {
  const p = altMitRes([{ rid: 'sh', n: 3, von: null, bis: null }], [{ id: 'sh', label: ' stagehand ', kind: 'personal' }]);
  const m = migrate(p);
  assert.equal(m.project.ressourcen.some((r) => r.id === 'sh'), false);
  assert.deepEqual(m.tasks[0].res[0], { rid: 'p-stagehand', n: 3, von: null, bis: null });
});
test('Migration ist idempotent', () => {
  const p = altMitRes([{ rid: 'sh', n: 3, von: null, bis: null }], [{ id: 'sh', label: 'Stagehand', kind: 'personal' }]);
  const a = migrate(p);
  const b = migrate(JSON.parse(JSON.stringify(a)));
  assert.deepEqual(b, a);
});
test('gleichnamig, aber andere Art bleibt unangetastet', () => {
  const p = altMitRes([{ rid: 'sh', n: 1, von: null, bis: null }], [{ id: 'sh', label: 'Stagehand', kind: 'maschine' }]);
  const m = migrate(p);
  assert.deepEqual(m.project.ressourcen.map((r) => r.id), ['sh']);
  assert.equal(m.tasks[0].res[0].rid, 'sh');
});

test('Import: unbekannter Bedarfsstatus fällt auf angefragt, gültige bleiben, idempotent', () => {
  const raw = plan();
  raw.tasks[0].res = [
    { rid: 'sh', n: 1, von: null, bis: null, status: 'quatsch' },
    { rid: 'sh', n: 1, von: null, bis: null, status: 'bestaetigt', bestaetigtAm: '2026-10-01T00:00:00Z' },
    { rid: 'sh', n: 1, von: null, bis: null, status: 'abgelehnt', notiz: 'x' },
  ];
  const m = migrate(raw);
  assert.equal('status' in m.tasks[0].res[0], false);
  assert.equal(m.tasks[0].res[1].status, 'bestaetigt');
  assert.equal(m.tasks[0].res[2].status, 'abgelehnt');
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(m))).tasks[0].res, m.tasks[0].res);
});

test('Import: notiz/bestaetigtAm ohne gültigen status werden entfernt, idempotent', () => {
  const raw = plan();
  raw.tasks[0].res = [
    { rid: 'sh', n: 1, von: null, bis: null, notiz: 'Waise', bestaetigtAm: '2026-10-01T00:00:00Z' },
    { rid: 'sh', n: 1, von: null, bis: null, status: 'quatsch', notiz: 'x', bestaetigtAm: '2026-10-01T00:00:00Z' },
    { rid: 'sh', n: 1, von: null, bis: null, status: 'abgelehnt', notiz: 'Grund' },
  ];
  const m = migrate(raw);
  assert.deepEqual(Object.keys(m.tasks[0].res[0]).sort(), ['bis', 'n', 'rid', 'von']);
  assert.deepEqual(Object.keys(m.tasks[0].res[1]).sort(), ['bis', 'n', 'rid', 'von']);
  assert.equal(m.tasks[0].res[2].notiz, 'Grund');
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(m))).tasks[0].res, m.tasks[0].res);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
