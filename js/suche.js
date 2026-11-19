// ── Die Suche: Feld in der Kopfzeile + Trefferliste ──────────────────────────
// Rendert nur. Gerechnet wird in schedule.js (`suchTreffer`, DOM-frei und
// getestet), gesprungen in app.js — dieses Modul kennt weder Store noch Gantt,
// es meldet die Wahl über `onWahl(taskId)`. Dieselbe Arbeitsteilung wie bei
// rail.js und bedarf.js.
//
// Bedienung wie ein Combobox-Feld: Tippen füllt die Liste, ↑/↓ wählen, Enter
// springt, Escape schließt UND leert. Der Fokus bleibt im Feld (die Einträge
// nehmen ihn per mousedown nicht), deshalb braucht kein Eintrag einen eigenen
// Tab-Stopp — Enter und Leertaste gehören dem Feld.
//
// `/` öffnet die Suche von überall, AUSSER dort, wo getippt wird: in einem
// Tabellenfeld ist «/» ein Zeichen, kein Befehl.

import { el } from './dom.js';
import { suchTreffer } from './schedule.js';
import { gewerkVar } from './palette.js';
import { verschoben } from './live.js';

/** «2026-08-29T15:20» → «29.08. 15:20» — nur Anzeige, gerechnet wird hier nichts. */
const kurz = (iso) => {
  const s = String(iso || '');
  return s.length >= 16 ? s.slice(8, 10) + '.' + s.slice(5, 7) + '. ' + s.slice(11, 16) : '';
};

const TIPPT = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/**
 * @param {HTMLInputElement} input
 * @param {HTMLElement} liste
 * @param {{daten:()=>{tasks:object[],gewerke:object[],versatz?:number,ebene?:string}, onWahl:(id:string)=>void, blockiert?:()=>boolean}} o
 */
export function createSuche(input, liste, { daten, onWahl, blockiert = () => false }) {
  let treffer = [];      // flache Liste der Einträge in Anzeigereihenfolge
  let aktiv = -1;

  const offen = () => !liste.hidden;

  function zu() {
    liste.hidden = true;
    liste.replaceChildren();
    treffer = [];
    aktiv = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }

  function platziere() {
    const r = input.getBoundingClientRect();
    const w = Math.min(420, window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    const top = r.bottom + 4;
    liste.style.left = left + 'px';
    liste.style.top = top + 'px';
    liste.style.width = w + 'px';
    liste.style.maxHeight = Math.max(160, window.innerHeight - top - 12) + 'px';
  }

  function markiere(i, scroll = true) {
    aktiv = i;
    liste.querySelectorAll('.suche-i').forEach((n, k) => {
      n.classList.toggle('is-aktiv', k === i);
      n.setAttribute('aria-selected', String(k === i));
      if (k === i) {
        input.setAttribute('aria-activedescendant', n.id);
        if (scroll) n.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function wahl(i) {
    const t = treffer[i];
    if (!t) return;
    zu();
    input.value = '';
    input.blur();
    onWahl(t.id);
  }

  function render() {
    const q = input.value;
    if (!q.trim()) { zu(); return; }
    const { tasks, gewerke, versatz = 0, ebene = 'bau' } = daten();
    const { groups, weitere } = suchTreffer({ tasks, gewerke, query: q });
    liste.replaceChildren();
    treffer = [];
    if (!groups.length) {
      liste.append(el('div', 'suche-leer', 'Keine Treffer'));
    }
    for (const g of groups) {
      const kopf = el('div', 'suche-g');
      if (g.gewerk.slot != null) {
        const dot = el('span', 'bz-dot');
        dot.style.setProperty('--gw', gewerkVar(g.gewerk.slot));
        kopf.append(dot);
      }
      kopf.append(el('span', 'suche-gn', g.gewerk.name));
      liste.append(kopf);
      for (const t of g.items) {
        const i = treffer.length;
        treffer.push(t);
        const b = el('button', 'suche-i');
        b.type = 'button';
        b.id = 'suche-i-' + i;
        b.tabIndex = -1;
        b.setAttribute('role', 'option');
        b.append(el('span', 'suche-t', t.title), el('span', 'suche-z', kurz(verschoben(t.start, versatz))));
        // mousedown nähme dem Feld den Fokus — und mit ihm die Tastatur.
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => wahl(i));
        liste.append(b);
      }
    }
    if (weitere > 0) liste.append(el('div', 'suche-w', '+ ' + weitere + ' weitere — Suchwort genauer fassen'));
    liste.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    platziere();
    markiere(treffer.length ? 0 : -1, false);
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('blur', zu);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();                     // ⌘Z und Co. gehören hier dem Feld
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!treffer.length) return;
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      markiere((aktiv + d + treffer.length) % treffer.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (treffer.length) wahl(aktiv >= 0 ? aktiv : 0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      zu();
      input.value = '';
      input.blur();
    }
  });
  window.addEventListener('resize', () => { if (offen()) platziere(); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const ziel = e.target;
    if (ziel && ziel.closest && ziel.closest(TIPPT)) return;   // dort ist «/» ein Zeichen
    if (blockiert()) return;
    e.preventDefault();
    input.focus();
    input.select();
  });

  return {
    focus() { input.focus(); },
    close() { zu(); },
    get offen() { return offen(); },
  };
}
