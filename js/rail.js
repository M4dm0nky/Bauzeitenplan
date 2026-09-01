// ── Die Schiene: Modus UND Zeitnavigation ────────────────────────────────────
// Genau ein Modus ist aktiv — Bauzeitenplan ODER Showablauf. Unter dem aktiven
// stehen SEINE Tage: im Showablauf die Showtage, im Bauzeitenplan die Bautage
// des Projektzeitraums. Damit ist die Schiene zugleich die Zeitnavigation, und
// ◀▶ sowie die Showtag-Segmentgruppe konnten aus der Werkzeugzeile verschwinden.
//
// Sie RENDERT nur. Sie schreibt nie an `ansicht`, `showTag` oder am Gantt —
// alles läuft über die Rückrufe nach app.js, wo `setAnsicht()` der einzige
// Schreiber bleibt. Dieselbe Arbeitsteilung wie bei js/bedarf.js.

import { sichtTasks, programmTage } from './ebene.js';
import { isoWeek } from './timeaxis.js';
import { el } from './dom.js';

/** Ein ISO-Tag als «Mo 25.08.» — die Schiene ist schmal, mehr passt nicht. */
const tagLabel = (iso) => new Date(iso + 'T12:00')
  .toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });

/** Alle Kalendertage von `vonISO` bis `bisISO` einschließlich. */
function tageZwischen(vonISO, bisISO) {
  const out = [];
  if (!vonISO || !bisISO) return out;
  const d = new Date(vonISO + 'T12:00');
  const ende = new Date(bisISO + 'T12:00');
  // Ein Plan über Jahre wäre ein Bedienfehler, kein Anwendungsfall — die
  // Obergrenze verhindert nur, dass ein kaputtes Datum die Seite einfriert.
  for (let i = 0; d <= ende && i < 400; i++) {
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0'));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function createRail(root, { store, on = {} } = {}) {
  let ebene = 'bau';
  let showTag = null;
  let bauTag = null;

  /** Ein Moduseintrag: großes Ziel, Kürzel oben, Wort darunter. */
  function modus(name, zeichen, wort) {
    const b = el('button', 'rail-m');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(ebene === name));
    b.append(el('span', 'rail-z', zeichen), el('span', 'rail-w', wort));
    b.onclick = () => on.modus?.(name);
    return b;
  }

  /** Ein Tag in der Liste unter dem aktiven Modus. */
  function tag(iso, aktiv, klick) {
    const b = el('button', 'rail-t', tagLabel(iso));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(aktiv));
    b.dataset.tag = iso;
    b.onclick = () => klick(iso);
    return b;
  }

  function render() {
    const S = store.state;
    root.replaceChildren();

    root.append(modus('bau', '▤', 'Bauzeitenplan'));
    if (ebene === 'bau') {
      const liste = el('div', 'rail-tage');
      let kw = null;
      for (const iso of tageZwischen((S.project.start || '').slice(0, 10), (S.project.end || '').slice(0, 10))) {
        const w = isoWeek(new Date(iso + 'T12:00'));
        // Ein Bauzeitenplan läuft über Wochen — ohne Trenner ist eine Liste
        // aus vierzehn Datumsangaben nicht zu überblicken.
        if (w !== kw) { kw = w; liste.append(el('div', 'rail-kw', 'KW ' + w)); }
        liste.append(tag(iso, iso === bauTag, (t) => on.bauTag?.(t)));
      }
      if (!liste.children.length) liste.append(el('div', 'rail-leer', 'kein Zeitraum'));
      root.append(liste);
    }

    root.append(modus('show', '♫', 'Showablauf'));
    if (ebene === 'show') {
      const liste = el('div', 'rail-tage');
      const tage = programmTage(sichtTasks(S, 'show'));
      for (const iso of tage) liste.append(tag(iso, iso === showTag, (t) => on.showTag?.(t)));
      // Eine frisch angelegte Bühne hat noch keinen Eintrag und damit keinen
      // Tag. Ein leerer Platz sagt hier mehr als gar nichts — sonst sieht der
      // Showablauf aus, als fehle ihm die Navigation.
      if (!tage.length) liste.append(el('div', 'rail-leer', 'noch kein Showtag'));
      root.append(liste);
    }

    root.append(el('div', 'rail-sp'));

    const ein = el('button', 'rail-m rail-ein');
    ein.type = 'button';
    ein.id = 'rail-ein';
    ein.append(el('span', 'rail-z', '⚙'), el('span', 'rail-w', 'Einrichten'));
    ein.onclick = () => on.einrichten?.();
    root.append(ein);

    // Vierzehn Bautage passen nicht in die Schiene — die Liste scrollt in sich.
    // Ohne das hier stünde der gezeigte Tag beliebig weit außerhalb, und die
    // Markierung wäre eine Auskunft, die niemand sieht.
    const aktiv = root.querySelector('.rail-t[aria-pressed="true"]');
    if (aktiv) aktiv.scrollIntoView({ block: 'nearest' });
  }

  return {
    render,
    /**
     * Modus und gezeigter Tag. `bTag` ist der Tag in der Bildmitte des Gantt
     * und wechselt beim Scrollen — dafür gibt es `markBauTag`, das nur die
     * Markierung setzt, ohne die Liste neu zu bauen.
     */
    setEbene(e, sTag, bTag) {
      ebene = e === 'show' ? 'show' : 'bau';
      showTag = sTag ?? null;
      if (bTag !== undefined) bauTag = bTag;
      render();
    },
    markBauTag(iso) {
      if (iso === bauTag) return;
      bauTag = iso;
      if (ebene !== 'bau') return;
      for (const b of root.querySelectorAll('.rail-t')) {
        const an = b.dataset.tag === iso;
        b.setAttribute('aria-pressed', String(an));
        if (an) b.scrollIntoView({ block: 'nearest' });
      }
    },
  };
}
