// ── Seitenpanel ───────────────────────────────────────────────────────────────
// Klick auf einen Balken oder eine Zeile links → hier stehen alle Felder.
// Bewusst der Weg für PRÄZISES Bearbeiten; das Schnelle läuft übers
// Rechtsklick-Menü und Doppelklick.

import { parseDuration, fmtDuration, local, mitUhrzeit } from './conflicts.js';
import { toMin, toDate, computeSchedule, candidateGroups } from './schedule.js';
import { gewerkVar, gewerkTexture, hueVon, slotAus, HUES, MAX_SLOTS } from './palette.js';
import { artOf, abschnittOf, ABSCHNITTE } from './ebene.js';
import { fmtFloat } from './timeaxis.js';
import { el, toInput, STATUS } from './dom.js';
import { ressourcen, resKind, deckung, RES_KINDS } from './resources.js';

const DEP_TYPES = [
  ['FS', 'Ende → Start'], ['SS', 'Start → Start'],
  ['FF', 'Ende → Ende'], ['SF', 'Start → Ende'],
];

// Der Inspector entscheidet über seinen INHALT, nie über seine Sichtbarkeit.
// Vorher schrieben vier Stellen an #ins.hidden — zwei hier, zwei in app.js —
// und render() kannte die Ansicht nicht. Jede Änderung holte das Panel in der
// Tabellen-Ansicht zurück. Ein Zustand, ein Besitzer: app.js.
export function createInspector(root, { store, onError, onClose, onConfirm, openNeuFragen } = {}) {
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
    const KIND = { gewerk: 'Gewerk', dep: 'Verknüpfung', task: 'Vorgang' };
    head.append(el('span', 'ins-kind', KIND[sel.kind] || 'Vorgang'));
    const close = el('button', 'ins-x', '×');
    close.title = 'Panel schließen';
    close.onclick = () => { sel = null; render(); if (onClose) onClose(); };
    head.append(close);
    root.append(head);

    if (sel.kind === 'gewerk') renderGewerk();
    else if (sel.kind === 'dep') renderDep();
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
    del.onclick = async () => {
      const msg = tasks.length
        ? `«${g.name}» löschen? ${tasks.length} ${tasks.length === 1 ? 'Vorgang geht' : 'Vorgänge gehen'} mit, samt Verknüpfungen. ⌘Z holt alles zurück.`
        : `«${g.name}» löschen?`;
      const ok = await onConfirm({
        title: 'Gewerk löschen?', message: [msg],
        buttons: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, danger: true }],
      });
      if (!ok) return;
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

    if (!isProj && !t.milestone) {
      // Bereitstellung: dieser Vorgang BIETET seine Zuweisungen an, statt sie
      // zu brauchen — der Pool, aus dem andere ihre Zuweisung nehmen («10
      // Stagehands, 08:00–22:00»). Nimmt keine Verknüpfung an (Store-Regel).
      const bw = el('label', 'ins-check');
      const bc = el('input');
      bc.type = 'checkbox';
      bc.checked = !!t.bereitstellung;
      bc.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'bereitstellung', value: bc.checked });
      bw.append(bc, el('span', null, 'Bereitstellung (kein Bedarf, sondern Angebot)'));
      root.append(bw);

      root.append(resBlock(t));
    }

    if (!isProj) {
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

    // ── Farbe (nur Programmpunkte) ──
    // Nur auf einer BÜHNE wählbar. Im Bauzeitenplan gehört die Farbe dem Gewerk,
    // und ihre Reihenfolge ist gerechnet (docs/farbsuche.md): sie maximiert die
    // Unterscheidbarkeit benachbarter Zeilen bei Farbenblindheit. Bei 20 Gewerken
    // untereinander trägt das echte Last — auf einer Bühne stehen selten mehr als
    // zwei, drei Bänder.
    //
    // Der Inspector führt dafür KEINEN eigenen Ebenen-Zustand: ein Programmpunkt
    // liegt per Definition auf einer Bühne, das steht in den Daten.
    const band = store.state.gewerke.find((g) => g.id === t.gewerk);
    if (band && artOf(band) === 'buehne') {
      // Setup läuft bis zum Showstart, Show danach — zwei Abläufe auf DERSELBEN
      // Bühne. Deshalb hängt der Abschnitt am Eintrag, nicht am Band.
      const asel = el('select');
      for (const [v, label] of ABSCHNITTE) {
        const o = el('option', null, label);
        o.value = v;
        if (v === abschnittOf(t)) o.selected = true;
        asel.append(o);
      }
      asel.onchange = () => send({ type: 'setTaskField', id: t.id, field: 'abschnitt', value: asel.value });
      root.append(field('Abschnitt', asel,
        'Jede Ansicht hat ihre eigene Zeitachse — Setup den Morgen, Show den Abend.'));

      root.append(field('Farbe', farbwahl(t, band)));

      // Der Soundcheck gehört zu DIESEM Eintrag, ist aber ein eigener
      // Zeiteintrag im Setup — nur so bekommt er einen Balken, und nur ein
      // Balken zeigt, ob sich zwei Soundchecks überschneiden. Hier steht der
      // bequeme Weg dorthin; in der Setup-Liste steht er wie jeder andere.
      if (abschnittOf(t) !== 'setup') root.append(field('Soundcheck', soundcheck(t)));
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
  /**
   * Typ, Versatz und Entfernen einer Verknüpfung — die drei Bedienelemente, die
   * in der Liste am Vorgang UND im Panel einer angeklickten Verknüpfung stehen.
   * Eine Quelle: zwei Stellen, die dieselben Felder schreiben, laufen
   * auseinander, sobald eine von beiden angefasst wird.
   * @returns {HTMLElement[]}
   */
  function depControls(d) {
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

    return [ty, lag, x];
  }

  // ── Verknüpfung (im Gantt auf den Pfeil geklickt) ─────────────────────────
  function renderDep() {
    const d = store.state.deps.find((x) => x.id === sel.id);
    // Nach dem Entfernen darf kein totes Panel stehen bleiben — dieselbe Wache
    // wie bei einem gelöschten Gewerk.
    if (!d) { sel = null; if (onClose) onClose(); return; }
    const from = cur(d.from), to = cur(d.to);

    const box = el('div', 'ins-deps');
    const r = el('div', 'ins-dep');
    r.append(el('span', 'ins-dep-d', 'von'));
    r.append(el('span', 'ins-dep-n', from ? from.title : d.from));
    box.append(r);
    const r2 = el('div', 'ins-dep');
    r2.append(el('span', 'ins-dep-d', '→ nach'));
    r2.append(el('span', 'ins-dep-n', to ? to.title : d.to));
    r2.append(...depControls(d));
    box.append(r2);
    root.append(box);
    root.append(el('div', 'ins-hint', 'Entf entfernt die Verknüpfung. Die Zeiten der beiden Vorgänge ändert sie nie — sie sagt nur, was auf was folgt.'));
  }

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
      r.append(...depControls(d));
      box.append(r);
    }

    // Neue Verknüpfung: Suchfeld + gefilterte, gruppierte Trefferliste. Bei 100+
    // Vorgängen schlägt Tippen das Scrollen durch einen endlosen Dropdown. Die
    // Sortier-/Filterlogik ist rein (candidateGroups) und getestet; hier nur DOM.
    const combo = el('div', 'ins-combo');
    const search = el('input', 'ins-dep-search');
    search.type = 'text';
    search.placeholder = '+ Verknüpfung suchen …';
    search.setAttribute('aria-label', 'Vorgang zum Verknüpfen suchen');
    const list = el('div', 'ins-dep-list');
    list.hidden = true;
    combo.append(search, list);

    let flat = [];      // sichtbare Treffer in Anzeigereihenfolge (für ↑↓)
    let active = -1;
    const setActive = (i) => {
      if (flat[active]) flat[active].classList.remove('is-active');
      active = i;
      if (flat[active]) { flat[active].classList.add('is-active'); flat[active].scrollIntoView({ block: 'nearest' }); }
    };
    // Vorgänger: der andere kommt VOR diesem. Ringe lehnt der Store mit Namen ab.
    // Nach dem Anlegen baut render() den Inspector neu → das Feld ist wieder leer.
    const pickId = (id) => { if (id) send({ type: 'addDep', dep: { from: id, to: t.id, type: 'FS', lag: 0 } }); };
    const fmtWhen = (iso) => {
      const d = toDate(toMin(iso));
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '. ' + p(d.getHours()) + ':' + p(d.getMinutes());
    };

    const paint = () => {
      const groups = candidateGroups({
        tasks: store.state.tasks, gewerke: store.state.gewerke,
        deps: store.state.deps, selfId: t.id, query: search.value,
      });
      list.replaceChildren();
      flat = []; active = -1;
      if (!groups.length) { list.append(el('div', 'ins-dep-none', 'Nichts gefunden.')); return; }
      for (const { gewerk, items } of groups) {
        list.append(el('div', 'ins-dep-grp', gewerk.name));
        for (const o of items) {
          const opt = el('div', 'ins-dep-opt');
          opt.dataset.id = o.id;
          const dot = el('span', 'bz-dot');
          if (gewerk.slot != null) { dot.style.setProperty('--gw', gewerkVar(gewerk.slot)); if (gewerkTexture(gewerk.slot)) dot.dataset.tex = '1'; }
          const tx = el('div', 'ins-dep-opt-tx');
          tx.append(el('div', 'ins-dep-opt-n', o.title), el('div', 'ins-dep-opt-c', gewerk.name + ' · ' + fmtWhen(o.start)));
          opt.append(dot, tx);
          const idx = flat.length;
          opt.onmouseenter = () => setActive(idx);
          // mousedown (nicht click): feuert VOR dem blur des Feldes, das die Liste schließt.
          opt.onmousedown = (e) => { e.preventDefault(); pickId(o.id); };
          flat.push(opt);
          list.append(opt);
        }
      }
    };

    search.onfocus = () => { list.hidden = false; paint(); };
    search.oninput = () => { list.hidden = false; paint(); };
    search.onblur = () => { setTimeout(() => { list.hidden = true; }, 120); };
    search.onkeydown = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (flat.length) setActive((active + 1) % flat.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (flat.length) setActive((active - 1 + flat.length) % flat.length); }
      else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) pickId(flat[active].dataset.id); }
      else if (e.key === 'Escape') { e.stopPropagation(); if (search.value) { search.value = ''; paint(); } else { list.hidden = true; search.blur(); } }
    };
    box.append(combo);
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
  /**
   * Zehn Farbpunkte, ein Schalter für Schraffur, ein Weg zurück.
   *
   * Ein Farbplatz IST das Paar (Farbton, Schraffur) — deshalb reichen zehn
   * Punkte und ein Häkchen, um alle zwanzig zu erreichen (slotAus in palette.js).
   * Gewählt wird AUS der Palette; keine Farbe wird umdefiniert.
   */
  /**
   * Start und Dauer des Soundchecks, der zu diesem Eintrag gehört.
   * Es gibt keinen? Dann ein Knopf, der einen anlegt — eine Stunde vor dem Act,
   * 60 min lang, im Setup-Abschnitt. Alles über den Store, also mit ⌘Z.
   */
  function soundcheck(t) {
    const box = el('div', 'ins-sc');
    const sc = store.state.tasks.find((x) => x.fuer === t.id);

    if (!sc) {
      const add = el('button', 'btn', '+ Soundcheck');
      add.type = 'button';
      add.onclick = () => {
        // Vorgabe: an den letzten Setup-Eintrag DESSELBEN TAGES anschließen,
        // sonst 08:00. Ein Soundcheck läuft am Nachmittag, nicht eine Stunde vor
        // dem Auftritt — genau das kam heraus, als die Vorgabe am Act hing.
        // Dieselbe Regel wie beim «+ Zeiteintrag» in der Tabelle.
        const tag = String(t.start).slice(0, 10);
        const vorher = store.state.tasks
          .filter((x) => x.gewerk === t.gewerk && abschnittOf(x) === 'setup'
            && String(x.start).slice(0, 10) === tag)
          .sort((a, b) => toMin(a.start) - toMin(b.start)).pop();
        const start = vorher ? vorher.end : tag + 'T08:00';
        send({ type: 'addTask', task: {
          gewerk: t.gewerk, title: 'Soundcheck ' + t.title,
          start, end: local(toDate(toMin(start) + 60)),
          abschnitt: 'setup', fuer: t.id,
        } });
      };
      box.append(add, el('div', 'ins-hint',
        'Wird ein eigener Zeiteintrag im Setup — mit Balken, damit du siehst, ob sich zwei überschneiden.'));
      return box;
    }

    const zeile = el('div', 'ins-row');
    const zeit = el('input');
    zeit.type = 'time';
    zeit.value = String(sc.start).slice(11, 16);
    zeit.setAttribute('aria-label', 'Soundcheck-Beginn');
    zeit.onchange = () => {
      const jetzt = store.state.tasks.find((x) => x.id === sc.id);
      if (!jetzt || !zeit.value) return;
      const start = mitUhrzeit(jetzt.start, zeit.value);
      if (!start || start === jetzt.start) return;
      const dauer = toMin(jetzt.end) - toMin(jetzt.start);
      send({ type: 'moveTask', id: sc.id, start, end: local(toDate(toMin(start) + dauer)) });
    };

    const dauer = el('input');
    dauer.value = fmtDuration(toMin(sc.end) - toMin(sc.start));
    dauer.placeholder = '60m';
    dauer.setAttribute('aria-label', 'Soundcheck-Dauer');
    dauer.onchange = () => {
      const jetzt = store.state.tasks.find((x) => x.id === sc.id);
      if (!jetzt) return;
      const m = parseDuration(dauer.value);
      if (m == null || m === 0) { dauer.value = fmtDuration(toMin(jetzt.end) - toMin(jetzt.start)); return; }
      send({ type: 'setTaskField', id: sc.id, field: 'end', value: local(toDate(toMin(jetzt.start) + m)) });
    };
    zeile.append(zeit, dauer);
    box.append(zeile);

    const weg = el('button', 'btn btn-danger', 'Soundcheck entfernen');
    weg.type = 'button';
    weg.onclick = () => send({ type: 'removeTask', id: sc.id });
    box.append(weg);
    return box;
  }

  function farbwahl(t, band) {
    const box = el('div', 'ins-farbe');
    const eigen = t.slot != null;
    const aktiv = eigen ? t.slot : band.slot;
    const setz = (slot) => send({ type: 'setTaskField', id: t.id, field: 'slot', value: slot });

    const toene = el('div', 'ins-toene');
    for (let h = 0; h < HUES; h++) {
      const b = el('button', 'ins-ton');
      b.type = 'button';
      b.style.setProperty('--gw', gewerkVar(h));
      // Die Schraffur des aktuellen Standes mitzeigen, damit der Punkt aussieht
      // wie der Balken, den er setzt.
      if (gewerkTexture(aktiv)) b.dataset.tex = '1';
      const gewaehlt = eigen && hueVon(aktiv) === h;
      b.setAttribute('aria-pressed', String(gewaehlt));
      b.classList.toggle('is-on', gewaehlt);
      b.title = 'Farbton ' + (h + 1) + ' von ' + HUES;
      b.setAttribute('aria-label', b.title);
      b.onclick = () => setz(slotAus(h, gewerkTexture(aktiv)));
      toene.append(b);
    }
    box.append(toene);

    const zeile = el('div', 'ins-farbe-r');
    const tex = el('label', 'ins-tex');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = gewerkTexture(aktiv);
    cb.onchange = () => setz(slotAus(hueVon(aktiv), cb.checked));
    tex.append(cb, el('span', null, 'Schraffur'));
    zeile.append(tex);

    const zurueck = el('button', 'btn ins-farbe-x', 'wie Bühne');
    zurueck.type = 'button';
    zurueck.title = 'Eigene Farbe aufheben — der Punkt erbt wieder die Farbe von «' + band.name + '»';
    zurueck.disabled = !eigen;
    zurueck.onclick = () => setz(null);
    zeile.append(zurueck);
    box.append(zeile);

    if (!eigen) box.append(el('div', 'ins-hint', 'Erbt die Farbe von «' + band.name + '». Ein Klick auf einen Ton gibt dem Punkt eine eigene.'));
    return box;
  }

  // ── Personal & Maschinen ──────────────────────────────────────────────────
  // Beliebig viele Zuweisungen {Bezeichnung, Anzahl, Zeitfenster}. Läuft
  // ausschließlich über setTaskRes (setTaskField lehnt das Feld `res` ab) —
  // die Prüfung von Anzahl und Zeitfenster steckt dort im Store.
  const NEUE_RES = '__neu__';

  function resBlock(t) {
    const box = el('div', 'ins-res');
    box.append(el('div', 'ins-l', 'Personal & Maschinen'));

    (t.res || []).forEach((z, idx) => box.append(resRow(t, z, idx)));

    const addBtn = (kind, label) => {
      const b = el('button', 'btn ins-res-add', label);
      b.onclick = () => {
        const vorhanden = ressourcen(store.state, kind);
        if (!vorhanden.length) {
          // Eigener App-Kasten statt window.prompt — der schwebt über der
          // Tabelle, table.js besitzt ihn, hier nur über openNeuFragen geliehen.
          openNeuFragen({
            titel: 'Neue Bezeichnung (' + (kind === 'personal' ? 'Personal' : 'Maschine') + ')',
            cmd: { type: 'addRessource', kind },
          }, b, (rid) => {
            send({ type: 'setTaskRes', id: t.id, index: null, value: { rid, n: 1, von: null, bis: null } });
          });
          return;
        }
        send({ type: 'setTaskRes', id: t.id, index: null, value: { rid: vorhanden[0].id, n: 1, von: null, bis: null } });
      };
      return b;
    };
    const addRow = el('div', 'ins-res-add-row');
    for (const [k, wort] of RES_KINDS) addRow.append(addBtn(k, '+ ' + wort));
    box.append(addRow);

    // Deckungslücke: nur, solange der Vorgang überhaupt eine Zuweisung dieser
    // Art hat — ein Vorgang ganz ohne Personal sagt nichts über Personal aus.
    // Für eine Bereitstellung selbst ergibt der Begriff keinen Sinn (sie IST
    // das Angebot).
    if (!t.bereitstellung) {
      for (const [kind, wort] of [['personal', 'Personal'], ['maschine', 'Maschinen']]) {
        const g = deckung(t, kind, store.state);
        if (g && g.luecktMin > 0) {
          const zeit = (m) => local(toDate(m)).slice(11, 16) + ' Uhr';
          const spannen = g.luecken.map(([a, b]) => zeit(a) + '–' + zeit(b)).join(', ');
          // ins-hint geliehen: dieselbe zurückhaltende Optik wie jeder andere
          // Hinweistext im Panel — kein roter Alarm, unbesetzte Zeit ist oft
          // gewollt (Trocknungszeit, Wartezeit).
          box.append(el('div', 'ins-res-luecke ins-hint', fmtDuration(g.luecktMin) + ' ohne ' + wort + ' (' + spannen + ')'));
        }
      }
    }
    return box;
  }

  function resRow(t, z, idx) {
    const row = el('div', 'ins-res-row');
    const kind = resKind(z.rid, store.state);

    const nIn = el('input', 'ins-res-n');
    nIn.type = 'number'; nIn.min = '1'; nIn.value = z.n;
    nIn.setAttribute('aria-label', 'Anzahl');
    nIn.onchange = () => {
      const n = Math.max(1, parseInt(nIn.value, 10) || 1);
      send({ type: 'setTaskRes', id: t.id, index: idx, value: { rid: z.rid, n, von: z.von, bis: z.bis } });
    };
    row.append(nIn, el('span', 'ins-res-x2', '×'));

    const rsel = el('select', 'ins-res-r');
    for (const r of ressourcen(store.state, kind)) {
      const o = el('option', null, r.label);
      o.value = r.id;
      if (r.id === z.rid) o.selected = true;
      rsel.append(o);
    }
    const neu = el('option', null, '+ Neu…');
    neu.value = NEUE_RES;
    rsel.append(neu);
    rsel.onchange = () => {
      if (rsel.value === NEUE_RES) {
        rsel.value = z.rid;   // Auswahl sofort zurückstellen, falls abgebrochen wird
        openNeuFragen({
          titel: 'Neue Bezeichnung (' + (kind === 'personal' ? 'Personal' : 'Maschine') + ')',
          cmd: { type: 'addRessource', kind },
        }, rsel, (id) => {
          send({ type: 'setTaskRes', id: t.id, index: idx, value: { rid: id, n: z.n, von: z.von, bis: z.bis } });
        });
        return;
      }
      send({ type: 'setTaskRes', id: t.id, index: idx, value: { rid: rsel.value, n: z.n, von: z.von, bis: z.bis } });
    };
    row.append(rsel);

    // Zeitfenster: «(ganzer Vorgang)» ist die Vorgabe (von/bis null) — dabei
    // tippt niemand ein Datum. Ein Klick klappt zwei Zeitfelder auf.
    if (z.von == null) {
      const btn = el('button', 'ins-res-zeitbtn', '(ganzer Vorgang)');
      btn.title = 'Eigenes Zeitfenster für diese Zuweisung setzen';
      btn.onclick = () => send({ type: 'setTaskRes', id: t.id, index: idx,
        value: { rid: z.rid, n: z.n, von: t.start, bis: t.end } });
      row.append(btn);
    } else {
      const vIn = el('input'); vIn.type = 'datetime-local'; vIn.value = toInput(z.von);
      const bIn = el('input'); bIn.type = 'datetime-local'; bIn.value = toInput(z.bis);
      const commitZeit = () => send({ type: 'setTaskRes', id: t.id, index: idx,
        value: { rid: z.rid, n: z.n, von: vIn.value, bis: bIn.value } });
      vIn.onchange = commitZeit;
      bIn.onchange = commitZeit;
      const reset = el('button', 'ins-res-zeitreset', '↺');
      reset.title = 'Auf die volle Vorgangsdauer zurücksetzen';
      reset.onclick = () => send({ type: 'setTaskRes', id: t.id, index: idx,
        value: { rid: z.rid, n: z.n, von: null, bis: null } });
      row.append(vIn, el('span', null, '–'), bIn, reset);
    }

    const del = el('button', 'ins-res-x', '×');
    del.title = 'Zuweisung entfernen';
    del.onclick = () => send({ type: 'setTaskRes', id: t.id, index: idx, value: null });
    row.append(del);

    return row;
  }

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
