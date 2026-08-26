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
 * Die Gegenrichtung, für die Farbauswahl: welcher Farbton steckt in einem Platz,
 * und wie baut man aus Farbton + Schraffur wieder einen Platz?
 *
 * Ein Platz ist genau das Paar (Farbton, Schraffur) — deshalb reichen zehn
 * Punkte und ein Schalter, um alle zwanzig zu erreichen. Gewählt wird AUS der
 * Palette; keine Farbe wird dabei umdefiniert (siehe docs/farbsuche.md).
 */
export const hueVon = (slot) => (((slot | 0) % HUES) + HUES) % HUES;

/**
 * Die Schriftfarbe AUF diesem Farbton. Sie steht in base.css neben der Farbe
 * selbst und ist dort gerechnet: je Ton die Tinte, die in hell UND dunkel über
 * 3:1 bleibt. Hier wird sie nur benannt — eine zweite Wahrheit über Farben wäre
 * genau die Sorte Fehler, die niemand bemerkt.
 */
export const gewerkInkVar = (slot) => 'var(--gw-t-' + hueVon(slot) + ')';
export const slotAus = (hue, schraffur) => hueVon(hue) + (schraffur ? HUES : 0);

/**
 * Reicht die Palette noch? Ab 21 Gewerken trägt Farbe die Identität nicht mehr —
 * dann muss die Beschriftung sie allein tragen, und das ist eine Warnung wert.
 */
export const slotsExhausted = (count) => count > MAX_SLOTS;
