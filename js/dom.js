// ── DOM-Kleinkram ─────────────────────────────────────────────────────────────
// Lag vorher fünfmal identisch in app, gantt, inspector, menu und table.
//
// Nebenbei eine Falle entschärft: tools/build-prototypes.mjs prüft das Bündel
// auf doppelte Deklarationen (seit der «local»-Kollision). Hätte jemand
// inspector.js dazugenommen, wäre der Build an fünf `el` gescheitert.

/** Element mit Klasse und Textinhalt. textContent, nie innerHTML. */
export const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

export const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

export const $ = (id) => document.getElementById(id);

/** Für innerHTML-Stellen. Wo es geht, lieber el() + textContent nehmen. */
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** «2026-07-13T08:00» — genau das Format, das <input type="datetime-local"> will. */
export const toInput = (iso) => String(iso || '').slice(0, 16);

/** Statuswerte samt Beschriftung. Eine Wahrheit für Tabelle und Panel. */
export const STATUS = [['geplant', 'geplant'], ['laeuft', 'läuft'], ['fertig', 'fertig']];
