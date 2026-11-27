// Mitglieder-Logik (DOM-frei): Liste zusammenführen, Eingaben prüfen, Fehlertexte.
// Datenformen wie PocketBase sie liefert (mitglieder.gewerke als Liste, ablauf als «JJJJ-MM-TT hh:mm:ss.sssZ»).
import { mitgliederListe, rolleGewerke, einladungPruefen, entfernenInfo, verwaltungListe, leitungSchalterGesperrt, fehlerText, LIMIT_HINWEIS } from '../js/mitglieder-logik.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};
const JETZT = Date.parse('2026-11-26T12:00:00Z');
const users = [
  { id: 'u1', name: 'Paula', email: 'pl@bzp.test' },
  { id: 'u2', name: 'Ben', email: '' },
  { id: 'u3', name: '', email: 'ohnename@bzp.test' },
];
const mitglieder = [
  { id: 'm1', plan_id: 'p', user_id: 'u2', rolle: 'bearbeiter', gewerke: [] },
  { id: 'm2', plan_id: 'p', user_id: 'u3', rolle: 'gewerkeleiter', gewerke: ['g2'] },
  { id: 'm3', plan_id: 'p', user_id: 'uX', rolle: 'betrachter', gewerke: null },
];
const einladungen = [
  { id: 'e1', plan_id: 'p', email: 'neu@bzp.test', rolle: 'gewerkeleiter', gewerke: ['g2'], ablauf: '2099-01-01 00:00:00.000Z' },
  { id: 'e2', plan_id: 'p', email: 'alt@bzp.test', rolle: 'betrachter', gewerke: [], ablauf: '2020-01-01 00:00:00.000Z' },
];

test('Liste: Besitzer vorn, Mitglieder nach Name, Name fällt auf E-Mail und Kennung zurück', () => {
  const l = mitgliederListe({ plan: { besitzer: 'u1' }, mitglieder, users, einladungen, jetzt: JETZT });
  assert.equal(l.besitzer.name, 'Paula');
  assert.deepEqual(l.mitglieder.map((m) => m.name), ['Ben', 'ohnename@bzp.test', 'Unbekanntes Konto (uX)']);
  assert.equal(l.mitglieder[0].email, '');           // E-Mail nicht sichtbar → leer, kein Fehler
  assert.deepEqual(l.mitglieder[2].gewerke, []);     // null → leere Liste
});
test('Liste: Einladung abgelaufen erkannt, gültige nicht', () => {
  const l = mitgliederListe({ plan: null, mitglieder: [], users: [], einladungen, jetzt: JETZT });
  assert.equal(l.besitzer, null);
  assert.deepEqual(l.einladungen.map((e) => [e.email, e.abgelaufen]), [['alt@bzp.test', true], ['neu@bzp.test', false]]);
});
test('rolleGewerke: Gewerke nur bei Gewerkeleiter, dort mindestens eines, Unbekanntes fällt weg', () => {
  assert.deepEqual(rolleGewerke('bearbeiter', ['g1'], ['g1']), { rolle: 'bearbeiter', gewerke: [] });
  assert.match(rolleGewerke('gewerkeleiter', [], ['g1']).fehler, /mindestens ein Gewerk/);
  assert.match(rolleGewerke('gewerkeleiter', ['gX'], ['g1']).fehler, /mindestens ein Gewerk/);
  assert.deepEqual(rolleGewerke('gewerkeleiter', ['g1', 'gX', 'g1'], ['g1']), { rolle: 'gewerkeleiter', gewerke: ['g1'] });
  assert.match(rolleGewerke('besitzer', [], []).fehler, /Rolle/);
});
test('einladungPruefen: leer, ungültig, schon Mitglied, schon eingeladen, ok (klein, getrimmt)', () => {
  const l = mitgliederListe({ plan: null, mitglieder, users, einladungen, jetzt: JETZT });
  const p = (email, rolle = 'bearbeiter', gewerke = []) => einladungPruefen({ email, rolle, gewerke, bekannt: ['g2'], zeilen: l.mitglieder, einladungen: l.einladungen });
  assert.match(p('  ').fehler, /eintragen/);
  assert.match(p('kein-at').fehler, /gültige/);
  assert.match(p('OhneName@bzp.test').fehler, /schon Mitglied/);
  assert.match(p('neu@bzp.test').fehler, /schon eingeladen/);
  assert.match(p('x@bzp.test', 'gewerkeleiter').fehler, /Gewerk/);
  assert.deepEqual(p('  Neu2@BZP.test ', 'gewerkeleiter', ['g2']), { email: 'neu2@bzp.test', rolle: 'gewerkeleiter', gewerke: ['g2'] });
});
test('entfernenInfo: fremdes Mitglied ohne Warnung, eigene Zeile warnt (Leitung), Besitzer/Superadmin ohne', () => {
  const z = { user_id: 'u1' };
  assert.deepEqual(entfernenInfo({ zeile: z, ichId: 'u9', ichRolle: 'produktionsleitung' }), { gesperrt: null, warnung: null });
  assert.match(entfernenInfo({ zeile: z, ichId: 'u1', ichRolle: 'produktionsleitung' }).warnung, /keinen Zugriff mehr/);
  assert.equal(entfernenInfo({ zeile: z, ichId: 'u1', ichRolle: 'superadmin' }).warnung, null);
});
test('verwaltungListe: Konten sortiert, Pläne mit Besitzername und Mitgliederzahl', () => {
  const v = verwaltungListe({
    users: [{ id: 'u1', name: 'Zoe', email: '', superadmin: true }, { id: 'u2', name: 'Ann', produktionsleitung: true }],
    plaene: [{ plan_id: 'p', besitzer: 'u2', daten: { name: 'Fest', venue: 'Halle' } }, { plan_id: 'q', besitzer: '', daten: null }],
    mitglieder: [{ plan_id: 'p' }, { plan_id: 'p' }],
  });
  assert.deepEqual(v.konten.map((k) => [k.name, k.produktionsleitung, k.superadmin]), [['Ann', true, false], ['Zoe', false, true]]);
  assert.deepEqual(v.plaene.map((p) => [p.name, p.besitzer, p.mitglieder]), [['(ohne Namen)', 'kein Besitzer', 0], ['Fest', 'Ann', 2]]);
  assert.ok(leitungSchalterGesperrt(v.konten[1]) && !leitungSchalterGesperrt(v.konten[0]));
});
test('fehlerText: 429 → Hinweis, Netz, sonst Servertext', () => {
  assert.equal(fehlerText({ ok: false, code: 'limit', status: 429, message: 'x' }), LIMIT_HINWEIS);
  assert.equal(LIMIT_HINWEIS, 'Zu viele Anfragen – bitte kurz warten.');
  assert.match(fehlerText({ code: 'netz' }), /Keine Verbindung/);
  assert.equal(fehlerText({ code: 'verboten', message: 'Nur die Produktionsleitung darf einladen.' }), 'Nur die Produktionsleitung darf einladen.');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
