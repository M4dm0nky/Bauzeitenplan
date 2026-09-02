// ── Die Schiene: der Modus, sonst nichts ─────────────────────────────────────
// Genau ein Modus ist aktiv — Bauzeitenplan ODER Showablauf. Unten das Zahnrad.
// Drei Einträge, mehr nicht.
//
// Sie trug in v0.12.0 zusätzlich die TAGE des aktiven Modus. Das war ein
// schlechter Tausch: zwei Showtage passten, aber ein Bauzeitenplan über zwei
// Wochen ergab vierzehn Datumszeilen in einer 108 px schmalen Spalte — und
// damit genau die Überladung, gegen die der Umbau angetreten war. Der Tag wird
// jetzt über den Kalender-Knopf in der Werkzeugzeile gewählt, und dort stehen
// nur Tage, die es im Plan wirklich gibt (`tagWahl` in app.js).
//
// Sie RENDERT nur. Sie schreibt nie an `ansicht` oder am Gantt — alles läuft
// über die Rückrufe nach app.js, wo `setAnsicht()` der einzige Schreiber
// bleibt. Dieselbe Arbeitsteilung wie bei js/bedarf.js.

import { el } from './dom.js';

export function createRail(root, { on = {} } = {}) {
  let ebene = 'bau';

  /** Ein Moduseintrag: großes Ziel, Zeichen über Wort. */
  function modus(name, zeichen, wort) {
    const b = el('button', 'rail-m');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(ebene === name));
    b.append(el('span', 'rail-z', zeichen), el('span', 'rail-w', wort));
    b.onclick = () => on.modus?.(name);
    return b;
  }

  function render() {
    root.replaceChildren();
    root.append(modus('bau', '▤', 'Bauzeitenplan'));
    root.append(modus('show', '♫', 'Showablauf'));
    root.append(el('div', 'rail-sp'));

    const ein = el('button', 'rail-m rail-ein');
    ein.type = 'button';
    ein.id = 'rail-ein';
    ein.append(el('span', 'rail-z', '⚙'), el('span', 'rail-w', 'Einrichten'));
    ein.onclick = () => on.einrichten?.();
    root.append(ein);
  }

  return {
    render,
    setEbene(e) {
      ebene = e === 'show' ? 'show' : 'bau';
      render();
    },
  };
}
