// ── Gewerk-Farben ─────────────────────────────────────────────────────────────
// Acht validierte Farbtöne (tools/farbsuche.mjs, docs/farbsuche.md). Sie stehen
// in styles/base.css als --gw-0 … --gw-7 und werden HIER NICHT dupliziert —
// eine zweite Wahrheit über Farben wäre genau die Sorte Fehler, die niemand
// bemerkt.
//
// Ab dem 10. Gewerk wiederholen sich die Farbtöne. Damit die Zuordnung trotzdem
// eindeutig bleibt, kommt ein zweiter Kanal dazu: 45°-Schraffur. Das ist die
// vom Verfahren vorgesehene zusammengesetzte Kodierung, keine Notlösung.
// 9 Farbtöne × 2 Schraffurstufen = 18 unterscheidbare Gewerke.
//
// Acht Töne sind farbsuche-validiert; der neunte (--gw-8, Ocker) ist eine
// Handergänzung auf Ansage für den Klassentreffen-Plan mit >8 Gewerken. Bleibt
// der Bedarf, gehört die Farbsuche für neun Töne neu gerechnet (docs/farbsuche.md).
//
// Der Farbplatz (`slot`) gehört dem Gewerk und ist stabil: Umsortieren oder
// Löschen anderer Gewerke färbt nichts um.

export const HUES = 9;
export const MAX_SLOTS = 18;

/** CSS-Variable für den Farbton eines Platzes. */
export const gewerkVar = (slot) => 'var(--gw-' + (((slot % HUES) + HUES) % HUES) + ')';

/** Ab dem 10. Platz zusätzlich Schraffur. */
export const gewerkTexture = (slot) => Math.floor((slot % MAX_SLOTS) / HUES) > 0;

/**
 * Reicht die Palette noch? Ab 19 Gewerken trägt Farbe die Identität nicht mehr —
 * dann muss die Beschriftung sie allein tragen, und das ist eine Warnung wert.
 */
export const slotsExhausted = (count) => count > MAX_SLOTS;
