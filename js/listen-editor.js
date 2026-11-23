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
  const zeichne = () => {
    // In DERSELBEN Reihenfolge wie das Auswahlfeld: `reorderAuswahl` setzt nur
    // `sort`, es dreht das Array nicht um. Ohne das Sortieren hier bliebe die
    // Liste nach einem Klick auf ↑ sichtbar unverändert.
    const alle = nachSort(store.state.project[liste]);
    // Ohne `kind` zählt eine Ressource als Personal (wie `resKind` in resources.js:
    // Altdaten kennen das Feld nicht und fielen sonst aus beiden Listen).
    const eigene = kind ? alle.filter((x) => (x.kind || 'personal') === kind) : alle;
    container.replaceChildren();

    if (!eigene.length) container.append(el('div', 'tb-verw-leer', leerText));
    for (const [i, x] of eigene.entries()) {
      const zeile = el('div', 'tb-verw-z');

      const nam = el('input', 'tb-verw-n');
      nam.value = x.label;
      nam.setAttribute('aria-label', 'Name');
      nam.onchange = () => {
        const r = send({ type: 'setAuswahlLabel', liste, id: x.id, label: nam.value });
        zeichne();                       // auch bei Ablehnung: zurück auf den echten Stand
        if (r && r.ok === false) nam.focus();
      };

      const hoch = el('button', 'tb-verw-b', '↑');
      hoch.title = 'Nach oben';
      hoch.disabled = i === 0;
      const runter = el('button', 'tb-verw-b', '↓');
      runter.title = 'Nach unten';
      runter.disabled = i === eigene.length - 1;
      // `reorderAuswahl` verlangt ALLE ids der Liste. Mit `kind` stehen hier nur
      // die einer Art: also die volle Reihenfolge nehmen und genau die zwei
      // Nachbarn derselben Art tauschen.
      const tausche = (j) => {
        const ids = alle.map((e) => e.id);
        const a = ids.indexOf(eigene[i].id);
        const b = ids.indexOf(eigene[j].id);
        [ids[a], ids[b]] = [ids[b], ids[a]];
        send({ type: 'reorderAuswahl', liste, ids });
        zeichne();
      };
      hoch.onclick = () => tausche(i - 1);
      runter.onclick = () => tausche(i + 1);

      // Wie viele hängen dran? Der STORE zählt — er weiß, welches Feld am
      // Vorgang auf diese Liste zeigt. Wüsste die Verwaltung es auch, wären es
      // zwei Wahrheiten, und bei einer dritten Liste vergisst man eine davon.
      const benutzt = benutztVon(store.state, liste, x.id);
      const weg = el('button', 'tb-verw-b tb-verw-x', '×');
      if (benutzt) {
        weg.disabled = true;
        weg.title = `Wird von ${benutzt} ${benutzt === 1 ? 'Zeiteintrag' : 'Zeiteinträgen'} benutzt`;
      } else {
        weg.title = 'Löschen';
        weg.onclick = () => { send({ type: 'removeAuswahl', liste, id: x.id }); zeichne(); };
      }

      // Ressourcen ohne `kind` mischen Personal und Maschinen in EINER Liste;
      // ein Kürzel sagt wenigstens, was man vor sich hat. Mit `kind` ist die Art
      // ohnehin klar.
      if (x.kind && !kind) zeile.append(el('span', 'tb-verw-kind', x.kind === 'maschine' ? '⚙' : '👤'));
      zeile.append(nam, hoch, runter, weg);
      container.append(zeile);
    }
    nachZeichnen?.();
  };

  zeichne();
  return { refresh: zeichne };
}
