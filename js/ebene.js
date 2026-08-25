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

/** Programmpunkt-Arten. Der Typ steuert Darstellung und Live-Ansage, nie Zeiten. */
export const PUNKT_TYPEN = [
  ['act', 'Act'],
  ['changeover', 'Changeover'],
  ['doors', 'Doors'],
  ['ende', 'Show-Ende'],
];

/** Anzeigename eines Programmpunkt-Typs. Unbekanntes bleibt unverändert stehen. */
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
 * Die Zeilenbänder der Ebene, nach `sort`. `aus` blendet einzelne aus (der
 * Bühnen-Filter) — dieselbe Mechanik wie die Gewerk-Häkchen auf der Druckseite:
 * das Wegklicken ändert Zeilen UND Maßstab, nicht nur die Sichtbarkeit.
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
export function sichtTasks(state, ebene, aus = new Set()) {
  const ids = new Set(sichtGewerke(state, ebene, aus).map((g) => g.id));
  return (state.tasks || []).filter((t) => ids.has(t.gewerk));
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
 * Zeitfenster für eine Ebene, auf volle Kalendertage gerundet.
 *
 * Nötig, weil `project.start/end` die ganze Veranstaltung umspannt (im
 * Klassentreffen-Plan zwei Wochen). Zöge der Showablauf seine Achse daraus,
 * wären zwei Showtage in vierzehn — jeder Act ein Strich. Gerechnet wird über
 * echte Zeitstempel (`toMin`), nie aus Datumsziffern: sonst ist die Spanne über
 * den Sommerzeit-Sprung um eine Stunde falsch.
 *
 * @returns {{start:string, end:string}|null}  lokale ISO-Zeiten, null bei leer
 */
export function zeitraumFuer(tasks) {
  if (!tasks || !tasks.length) return null;
  let a = Infinity, b = -Infinity;
  for (const t of tasks) {
    a = Math.min(a, toMin(t.start));
    b = Math.max(b, toMin(t.end));
  }
  const tagISO = (min) => local(toDate(min)).slice(0, 10);
  const mitternacht = (min) => toMin(tagISO(min) + 'T00:00');
  // Der Endtag gehört ganz dazu: ein Act bis 21:50 darf das Blatt nicht bei
  // 21:50 abschneiden. Beginnt das Ende exakt auf Mitternacht, ist der Tag
  // bereits voll — sonst käme ein leerer Tag dazu.
  //
  // Der nächste Tagesanfang wird über den KALENDER gesucht, nicht mit +1440:
  // der 25.10.2026 hat 25 Stunden, und aus Minuten gerechnet endete das Fenster
  // um 23:00 statt um Mitternacht.
  let end = mitternacht(b);
  if (end !== b) {
    const d = toDate(end);
    d.setDate(d.getDate() + 1);
    end = toMin(local(d));
  }
  return { start: local(toDate(mitternacht(a))), end: local(toDate(end)) };
}
