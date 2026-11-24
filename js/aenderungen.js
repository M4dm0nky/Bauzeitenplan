// Plan <-> Datensätze und Änderungslisten — DOM-frei.
//
// Die Online-Fassung speichert den Plan nicht als ein Blatt, sondern als einzelne
// Datensätze je Sammlung (COLLS). Dieses Modul zerlegt einen Plan-Zustand in
// diese Datensätze, setzt ihn wieder zusammen und rechnet aus zwei Zuständen die
// Liste der Änderungen. Dieselbe Liste dient dem Server-Abgleich und dem Undo
// (der Store nimmt damit nur eigene Schritte zurück, fremde bleiben stehen).

export const COLLS = ['plaene', 'ressourcen', 'gewerke', 'vorgaenge', 'phasen', 'verknuepfungen'];

const JSONKLON = (x) => JSON.parse(JSON.stringify(x));

// Kanonisches JSON: Schlüssel sortiert; undefined-Felder fallen wie bei JSON.stringify weg.
function kanon(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : kanon(x))).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ':' + kanon(v[k])).join(',') + '}';
  }
  return JSON.stringify(v) ?? 'null';
}

const mapVon = (liste) => new Map((liste || []).map((x) => [x.id, x]));

export function zerlegen(state) {
  const { ressourcen, ...projekt } = state.project;
  return {
    plaene: new Map([[state.project.id, projekt]]),
    ressourcen: mapVon(ressourcen),
    gewerke: mapVon(state.gewerke),
    vorgaenge: mapVon(state.tasks),
    phasen: mapVon(state.phases),
    verknuepfungen: mapVon(state.deps),
  };
}

// Reihenfolge je Sammlung: Liste von eids oder Objekt eid → pos. Nicht Genanntes
// folgt in Einfügereihenfolge hinten.
function geordnet(map, vorgabe) {
  const alle = [...map.entries()];
  if (!vorgabe) return alle.map(([, o]) => o);
  const pos = Array.isArray(vorgabe) ? Object.fromEntries(vorgabe.map((e, i) => [e, i])) : vorgabe;
  const mit = alle.map(([eid, o], i) => ({ o, p: pos[eid] ?? Infinity, i }));
  return mit.sort((a, b) => (a.p - b.p) || (a.i - b.i)).map((x) => x.o);
}

export function zusammensetzen(teile, reihenfolge = {}) {
  const projekt = [...teile.plaene.values()][0];
  return {
    project: { ...projekt, ressourcen: geordnet(teile.ressourcen, reihenfolge.ressourcen) },
    gewerke: geordnet(teile.gewerke, reihenfolge.gewerke),
    tasks: geordnet(teile.vorgaenge, reihenfolge.vorgaenge),
    deps: geordnet(teile.verknuepfungen, reihenfolge.verknuepfungen),
    phases: geordnet(teile.phasen, reihenfolge.phasen),
  };
}

const leer = () => ({ anlegen: [], aendern: [], loeschen: [], anlegenPos: [], loeschenPos: [], aendernPos: [], aendernPosNeu: [] });

// Änderungen von `vorher` nach `nachher`. Zu anlegen/loeschen steht in
// anlegenPos/loeschenPos (parallele Listen) die Array-Position, damit das Undo
// eines Löschens die Reihenfolge exakt wiederherstellt.
export function aenderungen(vorher, nachher) {
  const v = zerlegen(vorher);
  const n = zerlegen(nachher);
  const out = {};
  for (const c of COLLS) {
    const a = leer();
    const vk = [...v[c].keys()];
    const nk = [...n[c].keys()];
    const nPos = new Map(nk.map((k, i) => [k, i]));
    vk.forEach((eid, i) => {
      const alt = v[c].get(eid);
      if (!n[c].has(eid)) { a.loeschen.push(JSONKLON(alt)); a.loeschenPos.push(i); return; }
      const neu = n[c].get(eid);
      if (alt !== neu && kanon(alt) !== kanon(neu)) {
        a.aendern.push({ vorher: JSONKLON(alt), nachher: JSONKLON(neu) });
        a.aendernPos.push(i); a.aendernPosNeu.push(nPos.get(eid));
      }
    });
    nk.forEach((eid, i) => {
      if (!v[c].has(eid)) { a.anlegen.push(JSONKLON(n[c].get(eid))); a.anlegenPos.push(nPos.get(eid)); }
    });
    out[c] = a;
  }
  return out;
}

export function istLeer(a) {
  return COLLS.every((c) => !a[c] || (!a[c].anlegen.length && !a[c].aendern.length && !a[c].loeschen.length));
}

export function umkehren(a) {
  const out = {};
  for (const c of COLLS) {
    const x = a[c] || leer();
    out[c] = {
      anlegen: x.loeschen.map(JSONKLON),
      aendern: x.aendern.map((e) => ({ vorher: JSONKLON(e.nachher), nachher: JSONKLON(e.vorher) })),
      loeschen: x.anlegen.map(JSONKLON),
      anlegenPos: [...(x.loeschenPos || [])],
      loeschenPos: [...(x.anlegenPos || [])],
      aendernPos: [...(x.aendernPosNeu || [])],
      aendernPosNeu: [...(x.aendernPos || [])],
    };
  }
  return out;
}

// Wendet die Liste auf `state` an (ohne ihn zu verändern). Jeder betroffene
// Datensatz muss im Ausgangszustand dem `vorher` entsprechen, sonst Konflikt.
// `erzwingen` überschreibt die Abweichung (Undo/Redo trotz fremder Änderung).
export function anwenden(state, a, { erzwingen = false } = {}) {
  const teile = zerlegen(state);
  const konflikt = [];
  for (const c of COLLS) {
    const x = a[c];
    if (!x) continue;
    const m = teile[c];
    for (const o of x.anlegen) {
      if (m.has(o.id) && !erzwingen) konflikt.push({ coll: c, eid: o.id, art: 'existiert' });
    }
    for (const e of x.aendern) {
      const id = e.vorher.id;
      if (!m.has(id)) { if (!erzwingen) konflikt.push({ coll: c, eid: id, art: 'geloescht' }); }
      else if (kanon(m.get(id)) !== kanon(e.vorher) && !erzwingen) konflikt.push({ coll: c, eid: id, art: 'geaendert' });
    }
    for (const o of x.loeschen) {
      if (!m.has(o.id)) { if (!erzwingen) konflikt.push({ coll: c, eid: o.id, art: 'geloescht' }); }
      else if (kanon(m.get(o.id)) !== kanon(o) && !erzwingen) konflikt.push({ coll: c, eid: o.id, art: 'geaendert' });
    }
  }
  if (konflikt.length) return { ok: false, konflikt };

  const wunschPos = {};
  for (const c of COLLS) {
    const x = a[c];
    if (!x) continue;
    const m = teile[c];
    for (const o of x.loeschen) m.delete(o.id);
    // Fremd gelöschter Datensatz, den ein erzwungenes Undo wieder braucht: neu
    // anlegen, an der alten Position (soweit bekannt).
    const wieder = [];
    x.aendern.forEach((e, i) => {
      if (m.has(e.nachher.id)) m.set(e.nachher.id, JSONKLON(e.nachher));
      else wieder.push({ o: e.nachher, p: x.aendernPosNeu?.[i] });
    });
    if (c === 'plaene') { for (const o of [...x.anlegen, ...wieder.map((w) => w.o)]) m.set(o.id, JSONKLON(o)); continue; }
    // Neu Angelegtes: an der gemerkten Position (aufsteigend, damit mehrere
    // Einfügungen exakt aufgehen), sonst hinten.
    const neu = [...x.anlegen.map((o, i) => ({ o, p: x.anlegenPos?.[i] })), ...wieder]
      .filter(({ o }) => !m.has(o.id) || erzwingen);
    if (!neu.length) continue;
    const reihe = [...m.keys()];
    for (const { o, p } of neu.sort((s, t) => (s.p ?? Infinity) - (t.p ?? Infinity))) {
      const bestand = m.has(o.id);
      m.set(o.id, JSONKLON(o));
      if (bestand) continue;
      reihe.splice(Math.min(p ?? reihe.length, reihe.length), 0, o.id);
    }
    wunschPos[c] = reihe;
  }
  const ergebnis = { ...state, ...zusammensetzen(teile, wunschPos) };
  // Ein Plan ohne Ressourcenfeld bleibt ohne (zusammensetzen setzt immer eine Liste).
  if (!('ressourcen' in state.project) && !ergebnis.project.ressourcen.length) delete ergebnis.project.ressourcen;
  return { ok: true, state: ergebnis };
}
