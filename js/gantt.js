// ── Gantt-Render-Engine ───────────────────────────────────────────────────────
// Aufbau: ein einziger Scroll-Container mit 2×2-Grid.
//   corner (sticky top+left) │ axis   (sticky top)
//   side   (sticky left)     │ canvas (Balken + Pfeile)
// Das Raster im Canvas ist ein CSS-Gradient (kostenlos, beliebig breit); nur die
// Beschriftungen im Viewport landen im DOM und werden beim Scrollen recycelt.

import { computeSchedule, toMin, toDate } from './schedule.js';
import { findConflicts, local } from './conflicts.js';
import { runningAt, delaysAt } from './live.js';
import { gewerkVar, gewerkTexture } from './palette.js';
import { el, svgEl } from './dom.js';
import {
  ZOOM, clampZoom, zoomAnchored, nearestPreset, fitPx, tickScale, ticksFor,
  weekendBands, fmtTime, fmtDay, fmtDur, fmtFloat,
} from './timeaxis.js';

// T0/T1/NOW/TOTAL_MIN hingen früher als Modul-Konstanten an einem festen
// Projekt — beim Wechsel wäre die Zeitachse auf dem alten stehengeblieben.
// Sie leben jetzt in der Instanz und werden bei jeder Änderung neu bestimmt.

// «Jetzt» in der Projekt-Zeitzone. Ohne die Umrechnung stünde die Linie für
// jemanden außerhalb dieser Zone um den Zonenversatz falsch.
function nowInZone(tz) {
  const d = new Date();
  if (!tz) return d;
  try {
    const p = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);                       // «2026-07-15 11:20»
    return new Date(p.replace(' ', 'T'));
  } catch {
    return d;                           // unbekannte Zone → lokale Zeit
  }
}

// Ab hier ist Puffer keine Disposition mehr, sondern Rauschen (3 Tage).
const SLACK_MAX_MIN = 72 * 60;
// Innenabstand, den die Beschriftung im Balken zusätzlich braucht.
const LABEL_PAD = 23;

export function createGantt(root, opts = {}) {
  const O = {
    rowH: 30, groupH: 36, barH: 16, sideW: 232,
    initialZoom: 'tage', minimap: true, milestoneSize: 9,
    ...opts,
  };

  const store = O.store;
  if (!store) throw new Error('createGantt braucht einen store.');

  // Alles Abgeleitete lebt hier und wird bei jeder Änderung neu bestimmt.
  let S, T0, T1, NOW, TOTAL_MIN, SCHED, byId, gwById, CONFLICTS;
  const collapsed = new Set();

  // «Jetzt» hängt an der Uhr, nicht an den Daten — deshalb eigene Funktion und
  // ein eigener Tick. Vorher wurde NOW nur bei einer Datenänderung neu
  // berechnet: die Linie stand nach dem Laden für immer still.
  function readNow() {
    const S0 = store.state;
    if (S0.project.now) return toMin(S0.project.now);   // Demo-Übersteuerung
    return toMin(local(nowInZone(S0.project.timezone)));
  }

  function syncState() {
    S = store.state;
    T0 = toMin(S.project.start);
    T1 = toMin(S.project.end);
    TOTAL_MIN = Math.max(1, T1 - T0);
    NOW = readNow();
    byId = new Map(S.tasks.map((t) => [t.id, t]));
    gwById = new Map(S.gewerke.map((g) => [g.id, g]));
    let ok = null;
    try {
      ok = computeSchedule(S.tasks, S.deps);
    } catch {
      ok = null;           // Ring (nur aus Import möglich) — Konfliktliste erklärt es
    }
    SCHED = ok || new Map();
    // Die Rechnung weiterreichen, statt sie in findConflicts zu wiederholen.
    CONFLICTS = new Map(findConflicts(S, ok).map((c) => [c.taskId, c]));
  }
  syncState();

  let px = ZOOM[O.initialZoom].px;
  // Welches Preset ist gewählt? «tage» ist dynamisch (füllt eine Tagesbreite),
  // liegt also nicht auf einem festen px-Wert — nearestPreset würde es verfehlen
  // und der Knopf verlöre die Markierung. Freies Zoomen setzt das wieder auf null.
  let zoomMode = O.initialZoom;

  // ── DOM-Gerüst ──────────────────────────────────────────────────────────────
  root.classList.add('bz');
  root.style.setProperty('--side-w', O.sideW + 'px');
  root.style.setProperty('--row-h', O.rowH + 'px');
  root.style.setProperty('--group-h', O.groupH + 'px');
  root.style.setProperty('--bar-h', O.barH + 'px');

  const scroller = el('div', 'bz-scroll');
  const grid = el('div', 'bz-grid');
  const corner = el('div', 'bz-corner');
  const axis = el('div', 'bz-axis');
  const side = el('div', 'bz-side');
  const canvas = el('div', 'bz-canvas');
  grid.append(corner, axis, side, canvas);
  scroller.append(grid);

  // Phasenband gehört in die Achse, nicht auf den Canvas: dort verdeckt es die
  // Zeilenebene, und es beantwortet dieselbe Frage wie die Achse — «wann?».
  const axisPhase = el('div', 'bz-axis-phase');
  const axisMajor = el('div', 'bz-axis-major');
  const axisMinor = el('div', 'bz-axis-minor');
  axis.append(axisPhase, axisMajor, axisMinor);
  const cornerCap = el('div', 'bz-corner-cap', 'Gewerk / Vorgang');
  corner.append(cornerCap);

  const bandLayer = el('div', 'bz-bands');
  const rowLayer = el('div', 'bz-rows');
  const depLayer = svgEl('svg', { class: 'bz-deps' });
  const nowLine = el('div', 'bz-now');
  nowLine.append(el('div', 'bz-now-flag', 'JETZT'));
  canvas.append(bandLayer, rowLayer, depLayer, nowLine);

  const tip = el('div', 'bz-tip');
  root.append(scroller, tip);

  // ── Zeilenmodell ────────────────────────────────────────────────────────────
  // Flache Liste aus Gruppen- und Vorgangszeilen. y wird bei jedem Rebuild neu
  // gerechnet, damit Pfeile und Balken garantiert dieselbe Geometrie sehen.
  let rows = [];
  function buildRows() {
    rows = [];
    let y = 0;
    for (const g of [...S.gewerke].sort((a, b) => a.sort - b.sort)) {
      const tasks = S.tasks.filter((t) => t.gewerk === g.id);
      if (!tasks.length) continue;
      const spans = tasks.filter((t) => !t.milestone);
      const gStart = Math.min(...tasks.map((t) => toMin(t.start)));
      const gEnd = Math.max(...tasks.map((t) => toMin(t.end)));
      const done = tasks.filter((t) => t.status === 'fertig').length;
      rows.push({ kind: 'group', g, y, h: O.groupH, gStart, gEnd, tasks, done, spans });
      y += O.groupH;
      if (!collapsed.has(g.id)) {
        for (const t of tasks) {
          rows.push({ kind: 'task', t, g, y, h: O.rowH });
          y += O.rowH;
        }
      }
    }
    // Projekt-Meilensteine (gewerk 'projekt') als eigene Zeile ganz unten
    const proj = S.tasks.filter((t) => t.gewerk === 'projekt');
    if (proj.length) {
      rows.push({ kind: 'projekt', tasks: proj, y, h: O.groupH });
      y += O.groupH;
    }
    return y;
  }

  const x = (min) => (min - T0) * px;
  const rowById = new Map();
  const labById = new Map();   // id → Zeile in der Seitenspalte
  let selected = null;        // {kind:'task'|'gewerk', id}

  // ── Statisches Gerüst: Seitenspalte + Zeilenspuren ──────────────────────────
  function rebuild() {
    const totalH = buildRows();
    side.replaceChildren();
    rowLayer.replaceChildren();
    rowById.clear();
    labById.clear();
    canvas.style.height = totalH + 'px';
    side.style.height = totalH + 'px';
    depLayer.setAttribute('height', totalH);

    for (const r of rows) {
      // ── Seitenspalte ──────────────────────────────────────────────────────
      const lab = el('div', 'bz-lab bz-lab-' + r.kind);
      lab.style.height = r.h + 'px';

      if (r.kind === 'group') {
        lab.classList.toggle('is-collapsed', collapsed.has(r.g.id));
        lab.style.setProperty('--gw', gewerkVar(r.g.slot));
        const tw = el('button', 'bz-tw');
        tw.setAttribute('aria-expanded', String(!collapsed.has(r.g.id)));
        tw.setAttribute('aria-label', (collapsed.has(r.g.id) ? 'Aufklappen: ' : 'Zuklappen: ') + r.g.name);
        tw.append(el('span', 'bz-tw-i'));
        tw.onclick = () => { collapsed.has(r.g.id) ? collapsed.delete(r.g.id) : collapsed.add(r.g.id); rebuild(); layout(); };
        const dot = el('span', 'bz-dot');
        if (gewerkTexture(r.g.slot)) dot.dataset.tex = '1';
        const nm = el('span', 'bz-lab-name', r.g.name);
        const meta = el('span', 'bz-lab-meta', r.done + '/' + r.tasks.length);
        meta.title = r.done + ' von ' + r.tasks.length + ' Vorgängen fertig';
        lab.append(tw, dot, nm, meta);
        lab.dataset.gewerk = r.g.id;
        bindRow(lab, { kind: 'gewerk', id: r.g.id }, nm);
      } else if (r.kind === 'projekt') {
        lab.append(el('span', 'bz-lab-name', 'Zieltermin'));
      } else {
        lab.style.setProperty('--gw', gewerkVar(r.g.slot));
        const s = SCHED.get(r.t.id) || { critical: false, float: 0 };
        const nm = el('span', 'bz-lab-name', r.t.title);
        nm.title = r.t.title;
        lab.append(nm);
        const conf = CONFLICTS.get(r.t.id);
        if (conf) {
          const c = el('span', 'bz-conf-tag', '!');
          c.title = '«' + r.t.title + '» ' + conf.message;
          lab.append(c);
        } else if (s.critical) {
          const c = el('span', 'bz-crit-tag', 'KRIT');
          c.title = 'Auf dem kritischen Pfad — kein Puffer';
          lab.append(c);
        } else if (r.t.crew) lab.append(el('span', 'bz-lab-meta', r.t.crew + ' P'));
        lab.dataset.task = r.t.id;
        labById.set(r.t.id, lab);
        bindRow(lab, { kind: 'task', id: r.t.id }, nm);
      }
      side.append(lab);

      // ── Spur ──────────────────────────────────────────────────────────────
      const track = el('div', 'bz-track bz-track-' + r.kind);
      track.style.height = r.h + 'px';
      rowLayer.append(track);

      if (r.kind === 'group') {
        const sum = el('div', 'bz-sum');
        sum.style.setProperty('--gw', gewerkVar(r.g.slot));
        if (gewerkTexture(r.g.slot)) sum.dataset.tex = '1';
        sum.dataset.from = r.gStart; sum.dataset.to = r.gEnd;
        sum.append(el('span', 'bz-sum-cap bz-sum-cap-l'), el('span', 'bz-sum-cap bz-sum-cap-r'));
        track.append(sum);
        rowById.set('group:' + r.g.id, sum);
        // Zugeklappt: die Vorgänge als kompakte Marken auf dem Sammelbalken
        if (collapsed.has(r.g.id)) {
          for (const t of r.spans) {
            const m = el('div', 'bz-mini');
            m.dataset.from = toMin(t.start); m.dataset.to = toMin(t.end);
            track.append(m);
            rowById.set('mini:' + t.id, m);
          }
        }
      } else if (r.kind === 'projekt') {
        for (const t of r.tasks) {
          const d = el('div', 'bz-ms bz-ms-projekt');
          d.dataset.at = toMin(t.start);
          d.append(el('span', 'bz-ms-d'), el('span', 'bz-ms-t', t.title));
          bindTip(d, t);
          bindMark(d, { kind: 'task', id: t.id });
          track.append(d);
          rowById.set('task:' + t.id, d);
        }
      } else {
        const t = r.t, s = SCHED.get(t.id) || { critical: false, float: 0 };
        if (t.milestone) {
          const d = el('div', 'bz-ms');
          d.style.setProperty('--gw', gewerkVar(r.g.slot));
          d.classList.toggle('is-crit', s.critical);
          d.dataset.at = toMin(t.start);
          d.append(el('span', 'bz-ms-d'), el('span', 'bz-ms-t', t.title));
          bindTip(d, t);
          bindMark(d, { kind: 'task', id: t.id });
          track.append(d);
          rowById.set('task:' + t.id, d);
        } else {
          const b = el('div', 'bz-bar bz-st-' + t.status);
          b.style.setProperty('--gw', gewerkVar(r.g.slot));
          if (gewerkTexture(r.g.slot)) b.dataset.tex = '1';
          b.classList.toggle('is-crit', s.critical);
          b.classList.toggle('is-conflict', CONFLICTS.has(t.id));
          b.classList.toggle('is-estimated', !!t.estimated);
          b.dataset.from = toMin(t.start); b.dataset.to = toMin(t.end);
          b.tabIndex = 0;
          if (t.progress > 0 && t.progress < 100) {
            const p = el('div', 'bz-prog');
            p.style.width = t.progress + '%';
            b.append(p);
          }
          // Relief-Regel: Balkenfarben unter 3:1 tragen die Identität nicht
          // allein — jeder Balken bekommt sichtbare Direktbeschriftung.
          b.append(el('span', 'bz-bar-t', t.title));
          // Puffer nur zeichnen, solange er disponierbar ist. Ein Planungsvorgang
          // mit 45 Tagen Luft ergäbe ein Schraffurband quer über den ganzen
          // Aufbau — reines Rauschen. Die genaue Zahl steht im Tooltip.
          if (s.float > 0 && s.float <= SLACK_MAX_MIN) {
            const f = el('div', 'bz-slack');
            f.dataset.from = toMin(t.end); f.dataset.to = toMin(t.end) + s.float;
            f.title = fmtFloat(s.float);
            track.append(f);
            rowById.set('slack:' + t.id, f);
          }
          bindTip(b, t);
          bindMark(b, { kind: 'task', id: t.id });
          track.append(b);
          rowById.set('task:' + t.id, b);
        }
      }
    }
    buildDeps();
  }

  // Klick wählt aus (→ Seitenpanel), Rechtsklick öffnet das Menü, Doppelklick
  // benennt an Ort und Stelle um — der häufigste Handgriff soll nicht durchs
  // Panel müssen.
  // Balken/Raute: Klick wählt aus, Rechtsklick öffnet dasselbe Menü wie links.
  function bindMark(node, sel) {
    node.addEventListener('click', () => select(sel));
    node.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      select(sel);
      if (O.onContext) O.onContext(sel, e.clientX, e.clientY);
    });
  }

  function bindRow(lab, sel, nameNode) {
    lab.addEventListener('click', (e) => {
      if (e.target.closest('.bz-tw')) return;   // Aufklappen ist keine Auswahl
      select(sel);
    });
    lab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      select(sel);
      if (O.onContext) O.onContext(sel, e.clientX, e.clientY);
    });
    lab.addEventListener('dblclick', (e) => {
      if (e.target.closest('.bz-tw')) return;
      e.preventDefault();
      editName(sel, nameNode);
    });
  }

  // Umbenennen direkt in der Zeile.
  function editName(sel, nameNode) {
    if (nameNode.querySelector('input')) return;
    const old = nameNode.textContent;
    const inp = el('input', 'bz-lab-edit');
    inp.value = old;
    nameNode.replaceChildren(inp);
    inp.focus();
    inp.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      nameNode.textContent = old;   // erst zurück; der Neuaufbau setzt den Rest
      if (!save || !v || v === old) return;
      const cmd = sel.kind === 'gewerk'
        ? { type: 'setGewerkField', id: sel.id, field: 'name', value: v }
        : { type: 'setTaskField', id: sel.id, field: 'title', value: v };
      const r = store.apply(cmd);
      if (r.ok === false && O.onError) O.onError(r.error);
    };
    inp.addEventListener('blur', () => finish(true));
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();                       // ⌘Z gehört hier dem Feld
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  function select(sel) {
    selected = sel;
    paintSelection();
    if (O.onSelect) O.onSelect(sel);
  }

  function paintSelection() {
    for (const n of root.querySelectorAll('.is-sel')) n.classList.remove('is-sel');
    if (!selected) return;
    const key = selected.kind === 'gewerk' ? 'group:' + selected.id : 'task:' + selected.id;
    const bar = rowById.get(key);
    if (bar) bar.classList.add('is-sel');
    const lab = selected.kind === 'gewerk'
      ? root.querySelector('.bz-lab[data-gewerk="' + selected.id + '"]')
      : labById.get(selected.id);
    if (lab) lab.classList.add('is-sel');
  }

  // ── Abhängigkeitspfeile ─────────────────────────────────────────────────────
  let depPaths = [];
  function buildDeps() {
    depLayer.replaceChildren();
    depPaths = [];
    const defs = svgEl('defs');
    for (const [id, cls] of [['bz-ah', 'bz-ah'], ['bz-ah-c', 'bz-ah-c']]) {
      const mk = svgEl('marker', {
        id, class: cls, markerWidth: 6, markerHeight: 6, refX: 5, refY: 3, orient: 'auto',
      });
      mk.append(svgEl('path', { d: 'M0,0 L6,3 L0,6 z' }));
      defs.append(mk);
    }
    depLayer.append(defs);

    for (const d of S.deps) {
      const a = byId.get(d.from), b = byId.get(d.to);
      if (!a || !b) continue;
      // Bei zugeklappter Gruppe auf den Sammelbalken umlenken
      const ra = visualRow(a), rb = visualRow(b);
      if (!ra || !rb) continue;
      const crit = SCHED.get(d.from).critical && SCHED.get(d.to).critical;
      const p = svgEl('path', {
        class: 'bz-dep' + (crit ? ' is-crit' : ''),
        'marker-end': crit ? 'url(#bz-ah-c)' : 'url(#bz-ah)',
      });
      depLayer.append(p);
      depPaths.push({ p, d, ra, rb });
    }
  }

  function visualRow(task) {
    if (task.gewerk === 'projekt') return rows.find((r) => r.kind === 'projekt');
    if (collapsed.has(task.gewerk)) return rows.find((r) => r.kind === 'group' && r.g.id === task.gewerk);
    return rows.find((r) => r.kind === 'task' && r.t.id === task.id);
  }

  function depAnchors(d, ra, rb) {
    const a = byId.get(d.from), b = byId.get(d.to);
    const aFrom = collapsed.has(a.gewerk) && ra.kind === 'group' ? ra.gStart : toMin(a.start);
    const aTo = collapsed.has(a.gewerk) && ra.kind === 'group' ? ra.gEnd : toMin(a.end);
    const bFrom = collapsed.has(b.gewerk) && rb.kind === 'group' ? rb.gStart : toMin(b.start);
    const bTo = collapsed.has(b.gewerk) && rb.kind === 'group' ? rb.gEnd : toMin(b.end);
    // FS/FF gehen vom Ende des Vorgängers, SS/SF von dessen Start.
    const x1 = x(d.type === 'SS' || d.type === 'SF' ? aFrom : aTo);
    // FS/SS enden am Start des Nachfolgers, FF/SF an dessen Ende.
    const x2 = x(d.type === 'FF' || d.type === 'SF' ? bTo : bFrom);
    return { x1, x2, y1: ra.y + ra.h / 2, y2: rb.y + rb.h / 2 };
  }

  function layoutDeps() {
    for (const { p, d, ra, rb } of depPaths) {
      const { x1, y1, x2, y2 } = depAnchors(d, ra, rb);
      const back = x2 < x1 + 12;
      const r = 4, dir = y2 > y1 ? 1 : -1;
      let path;
      if (!back) {
        const mx = Math.max(x1 + 10, x2 - 14);
        path = `M${x1},${y1} H${mx - r} Q${mx},${y1} ${mx},${y1 + r * dir} V${y2 - r * dir} Q${mx},${y2} ${mx + r},${y2} H${x2 - 2}`;
        if (Math.abs(y2 - y1) < r * 2) path = `M${x1},${y1} H${mx} V${y2} H${x2 - 2}`;
      } else {
        // Rücklauf (negativer Lag / Überlappung): unter der Zeile herumführen
        const out = x1 + 10, back2 = x2 - 10, mid = y1 + (ra.h / 2 - 2) * dir;
        path = `M${x1},${y1} H${out} V${mid} H${back2} V${y2} H${x2 - 2}`;
      }
      p.setAttribute('d', path);
    }
  }

  // ── Positionierung (bei Zoom & Rebuild) ─────────────────────────────────────
  function layout() {
    const w = TOTAL_MIN * px;
    canvas.style.width = w + 'px';
    axis.style.width = w + 'px';
    depLayer.setAttribute('width', w);
    depLayer.setAttribute('viewBox', `0 0 ${w} ${canvas.offsetHeight}`);
    root.style.setProperty('--px', px);
    root.dataset.zoom = nearestPreset(px);

    // Raster als CSS-Gradient — eine Tageslinie kostet nichts, egal wie breit
    const dayPx = 1440 * px;
    const hourPx = 60 * px;
    root.style.setProperty('--grid-day', dayPx + 'px');
    root.style.setProperty('--grid-hour', hourPx + 'px');
    root.classList.toggle('has-hour-grid', hourPx >= 14);

    for (const n of rowLayer.querySelectorAll('[data-from]')) place(n);
    for (const n of rowLayer.querySelectorAll('[data-at]')) {
      n.style.left = x(+n.dataset.at) + 'px';
    }
    nowLine.style.left = x(NOW) + 'px';
    nowLine.style.display = NOW >= T0 && NOW <= T1 ? '' : 'none';

    layoutBands();
    layoutDeps();
    renderAxis();
    updateLabels();
    if (O.minimap) layoutMinimap();
  }

  function place(n) {
    const a = x(+n.dataset.from), b = x(+n.dataset.to);
    n.style.left = a + 'px';
    n.style.width = Math.max(2, b - a) + 'px';
    // Ob die Beschriftung in den Balken passt, kann keine feste Pixelschwelle
    // wissen — «PA fliegen» und «Sicherheitsabstände abstecken» sind verschieden
    // lang, und jedes Theme hat eine andere Schrift. Also einmal messen.
    const lab = n.querySelector('.bz-bar-t');
    if (lab) {
      if (n._textW === undefined) n._textW = lab.scrollWidth + LABEL_PAD;
      n.classList.toggle('is-narrow', b - a < n._textW);
    }
  }

  // Beschriftungen beim Scrollen mitführen. Zwei Fälle:
  //  · Balken ganz links raus  → Beschriftung weg (sonst Text ohne Balken, der
  //    unter der eingefrorenen Gewerk-Spalte hervorlugt).
  //  · Balken nur angeschnitten → Beschriftung wandert bis an die Sichtkante
  //    mit, bleibt aber im Balken. Ein tagelanger Balken ist sonst überall
  //    dort unbeschriftet, wo man gerade hinschaut.
  function updateLabels() {
    const s = scroller.scrollLeft;
    for (const n of rowLayer.querySelectorAll('.bz-bar')) {
      const lab = n._lab || (n._lab = n.querySelector('.bz-bar-t'));
      if (!lab || n._textW === undefined) continue;
      const a = x(+n.dataset.from), b = x(+n.dataset.to);
      if (n.classList.contains('is-narrow')) {
        // Beschriftung liegt rechts neben dem Balken → nur weg, wenn der
        // Balken selbst komplett aus dem Bild ist.
        n.classList.toggle('lab-hide', b <= s);
        lab.style.transform = '';
        continue;
      }
      // Reicht der noch sichtbare Teil des Balkens für den Text? Wenn nicht,
      // hilft auch Mitwandern nichts — dann bliebe er halb unter der Spalte.
      const visible = b - Math.max(a, s);
      n.classList.toggle('lab-hide', visible < n._textW);
      const maxShift = Math.max(0, (b - a) - n._textW);
      const shift = Math.min(Math.max(0, s - a), maxShift);
      lab.style.transform = shift ? 'translateX(' + shift + 'px)' : '';
    }
  }

  // ── Hintergrundbänder: Phasen + Wochenenden ─────────────────────────────────
  function layoutBands() {
    bandLayer.replaceChildren();
    axisPhase.replaceChildren();
    for (const ph of (S.phases || [])) {
      const a = x(toMin(ph.start)), b = x(toMin(ph.end));
      // Tönung auf dem Canvas …
      const n = el('div', 'bz-phase bz-phase-' + ph.name.toLowerCase());
      n.style.left = a + 'px'; n.style.width = (b - a) + 'px';
      bandLayer.append(n);
      // … Beschriftung im Band der Achse. Der Name bleibt beim Scrollen im
      // Blick, solange noch ein Teil der Phase sichtbar ist.
      const p = el('div', 'bz-ph bz-ph-' + ph.name.toLowerCase());
      p.style.left = a + 'px'; p.style.width = (b - a) + 'px';
      p.append(el('span', 'bz-ph-t', ph.name));
      axisPhase.append(p);
    }
    // Wochenenden nur zeigen, wenn ein Tag überhaupt breit genug ist
    if (1440 * px >= 26) {
      for (const w of weekendBands(new Date(S.project.start), new Date(S.project.end))) {
        const a = x(Math.round(w.from.getTime() / 60000));
        const b = x(Math.round(w.to.getTime() / 60000));
        const n = el('div', 'bz-we');
        n.style.left = a + 'px'; n.style.width = (b - a) + 'px';
        bandLayer.append(n);
      }
    }
  }

  // ── Achse: nur der sichtbare Ausschnitt landet im DOM ────────────────────────
  let lastKey = '';
  function renderAxis(force) {
    const pad = 400;
    const vFrom = T0 + Math.max(0, scroller.scrollLeft - pad) / px;
    const vTo = T0 + (scroller.scrollLeft + scroller.clientWidth + pad) / px;
    const sc = tickScale(px);
    const key = sc.major + '|' + sc.minor + '|' + Math.round(vFrom / 60) + '|' + Math.round(vTo / 60) + '|' + px;
    if (key === lastKey && !force) return;
    lastKey = key;

    const from = new Date(Math.max(T0, vFrom) * 60000);
    const to = new Date(Math.min(T1, vTo) * 60000);

    // Die grobe Zeile (Tag/Woche/Monat) spannt ihr Intervall und trägt das Label
    // MITTIG — im Tagesmodus das volle Datum genau über den Stunden.
    const majSpan = (u, d) => u === 'day' ? 1440 : u === 'week' ? 10080
      : Math.round((new Date(d.getFullYear(), d.getMonth() + 1, 1) - new Date(d.getFullYear(), d.getMonth(), 1)) / 60000);
    axisMajor.replaceChildren();
    for (const t of ticksFor(sc.major, from, to)) {
      const startMin = Math.round(t.t.getTime() / 60000);
      const n = el('div', 'bz-t bz-t-major');
      n.style.left = x(startMin) + 'px';
      n.style.width = (majSpan(sc.major, t.t) * px) + 'px';
      n.append(el('span', null, sc.major === 'day' ? t.full : t.label));
      axisMajor.append(n);
    }
    axisMinor.replaceChildren();
    for (const t of ticksFor(sc.minor, from, to)) {
      const n = el('div', 'bz-t bz-t-minor');
      if (t.weekend) n.classList.add('is-we');
      n.style.left = x(Math.round(t.t.getTime() / 60000)) + 'px';
      n.append(el('span', 'bz-t-n', t.label));
      if (t.sub && 1440 * px > 40) n.append(el('span', 'bz-t-s', t.sub));
      axisMinor.append(n);
    }
  }

  // ── Tooltip ─────────────────────────────────────────────────────────────────
  function bindTip(node, t) {
    const s = SCHED.get(t.id) || { critical: false, float: 0 };
    const g = gwById.get(t.gewerk);
    const show = () => {
      tip.replaceChildren();
      const h = el('div', 'bz-tip-h');
      if (g) { const d = el('span', 'bz-dot'); d.style.setProperty('--gw', g.light); h.append(d); }
      h.append(el('span', 'bz-tip-g', g ? g.name : 'Projekt'));
      tip.append(h, el('div', 'bz-tip-t', t.title));
      const dl = el('dl', 'bz-tip-dl');
      const add = (k, v) => { dl.append(el('dt', null, k), el('dd', null, v)); };
      const sd = new Date(t.start), ed = new Date(t.end);
      if (t.milestone) add('Termin', fmtDay(sd) + ', ' + fmtTime(sd));
      else {
        add('Start', fmtDay(sd) + ', ' + fmtTime(sd));
        add('Ende', fmtDay(ed) + ', ' + fmtTime(ed));
        add('Dauer', fmtDur(toMin(t.end) - toMin(t.start)));
      }
      if (t.crew) add('Crew', t.crew + ' Personen');
      const conf = CONFLICTS.get(t.id);
      if (conf) add('Konflikt', conf.message);
      add('Puffer', s.critical ? 'kritischer Pfad' : fmtFloat(s.float));
      if (!t.milestone && t.progress > 0) add('Fortschritt', t.progress + ' %');
      tip.append(dl);
      tip.classList.add('is-on');
    };
    const move = (e) => {
      const rr = root.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let lx = e.clientX - rr.left + 14, ly = e.clientY - rr.top + 14;
      if (lx + tw > rr.width - 8) lx = e.clientX - rr.left - tw - 14;
      if (ly + th > rr.height - 8) ly = e.clientY - rr.top - th - 14;
      tip.style.transform = `translate(${Math.max(8, lx)}px,${Math.max(8, ly)}px)`;
    };
    node.addEventListener('pointerenter', show);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', () => tip.classList.remove('is-on'));
    node.addEventListener('focus', () => { show(); const r = node.getBoundingClientRect(), rr = root.getBoundingClientRect();
      tip.style.transform = `translate(${r.left - rr.left}px,${r.bottom - rr.top + 8}px)`; });
    node.addEventListener('blur', () => tip.classList.remove('is-on'));
  }

  // ── Minimap ─────────────────────────────────────────────────────────────────
  let mini, miniWin, miniNow;
  function buildMinimap() {
    mini = el('div', 'bz-mini-map');
    const strip = el('div', 'bz-mini-strip');
    for (const g of [...S.gewerke].sort((a, b) => a.sort - b.sort)) {
      const lane = el('div', 'bz-mini-lane');
      lane.style.setProperty('--gw', gewerkVar(g.slot));
      for (const t of S.tasks.filter((x) => x.gewerk === g.id && !x.milestone)) {
        const m = el('div', 'bz-mini-b');
        const a = (toMin(t.start) - T0) / TOTAL_MIN * 100;
        const b = (toMin(t.end) - T0) / TOTAL_MIN * 100;
        m.style.left = a + '%'; m.style.width = Math.max(0.3, b - a) + '%';
        lane.append(m);
      }
      strip.append(lane);
    }
    miniNow = el('div', 'bz-mini-now');
    miniNow.style.left = (NOW - T0) / TOTAL_MIN * 100 + '%';
    strip.append(miniNow);
    miniWin = el('div', 'bz-mini-win');
    strip.append(miniWin);
    mini.append(strip);

    let drag = false;
    const jump = (clientX) => {
      const r = strip.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const target = frac * TOTAL_MIN * px - scroller.clientWidth / 2;
      scroller.scrollLeft = target;
    };
    strip.addEventListener('pointerdown', (e) => { drag = true; strip.setPointerCapture(e.pointerId); jump(e.clientX); });
    strip.addEventListener('pointermove', (e) => { if (drag) jump(e.clientX); });
    strip.addEventListener('pointerup', () => { drag = false; });
    return mini;
  }
  function layoutMinimap() {
    if (!miniWin) return;
    const total = TOTAL_MIN * px;
    miniWin.style.left = (scroller.scrollLeft / total * 100) + '%';
    miniWin.style.width = Math.min(100, scroller.clientWidth / total * 100) + '%';
  }

  // ── Jetzt-Linie & Live ──────────────────────────────────────────────────────
  // Bewusst KEIN layout(): das baute jede Minute den DOM neu und risse dir die
  // Auswahl unter den Fingern weg. Hier wird nur bewegt, was sich bewegt.
  let live = false;
  let tickTimer = null;

  function paintNow() {
    nowLine.style.left = x(NOW) + 'px';
    nowLine.style.display = NOW >= T0 && NOW <= T1 ? '' : 'none';
    if (miniNow) miniNow.style.left = ((NOW - T0) / TOTAL_MIN * 100) + '%';
  }

  function paintLive() {
    const on = live;
    root.classList.toggle('is-live', on);
    const running = on ? runningAt(S.tasks, NOW) : new Set();
    const late = new Map(on ? delaysAt(S.tasks, NOW).map((d) => [d.taskId, d]) : []);
    for (const [key, node] of rowById) {
      if (!key.startsWith('task:')) continue;
      const id = key.slice(5);
      node.classList.toggle('is-running', running.has(id));
      const d = late.get(id);
      node.classList.toggle('is-late', !!d);
      if (d) node.dataset.late = d.message; else delete node.dataset.late;
    }
    for (const [id, node] of labById) {
      const d = late.get(id);
      node.classList.toggle('is-late', !!d);
      node.classList.toggle('is-running', running.has(id));
      if (d) node.title = '«' + d.title + '» ' + d.message;
    }
  }

  function tickNow() {
    const before = NOW;
    NOW = readNow();
    if (NOW === before && !live) return;
    paintNow();
    paintLive();
    // «Immer folgen»: die Ansicht klebt an der Linie.
    if (live && NOW >= T0 && NOW <= T1) centerOn(NOW, 0.4);
    if (O.onTick) O.onTick(NOW);
  }

  function startTicking() {
    stopTicking();
    // 15 s statt 60: bei Stundenzoom wandert die Linie sichtbar, statt jede
    // Minute zu springen. Kostet nichts — es wird eine Position gesetzt.
    tickTimer = setInterval(tickNow, 15000);
  }
  function stopTicking() { clearInterval(tickTimer); tickTimer = null; }

  // Ein vergessener Tab soll nicht tagelang rechnen. Beim Zurückkommen aufholen.
  const onVis = () => {
    if (document.hidden) stopTicking();
    else { tickNow(); startTicking(); }
  };
  document.addEventListener('visibilitychange', onVis);

  // ── Navigation ──────────────────────────────────────────────────────────────
  function setZoom(next, anchorX) {
    const oldPx = px;
    px = clampZoom(next);
    if (px === oldPx) return;
    zoomMode = null;   // freies Zoomen verlässt jedes Preset
    const ax = anchorX ?? scroller.clientWidth / 2;
    scroller.scrollLeft = zoomAnchored({ scrollLeft: scroller.scrollLeft, anchorX: ax, oldPx, newPx: px });
    layout();
  }
  function centerOn(min, ratio = 0.35) {
    scroller.scrollLeft = x(min) - scroller.clientWidth * ratio;
  }

  // Sichtbare Timeline-Breite = Viewport minus die feste Seitenspalte.
  const timelineW = () => scroller.clientWidth - O.sideW;

  // Ein Kalendertag füllt die Breite: px so wählen, dass 1440 min == Timeline,
  // und den Tag linksbündig auf 00:00 stellen. Der Canvas beginnt bei sideW,
  // deshalb genügt scrollLeft = x(Tagesbeginn) — dann sitzt 00:00 an der
  // Seitenspalte und 24:00 genau am rechten Rand.
  function fitDay(iso) {
    const day = String(iso).slice(0, 10);
    px = fitPx(timelineW(), 1440);
    zoomMode = 'tage';
    layout();
    scroller.scrollLeft = x(toMin(day + 'T00:00'));
  }

  // Datum in der Mitte der sichtbaren Timeline, als YYYY-MM-DD (lokal).
  function centerDayIso() {
    const mid = T0 + (scroller.scrollLeft + timelineW() / 2) / px;
    return local(toDate(mid)).slice(0, 10);
  }

  // Zu einem Tag springen: in der Tagesansicht neu einpassen, sonst hinscrollen.
  function goToDay(iso) {
    const day = String(iso).slice(0, 10);
    if (zoomMode === 'tage') fitDay(day);
    else centerOn(toMin(day + 'T12:00'));
  }

  // Wohin beim Öffnen? «Jetzt» ist die naheliegende Antwort, aber die falsche,
  // wenn der Aufbau erst in zwei Wochen beginnt: dann liegt die Jetzt-Linie
  // mitten in der Planungsphase und der Plan öffnet auf einem leeren Bild.
  // Also: Jetzt nur, wenn dort auch etwas los ist — sonst der Aufbaubeginn.
  function initialFocus() {
    const aufbau = (S.phases || []).find((p) => /aufbau|load.?in/i.test(p.name));
    const spans = S.tasks.filter((t) => !t.milestone).map((t) => toMin(t.start));
    const anchor = aufbau ? toMin(aufbau.start) : (spans.length ? Math.min(...spans) : NOW);
    // KEINE «läuft gerade etwas?»-Prüfung: ein 29-tägiger Planungsbalken läuft
    // zwar, ist aber kein Geschehen — die Ansicht öffnete dann mit einem
    // einzigen Balken im Bild. Es zählt allein, ob der Aufbau noch bevorsteht.
    if (NOW < anchor) return anchor;
    if (NOW > T1) return anchor;          // Projekt liegt ganz in der Vergangenheit
    return NOW;
  }

  // Erstansicht / nach Projektwechsel: in der Tagesansicht den Fokustag voll
  // aufziehen, sonst nur hinscrollen.
  function goToInitial() {
    if (zoomMode === 'tage') fitDay(local(toDate(initialFocus())).slice(0, 10));
    else centerOn(initialFocus());
  }

  scroller.addEventListener('scroll', () => {
    requestAnimationFrame(() => { renderAxis(); layoutMinimap(); updateLabels(); });
  }, { passive: true });

  // Ctrl/⌘ + Rad zoomt am Cursor — wie in Kartenanwendungen
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    setZoom(px * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left - O.sideW);
  }, { passive: false });

  // Shift+Rad scrollt horizontal (Trackpad-freie Mäuse)
  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || !e.shiftKey) return;
    scroller.scrollLeft += e.deltaY;
  }, { passive: true });

  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea')) return;
    const step = scroller.clientWidth * 0.8;
    if (e.key === 'ArrowRight') { scroller.scrollLeft += step; e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { scroller.scrollLeft -= step; e.preventDefault(); }
    else if (e.key === '+' || e.key === '=') { setZoom(px * 1.6); e.preventDefault(); }
    else if (e.key === '-') { setZoom(px / 1.6); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'h') { centerOn(NOW); }
  });

  // ── API ─────────────────────────────────────────────────────────────────────
  const api = {
    setZoomPreset(name) {
      if (name === 'tage') fitDay(centerDayIso());   // den Tag im Blick voll aufziehen
      else setZoom(ZOOM[name].px);
      zoomMode = name;
    },
    zoomIn() { setZoom(px * 1.6); },
    zoomOut() { setZoom(px / 1.6); },
    goToNow() { zoomMode === 'tage' ? fitDay(local(toDate(NOW)).slice(0, 10)) : centerOn(NOW); },
    goTo(iso) { centerOn(toMin(iso)); },
    goToDay(iso) { goToDay(iso); },
    centerDayIso() { return centerDayIso(); },
    collapseAll() { for (const g of S.gewerke) collapsed.add(g.id); rebuild(); layout(); },
    expandAll() { collapsed.clear(); rebuild(); layout(); },
    minimapNode: O.minimap ? buildMinimap() : null,
    get zoomName() { return zoomMode ?? nearestPreset(px); },
    stats() {
      const crit = S.tasks.filter((t) => (SCHED.get(t.id) || {}).critical).length;
      const done = S.tasks.filter((t) => t.status === 'fertig').length;
      const run = S.tasks.filter((t) => t.status === 'laeuft').length;
      const crew = S.tasks.filter((t) => t.status === 'laeuft').reduce((a, t) => a + (t.crew || 0), 0);
      return { total: S.tasks.length, crit, done, run, crew, gewerke: S.gewerke.length, conflicts: CONFLICTS.size };
    },
    relayout: layout,
    refresh,
    select,
    get selected() { return selected; },
    setLive(on) {
      live = !!on;
      tickNow();
      paintLive();
      if (live) centerOn(NOW, 0.4);
    },
    get isLive() { return live; },
    tickNow,
    liveInfo: () => ({ now: NOW, running: runningAt(S.tasks, NOW), late: delaysAt(S.tasks, NOW) }),
    conflicts: () => [...CONFLICTS.values()],
    destroy() { unsubscribe(); stopTicking(); document.removeEventListener('visibilitychange', onVis); root.replaceChildren(); },
  };

  // Auf Änderungen reagieren. Scrollstand halten — sonst spränge der Plan bei
  // jedem Tastendruck an den Anfang zurück.
  function refresh() {
    const keepLeft = scroller.scrollLeft, keepTop = scroller.scrollTop;
    const vorher = S && S.project.id;
    syncState();
    rebuild();
    layout();
    if (S.project.id !== vorher) {
      // PROJEKTWECHSEL. Der Scrollstand darf NICHT erhalten bleiben: T0 ist ein
      // anderes Datum, dieselbe Pixelzahl bedeutet also einen ganz anderen
      // Zeitpunkt. Vorher landete man Wochen daneben — nur 6 von 35 Balken im
      // Bild, mitten in der Planungsphase.
      collapsed.clear();
      selected = null;
      if (O.onSelect) O.onSelect(null);
      goToInitial();
    } else {
      scroller.scrollLeft = keepLeft;
      scroller.scrollTop = keepTop;
    }
    renderAxis(true);
    updateLabels();
    // Der Neuaufbau wirft das DOM weg — Auswahl und Live-Marken müssen zurück,
    // sonst verliert man bei jeder Änderung die markierte Zeile.
    if (selected && !store.state.tasks.some((t) => t.id === selected.id)
        && !store.state.gewerke.some((g) => g.id === selected.id)) {
      selected = null;
      if (O.onSelect) O.onSelect(null);
    }
    paintSelection();
    paintLive();
  }
  const unsubscribe = store.subscribe(refresh);

  rebuild();
  requestAnimationFrame(() => { layout(); goToInitial(); renderAxis(true); updateLabels(); });
  // Ticken läuft IMMER, nicht nur im Live-Modus: eine Linie, die falsch steht,
  // ist schlimmer als keine.
  startTicking();
  new ResizeObserver(() => { renderAxis(true); layoutMinimap(); }).observe(scroller);

  return api;
}

