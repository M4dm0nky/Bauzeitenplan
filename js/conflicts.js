// ── Konflikte & Dauer-Eingabe ─────────────────────────────────────────────────
// Kein DOM. Ein Konflikt ist kein neuer Algorithmus: computeSchedule behandelt
// den eingetragenen Starttermin als UNTERGRENZE (Math.max über die Vorgänger).
// Liegt die früheste Lage darüber, ist eine Abhängigkeit verletzt — genau das
// ist die ganze Prüfung.

import { computeSchedule, toMin, toDate } from './schedule.js';

// Zwei Minuten Schlupf gegen Rundung; darunter ist es kein echter Konflikt.
const EPS = 1;

/**
 * @returns {{taskId, shortByMin, es, byDepId, message}[]}
 */
export function findConflicts(state) {
  let sched;
  try {
    sched = computeSchedule(state.tasks, state.deps);
  } catch (e) {
    // Ein Ring bricht die Rechnung. Der Store lässt keinen zu, aber importiertes
    // JSON kann einen enthalten — dann eine Meldung statt eines Absturzes.
    const title = (id) => (state.tasks.find((t) => t.id === id) || {}).title || id;
    return [{
      taskId: (e.cycle || [])[0] || null,
      shortByMin: 0, es: null, byDepId: null,
      message: 'Ring in den Verknüpfungen: ' + (e.cycle || []).map(title).join(' → '),
    }];
  }

  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const out = [];

  for (const t of state.tasks) {
    const r = sched.get(t.id);
    if (!r) continue;
    const planned = toMin(t.start);
    const shortBy = r.es - planned;
    if (shortBy <= EPS) continue;

    // Welcher Vorgänger bindet? Der, der die früheste Lage erzwingt.
    const binding = bindingPred(state, sched, t);
    const pre = binding ? byId.get(binding.from) : null;
    out.push({
      taskId: t.id,
      shortByMin: shortBy,
      es: toDate(r.es).toISOString(),
      byDepId: binding ? binding.id : null,
      message: pre
        ? `startet ${fmtDuration(shortBy)} zu früh für «${pre.title}»`
        : `startet ${fmtDuration(shortBy)} zu früh`,
    });
  }
  return out;
}

// Der Vorgänger, dessen Bedingung die früheste Lage setzt.
function bindingPred(state, sched, task) {
  const D = toMin(task.end) - toMin(task.start);
  let best = null, bestEs = -Infinity;
  for (const d of state.deps) {
    if (d.to !== task.id) continue;
    const p = sched.get(d.from);
    if (!p) continue;
    let es;
    if (d.type === 'FS') es = p.ef + d.lag;
    else if (d.type === 'SS') es = p.es + d.lag;
    else if (d.type === 'FF') es = p.ef + d.lag - D;
    else es = p.es + d.lag - D;          // SF
    if (es > bestEs) { bestEs = es; best = d; }
  }
  return best;
}

/**
 * Sammelbefehl, der jeden verletzten Vorgang auf seine früheste Lage schiebt.
 * Die Dauer bleibt erhalten. Ein Durchgang genügt: computeSchedule rechnet die
 * Kette bereits vorwärts durch, die frühesten Lagen sind untereinander stimmig.
 */
export function resolveConflictsCmd(state) {
  const conflicts = findConflicts(state).filter((c) => c.es);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const cmds = conflicts.map((c) => {
    const t = byId.get(c.taskId);
    const dur = toMin(t.end) - toMin(t.start);
    const es = toMin(c.es);
    return { type: 'moveTask', id: t.id, start: local(toDate(es)), end: local(toDate(es + dur)) };
  });
  return { type: 'batch', label: 'Konflikte auflösen', cmds };
}

// Wanduhrzeit ohne Zeitzonen-Anhang — dasselbe Format wie in den Daten.
export const local = (d) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  + 'T' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');

// ── Dauer-Kurzform ──────────────────────────────────────────────────────────
// «4h», «1,5h», «90m», «2t», «1t 4h». Eine blanke Zahl sind Stunden — das ist
// die häufigste Eingabe. Unsinn liefert null; lieber nachfragen als raten.

export function parseDuration(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase().replace(',', '.');
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s) * 60);   // blanke Zahl = Stunden

  const re = /(\d+(?:\.\d+)?)\s*(t|d|h|m)/g;
  let total = 0, found = false, m;
  while ((m = re.exec(s)) !== null) {
    const n = parseFloat(m[1]);
    const unit = m[2];
    total += unit === 't' || unit === 'd' ? n * 1440 : unit === 'h' ? n * 60 : n;
    found = true;
  }
  if (!found) return null;
  // Nur Ziffern/Einheiten/Leerzeichen dürfen vorkommen — «bald 4h» ist Unsinn.
  if (/[^\d.\st dhm]/.test(s)) return null;
  const r = Math.round(total);
  return r >= 0 ? r : null;
}

export function fmtDuration(min) {
  if (min == null) return '';
  if (min === 0) return '0m';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts = [];
  if (d) parts.push(d + 't');
  if (h && m) parts.push(h + 'h', m + 'm');
  else if (h) parts.push(h + 'h');
  else if (m && !d) parts.push(m + 'm');
  else if (m) parts.push(m + 'm');
  // Halbe Stunden lesbarer als Dezimalzahl: 90 → «1,5h» statt «1h 30m»
  if (!d && h && m === 30) return h + ',5h';
  return parts.join(' ');
}
