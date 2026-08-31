// ── Ressourcen: Personal & Maschinen ──────────────────────────────────────────
// Kein DOM. Wie ebene.js für Bühnen/Abschnitte ist dies HIER die einzige Stelle,
// die weiß, was eine Ressource ist — Inspector, Tabelle, Gantt und die beiden
// Bedarfs-Reiter fragen, sie entscheiden nicht selbst.
//
// Eine Bezeichnung (»Stagehand«, »Gabelstapler«) steht im PLAN
// (`project.ressourcen`), wie punktTypen/abschnitte — sie reist im Export mit,
// sonst sähe ein Empfänger nur eine Kennung `rid:"stagehand"`.
//
// Am Vorgang steht `t.res = [{rid, n, von, bis}]`. `von`/`bis` = null heißt
// »der ganze Vorgang« — der Normalfall. Gesetzt sind es Zeitstempel wie
// `start`/`end`. Eine BEREITSTELLUNG (`t.bereitstellung === true`) ist ein
// ganz normaler Vorgang, dessen `res` nicht Bedarf ist, sondern Angebot — der
// Pool, aus dem andere Vorgänge ihre Zuweisung nehmen.

import { toMin } from './schedule.js';
import { nachSort } from './ebene.js';

export const RES_KINDS = [['personal', 'Personal'], ['maschine', 'Maschine']];

/** Alle Ressourcen einer Art, in ihrer Reihenfolge (nachSort — dieselbe Regel
 * wie bei Eintragsarten und Abschnitten). Ohne `kind` alle. */
export function ressourcen(state, kind) {
  const alle = (state && state.project && state.project.ressourcen) || [];
  const gefiltert = kind ? alle.filter((r) => r.kind === kind) : alle;
  return nachSort(gefiltert);
}

/** Anzeigename einer Ressource. Unbekanntes bleibt unverändert stehen. */
export const resLabel = (rid, state) =>
  (((state && state.project && state.project.ressourcen) || []).find((r) => r.id === rid) || { label: rid }).label;

/** Zu welcher Art gehört eine Ressource? Unbekanntes zählt als Personal. */
export const resKind = (rid, state) =>
  (((state && state.project && state.project.ressourcen) || []).find((r) => r.id === rid) || {}).kind || 'personal';

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
  const zuweisungen = (t.res || []).filter((z) => resKind(z.rid, state) === kind);
  if (!zuweisungen.length) return null;

  const start = toMin(t.start), end = toMin(t.end);
  if (end <= start) return { gedeckt: [], luecken: [], luecktMin: 0 };

  // Intervalle vereinigen (Sweep über sortierte Fenster).
  const spannen = zuweisungen.map((z) => spanne(t, z)).sort((a, b) => a.von - b.von);
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
 * Bedarfs-/Verfügbarkeitsraster über eine Menge von Vorgängen: je Ressource
 * dieser Art, je Zeitscheibe die Summe aus Bedarf (normale Vorgänge) und
 * Verfügbarkeit (Bereitstellungen).
 *
 * `schritt` in Minuten (60 = Stunde, 1440 = Tag). Das Raster deckt
 * [von, bis) in `schritt`-Schritten; Zuweisungen, die eine Scheibe nur
 * teilweise berühren, zählen für diese Scheibe voll — bei stündlichem Raster
 * eine praxistaugliche Näherung, kein Anspruch auf Minutenschärfe.
 *
 * @returns {{rid:string, label:string, slots:{bedarf:number, verfuegbar:number, frei:number}[]}[]}
 */
export function bedarfsRaster(tasks, resList, { kind, von, bis, schritt = 60 } = {}) {
  const n = Math.max(0, Math.ceil((bis - von) / schritt));
  const liste = kind ? resList.filter((r) => r.kind === kind) : resList;
  const out = liste.map((r) => ({
    rid: r.id, label: r.label,
    slots: Array.from({ length: n }, () => ({ bedarf: 0, verfuegbar: 0, frei: 0 })),
  }));
  const byRid = new Map(out.map((o) => [o.rid, o]));

  for (const t of tasks || []) {
    for (const z of t.res || []) {
      const row = byRid.get(z.rid);
      if (!row) continue;
      const s = spanne(t, z);
      const a = Math.max(s.von, von), b = Math.min(s.bis, bis);
      if (b <= a) continue;
      const i0 = Math.max(0, Math.floor((a - von) / schritt));
      const i1 = Math.min(n - 1, Math.ceil((b - von) / schritt) - 1);
      for (let i = i0; i <= i1; i++) {
        if (t.bereitstellung) row.slots[i].verfuegbar += z.n;
        else row.slots[i].bedarf += z.n;
      }
    }
  }
  for (const row of out) for (const s of row.slots) s.frei = s.verfuegbar - s.bedarf;
  return out;
}
