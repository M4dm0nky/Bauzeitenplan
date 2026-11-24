// ── Such-Auswahl für Helfer und Maschinen ─────────────────────────────────────
// Ersetzt das <select> in Panel und Tabelle: der Katalog hat über dreißig
// Einträge in Kategorien, das ist für eine Aufklappliste zu lang (Regel: lange
// Listen nie als <select>). Der Kasten schwebt am Anker, das Suchfeld hat den
// Fokus; getippt wird gefiltert (`resGruppen` — DOM-frei, in resources.js), die
// Kategorien bleiben als Kopfzeile stehen.
//
// Wie `neuFragen` (table.js): nur EIN Kasten gleichzeitig, hängt an body, nimmt
// ein Rechteck statt eines Knotens — Panel und Tabelle bauen nach jedem Befehl
// neu auf, der Anker ist dann abgehängt.
import { el } from './dom.js';
import { resGruppen, resStatusInfo } from './resources.js';
import { RES_KATEGORIEN } from './res-katalog.js';

let zuMerker = null;

/** Steht gerade ein Picker offen? Die schwebenden Kästen der Tabelle fragen das,
 * damit Escape nur den obersten schließt. */
export const resPickerOffen = () => !!zuMerker;

/** Das Statuszeichen einer Zuweisung (⏳ ✓ ✕, Farbe nur zusätzlich). Bereitstellungen
 * haben keinen Status — dort ruft niemand das hier auf. */
export function resStatusMarke(z) {
  const i = resStatusInfo(z);
  const m = el('span', 'res-st res-st-' + i.status, i.symbol);
  m.title = i.titel;
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', i.titel);
  return m;
}

/** Optionen für `neuFragen` beim Ablehnen: ein optionaler Grund. */
export function ablehnenOpt(id, index) {
  return {
    titel: 'Ablehnen — Grund (optional)', okText: 'Ablehnen',
    buildCmd: (wert) => resStatusCmd(id, index, 'abgelehnt', String(wert || '').trim()),
  };
}

/** Der Befehl für einen Statuswechsel. `am` setzt die Oberfläche (der Store ist uhrfrei). */
export function resStatusCmd(id, index, status, notiz) {
  return { type: 'setResStatus', id, index, status, ...(notiz ? { notiz } : {}), am: new Date().toISOString() };
}

/** Optionen für `neuFragen`: Name UND Kategorie (nur die der eigenen Art,
 * Vorgabe «Eigene …»). Der Befehl bekommt `kat` zum Namen dazu. */
export function resNeuOpt(kind) {
  const kats = RES_KATEGORIEN.filter((k) => k.kind === kind);
  return {
    titel: 'Neue Bezeichnung (' + (kind === 'personal' ? 'Personal' : 'Maschine') + ')',
    auswahlTitel: 'Kategorie',
    auswahl: kats.map((k) => ({ wert: k.id, label: k.label })),
    auswahlVorgabe: kats[kats.length - 1].id,   // «Eigene Maschinen» / «Eigenes Personal» stehen zuletzt
    buildCmd: (wert, _kompakt, kat) => ({ type: 'addRessource', kind, label: wert, kat }),
  };
}

/**
 * @param {{anker: Element, kind: 'personal'|'maschine', state: object, aktuell?: string,
 *   onWahl: (rid:string)=>void, onNeu: ()=>void}} o
 */
export function openResPicker({ anker, kind, state, aktuell, onWahl, onNeu }) {
  zuMerker?.();
  const rect = anker.getBoundingClientRect();
  const box = el('div', 'rp-pop');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', kind === 'personal' ? 'Personal wählen' : 'Maschine wählen');

  const such = el('input', 'rp-such');
  such.type = 'search';
  such.setAttribute('aria-label', 'Suchen');
  const liste = el('div', 'rp-liste');
  liste.setAttribute('role', 'listbox');
  const neu = el('button', 'rp-neu', '+ Neu…');
  neu.type = 'button';
  box.append(such, liste, neu);
  document.body.append(box);

  let items = [];       // sichtbare Einträge (Knoten), in Anzeigereihenfolge
  let aktiv = -1;

  const markiere = (i) => {
    items.forEach((n, k) => {
      n.classList.toggle('is-aktiv', k === i);
      n.setAttribute('aria-selected', k === i ? 'true' : 'false');
    });
    aktiv = i;
    items[i]?.scrollIntoView?.({ block: 'nearest' });
  };

  const zeichne = () => {
    liste.replaceChildren();
    items = [];
    const gruppen = resGruppen(state, kind, such.value);
    if (!gruppen.length) {
      liste.append(el('div', 'rp-leer', 'Keine Treffer'));
      aktiv = -1;
      return;
    }
    for (const g of gruppen) {
      liste.append(el('div', 'rp-kopf', g.label));
      for (const r of g.items) {
        const b = el('button', 'rp-item' + (r.id === aktuell ? ' is-aktuell' : ''));
        b.type = 'button';
        b.setAttribute('role', 'option');
        b.dataset.rid = r.id;
        b.append(el('span', 'rp-ok', r.id === aktuell ? '✓' : ''), el('span', null, r.label));
        b.onclick = () => wahl(r.id);
        items.push(b);
        liste.append(b);
      }
    }
    // Start: der aktuelle Eintrag, sonst der erste Treffer — Enter wählt ihn.
    const a = items.findIndex((n) => n.dataset.rid === aktuell);
    markiere(a >= 0 ? a : 0);
  };

  const zu = () => {
    box.remove();
    window.removeEventListener('keydown', aufTaste, true);
    document.removeEventListener('pointerdown', aussen, true);
    wacht.disconnect();
    if (zuMerker === zu) zuMerker = null;
  };
  zuMerker = zu;
  // Panel/Tabelle bauen nach Undo, Sync, Befehl neu auf: ist der Anker abgehängt,
  // zeigt `onWahl` auf eine tote Zeile — der Picker schließt sich dann.
  const wacht = new MutationObserver(() => { if (!anker.isConnected) zu(); });
  wacht.observe(document.body, { childList: true, subtree: true });
  const wahl = (rid) => { const ok = anker.isConnected; zu(); if (ok) onWahl(rid); };

  const aufTaste = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); zu(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && box.contains(e.target)) {
      e.preventDefault();
      if (!items.length) return;
      markiere((aktiv + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Enter' && box.contains(e.target) && e.target !== neu) {
      e.preventDefault();
      // Fokus auf einem Eintrag (Tab): der fokussierte gilt, nicht die Pfeil-Markierung.
      const fokus = e.target.closest && e.target.closest('.rp-item');
      const ziel = fokus || items[aktiv];
      if (ziel) wahl(ziel.dataset.rid);
    }
  };
  const aussen = (e) => { if (!box.contains(e.target)) zu(); };

  such.oninput = zeichne;
  neu.onclick = () => { zu(); onNeu(); };
  window.addEventListener('keydown', aufTaste, true);
  document.addEventListener('pointerdown', aussen, true);

  zeichne();
  // Ausrichten wie neuFragen: am Anker, am Rand umklappen.
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - r.width - 8)) + 'px';
  box.style.top = (rect.bottom + r.height > window.innerHeight - 8
    ? Math.max(8, rect.top - r.height - 4) : rect.bottom + 4) + 'px';
  such.focus();
}

