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

/** Arten eines Zeiteintrags. Der Typ steuert Darstellung und Live-Ansage, nie Zeiten. */
export const PUNKT_TYPEN = [
  ['act', 'Act'],
  ['changeover', 'Changeover'],
  ['doors', 'Doors'],
  ['ende', 'Show-Ende'],
];

/** Anzeigename einer Eintragsart. Unbekanntes bleibt unverändert stehen. */
export const punktLabel = (v) => (PUNKT_TYPEN.find(([k]) => k === v) || [v, v])[1];

/**
 * Der Typ als HINWEIS — leer, wenn der Titel ihn schon sagt.
 *
 * Ohne das stand auf dem ersten Probebild «Changeover: Changeover» in der
 * Live-Kopfzeile und «Changeover / Changeover» auf dem Blatt. Verglichen wird
 * normalisiert und in beide Richtungen, damit auch «SHOW END» / «Show-Ende»
 * als dasselbe erkannt wird.
 */
export function typHinweis(t) {
  const typ = t.punktTyp && t.punktTyp !== 'act' ? punktLabel(t.punktTyp) : '';
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

/** Die Auswahl des Umschalters. «alle» ist ein Filterwert, kein Bühnenwert. */
export const ABSCHNITTE = [['setup', 'Setup'], ['show', 'Show'], ['alle', 'alle']];

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
