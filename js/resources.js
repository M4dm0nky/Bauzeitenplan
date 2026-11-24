// ── Ressourcen: Personal & Maschinen ──────────────────────────────────────────
// Kein DOM. Wie ebene.js für Bühnen/Abschnitte ist dies HIER die einzige Stelle,
// die weiß, was eine Ressource ist — Inspector, Tabelle, Gantt und die beiden
// Bedarfs-Reiter fragen, sie entscheiden nicht selbst.
//
// Feste Bezeichnungen kommen aus `res-katalog.js` (stabile ids). Eigene stehen
// im PLAN (`project.ressourcen`, mit `kat`) und reisen im Export mit, sonst
// sähe ein Empfänger nur eine Kennung `rid:"stagehand"`.
//
// Am Vorgang steht `t.res = [{rid, n, von, bis}]`. `von`/`bis` = null heißt
// »der ganze Vorgang« — der Normalfall. Gesetzt sind es Zeitstempel wie
// `start`/`end`. Eine BEREITSTELLUNG (`t.bereitstellung === true`) ist ein
// ganz normaler Vorgang, dessen `res` nicht Bedarf ist, sondern Angebot — der
// Pool, aus dem andere Vorgänge ihre Zuweisung nehmen.

import { toMin, toDate, ohneTermin } from './schedule.js';
import { local } from './conflicts.js';
import { nachSort } from './ebene.js';
import { RES_KATEGORIEN, RES_EINGEBAUT } from './res-katalog.js';

export const RES_KINDS = [['personal', 'Personal'], ['maschine', 'Maschine']];

const eigeneKat = (kind) => (kind === 'maschine' ? 'eigene-m' : 'eigene-p');

/** Alle Ressourcen einer Art: erst die eingebauten (Katalog), dann die eigenen
 * des Plans (nachSort — dieselbe Regel wie bei Eintragsarten und Abschnitten),
 * geordnet nach Kategorie. Eigene ohne gültiges `kat` landen in «Eigene …».
 * Ohne `kind` alle. */
export function ressourcen(state, kind) {
  const alle = (state && state.project && state.project.ressourcen) || [];
  const eigene = nachSort(kind ? alle.filter((r) => r.kind === kind) : alle).map((r) => {
    const k = RES_KATEGORIEN.find((c) => c.id === r.kat && c.kind === r.kind);
    return { ...r, kat: k ? k.id : eigeneKat(r.kind), eingebaut: false };
  });
  const fest = (kind ? RES_EINGEBAUT.filter((r) => r.kind === kind) : RES_EINGEBAUT).map((r) => ({ ...r, eingebaut: true }));
  const out = [];
  for (const k of RES_KATEGORIEN) {
    out.push(...fest.filter((r) => r.kat === k.id), ...eigene.filter((r) => r.kat === k.id));
  }
  return out;
}

/** Die Auswahl nach Kategorien gruppiert, gefiltert durch `query` (trim,
 * Kleinschreibung). Treffer im Kategorienamen liefert die ganze Kategorie,
 * Treffer im Eintragsnamen nur diesen Eintrag. Leere Gruppen fallen weg. */
export function resGruppen(state, kind, query = '') {
  const q = String(query || '').trim().toLowerCase();
  const alle = ressourcen(state, kind);
  const gruppen = [];
  for (const k of RES_KATEGORIEN) {
    if (k.kind !== kind) continue;
    const items = alle.filter((r) => r.kat === k.id);
    const katTreffer = !q || k.label.toLowerCase().includes(q);
    const sicht = katTreffer ? items : items.filter((r) => r.label.toLowerCase().includes(q));
    if (sicht.length) gruppen.push({ kat: k.id, label: k.label, items: sicht });
  }
  return gruppen;
}

const finde = (rid, state) => ressourcen(state).find((r) => r.id === rid);

/** Anzeigename einer Ressource. Unbekanntes bleibt unverändert stehen. */
export const resLabel = (rid, state) => (finde(rid, state) || { label: rid }).label;

/** Zu welcher Art gehört eine Ressource? Unbekanntes zählt als Personal. */
export const resKind = (rid, state) => (finde(rid, state) || {}).kind || 'personal';

/**
 * Das Zeitfenster EINER Zuweisung in Minuten seit Epoche — `von`/`bis` = null
 * heißt: der ganze Vorgang. Nicht exportiert — nur deckung()/bedarfsRaster()
 * hier im Modul brauchen es, eine dritte Stelle gibt es (noch) nicht.
 */
function spanne(t, z) {
  return {
    von: z.von != null ? toMin(z.von) : toMin(t.start),
    bis: z.bis != null ? toMin(z.bis) : toMin(t.end),
  };
}

/**
 * Die EINE Regel «zählt diese Bedarfszeile mit?»: ein abgelehnter Bedarf bleibt am
 * Vorgang stehen, deckt aber nichts ab (Lücke) und zählt nicht in Summen (Balkenzahl,
 * Crew-Kopfzeile). Angefragt (Feld fehlt) und bestätigt zählen. Das Bedarfsraster
 * zählt Bedarf weiterhin vollständig (Bedarf ist Bedarf, auch abgelehnt).
 */
export const zaehltAlsDeckung = (z) => !z || z.status !== 'abgelehnt';

/**
 * Deckung EINER Art (Personal ODER Maschine) über die Dauer des Vorgangs:
 * welche Zeitspannen sind durch mindestens eine Zuweisung dieser Art abgedeckt,
 * welche nicht.
 *
 * Wird NUR gemeldet, wenn der Vorgang überhaupt eine Zuweisung dieser Art hat —
 * ein Vorgang ganz ohne Personalzuweisung sagt nichts über Personal aus. Sonst
 * wären im Klassentreffen-Plan alle 353 Vorgänge »ungedeckt« und die Anzeige
 * wertlos.
 *
 * @returns {{gedeckt:[number,number][], luecken:[number,number][], luecktMin:number}|null}
 */
export function deckung(t, kind, state) {
  // Ohne Termin gibt es kein Zeitfenster, über das sich Deckung sagen ließe.
  if (ohneTermin(t)) return null;
  const zuweisungen = (t.res || []).filter((z) => resKind(z.rid, state) === kind);
  if (!zuweisungen.length) return null;

  const start = toMin(t.start), end = toMin(t.end);
  if (end <= start) return { gedeckt: [], luecken: [], luecktMin: 0 };

  // Intervalle vereinigen (Sweep über sortierte Fenster).
  const spannen = zuweisungen.filter(zaehltAlsDeckung).map((z) => spanne(t, z)).sort((a, b) => a.von - b.von);
  const vereint = [];
  for (const s of spannen) {
    const von = Math.max(s.von, start), bis = Math.min(s.bis, end);
    if (bis <= von) continue;
    const letzte = vereint[vereint.length - 1];
    if (letzte && von <= letzte[1]) letzte[1] = Math.max(letzte[1], bis);
    else vereint.push([von, bis]);
  }

  const luecken = [];
  let cur = start;
  for (const [von, bis] of vereint) {
    if (von > cur) luecken.push([cur, von]);
    cur = Math.max(cur, bis);
  }
  if (cur < end) luecken.push([cur, end]);

  const luecktMin = luecken.reduce((a, [von, bis]) => a + (bis - von), 0);
  return { gedeckt: vereint, luecken, luecktMin };
}

/**
 * Scheibengrenzen [von, …, gn] in Epochenminuten mit gn >= bis. `schritt`: Minuten
 * oder 'tag' = nächster Kalendertag zur gleichen Uhrzeit (Zeitumstellung: 1380/1500 min).
 */
export function rasterGrenzen(von, bis, schritt) {
  const g = [von];
  if (!(bis > von)) return g;
  if (schritt !== 'tag') {
    while (g[g.length - 1] < bis) g.push(g[g.length - 1] + schritt);
    return g;
  }
  const d0 = new Date(von * 60000);
  for (let k = 1; g[g.length - 1] < bis; k++) {
    g.push(Math.round(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + k, d0.getHours(), d0.getMinutes()).getTime() / 60000));
  }
  return g;
}

/**
 * Index der Zeitscheibe, die Minute `m` enthält: größtes i in [0, grenzen.length-2]
 * mit grenzen[i] <= m (exklusiv: grenzen[i] < m). Passt keins, 0.
 * Binäre Suche über das aufsteigende Array `grenzen` (statt linearem Durchlauf).
 *
 * Exklusiv gilt für das (exklusive) Ende eines Vorgangs: endet er genau auf einer
 * Grenze, gehört er noch zur Scheibe davor. Ein Abzug wie `m - 1e-9` wirkt bei
 * Epochenminuten (~3e7) nicht (Gleitkomma-Schritt ~3,7e-9), daher ein echtes «kleiner als».
 */
export function scheibeIndex(grenzen, m, exklusiv = false) {
  const n = grenzen.length - 1;
  if (n <= 1) return 0;
  // lo: letzter bekannter Kandidat mit Bedingung erfüllt (0 als Vorgabe)
  let lo = 0, hi = n - 1;
  while (lo < hi) {
    const mitte = (lo + hi + 1) >> 1;
    const erfuellt = exklusiv ? grenzen[mitte] < m : grenzen[mitte] <= m;
    if (erfuellt) lo = mitte; else hi = mitte - 1;
  }
  return lo;
}

/**
 * Bedarfs-/Verfügbarkeitsraster über eine Menge von Vorgängen: je Ressource
 * dieser Art, je Zeitscheibe die Summe aus Bedarf (normale Vorgänge) und
 * Verfügbarkeit (Bereitstellungen).
 *
 * `schritt` in Minuten (60 = Stunde) oder 'tag' (Kalendertage, siehe `rasterGrenzen`). Das Raster deckt
 * [von, bis) in `schritt`-Schritten; Zuweisungen, die eine Scheibe nur
 * teilweise berühren, zählen für diese Scheibe voll — bei stündlichem Raster
 * eine praxistaugliche Näherung, kein Anspruch auf Minutenschärfe.
 *
 * @returns {{rid:string, label:string, slots:{bedarf:number, bestaetigt:number, verfuegbar:number, frei:number}[]}[]}
 */
export function bedarfsRaster(tasks, resList, { kind, von, bis, schritt = 60 } = {}) {
  // Zahl-Schritt: Division (schnell, Stundenraster). 'tag': Kalendertage, deren
  // Länge an der Zeitumstellung 23/25 Stunden beträgt — Grenzen suchen statt dividieren.
  const grenzen = schritt === 'tag' ? rasterGrenzen(von, bis, 'tag') : null;
  const n = grenzen ? Math.max(0, grenzen.length - 1) : Math.max(0, Math.ceil((bis - von) / schritt));
  // Scheibe der Minute m (grenzen[i] <= m < grenzen[i+1]) und Scheibe des exklusiven Endes m
  // (siehe scheibeIndex).
  const scheibe = (m) => scheibeIndex(grenzen, m);
  const scheibeBis = (m) => scheibeIndex(grenzen, m, true);
  const liste = kind ? resList.filter((r) => r.kind === kind) : resList;
  const out = liste.map((r) => ({
    rid: r.id, label: r.label,
    slots: Array.from({ length: n }, () => ({ bedarf: 0, bestaetigt: 0, verfuegbar: 0, frei: 0 })),
  }));
  const byRid = new Map(out.map((o) => [o.rid, o]));

  for (const t of tasks || []) {
    if (ohneTermin(t)) continue;        // kein Termin, kein Bedarf und kein Angebot im Raster
    for (const z of t.res || []) {
      const row = byRid.get(z.rid);
      if (!row) continue;
      const s = spanne(t, z);
      const a = Math.max(s.von, von), b = Math.min(s.bis, bis);
      if (b <= a) continue;
      const i0 = grenzen ? scheibe(a) : Math.max(0, Math.floor((a - von) / schritt));
      // Ende exklusiv: b selbst gehört noch nicht in die Scheibe
      const i1 = grenzen ? scheibeBis(b) : Math.min(n - 1, Math.ceil((b - von) / schritt) - 1);
      for (let i = i0; i <= i1; i++) {
        if (t.bereitstellung) row.slots[i].verfuegbar += z.n;
        else {
          row.slots[i].bedarf += z.n;
          if (z.status === 'bestaetigt') row.slots[i].bestaetigt += z.n;
        }
      }
    }
  }
  for (const row of out) for (const s of row.slots) s.frei = s.verfuegbar - s.bedarf;
  return out;
}

/**
 * Nur die Bezeichnungen, die in diesen Vorgängen vorkommen (Bedarf ODER Angebot einer
 * Bereitstellung; Vorgänge ohne Termin zählen wie im Raster nicht). Der eingebaute Katalog
 * hat rund dreißig Einträge — das Raster zeigt nur, was der Plan tatsächlich braucht.
 */
export function genutzteRessourcen(tasks, resList) {
  const benutzt = new Set();
  for (const t of tasks || []) {
    if (ohneTermin(t)) continue;
    for (const z of t.res || []) benutzt.add(z.rid);
  }
  return resList.filter((r) => benutzt.has(r.id));
}

/** Anzeige eines Bedarfsstatus: Symbol UND Klartext (Status nie nur über Farbe).
 * Fehlendes `status` = angefragt. `titel` ist der Tooltip, abgelehnt mit Notiz. */
const RES_STATUS_ANZEIGE = {
  angefragt: { symbol: '⏳', text: 'Angefragt' },
  bestaetigt: { symbol: '✓', text: 'Bestätigt' },
  abgelehnt: { symbol: '✕', text: 'Abgelehnt' },
};
export function resStatusInfo(z) {
  const status = RES_STATUS_ANZEIGE[z && z.status] ? z.status : 'angefragt';
  const a = RES_STATUS_ANZEIGE[status];
  const notiz = z && z.notiz ? ': ' + z.notiz : '';
  return { status, symbol: a.symbol, text: a.text, titel: a.text + notiz };
}

/**
 * Alle noch nicht bestätigten Bedarfszeilen (Status `angefragt` oder fehlend —
 * «abgelehnt» ist entschieden und steht nicht mehr offen), gruppiert nach
 * Gewerk und Kalendertag des Zeilenbeginns (lokale Zeit; `von` null = Vorgangsstart).
 * Bereitstellungen (Angebot, kein Bedarf) und Vorgänge ohne Termin zählen nicht.
 * Sortiert: Gewerk-`sort` (nachSort-Regel), Tag, Beginn, Reihenfolge am Vorgang.
 *
 * @returns {{gewerk:string, tag:string, eintraege:{taskId:string, index:number, rid:string, n:number, von:(string|null), bis:(string|null)}[]}[]}
 */
export function offeneBedarfe(state) {
  const gewerke = nachSort((state && state.gewerke) || []);
  const pos = new Map(gewerke.map((g, i) => [g.id, i]));
  const gruppen = new Map();
  for (const t of (state && state.tasks) || []) {
    if (t.bereitstellung || ohneTermin(t)) continue;
    (t.res || []).forEach((z, index) => {
      if (z.status && z.status !== 'angefragt') return;
      const beginn = spanne(t, z).von;
      const tag = local(toDate(beginn)).slice(0, 10);
      const key = t.gewerk + '|' + tag;
      if (!gruppen.has(key)) gruppen.set(key, { gewerk: t.gewerk, tag, eintraege: [] });
      gruppen.get(key).eintraege.push({ taskId: t.id, index, rid: z.rid, n: z.n, von: z.von ?? null, bis: z.bis ?? null, _m: beginn });
    });
  }
  const out = [...gruppen.values()];
  for (const g of out) {
    g.eintraege.sort((a, b) => a._m - b._m);   // stabil: gleicher Beginn bleibt in Plan-Reihenfolge
    for (const e of g.eintraege) delete e._m;
  }
  const p = (g) => pos.get(g.gewerk) ?? Infinity;
  return out.sort((a, b) => p(a) - p(b) || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}
