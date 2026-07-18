// ── Tabellen-Editor ───────────────────────────────────────────────────────────
// Der schnelle Weg rein. Tippen schlägt Ziehen, wenn 40 Vorgänge erstmalig
// anzulegen sind.
//
// Enter = neue Zeile darunter · Tab = nächstes Feld · ⌫ auf leerem Namen = weg.
// Dauer als Kurzform («4h», «2t», «90m») — das Ende rechnet sich; das Ende
// bearbeiten rechnet die Dauer zurück.

import { parseDuration, fmtDuration, local } from './conflicts.js';
import { toMin, toDate, byStart } from './schedule.js';
import { gewerkVar, gewerkTexture } from './palette.js';
import { el, toInput, STATUS } from './dom.js';

export function createTable(root, { store, onConflicts } = {}) {
  root.classList.add('tb');
  let conflicts = new Map();
  // Eingeklappte Elternvorgänge (deren Untervorgänge verborgen sind). Tabellen-
  // eigener Anzeige-Zustand — kein Store-Belang, überlebt das render() hier.
  const collapsed = new Set();

  function render() {
    const S = store.state;
    const scrollTop = root.scrollTop;
    root.replaceChildren();

    const table = el('table', 'tb-t');
    const thead = el('thead');
    const hr = el('tr');
    for (const [label, cls] of [['Gewerk', 'c-gw'], ['Vorgang', 'c-title'], ['Start', 'c-start'],
      ['Dauer', 'c-dur'], ['Ende', 'c-end'], ['Crew', 'c-crew'], ['Status', 'c-st'], ['', 'c-act']]) {
      hr.append(el('th', cls, label));
    }
    thead.append(hr);
    table.append(thead);

    const tbody = el('tbody');
    const gewerke = [...S.gewerke].sort((a, b) => a.sort - b.sort);

    for (const g of gewerke) {
      const all = S.tasks.filter((t) => t.gewerk === g.id);
      const tops = all.filter((t) => t.parent == null).sort(byStart);
      const kidsOf = (id) => all.filter((t) => t.parent === id).sort(byStart);

      // Gruppenkopf — ziehbar zum Umsortieren (data-gewerk + Griff)
      const gr = el('tr', 'tb-group');
      gr.dataset.gewerk = g.id;
      const gc = el('td');
      gc.colSpan = 8;
      const grip = el('span', 'tb-drag', '⠿');
      grip.title = 'Ziehen, um das Gewerk umzusortieren';
      grip.setAttribute('aria-hidden', 'true');
      const dot = el('span', 'bz-dot');
      dot.style.setProperty('--gw', gewerkVar(g.slot));
      if (gewerkTexture(g.slot)) dot.dataset.tex = '1';
      gc.append(grip, dot, el('span', 'tb-gname', g.name), el('span', 'tb-gcount', all.length + (all.length === 1 ? ' Vorgang' : ' Vorgänge')));
      const add = el('button', 'tb-add', '+ Vorgang');
      add.onclick = () => addRow(g.id, tops[tops.length - 1]);
      gc.append(add);
      gr.append(gc);
      tbody.append(gr);

      // Erst die obersten Vorgänge (nach Start), darunter je Elternvorgang seine
      // Untervorgänge — eingerückt und einklappbar.
      for (const t of tops) {
        const kids = kidsOf(t.id);
        tbody.append(row(t, gewerke, { kids: kids.length }));
        if (kids.length && !collapsed.has(t.id)) {
          for (const k of kids) tbody.append(row(k, gewerke, { child: true }));
        }
      }
      if (!tops.length) {
        const er = el('tr', 'tb-empty');
        const ec = el('td'); ec.colSpan = 8;
        ec.textContent = 'Noch nichts eingetragen.';
        er.append(ec); tbody.append(er);
      }
    }

    // Projekt-Meilensteine
    const proj = S.tasks.filter((t) => t.gewerk === 'projekt').sort(byStart);
    if (proj.length) {
      const gr = el('tr', 'tb-group');
      const gc = el('td'); gc.colSpan = 8;
      gc.append(el('span', 'tb-gname', 'Zieltermine'));
      gr.append(gc); tbody.append(gr);
      for (const t of proj) tbody.append(row(t, gewerke));
    }

    table.append(tbody);
    root.append(table);
    root.scrollTop = scrollTop;
  }

  function row(t, gewerke, opts = {}) {
    const { kids = 0, child = false } = opts;
    const isParent = kids > 0;                 // Sammelvorgang mit Untervorgängen
    const tr = el('tr', 'tb-r');
    tr.dataset.id = t.id;
    if (child) tr.classList.add('is-child');
    if (isParent) tr.classList.add('is-parent');
    const conf = conflicts.get(t.id);
    if (conf) tr.classList.add('is-conflict');
    if (t.milestone) tr.classList.add('is-ms');

    // ── Gewerk ──
    const gw = el('td', 'c-gw');
    if (child) {
      // Ein Untervorgang erbt das Gewerk des Elternvorgangs — keine Auswahl,
      // nur eine Einrückungsmarke.
      gw.append(el('span', 'tb-submark', '↳'));
    } else if (t.gewerk === 'projekt') {
      gw.append(el('span', 'tb-fixed', 'Projekt'));
    } else {
      const sel = el('select');
      for (const g of gewerke) {
        const o = el('option', null, g.name);
        o.value = g.id;
        if (g.id === t.gewerk) o.selected = true;
        sel.append(o);
      }
      sel.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'gewerk', value: sel.value });
      gw.append(sel);
    }
    tr.append(gw);

    // ── Vorgang ──
    const ti = el('td', 'c-title');
    // Elternvorgang: Ein-/Ausklapp-Pfeil vor dem Namen.
    if (isParent) {
      const tog = el('button', 'tb-tog', collapsed.has(t.id) ? '▸' : '▾');
      tog.title = collapsed.has(t.id) ? 'Untervorgänge zeigen' : 'Untervorgänge einklappen';
      tog.setAttribute('aria-label', tog.title);
      tog.onclick = () => { collapsed.has(t.id) ? collapsed.delete(t.id) : collapsed.add(t.id); render(); };
      ti.append(tog);
    }
    const tin = el('input');
    tin.value = t.title;
    tin.setAttribute('aria-label', 'Vorgangsname');
    commitOn(tin, () => {
      const now = cur(t.id);
      if (!now) return;
      const v = tin.value.trim();
      if (v === now.title) return;
      if (!v) { tin.value = now.title; return; }
      send({ type: 'setTaskField', id: t.id, field: 'title', value: v });
    });
    tin.onkeydown = (e) => {
      // Enter legt die nächste Zeile auf DERSELBEN Ebene an: unter einem Kind ein
      // Geschwister-Kind, sonst einen normalen Vorgang.
      if (e.key === 'Enter') {
        e.preventDefault(); tin.blur();
        if (child) addSub(t.parent, t); else addRow(t.gewerk, t);
      }
      if (e.key === 'Backspace' && !tin.value && t.gewerk !== 'projekt') {
        e.preventDefault();
        send({ type: 'removeTask', id: t.id });
      }
    };
    ti.append(tin);
    if (conf) {
      const w = el('span', 'tb-conf', conf.message);
      ti.append(w);
    }
    tr.append(ti);

    // ── Start ──
    const st = el('td', 'c-start');
    const sin = el('input');
    sin.type = 'datetime-local';
    sin.value = toInput(t.start);
    sin.setAttribute('aria-label', 'Start');
    // Sammelvorgang: Start/Dauer/Ende sind die Hülle der Untervorgänge — nur lesen.
    if (isParent) { sin.disabled = true; sin.title = 'Ergibt sich aus den Untervorgängen'; }
    commitOn(sin, () => {
      const now = cur(t.id);
      if (!now || !sin.value || sin.value === toInput(now.start)) return;
      const dur = toMin(now.end) - toMin(now.start);   // Dauer beibehalten
      const a = toMin(sin.value);
      send({ type: 'moveTask', id: t.id, start: sin.value, end: local(toDate(a + dur)) });
    });
    st.append(sin);
    tr.append(st);

    // ── Dauer ──
    const du = el('td', 'c-dur');
    const din = el('input', 'tb-dur');
    const durMin = toMin(t.end) - toMin(t.start);
    din.value = fmtDuration(durMin);
    din.placeholder = '4h';
    din.setAttribute('aria-label', 'Dauer');
    if (t.milestone || isParent) din.disabled = true;
    commitOn(din, () => {
      const now = cur(t.id);
      if (!now) return;
      const real = toMin(now.end) - toMin(now.start);
      const m = parseDuration(din.value);
      if (m == null || m === 0) {
        din.value = fmtDuration(real);
        din.classList.add('is-bad');
        setTimeout(() => din.classList.remove('is-bad'), 900);
        return;
      }
      if (m === real) return;
      send({ type: 'setTaskField', id: t.id, field: 'end', value: local(toDate(toMin(now.start) + m)) });
    });
    du.append(din);
    tr.append(du);

    // ── Ende ──
    const en = el('td', 'c-end');
    const ein = el('input');
    ein.type = 'datetime-local';
    ein.value = toInput(t.end);
    ein.setAttribute('aria-label', 'Ende');
    if (t.milestone || isParent) { ein.disabled = true; if (isParent) ein.title = 'Ergibt sich aus den Untervorgängen'; }
    commitOn(ein, () => {
      const now = cur(t.id);
      if (!now || !ein.value || ein.value === toInput(now.end)) return;
      send({ type: 'setTaskField', id: t.id, field: 'end', value: ein.value });
    });
    en.append(ein);
    tr.append(en);

    // ── Crew ──
    const cr = el('td', 'c-crew');
    const cin = el('input');
    cin.type = 'number';
    cin.min = '0';
    cin.value = t.crew ?? '';
    cin.setAttribute('aria-label', 'Crew');
    commitOn(cin, () => {
      const now = cur(t.id);
      if (!now) return;
      const v = cin.value === '' ? null : Math.max(0, parseInt(cin.value, 10) || 0);
      if (v === now.crew) return;
      send({ type: 'setTaskField', id: t.id, field: 'crew', value: v });
    });
    cr.append(cin);
    tr.append(cr);

    // ── Status ──
    const stt = el('td', 'c-st');
    const ssel = el('select');
    for (const [v, label] of STATUS) {
      const o = el('option', null, label);
      o.value = v;
      if (v === t.status) o.selected = true;
      ssel.append(o);
    }
    ssel.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'status', value: ssel.value });
    stt.append(ssel);
    tr.append(stt);

    // ── Aktionen ──
    const ac = el('td', 'c-act');
    const msb = el('button', 'tb-ico' + (t.milestone ? ' is-on' : ''), '◆');
    // Ein Sammelvorgang hat eine abgeleitete Dauer und kann keine Raute sein.
    if (isParent) { msb.disabled = true; msb.title = 'Ein Vorgang mit Untervorgängen ist kein Meilenstein'; }
    else msb.title = t.milestone ? 'In einen Vorgang zurückverwandeln' : 'In einen Meilenstein verwandeln';
    msb.onclick = () => {
      if (t.milestone) {
        // Meilenstein → Vorgang: Dauer 0 wäre ungültig, also 2h vorgeben.
        send({ type: 'batch', label: 'Meilenstein aufheben', cmds: [
          { type: 'setTaskField', id: t.id, field: 'end', value: local(toDate(toMin(t.start) + 120)) },
          { type: 'setTaskField', id: t.id, field: 'milestone', value: false },
        ] });
      } else {
        send({ type: 'batch', label: 'Zu Meilenstein', cmds: [
          { type: 'setTaskField', id: t.id, field: 'end', value: t.start },
          { type: 'setTaskField', id: t.id, field: 'milestone', value: true },
        ] });
      }
    };
    const del = el('button', 'tb-ico tb-del', '×');
    del.title = isParent ? 'Vorgang samt Untervorgängen löschen' : 'Vorgang löschen';
    del.onclick = () => send({ type: 'removeTask', id: t.id });
    // „+ Untervorgang" nur auf oberster Ebene (eine Ebene) und nicht bei Zielterminen.
    if (!child && t.gewerk !== 'projekt') {
      const sub = el('button', 'tb-ico tb-subadd', '＋↳');
      sub.title = 'Untervorgang hinzufügen';
      sub.setAttribute('aria-label', 'Untervorgang hinzufügen');
      sub.onclick = () => addSub(t.id, kidsOfLast(t.id));
      ac.append(sub);
    }
    ac.append(msb, del);
    tr.append(ac);

    return tr;
  }

  // Neuen Untervorgang unter `parentId` anlegen: schließt zeitlich an den letzten
  // vorhandenen Untervorgang an (sonst an den Elternstart), 2h Vorgabe. Vor dem
  // Anlegen aufklappen, damit das neue Kind sichtbar ist.
  function addSub(parentId, after) {
    const S = store.state;
    const p = S.tasks.find((t) => t.id === parentId);
    if (!p) return;
    const start = after ? after.end : p.start;
    collapsed.delete(parentId);
    const r = send({
      type: 'addTask',
      task: { gewerk: p.gewerk, parent: parentId, title: 'Untervorgang', start, end: local(toDate(toMin(start) + 120)) },
    });
    if (r && r.id) {
      requestAnimationFrame(() => {
        const inp = root.querySelector(`tr[data-id="${r.id}"] .c-title input`);
        if (inp) { inp.focus(); inp.select(); }
      });
    }
  }

  // Der letzte Untervorgang eines Elternteils (nach Start), an den angeschlossen wird.
  const kidsOfLast = (parentId) =>
    store.state.tasks.filter((t) => t.parent === parentId).sort(byStart).pop();

  // Neue Zeile unter dem letzten Vorgang des Gewerks: schließt zeitlich an,
  // 2h Vorgabe. So tippt man eine Kette runter, ohne Daten einzugeben.
  function addRow(gewerkId, after) {
    if (gewerkId === 'projekt') gewerkId = store.state.gewerke[0] && store.state.gewerke[0].id;
    if (!gewerkId) return;
    const start = after ? after.end : defaultStart();
    const r = send({
      type: 'addTask',
      task: { gewerk: gewerkId, title: 'Neuer Vorgang', start, end: local(toDate(toMin(start) + 120)) },
    });
    if (r && r.id) {
      requestAnimationFrame(() => {
        const inp = root.querySelector(`tr[data-id="${r.id}"] .c-title input`);
        if (inp) { inp.focus(); inp.select(); }
      });
    }
  }

  function defaultStart() {
    const S = store.state;
    const ph = (S.phases || []).find((p) => /aufbau|load/i.test(p.name));
    return toInput(ph ? ph.start : S.project.start);
  }

  let lastError = null;
  function send(cmd) {
    const r = store.apply(cmd);
    if (r && r.ok === false) {
      lastError = r.error;
      if (onConflicts) onConflicts({ error: r.error });
      render();   // abgelehnt → Felder auf den echten Stand zurücksetzen
    }
    return r;
  }

  // NUR 'change', nicht zusätzlich 'blur'. 'change' feuert bei einem Textfeld
  // ohnehin erst beim Verlassen mit geändertem Wert — 'blur' war nicht nur
  // überflüssig, sondern schädlich: das erste 'change' baut die Tabelle neu,
  // der alte Knoten wird abgehängt und feuert DANACH sein 'blur'. Dessen
  // Handler verglich gegen das inzwischen veraltete Aufgabenobjekt aus der
  // Closure und schickte denselben Befehl ein zweites Mal — jede Änderung lag
  // doppelt auf dem Undo-Stapel, ⌘Z wirkte kaputt.
  function commitOn(input, fn) {
    input.addEventListener('change', fn);
  }

  // Immer den aktuellen Stand aus dem Store lesen, nie den aus der Closure.
  // Der Knoten kann längst abgehängt sein, wenn sein Ereignis eintrifft.
  const cur = (id) => store.state.tasks.find((x) => x.id === id);

  // ── Gewerke per Drag umsortieren (nur Gruppenköpfe) ──────────────────────────
  // Delegation auf root, damit die Handler ein render() überleben. Während des
  // Ziehens ändert sich der Store NICHT → kein Re-Render, die Knoten bleiben
  // stabil. Erst beim Loslassen geht EIN moveGewerk raus; der Store renummeriert
  // sort (slot/Farbe bleibt) und die Tabelle zeichnet sich in neuer Reihenfolge.
  let drag = null;   // { id }
  const groupRows = () => [...root.querySelectorAll('tr.tb-group[data-gewerk]')];
  const clearMarks = () => root.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-end')
    .forEach((n) => n.classList.remove('is-dragging', 'is-drop-before', 'is-drop-end'));
  // Zielposition unter dem Zeiger: vor das erste Gewerk, dessen Mitte unter der
  // Zeigerhöhe liegt — sonst ans Ende (null).
  const dropBeforeAt = (clientY) => {
    for (const gr of groupRows()) {
      const r = gr.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return gr.dataset.gewerk;
    }
    return null;
  };
  const endDrag = () => { drag = null; clearMarks(); };

  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const handle = e.target.closest('.tb-drag');
    if (!handle) return;
    const gr = handle.closest('tr.tb-group[data-gewerk]');
    if (!gr) return;
    e.preventDefault();
    drag = { id: gr.dataset.gewerk };
    gr.classList.add('is-dragging');
    try { root.setPointerCapture(e.pointerId); } catch (_) { /* egal */ }
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const before = dropBeforeAt(e.clientY);
    root.querySelectorAll('.is-drop-before, .is-drop-end')
      .forEach((n) => n.classList.remove('is-drop-before', 'is-drop-end'));
    if (before) root.querySelector(`tr.tb-group[data-gewerk="${before}"]`)?.classList.add('is-drop-before');
    else groupRows().pop()?.classList.add('is-drop-end');
  });
  root.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const id = drag.id;
    const before = dropBeforeAt(e.clientY);
    endDrag();
    try { root.releasePointerCapture(e.pointerId); } catch (_) { /* egal */ }
    // Nur schicken, wenn es die Reihenfolge wirklich ändert — sonst gäbe der
    // Store ein „Steht schon dort." zurück und würde als Fehler getoastet.
    const list = [...store.state.gewerke].sort((a, b) => a.sort - b.sort).map((g) => g.id);
    const curBefore = list[list.indexOf(id) + 1] ?? null;
    if (before !== id && before !== curBefore) send({ type: 'moveGewerk', id, before });
  });
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') endDrag(); });

  return {
    render,
    setConflicts(list) { conflicts = new Map(list.map((c) => [c.taskId, c])); },
    get lastError() { return lastError; },
    focusFirst() {
      const i = root.querySelector('.c-title input');
      if (i) i.focus();
    },
  };
}
