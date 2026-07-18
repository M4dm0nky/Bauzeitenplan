// ── Terminplan-Rechnung (Critical Path Method) ────────────────────────────────
// Reine Funktionen, kein DOM. Zeiten als Minuten seit Epoche (Number).
//
// Vorgänger P → Nachfolger S mit Lag L (Minuten, darf negativ sein):
//   FS  S.ES >= P.EF + L      (Ende → Start)
//   SS  S.ES >= P.ES + L      (Start → Start)
//   FF  S.EF >= P.EF + L      (Ende  → Ende)
//   SF  S.EF >= P.ES + L      (Start → Ende)

export const toMin = (iso) => Math.round(new Date(iso).getTime() / 60000);
export const toDate = (min) => new Date(min * 60000);

// Kanonische Reihenfolge der Vorgänge INNERHALB eines Gewerks: nach Startzeit,
// bei Gleichstand nach Ende, zuletzt nach Titel (stabil). Der EINE Vergleicher
// für Tabelle und Gantt — sonst zeigt derselbe Plan zwei Reihenfolgen und wirkt
// „nicht gleich". Über toMin gerechnet, nie aus Datumsziffern (Sommerzeit).
export const byStart = (a, b) =>
  toMin(a.start) - toMin(b.start) || toMin(a.end) - toMin(b.end)
  || (a.title || '').localeCompare(b.title || '');

/**
 * Topologische Sortierung (Kahn). Wirft bei Zyklus — sonst würde der
 * Forward-Pass endlos laufen.
 * @returns {string[]} Task-IDs in Abhängigkeitsreihenfolge
 */
export function topoSort(taskIds, deps) {
  const indeg = new Map(taskIds.map((id) => [id, 0]));
  const next = new Map(taskIds.map((id) => [id, []]));
  for (const d of deps) {
    if (!indeg.has(d.from) || !indeg.has(d.to)) continue;
    next.get(d.from).push(d.to);
    indeg.set(d.to, indeg.get(d.to) + 1);
  }
  const queue = taskIds.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const n of next.get(id)) {
      indeg.set(n, indeg.get(n) - 1);
      if (indeg.get(n) === 0) queue.push(n);
    }
  }
  if (order.length !== taskIds.length) {
    const ring = taskIds.filter((id) => !order.includes(id));
    const err = new Error('Zyklus in den Abhängigkeiten: ' + ring.join(' → '));
    err.cycle = ring;
    throw err;
  }
  return order;
}

/**
 * Rechnet ES/EF/LS/LF/Puffer und markiert den kritischen Pfad.
 *
 * Ankerregel: Vorgänge ohne Nachfolger werden auf ihrem geplanten Ende
 * verankert — der zugesagte Termin IST die Deadline. Genau so wird ein
 * Bauzeitenplan in der Praxis gelesen.
 *
 * Kritisch ist die Kette mit dem GERINGSTEN Puffer im Netz, nicht starr
 * "Puffer == 0". Sobald das Projekt einen Zielmeilenstein mit Vorlauf hat
 * (z.B. Puffer bis Doors), ist streng genommen kein Vorgang bei null — die
 * bindende Kette ist trotzdem die, auf die es ankommt. Bei einem straff
 * durchgeplanten Netz ist minFloat 0 und die Regel entspricht der klassischen.
 *
 * Isolierte Vorgänge (weder Vorgänger noch Nachfolger) können per Definition
 * keinen kritischen Pfad bilden und werden nicht markiert.
 *
 * @returns {Map<string, {es,ef,ls,lf,float,critical}>} mit .minFloat am Ergebnis
 */
export function computeSchedule(tasks, deps) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const valid = deps.filter((d) => byId.has(d.from) && byId.has(d.to));
  const order = topoSort(tasks.map((t) => t.id), valid);

  const predOf = new Map(tasks.map((t) => [t.id, []]));
  const succOf = new Map(tasks.map((t) => [t.id, []]));
  for (const d of valid) {
    predOf.get(d.to).push(d);
    succOf.get(d.from).push(d);
  }

  const dur = new Map(tasks.map((t) => [t.id, toMin(t.end) - toMin(t.start)]));
  const R = new Map();

  // ── Forward pass: früheste Lage ─────────────────────────────────────────────
  for (const id of order) {
    const D = dur.get(id);
    let es = toMin(byId.get(id).start); // geplanter Start als Untergrenze
    for (const d of predOf.get(id)) {
      const p = R.get(d.from);
      if (d.type === 'FS') es = Math.max(es, p.ef + d.lag);
      else if (d.type === 'SS') es = Math.max(es, p.es + d.lag);
      else if (d.type === 'FF') es = Math.max(es, p.ef + d.lag - D);
      else if (d.type === 'SF') es = Math.max(es, p.es + d.lag - D);
    }
    R.set(id, { es, ef: es + D });
  }

  // ── Backward pass: späteste Lage ────────────────────────────────────────────
  for (const id of [...order].reverse()) {
    const D = dur.get(id);
    const r = R.get(id);
    let lf;
    if (succOf.get(id).length === 0) {
      lf = r.ef; // Anker: eigener geplanter Endtermin
    } else {
      lf = Infinity;
      for (const d of succOf.get(id)) {
        const s = R.get(d.to);
        if (d.type === 'FS') lf = Math.min(lf, s.ls - d.lag);
        else if (d.type === 'SS') lf = Math.min(lf, s.ls - d.lag + D);
        else if (d.type === 'FF') lf = Math.min(lf, s.lf - d.lag);
        else if (d.type === 'SF') lf = Math.min(lf, s.lf - d.lag + D);
      }
    }
    r.lf = lf;
    r.ls = lf - D;
    r.float = r.ls - r.es;
    r.isolated = predOf.get(id).length === 0 && succOf.get(id).length === 0;
    r.anchored = succOf.get(id).length === 0; // Puffer 0 nur wegen der Ankerregel
  }

  // ── Kritischer Pfad = Kette mit dem geringsten Puffer ────────────────────────
  // Verankerte Senken sind ausgenommen: ihr Puffer ist per Ankerregel immer 0
  // und trägt keine Information. Zählte man sie mit, zöge allein der
  // Zielmeilenstein den minFloat auf 0 und kein Vorgang davor wäre je kritisch.
  const connected = [...R.values()].filter((r) => !r.isolated);
  const scored = connected.filter((r) => !r.anchored);
  const basis = scored.length ? scored : connected;
  const minFloat = basis.length ? Math.min(...basis.map((r) => r.float)) : 0;
  for (const r of R.values()) r.critical = !r.isolated && r.float <= minFloat;
  R.minFloat = minFloat;

  return R;
}
