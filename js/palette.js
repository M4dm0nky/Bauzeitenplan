// ── Gewerk-Farben ─────────────────────────────────────────────────────────────
// Acht validierte Farbtöne (tools/farbsuche.mjs, docs/farbsuche.md). Sie stehen
// in styles/base.css als --gw-0 … --gw-7 und werden HIER NICHT dupliziert —
// eine zweite Wahrheit über Farben wäre genau die Sorte Fehler, die niemand
// bemerkt.
//
// Ab Gewerk 9 wiederholen sich die Farbtöne. Damit die Zuordnung trotzdem
// eindeutig bleibt, kommt ein zweiter Kanal dazu: 45°-Schraffur. Das ist die
// vom Verfahren vorgesehene zusammengesetzte Kodierung, keine Notlösung.
// 8 Farbtöne × 2 Schraffurstufen = 16 unterscheidbare Gewerke.
//
// Der Farbplatz (`slot`) gehört dem Gewerk und ist stabil: Umsortieren oder
// Löschen anderer Gewerke färbt nichts um.

export const HUES = 8;
export const MAX_SLOTS = 16;

/** CSS-Variable für den Farbton eines Platzes. */
export const gewerkVar = (slot) => 'var(--gw-' + (((slot % HUES) + HUES) % HUES) + ')';

/** Ab dem 9. Platz zusätzlich Schraffur. */
export const gewerkTexture = (slot) => Math.floor((slot % MAX_SLOTS) / HUES) > 0;

/** Attribute für einen Knoten, der die Gewerk-Identität trägt. */
export function applyGewerk(node, slot) {
  node.style.setProperty('--gw', gewerkVar(slot));
  if (gewerkTexture(slot)) node.dataset.tex = '1';
  else delete node.dataset.tex;
  return node;
}

/**
 * Reicht die Palette noch? Ab 17 Gewerken trägt Farbe die Identität nicht mehr —
 * dann muss die Beschriftung sie allein tragen, und das ist eine Warnung wert.
 */
export const slotsExhausted = (count) => count > MAX_SLOTS;
