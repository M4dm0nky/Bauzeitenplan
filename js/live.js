// ── Live: Plan gegen Wirklichkeit ─────────────────────────────────────────────
// Kein DOM. Alles hängt allein an (Vorgänge, jetzt).
//
// Der Status ist eine Aussage von MENSCHEN und schlägt die Uhr. Genau daraus
// entsteht der Verzug: Was laut Plan laufen müsste, steht noch auf «geplant».
// Deshalb wird der Status auch nie automatisch umgeschaltet — sonst sähe der
// Plan immer nach Plan aus und das Signal «wir hängen» wäre weg.

import { toMin } from './schedule.js';
import { fmtDuration } from './conflicts.js';

// Unter dieser Schwelle ist Verzug kein Verzug, sondern Rundung. Ohne sie wäre
// ab der ersten Minute nach dem geplanten Start alles rot.
const LATE_MIN = 5;

/**
 * Welche Vorgänge laufen laut Plan gerade?
 * Fertige zählen nicht — sie sind durch, auch wenn ihre Zeit noch läuft.
 * @returns {Set<string>}
 */
export function runningAt(tasks, now) {
  const out = new Set();
  for (const t of tasks) {
    if (t.milestone) continue;              // hat keine Dauer, kann nicht laufen
    if (t.status === 'fertig') continue;
    const a = toMin(t.start), b = toMin(t.end);
    // Ende exklusiv: sonst leuchtet ein Vorgang noch, dessen Zeit abgelaufen ist.
    if (a <= now && now < b) out.add(t.id);
  }
  return out;
}

/**
 * Verzug — der eigentliche Zweck des Ganzen.
 * @returns {{taskId, title, kind:'start'|'ende'|'meilenstein', byMin, message}[]}
 *          absteigend nach Größe: das Schlimmste zuerst.
 */
export function delaysAt(tasks, now) {
  const out = [];
  for (const t of tasks) {
    if (t.status === 'fertig') continue;    // menschliche Aussage schlägt die Uhr

    if (t.milestone) {
      const by = now - toMin(t.start);
      if (by >= LATE_MIN) {
        out.push({ taskId: t.id, title: t.title, kind: 'meilenstein', byMin: by,
          message: 'überfällig seit ' + fmtDuration(by) });
      }
      continue;
    }

    if (t.status === 'geplant') {
      const by = now - toMin(t.start);
      if (by >= LATE_MIN) {
        out.push({ taskId: t.id, title: t.title, kind: 'start', byMin: by,
          message: 'sollte seit ' + fmtDuration(by) + ' laufen' });
      }
      continue;
    }

    if (t.status === 'laeuft') {
      const by = now - toMin(t.end);
      if (by >= LATE_MIN) {
        out.push({ taskId: t.id, title: t.title, kind: 'ende', byMin: by,
          message: 'sollte seit ' + fmtDuration(by) + ' fertig sein' });
      }
    }
  }
  return out.sort((a, b) => b.byMin - a.byMin);
}

/** Der nächste Vorgang, der ansteht. null, wenn nichts mehr kommt. */
export function nextUp(tasks, now) {
  let best = null;
  for (const t of tasks) {
    if (t.status === 'fertig') continue;
    const a = toMin(t.start);
    if (a <= now) continue;
    if (!best || a < best.at) best = { taskId: t.id, title: t.title, at: a, inMin: a - now };
  }
  return best;
}

/** Kurzfassung für die Kopfzeile. */
export function liveStats(tasks, now) {
  return {
    running: runningAt(tasks, now).size,
    late: delaysAt(tasks, now).length,
    next: nextUp(tasks, now),
  };
}
