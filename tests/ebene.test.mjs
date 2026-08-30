import { artOf, abschnittOf, imAbschnitt, sichtGewerke, sichtTasks, programmFenster, punktLabel, punktTypen, punktKompakt, typHinweis, abschnitte, abschnittLabel, ART_FUER, ABSCHNITTE, EBENEN } from '../js/ebene.js';
import { toMin } from '../js/schedule.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
};

const T = (id, gewerk, start, end) =>
  ({ id, gewerk, title: id, start, end, milestone: false, status: 'geplant' });

const S = {
  gewerke: [
    { id: 'g0', name: 'Bühne', sort: 0, slot: 0 },                      // Altdaten: kein art
    { id: 'g1', name: 'Ton', sort: 1, slot: 1, art: 'gewerk' },
    { id: 'b0', name: 'Hauptbühne', sort: 2, slot: 0, art: 'buehne' },
    { id: 'b1', name: 'Zelt', sort: 3, slot: 1, art: 'buehne' },
  ],
  tasks: [
    T('t0', 'g0', '2026-08-21T08:00', '2026-08-21T18:00'),
    T('t1', 'g1', '2026-08-22T08:00', '2026-08-22T12:00'),
    T('p0', 'b0', '2026-08-29T14:00', '2026-08-29T14:30'),
    T('p1', 'b0', '2026-08-29T20:40', '2026-08-29T21:50'),
    T('p2', 'b1', '2026-08-30T15:00', '2026-08-30T16:00'),
    { ...T('s0', 'b0', '2026-08-29T08:00', '2026-08-29T10:00'), abschnitt: 'setup' },
  ],
};

console.log('\nEbenen');

test('Altdaten ohne art sind Gewerke', () => {
  assert.equal(artOf({ id: 'g0' }), 'gewerk');
  assert.equal(artOf({ id: 'b0', art: 'buehne' }), 'buehne');
});

test('der Bauzeitenplan zeigt nur Gewerke', () => {
  assert.deepEqual(sichtGewerke(S, 'bau').map((g) => g.id), ['g0', 'g1']);
});

test('der Showablauf zeigt nur Bühnen', () => {
  assert.deepEqual(sichtGewerke(S, 'show').map((g) => g.id), ['b0', 'b1']);
});

test('die Bänder kommen nach sort, nicht in Datei-Reihenfolge', () => {
  const durcheinander = { gewerke: [{ id: 'b1', sort: 3, art: 'buehne' }, { id: 'b0', sort: 2, art: 'buehne' }], tasks: [] };
  assert.deepEqual(sichtGewerke(durcheinander, 'show').map((g) => g.id), ['b0', 'b1']);
});

test('der Filter nimmt einzelne Bühnen heraus', () => {
  assert.deepEqual(sichtGewerke(S, 'show', new Set(['b1'])).map((g) => g.id), ['b0']);
  assert.deepEqual(sichtTasks(S, 'show', new Set(['b1'])).map((t) => t.id), ['p0', 'p1', 's0']);
});

test('Vorgänge folgen ihrem Band', () => {
  assert.deepEqual(sichtTasks(S, 'bau').map((t) => t.id), ['t0', 't1']);
  assert.deepEqual(sichtTasks(S, 'show').map((t) => t.id), ['p0', 'p1', 'p2', 's0']);
});

test('ein Vorgang ohne existierendes Band fällt aus beiden Ebenen', () => {
  const s = { gewerke: S.gewerke, tasks: [...S.tasks, T('x', 'weg', '2026-08-29T10:00', '2026-08-29T11:00')] };
  assert.equal(sichtTasks(s, 'bau').some((t) => t.id === 'x'), false);
  assert.equal(sichtTasks(s, 'show').some((t) => t.id === 'x'), false);
});

test('unbekannte Ebene fällt auf Gewerke zurück, statt leer zu sein', () => {
  assert.deepEqual(sichtGewerke(S, 'quatsch').map((g) => g.id), ['g0', 'g1']);
});

console.log('\nAbschnitte: Setup und Show');

test('ein Eintrag ohne Feld gehört zur Show', () => {
  // Die bestehende Running Order bleibt, wo sie ist.
  assert.equal(abschnittOf({ id: 'p0' }), 'show');
  assert.equal(abschnittOf({ id: 's0', abschnitt: 'setup' }), 'setup');
});

test('erfundene Abschnitte gelten als Show, nicht als dritter Zustand', () => {
  assert.equal(abschnittOf({ abschnitt: 'quatsch' }), 'show');
});

test('imAbschnitt filtert die Einträge, «alle» lässt durch', () => {
  const alle = sichtTasks(S, 'show');
  assert.deepEqual(imAbschnitt(alle, 'setup').map((t) => t.id), ['s0']);
  assert.deepEqual(imAbschnitt(alle, 'show').map((t) => t.id), ['p0', 'p1', 'p2']);
  assert.deepEqual(imAbschnitt(alle, 'alle').map((t) => t.id), ['p0', 'p1', 'p2', 's0']);
  assert.deepEqual(imAbschnitt(alle, 'quatsch').map((t) => t.id), ['p0', 'p1', 'p2', 's0']);
  assert.deepEqual(imAbschnitt(null, 'setup'), []);
});

test('DIE BÜHNE BLEIBT in beiden Abschnitten stehen', () => {
  // Es gibt EINE Bühne mit zwei Abläufen. Sie darf nicht verschwinden, nur weil
  // sie im gewählten Abschnitt noch nichts hat — genau dort legt man den ersten
  // Setup-Eintrag an.
  for (const a of ['setup', 'show', 'alle']) {
    assert.deepEqual(sichtGewerke(S, 'show').map((g) => g.id), ['b0', 'b1'], a);
  }
});

test('sichtTasks filtert im Showablauf nach Abschnitt', () => {
  assert.deepEqual(sichtTasks(S, 'show', new Set(), 'setup').map((t) => t.id), ['s0']);
  assert.deepEqual(sichtTasks(S, 'show', new Set(), 'show').map((t) => t.id), ['p0', 'p1', 'p2']);
});

test('der Bauzeitenplan kennt keine Abschnitte', () => {
  // Aufbauschritte tragen das Feld mit, aber es darf dort nie etwas ausblenden.
  for (const a of ['setup', 'show', 'alle']) {
    assert.deepEqual(sichtTasks(S, 'bau', new Set(), a).map((t) => t.id), ['t0', 't1'], a);
  }
});

test('ABSCHNITTE listet genau die beiden Werte, die ein Eintrag tragen kann', () => {
  // «alle» steht bewusst nicht drin: das ist ein Filterwert der Ansicht, kein
  // Wert, den ein Zeiteintrag haben könnte. Tabelle und Panel bauen ihre
  // Auswahlfelder aus dieser Liste — stünde «alle» darin, könnte man es wählen.
  assert.deepEqual(ABSCHNITTE.map(([k]) => k), ['setup', 'show']);
  for (const [, label] of ABSCHNITTE) assert.ok(label, 'ohne Beschriftung');
});

test('imAbschnitt lässt trotzdem alles durch, was nicht setup oder show ist', () => {
  // Der Durchlass gehört hierher, nicht in die Auswahlliste — der Bauzeitenplan
  // reicht «alle» durch, und eine vierte Ansicht wäre so ohne Umbau nachrüstbar.
  const alle = sichtTasks(S, 'show');
  assert.equal(imAbschnitt(alle, 'alle').length, alle.length);
  assert.equal(imAbschnitt(alle, undefined).length, alle.length);
});

console.log('\nProgrammfenster — wo wirklich etwas läuft');

const F = (id, start, end) => ({ id, title: id, start, end, milestone: false });
const iso = (min) => new Date(min * 60000).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T');

test('rundet auf volle Stunden nach außen', () => {
  // 12:00–21:50 wird 12:00–22:00. Über den Kalendertag gespannt nähme der leere
  // Vormittag die halbe Breite ein und die Umbauten wären Striche.
  const f = programmFenster([F('a', '2026-08-29T12:00', '2026-08-29T14:00'),
    F('b', '2026-08-29T20:40', '2026-08-29T21:50')]);
  assert.equal(iso(f.von), '2026-08-29T12:00');
  // 21:50 + 30 min Luft für die Beschriftung → aufgerundet 23:00.
  assert.equal(iso(f.bis), '2026-08-29T23:00');
});

test('krumme Anfangszeiten runden nach unten', () => {
  const f = programmFenster([F('a', '2026-08-29T12:20', '2026-08-29T13:10')]);
  assert.equal(iso(f.von), '2026-08-29T12:00');
  assert.equal(iso(f.bis), '2026-08-29T14:00');   // 13:10 + 30 min → 14:00
});

test('ein einzelner Meilenstein bekommt trotzdem eine Spanne', () => {
  // Sonst wäre die Spanne null und der Maßstab unendlich.
  const f = programmFenster([F('a', '2026-08-29T21:50', '2026-08-29T21:50')]);
  assert.ok(f.bis - f.von >= 60, 'Spanne ' + (f.bis - f.von) + ' min');
});

test('über Mitternacht wird NICHT auf den Kalendertag beschnitten', () => {
  // Ein Act bis 02:00 soll ganz zu sehen sein, nicht bei 24:00 enden.
  const f = programmFenster([F('a', '2026-08-29T22:00', '2026-08-30T02:00')]);
  assert.equal(iso(f.bis), '2026-08-30T03:00');   // 02:00 + 30 min → 03:00
});

test('ohne Vorgänge gibt es kein Fenster', () => {
  assert.equal(programmFenster([]), null);
  assert.equal(programmFenster(null), null);
});

console.log('\nProgrammpunkt-Typen');

test('jeder Typ hat eine Beschriftung', () => {
  assert.equal(punktLabel('changeover'), 'Changeover');
  assert.equal(punktLabel('act'), 'Act');
});

test('ein unbekannter Typ verschwindet nicht, sondern steht da', () => {
  assert.equal(punktLabel('sonstwas'), 'sonstwas');
});

test('jede Ebene hat eine Gewerk-Art', () => {
  for (const [key] of EBENEN) assert.ok(ART_FUER[key], 'keine Art für ' + key);
});

console.log('\nEigene Eintragsarten');
const mitTypen = (eigene) => ({ project: { punktTypen: eigene } });

test('ohne Plan bleiben es die eingebauten vier', () => {
  assert.deepEqual(punktTypen().map(([k]) => k), ['act', 'changeover', 'doors', 'ende']);
  assert.deepEqual(punktTypen({ project: {} }).map(([k]) => k), ['act', 'changeover', 'doors', 'ende']);
});
test('eigene stehen HINTER den eingebauten', () => {
  const k = punktTypen(mitTypen([{ id: 'linecheck', label: 'Line-Check' }])).map(([x]) => x);
  assert.deepEqual(k, ['act', 'changeover', 'doors', 'ende', 'linecheck']);
});
test('eine eigene Art wird beim Namen genannt — sonst stünde die id im Bild', () => {
  const st = mitTypen([{ id: 'linecheck', label: 'Line-Check' }]);
  assert.equal(punktLabel('linecheck', st), 'Line-Check');
  // Ohne den Plan kennt niemand den Namen — genau deshalb reist die Liste mit.
  assert.equal(punktLabel('linecheck'), 'linecheck');
});
test('die Live-Ansage nennt eine eigene Art', () => {
  const st = mitTypen([{ id: 'linecheck', label: 'Line-Check' }]);
  assert.equal(typHinweis({ title: 'SIDO', punktTyp: 'linecheck' }, st), 'Line-Check');
});
test('auch bei eigenen Arten steht der Typ nicht doppelt', () => {
  const st = mitTypen([{ id: 'linecheck', label: 'Line-Check' }]);
  assert.equal(typHinweis({ title: 'Line-Check', punktTyp: 'linecheck' }, st), '');
});

console.log('\nEigene Abschnitte');
const mitAbs = (eigene, tasks = []) => ({ project: { abschnitte: eigene }, tasks });

test('ohne Plan bleiben es Setup und Show', () => {
  assert.deepEqual(abschnitte().map(([k]) => k), ['setup', 'show']);
  assert.deepEqual(abschnitte({ project: {} }).map(([k]) => k), ['setup', 'show']);
});
test('eigene stehen HINTER den eingebauten', () => {
  const k = abschnitte(mitAbs([{ id: 'loadin', label: 'Load-in' }])).map(([x]) => x);
  assert.deepEqual(k, ['setup', 'show', 'loadin']);
});
test('ein eigener Abschnitt wird beim Namen genannt', () => {
  const st = mitAbs([{ id: 'loadin', label: 'Load-in' }]);
  assert.equal(abschnittLabel('loadin', st), 'Load-in');
  assert.equal(abschnittLabel('setup', st), 'Setup');
  assert.equal(abschnittLabel('loadin'), 'loadin', 'ohne Plan bleibt die Kennung stehen');
});
test('EIGENE ORDNEN SICH NACH IHREM FRÜHESTEN EINTRAG', () => {
  // Ein Load-in um 07:00 gehört vor eine Aftershow um 23:30 — ohne dass jemand
  // etwas sortieren muss.
  const st = mitAbs(
    [{ id: 'after', label: 'Aftershow' }, { id: 'loadin', label: 'Load-in' }],
    [{ ...T('a', 'b0', '2026-08-29T23:30', '2026-08-30T01:00'), abschnitt: 'after' },
      { ...T('b', 'b0', '2026-08-29T07:00', '2026-08-29T09:00'), abschnitt: 'loadin' }],
  );
  assert.deepEqual(abschnitte(st).map(([k]) => k), ['setup', 'show', 'loadin', 'after']);
});
test('ein noch LEERER Abschnitt hängt hinten an, statt zu verschwinden', () => {
  const st = mitAbs(
    [{ id: 'leer', label: 'Leer' }, { id: 'loadin', label: 'Load-in' }],
    [{ ...T('b', 'b0', '2026-08-29T07:00', '2026-08-29T09:00'), abschnitt: 'loadin' }],
  );
  assert.deepEqual(abschnitte(st).map(([k]) => k), ['setup', 'show', 'loadin', 'leer']);
});
test('DIE ANSICHT FILTERT WEITER NUR NACH SETUP UND SHOW', () => {
  // Der Umschalter oben bleibt unverändert: ein eigener Abschnitt ist ein
  // Etikett am Eintrag und zählt zur Show. Ohne diese Zusicherung wäre ein
  // Eintrag mit «Load-in» in KEINER Ansicht zu sehen.
  const t = { id: 'x', title: 'Load-in Bühne', abschnitt: 'loadin' };
  assert.equal(abschnittOf(t), 'show');
  assert.deepEqual(imAbschnitt([t], 'show').map((x) => x.id), ['x']);
  assert.deepEqual(imAbschnitt([t], 'setup'), []);
});

console.log('\nZeilenhöhe auf dem Blatt');
test('Changeover tritt zurück, Act nicht', () => {
  assert.equal(punktKompakt('changeover'), true);
  assert.equal(punktKompakt('act'), false);
});
test('eine eigene Art kann zurücktreten — oder eben nicht', () => {
  const st = mitTypen([
    { id: 'pause', label: 'Umbaupause', kompakt: true },
    { id: 'gast', label: 'Gastauftritt', kompakt: false },
  ]);
  assert.equal(punktKompakt('pause', st), true);
  assert.equal(punktKompakt('gast', st), false);
});
test('ein unbekannter Typ tritt nicht zurück', () => {
  // Sonst schrumpfte eine Zeile, deren Art aus dem Plan gefallen ist.
  assert.equal(punktKompakt('gibtsnicht'), false);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
