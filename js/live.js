// ── Live: Plan gegen Wirklichkeit ─────────────────────────────────────────────
// Kein DOM. Alles hängt allein an (Vorgänge, jetzt).
//
// Der Status ist eine Aussage von MENSCHEN und schlägt die Uhr. Genau daraus
// entsteht der Verzug: Was laut Plan laufen müsste, steht noch auf «geplant».
// Deshalb wird der Status auch nie automatisch umgeschaltet — sonst sähe der
// Plan immer nach Plan aus und das Signal «wir hängen» wäre weg.

import { toMin, toDate } from './schedule.js';
import { fmtDuration, local } from './conflicts.js';

// Unter dieser Schwelle ist Verzug kein Verzug, sondern Rundung. Ohne sie wäre
// ab der ersten Minute nach dem geplanten Start alles rot.
const LATE_MIN = 5;

// ── Versatz: die Ansage vom Pult ─────────────────────────────────────────────
// Der Verzug oben entsteht aus Status gegen Uhr — er setzt voraus, dass jemand
// die Häkchen pflegt. Im Betrieb tut das niemand. Der Versatz ist die direkte
// Aussage stattdessen: «wir hängen fünf Minuten hinterher.»
//
// POSITIV IST DELAY. «Plus fünf» heißt in der Regie, dass es später wird, und
// genau so herum rutscht der Ablauf im Bild nach rechts. Minus ist Vorlauf.
//
// Die Rechnung dahinter passt auf eine Zeile: der um `v` verschobene Plan
// verhält sich zur echten Uhr wie der Originalplan zur Uhr MINUS v. Deshalb
// braucht keine der Funktionen hier den Versatz zu kennen — die Aufrufer
// reichen `jetzt - versatz` herein, und «Verzug rechnet gegen den verschobenen
// Plan» ergibt sich von selbst.

/**
 * Denselben Zeitpunkt um `versatzMin` Minuten verschoben.
 *
 * Gerechnet wird über echte Zeitstempel, nie auf den Datumsziffern: über den
 * Sommerzeit-Sprung wäre die Uhrzeit sonst um eine Stunde falsch — ein Fehler,
 * der genau einmal im Jahr zuschlägt und dann niemandem erklärbar ist.
 *
 * Das Ergebnis ist zum ANZEIGEN gedacht, nicht zum Weiterrechnen. In der
 * Rückstellungsnacht gibt es 02:00 bis 03:00 zweimal; welche der beiden ein
 * lokaler Zeitstring meint, steht nicht darin. Die angezeigte Uhrzeit stimmt,
 * aber wer sie wieder einliest, bekommt die erste zurück. Das gilt für jede
 * Zeitangabe in diesem Modell — der Versatz erbt es, er verursacht es nicht.
 * @param {string} iso  «2026-08-29T20:00»
 * @param {number} versatzMin
 * @returns {string} im selben Format
 */
export function verschoben(iso, versatzMin) {
  if (!iso || !versatzMin) return iso;
  return local(toDate(toMin(iso) + versatzMin));
}

/**
 * Der Versatz als Text plus Zustandsklasse — die EINE Stelle, an der die
 * Formulierung steht. Stepper, Live-Leiste und Show-Kopfzeile lesen alle hier,
 * sonst stünde dieselbe Aussage in drei Wortlauten nebeneinander im Bild.
 *
 * In MINUTEN, nicht in Stunden: bei einem Ablauf zählt man Minuten, und «1,5h
 * Delay» müsste man am Pult erst zurückrechnen.
 * @returns {{text: string, klasse: string}}
 */
export function versatzText(versatzMin) {
  const m = Math.round(versatzMin || 0);
  if (!m) return { text: 'im Plan', klasse: '' };
  if (m > 0) return { text: m + ' Min Delay', klasse: 'is-late' };
  return { text: -m + ' Min vor Plan', klasse: 'is-early' };
}

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
