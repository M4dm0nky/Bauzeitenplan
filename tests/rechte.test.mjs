import { aenderungen } from '../js/aenderungen.js';
import { rechteFehler, darfBearbeiten, darfMitglieder, darfPlanAnlegen } from '../js/rechte.js';
import { deserialize } from '../js/persistence.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};
const kl = (x) => JSON.parse(JSON.stringify(x));

// Echter Plan aus den Fixtures. Gewerke: g0 Bühne, g1 Rigging, g2 Licht, g4 Video.
// t1/t2 liegen in g0, t7 in g1, t11/t12 in g2, t0 ist ein «projekt»-Vorgang, d0 = t1 → t2.
const BASIS = (() => {
  const p = deserialize(readFileSync(new URL('../tools/fixtures/festival-mit-daten.json', import.meta.url), 'utf8')).plan;
  const q = kl(p);
  // t1 trägt eine bestätigte Bedarfszeile (echte Form: status/bestaetigtAm), t2 eine offene
  q.tasks.find((t) => t.id === 't1').res = [{ rid: 'crew', n: 2, von: null, bis: null, status: 'bestaetigt', bestaetigtAm: '2026-09-01T10:00:00.000Z' }];
  q.tasks.find((t) => t.id === 't2').res = [{ rid: 'crew', n: 1, von: null, bis: null }];
  return q;
})();
const task = (s, id) => s.tasks.find((t) => t.id === id);

// Rollen. Der Gewerkeleiter hat Bühne + Rigging.
const ROLLEN = {
  S: { rolle: 'superadmin', gewerke: [] },
  B: { rolle: 'besitzer', gewerke: [] },
  P: { rolle: 'produktionsleitung', gewerke: [] },
  Bea: { rolle: 'bearbeiter', gewerke: [] },
  GL: { rolle: 'gewerkeleiter', gewerke: ['g0', 'g1'] },
  Bet: { rolle: 'betrachter', gewerke: [] },
};
const name = (id) => BASIS.gewerke.find((g) => g.id === id)?.name ?? id;

// Matrix: Zeile = Fall (Änderung am Plan), Spalte = Rolle, true = erlaubt.
//             S      B      P      Bea    GL     Bet
const T = true, F = false;
const MATRIX = [
  ['Vorgang im eigenen Gewerk ändern', (s) => { task(s, 't2').title = 'neu'; }, [T, T, T, T, T, F]],
  ['Vorgang im fremden Gewerk ändern', (s) => { task(s, 't11').title = 'neu'; }, [T, T, T, T, F, F]],
  ['Vorgang eigen → fremd verschieben', (s) => { task(s, 't2').gewerk = 'g2'; }, [T, T, T, T, F, F]],
  ['Vorgang fremd → eigen verschieben', (s) => { task(s, 't11').gewerk = 'g0'; }, [T, T, T, T, F, F]],
  ['Vorgang mit gewerk «projekt» ändern', (s) => { task(s, 't0').title = 'neu'; }, [T, T, T, T, F, F]],
  ['Vorgang im eigenen Gewerk anlegen', (s) => { s.tasks.push({ ...kl(task(s, 't2')), id: 'tNeu', res: [] }); }, [T, T, T, T, T, F]],
  ['Vorgang im fremden Gewerk anlegen', (s) => { s.tasks.push({ ...kl(task(s, 't11')), id: 'tNeu', res: [] }); }, [T, T, T, T, F, F]],
  ['Vorgang im eigenen Gewerk löschen', (s) => { s.deps = s.deps.filter((d) => d.from !== 't2' && d.to !== 't2'); s.tasks = s.tasks.filter((t) => t.id !== 't2'); }, [T, T, T, T, T, F]],
  ['Vorgang im fremden Gewerk löschen', (s) => { s.deps = s.deps.filter((d) => d.from !== 't11' && d.to !== 't11'); s.tasks = s.tasks.filter((t) => t.id !== 't11'); }, [T, T, T, T, F, F]],
  ['Verknüpfung anlegen, Nachfolger eigen', (s) => { s.deps.push({ id: 'dNeu', from: 't11', to: 't1', type: 'FS', lag: 0 }); }, [T, T, T, T, T, F]],
  ['Verknüpfung anlegen, Nachfolger fremd', (s) => { s.deps.push({ id: 'dNeu', from: 't1', to: 't11', type: 'FS', lag: 0 }); }, [T, T, T, T, F, F]],
  ['Verknüpfung ändern (lag), Nachfolger eigen', (s) => { s.deps.find((d) => d.id === 'd0').lag = 5; }, [T, T, T, T, T, F]],
  ['Verknüpfung auf fremden Nachfolger umhängen', (s) => { s.deps.find((d) => d.id === 'd0').to = 't11'; }, [T, T, T, T, F, F]],
  ['Verknüpfung löschen, Nachfolger eigen', (s) => { s.deps = s.deps.filter((d) => d.id !== 'd0'); }, [T, T, T, T, T, F]],
  ['Verknüpfung löschen, Nachfolger fremd', (s) => { s.deps = s.deps.filter((d) => d.id !== 'd2'); }, [T, T, T, T, F, F]],
  ['Ressource anlegen', (s) => { s.project.ressourcen.push({ id: 'rNeu', label: 'Neu', kind: 'personal' }); }, [T, T, T, T, T, F]],
  ['Ressource umbenennen', (s) => { s.project.ressourcen[0].label = 'Anders'; }, [T, T, T, T, F, F]],
  ['Ressource löschen', (s) => { s.project.ressourcen.pop(); }, [T, T, T, T, F, F]],
  ['Gewerk umbenennen', (s) => { s.gewerke[0].name = 'Anders'; }, [T, T, T, T, F, F]],
  ['Gewerk anlegen', (s) => { s.gewerke.push({ id: 'gNeu', name: 'Neu', sort: 99, slot: 9, art: 'gewerk' }); }, [T, T, T, T, F, F]],
  ['Phase ändern', (s) => { s.phases[0].end = '2026-09-12T06:00'; }, [T, T, T, T, F, F]],
  ['Plan ändern (Zeitraum)', (s) => { s.project.end = '2026-12-31T23:00'; }, [T, T, T, T, F, F]],
  ['Plan ändern (Auswahlliste)', (s) => { s.project.abschnitte = [...(s.project.abschnitte || []), 'x']; }, [T, T, T, T, F, F]],
  ['Bedarf bestätigen (offene Zeile)', (s) => { Object.assign(task(s, 't2').res[0], { status: 'bestaetigt', bestaetigtAm: '2026-09-02T08:00:00.000Z' }); }, [T, T, T, F, F, F]],
  ['Bedarf ablehnen mit Notiz', (s) => { Object.assign(task(s, 't2').res[0], { status: 'abgelehnt', notiz: 'kein Platz' }); }, [T, T, T, F, F, F]],
  ['Bedarf anlegen mit Bestätigung (neuer Vorgang)', (s) => { s.tasks.push({ ...kl(task(s, 't2')), id: 'tNeu', res: [{ rid: 'crew', n: 1, von: null, bis: null, status: 'bestaetigt', bestaetigtAm: 'x' }] }); }, [T, T, T, F, F, F]],
  ['Bestätigte Zeile ändern (Anzahl)', (s) => { task(s, 't1').res[0].n = 9; }, [T, T, T, F, F, F]],
  ['Bestätigte Zeile duplizieren', (s) => { task(s, 't1').res.push(kl(task(s, 't1').res[0])); }, [T, T, T, F, F, F]],
  ['Bestätigte Zeile bleibt, Titel ändert sich', (s) => { task(s, 't1').title = 'neu'; }, [T, T, T, T, T, F]],
  ['Offenen Bedarf ändern (Anzahl)', (s) => { task(s, 't2').res[0].n = 5; }, [T, T, T, T, T, F]],
  ['Bestätigung entfernen (Rückfall auf angefragt)', (s) => { delete task(s, 't1').res[0].status; delete task(s, 't1').res[0].bestaetigtAm; }, [T, T, T, T, T, F]],
  ['Zeit ändern, Bestätigung bleibt stehen', (s) => { task(s, 't1').end = '2026-07-31T18:00'; }, [T, T, T, F, F, F]],
  ['Zeit ändern, Bestätigung fällt zurück auf angefragt', (s) => { const t = task(s, 't1'); t.end = '2026-07-31T18:00'; delete t.res[0].status; delete t.res[0].bestaetigtAm; }, [T, T, T, T, T, F]],
  ['Zeit gleichwertig neu geschrieben (Format), Bestätigung bleibt', (s) => { task(s, 't1').end = '2026-07-31T17:00:00'; }, [T, T, T, T, T, F]],
];

console.log('\nRechte-Matrix: Fall × Rolle');
const SPALTEN = Object.keys(ROLLEN);
for (const [fall, mut, erwartet] of MATRIX) {
  assert.equal(erwartet.length, SPALTEN.length, 'Zeile unvollständig: ' + fall);
  SPALTEN.forEach((sp, i) => {
    test(`${fall} — ${sp}: ${erwartet[i] ? 'erlaubt' : 'verboten'}`, () => {
      const nachher = kl(BASIS);
      mut(nachher);
      const aend = aenderungen(BASIS, nachher);
      const f = rechteFehler(ROLLEN[sp], aend, BASIS, name);
      if (erwartet[i]) assert.equal(f, null, 'unerwartet verboten: ' + f);
      else assert.equal(typeof f, 'string', 'unerwartet erlaubt');
    });
  });
}

console.log('\nTexte');
const aendVon = (mut) => { const n = kl(BASIS); mut(n); return aenderungen(BASIS, n); };
const fremd = aendVon((s) => { task(s, 't11').title = 'neu'; });
test('keine Änderung: auch Betrachter bekommt keinen Fehler', () => {
  assert.equal(rechteFehler(ROLLEN.Bet, aenderungen(BASIS, kl(BASIS)), BASIS, name), null);
});
test('Betrachter', () => assert.equal(rechteFehler(ROLLEN.Bet, fremd, BASIS, name), 'Nur ansehen: du bist Betrachter.'));
test('Gewerkeleiter, fremdes Gewerk: Namen der eigenen Gewerke, mit Komma', () => {
  assert.equal(rechteFehler(ROLLEN.GL, fremd, BASIS, name), 'Nur Bühne, Rigging darfst du ändern.');
});
test('Gewerkeleiter ohne Gewerk', () => {
  assert.equal(rechteFehler({ rolle: 'gewerkeleiter', gewerke: [] }, fremd, BASIS, name), 'Dir ist kein Gewerk zugeordnet, du darfst keine Vorgänge ändern.');
});
test('Bedarf bestätigen', () => {
  const a = aendVon((s) => { Object.assign(task(s, 't2').res[0], { status: 'bestaetigt', bestaetigtAm: 'x' }); });
  assert.equal(rechteFehler(ROLLEN.Bea, a, BASIS, name), 'Bedarf bestätigen darf nur die Produktionsleitung.');
});
test('Zeitraum/Phasen/Gewerke', () => {
  const a = aendVon((s) => { s.phases[0].end = '2026-09-12T06:00'; });
  assert.equal(rechteFehler(ROLLEN.GL, a, BASIS, name), 'Zeitraum, Phasen und Gewerke ändert die Produktionsleitung oder ein Bearbeiter.');
});
test('Bezeichnung umbenennen', () => {
  const a = aendVon((s) => { s.project.ressourcen[0].label = 'Anders'; });
  assert.match(rechteFehler(ROLLEN.GL, a, BASIS, name), /^Bezeichnungen umbenennen oder löschen darf nur /);
});
test('Verknüpfung, Nachfolger fremd', () => {
  const a = aendVon((s) => { s.deps.push({ id: 'dNeu', from: 't1', to: 't11', type: 'FS', lag: 0 }); });
  assert.match(rechteFehler(ROLLEN.GL, a, BASIS, name), /^Verknüpfungen darfst du nur ändern, wenn der Nachfolger/);
});
test('unbekannte/fehlende Rolle: kein Zugang', () => {
  assert.equal(rechteFehler(null, fremd, BASIS, name), 'Keine Berechtigung für diesen Plan.');
  assert.equal(rechteFehler({ rolle: 'gast', gewerke: [] }, fremd, BASIS, name), 'Keine Berechtigung für diesen Plan.');
});
test('nur der erste Fehler (Text, nicht Liste)', () => {
  const a = aendVon((s) => { task(s, 't11').title = 'x'; s.phases[0].end = '2026-09-12T06:00'; });
  assert.equal(typeof rechteFehler(ROLLEN.GL, a, BASIS, name), 'string');
});
test('Gewerkeleiter: Nachfolger im selben Schritt angelegt zählt (neuer eigener Vorgang + Verknüpfung)', () => {
  const a = aendVon((s) => {
    s.tasks.push({ ...kl(task(s, 't2')), id: 'tNeu', res: [] });
    s.deps.push({ id: 'dNeu', from: 't11', to: 'tNeu', type: 'FS', lag: 0 });
  });
  assert.equal(rechteFehler(ROLLEN.GL, a, BASIS, name), null);
});

console.log('\nHilfsfunktionen');
test('darfBearbeiten', () => {
  const erg = Object.fromEntries(SPALTEN.map((k) => [k, darfBearbeiten(ROLLEN[k])]));
  assert.deepEqual(erg, { S: true, B: true, P: true, Bea: true, GL: true, Bet: false });
  assert.equal(darfBearbeiten(null), false);
});
test('darfMitglieder: nur Leitung', () => {
  const erg = Object.fromEntries(SPALTEN.map((k) => [k, darfMitglieder(ROLLEN[k])]));
  assert.deepEqual(erg, { S: true, B: true, P: true, Bea: false, GL: false, Bet: false });
});
test('darfPlanAnlegen liest die users-Flags', () => {
  assert.equal(darfPlanAnlegen({ superadmin: true }), true);
  assert.equal(darfPlanAnlegen({ produktionsleitung: true }), true);
  assert.equal(darfPlanAnlegen({ superadmin: false, produktionsleitung: false }), false);
  assert.equal(darfPlanAnlegen(null), false);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
