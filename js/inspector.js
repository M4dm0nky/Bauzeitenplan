// ── Seitenpanel ───────────────────────────────────────────────────────────────
// Klick auf einen Balken oder eine Zeile links → hier stehen alle Felder.
// Bewusst der Weg für PRÄZISES Bearbeiten; das Schnelle läuft übers
// Rechtsklick-Menü und Doppelklick.

import { parseDuration, fmtDuration, local } from './conflicts.js';
import { toMin, toDate, computeSchedule } from './schedule.js';
import { gewerkVar, gewerkTexture, HUES, MAX_SLOTS } from './palette.js';
import { fmtFloat } from './timeaxis.js';
import { el, toInput, STATUS } from './dom.js';

const DEP_TYPES = [
  ['FS', 'Ende → Start'], ['SS', 'Start → Start'],
  ['FF', 'Ende → Ende'], ['SF', 'Start → Ende'],
];

// Der Inspector entscheidet über seinen INHALT, nie über seine Sichtbarkeit.
// Vorher schrieben vier Stellen an #ins.hidden — zwei hier, zwei in app.js —
// und render() kannte die Ansicht nicht. Jede Änderung holte das Panel in der
// Tabellen-Ansicht zurück. Ein Zustand, ein Besitzer: app.js.
export function createInspector(root, { store, onError, onClose } = {}) {
  root.classList.add('ins');
  let sel = null;

  const send = (cmd) => {
    const r = store.apply(cmd);
    if (r && r.ok === false && onError) onError(r.error);
    return r;
  };
  const cur = (id) => store.state.tasks.find((t) => t.id === id);
  const curG = (id) => store.state.gewerke.find((g) => g.id === id);

  function show(s) {
    sel = s;
    render();
  }

  function render() {
    root.replaceChildren();
    if (!sel) return;

    const head = el('div', 'ins-head');
    head.append(el('span', 'ins-kind', sel.kind === 'gewerk' ? 'Gewerk' : 'Vorgang'));
    const close = el('button', 'ins-x', '×');
    close.title = 'Panel schließen';
    close.onclick = () => { sel = null; render(); if (onClose) onClose(); };
    head.append(close);
    root.append(head);

    if (sel.kind === 'gewerk') renderGewerk();
    else renderTask();
  }

  // ── Gewerk ────────────────────────────────────────────────────────────────
  function renderGewerk() {
    const g = curG(sel.id);
    if (!g) { sel = null; if (onClose) onClose(); return; }
    const tasks = store.state.tasks.filter((t) => t.gewerk === g.id);

    const dot = el('span', 'bz-dot ins-dot');
    dot.style.setProperty('--gw', gewerkVar(g.slot));
    if (gewerkTexture(g.slot)) dot.dataset.tex = '1';
    const title = el('div', 'ins-title');
    title.append(dot, el('span', null, g.name));
    root.append(title);

    root.append(field('Name', text(g.name, (v) =>
      send({ type: 'setGewerkField', id: g.id, field: 'name', value: v }))));

    // Reihenfolge
    const ord = el('div', 'ins-row');
    const up = el('button', 'btn', '↑ nach oben');
    up.onclick = () => send({ type: 'reorderGewerk', id: g.id, dir: -1 });
    const dn = el('button', 'btn', '↓ nach unten');
    dn.onclick = () => send({ type: 'reorderGewerk', id: g.id, dir: 1 });
    ord.append(up, dn);
    root.append(field('Reihenfolge', ord));

    // Farbe ist nicht wählbar: die Zuordnung ist gerechnet (docs/farbsuche.md).
    const col = el('div', 'ins-ro');
    col.textContent = 'Platz ' + (g.slot + 1) + ' von ' + MAX_SLOTS
      + (gewerkTexture(g.slot) ? ' · mit Schraffur (Farbton ' + ((g.slot % HUES) + 1) + ' wiederholt sich)' : '');
    root.append(field('Farbe', col));

    const info = el('div', 'ins-ro', tasks.length + (tasks.length === 1 ? ' Vorgang' : ' Vorgänge'));
    root.append(field('Inhalt', info));

    const add = el('button', 'btn btn-p', '+ Vorgang hinzufügen');
    add.onclick = () => addTaskTo(g.id);
    root.append(add);

    const del = el('button', 'btn btn-danger', 'Gewerk löschen');
    del.onclick = () => {
      const msg = tasks.length
        ? `«${g.name}» löschen? ${tasks.length} ${tasks.length === 1 ? 'Vorgang geht' : 'Vorgänge gehen'} mit, samt Verknüpfungen. ⌘Z holt alles zurück.`
        : `«${g.name}» löschen?`;
      if (!confirm(msg)) return;
      send({ type: 'removeGewerk', id: g.id });
      sel = null; render(); if (onClose) onClose();
    };
    root.append(del);
  }

  // ── Vorgang ───────────────────────────────────────────────────────────────
  function renderTask() {
    const t = cur(sel.id);
    if (!t) { sel = null; if (onClose) onClose(); return; }
    const isProj = t.gewerk === 'projekt';

    root.append(el('div', 'ins-title', t.title));

    // Gewerk
    if (isProj) root.append(field('Gewerk', el('div', 'ins-ro', 'Projekt-Zieltermin')));
    else {
      const s = el('select');
      for (const g of [...store.state.gewerke].sort((a, b) => a.sort - b.sort)) {
        const o = el('option', null, g.name);
        o.value = g.id;
        if (g.id === t.gewerk) o.selected = true;
        s.append(o);
      }
      s.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'gewerk', value: s.value });
      root.append(field('Gewerk', s));
    }

    root.append(field('Name', text(t.title, (v) =>
      send({ type: 'setTaskField', id: t.id, field: 'title', value: v }))));

    // Start
    const st = el('input');
    st.type = 'datetime-local';
    st.value = toInput(t.start);
    st.onchange = () => {
      const now = cur(t.id);
      if (!now || !st.value) return;
      const dur = toMin(now.end) - toMin(now.start);
      send({ type: 'moveTask', id: t.id, start: st.value, end: local(toDate(toMin(st.value) + dur)) });
    };
    root.append(field('Start', st));

    if (!t.milestone) {
      const durMin = toMin(t.end) - toMin(t.start);
      const du = el('input');
      du.value = fmtDuration(durMin);
      du.placeholder = '4h';
      du.onchange = () => {
        const now = cur(t.id);
        if (!now) return;
        const real = toMin(now.end) - toMin(now.start);
        const m = parseDuration(du.value);
        if (m == null || m === 0) { du.value = fmtDuration(real); du.classList.add('is-bad'); setTimeout(() => du.classList.remove('is-bad'), 900); return; }
        if (m === real) return;
        // Wer die Dauer eintippt, hat sie bestätigt: die Schätzmarke fällt weg.
        // Sonst bliebe der Balken gestrichelt, obwohl die Zahl feststeht.
        send(now.estimated
          ? { type: 'batch', label: 'Dauer gesetzt', cmds: [
              { type: 'setTaskField', id: t.id, field: 'end', value: local(toDate(toMin(now.start) + m)) },
              { type: 'setTaskField', id: t.id, field: 'estimated', value: false }] }
          : { type: 'setTaskField', id: t.id, field: 'end', value: local(toDate(toMin(now.start) + m)) });
      };
      root.append(field('Dauer', du, '4h · 1,5h · 90m · 2t · 1t 4h'));

      const en = el('input');
      en.type = 'datetime-local';
      en.value = toInput(t.end);
      en.onchange = () => {
        const now = cur(t.id);
        if (!now || !en.value || en.value === toInput(now.end)) return;
        send(now.estimated
          ? { type: 'batch', label: 'Ende gesetzt', cmds: [
              { type: 'setTaskField', id: t.id, field: 'end', value: en.value },
              { type: 'setTaskField', id: t.id, field: 'estimated', value: false }] }
          : { type: 'setTaskField', id: t.id, field: 'end', value: en.value });
      };
      root.append(field('Ende', en));
    }

    if (!t.milestone) {
      // Zum Abhaken, sobald die echte Zahl feststeht.
      const eW = el('label', 'ins-check');
      const eC = el('input');
      eC.type = 'checkbox';
      eC.checked = !!t.estimated;
      eC.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'estimated', value: eC.checked });
      eW.append(eC, el('span', null, 'Dauer geschätzt'));
      root.append(eW);
    }

    // Meilenstein
    const msWrap = el('label', 'ins-check');
    const ms = el('input');
    ms.type = 'checkbox';
    ms.checked = !!t.milestone;
    ms.onchange = () => {
      const now = cur(t.id);
      send(ms.checked
        ? { type: 'batch', label: 'Zu Meilenstein', cmds: [
            { type: 'setTaskField', id: t.id, field: 'end', value: now.start },
            { type: 'setTaskField', id: t.id, field: 'milestone', value: true }] }
        : { type: 'batch', label: 'Meilenstein aufheben', cmds: [
            { type: 'setTaskField', id: t.id, field: 'end', value: local(toDate(toMin(now.start) + 120)) },
            { type: 'setTaskField', id: t.id, field: 'milestone', value: false }] });
    };
    msWrap.append(ms, el('span', null, 'Meilenstein (ohne Dauer)'));
    root.append(msWrap);

    if (!isProj) {
      const cr = el('input');
      cr.type = 'number';
      cr.min = '0';
      cr.value = t.crew ?? '';
      cr.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'crew',
        value: cr.value === '' ? null : Math.max(0, parseInt(cr.value, 10) || 0) });
      root.append(field('Crew', cr));

      const stt = el('select');
      for (const [v, label] of STATUS) {
        const o = el('option', null, label);
        o.value = v;
        if (v === t.status) o.selected = true;
        stt.append(o);
      }
      stt.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'status', value: stt.value });
      root.append(field('Status', stt, 'Wird nie automatisch gesetzt — sonst sieht der Plan immer nach Plan aus.'));
    }

    const nt = el('textarea');
    nt.rows = 2;
    nt.value = t.notes || '';
    nt.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'notes', value: nt.value });
    root.append(field('Notiz', nt));

    // ── Nur lesbar: was die Rechnung sagt ──
    let sched = null;
    try { sched = computeSchedule(store.state.tasks, store.state.deps).get(t.id); } catch { /* Ring */ }
    if (sched) {
      const r = el('div', 'ins-ro' + (sched.critical ? ' is-crit' : ''));
      r.textContent = sched.critical ? 'auf dem kritischen Pfad — kein Puffer' : fmtFloat(sched.float);
      root.append(field('Puffer', r));
    }

    root.append(deps(t));

    const del = el('button', 'btn btn-danger', 'Vorgang löschen');
    del.onclick = () => { send({ type: 'removeTask', id: t.id }); sel = null; render(); if (onClose) onClose(); };
    root.append(del);
  }

  // ── Verknüpfungen ─────────────────────────────────────────────────────────
  function deps(t) {
    const box = el('div', 'ins-deps');
    box.append(el('h4', 'ins-h4', 'Verknüpfungen'));
    const byId = new Map(store.state.tasks.map((x) => [x.id, x]));

    const rows = [
      ...store.state.deps.filter((d) => d.to === t.id).map((d) => ({ d, dir: 'vor', other: d.from })),
      ...store.state.deps.filter((d) => d.from === t.id).map((d) => ({ d, dir: 'nach', other: d.to })),
    ];
    if (!rows.length) box.append(el('div', 'ins-empty', 'Keine — dieser Vorgang hängt an nichts.'));

    for (const { d, dir, other } of rows) {
      const o = byId.get(other);
      const r = el('div', 'ins-dep');
      r.append(el('span', 'ins-dep-d', dir === 'vor' ? '← nach' : '→ vor'));
      r.append(el('span', 'ins-dep-n', o ? o.title : other));

      const ty = el('select', 'ins-dep-t');
      for (const [v, label] of DEP_TYPES) {
        const op = el('option', null, label);
        op.value = v;
        if (v === d.type) op.selected = true;
        ty.append(op);
      }
      ty.onchange = () => send({ type: 'setDepField', id: d.id, field: 'type', value: ty.value });

      const lag = el('input', 'ins-dep-l');
      lag.value = d.lag ? fmtDuration(Math.abs(d.lag)) : '';
      lag.placeholder = 'Lag';
      lag.title = 'Wartezeit dazwischen. Minus erlaubt Überlappung: -2h';
      lag.onchange = () => {
        const neg = lag.value.trim().startsWith('-');
        const m = parseDuration(lag.value.replace('-', ''));
        send({ type: 'setDepField', id: d.id, field: 'lag', value: lag.value.trim() === '' ? 0 : (m == null ? d.lag : (neg ? -m : m)) });
      };
      if (d.lag < 0) lag.value = '-' + fmtDuration(-d.lag);

      const x = el('button', 'ins-dep-x', '×');
      x.title = 'Verknüpfung entfernen';
      x.onclick = () => send({ type: 'removeDep', id: d.id });

      r.append(ty, lag, x);
      box.append(r);
    }

    // Neue Verknüpfung: nur Vorgänge anbieten, die noch keine haben.
    const taken = new Set(rows.map((r) => r.other));
    const pick = el('select', 'ins-dep-add');
    pick.append(el('option', null, '+ Verknüpfung zu …'));
    for (const o of store.state.tasks) {
      if (o.id === t.id || taken.has(o.id)) continue;
      const op = el('option', null, o.title);
      op.value = o.id;
      pick.append(op);
    }
    pick.onchange = () => {
      if (!pick.value) return;
      // Vorgänger: der andere kommt VOR diesem. Ringe lehnt der Store mit Namen ab.
      send({ type: 'addDep', dep: { from: pick.value, to: t.id, type: 'FS', lag: 0 } });
      pick.selectedIndex = 0;
    };
    box.append(pick);
    return box;
  }

  function addTaskTo(gewerkId) {
    const S = store.state;
    const last = S.tasks.filter((t) => t.gewerk === gewerkId)
      .sort((a, b) => toMin(a.end) - toMin(b.end)).pop();
    const ph = (S.phases || []).find((p) => /aufbau|load.?in/i.test(p.name));
    const start = last ? last.end : toInput(ph ? ph.start : S.project.start);
    const r = send({ type: 'addTask', task: { gewerk: gewerkId, title: 'Neuer Vorgang', start, end: local(toDate(toMin(start) + 120)) } });
    if (r && r.id) show({ kind: 'task', id: r.id });
  }

  // ── Bausteine ─────────────────────────────────────────────────────────────
  function field(label, node, hint) {
    const w = el('label', 'ins-f');
    w.append(el('span', 'ins-l', label), node);
    if (hint) w.append(el('span', 'ins-hint', hint));
    return w;
  }
  function text(value, commit) {
    const i = el('input');
    i.value = value;
    i.onchange = () => { if (i.value.trim()) commit(i.value.trim()); };
    return i;
  }

  return { show, render, get selection() { return sel; }, addTaskTo };
}
