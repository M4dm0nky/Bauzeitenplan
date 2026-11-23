// ── Zustand & Befehle ─────────────────────────────────────────────────────────
// Der einzige Weg, den Plan zu ändern, führt über store.apply(cmd). Kein DOM —
// damit ist die ganze Bearbeitungslogik direkt testbar, wie schedule.js.
//
// Rückgängig über SCHNAPPSCHÜSSE, nicht über Gegenbefehle. Begründung: ein Plan
// wiegt als JSON wenige zehn Kilobyte, davon 100 Stück sind belanglos — aber
// jeder handgeschriebene Gegenbefehl ist eine eigene Fehlerquelle, und die
// Fehler zeigen sich erst Stunden später beim ⌘Z. Der Schnappschuss kann nicht
// falsch sein. Nebenbei fällt das Zurückrollen gescheiterter Sammelbefehle
// geschenkt ab.

import { topoSort, toMin, toDate, spanFehler, ohneTermin } from './schedule.js';
import { MAX_SLOTS } from './palette.js';
import { local } from './conflicts.js';
import { RES_EINGEBAUT, RES_KATEGORIEN } from './res-katalog.js';
import { phaseFehler, istPhasenArt } from './phasen.js';

// Bewusst NICHT aus persistence.js importiert: der Store ist der Kern, die
// Ablage die äußere Schicht — diese Abhängigkeit liefe verkehrt herum. Für eine
// Zeile ist die Wiederholung billiger als ein falscher Pfeil.
const clone = (o) => JSON.parse(JSON.stringify(o));

// Ebenso bewusst nicht aus ebene.js importiert — dieselbe Richtung, dasselbe
// Argument: der Kern zeigt nicht auf die Ansichtsschicht (ebene.js hängt an
// conflicts.js, und dorthin liefe der Pfeil verkehrt herum). Altdaten ohne
// `art` sind Gewerke. Eigener Name, damit er nicht mit den Hilfen
// anderer Module verwechselt wird.
const artVon = (g) => g.art || 'gewerk';

// Die EINGEBAUTEN Eintragsarten, aus demselben Grund hier wiederholt statt aus
// ebene.js importiert. Gebraucht werden sie nur, damit `addPunktTyp` eine
// eigene Art nicht doppelt zu einer vorhandenen anlegt — «Changeover» zweimal
// im Auswahlfeld wäre für den Benutzer nicht auseinanderzuhalten.
//
// Eine Kopie läuft irgendwann auseinander, deshalb hält ein Test in
// `tests/store.test.mjs` sie gegen `PUNKT_TYPEN` — dasselbe Muster wie bei den
// Versionsstellen: doppelt geführt ist erlaubt, ungeprüft doppelt nicht.
const TYPEN_EINGEBAUT = [
  ['act', 'Act'], ['changeover', 'Changeover'], ['doors', 'Doors'], ['ende', 'Show-Ende'],
];
// Dasselbe für die Abschnitte, aus demselben Grund und mit demselben Test.
const ABSCHNITTE_EINGEBAUT = [['setup', 'Setup'], ['show', 'Show']];

// Die selbst befüllbaren Auswahllisten. `taskFeld` sagt, welches Feld am
// Vorgang darauf zeigt — daran hängt, ob ein Wert noch benutzt wird und sich
// deshalb nicht löschen lässt. Ressourcen stehen nicht in einem FELD, sondern
// in der Liste `t.res` — dafür trägt der Eintrag statt `taskFeld` ein `zaehlt`.
const LISTEN = {
  punktTypen: { eingebaut: TYPEN_EINGEBAUT, taskFeld: 'punktTyp' },
  abschnitte: { eingebaut: ABSCHNITTE_EINGEBAUT, taskFeld: 'abschnitt' },
  ressourcen: { eingebaut: RES_EINGEBAUT.map((r) => [r.id, r.label]), zaehlt: (t, id) => (t.res || []).some((z) => z.rid === id) },
};
const abschnittOderArt = (L, id) => (L.eingebaut.find(([k]) => k === id) || [id, id])[1];

/**
 * Wie viele Vorgänge benutzen diesen Auswahlwert?
 *
 * Exportiert, damit die Oberfläche NICHT selbst wissen muss, welches Feld am
 * Vorgang auf welche Liste zeigt. Die Verwaltung führte diese Zuordnung vorher
 * ein zweites Mal — lief sie auseinander, meldete der Löschknopf «0 Einträge»
 * und war offen, während der Store gleich darauf ablehnte.
 * @returns {number} 0, wenn die Liste unbekannt ist
 */
export function benutztVon(state, liste, id) {
  const L = LISTEN[liste];
  if (!L) return 0;
  const test = L.zaehlt ? (t) => L.zaehlt(t, id) : (t) => t[L.taskFeld] === id;
  return (state.tasks || []).filter(test).length;
}

/** Kennt der Plan diesen Abschnitt — eingebaut oder selbst angelegt? */
const abschnittBekannt = (state, v) =>
  ABSCHNITTE_EINGEBAUT.some(([k]) => k === v)
  || ((state.project && state.project.abschnitte) || []).some((a) => a.id === v);

/** Kennt der Plan diese Ressource (Personal/Maschine)? Eingebaute zählen mit. */
const resBekannt = (state, id) =>
  RES_EINGEBAUT.some((r) => r.id === id)
  || ((state.project && state.project.ressourcen) || []).some((r) => r.id === id);

// Die Status-Werte, aus demselben Grund wie die Arten doppelt geführt (dom.js
// ist DOM-Schicht, der Kern zeigt nicht dorthin). Ein Test in
// `tests/store.test.mjs` hält sie gegen `STATUS` aus dom.js.
export const STATUS_IDS = ['geplant', 'laeuft', 'fertig'];

// Grenzen für «Plan verschieben»: darüber entstünden ungültige Daten (Invalid
// Date). Minuten bis eine Woche, alles Größere sind Tage.
export const SHIFT_MAX_TAGE = 36500;
export const SHIFT_MAX_MIN = 10080;

/**
 * Einen Zeitstempel verschieben — EINE Rechnung für Store und Vorschau.
 * Erst Kalendertage (Wanduhrzeit bleibt über die Zeitumstellung), dann die
 * Minuten auf dem echten Zeitstempel. Leer bleibt leer.
 */
export function verschiebeZeit(iso, tage, minuten) {
  if (!iso) return iso;
  const d = new Date(toMin(iso) * 60000);
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + tage, d.getHours(), d.getMinutes());
  return local(toDate(t.getTime() / 60000 + minuten));
}

// Die Felder, die `setTaskField` schreiben darf: alles, was `migrate`
// (persistence.js) an Vorgängen normalisiert, plus Titel, Gewerk und Zeiten.
// NICHT dabei: `id` (Zuordnung von Verknüpfungen), `parent` (Ring-/Ebenen-
// Prüfung, nur über addTask) und `res` (Fenster- und Anzahlprüfung in
// setTaskRes). Ohne feste Liste schriebe ein Vertipper im Feldnamen still ein
// neues Feld in den Plan und in den Export.
const SCHREIBBAR = new Set([
  'title', 'gewerk', 'start', 'end', 'milestone', 'progress', 'status', 'notes',
  'bereitstellung', 'ackConflictMin', 'estimated',
  'punktTyp', 'anforderungen', 'material', 'kontakt', 'fuer', 'slot', 'abschnitt',
]);

/** Kennt der Plan diese Eintragsart — eingebaut oder selbst angelegt? */
const typBekannt = (state, v) =>
  TYPEN_EINGEBAUT.some(([k]) => k === v)
  || ((state.project && state.project.punktTypen) || []).some((a) => a.id === v);

/**
 * Prüft EINEN Feldwert — für setTaskField und addTask gemeinsam, damit beide
 * Wege dieselben Regeln haben. Geprüft wird nur das geschriebene Feld: ein
 * Vorgang mit veralteter Art bleibt in allen anderen Feldern bearbeitbar.
 * @param {object|null} t der bestehende Vorgang (null beim Anlegen)
 * @returns {string|null} Ablehnungsgrund oder null
 */
function feldFehler(state, t, field, value) {
  switch (field) {
    case 'title':
      return String(value || '').trim() ? null : 'Der Vorgang braucht einen Namen.';
    case 'gewerk':
      return state.gewerke.some((g) => g.id === value) ? null : 'Unbekanntes Gewerk.';
    case 'abschnitt':
      return abschnittBekannt(state, value) ? null : 'Diesen Abschnitt gibt es nicht: ' + value;
    case 'fuer':
      if (value === null) return null;
      if (t && value === t.id) return 'Ein Eintrag gehört nicht zu sich selbst.';
      return state.tasks.some((x) => x.id === value) ? null : 'Zugeordneter Eintrag nicht gefunden.';
    case 'status':
      return STATUS_IDS.includes(value) ? null : 'Diesen Status gibt es nicht: ' + value;
    case 'punktTyp':
      return typBekannt(state, value) ? null : 'Diese Eintragsart gibt es nicht: ' + value;
    case 'bereitstellung':
      // Eine Bereitstellung nimmt keine Verknüpfung an — sie ist ein Pool, kein
      // Ablaufschritt. Erst die Verknüpfungen entfernen, dann umschalten.
      return t && value && state.deps.some((d) => d.from === t.id || d.to === t.id)
        ? 'Erst die Verknüpfungen entfernen — eine Bereitstellung nimmt keine an.' : null;
    case 'slot': {
      // Farbplatz: null (erbt von der Bühne) oder ein Platz AUS der Palette.
      // Ohne die Prüfung landete ein Vertipper still im Export und der Balken
      // zeigte auf `var(--gw-NaN)` — also auf gar keine Farbe. Intern 0-basiert,
      // in der Oberfläche 1-basiert; die Meldung nennt deshalb nur die Zahl der
      // Plätze (gewählt wird über Knöpfe, hier tippt niemand).
      if (value === null) return null;
      return Number.isInteger(value) && value >= 0 && value < MAX_SLOTS ? null
        : 'Diesen Farbplatz gibt es nicht — die Palette hat ' + MAX_SLOTS + ' Plätze (oder leer für «wie Bühne»).';
    }
    default:
      return null;
  }
}

const UNDO_MAX = 100;

// Alles, was beim Löschen von `ids` mitgehen muss: Untervorgänge (parent) UND
// zugeordnete Einträge (fuer, der Soundcheck eines Acts). Bis zum Fixpunkt: ein
// Soundcheck hängt am Kind-Act eines Sammelvorgangs, oder auf einer anderen
// Bühne als sein Act — eine Stufe allein ließe Waisen mit totem parent/fuer stehen.
function kaskadeIds(state, ids) {
  const gone = new Set(ids);
  for (let wuchs = true; wuchs;) {
    wuchs = false;
    for (const t of state.tasks) {
      if (!gone.has(t.id) && (gone.has(t.parent) || gone.has(t.fuer))) { gone.add(t.id); wuchs = true; }
    }
  }
  return gone;
}

const ok = (extra = {}) => ({ ok: true, ...extra });

// Die Felder, die setProjectField anfassen darf (id, punktTypen … haben eigene Befehle).
const PROJEKT_FELDER = ['name', 'venue', 'timezone', 'start', 'end', 'adresse', 'anfahrt', 'kunde', 'kontakte', 'eingerichtet'];
const err = (msg) => ({ ok: false, error: msg });

let idSeq = 0;
export const newId = (prefix) => prefix + Date.now().toString(36) + (idSeq++).toString(36);

/**
 * Eine selbst angelegte Auswahl im Plan ablegen — Eintragsarten und Abschnitte
 * gehen denselben Weg, deshalb steht er einmal hier.
 *
 * Sie landen am PROJEKT und reisen damit im Export mit: ein Eintrag trägt nur
 * `punktTyp: "linecheck"` bzw. `abschnitt: "loadin"`, und ohne die Namensliste
 * in derselben Datei sähe der Empfänger genau diese Kennung.
 *
 * Verglichen wird gegen die eingebauten MIT, ohne Rücksicht auf Groß- und
 * Kleinschreibung — «Changeover» zweimal im Auswahlfeld wäre nicht
 * auseinanderzuhalten.
 * @returns {string|{ok:true,id:string}} Fehlertext oder Erfolg
 */
function neuerEintrag(state, { feld, eingebaut, praefix, fehlt, doppelt, label: roh, extra = {} }) {
  const label = String(roh || '').trim();
  if (!label) return fehlt;
  if (label.length > 40) return 'Der Name ist zu lang (höchstens 40 Zeichen).';
  const vorhanden = state.project[feld] || [];
  const alle = [...eingebaut, ...vorhanden.map((x) => [x.id, x.label])];
  if (alle.some(([, l]) => String(l).toLowerCase() === label.toLowerCase()))
    return doppelt + label;
  // Lesbare id aus dem Namen; bei Kollision oder leerem Rest eine erzeugte.
  let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!id || alle.some(([k]) => k === id)) id = newId(praefix);
  if (!Array.isArray(state.project[feld])) state.project[feld] = [];
  // Wurde schon einmal von Hand sortiert, bekommt der neue Wert das nächste
  // `sort` — sonst hinge er ohne eines am Ende der Liste, und ein späteres
  // Sortieren müsste ihn erst einsammeln. Vorher war das der Fehler aus dem
  // Review: ohne `sort` sprang er beim Anzeigen nach vorn.
  const sortiert = vorhanden.some((x) => x.sort != null);
  const naechstes = sortiert
    ? Math.max(-1, ...vorhanden.map((x) => (x.sort == null ? -1 : x.sort))) + 1
    : undefined;
  state.project[feld].push({ id, label, ...extra, ...(sortiert ? { sort: naechstes } : {}) });
  return ok({ id });
}

// ── Validierung ─────────────────────────────────────────────────────────────
// Läuft IMMER vor der Änderung. Ein abgelehnter Befehl darf keinen halben
// Zustand hinterlassen, nicht auf den Undo-Stapel und nichts als ungesichert
// markieren.

// Zuweisungs-Fenster (`t.res[].von/bis`) folgen ihrem Vorgang. Gerufen NACH
// erfolgreicher Prüfung, innerhalb desselben Befehls — ein ⌘Z holt Vorgang und
// Fenster gemeinsam zurück. Gleiche (echte) Dauer = Verschiebung: Fenster
// wandern um dieselben Minuten. Sonst wird beschnitten; ein Fenster, das danach
// leer wäre, wird zu `null` (= ganzer Vorgang). Meilensteine bleiben unberührt.
function resNachziehen(t, altStart, altEnd) {
  if (t.milestone || !Array.isArray(t.res) || !t.res.length) return;
  // Ohne Termin gibt es keinen Vorgang, in dem ein Fenster liegen könnte: alle
  // Fenster werden zu «ganzer Vorgang». Aus «ohne Termin» heraus waren sie schon null.
  if (ohneTermin(t) || altStart == null || altEnd == null) {
    t.res = t.res.map((z) => ({ ...z, von: null, bis: null }));
    return;
  }
  const s = toMin(t.start), e = toMin(t.end);
  const delta = s - toMin(altStart);
  const gleich = e - s === toMin(altEnd) - toMin(altStart);
  t.res = t.res.map((z) => {
    if (z.von == null || z.bis == null) return { ...z };
    let von = toMin(z.von), bis = toMin(z.bis);
    if (gleich) { von += delta; bis += delta; }
    else { von = Math.max(von, s); bis = Math.min(bis, e); }
    if (bis <= von) return { ...z, von: null, bis: null };
    return { ...z, von: local(toDate(von)), bis: local(toDate(bis)) };
  });
}

const checkSpan = (start, end, milestone) => spanFehler(start, end, { milestone });

// Hat der Vorgang Untervorgänge? Dann ist er ein Sammelvorgang: seine Zeiten sind
// die HÜLLE der Kinder und nicht von Hand editierbar.
const hasChildren = (state, id) => state.tasks.some((t) => t.parent === id);

// Sammelvorgänge auf die Hülle ihrer Untervorgänge nachziehen: Start = frühester
// Kindstart, Ende = spätestes Kindende. Läuft nach JEDER Änderung (in apply),
// damit schedule.js, conflicts.js und persistence.js konsistente Werte sehen —
// kein Cache, der veralten könnte (Regel aus CLAUDE.md). Nur EINE Ebene: ein Kind
// kann selbst keine Kinder haben (in addTask erzwungen), also genügt ein Durchlauf.
function reflowParents(state) {
  for (const p of state.tasks) {
    let s = null, e = null;
    let hatKind = false;
    for (const k of state.tasks) {
      if (k.parent !== p.id) continue;
      hatKind = true;
      if (ohneTermin(k)) continue;      // terminlose Kinder tragen nichts zur Hülle bei
      if (s == null || toMin(k.start) < toMin(s)) s = k.start;
      if (e == null || toMin(k.end) > toMin(e)) e = k.end;
    }
    if (!hatKind) continue;           // keine Kinder → kein Sammelvorgang
    // Alle Kinder terminlos → s/e bleiben null → die Hülle ist selbst terminlos.
    const altStart = p.start, altEnd = p.end;
    p.start = s;
    p.end = e;
    p.milestone = false;              // ein Sammelvorgang hat Dauer, ist keine Raute
    // Wandert die Hülle, wandern die Zuweisungsfenster mit — wie bei moveTask.
    if (altStart !== s || altEnd !== e) resNachziehen(p, altStart, altEnd);
  }
}

function wouldCycle(state, deps) {
  try {
    topoSort(state.tasks.map((t) => t.id), deps);
    return null;
  } catch (e) {
    // topoSort wirft mit .cycle — daraus wird eine Meldung, die Namen nennt
    // statt ids, sonst sucht man den Ring von Hand.
    const title = (id) => (state.tasks.find((t) => t.id === id) || {}).title || id;
    return 'Das ergäbe einen Ring: ' + (e.cycle || []).map(title).join(' → ');
  }
}

// ── Befehle ─────────────────────────────────────────────────────────────────
// Jeder bekommt den (bereits geklonten) Zustand und ändert ihn direkt.
// Rückgabe: null/undefined = ok, String = Ablehnungsgrund, {ok,...} = Ergebnis.

const HANDLERS = {
  addTask(state, cmd) {
    const t = cmd.task || {};
    let gewerk = t.gewerk;
    // Untervorgang: der Elternvorgang muss existieren und darf selbst kein Kind
    // sein (nur eine Ebene). Das Gewerk erbt das Kind vom Elternvorgang.
    const parent = t.parent ?? null;
    if (parent != null) {
      const p = state.tasks.find((x) => x.id === parent);
      if (!p) return 'Übergeordneter Vorgang nicht gefunden.';
      if (p.parent != null) return 'Ein Untervorgang kann keine eigenen Untervorgänge haben (nur eine Ebene).';
      gewerk = p.gewerk;
    }
    if (!state.gewerke.some((g) => g.id === gewerk) && gewerk !== 'projekt') return 'Unbekanntes Gewerk: ' + gewerk;
    if (!String(t.title || '').trim()) return 'Der Vorgang braucht einen Namen.';
    const milestone = !!t.milestone;
    const bad = checkSpan(t.start, t.end, milestone);
    if (bad) return bad;
    const id = t.id || newId('t');
    if (state.tasks.some((x) => x.id === id)) return 'Diese id gibt es schon: ' + id;
    // Dieselben Regeln wie setTaskField, nur für Felder, die mitgegeben wurden
    // (fehlt eins, greift der Standard unten). `fuer` bleibt draußen: beim
    // Import/Duplizieren darf der Act hinter seinem Soundcheck stehen.
    for (const f of ['slot', 'punktTyp', 'status']) {
      if (t[f] === undefined) continue;
      const fehler = feldFehler(state, null, f, t[f]);
      if (fehler) return fehler;
    }
    // Zuweisungen nur übernehmen, wenn sie auf bekannte Ressourcen zeigen —
    // sonst käme ein importierter/getippter Vertipper still in den Export und
    // hinge im Bedarfsraster nirgends ein.
    const res = (Array.isArray(t.res) ? t.res : [])
      .filter((z) => resBekannt(state, z.rid) && Number.isInteger(z.n) && z.n > 0)
      .map((z) => ({ rid: z.rid, n: z.n, von: z.von ?? null, bis: z.bis ?? null }));
    state.tasks.push({
      id, gewerk, title: String(t.title).trim(),
      start: t.start ?? null, end: t.end ?? null, milestone,
      progress: t.progress ?? 0, status: t.status || 'geplant',
      notes: t.notes || '', parent,
      // Setup oder Show. MUSS hier durch: wer im Setup-Abschnitt anlegt, will
      // dort einen Eintrag — fiel das Feld weg, landete er in der Show und war
      // im gerade gezeigten Abschnitt sofort unsichtbar.
      abschnitt: abschnittBekannt(state, t.abschnitt) ? t.abschnitt : 'show',
      // Wem gehört der Eintrag? Ein Soundcheck zeigt auf seinen Act. MUSS hier
      // durch — was der Handler nicht aufzählt, fällt beim Anlegen still weg.
      fuer: t.fuer ?? null,
      // Personal & Maschinen: `res` ist der Bedarf, `bereitstellung` macht
      // daraus ein Angebot — der Pool, aus dem andere Vorgänge ihre Zuweisung
      // nehmen. MUSS hier durch, sonst fällt eine mitgegebene Zuweisung beim
      // Anlegen (z. B. Duplizieren, Import) still weg.
      res, bereitstellung: !!t.bereitstellung,
      // Showablauf-Felder und Merker, Standards wie in `migrate`. MUSS hier
      // durch — vorher fielen sie beim Anlegen still weg (Duplizieren, Import).
      slot: t.slot ?? null, punktTyp: t.punktTyp ?? 'act', estimated: !!t.estimated,
      anforderungen: t.anforderungen ?? '', material: t.material ?? '', kontakt: t.kontakt ?? '',
      ackConflictMin: t.ackConflictMin ?? null,
    });
    return ok({ id });
  },

  removeTask(state, cmd) {
    const i = state.tasks.findIndex((t) => t.id === cmd.id);
    if (i < 0) return 'Vorgang nicht gefunden.';
    // Ein Sammelvorgang nimmt seine Untervorgänge mit (Kaskade) — wie beim
    // Löschen eines Gewerks. Rückgängig über den Schnappschuss, nicht Stück für
    // Stück. Ohne die Kaskade blieben verwaiste Kinder mit totem parent zurück.
    const gone = kaskadeIds(state, new Set([cmd.id]));
    state.tasks = state.tasks.filter((t) => !gone.has(t.id));
    // Verwaiste Abhängigkeiten mitnehmen: sonst zeigen Pfeile ins Leere und
    // die Terminrechnung stolpert über undefined.
    state.deps = state.deps.filter((d) => !gone.has(d.from) && !gone.has(d.to));
    return ok();
  },

  setTaskField(state, cmd) {
    const t = state.tasks.find((x) => x.id === cmd.id);
    if (!t) return 'Vorgang nicht gefunden.';
    // Die Zuordnung zum Elternvorgang läuft nicht über setTaskField (Ring-/Ebenen-
    // Prüfung fehlte hier) — heute nur über addTask beim Anlegen des Untervorgangs.
    if (cmd.field === 'parent') return 'Die Zuordnung zum Elternvorgang wird nicht so geändert.';
    // Zuweisungen ändert man über setTaskRes — dort steckt die Prüfung von
    // Zeitfenster und Anzahl. Über setTaskField käme das ungeprüft rein.
    if (cmd.field === 'res') return 'Zuweisungen ändert man über setTaskRes.';
    if (!SCHREIBBAR.has(cmd.field)) return 'Dieses Feld lässt sich nicht ändern: ' + cmd.field;
    // Sammelvorgang: Zeiten sind die Hülle der Untervorgänge, nicht editierbar.
    if (['start', 'end', 'milestone'].includes(cmd.field) && hasChildren(state, cmd.id))
      return 'Die Zeiten ergeben sich aus den Untervorgängen.';
    // Ein Untervorgang bleibt im Gewerk seines Elternvorgangs.
    if (cmd.field === 'gewerk' && t.parent != null)
      return 'Ein Untervorgang bleibt im Gewerk seines Elternvorgangs.';
    const next = { ...t, [cmd.field]: cmd.value };
    if (['start', 'end', 'milestone'].includes(cmd.field)) {
      const bad = checkSpan(next.start, next.end, next.milestone);
      if (bad) return bad;
    }
    const fehler = feldFehler(state, t, cmd.field, cmd.value);
    if (fehler) return fehler;
    // Der Titel wird getrimmt, wie beim Anlegen.
    const altStart = t.start, altEnd = t.end;
    t[cmd.field] = cmd.field === 'title' ? String(cmd.value).trim() : cmd.value;
    if (cmd.field === 'start' || cmd.field === 'end') resNachziehen(t, altStart, altEnd);
    // Wechselt ein Elternvorgang das Gewerk, ziehen seine Untervorgänge mit —
    // sonst blieben sie im alten Gewerk zurück.
    if (cmd.field === 'gewerk') for (const k of state.tasks) if (k.parent === t.id) k.gewerk = cmd.value;
    return ok();
  },

  moveTask(state, cmd) {
    const t = state.tasks.find((x) => x.id === cmd.id);
    if (!t) return 'Vorgang nicht gefunden.';
    // Sammelvorgänge werden nicht direkt verschoben — ihre Lage folgt den Kindern.
    if (hasChildren(state, cmd.id)) return 'Die Zeiten ergeben sich aus den Untervorgängen.';
    // start UND end beide null = «ohne Termin» (EIN Befehl, EIN Undo-Schritt).
    // Ein einzelnes null lehnt checkSpan ab.
    const start = cmd.start ?? null, end = cmd.end ?? null;
    const bad = checkSpan(start, end, t.milestone);
    if (bad) return bad;
    const altStart = t.start, altEnd = t.end;
    t.start = start;
    t.end = end;
    resNachziehen(t, altStart, altEnd);
    return ok();
  },

  addDep(state, cmd) {
    const d = cmd.dep || {};
    if (d.from === d.to) return 'Ein Vorgang kann nicht von sich selbst abhängen.';
    const from = state.tasks.find((t) => t.id === d.from);
    const to = state.tasks.find((t) => t.id === d.to);
    if (!from) return 'Vorgänger nicht gefunden.';
    if (!to) return 'Nachfolger nicht gefunden.';
    // Eine Bereitstellung ist ein Pool, kein Ablaufschritt — ein Pfeil auf sie
    // ergäbe keine Aussage über eine Abhängigkeit.
    if (from.bereitstellung || to.bereitstellung) return 'Eine Bereitstellung nimmt keine Verknüpfung an.';
    if (state.deps.some((x) => x.from === d.from && x.to === d.to)) return 'Diese Verknüpfung gibt es schon.';
    if (!['FS', 'SS', 'FF', 'SF'].includes(d.type || 'FS')) return 'Unbekannter Verknüpfungstyp: ' + d.type;
    const next = [...state.deps, { from: d.from, to: d.to }];
    const ring = wouldCycle(state, next);
    if (ring) return ring;
    const id = d.id || newId('d');
    state.deps.push({ id, from: d.from, to: d.to, type: d.type || 'FS', lag: d.lag ?? 0 });
    return ok({ id });
  },

  removeDep(state, cmd) {
    const i = state.deps.findIndex((d) => d.id === cmd.id);
    if (i < 0) return 'Verknüpfung nicht gefunden.';
    state.deps.splice(i, 1);
    return ok();
  },

  setDepField(state, cmd) {
    const d = state.deps.find((x) => x.id === cmd.id);
    if (!d) return 'Verknüpfung nicht gefunden.';
    if (cmd.field === 'type' && !['FS', 'SS', 'FF', 'SF'].includes(cmd.value)) return 'Unbekannter Verknüpfungstyp.';
    // Nur Typ und Lag sind Sache dieses Befehls: from/to/id würden die
    // Verknüpfung umbiegen, ohne Ring- und Bereitstellungsprüfung von addDep.
    if (cmd.field === 'lag') {
      if (!Number.isInteger(cmd.value)) return 'Der Versatz muss eine ganze Zahl (Minuten) sein.';
    } else if (cmd.field !== 'type') return 'Dieses Feld lässt sich nicht ändern: ' + cmd.field;
    d[cmd.field] = cmd.value;
    return ok();
  },

  addGewerk(state, cmd) {
    const g = cmd.gewerk || {};
    const name = String(g.name || '').trim();
    if (!name) return 'Das Gewerk braucht einen Namen.';
    // Eine Bühne ist ein Gewerk der Showablauf-Ebene (js/ebene.js). Ein Name darf
    // in beiden Ebenen einmal vorkommen — «Bühne» als Gewerk und «Bühne» als
    // Spielstätte sind zwei verschiedene Dinge und stehen nie nebeneinander.
    const art = g.art === 'buehne' ? 'buehne' : 'gewerk';
    const was = art === 'buehne' ? 'Diese Bühne gibt es schon: ' : 'Dieses Gewerk gibt es schon: ';
    if (state.gewerke.some((x) => artVon(x) === art && x.name.toLowerCase() === name.toLowerCase())) return was + name;
    const id = g.id || newId(art === 'buehne' ? 'b' : 'g');
    state.gewerke.push({
      id, name, art,
      sort: g.sort ?? state.gewerke.length,
      // Farbe folgt dem Gewerk, nicht seiner Position: der Platz wird einmal
      // vergeben und bleibt. Sonst färbte sich beim Umsortieren alles um.
      slot: g.slot ?? freeSlot(state, art),
    });
    return ok({ id });
  },

  removeGewerk(state, cmd) {
    const i = state.gewerke.findIndex((g) => g.id === cmd.id);
    if (i < 0) return 'Gewerk nicht gefunden.';
    state.gewerke.splice(i, 1);
    // Auch Soundchecks auf anderen Bühnen, deren Act hier stand (fuer-Kaskade).
    const gone = kaskadeIds(state, new Set(state.tasks.filter((t) => t.gewerk === cmd.id).map((t) => t.id)));
    state.tasks = state.tasks.filter((t) => !gone.has(t.id));
    state.deps = state.deps.filter((d) => !gone.has(d.from) && !gone.has(d.to));
    return ok();
  },

  reorderGewerk(state, cmd) {
    const list = [...state.gewerke].sort((a, b) => a.sort - b.sort);
    const i = list.findIndex((g) => g.id === cmd.id);
    if (i < 0) return 'Gewerk nicht gefunden.';
    const j = i + (cmd.dir < 0 ? -1 : 1);
    if (j < 0 || j >= list.length) return cmd.dir < 0 ? 'Steht schon ganz oben.' : 'Steht schon ganz unten.';
    [list[i], list[j]] = [list[j], list[i]];
    // Lückenlos durchnummerieren. Würde man nur die beiden Werte tauschen,
    // blieben Doppelte aus Altdaten bestehen und die Reihenfolge wäre zufällig.
    // Der Farbplatz (slot) wird NICHT angefasst: Farbe gehört dem Gewerk, nicht
    // seiner Position — sonst färbte sich beim Sortieren der halbe Plan um.
    list.forEach((g, k) => { g.sort = k; });
    return ok();
  },

  // Wie reorderGewerk, aber an eine BELIEBIGE Position — fürs Drag & Drop in der
  // Tabelle. `before` = ID des Gewerks, VOR das eingefügt wird; null = ans Ende.
  // before-Semantik statt Zielindex ist robust gegen die Verschiebung, die das
  // Herausnehmen des gezogenen Gewerks erzeugt.
  moveGewerk(state, cmd) {
    const list = [...state.gewerke].sort((a, b) => a.sort - b.sort);
    const orig = list.map((g) => g.id);
    const i = list.findIndex((g) => g.id === cmd.id);
    if (i < 0) return 'Gewerk nicht gefunden.';
    if (cmd.before === cmd.id) return 'Steht schon dort.';
    const [moved] = list.splice(i, 1);
    let j = list.length;                       // Vorgabe: ans Ende
    if (cmd.before != null) {
      j = list.findIndex((g) => g.id === cmd.before);
      if (j < 0) return 'Zielgewerk nicht gefunden.';
    }
    list.splice(j, 0, moved);
    // Nichts verschoben? Ablehnen — kein leerer Undo-Eintrag.
    if (list.every((g, k) => g.id === orig[k])) return 'Steht schon dort.';
    // Der Farbplatz (slot) bleibt unberührt: Farbe gehört dem Gewerk, nicht seiner
    // Position. Nur sort wird lückenlos 0…n neu vergeben.
    list.forEach((g, k) => { g.sort = k; });
    return ok();
  },

  duplicateTask(state, cmd) {
    const t = state.tasks.find((x) => x.id === cmd.id);
    if (!t) return 'Vorgang nicht gefunden.';
    const id = newId('t');
    // Das Duplikat steht OHNE Verknüpfungen da: deps leben in state.deps, nicht
    // am Vorgang — die Kopie erbt sie also gar nicht erst, und das ist richtig
    // so. Mit denselben Vorgängern stünde sie sofort im Konflikt, und niemand
    // will beim Duplizieren einen roten Plan. Weil das Fehlen im Bild nicht zu
    // sehen ist, sagt es app.js dem Nutzer per Toast.
    state.tasks.push({ ...t, id, title: t.title + ' (Kopie)' });
    return ok({ id });
  },

  setGewerkField(state, cmd) {
    const g = state.gewerke.find((x) => x.id === cmd.id);
    if (!g) return 'Gewerk nicht gefunden.';
    // Die Ebene eines Bandes wechselt man nicht im Vorbeigehen: alle Vorgänge
    // darin sprängen mit, aus Aufbauschritten würden Programmpunkte. Wer eine
    // Bühne will, legt eine an.
    if (cmd.field === 'art') return 'Ein Gewerk wird nicht nachträglich zur Bühne.';
    // Den Abschnitt trägt der ZEITEINTRAG, nicht das Band: es gibt eine Bühne
    // mit zwei Abläufen, nicht zwei Bühnen.
    if (cmd.field === 'abschnitt') return 'Den Abschnitt trägt der Zeiteintrag, nicht die Bühne.';
    if (cmd.field === 'name') {
      const name = String(cmd.value || '').trim();
      if (!name) return 'Das Gewerk braucht einen Namen.';
      if (state.gewerke.some((x) => x.id !== cmd.id && artVon(x) === artVon(g) && x.name.toLowerCase() === name.toLowerCase()))
        return (artVon(g) === 'buehne' ? 'Diese Bühne gibt es schon: ' : 'Dieses Gewerk gibt es schon: ') + name;
      g.name = name;
      return ok();
    }
    // Alles andere (id, slot, sort, …) hat eigene Wege oder gehört dem Store.
    return 'Dieses Feld lässt sich nicht ändern: ' + cmd.field;
  },

  /**
   * Den ganzen Plan um Tage und Minuten verschieben (Vorgänge, Zuweisungs-
   * Fenster, Phasen, Projektrahmen) — EIN Befehl, EIN Undo-Schritt.
   *
   * Erst die Kalendertage, dann die Minuten: so bleibt die Wanduhrzeit über die
   * Sommerzeit-Umstellung erhalten (wie `verschobenUm` in timeaxis.js, hier
   * nachgebaut, weil der Kern nicht auf die Ansichtsschicht zeigt). Jeder
   * Zeitstempel wandert einzeln; terminlose bleiben terminlos.
   */
  shiftPlan(state, cmd) {
    const { tage, minuten } = cmd;
    if (!Number.isInteger(tage) || !Number.isInteger(minuten)) return 'Tage und Minuten müssen ganze Zahlen sein.';
    if (!tage && !minuten) return 'Nichts zu verschieben.';
    if (Math.abs(tage) > SHIFT_MAX_TAGE) return `Höchstens ${SHIFT_MAX_TAGE} Tage verschieben.`;
    if (Math.abs(minuten) > SHIFT_MAX_MIN) return `Höchstens ${SHIFT_MAX_MIN} Minuten verschieben — größere Sprünge als Tage angeben.`;
    const schieb = (iso) => verschiebeZeit(iso, tage, minuten);
    for (const t of state.tasks) {
      t.start = schieb(t.start); t.end = schieb(t.end);
      for (const z of t.res || []) { z.von = schieb(z.von); z.bis = schieb(z.bis); }
    }
    for (const ph of state.phases || []) { ph.start = schieb(ph.start); ph.end = schieb(ph.end); }
    state.project.start = schieb(state.project.start);
    state.project.end = schieb(state.project.end);
    return ok();
  },

  /**
   * Eine eigene Art für Zeiteinträge anlegen (Line-Check, Catering …).
   *
   * Sie steht im PLAN (`project.punktTypen`) und reist damit im Export mit:
   * ein Eintrag trägt nur `punktTyp: "linecheck"`, und ohne die Namensliste
   * daneben sähe der Empfänger genau das statt «Line-Check».
   *
   * `kompakt` heißt: tritt auf dem A3-Blatt zurück, wie ein Changeover.
   */
  addPunktTyp(state, cmd) {
    return neuerEintrag(state, {
      feld: 'punktTypen', eingebaut: TYPEN_EINGEBAUT, praefix: 'pt',
      fehlt: 'Die Art braucht einen Namen.', doppelt: 'Diese Art gibt es schon: ',
      label: cmd.label, extra: { kompakt: !!cmd.kompakt },
    });
  },

  /**
   * Einen eigenen Abschnitt anlegen (Load-in, Soundcheck, Aftershow …).
   *
   * Wie die Eintragsarten: im Plan, im Export, eingebaute nicht überschreibbar.
   *
   * **Er filtert die Ansicht nicht.** Der Umschalter oben kennt weiter Setup und
   * Show; ein eigener Abschnitt ist ein Etikett am Eintrag und wird in der
   * Show-Ansicht gezeigt (`abschnittOf` in ebene.js). Wer daran etwas ändert,
   * muss den Umschalter mitdenken.
   */
  addAbschnitt(state, cmd) {
    return neuerEintrag(state, {
      feld: 'abschnitte', eingebaut: ABSCHNITTE_EINGEBAUT, praefix: 'ab',
      fehlt: 'Der Abschnitt braucht einen Namen.', doppelt: 'Diesen Abschnitt gibt es schon: ',
      label: cmd.label,
    });
  },

  /**
   * Eine eigene Bezeichnung für Personal oder Maschinen anlegen. Die festen
   * stehen im Katalog (res-katalog.js); hier kommt nur Eigenes dazu, optional
   * in einer Kategorie derselben Art (`kat`), sonst «Eigene …».
   *
   * Steht im Plan (`project.ressourcen`) und reist im Export mit — ohne die
   * Namensliste sähe der Empfänger nur `rid:"stagehand"`.
   */
  addRessource(state, cmd) {
    const kind = cmd.kind === 'maschine' ? 'maschine' : 'personal';
    // Validierung VOR der Änderung: eine falsche Kategorie legt nichts an.
    if (cmd.kat != null && !RES_KATEGORIEN.some((k) => k.id === cmd.kat && k.kind === kind))
      return 'Unbekannte Kategorie: ' + cmd.kat;
    return neuerEintrag(state, {
      feld: 'ressourcen', eingebaut: LISTEN.ressourcen.eingebaut, praefix: 'r',
      fehlt: 'Die Bezeichnung braucht einen Namen.', doppelt: 'Diese Bezeichnung gibt es schon: ',
      label: cmd.label, extra: { kind, kat: cmd.kat ?? (kind === 'maschine' ? 'eigene-m' : 'eigene-p') },
    });
  },

  /**
   * Eine Zuweisung am Vorgang setzen, ändern oder löschen — der EINZIGE Weg,
   * `t.res` zu ändern (setTaskField lehnt das Feld ab). `index: null` hängt an,
   * ein vorhandener Index ersetzt; `value: null` löscht den Eintrag am Index.
   *
   * Das Zeitfenster ist optional: `von`/`bis` fehlen heißt »der ganze
   * Vorgang« — der Normalfall, dabei tippt niemand ein Datum. Ist eines
   * gesetzt, muss es INNERHALB der Vorgangsdauer liegen — ein Helfer, der vor
   * dem Vorgang anfängt, ist ein Tippfehler, kein Fall.
   */
  setTaskRes(state, cmd) {
    const t = state.tasks.find((x) => x.id === cmd.id);
    if (!t) return 'Vorgang nicht gefunden.';
    if (hasChildren(state, cmd.id)) return 'Ressourcen weist man den Untervorgängen zu, nicht dem Sammelvorgang.';
    const list = [...(t.res || [])];
    const idx = cmd.index ?? null;

    if (cmd.value === null) {
      if (idx == null || idx < 0 || idx >= list.length) return 'Zuweisung nicht gefunden.';
      list.splice(idx, 1);
    } else {
      const v = cmd.value;
      if (!resBekannt(state, v.rid)) return 'Unbekannte Bezeichnung: ' + v.rid;
      if (!Number.isInteger(v.n) || v.n <= 0) return 'Die Anzahl muss eine ganze Zahl größer 0 sein.';
      const von = v.von ?? null, bis = v.bis ?? null;
      if ((von == null) !== (bis == null)) return 'Start und Ende gehören zusammen — oder beide leer für den ganzen Vorgang.';
      if (von != null) {
        if (ohneTermin(t)) return 'Ein Zeitfenster braucht einen Termin am Vorgang.';
        if (toMin(bis) <= toMin(von)) return 'Das Ende muss nach dem Start liegen.';
        if (toMin(von) < toMin(t.start) || toMin(bis) > toMin(t.end))
          return 'Das Zeitfenster muss innerhalb des Vorgangs liegen.';
      }
      const eintrag = { rid: v.rid, n: v.n, von, bis };
      if (idx == null) list.push(eintrag);
      else {
        if (idx < 0 || idx >= list.length) return 'Zuweisung nicht gefunden.';
        list[idx] = eintrag;
      }
    }
    t.res = list;
    return ok();
  },

  /**
   * Eine selbst angelegte Auswahl umbenennen. Die **id bleibt** — sie ist die
   * Zuordnung. Änderte sie sich mit, verlöre jeder Eintrag seine Art bzw.
   * seinen Abschnitt, und zwar still: `punktLabel` reicht einen unbekannten
   * Wert einfach durch, im Bild stünde plötzlich die Kennung.
   */
  setAuswahlLabel(state, cmd) {
    const L = LISTEN[cmd.liste];
    if (!L) return 'Unbekannte Liste: ' + cmd.liste;
    const eigene = state.project[cmd.liste] || [];
    const x = eigene.find((e) => e.id === cmd.id);
    if (!x) return L.eingebaut.some(([k]) => k === cmd.id)
      ? `«${abschnittOderArt(L, cmd.id)}» ist fest eingebaut und lässt sich nicht umbenennen.`
      : 'Nicht gefunden: ' + cmd.id;
    const label = String(cmd.label || '').trim();
    if (!label) return 'Der Name darf nicht leer sein.';
    if (label.length > 40) return 'Der Name ist zu lang (höchstens 40 Zeichen).';
    // Gegen alle anderen prüfen, sich selbst ausgenommen — sonst ließe sich
    // nicht einmal die Groß-/Kleinschreibung des eigenen Namens ändern.
    const andere = [...L.eingebaut, ...eigene.filter((e) => e.id !== cmd.id).map((e) => [e.id, e.label])];
    if (andere.some(([, l]) => String(l).toLowerCase() === label.toLowerCase()))
      return 'Diesen Namen gibt es schon: ' + label;
    x.label = label;
    return ok();
  },

  /**
   * Eine selbst angelegte Auswahl löschen — nur, wenn sie niemand benutzt.
   *
   * Die Alternative wäre, die betroffenen Einträge auf den Standard
   * zurückzusetzen. Das ändert aber fünf Zeilen auf einmal hinter dem Rücken;
   * lieber sagt der Store, wie viele im Weg stehen, und man räumt sie selbst um.
   */
  removeAuswahl(state, cmd) {
    const L = LISTEN[cmd.liste];
    if (!L) return 'Unbekannte Liste: ' + cmd.liste;
    const eigene = state.project[cmd.liste] || [];
    const i = eigene.findIndex((e) => e.id === cmd.id);
    if (i < 0) return L.eingebaut.some(([k]) => k === cmd.id)
      ? `«${abschnittOderArt(L, cmd.id)}» ist fest eingebaut und lässt sich nicht löschen.`
      : 'Nicht gefunden: ' + cmd.id;
    const benutzt = benutztVon(state, cmd.liste, cmd.id);
    if (benutzt) {
      return `«${eigene[i].label}» wird von ${benutzt} ${benutzt === 1 ? 'Zeiteintrag' : 'Zeiteinträgen'} benutzt.`;
    }
    eigene.splice(i, 1);
    return ok();
  },

  /**
   * Die Reihenfolge der selbst angelegten Auswahl festlegen.
   *
   * Ab dem ersten Sortieren schlägt die Handreihenfolge die Automatik (bei den
   * Abschnitten: die Uhrzeit ihres frühesten Eintrags). Deshalb müssen ALLE
   * genannt sein — mit halbem `sort` stünde die Liste danach in einer
   * Reihenfolge, die niemand gewählt hat.
   */
  reorderAuswahl(state, cmd) {
    const L = LISTEN[cmd.liste];
    if (!L) return 'Unbekannte Liste: ' + cmd.liste;
    const eigene = state.project[cmd.liste] || [];
    const ids = cmd.ids || [];
    if (ids.length !== eigene.length || new Set(ids).size !== ids.length
      || !ids.every((id) => eigene.some((e) => e.id === id))) {
      return 'Die Reihenfolge muss genau die vorhandenen Einträge nennen.';
    }
    ids.forEach((id, n) => { eigene.find((e) => e.id === id).sort = n; });
    return ok();
  },

  /**
   * Phasen: Zeiträume mit einer Funktion (Planung, Vorbereitung, Aufbau, Show,
   * Abbau). Gleiche Art darf sich nicht überlappen; geprüft wird die ganze Phase
   * VOR der Änderung (phaseFehler), ein Fehler hinterlässt nichts.
   */
  addPhase(state, cmd) {
    const ph = cmd.phase || {};
    const neu = {
      id: ph.id || newId('ph'), art: ph.art, name: String(ph.name || '').trim(),
      start: ph.start ?? null, end: ph.end ?? null,
    };
    state.phases ??= [];
    if (state.phases.some((x) => x.id === neu.id)) return 'Diese id gibt es schon: ' + neu.id;
    const bad = phaseFehler(neu, state.phases);
    if (bad) return bad;
    state.phases.push(neu);
    return ok({ id: neu.id });
  },

  setPhase(state, cmd) {
    const ph = (state.phases || []).find((x) => x.id === cmd.id);
    if (!ph) return 'Phase nicht gefunden.';
    const neu = { ...ph };
    for (const f of ['art', 'name', 'start', 'end']) if (cmd[f] !== undefined) neu[f] = cmd[f];
    if (cmd.name !== undefined) neu.name = String(cmd.name || '').trim();
    if (!istPhasenArt(neu.art)) return 'Unbekannte Art: ' + neu.art;
    const bad = phaseFehler(neu, state.phases.filter((x) => x.id !== ph.id));
    if (bad) return bad;
    Object.assign(ph, neu);
    return ok();
  },

  removePhase(state, cmd) {
    const i = (state.phases || []).findIndex((x) => x.id === cmd.id);
    if (i < 0) return 'Phase nicht gefunden.';
    state.phases.splice(i, 1);
    return ok();
  },

  setProjectField(state, cmd) {
    if (!PROJEKT_FELDER.includes(cmd.field)) return 'Dieses Feld lässt sich nicht ändern: ' + cmd.field;
    if (cmd.field === 'timezone') {
      try { new Intl.DateTimeFormat('de', { timeZone: cmd.value }); }
      catch { return 'Unbekannte Zeitzone: ' + cmd.value; }
    }
    if (cmd.field === 'eingerichtet' && typeof cmd.value !== 'boolean') return 'Eingerichtet ist ja oder nein.';
    if (cmd.field === 'kontakte') {
      if (!Array.isArray(cmd.value)) return 'Die Kontakte müssen eine Liste sein.';
      const text = (x) => String(x ?? '').trim();
      const liste = [];
      for (const k of cmd.value) {
        if (!k || typeof k !== 'object' || !text(k.id)) return 'Jeder Kontakt braucht eine id.';
        liste.push({ id: text(k.id), name: text(k.name), rolle: text(k.rolle), tel: text(k.tel) });
      }
      state.project.kontakte = liste;
      return ok();
    }
    if (cmd.field === 'name' && !String(cmd.value || '').trim()) return 'Das Projekt braucht einen Namen.';
    if (['start', 'end'].includes(cmd.field)) {
      if (!Number.isFinite(toMin(cmd.value))) return 'Ungültiges Datum.';
      const next = { ...state.project, [cmd.field]: cmd.value };
      if (new Date(next.end).getTime() <= new Date(next.start).getTime()) return 'Das Projektende muss nach dem Start liegen.';
    }
    state.project[cmd.field] = cmd.value;
    return ok();
  },
};

// Niedrigster freier Farbplatz — nach dem Löschen wird er wieder vergeben.
//
// Die Plätze werden JE EBENE vergeben: Gewerke und Bühnen sind nie zusammen zu
// sehen, also dürfen sie dieselben Farben tragen. Zählte man alle zusammen,
// bekäme im Klassentreffen-Plan (20 Gewerke) die erste Bühne Platz 20 und die
// Palette gälte als erschöpft, obwohl kein Betrachter je eine Dopplung sieht.
function freeSlot(state, art = 'gewerk') {
  const used = new Set(state.gewerke.filter((g) => artVon(g) === art).map((g) => g.slot));
  for (let i = 0; ; i++) if (!used.has(i)) return i;
}

// ── Store ───────────────────────────────────────────────────────────────────

export function createStore(initial) {
  let state = clone(initial);
  if (!state.deps) state.deps = [];
  if (!state.tasks) state.tasks = [];
  if (!state.gewerke) state.gewerke = [];
  if (!Array.isArray(state.phases)) state.phases = [];
  // Bestandsdaten ohne Farbplatz nachrüsten
  state.gewerke.forEach((g, i) => { if (g.slot == null) g.slot = i; });
  state.tasks.forEach((t) => {
    if (t.parent === undefined) t.parent = null;
    // Robust gegen jeden Einstiegsweg (Vorlage, Import, Duplizieren): egal ob
    // das Feld je gesetzt wurde, hier steht danach immer ein Array bzw. bool.
    if (!Array.isArray(t.res)) t.res = [];
    t.bereitstellung = !!t.bereitstellung;
  });
  reflowParents(state);   // Sammelvorgänge gleich auf ihre Hülle setzen

  const undoStack = [];
  const redoStack = [];
  const subs = new Set();
  let dirty = false;

  const notify = () => subs.forEach((fn) => fn(state));

  // Führt cmd auf draft aus. Rückgabe: {ok:true,...} oder {ok:false,error}
  function run(draft, cmd) {
    if (cmd.type === 'batch') {
      for (const c of cmd.cmds || []) {
        const r = run(draft, c);
        if (r.ok === false) return r;
      }
      return ok();
    }
    const h = HANDLERS[cmd.type];
    if (!h) return err('Unbekannter Befehl: ' + cmd.type);
    const r = h(draft, cmd);
    if (typeof r === 'string') return err(r);
    return r || ok();
  }

  function apply(cmd) {
    // Auf einer Kopie arbeiten: scheitert der Befehl (oder ein Teil eines
    // Sammelbefehls), wird die Kopie weggeworfen und nichts ist passiert.
    const draft = clone(state);
    const r = run(draft, cmd);
    if (r.ok === false) return r;
    // Sammelvorgänge auf die Hülle ihrer Untervorgänge nachziehen — zentral nach
    // jedem erfolgreichen Befehl, damit kein Handler es einzeln bedenken muss.
    reflowParents(draft);

    undoStack.push(state);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;   // neuer Zweig — der alte Redo-Ast ist tot
    state = draft;
    dirty = true;
    notify();
    return r;
  }

  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(state);
    state = undoStack.pop();
    dirty = true;
    notify();
    return true;
  }

  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(state);
    state = redoStack.pop();
    dirty = true;
    notify();
    return true;
  }

  return {
    get state() { return state; },
    get dirty() { return dirty; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    apply,
    undo,
    redo,
    markSaved() { dirty = false; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    replace(next) {           // Projektwechsel / Import
      state = clone(next);
      if (!Array.isArray(state.phases)) state.phases = [];
      state.tasks.forEach((t) => {
        if (t.parent === undefined) t.parent = null;
        if (!Array.isArray(t.res)) t.res = [];
        t.bereitstellung = !!t.bereitstellung;
      });
      reflowParents(state);
      undoStack.length = 0;
      redoStack.length = 0;
      dirty = false;
      notify();
    },
  };
}
