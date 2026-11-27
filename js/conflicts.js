// ── Konflikte & Dauer-Eingabe ─────────────────────────────────────────────────
// Kein DOM. Ein Konflikt ist kein neuer Algorithmus: computeSchedule behandelt
// den eingetragenen Starttermin als UNTERGRENZE (Math.max über die Vorgänger).
// Liegt die früheste Lage darüber, ist eine Abhängigkeit verletzt — genau das
// ist die ganze Prüfung.

import { computeSchedule, toMin, toDate, ohneTermin, spanFehler } from './schedule.js';

// Zwei Minuten Schlupf gegen Rundung; darunter ist es kein echter Konflikt.
const EPS = 1;

/**
 * @param {object} state
 * @param {Map=} vorab  bereits gerechneter Terminplan. Ohne ihn rechnet die
 *   Funktion selbst — dann läuft die CPM aber doppelt, wenn der Aufrufer sie
 *   ohnehin schon hat. Bei 500 Vorgängen sind das 3,4 ms je Durchgang.
 *   Bewusst KEIN Cache in computeSchedule: der müsste auf Objekt-Identität
 *   schlüsseln, und wer Vorgänge in dieselbe Array-Instanz schiebt (Tests,
 *   tools/make-amk.mjs), bekäme still ein veraltetes Ergebnis.
 * @returns {{taskId, shortByMin, es, byDepId, message}[]}
 */
export function findConflicts(state, vorab) {
  let sched = vorab;
  try {
    if (!sched) sched = computeSchedule(state.tasks, state.deps);
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
  // Sammelvorgänge ausnehmen: ihre Lage ist die HÜLLE der Untervorgänge, nicht
  // direkt verschiebbar. Ein Konflikt an ihnen wäre nicht auflösbar (moveTask
  // lehnt sie ab) und risse den Sammelbefehl «Konflikte auflösen» mit.
  const parentIds = new Set(state.tasks.filter((t) => t.parent != null).map((t) => t.parent));
  const out = [];

  for (const t of state.tasks) {
    if (parentIds.has(t.id)) continue;
    // Eine Bereitstellung ist ein Pool, kein Ablaufschritt — sie hat keine
    // Verknüpfungen (der Store lehnt sie ab) und kann folglich nie im
    // Konflikt stehen. Sie trotzdem zu prüfen wäre reine Rechenzeit.
    if (t.bereitstellung || ohneTermin(t)) continue;
    const r = sched.get(t.id);
    if (!r) continue;
    const planned = toMin(t.start);
    const shortBy = r.es - planned;
    if (shortBy <= EPS) continue;
    // Als „ist ok" abgehakt? Nur solange der Konflikt nicht SCHLIMMER geworden ist
    // als beim Akzeptieren — wird er größer, meldet er sich wieder.
    if (t.ackConflictMin != null && shortBy <= t.ackConflictMin + EPS) continue;

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

/**
 * Nur die UHRZEIT eines Zeitstempels ersetzen, das Datum behalten.
 *
 * Im Showablauf zeigen Start und Ende keine Datumsangabe mehr — der Tag steht
 * oben im Umschalter. Beim Schreiben darf deshalb NICHT der gezeigte Tag
 * eingesetzt werden: ein Eintrag, der am Vortag begann, ist über den Tagesfilter
 * auch am Folgetag sichtbar, und er spränge beim ersten Antippen einen Tag weit.
 *
 * @param {string} iso   bestehender Wert, «2026-08-29T20:40»
 * @param {string} hhmm  neue Uhrzeit, «21:15»
 * @returns {string|null} null bei unbrauchbarer Eingabe — der Aufrufer lässt dann alles stehen
 */
export function mitUhrzeit(iso, hhmm) {
  const tag = String(iso || '').slice(0, 10);
  const zeit = String(hhmm || '').slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag) || !/^\d{2}:\d{2}$/.test(zeit)) return null;
  return tag + 'T' + zeit;
}

/**
 * Das Ende zu einem Start: liegt es nicht nach ihm, ist der Folgetag gemeint.
 *
 * «22:00 bis 03:00» ist die selbstverständliche Schreibweise jedes Ablaufplans.
 * Ohne diese Regel lehnte der Store ab («Das Ende muss nach dem Start liegen»),
 * und man käme über Mitternacht nicht hinaus.
 *
 * Der Folgetag wird über den KALENDER gesucht, nicht mit +1440 Minuten: der
 * 25.10.2026 hat 25 Stunden, und aus Minuten gerechnet landete man um 23:00.
 */
export function endeNachStart(startISO, hhmm) {
  const roh = mitUhrzeit(startISO, hhmm);
  if (!roh) return null;
  if (toMin(roh) > toMin(startISO)) return roh;
  const d = new Date(roh);
  d.setDate(d.getDate() + 1);
  return local(d);
}

/** «HH:MM» am Vortag, Tag oder Folgetag von `bezugISO` — der zeitlich nächste der drei. */
function naechsteUhrzeit(bezugISO, hhmm) {
  const roh = mitUhrzeit(bezugISO, hhmm);
  if (!roh) return null;
  const bezug = toMin(bezugISO);
  let best = null;
  for (const tage of [-1, 0, 1]) {
    const d = new Date(roh);
    d.setDate(d.getDate() + tage);
    const k = local(d);
    if (best === null || Math.abs(toMin(k) - bezug) < Math.abs(toMin(best) - bezug)) best = k;
  }
  return best;
}

// ── Zeilen-Entwurf ──────────────────────────────────────────────────────────
// Start, Ende und Dauer einer Zeile ändern zuerst nur einen ENTWURF; erst ✓
// schickt EINEN moveTask. Hier die reine Rechnung dazu — der Entwurf ist
// {start, end} (lokale Zeitstempel oder null), nie etwas anderes.

/**
 * Ein Feld des Entwurfs ändern.
 * Regel: «Was getippt wurde, gilt; das nicht angefasste Feld wird gerechnet.»
 * `fest` ist das ZULETZT angefasste ANDERE Feld des Entwurfs (null = keines).
 * - start: bei vollständigem Entwurf wandert das Ende mit (Dauer bleibt) —
 *          außer `fest==='end'`: dann bleibt das getippte Ende, die Dauer ergibt sich.
 * - end:   Start bleibt — außer `fest==='dauer'`: Start = Ende − Dauer (rückwärts).
 *          Ohne Datum («22:00 bis 03:00») gilt der Folgetag.
 * - dauer: das Ende = Start + Dauer — außer `fest==='end'`: Start = Ende − Dauer.
 * @param {{start:?string,end:?string}} e
 * @param {'start'|'end'|'dauer'} feld
 * @param {string} wert    Feldinhalt; bei `nurZeit` «HH:MM», sonst «JJJJ-MM-TTThh:mm»
 * @param {{nurZeit?:boolean, tag?:?string, milestone?:boolean, fest?:?('start'|'end'|'dauer')}} opt  `tag` = Tag für ein Zeitfeld ohne Bezug;
 *   `milestone`: Start setzt auch das Ende (das Ende-Feld ist bei Meilensteinen gesperrt)
 * @returns {{start:?string,end:?string,fehler:?string}} `fehler` nur bei unlesbarer
 *   EINGABE (der Entwurf bleibt dann unverändert); die Spanne prüft entwurfFehler.
 */
export function entwurfAendern(e, feld, wert, { nurZeit = false, tag = null, milestone = false, fest = null } = {}) {
  const alt = { start: e.start ?? null, end: e.end ?? null };
  const unlesbar = (msg) => ({ ...alt, fehler: msg });
  const basis = alt.start || alt.end || (tag ? tag + 'T00:00' : null);
  const roh = String(wert ?? '').trim();
  if (feld === 'start') {
    if (!roh) return { ...alt, start: null, end: milestone ? null : alt.end, fehler: null };
    const ns = nurZeit ? mitUhrzeit(basis, roh) : roh;
    if (!ns || Number.isNaN(toMin(ns))) return unlesbar('Start nicht lesbar.');
    let end = alt.end;
    if (milestone) end = ns;   // ein Meilenstein hat keine Dauer: Ende = Start
    else if (fest === 'end') end = alt.end;   // getipptes Ende gilt, die Dauer ergibt sich
    else if (alt.start && alt.end) end = local(toDate(toMin(ns) + (toMin(alt.end) - toMin(alt.start))));
    return { start: ns, end, fehler: null };
  }
  if (feld === 'end') {
    if (!roh) return { ...alt, end: null, fehler: null };
    const rueck = fest === 'dauer' && !milestone && alt.start && alt.end;   // Ende + Dauer fest: Start rechnen
    // Rückwärts (Showablauf): die Uhrzeit landet am Tag, der dem bisherigen Ende am nächsten liegt
    // (Ende 22:00 → «18:00» = derselbe Abend, «01:00» = die Nacht danach).
    const ne = nurZeit ? (rueck ? naechsteUhrzeit(alt.end, roh) : alt.start ? endeNachStart(alt.start, roh) : mitUhrzeit(basis, roh)) : roh;
    if (!ne || Number.isNaN(toMin(ne))) return unlesbar('Ende nicht lesbar.');
    if (rueck) return { start: local(toDate(toMin(ne) - (toMin(alt.end) - toMin(alt.start)))), end: ne, fehler: null };
    return { ...alt, end: ne, fehler: null };
  }
  if (feld === 'dauer') {
    const m = parseDuration(roh);
    if (m == null || m === 0) return unlesbar('Dauer nicht lesbar (z. B. 4h, 90m, 2t).');
    if (fest === 'end' && alt.end && !milestone) return { start: local(toDate(toMin(alt.end) - m)), end: alt.end, fehler: null };
    if (!alt.start) return unlesbar('Für eine Dauer fehlt der Start.');
    return { start: alt.start, end: local(toDate(toMin(alt.start) + m)), fehler: null };
  }
  return unlesbar('Unbekanntes Feld.');
}

/** Warum der Entwurf nicht übernommen werden kann — null = gültig (auch «ohne Termin»). */
export function entwurfFehler(e, { milestone = false } = {}) {
  const f = spanFehler(e.start ?? null, e.end ?? null, { milestone });
  // Nur die ANZEIGE des Entwurfs nennt den Ausweg; die Store-Meldung bleibt.
  return f === 'Start und Ende müssen gesetzt sein.'
    ? 'Start und Ende müssen gesetzt sein — oder beide leeren für ‹ohne Termin›.' : f;
}

// ── Dauer-Kurzform ──────────────────────────────────────────────────────────
// «4h», «1,5h», «90m», «2t», «1t 4h». Eine blanke Zahl sind Stunden — das ist
// die häufigste Eingabe. Unsinn liefert null; lieber nachfragen als raten.

// Ein Vorgang über einem Jahr ist ein Vertipper, kein Vorgang.
const MAX_DUR = 365 * 1440;

export function parseDuration(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase().replace(',', '.');
  if (!s) return null;

  // Zahl OHNE Einheit = Stunden. Das ist die häufigste Eingabe.
  // \d*\.?\d+ statt \d+(\.\d+)? — «.5» muss eine halbe Stunde sein.
  // Vorher las die Regex «.5h» als «5h»: ein stiller Faktor 10.
  if (/^\d*\.?\d+$/.test(s)) return clampDur(parseFloat(s) * 60);

  // Sonst: Folge aus Zahl+Einheit, durch Leerzeichen getrennt. Der Anker ^…$
  // ist wesentlich — ohne ihn schluckte der Parser «4hh» und «4h 4h» klaglos.
  const m = s.match(/^(\d*\.?\d+)\s*([tdhm])(?:\s+(\d*\.?\d+)\s*([tdhm]))?$/);
  if (!m) return null;

  const einheit = { t: 1440, d: 1440, h: 60, m: 1 };
  let total = parseFloat(m[1]) * einheit[m[2]];
  if (m[3]) {
    // Zwei Angaben nur, wenn die zweite feiner ist als die erste: «1t 4h» ja,
    // «4h 4h» nein — das ist ein Vertipper, keine Summe.
    if (einheit[m[4]] >= einheit[m[2]]) return null;
    total += parseFloat(m[3]) * einheit[m[4]];
  }
  return clampDur(total);
}

function clampDur(min) {
  const r = Math.round(min);
  if (!Number.isFinite(r) || r < 0 || r > MAX_DUR) return null;
  return r;
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
