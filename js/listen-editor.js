// ── Auswahllisten bearbeiten (Eintragsarten, Abschnitte, Personal, Maschinen) ──
// Aus table.js herausgelöst, damit derselbe Baustein im schwebenden Kasten der
// Tabelle UND direkt auf der Einrichten-Seite hängt. Eine Quelle für die
// Bedienung: umbenennen, sortieren, löschen.
//
// Gezeichnet wird bei jeder Änderung neu AUS DEM STORE, nie aus dem, was im
// Feld steht: ein abgelehnter Befehl (doppelter Name, noch benutzt) darf keinen
// Zustand hinterlassen, den nur diese Liste kennt.
import { el } from './dom.js';
import { nachSort } from './ebene.js';
import { benutztVon } from './store.js';
import { RES_KATEGORIEN, RES_EINGEBAUT } from './res-katalog.js';

/**
 * Hängt die Zeilen einer Auswahlliste in `container`.
 *
 * `send(cmd)` ist der Schreibweg der Umgebung (Tabelle: zeigt Fehler an und baut
 * neu auf); `kind` zeigt nur Personal ODER Maschinen — Sortieren tauscht dann
 * mit dem nächsten Eintrag derselben Art. `nachZeichnen` (optional) läuft nach
 * jedem Zeichnen, der schwebende Kasten richtet sich dort neu aus.
 * Rückgabe: `refresh()` für Aufrufer, wenn der Store anderswo geändert wurde.
 */
export function mountAuswahlListe(container, { store, send, liste, kind, leerText, nachZeichnen }) {
  // In DERSELBEN Reihenfolge wie das Auswahlfeld: `reorderAuswahl` setzt nur
  // `sort`, es dreht das Array nicht um. Ohne das Sortieren hier bliebe die
  // Liste nach einem Klick auf ↑ sichtbar unverändert.
  // Ohne `kind` zählt eine Ressource als Personal (wie `resKind` in resources.js:
  // Altdaten kennen das Feld nicht und fielen sonst aus beiden Listen).
  const daten = () => {
    const alle = nachSort(store.state.project[liste]);
    return { alle, eigene: kind ? alle.filter((x) => (x.kind || 'personal') === kind) : alle };
  };

  // Zeilen nach id wiederverwendet: ein Neubau tauschte Knöpfe unter dem Mauszeiger
  // aus (mousedown nimmt dem Namensfeld den Fokus → Änderung → Neubau → mouseup auf
  // einem neuen Knoten = kein click). Handler lesen frisch aus dem Store.
  const zeilen = new Map();   // id → { zeile, nam, hoch, runter, weg, art }
  const leer = el('div', 'tb-verw-leer', leerText);

  // Die eingebauten Helfer/Maschinen (Katalog) stehen gruppiert und schreibgeschützt
  // OBEN, vor den eigenen: kein Namensfeld, keine Knöpfe (daher auch keine Klassen
  // `tb-verw-z`/`-n`, die die Zeilenlogik unten zählt). Der Block ist EIN Kind des
  // Containers — `vorn` rechnet ihn aus den Indizes der eigenen Zeilen heraus.
  let fest = null;
  if (liste === 'ressourcen' && kind) {
    fest = el('details', 'tb-verw-fest');
    fest.open = true;
    const eing = RES_EINGEBAUT.filter((r) => r.kind === kind);
    fest.append(el('summary', null, '🔒 Eingebaut (' + eing.length + ') — fest, nicht änderbar'));
    for (const k of RES_KATEGORIEN.filter((c) => c.kind === kind)) {
      const items = eing.filter((r) => r.kat === k.id);
      if (!items.length) continue;   // «Eigene …» hat keine festen Einträge
      fest.append(el('div', 'tb-verw-fkat', k.label));
      for (const r of items) fest.append(el('div', 'tb-verw-fitem', '🔒 ' + r.label));
    }
    container.append(fest);
  }
  const vorn = fest ? 1 : 0;

  function baueZeile(id) {
    const zeile = el('div', 'tb-verw-z');
    const nam = el('input', 'tb-verw-n');
    nam.setAttribute('aria-label', 'Name');
    nam.onchange = () => {
      const r = send({ type: 'setAuswahlLabel', liste, id, label: nam.value });
      // Abgelehnt: zurück auf den echten Stand (auch im Fokus). Erfolg: nur angleichen (z. B. getrimmt).
      const jetzt = (store.state.project[liste] || []).find((e) => e.id === id);
      if (jetzt && jetzt.label !== nam.value) nam.value = jetzt.label;
      if (r && r.ok === false) nam.focus();
    };
    const hoch = el('button', 'tb-verw-b', '↑');
    hoch.title = 'Nach oben';
    const runter = el('button', 'tb-verw-b', '↓');
    runter.title = 'Nach unten';
    // `reorderAuswahl` verlangt ALLE ids der Liste. Mit `kind` stehen hier nur
    // die einer Art: also die volle Reihenfolge nehmen und genau die zwei
    // Nachbarn derselben Art tauschen.
    const tausche = (d) => {
      const { alle, eigene } = daten();
      const i = eigene.findIndex((e) => e.id === id);
      const j = i + d;
      if (i < 0 || j < 0 || j >= eigene.length) return;
      const ids = alle.map((e) => e.id);
      const a = ids.indexOf(eigene[i].id);
      const b = ids.indexOf(eigene[j].id);
      [ids[a], ids[b]] = [ids[b], ids[a]];
      send({ type: 'reorderAuswahl', liste, ids });
      zeichne();
    };
    hoch.onclick = () => tausche(-1);
    runter.onclick = () => tausche(1);
    const weg = el('button', 'tb-verw-b tb-verw-x', '×');
    weg.onclick = () => { if (!weg.disabled) { send({ type: 'removeAuswahl', liste, id }); zeichne(); } };
    zeile.append(nam, hoch, runter, weg);
    const rec = { zeile, nam, hoch, runter, weg, art: null };
    zeilen.set(id, rec);
    return rec;
  }

  function zeichne() {
    const { eigene } = daten();
    const ids = new Set(eigene.map((x) => x.id));
    for (const [id, r] of zeilen) if (!ids.has(id)) { r.zeile.remove(); zeilen.delete(id); }
    leer.remove();
    if (!eigene.length) container.append(leer);
    for (const [i, x] of eigene.entries()) {
      const r = zeilen.get(x.id) || baueZeile(x.id);
      if (container.children[vorn + i] !== r.zeile) container.insertBefore(r.zeile, container.children[vorn + i] || null);
      if (document.activeElement !== r.nam && r.nam.value !== x.label) r.nam.value = x.label;
      r.hoch.disabled = i === 0;
      r.runter.disabled = i === eigene.length - 1;
      // Wie viele hängen dran? Der STORE zählt — er weiß, welches Feld am
      // Vorgang auf diese Liste zeigt. Wüsste die Verwaltung es auch, wären es
      // zwei Wahrheiten, und bei einer dritten Liste vergisst man eine davon.
      const benutzt = benutztVon(store.state, liste, x.id);
      r.weg.disabled = !!benutzt;
      r.weg.title = benutzt
        ? `Wird von ${benutzt} ${benutzt === 1 ? 'Zeiteintrag' : 'Zeiteinträgen'} benutzt`
        : 'Löschen';
      // Ressourcen ohne `kind` mischen Personal und Maschinen in EINER Liste;
      // ein Kürzel sagt wenigstens, was man vor sich hat. Mit `kind` ist die Art
      // ohnehin klar.
      // Eigene Ressource: ihre Kategorie als Beschriftung (Altdaten/unbekannt: «Eigene …»).
      if (liste === 'ressourcen') {
        const kk = x.kind || 'personal';
        const k = RES_KATEGORIEN.find((c) => c.id === x.kat && c.kind === kk)
          || RES_KATEGORIEN.find((c) => c.id === (kk === 'maschine' ? 'eigene-m' : 'eigene-p'));
        if (!r.kat) { r.kat = el('span', 'tb-verw-kat'); r.zeile.insertBefore(r.kat, r.hoch); }
        if (r.kat.textContent !== k.label) r.kat.textContent = k.label;
      }
      const art = x.kind && !kind ? x.kind : null;
      if (art !== r.art) {
        r.zeile.querySelector('.tb-verw-kind')?.remove();
        if (art) r.zeile.prepend(el('span', 'tb-verw-kind', art === 'maschine' ? '⚙' : '👤'));
        r.art = art;
      }
    }
    nachZeichnen?.();
  }

  zeichne();
  return { refresh: zeichne };
}
