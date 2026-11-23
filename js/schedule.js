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

// Die EINE Spannenregel (Store-Befehle UND Import/Sync rufen sie): null = gültig,
// sonst der Ablehnungsgrund. In echten Zeitstempeln gerechnet, nie in Ziffern.
// `sammel`: ein Elternvorgang trägt die abgeleitete Hülle seiner Kinder
// (reflowParents) — sind alle Kinder Meilensteine, ist sie null lang. Dort
// genügt Ende >= Start; die Lage ist abgeleitet, nicht eingegeben.
//
// «Ohne Termin»: start UND end beide null (nie nur eines) — der Vorgang steht in
// der Liste, hat aber keinen Balken. Gilt auch für Meilensteine und Sammelvorgänge.
export const ohneTermin = (t) => t.start == null && t.end == null;

export function spanFehler(start, end, { milestone = false, sammel = false } = {}) {
  if (start == null && end == null) return null;
  if (!start || !end) return 'Start und Ende müssen gesetzt sein.';
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 'Ungültiges Datum.';
  if (sammel) return b >= a ? null : 'Das Ende muss nach dem Start liegen.';
  if (milestone) return b === a ? null : 'Ein Meilenstein hat keine Dauer — Start und Ende müssen gleich sein.';
  if (b <= a) return 'Das Ende muss nach dem Start liegen.';
  return null;
}

// Kanonische Reihenfolge der Vorgänge INNERHALB eines Gewerks: nach Startzeit,
// bei Gleichstand nach Ende, zuletzt nach Titel (stabil). Der EINE Vergleicher
// für Tabelle und Gantt — sonst zeigt derselbe Plan zwei Reihenfolgen und wirkt
// „nicht gleich". Über toMin gerechnet, nie aus Datumsziffern (Sommerzeit).
// Terminlose (start/end null) stehen am Ende der Gruppe, untereinander nach Titel.
export const byStart = (a, b) => {
  const oa = ohneTermin(a), ob = ohneTermin(b);
  if (oa || ob) return (oa - ob) || (a.title || '').localeCompare(b.title || '');
  return toMin(a.start) - toMin(b.start) || toMin(a.end) - toMin(b.end)
    || (a.title || '').localeCompare(b.title || '');
};

/**
 * Der Kalendertag nach «2026-10-25» → «2026-10-26». Über den Kalender gerechnet
 * (12:00 gegen Sommerzeit-Kanten), nie als +1440 Minuten: der 25.10.2026 hat 25,
 * der 29.03.2026 nur 23 Stunden. (conflicts.js importiert dieses Modul, deshalb
 * hier eigene Formatierung statt `local`.)
 */
export function naechsterTag(tagISO) {
  const [y, m, d] = tagISO.split('-').map(Number);
  const n = new Date(y, m - 1, d + 1, 12);
  const p = (x) => String(x).padStart(2, '0');
  return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate());
}

/**
 * Vorgänge auf einen Kalendertag zuschneiden — die Grundlage der Tagesblätter
 * (ein A3 quer je Tag). Ein Vorgang, der über Mitternacht läuft, erscheint auf
 * BEIDEN Blättern, jeweils angeschnitten; im Klassentreffen-Plan trifft das 40
 * Balken (Nachtschichten, Objektbewachung). Ohne den Zuschnitt verschwänden sie
 * entweder oder sprengten das Blatt.
 *
 * Rückgabe in MINUTEN seit Epoche, wie überall im Rechenteil — wer ISO braucht,
 * formatiert selbst. Nach Beginn sortiert, bei Gleichstand nach Titel.
 *
 * @param {object[]} tasks
 * @param {string} tagISO  «2026-08-30»
 * @returns {{task:object, von:number, bis:number, schnittLinks:boolean, schnittRechts:boolean}[]}
 */
export function tagesScheiben(tasks, tagISO) {
  const a = toMin(tagISO + 'T00:00');
  const b = toMin(naechsterTag(tagISO) + 'T00:00');   // echte Mitternacht, nicht a + 1440
  const out = [];
  for (const t of tasks) {
    if (ohneTermin(t)) continue;        // kein Termin, auf keinem Blatt
    const s = toMin(t.start), e = toMin(t.end);
    // Meilensteine haben keine Dauer: `e > a` allein ließe eine Raute um 00:00
    // durchs Raster fallen. Deshalb der eigene Fall.
    const drin = s === e ? (s >= a && s < b) : (e > a && s < b);
    if (!drin) continue;
    out.push({
      task: t,
      von: Math.max(s, a),
      bis: Math.min(e, b),
      schnittLinks: s < a,
      schnittRechts: e > b,
    });
  }
  return out.sort((x, y) => x.von - y.von || (x.task.title || '').localeCompare(y.task.title || ''));
}

/**
 * Vorgänge gleichen Namens zu SERIEN bündeln — die Zeile sagt WAS, die Balken
 * sagen WANN. Ein Bauzeitenplan wird tageweise gedruckt, deshalb steht dieselbe
 * Tätigkeit dort mehrfach untereinander («Aufbau Bühne» an drei Tagen). Im Gantt
 * ist das EINE Zeile mit drei Balken, sonst hat die Bühne fünf Zeilen für zwei
 * Tätigkeiten und die Crew 113 für 28.
 *
 * Überlappen sich zwei Balken derselben Serie (am 29.08. laufen zwei SITECREW-
 * Trupps parallel), bekommen sie SPUREN: jeder Balken kommt in die erste Spur,
 * die frei ist, sonst in eine neue. Klassische Intervall-Partitionierung, greedy
 * über die nach Start sortierte Liste — das ist nachweislich optimal.
 *
 * Erwartet bereits gefilterte Geschwister (ein Gewerk bzw. ein Elternvorgang);
 * die Gruppierung läuft über den EXAKTEN Titel, nicht über Ähnlichkeit — geraten
 * wird hier nichts.
 *
 * @param {object[]} tasks
 * @returns {{title:string, tasks:object[], lanes:number, laneOf:Map<string,number>}[]}
 *          in derselben Reihenfolge wie byStart, damit Gantt und Tabelle
 *          denselben Plan in derselben Folge zeigen.
 */
export function seriesRows(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    if (!groups.has(t.title)) groups.set(t.title, []);
    groups.get(t.title).push(t);
  }

  const out = [];
  for (const [title, list] of groups) {
    list.sort(byStart);
    const frei = [];                 // Ende je Spur, in Minuten
    const laneOf = new Map();
    for (const t of list) {
      // Terminlose belegen keine Spur: sie haben keinen Balken, nur die Zeile.
      if (ohneTermin(t)) { laneOf.set(t.id, 0); continue; }
      const s = toMin(t.start);
      // Ein Meilenstein hat keine Dauer. Ohne die Mindestbreite teilten sich zwei
      // Rauten am selben Termin eine Spur und lägen exakt übereinander.
      const e = Math.max(toMin(t.end), s + 1);
      let lane = frei.findIndex((ende) => ende <= s);
      if (lane < 0) { frei.push(e); lane = frei.length - 1; }
      else frei[lane] = e;
      laneOf.set(t.id, lane);
    }
    out.push({ title, tasks: list, lanes: Math.max(frei.length, 1), laneOf });
  }
  // Serien untereinander wie Einzelvorgänge: nach dem frühesten Termin.
  return out.sort((a, b) => byStart(a.tasks[0], b.tasks[0]));
}
// (Terminlose Serien stehen damit hinten; ein Name, der terminierte UND terminlose
// Vorgänge hat, sortiert nach seinem frühesten terminierten.)

/**
 * Alle Vorgänge, die von `startId` aus über die Verknüpfungen erreichbar sind —
 * `'nach'` folgt den Pfeilen, `'vor'` geht gegen sie. `startId` ist immer dabei.
 *
 * Damit lässt sich VOR einer Geste sagen, was ein gültiges Ziel ist: eine neue
 * Verknüpfung a → b ergibt genau dann einen Ring, wenn a von b aus schon
 * erreichbar ist. Der Store lehnt so etwas ohnehin ab (`wouldCycle`), aber eine
 * Bedienung, die erst NACH der Geste nein sagt, ist eine schlechte Bedienung —
 * beim Ziehen im Gantt hätte man den Balken dann schon losgelassen.
 *
 * Läuft auch über ringhaltige Altdaten nicht ewig: besucht wird jeder Knoten
 * einmal.
 * @param {{from:string,to:string}[]} deps
 * @param {string} startId
 * @param {'nach'|'vor'} dir
 * @returns {Set<string>}
 */
export function reachable(deps, startId, dir = 'nach') {
  const next = new Map();
  for (const d of deps || []) {
    const [a, b] = dir === 'vor' ? [d.to, d.from] : [d.from, d.to];
    if (!next.has(a)) next.set(a, []);
    next.get(a).push(b);
  }
  const seen = new Set([startId]);
  const queue = [startId];
  while (queue.length) {
    for (const n of next.get(queue.shift()) || []) {
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return seen;
}

/**
 * Kandidaten fürs Verknüpfen, gruppiert nach Gewerk und je Gewerk nach Start
 * (byStart). Ohne den Vorgang selbst (`selfId`) und ohne die bereits mit ihm
 * Verknüpften. `query` filtert groß/klein-egal auf Titel ODER Gewerkname; leer =
 * alles. Projekt-Zieltermine kommen als eigene Gruppe ans Ende. Rein, kein DOM —
 * so ist das eigentliche Sortier-/Filterverhalten direkt testbar; die Combobox im
 * Inspector rendert nur das Ergebnis.
 * @returns {{gewerk:{id,name,slot?}, items:object[]}[]}
 */
export function candidateGroups({ tasks = [], gewerke = [], deps = [], selfId, query = '' }) {
  const linked = new Set();
  for (const d of deps) {
    if (d.from === selfId) linked.add(d.to);
    if (d.to === selfId) linked.add(d.from);
  }
  // Der Kandidat wird VORGÄNGER des gewählten Vorgangs (der Inspector schickt
  // `dep: {from: Kandidat, to: selfId}`). Ein Ring entstünde also bei allem, was
  // schon HINTER selfId hängt — Richtung 'nach', nicht 'vor'. Ohne diese Sperre
  // bot das Suchfeld Treffer an, die der Store gleich darauf ablehnte, und das
  // Ziehen im Gantt sagte nein, wo das Suchfeld ja sagte.
  for (const id of reachable(deps, selfId, 'nach')) linked.add(id);
  const gName = new Map(gewerke.map((g) => [g.id, g.name]));
  gName.set('projekt', 'Zieltermine');
  const q = String(query).trim().toLowerCase();
  const match = (t) => !q
    || (t.title || '').toLowerCase().includes(q)
    || (gName.get(t.gewerk) || '').toLowerCase().includes(q);
  const cand = tasks.filter((t) => t.id !== selfId && !linked.has(t.id) && match(t));

  return gruppiere(cand, gewerke);
}

/**
 * Gemeinsame Gruppierung für Picker und Suche: je Gewerk (nach `sort`), darin
 * byStart; Projekt-Zieltermine als eigene Gruppe am Ende. Leere Gruppen fallen weg.
 */
function gruppiere(cand, gewerke) {
  const groups = [];
  for (const g of [...gewerke].sort((a, b) => a.sort - b.sort)) {
    const items = cand.filter((t) => t.gewerk === g.id).sort(byStart);
    if (items.length) groups.push({ gewerk: g, items });
  }
  const proj = cand.filter((t) => t.gewerk === 'projekt').sort(byStart);
  if (proj.length) groups.push({ gewerk: { id: 'projekt', name: 'Zieltermine' }, items: proj });
  return groups;
}

/**
 * Globale Suche über Titel, Gewerkname, Notiz und Kontakt (groß/klein-egal, de).
 * Leere Query = keine Treffer. Höchstens `limit` Einträge werden geliefert, der
 * Rest steht als Zahl in `weitere`. Rein, kein DOM.
 * @returns {{groups:{gewerk:object, items:object[]}[], weitere:number}}
 */
export function suchTreffer({ tasks = [], gewerke = [], query = '', limit = 50 }) {
  const q = String(query).trim().toLocaleLowerCase('de');
  if (!q) return { groups: [], weitere: 0 };
  const gName = new Map(gewerke.map((g) => [g.id, g.name]));
  gName.set('projekt', 'Zieltermine');
  const hit = (v) => String(v || '').toLocaleLowerCase('de').includes(q);
  const cand = tasks.filter((t) => hit(t.title) || hit(t.notes) || hit(gName.get(t.gewerk)) || hit(t.kontakt));
  const alle = gruppiere(cand, gewerke);
  // Vorgänge ohne (bekanntes) Gewerk nicht verschlucken — nur die Suche, der Picker bleibt.
  const bekannt = new Set([...gewerke.map((g) => g.id), 'projekt']);
  const lose = cand.filter((t) => !bekannt.has(t.gewerk)).sort(byStart);
  if (lose.length) alle.push({ gewerk: { id: 'ohne', name: 'Ohne Gewerk' }, items: lose });
  let rest = limit;
  const groups = [];
  for (const g of alle) {
    if (rest <= 0) break;
    const items = g.items.slice(0, rest);
    rest -= items.length;
    groups.push({ gewerk: g.gewerk, items });
  }
  return { groups, weitere: alle.reduce((n, g) => n + g.items.length, 0) - (limit - rest) };
}

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
 * Luft einer Verknüpfung in Minuten: wie viel Spielraum zwischen den GEPLANTEN
 * Zeiten bleibt, bis die Verknüpfung (inkl. Wartezeit) greift. Negativ = die
 * Verknüpfung wird im Plan verletzt (Überlappung).
 */
export function luftDerVerknuepfung(dep, von, nach) {
  const lag = dep.lag ?? 0;
  if (dep.type === 'SS') return toMin(nach.start) - (toMin(von.start) + lag);
  if (dep.type === 'FF') return toMin(nach.end) - (toMin(von.end) + lag);
  if (dep.type === 'SF') return toMin(nach.end) - (toMin(von.start) + lag);
  return toMin(nach.start) - (toMin(von.end) + lag); // FS
}

/**
 * Rechnet ES/EF/LS/LF/Puffer.
 *
 * Ankerregel: Vorgänge ohne Nachfolger werden auf ihrem geplanten Ende
 * verankert — der zugesagte Termin IST die Deadline. Genau so wird ein
 * Bauzeitenplan in der Praxis gelesen.
 *
 * Einen «kritischen Pfad» gibt es nicht: Überlappung verknüpfter Vorgänge
 * meldet `findConflicts` (conflicts.js) als Konflikt.
 *
 * Je Vorgang `engpass`: die Verknüpfung mit der kleinsten Luft (Gleichstand:
 * erste in `deps`-Reihenfolge) oder null ohne terminierten Nachbarn.
 *
 * @returns {Map<string, {es,ef,ls,lf,float,engpass,hatVor,hatNach}>}
 */
export function computeSchedule(tasks, deps) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const valid = deps.filter((d) => byId.has(d.from) && byId.has(d.to));
  // Ringe werden über ALLE Vorgänge erkannt (auch terminlose); gerechnet wird nur
  // mit terminierten. Verknüpfungen von/zu einem terminlosen Vorgang zählen nicht.
  const order = topoSort(tasks.map((t) => t.id), valid).filter((id) => !ohneTermin(byId.get(id)));

  const termin = tasks.filter((t) => !ohneTermin(t));
  const predOf = new Map(termin.map((t) => [t.id, []]));
  const succOf = new Map(termin.map((t) => [t.id, []]));
  for (const d of valid) {
    if (!predOf.has(d.to) || !predOf.has(d.from)) continue;
    predOf.get(d.to).push(d);
    succOf.get(d.from).push(d);
  }

  const dur = new Map(termin.map((t) => [t.id, toMin(t.end) - toMin(t.start)]));
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
  }

  // ── Engpass: knappste Verknüpfung je Vorgang ─────────────────────────────────
  for (const [id, r] of R) {
    let best = null;
    const kand = [
      ...predOf.get(id).map((d) => ({ d, nachbarId: d.from, richtung: 'vor' })),
      ...succOf.get(id).map((d) => ({ d, nachbarId: d.to, richtung: 'nach' })),
    ].sort((x, y) => valid.indexOf(x.d) - valid.indexOf(y.d));
    for (const k of kand) {
      const luft = luftDerVerknuepfung(k.d, byId.get(k.d.from), byId.get(k.d.to));
      if (!best || luft < best.luft) best = { depId: k.d.id, nachbarId: k.nachbarId, richtung: k.richtung, typ: k.d.type, luft };
    }
    r.engpass = best;
    // Dieselbe Nachbarschaft wie der Engpass: nur Verknüpfungen zwischen zwei datierten Vorgängen.
    r.hatVor = predOf.get(id).length > 0;
    r.hatNach = succOf.get(id).length > 0;
  }

  return R;
}
