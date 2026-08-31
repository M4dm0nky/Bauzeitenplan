// ── Bedarfs-Reiter: Personalbedarf · Maschinenbedarf ─────────────────────────
// Zwei eigene Darstellungen neben Gantt und Tabelle, auf derselben Zeitachse:
// je Bezeichnung, je Zeitscheibe bereitgestellt · belegt · frei. Rechnet
// ausschließlich über `bedarfsRaster()` (js/resources.js) — hier wird nur
// gerendert.

import { toMin, toDate } from './schedule.js';
import { local } from './conflicts.js';
import { sichtTasks, amTag, programmFenster } from './ebene.js';
import { ressourcen, bedarfsRaster } from './resources.js';
import { el } from './dom.js';

export function createBedarf(root, { store } = {}) {
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
    if (!resList.length) {
      root.append(el('div', 'bd-empty',
        'Noch keine ' + (kind === 'personal' ? 'Personal-' : 'Maschinen-') + 'Bezeichnung angelegt — '
        + 'im Panel eines Vorgangs unter «+ ' + (kind === 'personal' ? 'Personal' : 'Maschine') + '» → «+ Neu…».'));
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
      von = toMin(S.project.start); bis = toMin(S.project.end); schritt = 1440;
      label = (m) => local(toDate(m)).slice(5, 10);
    }

    const raster = bedarfsRaster(tasks, resList, { kind, von, bis, schritt });
    const n = raster[0] ? raster[0].slots.length : 0;
    if (!n) { root.append(el('div', 'bd-empty', 'Kein Zeitraum zu zeigen.')); return; }

    const wrap = el('div', 'bd-scroll');
    const table = el('table', 'bd-t');

    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', 'bd-h-name'));
    for (let i = 0; i < n; i++) hr.append(el('th', 'bd-h-zeit', label(von + i * schritt)));
    thead.append(hr);
    table.append(thead);

    const tbody = el('tbody');
    for (const row of raster) {
      tbody.append(gruppenkopf(row.label));
      tbody.append(zahlenzeile('bd-bereit', 'bereit', row.slots.map((s) => s.verfuegbar)));
      tbody.append(zahlenzeile('bd-belegt', 'belegt', row.slots.map((s) => s.bedarf)));
      tbody.append(zahlenzeile('bd-frei', 'frei', row.slots.map((s) => s.frei), true));
    }
    table.append(tbody);
    wrap.append(table);
    root.append(wrap);
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
