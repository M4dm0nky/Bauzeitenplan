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

import { topoSort } from './schedule.js';

// Bewusst NICHT aus persistence.js importiert: der Store ist der Kern, die
// Ablage die äußere Schicht — diese Abhängigkeit liefe verkehrt herum. Für eine
// Zeile ist die Wiederholung billiger als ein falscher Pfeil.
const clone = (o) => JSON.parse(JSON.stringify(o));

const UNDO_MAX = 100;

const ok = (extra = {}) => ({ ok: true, ...extra });
const err = (msg) => ({ ok: false, error: msg });

let idSeq = 0;
const newId = (prefix) => prefix + Date.now().toString(36) + (idSeq++).toString(36);

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
    if (!state.gewerke.some((g) => g.id === t.gewerk) && t.gewerk !== 'projekt') return 'Unbekanntes Gewerk: ' + t.gewerk;
    if (!String(t.title || '').trim()) return 'Der Vorgang braucht einen Namen.';
    const milestone = !!t.milestone;
    const bad = checkSpan(t.start, t.end, milestone);
    if (bad) return bad;
    const id = t.id || newId('t');
    if (state.tasks.some((x) => x.id === id)) return 'Diese id gibt es schon: ' + id;
    state.tasks.push({
      id, gewerk: t.gewerk, title: String(t.title).trim(),
      start: t.start, end: t.end, milestone,
      progress: t.progress ?? 0, status: t.status || 'geplant',
      crew: t.crew ?? null, notes: t.notes || '',
    });
    return ok({ id });
  },

  removeTask(state, cmd) {
    const i = state.tasks.findIndex((t) => t.id === cmd.id);
    if (i < 0) return 'Vorgang nicht gefunden.';
    state.tasks.splice(i, 1);
    // Verwaiste Abhängigkeiten mitnehmen: sonst zeigen Pfeile ins Leere und
    // die Terminrechnung stolpert über undefined.
    state.deps = state.deps.filter((d) => d.from !== cmd.id && d.to !== cmd.id);
    return ok();
  },

  setTaskField(state, cmd) {
    const t = state.tasks.find((x) => x.id === cmd.id);
    if (!t) return 'Vorgang nicht gefunden.';
    const next = { ...t, [cmd.field]: cmd.value };
    if (['start', 'end', 'milestone'].includes(cmd.field)) {
      const bad = checkSpan(next.start, next.end, next.milestone);
      if (bad) return bad;
    }
    if (cmd.field === 'title' && !String(cmd.value || '').trim()) return 'Der Vorgang braucht einen Namen.';
    if (cmd.field === 'gewerk' && !state.gewerke.some((g) => g.id === cmd.value)) return 'Unbekanntes Gewerk.';
    t[cmd.field] = cmd.value;
    return ok();
  },

  moveTask(state, cmd) {
    const t = state.tasks.find((x) => x.id === cmd.id);
    if (!t) return 'Vorgang nicht gefunden.';
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
    if (state.gewerke.some((x) => x.name.toLowerCase() === name.toLowerCase())) return 'Dieses Gewerk gibt es schon: ' + name;
    const id = g.id || newId('g');
    state.gewerke.push({
      id, name,
      sort: g.sort ?? state.gewerke.length,
      // Farbe folgt dem Gewerk, nicht seiner Position: der Platz wird einmal
      // vergeben und bleibt. Sonst färbte sich beim Umsortieren alles um.
      slot: g.slot ?? freeSlot(state),
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

  duplicateTask(state, cmd) {
    const t = state.tasks.find((x) => x.id === cmd.id);
    if (!t) return 'Vorgang nicht gefunden.';
    const id = newId('t');
    // Bewusst OHNE Verknüpfungen: mit denselben Vorgängern stünde das Duplikat
    // sofort im Konflikt — niemand will beim Duplizieren einen roten Plan.
    state.tasks.push({ ...t, id, title: t.title + ' (Kopie)' });
    return ok({ id });
  },

  setGewerkField(state, cmd) {
    const g = state.gewerke.find((x) => x.id === cmd.id);
    if (!g) return 'Gewerk nicht gefunden.';
    if (cmd.field === 'name') {
      const name = String(cmd.value || '').trim();
      if (!name) return 'Das Gewerk braucht einen Namen.';
      if (state.gewerke.some((x) => x.id !== cmd.id && x.name.toLowerCase() === name.toLowerCase())) return 'Dieses Gewerk gibt es schon: ' + name;
      g.name = name;
      return ok();
    }
    g[cmd.field] = cmd.value;
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
function freeSlot(state) {
  const used = new Set(state.gewerke.map((g) => g.slot));
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
      undoStack.length = 0;
      redoStack.length = 0;
      dirty = false;
      notify();
    },
  };
}
