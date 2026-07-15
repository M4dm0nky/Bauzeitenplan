// ── Einstiegspunkt ────────────────────────────────────────────────────────────
// Hält Store, Ablage und Ansichten zusammen. Bewusst dünn: alles Fachliche liegt
// in store.js (Befehle), schedule.js (Termine), conflicts.js (Konflikte),
// gantt.js (Darstellung) und table.js (Eingabe).

import { createStore } from './store.js';
import { createRepo, serialize, deserialize } from './persistence.js';
import { TEMPLATES, planFromTemplate } from './templates.js';
import { createGantt } from './gantt.js';
import { createTable } from './table.js';
import { findConflicts, resolveConflictsCmd, local } from './conflicts.js';
import { slotsExhausted, MAX_SLOTS } from './palette.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

const repo = createRepo(window.localStorage);
let store = null, gantt = null, table = null, view = 'gantt';

// ── Erststart ───────────────────────────────────────────────────────────────
function boot() {
  const activeId = repo.getActive();
  const plan = activeId && repo.load(activeId);
  if (plan) return open(plan);

  const list = repo.list();
  if (list.length) {
    const first = repo.load(list[0].id);
    if (first) return open(first);
  }
  showProjectDialog({ firstRun: true });
}

function open(plan) {
  if (store) store.replace(plan);
  else {
    store = createStore(plan);
    mount();
  }
  repo.setActive(plan.project.id);
  refreshChrome();
  save();
}

// ── Aufbau ──────────────────────────────────────────────────────────────────
function mount() {
  gantt = createGantt($('bz'), { store, rowH: 24, groupH: 28, barH: 12, sideW: 228, initialZoom: 'tage' });
  table = createTable($('tb'), { store, onConflicts: ({ error }) => toast(error, 'bad') });
  if (gantt.minimapNode) $('mini').append(gantt.minimapNode);

  store.subscribe(() => { refreshChrome(); scheduleSave(); if (view === 'tabelle') renderTable(); });

  // ── Zoom ──
  const segs = [...document.querySelectorAll('[data-z]')];
  const syncSeg = () => segs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.z === gantt.zoomName)));
  segs.forEach((b) => { b.onclick = () => { gantt.setZoomPreset(b.dataset.z); syncSeg(); }; });
  $('zin').onclick = () => { gantt.zoomIn(); syncSeg(); };
  $('zout').onclick = () => { gantt.zoomOut(); syncSeg(); };
  $('now').onclick = () => gantt.goToNow();
  $('bz').addEventListener('wheel', () => requestAnimationFrame(syncSeg), { passive: true });
  $('bz').addEventListener('keyup', syncSeg);
  syncSeg();

  // ── Zuklappen ──
  let folded = false;
  $('fold').onclick = () => {
    folded = !folded;
    folded ? gantt.collapseAll() : gantt.expandAll();
    $('fold').textContent = folded ? 'Alle aufklappen' : 'Alle zuklappen';
  };

  // ── Ansicht ──
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.onclick = () => setView(b.dataset.view);
  });

  // ── Projekt ──
  $('proj-menu').onclick = () => showProjectDialog({});
  $('export').onclick = doExport;
  $('import').onclick = () => $('import-file').click();
  $('import-file').onchange = doImport;
  $('add-gewerk').onclick = addGewerk;
  $('resolve').onclick = () => {
    const cmd = resolveConflictsCmd(store.state);
    if (!cmd.cmds.length) return;
    const r = store.apply(cmd);
    if (r.ok === false) toast(r.error, 'bad');
    else toast(cmd.cmds.length + (cmd.cmds.length === 1 ? ' Vorgang verschoben' : ' Vorgänge verschoben') + ' — ⌘Z nimmt es zurück');
  };

  // ── Tastatur ──
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? store.redo() : store.undo();
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(true);
    }
  });

  // Ungesicherte Änderungen nicht stillschweigend verlieren.
  window.addEventListener('beforeunload', (e) => {
    if (!store || !store.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('bz').hidden = v !== 'gantt';
  $('tb').hidden = v !== 'tabelle';
  document.querySelector('.hd-zoom').hidden = v !== 'gantt';
  if (v === 'tabelle') renderTable();
  else gantt.relayout();
}

function renderTable() {
  table.setConflicts(findConflicts(store.state));
  table.render();
}

// ── Speichern ───────────────────────────────────────────────────────────────
// localStorage hängt am Browser. Bis PocketBase steht, ist der Export die
// einzige echte Sicherung — deshalb der sichtbare Zustand oben rechts.
let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveState('dirty');
  saveTimer = setTimeout(save, 800);
}
function save(loud = false) {
  if (!store) return;
  const r = repo.save(store.state);
  if (r.ok) {
    store.markSaved();
    setSaveState('saved');
    if (loud) toast('Gesichert');
  } else {
    setSaveState('error');
    toast(r.error, 'bad', 8000);
  }
}
function setSaveState(s) {
  const n = $('save-state');
  n.dataset.state = s;
  n.textContent = s === 'saved' ? 'gesichert' : s === 'dirty' ? 'ungesichert …' : 'NICHT gesichert!';
}

// ── Kopfzeile ───────────────────────────────────────────────────────────────
function refreshChrome() {
  const S = store.state;
  $('proj-name').textContent = S.project.name;
  $('proj-venue').textContent = S.project.venue || '';
  document.title = S.project.name + ' — Bauzeitenplan';

  const st = gantt.stats();
  $('kpis').innerHTML = [
    ['Gewerke', st.gewerke],
    ['Vorgänge', st.total],
    ['läuft', st.run],
    ['Crew', st.crew],
    ['kritisch', st.crit],
  ].map(([k, v]) => `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-k">${k}</div></div>`).join('');

  const conf = findConflicts(S);
  const rb = $('resolve');
  rb.hidden = conf.length === 0;
  rb.textContent = conf.length === 1 ? '1 Konflikt auflösen' : conf.length + ' Konflikte auflösen';

  // Legende: Identität hängt nie an der Farbe allein — deshalb Namen, nicht nur Punkte.
  $('legend').innerHTML = [...S.gewerke].sort((a, b) => a.sort - b.sort)
    .map((g) => `<span class="legend-i"><span class="bz-dot" style="--gw:var(--gw-${g.slot % 8})"${g.slot >= 8 ? ' data-tex="1"' : ''}></span>${escapeHtml(g.name)}</span>`)
    .join('');

  $('undo').disabled = !store.canUndo;
  $('redo').disabled = !store.canRedo;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Gewerk anlegen ──────────────────────────────────────────────────────────
function addGewerk() {
  if (slotsExhausted(store.state.gewerke.length + 1)) {
    toast(`Mehr als ${MAX_SLOTS} Gewerke: ab hier trägt die Farbe die Zuordnung nicht mehr, nur noch der Name.`, 'warn', 7000);
  }
  const name = prompt('Name des Gewerks:');
  if (!name) return;
  const r = store.apply({ type: 'addGewerk', gewerk: { name } });
  if (r.ok === false) toast(r.error, 'bad');
}

// ── Export / Import ─────────────────────────────────────────────────────────
function doExport() {
  const blob = new Blob([serialize(store.state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = store.state.project.name.replace(/[^\w\-]+/g, '-').toLowerCase() + '-bauzeitenplan.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exportiert — das ist deine Sicherung, bis das Backend steht.');
}

async function doImport(e) {
  const f = e.target.files[0];
  if (!f) return;
  e.target.value = '';
  const r = deserialize(await f.text(), { newId: true });
  if (r.ok === false) return toast(r.error, 'bad', 8000);
  open(r.plan);
  toast('«' + r.plan.project.name + '» importiert');
}

// ── Projektdialog ───────────────────────────────────────────────────────────
function showProjectDialog({ firstRun = false }) {
  const dlg = $('dlg');
  dlg.replaceChildren();

  const box = el('div', 'dlg-box');
  box.append(el('h2', 'dlg-h', firstRun ? 'Bauzeitenplan' : 'Projekte'));
  if (firstRun) box.append(el('p', 'dlg-sub', 'Leg ein Projekt an — aus einer Vorlage oder leer. Alles bleibt in diesem Browser; sichere regelmäßig per Export.'));

  // Bestehende Projekte
  const list = repo.list();
  if (list.length) {
    box.append(el('h3', 'dlg-h3', 'Öffnen'));
    const ul = el('div', 'dlg-list');
    for (const p of list) {
      const row = el('div', 'dlg-row');
      const b = el('button', 'dlg-open');
      b.append(el('span', 'dlg-open-n', p.name));
      b.append(el('span', 'dlg-open-m', (p.venue ? p.venue + ' · ' : '') + 'geändert ' + new Date(p.modified).toLocaleString('de-DE')));
      b.onclick = () => { const pl = repo.load(p.id); if (pl) { open(pl); close(); } };
      const del = el('button', 'dlg-del', '×');
      del.title = 'Projekt löschen';
      del.onclick = () => {
        if (!confirm(`«${p.name}» endgültig löschen? Das lässt sich nicht rückgängig machen — exportiere vorher, wenn du unsicher bist.`)) return;
        repo.remove(p.id);
        showProjectDialog({ firstRun: repo.list().length === 0 });
      };
      row.append(b, del);
      ul.append(row);
    }
    box.append(ul);
  }

  // Neu anlegen
  box.append(el('h3', 'dlg-h3', 'Neues Projekt'));
  const form = el('div', 'dlg-form');

  const nameIn = el('input');
  nameIn.placeholder = 'z.B. Nordlicht Festival 2026';
  const venueIn = el('input');
  venueIn.placeholder = 'Ort (optional)';
  const dateIn = el('input');
  dateIn.type = 'datetime-local';
  const d = new Date(); d.setDate(d.getDate() + 14); d.setHours(6, 0, 0, 0);
  dateIn.value = local(d);

  form.append(field('Name', nameIn), field('Ort', venueIn), field('Aufbaubeginn', dateIn));
  box.append(form);

  const tpls = el('div', 'dlg-tpl');
  let chosen = 'festival';
  for (const t of TEMPLATES) {
    const b = el('button', 'dlg-t');
    b.dataset.k = t.key;
    b.append(el('span', 'dlg-t-n', t.name), el('span', 'dlg-t-d', t.description));
    b.onclick = () => {
      chosen = t.key;
      tpls.querySelectorAll('.dlg-t').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === chosen)));
    };
    tpls.append(b);
  }
  box.append(tpls);
  tpls.querySelectorAll('.dlg-t').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.k === chosen)));

  const actions = el('div', 'dlg-act');
  const create = el('button', 'btn btn-p', 'Projekt anlegen');
  create.onclick = () => {
    if (!nameIn.value.trim()) { nameIn.focus(); return; }
    if (!dateIn.value) { dateIn.focus(); return; }
    open(planFromTemplate(chosen, { name: nameIn.value.trim(), venue: venueIn.value.trim(), loadIn: dateIn.value }));
    close();
  };
  const imp = el('button', 'btn', 'JSON importieren');
  imp.onclick = () => $('import-file').click();
  actions.append(imp, create);
  if (!firstRun) {
    const cancel = el('button', 'btn', 'Abbrechen');
    cancel.onclick = close;
    actions.prepend(cancel);
  }
  box.append(actions);

  dlg.append(box);
  dlg.hidden = false;
  nameIn.focus();

  function close() { dlg.hidden = true; }
  dlg.onclick = (e) => { if (e.target === dlg && !firstRun) close(); };
}

function field(label, input) {
  const w = el('label', 'dlg-f');
  w.append(el('span', null, label), input);
  return w;
}

// ── Hinweise ────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, kind = 'ok', ms = 4000) {
  const n = $('toast');
  n.textContent = msg;
  n.dataset.kind = kind;
  n.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { n.hidden = true; }, ms);
}

$('undo').onclick = () => store && store.undo();
$('redo').onclick = () => store && store.redo();
$('new-proj').onclick = () => showProjectDialog({});

boot();
