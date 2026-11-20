// ── Phasen: Zeiträume mit einer FUNKTION ─────────────────────────────────────
// Planung (Büro), Vorbereitung (vor Ort), Aufbau, Show, Abbau. Die Farbe in der
// Leiste über der Zeitachse und die Tönung im Zeitstrahl hängen an der ART —
// nie am Namen. Der Name ist frei («Load-in», «Rückbau») und nur Beschriftung.
// DOM-frei, direkt testbar.
//
// Eine Phase: { id, art, name?, start, end } — start/end sind Zeitstempel wie bei
// Vorgängen. Phasen derselben Art dürfen sich nicht überlappen (zwei Aufbauten
// gleichzeitig wären keine Auskunft mehr, wo man gerade ist); Phasen
// verschiedener Arten schon (Abbau beginnt, während die Show noch läuft).

import { toMin, spanFehler } from './schedule.js';

export const PHASEN_ARTEN = [
  { id: 'planung',      label: 'Planung',      icon: '✎' },
  { id: 'vorbereitung', label: 'Vorbereitung', icon: '⚑' },
  { id: 'aufbau',       label: 'Aufbau',       icon: '▲' },
  { id: 'show',         label: 'Show',         icon: '★' },
  { id: 'abbau',        label: 'Abbau',        icon: '▼' },
];
const ARTEN = new Set(PHASEN_ARTEN.map((a) => a.id));
export const istPhasenArt = (a) => ARTEN.has(a);
const artLabel = (art) => (PHASEN_ARTEN.find((a) => a.id === art) || {}).label || String(art);

/** Die Art aus einem Altnamen erraten (Migration) — null, wenn nichts passt. */
export function artAusName(name) {
  const n = String(name || '');
  if (/abbau|r[uü]ckbau|load.?out|strike/i.test(n)) return 'abbau';
  if (/vorbereit|advance|prep/i.test(n)) return 'vorbereitung';
  if (/aufbau|load.?in|build/i.test(n)) return 'aufbau';
  if (/planung|plan\b/i.test(n)) return 'planung';
  if (/show|event|festival|konzert/i.test(n)) return 'show';
  return null;
}

/** Beschriftung: der Name, sonst die Art. */
export const phaseLabel = (p) => String(p.name || '').trim() || artLabel(p.art);

/** Die früheste Phase der Art «aufbau» — dort beginnt, wohin neue Vorgänge und die Startansicht gehen. */
export function aufbauPhase(phases) {
  return (phases || []).filter((p) => p.art === 'aufbau' && p.start && p.end)
    .sort((a, b) => toMin(a.start) - toMin(b.start))[0];
}

const ueberlappt = (a, b) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/**
 * Warum eine Phase nicht stehen darf — null = in Ordnung. `andere` sind die
 * übrigen Phasen (ohne diese selbst), gegen die die Überlappung gilt.
 */
export function phaseFehler(p, andere = []) {
  const name = `Phase «${phaseLabel(p)}»`;
  if (!istPhasenArt(p.art)) return `${name}: Unbekannte Art «${p.art}».`;
  if (!p.start || !p.end) return `${name}: Start und Ende müssen gesetzt sein.`;
  const bad = spanFehler(p.start, p.end);
  if (bad) return `${name}: ${bad}`;
  const kollidiert = andere.find((o) => o.art === p.art && o.start && o.end && ueberlappt(p, o));
  if (kollidiert) return `${name}: Überschneidet sich mit der Phase «${phaseLabel(kollidiert)}» (gleiche Art).`;
  return null;
}

/**
 * Die ganze Liste prüfen (Import): id eindeutig, Art bekannt, Spanne gültig.
 * Die Überlappungsregel gilt NUR für Store-Befehle: Altpläne, deren Namen auf
 * dieselbe Art geraten werden («Aufbau» + «Load-in»), dürfen sich überlappen —
 * der Import sperrte sonst Pläne aus, die vorher funktionierten.
 */
export function phasenFehler(phases) {
  const ids = new Set();
  const liste = phases || [];
  for (let i = 0; i < liste.length; i++) {
    const p = liste[i];
    if (!p || typeof p !== 'object') return 'Eine Phase ist kein Objekt.';
    if (ids.has(p.id)) return `Phase «${phaseLabel(p)}»: Die id ${p.id} kommt mehrfach vor.`;
    ids.add(p.id);
    const bad = phaseFehler(p, []);
    if (bad) return bad;
  }
  return null;
}

/**
 * Show-Tage: JEDE Show-Phase ist genau EIN Show-Tag — auch wenn sie über
 * Mitternacht in den Folgetag läuft (Fr 18:00 – Sa 02:00 ist «Show-Tag 1», nicht
 * zwei Kalendertage). Gezählt wird nach Start, fortlaufend. Wer einen zweiten
 * Showtag will, legt eine zweite Show-Phase an.
 * @returns {{phase:string, n:number}[]}
 */
export function showTage(phases) {
  return (phases || []).filter((p) => p && p.art === 'show' && p.start && p.end
    && !Number.isNaN(toMin(p.start)) && !Number.isNaN(toMin(p.end)) && toMin(p.end) > toMin(p.start))
    .sort((a, b) => toMin(a.start) - toMin(b.start))
    .map((p, i) => ({ phase: p.id, n: i + 1 }));
}

/**
 * Was ist jetzt? Alle Phasen, in denen `nowMin` liegt (Start zählt, Ende nicht):
 * { art, text, phase }. Show-Phasen melden den nummerierten Tag («Show-Tag 2»).
 * Leer, wenn heute in keiner Phase liegt.
 */
export function phasenJetzt(phases, nowMin) {
  if (!Number.isFinite(nowMin)) return [];
  const tage = showTage(phases);
  const out = [];
  for (const p of (phases || [])) {
    if (!p || !p.start || !p.end) continue;
    if (!(toMin(p.start) <= nowMin && nowMin < toMin(p.end))) continue;
    const t = p.art === 'show' ? tage.find((x) => x.phase === p.id) : null;
    out.push({ art: p.art, text: t ? 'Show-Tag ' + t.n : phaseLabel(p), phase: p.id });
  }
  return out;
}

/** Nur die Beschriftungen von phasenJetzt. */
export const phasenHeute = (phases, nowMin) => phasenJetzt(phases, nowMin).map((x) => x.text);
