// ── Gantt-Render-Engine ───────────────────────────────────────────────────────
// Aufbau: ein einziger Scroll-Container mit 2×2-Grid.
//   corner (sticky top+left) │ axis   (sticky top)
//   side   (sticky left)     │ canvas (Balken + Pfeile)
// Das Raster im Canvas ist ein CSS-Gradient (kostenlos, beliebig breit); nur die
// Beschriftungen im Viewport landen im DOM und werden beim Scrollen recycelt.

import { computeSchedule, toMin, toDate, byStart, seriesRows, reachable } from './schedule.js';
import { findConflicts, local } from './conflicts.js';
import { runningAt, delaysAt, verschoben } from './live.js';
import { sichtGewerke, programmFenster, amTag, imAbschnitt } from './ebene.js';
import { gewerkVar, gewerkTexture, gewerkInkVar } from './palette.js';
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
let zoneWarned = false;
function nowInZone(tz) {
  const d = new Date();
  if (!tz) return d;
  try {
    // hourCycle 'h23' statt hour12:false: letzteres wählt in manchen Engines
    // den Zyklus h24 und schreibt Mitternacht als «24:00» — daraus macht
    // new Date() ein Invalid Date, und die Jetzt-Linie fiele jede Nacht
    // stumm auf die lokale Zeit zurück.
    const p = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(d);                       // «2026-07-15 11:20»
    // \s+ statt ' ': Intl liefert je nach Engine ein geschütztes Leerzeichen
    // (U+00A0/U+202F), und ein Ersetzen, das nicht greift, endet ebenfalls
    // im Invalid Date.
    const inZone = new Date(p.replace(/\s+/, 'T'));
    if (Number.isNaN(inZone.getTime())) throw new Error('unlesbar: ' + p);
    return inZone;
  } catch (err) {
    // Eine falsche Jetzt-Linie ist schlimmer als keine — der Rückfall darf
    // nicht stumm bleiben, sonst sucht ihn niemand.
    if (!zoneWarned) {
      zoneWarned = true;
      console.warn('Zeitzone «' + tz + '» nicht auswertbar, es gilt die lokale Zeit.', err);
    }
    return d;
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
  // Die sichtbaren Bänder und ihre Vorgänge — je nach Ebene Gewerke oder Bühnen
  // (js/ebene.js). Einmal in syncState bestimmt, damit Zeilen, Minimap, Achse
  // und Kennzahlen garantiert dieselbe Auswahl sehen.
  let VG = [], VT = [];
  let ebene = O.ebene || 'bau';
  let ausBlend = new Set();
  // Showablauf: Setup, Show oder beides. Zwei Abläufe mit verschiedenen
  // Uhrzeiten — jede Ansicht rechnet ihr Zeitfenster selbst (programmFenster).
  let abschnitt = 'alle';
  // Hat der Showablauf schon ein Zeitfenster? Erst wenn Programmpunkte da sind.
  let fensterDa = false;
  // Showablauf: der gezeigte Kalendertag. null = alle. Eine Running Order ist
  // tagesbezogen — beide Showtage nebeneinander ergäben zehn Zeilen ohne Balken.
  let tag = null;
  const collapsed = new Set();

  // «Jetzt» hängt an der Uhr, nicht an den Daten — deshalb eigene Funktion und
  // ein eigener Tick. Vorher wurde NOW nur bei einer Datenänderung neu
  // berechnet: die Linie stand nach dem Laden für immer still.
  function readNow() {
    const S0 = store.state;
    if (S0.project.now) return toMin(S0.project.now);   // Demo-Übersteuerung
    return toMin(local(nowInZone(S0.project.timezone)));
  }

  // Die Uhrzeit, an der der ABLAUF gerade steht. «Was läuft im um fünf Minuten
  // verschobenen Plan?» ist dieselbe Frage wie «was lief im Originalplan vor
  // fünf Minuten?» — deshalb kennt live.js den Versatz gar nicht, es bekommt
  // einfach die zurückgedrehte Uhr. Damit rechnet auch der Verzug automatisch
  // gegen den verschobenen Plan: wer genau fünf Minuten spät ist und fünf
  // Minuten angesagt hat, ist im Plan.
  const nowPlan = () => NOW - versatz;

  function syncState() {
    S = store.state;
    VG = sichtGewerke(S, ebene, ausBlend);
    const sichtbar = new Set(VG.map((g) => g.id));
    // Die Zieltermine (`gewerk: 'projekt'`) haben kein Band, gehören aber zum
    // Bauzeitenplan und stehen dort in einer eigenen Zeile ganz unten. Ohne sie
    // zählte die Kopfzeile sie nicht mit — der AMK-Plan meldete 36 statt 37.
    if (ebene === 'bau') sichtbar.add('projekt');
    VT = S.tasks.filter((t) => sichtbar.has(t.gewerk));
    if (ebene === 'show') {
      // Der Abschnitt filtert die EINTRÄGE, nicht die Bänder: die Bühne bleibt
      // in beiden Ansichten stehen, auch wenn sie hier noch nichts hat.
      VT = imAbschnitt(VT, abschnitt);
      if (tag) VT = amTag(VT, tag);
    }
    // Der Bauzeitenplan spannt die Achse über die ganze Veranstaltung — das IST
    // sein Zweck. Der Showablauf nimmt sie aus den Programmpunkten: zwei
    // Showtage in vierzehn Tagen Projektlaufzeit wären zwei Striche.
    //
    // Im Showablauf ist die Spanne der ABEND, nicht der Kalendertag: der Tag hat
    // 24 Stunden, die Show dauert zehn. Über den ganzen Tag gespannt nahm der
    // leere Vormittag die halbe Breite ein und die Umbauten waren Striche.
    // Damit steht die Ansicht auch ohne Scrollen richtig — hineingescrollt war
    // die Datumszeile der Achse links angeschnitten.
    const z = ebene === 'bau' ? null : programmFenster(VT);
    fensterDa = !!z;
    T0 = z ? z.von : toMin(S.project.start);
    T1 = z ? z.bis : toMin(S.project.end);
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

  // Die Ansage vom Pult in Minuten, positiv = Delay (siehe live.js). Sie
  // verschiebt den ABLAUF im Bild; Achse, Ticks, Bänder und die JETZT-Linie
  // bleiben auf der echten Uhr stehen. Eine Zahl, kein Zustand im Plan: der
  // Versatz gehört dem Abend, nicht dem Projekt, und wird deshalb auch nicht
  // exportiert.
  let versatz = 0;

  // ── DOM-Gerüst ──────────────────────────────────────────────────────────────
  root.classList.add('bz');
  root.dataset.ebene = ebene;
  // Die Seitenspalte ist im Showablauf breiter: dort steht neben dem Namen die
  // Uhrzeit UND die Dauer, und es sind 17 Zeilen statt 153 — der Zeitstrahl
  // braucht die Breite weniger dringend als die Ablauf-Spalte.
  const SIDE_SHOW = Math.max(O.sideW, 390);
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
  // Die Spaltenüberschrift sagt, WAS in der Seitenspalte steht — und das ist je
  // Ebene etwas anderes.
  const cornerCap = el('div', 'bz-corner-cap');
  const setCap = () => { cornerCap.textContent = ebene === 'show' ? 'Bühne / Zeiteintrag' : 'Gewerk / Vorgang'; };
  setCap();
  corner.append(cornerCap);

  const bandLayer = el('div', 'bz-bands');
  const rowLayer = el('div', 'bz-rows');
  const depLayer = svgEl('svg', { class: 'bz-deps' });
  const linkLayer = el('div', 'bz-links');
  const nowLine = el('div', 'bz-now');
  nowLine.append(el('div', 'bz-now-flag', 'JETZT'));
  canvas.append(bandLayer, rowLayer, depLayer, linkLayer, nowLine);

  const tip = el('div', 'bz-tip');
  root.append(scroller, tip);

  // ── Zeilenmodell ────────────────────────────────────────────────────────────
  // Flache Liste aus Gruppen- und Vorgangszeilen. y wird bei jedem Rebuild neu
  // gerechnet, damit Pfeile und Balken garantiert dieselbe Geometrie sehen.
  //
  // Eine Vorgangszeile trägt eine SERIE (siehe seriesRows in schedule.js): alle
  // Vorgänge gleichen Namens, je einer als Balken. Damit hat die Bühne zwei
  // Zeilen statt fünf. Ein einzelner Vorgang ist eine Serie aus einem — so kennt
  // der Rest der Engine nur einen Fall, auch dort, wo gar nicht gebündelt wird.
  const solo = (t) => ({ title: t.title, tasks: [t], lanes: 1, laneOf: new Map([[t.id, 0]]) });

  // Welcher Farbplatz gilt für DIESEN Balken? Im Showablauf darf ein
  // Programmpunkt eine eigene Farbe tragen; ohne eigene erbt er die seiner
  // Bühne. Im Bauzeitenplan gibt es das nicht — dort gehört die Farbe dem
  // Gewerk, und eine Zeile trägt ohnehin mehrere Termine, für die eine einzelne
  // Farbe stellvertretend stünde.
  const slotVon = (t, g) => (ebene === 'show' && t && t.slot != null ? t.slot : g.slot);

  // Im SHOWABLAUF wird NICHT gebündelt. Dort ist die Reihenfolge der Zeilen der
  // Ablauf selbst — Einlass, Band, Umbau, Band, Umbau —, und die liest man von
  // oben nach unten. Gebündelt entstand daraus eine Zeile «Changeover» mit sechs
  // Balken, die zwischen den Acts hing; die Zeilenfolge richtete sich nach dem
  // frühesten Termin jeder Serie statt nach dem Abend.
  //
  // Der Bauzeitenplan bündelt weiter: dort ist «Aufbau Bühne» an drei Tagen EINE
  // Tätigkeit, und ohne seriesRows hätte die Crew 113 Zeilen für 28 Dinge.
  const buendeln = (list) =>
    (ebene === 'show' ? [...list].sort(byStart).map(solo) : seriesRows(list));

  let rows = [];
  function buildRows() {
    rows = [];
    let y = 0;
    for (const g of VG) {
      const tasks = VT.filter((t) => t.gewerk === g.id).sort(byStart);
      // Im Bauzeitenplan bleibt ein leeres Gewerk unsichtbar — dort gibt es 20
      // Bänder und ein leeres wäre nur Rauschen. Im SHOWABLAUF muss es stehen:
      // eine frisch angelegte Bühne hat noch nichts, und wäre sie unsichtbar,
      // wäre «+ Bühne» ein Klick ins Nichts.
      if (!tasks.length && ebene !== 'show') continue;
      const spans = tasks.filter((t) => !t.milestone);
      // Ohne Vorgänge gäbe Math.min(...[]) Infinity — der Sammelbalken zöge
      // sich über die ganze Achse.
      const gStart = tasks.length ? Math.min(...tasks.map((t) => toMin(t.start))) : T0;
      const gEnd = tasks.length ? Math.max(...tasks.map((t) => toMin(t.end))) : T0;
      const done = tasks.filter((t) => t.status === 'fertig').length;
      rows.push({ kind: 'group', g, y, h: O.groupH, gStart, gEnd, tasks, done, spans });
      y += O.groupH;
      if (!collapsed.has(g.id)) {
        // Bauzeitenplan: eine Zeile je VORGANGSNAME, ein Balken je Termin.
        // Showablauf: eine Zeile je PROGRAMMPUNKT, chronologisch (siehe buendeln).
        // Darunter je Elternvorgang seine Untervorgänge — eingerückt und über
        // collapsed[parentId] einklappbar.
        const kidsOf = (id) => tasks.filter((k) => k.parent === id);
        const tops = tasks.filter((x) => x.parent == null);
        // Sammelvorgänge behalten ihre eigene Zeile: ihre Lage ist die HÜLLE der
        // Kinder, sie gehören in keine Serie. Als Serie aus einem Vorgang geführt,
        // damit der Rest der Engine nur EINEN Fall kennt.
        const eintraege = [
          ...buendeln(tops.filter((t) => kidsOf(t.id).length === 0)).map((s) => ({ rep: s.tasks[0], s })),
          ...tops.filter((t) => kidsOf(t.id).length > 0)
            .map((t) => ({ rep: t, s: solo(t), huelle: t })),
        ].sort((a, b) => byStart(a.rep, b.rep));

        for (const e of eintraege) {
          rows.push({ kind: 'task', g, y, h: O.rowH * e.s.lanes, s: e.s, t: e.rep, parent: !!e.huelle });
          y += O.rowH * e.s.lanes;
          if (!e.huelle || collapsed.has(e.huelle.id)) continue;
          for (const ks of buendeln(kidsOf(e.huelle.id))) {
            rows.push({ kind: 'task', g, y, h: O.rowH * ks.lanes, s: ks, t: ks.tasks[0], child: true });
            y += O.rowH * ks.lanes;
          }
        }
      }
    }
    // Projekt-Meilensteine (gewerk 'projekt') als eigene Zeile ganz unten.
    // Sie gehören zum Bauzeitenplan; im Showablauf hat der Tag seine eigenen
    // Marken (Doors, Show-Ende) und der Zielmeilenstein wäre hier nur Ballast.
    const proj = VT.filter((t) => t.gewerk === 'projekt').sort(byStart);
    if (proj.length) {
      rows.push({ kind: 'projekt', tasks: proj, y, h: O.groupH });
      y += O.groupH;
    }
    return y;
  }

  // ZWEI Abbildungen Zeit → Pixel, und der Unterschied ist der ganze Trick des
  // Versatzes:
  //   x()  — die echte Zeit. Achse, Ticks, Bänder, JETZT-Linie. Steht still.
  //   xp() — die Zeit des ABLAUFS. Balken, Beschriftungen, Pfeile. Wandert.
  // Nur drei Stellen dürfen xp() benutzen: place(), updateLabels() und
  // depAnchors(). Wer eine vierte braucht, verschiebt vermutlich gerade etwas,
  // das zur Achse gehört — und dann steht die Uhr falsch im Bild.
  const x = (min) => (min - T0) * px;
  const xp = (min) => (min + versatz - T0) * px;
  const rowById = new Map();
  const labById = new Map();   // id → Zeile in der Seitenspalte
  let selected = null;        // {kind:'task'|'gewerk', id}

  // ── Statisches Gerüst: Seitenspalte + Zeilenspuren ──────────────────────────
  function rebuild() {
    const totalH = buildRows();
    side.replaceChildren();
    rowLayer.replaceChildren();
    linkLayer.replaceChildren();   // die Ziehgriffe hängen in einer eigenen Ebene
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
        lab.style.setProperty('--gw', gewerkVar(slotVon(r.t, r.g)));
        // Die Zeile trägt eine Serie — die Marken gelten für sie ALS GANZES:
        // eine Marke, sobald irgendein Balken betroffen ist. Sonst hinge an einer
        // Zeile mit vierzehn Balken die Aussage des ersten.
        const alle = r.s.tasks;
        const konflikte = alle.filter((x) => CONFLICTS.has(x.id));
        const kritisch = alle.filter((x) => (SCHED.get(x.id) || {}).critical);
        const offenKrit = kritisch.filter((x) => !x.ackCrit);
        if (r.child) lab.classList.add('is-child');
        // Elternvorgang: Ein-/Ausklapp-Pfeil, wie beim Gewerk (collapsed[taskId]).
        if (r.parent) {
          lab.classList.add('has-sub');
          lab.classList.toggle('is-collapsed', collapsed.has(r.t.id));
          const tw = el('button', 'bz-tw');
          tw.setAttribute('aria-expanded', String(!collapsed.has(r.t.id)));
          tw.setAttribute('aria-label', (collapsed.has(r.t.id) ? 'Aufklappen: ' : 'Zuklappen: ') + r.t.title);
          tw.append(el('span', 'bz-tw-i'));
          tw.onclick = () => { collapsed.has(r.t.id) ? collapsed.delete(r.t.id) : collapsed.add(r.t.id); rebuild(); layout(); };
          lab.append(tw);
        }
        // Im Showablauf führt die Uhrzeit — damit ist die Seitenspalte allein
        // schon der Ablaufplan und man liest ihn, ohne nach rechts zu den Balken
        // zu schauen. Im Bauzeitenplan wäre sie falsch: dort trägt eine Zeile
        // mehrere Termine, und einer davon stünde stellvertretend für alle.
        if (ebene === 'show') {
          // Mit dem Versatz gerechnet: stünde hier 20:00, während der Balken
          // daneben auf 20:05 liegt, widerspräche sich das Blatt selbst — und
          // die verschobene Uhrzeit ist ja gerade das, was man wissen will.
          // `data-at` trägt die PLANZEIT, damit relabelZeiten() später ohne
          // Neuaufbau neu rechnen kann — aus der angezeigten Zeit ließe sich
          // der Ausgangswert nicht zurückgewinnen.
          const zt = el('span', 'bz-lab-zeit', verschoben(r.t.start, versatz).slice(11, 16) + ' Uhr');
          zt.dataset.at = r.t.start;
          lab.append(zt);
          // Dauer in MINUTEN — bei einem Ablauf zählt man in Minuten, nicht in
          // «1,2 h». Ein Meilenstein hat keine Dauer und sagt das mit einem
          // Strich, statt eine Null zu behaupten.
          const min = toMin(r.t.end) - toMin(r.t.start);
          lab.append(el('span', 'bz-lab-dauer', r.t.milestone || min === 0 ? '—' : '(' + min + ' min)'));
        }
        const nm = el('span', 'bz-lab-name', r.s.title);
        nm.title = alle.length > 1 ? r.s.title + ' — ' + alle.length + ' Termine' : r.s.title;
        lab.append(nm);
        const conf = konflikte.length ? CONFLICTS.get(konflikte[0].id) : null;
        if (conf) {
          const c = el('span', 'bz-conf-tag', '!');
          c.title = konflikte.length === 1
            ? '«' + konflikte[0].title + '» ' + conf.message
            : konflikte.length + ' Termine im Konflikt';
          lab.append(c);
        } else if (kritisch.length && !offenKrit.length) {
          // Kritisch, aber abgehakt — ruhige Marke statt rotem KRIT.
          const c = el('span', 'bz-crit-tag is-ack', '✓');
          c.title = 'Kritisch, als gesehen abgehakt';
          lab.append(c);
        } else if (offenKrit.length) {
          const c = el('span', 'bz-crit-tag', 'KRIT');
          c.title = 'Auf dem kritischen Pfad — kein Puffer';
          lab.append(c);
        }
        // Wie viele Termine traegt die Zeile? Bei einem einzelnen bleibt der Platz
        // fuer die Crew-Zahl, wie bisher.
        if (alle.length > 1) {
          const m = el('span', 'bz-lab-meta', alle.length + '×');
          m.title = alle.length + ' Termine' + (r.s.lanes > 1 ? ', zeitweise parallel' : '');
          lab.append(m);
        } else if (r.t.crew) lab.append(el('span', 'bz-lab-meta', r.t.crew + ' P'));
        // ALLE ids der Serie: app.js sucht die Zeile zu einem Vorgang über
        // [data-task~="id"], nicht über Gleichheit — sonst fände das Umbenennen
        // aus dem Kontextmenü nur den ersten Balken einer Serie.
        lab.dataset.task = alle.map((x) => x.id).join(' ');
        for (const x of alle) labById.set(x.id, lab);
        bindRow(lab, { kind: 'task', id: r.t.id }, nm, r.s);
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
          d.tabIndex = 0;                 // auswählbar per Klick → auch per Tab
          d.append(el('span', 'bz-ms-d'), el('span', 'bz-ms-t', t.title));
          bindTip(d, t);
          bindMark(d, { kind: 'task', id: t.id });
          track.append(d);
          bindLink(d, r, t, toMin(t.start));
          rowById.set('task:' + t.id, d);
        }
      } else {
        // Alle Termine der Serie in DIESE eine Spur. Überlappende sitzen auf
        // einer eigenen Spur (--lane), sonst lägen sie übereinander.
        //
        // Je Balken merken, wann der NÄCHSTE derselben Spur beginnt. Ist ein
        // Balken zu schmal für seinen Text, liegt die Beschriftung rechts daneben
        // — und dort steht in einer Serie der nächste Balken. Ohne diese Zahl
        // liefe der Text quer darüber (updateLabels blendet ihn dann aus).
        const naechster = new Map();
        {
          const letzte = new Map();
          for (const t of r.s.tasks) {          // bereits nach Start sortiert
            const l = r.s.laneOf.get(t.id) || 0;
            const v = letzte.get(l);
            if (v) naechster.set(v.id, toMin(t.start));
            letzte.set(l, t);
          }
        }
        for (const t of r.s.tasks) {
          const lane = r.s.laneOf.get(t.id) || 0;
          const s = SCHED.get(t.id) || { critical: false, float: 0 };
          if (t.milestone) {
            const d = el('div', 'bz-ms');
            d.style.setProperty('--gw', gewerkVar(slotVon(t, r.g)));
            d.style.setProperty('--lane', lane);
            d.classList.toggle('is-crit', s.critical);
            d.dataset.at = toMin(t.start);
            // Wie der Balken mit Tab erreichbar: eine Raute ist genauso
            // auswählbar, und sie zu überspringen hieße, dass ein Meilenstein
            // per Tastatur gar nicht anzusteuern ist.
            d.tabIndex = 0;
            d.append(el('span', 'bz-ms-d'), el('span', 'bz-ms-t', t.title));
            bindTip(d, t);
            bindMark(d, { kind: 'task', id: t.id });
            track.append(d);
            bindLink(d, r, t, toMin(t.start));
            rowById.set('task:' + t.id, d);
          } else {
            const b = el('div', 'bz-bar bz-st-' + t.status + (r.parent ? ' is-summary' : ''));
            const bslot = slotVon(t, r.g);
            b.style.setProperty('--gw', gewerkVar(bslot));
            // Die Schrift auf der Farbe hängt am Ton, nicht am Theme (base.css).
            b.style.setProperty('--gw-t', gewerkInkVar(bslot));
            b.style.setProperty('--lane', lane);
            if (gewerkTexture(bslot)) b.dataset.tex = '1';
            b.classList.toggle('is-crit', s.critical);
            b.classList.toggle('is-conflict', CONFLICTS.has(t.id));
            b.classList.toggle('is-estimated', !!t.estimated);
            b.dataset.from = toMin(t.start); b.dataset.to = toMin(t.end);
            if (naechster.has(t.id)) b.dataset.next = naechster.get(t.id);
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
              f.style.setProperty('--lane', lane);
              f.dataset.from = toMin(t.end); f.dataset.to = toMin(t.end) + s.float;
              f.title = fmtFloat(s.float);
              track.append(f);
              rowById.set('slack:' + t.id, f);
            }
            bindTip(b, t);
            bindMark(b, { kind: 'task', id: t.id });
            track.append(b);
            bindLink(b, r, t, toMin(t.end));
            rowById.set('task:' + t.id, b);
          }
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
    // Balken und Rauten tragen tabIndex 0, sind also mit Tab erreichbar — ohne
    // diesen Handler passierte dort auf jede Taste nichts. Space muss abgefangen
    // werden, sonst scrollt es die Seite statt auszuwählen.
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      select(sel);
    });
  }

  // ── Verknüpfen per Ziehen ───────────────────────────────────────────────────
  // Der Gantt ist die Ansicht für Pfeile: hier werden sie gezogen, nicht getippt.
  // Das Suchfeld im Panel bleibt daneben bestehen — Ziehen setzt voraus, dass
  // BEIDE Balken gleichzeitig im Bild sind, und das ist bei 153 Zeilen über
  // vierzehn Tage der Ausnahmefall.
  //
  // EIN Griff je Balken, am Ende. Nicht zwei: es entsteht immer FS, und jede
  // FS-Verknüpfung legt man an, indem man beim Vorgänger beginnt — ein zweiter
  // Griff wäre ein zweites Ziel ohne zweite Bedeutung. Wer SS/FF/SF braucht,
  // stellt den Typ danach im Panel um.
  // Der Griff ist GESCHWISTER des Balkens im Track, nicht sein Kind — genau wie
  // `.bz-slack`. Als Kind lag er hinter `overflow: hidden` des Balkens und war
  // weder zu sehen noch zu treffen. Positioniert wird er von `place()` über
  // data-from/data-to wie alles andere auch; die Trefferfläche steckt in einem
  // ::after, dessen Ereignisse beim Griff selbst ankommen.
  function bindLink(node, row, task, atMin) {
    node.dataset.task = task.id;     // Rückweg: Knoten unter dem Zeiger → Vorgang
    const h = el('div', 'bz-link');
    h.dataset.from = atMin; h.dataset.to = atMin;
    h.dataset.linkFrom = task.id;
    // Senkrecht über markY — dieselbe Rechnung, die schon die Pfeilanker setzt.
    // Sie kennt Spuren, zugeklappte Gruppen und die Zieltermin-Zeile bereits.
    h.style.top = markY(row, task) + 'px';
    h.title = 'Ziehen legt eine Verknüpfung zum Nachfolger an';
    linkLayer.append(h);
    // Der Griff liegt nicht mehr neben dem Balken im DOM (er braucht eine Ebene
    // ÜBER den Pfeilen, sonst fängt deren Trefferfläche ihn ab). Ein
    // CSS-Nachbarselektor scheidet damit aus — die Sichtbarkeit schaltet der
    // Balken selbst.
    const an = () => h.classList.add('is-on');
    const aus = () => h.classList.remove('is-on');
    node.addEventListener('pointerenter', an);
    node.addEventListener('pointerleave', aus);
    node.addEventListener('focus', an);
    node.addEventListener('blur', aus);
    h.addEventListener('pointerenter', an);
    h.addEventListener('pointerleave', aus);
  }

  let link = null;                   // { from, node, ghost, verboten, moved }
  let edgeRaf = 0, edgePt = null;

  const canvasXY = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    return { x: cx - r.left, y: cy - r.top };
  };

  function drawGhost(cx, cy) {
    if (!link) return;
    const r = link.node.getBoundingClientRect();
    const a = canvasXY(r.right, r.top + r.height / 2);
    const b = canvasXY(cx, cy);
    link.ghost.setAttribute('d', `M${a.x},${a.y} L${b.x},${b.y}`);
  }

  // Am Rand mitscrollen. Ohne das ist nur verknüpfbar, was gerade im Bild steht —
  // im Bauzeitenplan wäre das Ziehen damit fast nutzlos.
  function edgeTick() {
    edgeRaf = 0;
    if (!link || !edgePt) return;
    const r = scroller.getBoundingClientRect(), M = 44, SPD = 16;
    let dx = 0, dy = 0;
    if (edgePt.x < r.left + M) dx = -SPD; else if (edgePt.x > r.right - M) dx = SPD;
    if (edgePt.y < r.top + M) dy = -SPD; else if (edgePt.y > r.bottom - M) dy = SPD;
    if (dx || dy) {
      scroller.scrollLeft += dx;
      scroller.scrollTop += dy;
      drawGhost(edgePt.x, edgePt.y);     // der Anker wandert mit dem Scrollstand
    }
    edgeRaf = requestAnimationFrame(edgeTick);
  }

  function endLink() {
    if (!link) return;
    link.ghost.remove();
    root.removeAttribute('data-linking');
    for (const n of root.querySelectorAll('.is-link-from, .is-link-ok, .is-link-no, .is-link-target'))
      n.classList.remove('is-link-from', 'is-link-ok', 'is-link-no', 'is-link-target');
    if (edgeRaf) cancelAnimationFrame(edgeRaf);
    edgeRaf = 0; edgePt = null;
    window.removeEventListener('keydown', linkEsc, true);
    link = null;
  }

  const linkEsc = (e) => {
    if (e.key !== 'Escape' || !link) return;
    e.preventDefault();
    e.stopPropagation();
    endLink();
  };

  // Ziel unter dem Zeiger. Über elementFromPoint statt über die Ereignisziele:
  // der Griff hält den Pointer gefangen, also käme jedes pointermove von IHM.
  const zielUnter = (cx, cy) => {
    const n = document.elementFromPoint(cx, cy);
    const m = n && n.closest('.bz-bar[data-task], .bz-ms[data-task]');
    return m && !link.verboten.has(m.dataset.task) ? m : null;
  };

  root.addEventListener('pointerdown', (e) => {
    const h = e.target.closest('.bz-link');
    if (!h || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const from = h.dataset.linkFrom;
    const node = from && root.querySelector('[data-task="' + from + '"]');
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
    tip.classList.remove('is-on');           // hängt an pointerenter und stünde im Weg

    // Was hier gesperrt ist, lehnte der Store ohnehin ab — nur eben ERST nach
    // dem Loslassen. Ein Ring entsteht genau bei allem, was schon VOR der Quelle
    // liegt; dazu die bereits Verknüpften und die Quelle selbst.
    const verboten = reachable(S.deps, from, 'vor');
    for (const d of S.deps) {
      if (d.from === from) verboten.add(d.to);
      if (d.to === from) verboten.add(d.from);
    }

    const ghost = svgEl('path', { class: 'bz-dep-ghost' });
    depLayer.append(ghost);
    link = { from, node, ghost, verboten, moved: false };

    root.dataset.linking = '1';
    node.classList.add('is-link-from');
    for (const n of root.querySelectorAll('[data-task]')) {
      if (n === node) continue;
      n.classList.add(verboten.has(n.dataset.task) ? 'is-link-no' : 'is-link-ok');
    }
    try { h.setPointerCapture(e.pointerId); } catch (_) { /* egal */ }
    window.addEventListener('keydown', linkEsc, true);
    drawGhost(e.clientX, e.clientY);
  });

  root.addEventListener('pointermove', (e) => {
    if (!link) return;
    link.moved = true;
    edgePt = { x: e.clientX, y: e.clientY };
    if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeTick);
    drawGhost(e.clientX, e.clientY);
    for (const n of root.querySelectorAll('.is-link-target')) n.classList.remove('is-link-target');
    const ziel = zielUnter(e.clientX, e.clientY);
    if (ziel) ziel.classList.add('is-link-target');
  });

  root.addEventListener('pointerup', (e) => {
    if (!link) return;
    const from = link.from, moved = link.moved;
    const ziel = zielUnter(e.clientX, e.clientY);
    endLink();
    // Der Griff sitzt IM Balken; sein click blubbert zu bindMark und wählte
    // sonst die Quelle aus statt der neuen Verknüpfung. Nur nach einer echten
    // Ziehbewegung abfangen — bei einem bloßen Klick auf den Griff ist
    // Auswählen das richtige Verhalten.
    if (moved) window.addEventListener('click', (c) => { c.stopPropagation(); }, { capture: true, once: true });
    if (ziel && O.onLink) O.onLink(from, ziel.dataset.task);
  });

  root.addEventListener('pointercancel', endLink);

  function bindRow(lab, sel, nameNode, serie) {
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
      editName(sel, nameNode, serie);
    });
  }

  // Umbenennen direkt in der Zeile. Trägt die Zeile eine SERIE, werden alle ihre
  // Termine umbenannt — die Zeile heißt ja als Ganzes so. Nur den ersten Balken
  // umzubenennen risse ihn aus der Serie heraus und erzeugte eine zweite Zeile.
  function editName(sel, nameNode, serie) {
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
      const ids = serie && serie.tasks.length > 1 ? serie.tasks.map((x) => x.id) : [sel.id];
      const cmd = sel.kind === 'gewerk'
        ? { type: 'setGewerkField', id: sel.id, field: 'name', value: v }
        : ids.length > 1
          ? { type: 'batch', label: 'Serie umbenennen',
              cmds: ids.map((id) => ({ type: 'setTaskField', id, field: 'title', value: v })) }
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

  // „Zeigen": den Vorgang sichtbar machen — Gewerk und ggf. Elternvorgang
  // aufklappen, auswählen, hinscrollen. Für die Prüf-Liste (kritisch/Konflikt).
  function reveal(taskId) {
    const t = S.tasks.find((x) => x.id === taskId);
    if (!t) return;
    let changed = false;
    if (collapsed.has(t.gewerk)) { collapsed.delete(t.gewerk); changed = true; }
    if (t.parent && collapsed.has(t.parent)) { collapsed.delete(t.parent); changed = true; }
    if (changed) { rebuild(); layout(); }
    select({ kind: 'task', id: taskId });
    centerOn(toMin(t.start));
  }

  function paintSelection() {
    for (const n of root.querySelectorAll('.is-sel')) n.classList.remove('is-sel');
    if (!selected) return;
    // Eine Verknüpfung hat keine Zeile und keinen Balken — nur ihren Pfad.
    if (selected.kind === 'dep') {
      const p = depLayer.querySelector('path.bz-dep[data-dep="' + selected.id + '"]');
      if (p) p.classList.add('is-sel');
      return;
    }
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
      p.dataset.dep = d.id;
      // Ein 1,5 px breiter Pfad ist nicht zu treffen. Darunter liegt ein
      // unsichtbarer Zwilling mit demselben `d`, nur dick — er allein nimmt
      // Zeigerereignisse an (.bz-deps bleibt pointer-events:none, sonst fingen
      // die Pfeile Klicks auf den Balken darunter ab).
      const hit = svgEl('path', { class: 'bz-dep-hit' });
      hit.dataset.dep = d.id;
      hit.addEventListener('click', () => select({ kind: 'dep', id: d.id }));
      hit.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        select({ kind: 'dep', id: d.id });
        if (O.onContext) O.onContext({ kind: 'dep', id: d.id }, e.clientX, e.clientY);
      });
      depLayer.append(hit, p);
      depPaths.push({ p, hit, d, ra, rb });
    }
  }

  // Die Zeile, in der ein Vorgang zu sehen ist. Seit es Serien gibt, ist das die
  // Zeile, die ihn ENTHÄLT — nicht mehr die, deren einziger Vorgang er ist.
  function visualRow(task) {
    if (task.gewerk === 'projekt') return rows.find((r) => r.kind === 'projekt');
    if (collapsed.has(task.gewerk)) return rows.find((r) => r.kind === 'group' && r.g.id === task.gewerk);
    return rows.find((r) => r.kind === 'task' && r.s.laneOf.has(task.id));
  }

  // Höhe der Zeilenmitte für einen Vorgang — bei mehrspurigen Serien die Mitte
  // SEINER Spur, sonst zeigte der Pfeil zwischen zwei Balken ins Leere.
  function markY(row, task) {
    if (row.kind !== 'task' || !row.s) return row.y + row.h / 2;
    const lane = row.s.laneOf.get(task.id) || 0;
    return row.y + lane * O.rowH + O.rowH / 2;
  }

  function depAnchors(d, ra, rb) {
    const a = byId.get(d.from), b = byId.get(d.to);
    const aFrom = collapsed.has(a.gewerk) && ra.kind === 'group' ? ra.gStart : toMin(a.start);
    const aTo = collapsed.has(a.gewerk) && ra.kind === 'group' ? ra.gEnd : toMin(a.end);
    const bFrom = collapsed.has(b.gewerk) && rb.kind === 'group' ? rb.gStart : toMin(b.start);
    const bTo = collapsed.has(b.gewerk) && rb.kind === 'group' ? rb.gEnd : toMin(b.end);
    // FS/FF gehen vom Ende des Vorgängers, SS/SF von dessen Start.
    // xp(), nicht x(): die Pfeile gehören zum Ablauf und wandern mit ihren
    // Balken — sonst zeigten sie nach einem Versatz daneben ins Leere.
    const x1 = xp(d.type === 'SS' || d.type === 'SF' ? aFrom : aTo);
    // FS/SS enden am Start des Nachfolgers, FF/SF an dessen Ende.
    const x2 = xp(d.type === 'FF' || d.type === 'SF' ? bTo : bFrom);
    return { x1, x2, y1: markY(ra, a), y2: markY(rb, b) };
  }

  function layoutDeps() {
    for (const { p, hit, d, ra, rb } of depPaths) {
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
      hit.setAttribute('d', path);        // derselbe Verlauf, nur dick und unsichtbar
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
    for (const n of linkLayer.children) place(n);
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
    const a = xp(+n.dataset.from), b = xp(+n.dataset.to);
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
      const a = xp(+n.dataset.from), b = xp(+n.dataset.to);
      if (n.classList.contains('is-narrow')) {
        // Beschriftung liegt rechts NEBEN dem Balken. Weg damit, wenn der Balken
        // aus dem Bild ist — oder wenn in einer Serie der nächste Balken so dicht
        // folgt, dass der Text quer über ihn liefe. Den Namen trägt dann die
        // Zeilenbeschriftung links, die immer stehen bleibt.
        const naechster = n.dataset.next ? xp(+n.dataset.next) : Infinity;
        n.classList.toggle('lab-hide', b <= s || naechster - b < n._textW);
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

  // Die Uhrzeiten der Showablauf-Seitenspalte neu schreiben. Sie entstehen beim
  // Zeilenaufbau, der Versatz ändert sich aber ohne Aufbau — ohne das hier
  // stünde links die Planzeit neben einem verschobenen Balken.
  function relabelZeiten() {
    for (const n of side.querySelectorAll('.bz-lab-zeit[data-at]'))
      n.textContent = verschoben(n.dataset.at, versatz).slice(11, 16) + ' Uhr';
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
      // Auf die dargestellte Spanne klemmen. Ein Wochenendband läuft über zwei
      // Kalendertage; zeigt die Ansicht nur einen (Showablauf), ragte es
      // 1400 px über den Canvas hinaus und machte den Scroller genau so viel
      // breiter — der Tag rutschte aus dem Bild und rechts klaffte Grau.
      for (const w of weekendBands(new Date(S.project.start), new Date(S.project.end))) {
        const a = x(Math.max(T0, Math.round(w.from.getTime() / 60000)));
        const b = x(Math.min(T1, Math.round(w.to.getTime() / 60000)));
        if (b <= a) continue;
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
    // Im Showablauf JEDE Stunde beschriften. `ticksFor` kennt 'hour' längst — es
    // wird am Bildschirm nur nie gewählt, weil 24 Stunden im Bauzeitenplan zu
    // dicht stehen. Über einem Abend von zehn Stunden ist es genau richtig.
    // Erst ab einer Stundenbreite, die Zahlen trägt (px >= 0.5 → 30 px/Stunde);
    // wer im Showablauf auf «Monate» zoomt, bekommt wieder die normale Staffel.
    const roh = tickScale(px);
    const sc = ebene === 'show' && px >= 0.5 ? { major: roh.major, minor: 'hour' } : roh;
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
    // Die grobe Zeile beginnt eine EINHEIT FRÜHER als der Ausschnitt: gesucht ist
    // der Tag, in dem man sich befindet, und der beginnt links außerhalb, sobald
    // man in ihn hineingescrollt hat. Mit `from` allein fiel er heraus — im
    // Showablauf, der auf den Abend zoomt, stand die Achse dadurch ganz ohne
    // Datum da. Ticks, die den Ausschnitt gar nicht berühren, fallen unten weg.
    // NICHT auf T0 klemmen: gebraucht wird gerade der Tick, der VOR T0 beginnt —
    // im Showablauf steht T0 auf 12:00, der Tag aber auf 00:00. `endMin <= T0`
    // unten wirft weg, was den Ausschnitt gar nicht berührt.
    const majBack = sc.major === 'day' ? 1440 : sc.major === 'week' ? 10080 : 44640;
    const majFrom = new Date((vFrom - majBack) * 60000);
    for (const t of ticksFor(sc.major, majFrom, to)) {
      const startMin = Math.round(t.t.getTime() / 60000);
      const endMin = startMin + majSpan(sc.major, t.t);
      if (startMin >= T1 || endMin <= T0) continue;
      // Beidseitig auf die Planspanne geklemmt: ein Tagesbalken ist 1440 min
      // breit, auch wenn davon nur zehn Minuten in die Ansicht fallen. Ohne die
      // Klemmung säße sein mittiges Label außerhalb des Bildes.
      const links = Math.max(T0, startMin);
      const n = el('div', 'bz-t bz-t-major');
      n.style.left = x(links) + 'px';
      n.style.width = ((Math.min(T1, endMin) - links) * px) + 'px';
      n.append(el('span', null, sc.major === 'day' ? t.full : t.label));
      axisMajor.append(n);
    }
    axisMinor.replaceChildren();
    for (const t of ticksFor(sc.minor, from, to)) {
      if (Math.round(t.t.getTime() / 60000) >= T1) continue;
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
      // Mit dem Versatz, wie Balken und Seitenspalte: der Tooltip beantwortet
      // «wann ist das?», und die Antwort ist die verschobene Zeit.
      const sd = new Date(verschoben(t.start, versatz)), ed = new Date(verschoben(t.end, versatz));
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
  let mini, miniStrip, miniWin, miniNow;

  // Die Spuren werden neu gefüllt, wenn sich die Ebene ändert — dort wechselt
  // die ganze Auswahl UND die Zeitspanne, eine stehengebliebene Karte zeigte
  // dann die Aufbauwochen unter einem Showtag.
  function fillMiniStrip() {
    miniStrip.replaceChildren();
    for (const g of VG) {
      const lane = el('div', 'bz-mini-lane');
      lane.style.setProperty('--gw', gewerkVar(g.slot));
      for (const t of VT.filter((x) => x.gewerk === g.id && !x.milestone)) {
        const m = el('div', 'bz-mini-b');
        // Eigene Farbe auch in der Karte — sonst zeigt sie einen anderen Abend
        // als der Plan darüber.
        m.style.setProperty('--gw', gewerkVar(slotVon(t, g)));
        const a = (toMin(t.start) - T0) / TOTAL_MIN * 100;
        const b = (toMin(t.end) - T0) / TOTAL_MIN * 100;
        m.style.left = a + '%'; m.style.width = Math.max(0.3, b - a) + '%';
        lane.append(m);
      }
      miniStrip.append(lane);
    }
    miniNow = el('div', 'bz-mini-now');
    miniNow.style.left = (NOW - T0) / TOTAL_MIN * 100 + '%';
    miniStrip.append(miniNow);
    miniWin = el('div', 'bz-mini-win');
    miniStrip.append(miniWin);
  }

  function buildMinimap() {
    mini = el('div', 'bz-mini-map');
    const strip = el('div', 'bz-mini-strip');
    miniStrip = strip;
    fillMiniStrip();
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
    const running = on ? runningAt(S.tasks, nowPlan()) : new Set();
    const late = new Map(on ? delaysAt(S.tasks, nowPlan()).map((d) => [d.taskId, d]) : []);
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
  // Die WIRKLICHE Breite der Seitenspalte, nicht die eingestellte: sie hängt an
  // der Ebene und wird auf Handybreite von base.css überschrieben (168px). Mit
  // O.sideW gerechnet passte die Tagesansicht dort um über hundert Pixel daneben.
  const sideWNow = () => side.getBoundingClientRect().width || O.sideW;
  const timelineW = () => scroller.clientWidth - sideWNow();

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
    meldeView();
  }

  // Der ABEND füllt die Breite — von Doors bis Show-Ende, nicht der Kalendertag.
  // Der Showtag hat 24 Stunden, die Show dauert zehn: über den ganzen Tag
  // gespannt nahm der leere Vormittag die halbe Breite ein und die Umbauten
  // waren Striche.
  //
  // Angefasst wird nur ZOOM und SCROLLSTAND, nicht T0/T1 — die Achse behält
  // ihre Tagesgrenzen und damit ihre Datumszeile. Wer nach links scrollt, sieht
  // weiterhin den Vormittag; er drängt sich nur nicht mehr ins Bild.
  // Der Gantt passt sich an zwei Stellen von SELBST ein: beim ersten
  // Programmpunkt eines leeren Showablaufs und beim Wiederauftauchen aus der
  // Tabelle (ResizeObserver). Beides passiert asynchron — wer die Kopfzeile
  // (Zoomstufe, Mitteldatum) danach aktualisieren will, kann nicht raten, wann
  // es so weit ist. Deshalb sagt der Gantt Bescheid.
  const meldeView = () => { if (O.onView) O.onView(); };

  function fitSpanne() {
    px = clampZoom(fitPx(timelineW(), TOTAL_MIN));
    zoomMode = null;          // eine eigene Spanne ist keine der festen Stufen
    layout();
    scroller.scrollLeft = 0;  // die Spanne IST das Bild, es gibt nichts daneben
    meldeView();
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
    setZoom(px * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left - sideWNow());
  }, { passive: false });

  // Shift+Rad scrollt horizontal (Trackpad-freie Mäuse)
  scroller.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey || !e.shiftKey) return;
    scroller.scrollLeft += e.deltaY;
  }, { passive: true });

  root.addEventListener('keydown', (e) => {
    if (e.target.closest('input,select,textarea')) return;
    // Entf auf einer ausgewählten Verknüpfung. Nur auf Verknüpfungen: einen
    // Vorgang per Tastendruck zu löschen wäre zu leicht aus Versehen getan, und
    // dafür gibt es das Menü mit seiner Rückfrage.
    if (selected && selected.kind === 'dep' && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      if (O.onRemoveDep) O.onRemoveDep(selected.id);
      return;
    }
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
    collapseAll() { for (const g of VG) collapsed.add(g.id); rebuild(); layout(); },
    expandAll() { collapsed.clear(); rebuild(); layout(); },
    /**
     * Ebene wechseln — Bauzeitenplan oder Showablauf, mit ausgeblendeten Bändern.
     * Der Zoom kommt mit: eine Ansicht über zwei Showtage in der Wochenstufe
     * zeigte lauter Striche, eine über zwei Wochen in der Stundenstufe nichts.
     */
    setEbene(name, aus = new Set(), showTag = null, absch = 'alle') {
      const gewechselt = name !== ebene || (name === 'show' && absch !== abschnitt);
      ebene = name;
      ausBlend = new Set(aus);
      tag = name === 'show' ? showTag : null;
      abschnitt = name === 'show' ? absch : 'alle';
      setCap();
      root.dataset.ebene = ebene;   // das CSS entscheidet über Füllung, nicht JS
      root.style.setProperty('--side-w', (ebene === 'show' ? SIDE_SHOW : O.sideW) + 'px');
      syncState();
      rebuild();
      layout();
      if (O.minimap && miniStrip) fillMiniStrip();
      if (!gewechselt) return;
      // Beim Ebenenwechsel ist T0 ein anderes Datum — derselbe Scrollstand
      // bedeutete einen ganz anderen Zeitpunkt, und dieselbe Zoomstufe eine
      // ganz andere Zeitspanne. Also beides neu setzen: zwei Showtage wollen
      // Stunden, zwei Projektwochen wollen Tage.
      if (ebene === 'show') {
        // Der Abend füllt die Breite — von Doors bis Show-Ende, sonst nichts.
        fitSpanne();
        return;
      }
      api.setZoomPreset('tage');
      if (NOW > T0 && NOW < T1) centerOn(NOW, 0.3);
      else scroller.scrollLeft = 0;
    },
    get ebene() { return ebene; },
    minimapNode: O.minimap ? buildMinimap() : null,
    get zoomName() { return zoomMode ?? nearestPreset(px); },
    stats() {
      // BESTAND zählt, was zu sehen ist — sonst meldete die Kopfzeile im
      // Showablauf 353 Vorgänge über einem Blatt mit 33 Zeilen.
      //
      // WARNUNGEN (kritisch, Konflikte) bleiben planweit. Sie sind Aussagen über
      // den Plan, nicht über den Ausschnitt; eine Ansicht zu wechseln darf sie
      // nicht wegdrücken. Und sie müssen zur Prüf-Liste passen, die über
      // conflicts()/criticals() ebenfalls den ganzen Plan zeigt — zwei Zähler
      // nebeneinander wären genau der Fehler, den die Regel verbietet.
      const crit = S.tasks.filter((t) => (SCHED.get(t.id) || {}).critical && !t.ackCrit).length;
      const done = VT.filter((t) => t.status === 'fertig').length;
      const run = VT.filter((t) => t.status === 'laeuft').length;
      const crew = VT.filter((t) => t.status === 'laeuft').reduce((a, t) => a + (t.crew || 0), 0);
      return { total: VT.length, crit, done, run, crew, gewerke: VG.length, conflicts: CONFLICTS.size };
    },
    relayout: layout,
    refresh,
    select,
    reveal,
    // Alle kritischen Vorgänge (ids), abgehakt oder nicht — für die Prüf-Liste.
    criticals: () => S.tasks.filter((t) => (SCHED.get(t.id) || {}).critical).map((t) => t.id),
    get selected() { return selected; },
    setLive(on) {
      live = !!on;
      tickNow();
      paintLive();
      if (live) centerOn(NOW, 0.4);
    },
    get isLive() { return live; },
    tickNow,
    /**
     * Die Ansage vom Pult in Minuten setzen (positiv = Delay).
     *
     * Geklemmt auf ±180: darüber ist es keine Ansage mehr, sondern ein
     * Vertipper, und ein Ablauf, der drei Stunden neben der Achse liegt, ist
     * kein Ablaufplan mehr.
     *
     * Bewusst KEIN rebuild(): der Zeilenaufbau ändert sich nicht, nur die
     * Lage. Ein Neubau risse die Auswahl weg — dieselbe Begründung wie beim
     * Tick. layout() reicht, und die Seitenspalten-Uhrzeit hängt am Aufbau,
     * deshalb wird sie unten gezielt nachgezogen.
     */
    setVersatz(min) {
      const next = Math.max(-180, Math.min(180, Math.round(Number(min) || 0)));
      if (next === versatz) return versatz;
      versatz = next;
      layout();
      paintLive();
      relabelZeiten();
      return versatz;
    },
    get versatz() { return versatz; },
    liveInfo: () => ({
      now: NOW,                       // die echte Uhr — für Datum und Anzeige
      planNow: nowPlan(),             // wo der Ablauf steht — für jede Rechnung
      versatz,
      running: runningAt(S.tasks, nowPlan()),
      late: delaysAt(S.tasks, nowPlan()),
    }),
    // Die Vorgänge der sichtbaren Ebene — die Live-Kopfzeile des Showablaufs
    // fragt danach, statt selbst zu filtern. Kopie: niemand soll von außen in
    // die Auswahl der Engine schreiben.
    sichtbareTasks: () => VT.slice(),
    conflicts: () => [...CONFLICTS.values()],
    destroy() { unsubscribe(); stopTicking(); document.removeEventListener('visibilitychange', onVis); root.replaceChildren(); },
  };

  // Auf Änderungen reagieren. Scrollstand halten — sonst spränge der Plan bei
  // jedem Tastendruck an den Anfang zurück.
  function refresh() {
    const keepLeft = scroller.scrollLeft, keepTop = scroller.scrollTop;
    const vorher = S && S.project.id;
    const vorherFenster = fensterDa;
    syncState();
    rebuild();
    layout();
    // ERSTER Programmpunkt in einem noch leeren Showablauf: bis eben gab es
    // kein Zeitfenster, die Achse stand auf der Projektlaufzeit und der Zoom
    // entsprechend weit draußen — der neue Balken wäre ein Strich in der
    // Monatsansicht gewesen. Einmalig einpassen, danach nie wieder: sonst
    // spränge die Ansicht bei jeder Änderung an den Anfang zurück.
    const ersteinpassen = ebene === 'show' && !vorherFenster && fensterDa;
    if (ersteinpassen) {
      fitSpanne();
    } else if (S.project.id !== vorher) {
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
  // Die Tagesansicht ist als «ein Kalendertag füllt die Breite» definiert — sie
  // muss also neu einpassen, wenn sich die Breite ändert. Ohne das blieb sie auf
  // der Breite stehen, die beim Setzen galt: kam der Ebenenwechsel, während die
  // Tabelle sichtbar und der Gantt versteckt war, war die gemessene Breite fast
  // null und der Showtag füllte nur zwei Drittel des Blattes.
  let letzteBreite = 0;
  new ResizeObserver(() => {
    const b = scroller.clientWidth;
    // Verschwunden (die Tabelle ist sichtbar): merken, dass die nächste
    // Rückkehr ein Wiederauftauchen ist. Ohne das blieb `letzteBreite` auf dem
    // alten Wert stehen, die Rückkehr galt als «keine Änderung» — und ein Zoom,
    // der währenddessen mit Breite 0 gerechnet wurde, blieb für immer falsch.
    if (b === 0) { letzteBreite = 0; return; }
    if (Math.abs(b - letzteBreite) > 1) {
      const vorher = letzteBreite;
      letzteBreite = b;
      // «Die Spanne füllt die Breite» ist eine Zusage, die bei JEDER Breite gilt.
      // Nur beim ersten Messen und beim Wiederauftauchen (Breite war 0, weil die
      // Tabelle sichtbar war) neu einpassen — nicht bei jedem freien Zoom.
      if (ebene === 'show' && vorher === 0) fitSpanne();
      else if (zoomMode === 'tage') fitDay(centerDayIso());
    }
    renderAxis(true);
    layoutMinimap();
  }).observe(scroller);

  return api;
}

