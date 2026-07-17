// ── Gewerk-Farben ─────────────────────────────────────────────────────────────
// Acht validierte Farbtöne (tools/farbsuche.mjs, docs/farbsuche.md). Sie stehen
// in styles/base.css als --gw-0 … --gw-7 und werden HIER NICHT dupliziert —
// eine zweite Wahrheit über Farben wäre genau die Sorte Fehler, die niemand
// bemerkt.
//
// Ab dem 11. Gewerk wiederholen sich die Farbtöne. Damit die Zuordnung trotzdem
// eindeutig bleibt, kommt ein zweiter Kanal dazu: 45°-Schraffur. Das ist die
// vom Verfahren vorgesehene zusammengesetzte Kodierung, keine Notlösung.
// 10 Farbtöne × 2 Schraffurstufen = 20 unterscheidbare Gewerke.
//
// Acht Töne sind farbsuche-validiert; der neunte (--gw-8, Ocker) und zehnte
// (--gw-9, Türkis) sind Handergänzungen auf Ansage für den Klassentreffen-Plan
// (>8 Gewerke). Bleibt der Bedarf, gehört die Farbsuche für zehn Töne neu
// gerechnet (docs/farbsuche.md).
//
// Der Farbplatz (`slot`) gehört dem Gewerk und ist stabil: Umsortieren oder
// Löschen anderer Gewerke färbt nichts um.

export const HUES = 10;
export const MAX_SLOTS = 20;

/** CSS-Variable für den Farbton eines Platzes. */
export const gewerkVar = (slot) => 'var(--gw-' + (((slot % HUES) + HUES) % HUES) + ')';

/** Ab dem 11. Platz zusätzlich Schraffur. */
export const gewerkTexture = (slot) => Math.floor((slot % MAX_SLOTS) / HUES) > 0;

/**
 * Reicht die Palette noch? Ab 21 Gewerken trägt Farbe die Identität nicht mehr —
 * dann muss die Beschriftung sie allein tragen, und das ist eine Warnung wert.
 */
export const slotsExhausted = (count) => count > MAX_SLOTS;
