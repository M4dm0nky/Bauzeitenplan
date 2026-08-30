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

import { topoSort, toMin } from './schedule.js';
import { MAX_SLOTS } from './palette.js';

// Bewusst NICHT aus persistence.js importiert: der Store ist der Kern, die
// Ablage die äußere Schicht — diese Abhängigkeit liefe verkehrt herum. Für eine
// Zeile ist die Wiederholung billiger als ein falscher Pfeil.
const clone = (o) => JSON.parse(JSON.stringify(o));

// Ebenso bewusst nicht aus ebene.js importiert — dieselbe Richtung, dasselbe
// Argument: der Kern zeigt nicht auf die Ansichtsschicht (ebene.js hängt an
// conflicts.js, und dorthin liefe der Pfeil verkehrt herum). Altdaten ohne
// `art` sind Gewerke. Eigener Name, weil der Prototypen-Build alle Module in
// EINE Datei zieht und zwei gleichnamige Deklarationen dort ein SyntaxError
// wären — dieselbe Prüfung, die schon den `el`-Vorfall gefangen hat.
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

// Die beiden selbst befüllbaren Auswahllisten. `taskFeld` sagt, welches Feld am
// Vorgang darauf zeigt — daran hängt, ob ein Wert noch benutzt wird und sich
// deshalb nicht löschen lässt.
const LISTEN = {
  punktTypen: { eingebaut: TYPEN_EINGEBAUT, taskFeld: 'punktTyp' },
  abschnitte: { eingebaut: ABSCHNITTE_EINGEBAUT, taskFeld: 'abschnitt' },
};
const abschnittOderArt = (L, id) => (L.eingebaut.find(([k]) => k === id) || [id, id])[1];

/** Kennt der Plan diesen Abschnitt — eingebaut oder selbst angelegt? */
const abschnittBekannt = (state, v) =>
  ABSCHNITTE_EINGEBAUT.some(([k]) => k === v)
  || ((state.project && state.project.abschnitte) || []).some((a) => a.id === v);

const UNDO_MAX = 100;

const ok = (extra = {}) => ({ ok: true, ...extra });
const err = (msg) => ({ ok: false, error: msg });

let idSeq = 0;
const newId = (prefix) => prefix + Date.now().toString(36) + (idSeq++).toString(36);

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
function neuerEintrag(state, { feld, eingebaut, praefix, wort, label: roh, extra = {} }) {
  const label = String(roh || '').trim();
  if (!label) return `${wort === 'Art' ? 'Die Art' : 'Der Abschnitt'} braucht einen Namen.`;
  if (label.length > 40) return 'Der Name ist zu lang (höchstens 40 Zeichen).';
  const alle = [...eingebaut, ...((state.project[feld] || []).map((x) => [x.id, x.label]))];
  if (alle.some(([, l]) => String(l).toLowerCase() === label.toLowerCase()))
    return `${wort === 'Art' ? 'Diese Art' : 'Diesen Abschnitt'} gibt es schon: ${label}`;
  // Lesbare id aus dem Namen; bei Kollision oder leerem Rest eine erzeugte.
  let id = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!id || alle.some(([k]) => k === id)) id = newId(praefix);
  if (!Array.isArray(state.project[feld])) state.project[feld] = [];
  state.project[feld].push({ id, label, ...extra });
  return ok({ id });
}

// ── Validierung ─────────────────────────────────────────────────────────────
// Läuft IMMER vor der Änderung. Ein abgelehnter Befehl darf keinen halben
// Zustand hinterlassen, nicht auf den Undo-Stapel und nichts als ungesichert
// markieren.

function checkSpan(start, end, milestone) {
  if (!start || !end) return 'Start und Ende müssen gesetzt sein.';
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 'Ungültiges Datum.';
  if (milestone) return b === a ? null : 'Ein Meilenstein hat keine Dauer — Start und Ende müssen gleich sein.';
  if (b <= a) return 'Das Ende muss nach dem Start liegen.';
  return null;
}

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
    for (const k of state.tasks) {
      if (k.parent !== p.id) continue;
      if (s == null || toMin(k.start) < toMin(s)) s = k.start;
      if (e == null || toMin(k.end) > toMin(e)) e = k.end;
    }
    if (s == null) continue;          // keine Kinder → kein Sammelvorgang
    p.start = s;
    p.end = e;
    p.milestone = false;              // ein Sammelvorgang hat Dauer, ist keine Raute
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
    state.tasks.push({
      id, gewerk, title: String(t.title).trim(),
      start: t.start, end: t.end, milestone,
      progress: t.progress ?? 0, status: t.status || 'geplant',
      crew: t.crew ?? null, notes: t.notes || '', parent,
      // Setup oder Show. MUSS hier durch: wer im Setup-Abschnitt anlegt, will
      // dort einen Eintrag — fiel das Feld weg, landete er in der Show und war
      // im gerade gezeigten Abschnitt sofort unsichtbar.
      abschnitt: abschnittBekannt(state, t.abschnitt) ? t.abschnitt : 'show',
      // Wem gehört der Eintrag? Ein Soundcheck zeigt auf seinen Act. MUSS hier
      // durch — was der Handler nicht aufzählt, fällt beim Anlegen still weg.
      fuer: t.fuer ?? null,
    });
    return ok({ id });
  },

  removeTask(state, cmd) {
    const i = state.tasks.findIndex((t) => t.id === cmd.id);
    if (i < 0) return 'Vorgang nicht gefunden.';
    // Ein Sammelvorgang nimmt seine Untervorgänge mit (Kaskade) — wie beim
    // Löschen eines Gewerks. Rückgängig über den Schnappschuss, nicht Stück für
    // Stück. Ohne die Kaskade blieben verwaiste Kinder mit totem parent zurück.
    // Kaskade: Untervorgänge UND zugeordnete Einträge (der Soundcheck eines Acts)
    // gehen mit. Sonst bliebe eine Waise mit totem `fuer` zurück, die niemand
    // mehr findet — dieselbe Begründung wie bei den Untervorgängen.
    const gone = new Set([cmd.id,
      ...state.tasks.filter((t) => t.parent === cmd.id || t.fuer === cmd.id).map((t) => t.id)]);
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
    if (cmd.field === 'title' && !String(cmd.value || '').trim()) return 'Der Vorgang braucht einen Namen.';
    if (cmd.field === 'gewerk' && !state.gewerke.some((g) => g.id === cmd.value)) return 'Unbekanntes Gewerk.';
    // Farbplatz: null (erbt von der Bühne) oder ein Platz AUS der Palette.
    // Ohne die Prüfung landete ein Vertipper still im Export und der Balken
    // zeigte auf `var(--gw-NaN)` — also auf gar keine Farbe.
    // Der Abschnitt muss BEKANNT sein: eingebaut oder im Plan angelegt. Ein
    // freier Text wäre eine Waise — er zählte zur Show, hätte aber keinen Namen
    // im Auswahlfeld und niemand fände ihn wieder.
    if (cmd.field === 'abschnitt' && !abschnittBekannt(state, cmd.value))
      return 'Diesen Abschnitt gibt es nicht: ' + cmd.value;
    if (cmd.field === 'fuer' && cmd.value !== null) {
      if (cmd.value === cmd.id) return 'Ein Eintrag gehört nicht zu sich selbst.';
      if (!state.tasks.some((x) => x.id === cmd.value)) return 'Zugeordneter Eintrag nicht gefunden.';
    }
    // Der Farbplatz ist intern 0-basiert (0…MAX_SLOTS-1), in der Oberfläche
    // 1-basiert («Platz 3 von 20», inspector.js). Die Meldung nennt deshalb
    // keinen Zahlenbereich: gewählt wird über Knöpfe, hier tippt niemand einen
    // Wert ein, und «zwischen 1 und 20» widerspräche dem, was gültig ist.
    if (cmd.field === 'slot' && cmd.value !== null) {
      const n = cmd.value;
      if (!Number.isInteger(n) || n < 0 || n >= MAX_SLOTS)
        return 'Diesen Farbplatz gibt es nicht — die Palette hat ' + MAX_SLOTS + ' Plätze (oder leer für «wie Bühne»).';
    }
    t[cmd.field] = cmd.value;
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
    const bad = checkSpan(cmd.start, cmd.end, t.milestone);
    if (bad) return bad;
    t.start = cmd.start;
    t.end = cmd.end;
    return ok();
  },

  addDep(state, cmd) {
    const d = cmd.dep || {};
    if (d.from === d.to) return 'Ein Vorgang kann nicht von sich selbst abhängen.';
    if (!state.tasks.some((t) => t.id === d.from)) return 'Vorgänger nicht gefunden.';
    if (!state.tasks.some((t) => t.id === d.to)) return 'Nachfolger nicht gefunden.';
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
    const gone = state.tasks.filter((t) => t.gewerk === cmd.id).map((t) => t.id);
    state.tasks = state.tasks.filter((t) => t.gewerk !== cmd.id);
    state.deps = state.deps.filter((d) => !gone.includes(d.from) && !gone.includes(d.to));
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
    g[cmd.field] = cmd.value;
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
      wort: 'Art', label: cmd.label, extra: { kompakt: !!cmd.kompakt },
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
      wort: 'Abschnitt', label: cmd.label,
    });
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
    const benutzt = state.tasks.filter((t) => t[L.taskFeld] === cmd.id).length;
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

  setProjectField(state, cmd) {
    if (cmd.field === 'name' && !String(cmd.value || '').trim()) return 'Das Projekt braucht einen Namen.';
    if (['start', 'end'].includes(cmd.field)) {
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
  // Bestandsdaten ohne Farbplatz nachrüsten
  state.gewerke.forEach((g, i) => { if (g.slot == null) g.slot = i; });
  state.tasks.forEach((t) => { if (t.parent === undefined) t.parent = null; });
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
      state.tasks.forEach((t) => { if (t.parent === undefined) t.parent = null; });
      reflowParents(state);
      undoStack.length = 0;
      redoStack.length = 0;
      dirty = false;
      notify();
    },
  };
}
