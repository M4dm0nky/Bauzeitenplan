// ── Bedarfs-Reiter: Personalbedarf · Maschinenbedarf ─────────────────────────
// Zwei eigene Darstellungen neben Gantt und Tabelle, auf derselben Zeitachse:
// je Bezeichnung, je Zeitscheibe bereitgestellt · belegt · frei. Rechnet
// ausschließlich über `bedarfsRaster()` (js/resources.js) — hier wird nur
// gerendert.

import { toMin, toDate } from './schedule.js';
import { planSpanne } from './timeaxis.js';
import { local } from './conflicts.js';
import { sichtTasks, amTag, programmFenster } from './ebene.js';
import { ressourcen, bedarfsRaster, rasterGrenzen, offeneBedarfe, genutzteRessourcen, resLabel, resKind } from './resources.js';
import { resStatusMarke, ablehnenOpt, resStatusCmd } from './res-picker.js';
import { el } from './dom.js';

export function createBedarf(root, { store, onEinrichten, neuFragen } = {}) {
  root.classList.add('bd');
  let ebene = 'bau';
  let ausBlend = new Set();
  let tag = null;
  let abschnitt = 'alle';
  let kind = 'personal';

  function render() {
    root.replaceChildren();
    const S = store.state;
    const resList = ressourcen(S, kind);
    // Leer heißt: im Plan ist noch kein Bedarf dieser Art zugewiesen. (Die Liste der
    // Bezeichnungen ist nie leer — der eingebaute Katalog ist immer da.)
    const hatBedarf = S.tasks.some((t) => !t.bereitstellung && (t.res || []).some((z) => resKind(z.rid, S) === kind));
    if (!hatBedarf) {
      const leer = el('div', 'bd-empty',
        'Noch kein ' + (kind === 'personal' ? 'Personal' : 'Maschinen') + 'bedarf zugewiesen. ');
      if (onEinrichten) {
        const b = el('button', 'btn btn-p', 'Personal & Maschinen einrichten…');
        b.onclick = () => onEinrichten('res');
        leer.append(b);
      }
      root.append(leer);
      return;
    }

    let tasks = sichtTasks(S, ebene, ausBlend, abschnitt);
    // Stundenraster im Showablauf (ein Tag ist tagesbezogen), Tagesraster im
    // Bauzeitenplan (vierzehn Tage in Stunden wären unlesbar).
    let von, bis, schritt, label;
    if (ebene === 'show') {
      tasks = amTag(tasks, tag);
      const fenster = programmFenster(tasks) || { von: toMin(S.project.start), bis: toMin(S.project.start) + 60 };
      von = fenster.von; bis = fenster.bis; schritt = 60;
      label = (m) => local(toDate(m)).slice(11, 16);
    } else {
      ({ von, bis } = planSpanne(S)); schritt = 'tag';
      label = (m) => local(toDate(m)).slice(5, 10);
    }

    const raster = bedarfsRaster(tasks, genutzteRessourcen(tasks, resList), { kind, von, bis, schritt });
    const grenzen = rasterGrenzen(von, bis, schritt);   // Kopfzeile aus denselben Grenzen wie das Raster
    const n = raster[0] ? raster[0].slots.length : 0;
    if (!n) { root.append(el('div', 'bd-empty', 'Kein Zeitraum zu zeigen.')); return; }

    root.append(offenBlock(S, tasks));

    const wrap = el('div', 'bd-scroll');
    const table = el('table', 'bd-t');

    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', 'bd-h-name'));
    for (let i = 0; i < n; i++) hr.append(el('th', 'bd-h-zeit', label(grenzen[i])));
    thead.append(hr);
    table.append(thead);

    const tbody = el('tbody');
    for (const row of raster) {
      tbody.append(gruppenkopf(row.label));
      tbody.append(zahlenzeile('bd-bereit', 'bereit', row.slots.map((s) => s.verfuegbar)));
      tbody.append(zahlenzeile('bd-belegt', 'belegt', row.slots.map((s) => s.bedarf)));
      tbody.append(zahlenzeile('bd-best', '✓ bestätigt', row.slots.map((s) => s.bestaetigt)));
      tbody.append(zahlenzeile('bd-frei', 'frei', row.slots.map((s) => s.frei), true));
    }
    table.append(tbody);
    wrap.append(table);
    root.append(wrap);
  }

  // «Offene Bedarfe»: alles, was noch nicht bestätigt ist (angefragt), je Gewerk und
  // Tag, nur für die gezeigte Art und die sichtbaren Vorgänge. Bestätigen/Ablehnen
  // laufen über den Store; «Alle bestätigen» ist EIN Befehl und damit EIN ⌘Z.
  function offenBlock(S, sichtbar) {
    const ids = new Set(sichtbar.map((t) => t.id));
    const gruppen = offeneBedarfe(S)
      .map((g) => ({ ...g, eintraege: g.eintraege.filter((e) => ids.has(e.taskId) && resKind(e.rid, S) === kind) }))
      .filter((g) => g.eintraege.length);
    const box = el('div', 'bd-offen');
    box.append(el('div', 'bd-offen-h', '⏳ Offene Bedarfe'));
    if (!gruppen.length) {
      box.append(el('div', 'bd-offen-leer', 'Nichts offen — alle Anfragen sind bestätigt oder abgelehnt.'));
      return box;
    }
    for (const g of gruppen) {
      const gw = S.gewerke.find((x) => x.id === g.gewerk);
      const kopf = el('div', 'bd-og');
      const [, mo, d] = g.tag.split('-');
      kopf.append(el('span', 'bd-og-t', (gw ? gw.name : g.gewerk) + ' · ' + d + '.' + mo + '.'));
      const alle = el('button', 'btn bd-alle', '✓ Alle bestätigen');
      alle.onclick = () => store.apply({
        type: 'setResStatusMehrere', status: 'bestaetigt', am: new Date().toISOString(),
        eintraege: g.eintraege.map((e) => ({ id: e.taskId, index: e.index })),
      });
      kopf.append(alle);
      box.append(kopf);
      for (const e of g.eintraege) {
        const t = S.tasks.find((x) => x.id === e.taskId);
        const z = (t.res || [])[e.index] || {};
        const zeile = el('div', 'bd-oz');
        zeile.dataset.task = e.taskId;
        zeile.append(resStatusMarke(z), el('span', 'bd-oz-t', e.n + '× ' + resLabel(e.rid, S) + ' — ' + t.title));
        const ja = el('button', 'btn bd-ja', '✓ Bestätigen');
        ja.onclick = () => store.apply(resStatusCmd(e.taskId, e.index, 'bestaetigt'));
        const nein = el('button', 'btn bd-nein', '✕ Ablehnen');
        nein.onclick = () => neuFragen && neuFragen(ablehnenOpt(e.taskId, e.index), nein, () => {});
        zeile.append(ja, nein);
        box.append(zeile);
      }
    }
    return box;
  }

  function gruppenkopf(name) {
    const tr = el('tr', 'bd-group');
    const td = el('td', 'bd-h-name', name);
    td.colSpan = 1;
    tr.append(td);
    return tr;
  }

  function zahlenzeile(cls, label, werte, vorzeichen = false) {
    const tr = el('tr', 'bd-row ' + cls);
    tr.append(el('td', 'bd-h-name', label));
    for (const w of werte) {
      const txt = vorzeichen && w > 0 ? '+' + w : String(w);
      const td = el('td', 'bd-z', w === 0 ? '·' : txt);
      // Überbuchung rot — fehlende Bereitstellung bleibt neutral: «nicht
      // eingetragen» ist nicht «zu wenig».
      if (vorzeichen && w < 0) td.classList.add('is-over');
      tr.append(td);
    }
    return tr;
  }

  return {
    render,
    /** Ebene, Bühnen-Filter, Showtag und Abschnitt — wie Gantt und Tabelle. */
    setEbene(name, aus = new Set(), showTag = null, absch = 'alle') {
      ebene = name;
      ausBlend = new Set(aus);
      tag = name === 'show' ? showTag : null;
      abschnitt = name === 'show' ? absch : 'alle';
    },
    /** 'personal' oder 'maschine' — welcher der beiden Reiter das hier ist. */
    setKind(k) { kind = k; },
  };
}
