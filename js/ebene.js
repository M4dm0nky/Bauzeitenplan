// ── Ebenen: Bauzeitenplan und Showablauf ──────────────────────────────────────
// Kein DOM. Der ganze Ebenen-Begriff steht HIER und nur hier — Gantt, Tabelle
// und Druckseite fragen, sie entscheiden nicht selbst.
//
// Derselbe Plan, zwei Blickrichtungen:
//
//   «bau»   — die ganze Veranstaltung: Vorbereitung, Aufbau, Show, Abbau.
//             Zeilenbänder sind GEWERKE.
//   «show»  — der Tagesablauf auf den Bühnen: Bands, Redner, Umbauten.
//             Zeilenbänder sind BÜHNEN.
//
// Eine Bühne ist technisch ein Gewerk mit `art:'buehne'`, ein Programmpunkt ein
// ganz normaler Vorgang darin. Das ist kein Trick, sondern die Beobachtung, dass
// beides dieselbe Form hat: eine benannte, sortierbare, eingefärbte Spur mit
// Vorgängen darin. Der Preis wäre sonst ein zweiter Store, ein zweites Undo,
// eine zweite Persistenz — für dasselbe Verhalten.
//
// Altdaten haben kein `art`. Sie sind deshalb Gewerke, und der Bauzeitenplan
// sieht aus wie immer.

import { toMin, toDate, tagesScheiben } from './schedule.js';
import { local } from './conflicts.js';

export const EBENEN = [['bau', 'Bauzeitenplan'], ['show', 'Showablauf']];

/** Welche Gewerk-Art bildet die Zeilenbänder dieser Ebene? */
export const ART_FUER = { bau: 'gewerk', show: 'buehne' };

/** Altdaten ohne `art` sind Gewerke — sonst verschwände der halbe Bestand. */
export const artOf = (g) => g.art || 'gewerk';

/**
 * EINGEBAUTE Arten eines Zeiteintrags: `[id, Name, kompakt]`.
 *
 * Der Typ steuert Darstellung und Live-Ansage, nie Zeiten. `kompakt` heißt:
 * tritt auf dem A3-Blatt zurück und bekommt eine niedrigere Zeile — auf dem
 * Blatt zählt, wer spielt. Bisher stand dafür ein fest verdrahteter Vergleich
 * auf 'changeover' in print.js; jetzt trägt jede Art die Eigenschaft selbst,
 * damit eigene Arten sie auch haben können.
 */
export const PUNKT_TYPEN = [
  ['act', 'Act', false],
  ['changeover', 'Changeover', true],
  ['doors', 'Doors', false],
  ['ende', 'Show-Ende', false],
];

/**
 * Alle Arten: eingebaute zuerst, dann die im PLAN angelegten.
 *
 * Die eigenen stehen in `project.punktTypen` und reisen damit im Export mit —
 * ohne die Namensliste in derselben Datei sähe ein Empfänger nur den Rohwert
 * «linecheck» statt «Line-Check». EINE Quelle für alle: Dropdown, Live-Ansage
 * und Druckblatt fragen hier, sonst kennt das Auswahlfeld eine Art, die der
 * Kopfzeile fehlt.
 * @returns {[string, string, boolean][]}
 */
/**
 * Selbst angelegte Werte in ihrer Reihenfolge: von Hand sortiert, sonst wie
 * übergeben. **Die EINE Stelle** — Eintragsarten, Abschnitte und die
 * Verwaltungsliste in table.js lasen das vorher je selbst, und der Fehler
 * darin war entsprechend dreimal zu beheben.
 *
 * `?? Infinity`, nicht `?? 0`: ein Wert ohne `sort` gehört ans ENDE. Mit 0
 * sprang ein neu angelegter Eintrag vor alles Sortierte, und bei Gleichstand
 * entschied die Array-Position — wer einmal sortiert hatte, bekam jede neue Art
 * an unvorhersehbarer Stelle.
 */
export function nachSort(eigene) {
  const liste = eigene || [];
  return liste.some((x) => x.sort != null)
    ? [...liste].sort((x, y) => (x.sort ?? Infinity) - (y.sort ?? Infinity))
    : liste;
}

export function punktTypen(state) {
  const eigene = (state && state.project && state.project.punktTypen) || [];
  // Von Hand sortiert? Sonst in der Reihenfolge, in der sie angelegt wurden —
  // eine Art hat keine Uhrzeit, an der man sie einordnen könnte.
  return [...PUNKT_TYPEN, ...nachSort(eigene).map((t) => [t.id, t.label, !!t.kompakt])];
}

/** Anzeigename einer Eintragsart. Unbekanntes bleibt unverändert stehen. */
export const punktLabel = (v, state) =>
  (punktTypen(state).find(([k]) => k === v) || [v, v])[1];

/** Tritt diese Art auf dem Blatt zurück (niedrigere Zeile)? */
export const punktKompakt = (v, state) =>
  !!(punktTypen(state).find(([k]) => k === v) || [])[2];

/**
 * Der Typ als HINWEIS — leer, wenn der Titel ihn schon sagt.
 *
 * Ohne das stand auf dem ersten Probebild «Changeover: Changeover» in der
 * Live-Kopfzeile und «Changeover / Changeover» auf dem Blatt. Verglichen wird
 * normalisiert und in beide Richtungen, damit auch «SHOW END» / «Show-Ende»
 * als dasselbe erkannt wird.
 */
export function typHinweis(t, state) {
  const typ = t.punktTyp && t.punktTyp !== 'act' ? punktLabel(t.punktTyp, state) : '';
  if (!typ) return '';
  const k = (x) => String(x || '').toLowerCase().replace(/[^a-zäöüß]/g, '');
  const a = k(t.title), b = k(typ);
  return a && b && (a.startsWith(b) || b.startsWith(a)) ? '' : typ;
}

/**
 * Der Abschnitt eines ZEITEINTRAGS: Load-in und Setup bis zum Showstart, oder
 * die Running Order danach.
 *
 * Es gibt EINE Bühne mit zwei zeitlichen Abläufen — nicht zwei Bühnen. Bis
 * v0.9.1 hing das Feld am Band, was den Namen doppelt vergeben hätte (und der
 * Store verbietet doppelte Bühnennamen). Fehlt es, gilt «show»: die bestehende
 * Running Order bleibt, wo sie ist.
 */
export const abschnittOf = (t) => (t.abschnitt === 'setup' ? 'setup' : 'show');

/**
 * Die Einträge eines Abschnitts. «alle» (und alles Unbekannte) lässt durch —
 * so wie `amTag` ohne Tag durchlässt.
 */
export const imAbschnitt = (tasks, abschnitt) =>
  (abschnitt === 'setup' || abschnitt === 'show')
    ? (tasks || []).filter((t) => abschnittOf(t) === abschnitt)
    : (tasks || []);

/**
 * Die beiden Abschnitte, aus denen Tabelle und Panel ihre Auswahlfelder bauen.
 * «alle» steht bewusst NICHT drin: das ist ein Filterwert der Ansicht, kein Wert,
 * den ein Zeiteintrag tragen könnte. Den Durchlass regelt `imAbschnitt`.
 */
export const ABSCHNITTE = [['setup', 'Setup'], ['show', 'Show']];

/**
 * Alle Abschnitte: die beiden eingebauten zuerst, dann die im PLAN angelegten.
 * Wie bei den Eintragsarten — sie stehen in `project.abschnitte` und reisen im
 * Export mit, sonst sähe ein Empfänger nur die Kennung «loadin».
 *
 * Eigene werden nach ihrem FRÜHESTEN Eintrag sortiert: ein Load-in um 07:00
 * steht damit vor einer Aftershow um 23:30, ohne dass jemand etwas sortieren
 * muss. Noch leere Abschnitte haben keine Zeit und hängen hinten an.
 *
 * **Die Ansicht filtert weiterhin nur nach Setup und Show** (`abschnittOf`).
 * Ein eigener Abschnitt ist ein Etikett am Eintrag; gezeigt wird er in der
 * Show-Ansicht. Wer das ändert, muss den Umschalter mitdenken.
 * @returns {[string, string][]}
 */
export function abschnitte(state) {
  const eigene = (state && state.project && state.project.abschnitte) || [];
  // Von Hand sortiert? Dann gilt das — die Automatik wäre sonst eine, die den
  // Betrachter überstimmt. Sobald EINER ein `sort` trägt, hat jemand sortiert
  // (der Store setzt es nur vollständig).
  if (eigene.some((a) => a.sort != null)) {
    return [...ABSCHNITTE, ...nachSort(eigene).map((a) => [a.id, a.label])];
  }
  const tasks = (state && state.tasks) || [];
  const frueh = new Map();
  for (const t of tasks) {
    const a = t.abschnitt;
    if (!a || a === 'setup' || a === 'show') continue;
    const m = toMin(t.start);
    if (!Number.isFinite(m)) continue;
    if (!frueh.has(a) || m < frueh.get(a)) frueh.set(a, m);
  }
  const sortiert = [...eigene].sort((x, y) =>
    (frueh.has(x.id) ? frueh.get(x.id) : Infinity) - (frueh.has(y.id) ? frueh.get(y.id) : Infinity));
  return [...ABSCHNITTE, ...sortiert.map((a) => [a.id, a.label])];
}

/** Anzeigename eines Abschnitts. Unbekanntes bleibt unverändert stehen. */
export const abschnittLabel = (v, state) =>
  (abschnitte(state).find(([k]) => k === v) || [v, v])[1];

/**
 * Die Zeilenbänder der Ebene, nach `sort`. `aus` blendet einzelne aus (der
 * Bühnen-Filter) — dieselbe Mechanik wie die Gewerk-Häkchen auf der Druckseite:
 * das Wegklicken ändert Zeilen UND Maßstab, nicht nur die Sichtbarkeit.
 *
 * Der Abschnitt filtert hier NICHT: eine Bühne bleibt in beiden Ansichten
 * stehen, auch wenn sie im gewählten Abschnitt noch nichts hat. Genau dort legt
 * man den ersten Setup-Eintrag an. Gefiltert werden die Einträge (imAbschnitt).
 *
 * @param {{gewerke:object[]}} state
 * @param {'bau'|'show'} ebene
 * @param {Set<string>} aus  ausgeblendete Gewerk-/Bühnen-IDs
 */
export function sichtGewerke(state, ebene, aus = new Set()) {
  const art = ART_FUER[ebene] || 'gewerk';
  return (state.gewerke || [])
    .filter((g) => artOf(g) === art && !aus.has(g.id))
    .sort((a, b) => a.sort - b.sort);
}

/** Die Vorgänge, die in dieser Ebene sichtbar sind — Vorgänge ohne Band fallen raus. */
export function sichtTasks(state, ebene, aus = new Set(), abschnitt = 'alle') {
  const ids = new Set(sichtGewerke(state, ebene, aus).map((g) => g.id));
  const drin = (state.tasks || []).filter((t) => ids.has(t.gewerk));
  return ebene === 'show' ? imAbschnitt(drin, abschnitt) : drin;
}

/**
 * Die Tage, an denen etwas stattfindet — sortiert, ohne Lücken zu erfinden.
 *
 * Eine Running Order ist TAGESBEZOGEN. Zeigte der Gantt beide Showtage
 * nebeneinander, stünden zehn Zeilen ohne Balken im Bild: die Acts des anderen
 * Tages. Das ist genau die Fehlerart, die dieses Projekt schon dreimal erst auf
 * dem Screenshot gesehen hat — deshalb hat der Showablauf einen Tages-Filter.
 *
 * Ein über Mitternacht laufender Punkt gehört zu BEIDEN Tagen (tagesScheiben).
 * @returns {string[]} «2026-08-29», «2026-08-30», …
 */
export function programmTage(tasks) {
  const tage = new Set();
  for (const t of tasks || []) {
    const a = toMin(t.start), b = Math.max(toMin(t.end), a);
    // Tagweise vorangehen statt Ziffern zu addieren: über den Sommerzeit-Sprung
    // wären +1440 Minuten der falsche nächste Tag.
    let d = new Date(local(toDate(a)).slice(0, 10) + 'T12:00');
    for (let i = 0; i < 400; i++) {
      const iso = local(d).slice(0, 10);
      if (toMin(iso + 'T00:00') > b) break;
      tage.add(iso);
      if (toMin(iso + 'T00:00') >= b) break;
      d.setDate(d.getDate() + 1);
    }
  }
  return [...tage].sort();
}

/** Die Vorgänge, die einen Kalendertag berühren. Über Mitternacht laufende zählen mit. */
export function amTag(tasks, tagISO) {
  if (!tagISO) return tasks;
  const drin = new Set(tagesScheiben(tasks, tagISO).map((s) => s.task.id));
  return tasks.filter((t) => drin.has(t.id));
}

/**
 * Das Fenster, in dem auf der Bühne WIRKLICH etwas läuft — auf volle Stunden
 * nach außen gerundet.
 *
 * Der Showtag hat 24 Stunden, die Show dauert zehn. Über den Kalendertag
 * gespannt nahm der leere Vormittag die halbe Breite ein und die Umbauten waren
 * Striche. Dasselbe Verfahren wie `fensterFuer` auf der Druckseite, nur in
 * Minuten seit Epoche statt in Stunden seit Tagesbeginn.
 *
 * Nicht auf den Kalendertag beschnitten: ein Act, der über Mitternacht läuft,
 * soll ganz zu sehen sein. Gerechnet über `toMin`, nie aus Datumsziffern.
 *
 * @returns {{von:number, bis:number}|null} Minuten seit Epoche, null bei leer
 */
export function programmFenster(tasks) {
  if (!tasks || !tasks.length) return null;
  let a = Infinity, b = -Infinity;
  for (const t of tasks) {
    a = Math.min(a, toMin(t.start));
    b = Math.max(b, toMin(t.end));
  }
  const von = Math.floor(a / 60) * 60;
  // Rechts eine halbe Stunde Luft VOR dem Aufrunden: die Beschriftung steht
  // neben dem Balken, und beim letzten Punkt des Abends (Show-Ende 21:50) liefe
  // sie sonst über die Blattkante — auf dem Probebild stand dort «SI».
  // Mindestens eine Stunde Spanne: ein Tag mit einem einzigen Meilenstein hätte
  // sonst die Spanne null und der Maßstab wäre unendlich.
  const bis = Math.max(Math.ceil((b + 30) / 60) * 60, von + 60);
  return { von, bis };
}
