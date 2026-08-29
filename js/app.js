// ── Einstiegspunkt ────────────────────────────────────────────────────────────
// Hält Store, Ablage und Ansichten zusammen. Bewusst dünn: alles Fachliche liegt
// in store.js (Befehle), schedule.js (Termine), conflicts.js (Konflikte),
// gantt.js (Darstellung) und table.js (Eingabe).

import { createStore } from './store.js';
import { createRepo, serialize, deserialize } from './persistence.js';
import { TEMPLATES, planFromTemplate } from './templates.js';
import { createGantt } from './gantt.js';
import { createTable } from './table.js';
import { resolveConflictsCmd, local } from './conflicts.js';
import { slotsExhausted, MAX_SLOTS, gewerkVar, gewerkTexture } from './palette.js';
import { createInspector } from './inspector.js';
import { openMenu } from './menu.js';
import { liveStats, runningAt, nextUp, delaysAt, verschoben, versatzText } from './live.js';
import { sichtGewerke, sichtTasks, typHinweis, programmTage } from './ebene.js';
import { toMin, toDate } from './schedule.js';
import { $, el, escapeHtml } from './dom.js';
import { VERSION } from './version.js';

// Der Speicher wird in main() gesetzt. Bis dahin null — nichts greift vorher
// darauf zu.
let repo = null;
let store = null, gantt = null, table = null, inspector = null, view = 'gantt';

// ── Ansicht ─────────────────────────────────────────────────────────────────
// DREI gleichrangige Ansichten in EINER Leiste, in der Reihenfolge des Tages:
// Bauzeitenplan · Setup · Show. Genau eine ist gedrückt.
//
// Vorher waren es zwei Umschalter — Ebene und Abschnitt — im selben Stil
// nebeneinander, mit je einem dunklen Knopf. Das las sich als eine Leiste, in
// der zwei Dinge gleichzeitig angewählt sind, und man wusste nicht, wie man
// zwischen Setup und Show wechselt.
//
// Das DATENMODELL bleibt zweiteilig (Ebene + Abschnitt, siehe js/ebene.js);
// hier wird nur beides aus einem Zustand abgeleitet:
//
//   bau   → ebene 'bau',  abschnitt 'alle'  (greift dort ohnehin nicht)
//   setup → ebene 'show', abschnitt 'setup'
//   show  → ebene 'show', abschnitt 'show'
//
// EIN Besitzer: setAnsicht() ist der einzige Schreiber. Gantt und Tabelle
// bekommen Ebene UND Abschnitt gereicht, sie entscheiden nichts selbst.
const ANSICHTEN = ['bau', 'setup', 'show'];
let ansicht = 'bau';
// Abgeleitet, nie von Hand gesetzt: setAnsicht() schreibt alle drei zusammen.
let ebene = 'bau';
let abschnitt = 'alle';
const ebeneVon = (a) => (a === 'bau' ? 'bau' : 'show');
const abschnittVon = (a) => (a === 'bau' ? 'alle' : a);

const ausBlend = new Set();   // ausgeblendete Bühnen (nur im Showablauf)
// Der gezeigte Showtag. Eine Running Order ist tagesbezogen: beide Showtage
// nebeneinander ergäben zehn Zeilen ohne Balken — genau die Fehlerart, die in
// diesem Projekt schon dreimal erst auf dem Screenshot aufgefallen ist.
let showTag = null;

const startAnsicht = () => {
  const q = new URLSearchParams(location.search);
  const neu = q.get('ansicht');
  if (ANSICHTEN.includes(neu)) return neu;
  // Die alten Parameter aus v0.8.0–0.9.2 weiter verstehen: sie stehen in
  // Lesezeichen, in CLAUDE.md und in den Prüfwerkzeugen.
  const e = q.get('ebene'), a = q.get('abschnitt');
  if (e === 'bau') return 'bau';
  if (e === 'show') return a === 'setup' ? 'setup' : 'show';
  const gemerkt = localStorage.getItem('bzp_ansicht');
  if (ANSICHTEN.includes(gemerkt)) return gemerkt;
  // Und den gemerkten Stand einer laufenden Sitzung nicht wegwerfen.
  if (localStorage.getItem('bzp_ebene') === 'show') {
    return localStorage.getItem('bzp_abschnitt') === 'setup' ? 'setup' : 'show';
  }
  return 'bau';
};

// ── Mitgelieferte Pläne ─────────────────────────────────────────────────────
// Der Plan liegt als JSON neben der App und wird beim Start automatisch geholt.
// Wer die Adresse aufruft, sieht ihn sofort — kein Import, keine Datei im Anhang.
//
// DIE DATEI IM REPO IST DIE WAHRHEIT. Kommt ein neuer Stand (V08, V09 …), wird
// nur die JSON ausgetauscht und gepusht; jeder Betrachter zieht sie beim nächsten
// Laden von selbst nach. Erkannt wird das am `exported`-Stempel, den serialize()
// mitschreibt: ist der in der Datei neuer als der zuletzt geladene, gewinnt die
// Datei. Sonst bliebe die lokale Kopie ewig stehen und niemand merkte es.
//
// `?plan=leer` überspringt das und zeigt den Projektdialog — für eigene Projekte
// und für die Erststart-Prüfungen (verify-edit, verify-live, verify-amk), die
// genau diesen Dialog brauchen.
const START = 'klassentreffen';
const BUNDLED = {
  klassentreffen: { file: 'klassentreffen-festival.json', name: 'Klassentreffen Festival 2026' },
  amk: { file: 'amk-singleshow.json', name: 'AMK Singleshow' },
};

/**
 * Mitgelieferten Plan öffnen. Die Datei gewinnt, wenn sie neuer ist als die
 * lokale Kopie; sonst wird die lokale geöffnet (die kann Änderungen des
 * Betrachters tragen). Ist die Datei nicht erreichbar — offline, `file://` —
 * bleibt es bei der lokalen Kopie.
 * @returns {Promise<boolean>} ob ein Plan offen ist
 */
async function openBundled(key) {
  const b = BUNDLED[key];
  if (!b) { toast('Unbekannter Plan: ' + key, 'bad', 6000); return false; }
  const da = repo.list().find((p) => p.name === b.name);
  const lokal = da ? repo.load(da.id) : null;

  let datei = null;
  try {
    // ?v= wie in index.html: sonst liefert Pages bis zu zehn Minuten den alten Stand.
    const res = await fetch('./' + b.file + '?v=' + VERSION, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const r = deserialize(text);
    if (r.ok === false) throw new Error(r.error);
    // Den Stempel der Datei mitführen, sonst ist beim nächsten Start nicht
    // feststellbar, welcher Stand hier liegt.
    const roh = JSON.parse(text);
    r.plan.project.quelle = { datei: b.file, version: roh.version || null, exported: roh.exported || null };
    datei = r.plan;
  } catch (e) {
    if (!lokal) { toast('«' + b.name + '» konnte nicht geladen werden: ' + (e.message || e), 'bad', 8000); return false; }
  }

  if (datei && neuer(datei, lokal)) {
    open(datei);
    if (lokal) toast('Neuer Stand geladen: ' + b.name);
    return true;
  }
  if (lokal) { open(lokal); return true; }
  if (datei) { open(datei); return true; }
  return false;
}

// Ist die Datei neuer als die lokale Kopie? Ohne lokale Kopie: ja. Ohne Stempel
// auf einer der beiden Seiten: ja — dann ist die Datei die verlässlichere Quelle.
function neuer(datei, lokal) {
  if (!lokal) return true;
  const a = (datei.project.quelle || {}).exported;
  const b = (lokal.project.quelle || {}).exported;
  if (!a || !b) return true;
  return a > b;
}

// ── Erststart ───────────────────────────────────────────────────────────────
async function boot() {
  const wunsch = new URLSearchParams(location.search).get('plan');
  // Im PocketBase-Modus KEIN Autostart: open() schriebe den mitgelieferten Plan
  // über repo.save() in die Instanz — jeder Anmeldung ein Beispielprojekt.
  // Dort entscheidet die Mitgliedschaft, was jemand sieht, nicht eine Datei.
  if (wunsch !== 'leer' && await openBundled(wunsch || START)) return;

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
  if (store) {
    store.replace(plan);
    // Ein Versatz gilt dem Abend, den man gerade fährt — nicht dem nächsten
    // Projekt. Beim Wechsel zurück auf null, sonst stünde der neue Plan
    // kommentarlos verschoben da.
    setVersatz(0);
  } else {
    store = createStore(plan);
    mount();
  }
  repo.setActive(plan.project.id);
  refreshChrome();
  save();
}

// ── Aufbau ──────────────────────────────────────────────────────────────────
function mount() {
  gantt = createGantt($('bz'), {
    // Geometrie ~30 % größer, damit sie zur um 30 % größeren Schrift passt.
    store, rowH: 31, groupH: 36, barH: 16, sideW: 296, milestoneSize: 12, initialZoom: 'tage',
    onSelect: (sel) => { inspector.show(sel); syncPanel(); },
    onContext: showContext,
    onError: (msg) => toast(msg, 'bad'),
    onTick: () => refreshLive(),
    // Im Gantt vom Griff eines Balkens auf einen anderen gezogen. Immer FS —
    // den Typ stellt man danach im Panel um, dort steht die Auswahl schon.
    onLink: (from, to) => {
      const r = apply({ type: 'addDep', dep: { from, to, type: 'FS', lag: 0 } });
      if (r && r.id) gantt.select({ kind: 'dep', id: r.id });
    },
    onRemoveDep: (id) => apply({ type: 'removeDep', id }),
    // Der Gantt hat sich von selbst neu eingepasst — die Kopfzeile muss nach.
    onView: () => {
      if (syncZoomSeg) syncZoomSeg();
      $('date-jump').value = gantt.centerDayIso();
    },
  });
  table = createTable($('tb'), { store, onConflicts: ({ error }) => toast(error, 'bad') });
  inspector = createInspector($('ins'), {
    store,
    onError: (msg) => toast(msg, 'bad'),
    onClose: () => { gantt.select(null); syncPanel(); },
  });
  if (gantt.minimapNode) $('mini').append(gantt.minimapNode);

  // Live-Modus überlebt das Neuladen — der Monitor beim Aufbau soll nach einem
  // Stromausfall wieder live sein, ohne dass jemand hinläuft.
  const wantLive = localStorage.getItem('bzp_live') === '1';
  $('live').onclick = () => setLive(!gantt.isLive);
  $('vz-minus').onclick = () => setVersatz(gantt.versatz - 1);
  $('vz-plus').onclick = () => setVersatz(gantt.versatz + 1);
  // Nur `change`, nie zusätzlich `blur` — dieselbe Falle wie in der Tabelle.
  $('vz-n').onchange = () => setVersatz(parseInt($('vz-n').value, 10) || 0);
  setVersatz(gespeicherterVersatz(), false);
  if (wantLive) setLive(true);
  refreshLive();

  store.subscribe(() => {
    refreshChrome();
    syncBuehnen();          // eine neue oder gelöschte Bühne gehört in die Leiste
    refreshLive();
    scheduleSave();
    if (view === 'tabelle') renderTable();
    inspector.render();       // Panel zeigt sonst veraltete Werte
    syncPanel();
  });

  // ── Zoom ──
  // ── Datum-Navigation ──
  // Das Datumsfeld zeigt den Tag in der Bildmitte. Es aktuell zu halten und die
  // Preset-Markierung zu setzen gehört zusammen: beides nach jeder Navigation.
  const dateInput = $('date-jump');
  const syncDate = () => { dateInput.value = gantt.centerDayIso(); };
  const shiftDay = (iso, days) => {
    const d = new Date((iso || gantt.centerDayIso()) + 'T00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  const segs = [...document.querySelectorAll('[data-z]')];
  const syncSeg = () => segs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.z === gantt.zoomName)));
  syncZoomSeg = syncSeg;
  const afterNav = () => { syncSeg(); syncDate(); };
  segs.forEach((b) => { b.onclick = () => { gantt.setZoomPreset(b.dataset.z); afterNav(); }; });
  $('zin').onclick = () => { gantt.zoomIn(); afterNav(); };
  $('zout').onclick = () => { gantt.zoomOut(); afterNav(); };
  $('now').onclick = () => { gantt.goToNow(); syncDate(); };
  dateInput.onchange = () => { if (dateInput.value) gantt.goToDay(dateInput.value); };
  $('date-prev').onclick = () => { dateInput.value = shiftDay(dateInput.value, -1); gantt.goToDay(dateInput.value); };
  $('date-next').onclick = () => { dateInput.value = shiftDay(dateInput.value, 1); gantt.goToDay(dateInput.value); };
  $('bz').addEventListener('wheel', () => requestAnimationFrame(afterNav), { passive: true });
  $('bz').addEventListener('keyup', afterNav);
  syncSeg();
  // Feldgrenzen = Projektzeitraum; Startwert nach dem ersten Layout (rAF).
  dateInput.min = (store.state.project.start || '').slice(0, 10);
  dateInput.max = (store.state.project.end || '').slice(0, 10);
  requestAnimationFrame(syncDate);

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

  // ── Ebene ──
  document.querySelectorAll('button[data-ansicht]').forEach((b) => {
    b.onclick = () => setAnsicht(b.dataset.ansicht);
  });
  setAnsicht(startAnsicht());

  // ── Projekt ──
  $('proj-menu').onclick = () => showProjectDialog({});
  $('export').onclick = doExport;
  $('add-gewerk').onclick = addGewerk;
  // Der Konflikt-Knopf zeigt jetzt die Liste, statt blind alle zu verschieben —
  // im Popup entscheidet man je Konflikt (zeigen · lösen · ist ok) oder auf einmal.
  $('resolve').onclick = () => openReview('konflikt');
  // Die „kritisch"-Kachel im Kopf öffnet dieselbe Liste beim Kritisch-Abschnitt.
  $('kpis').addEventListener('click', (e) => {
    if (e.target.closest('[data-kpi="kritisch"]')) openReview('kritisch');
  });

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
  syncPanel();
  document.querySelector('.hd-zoom').hidden = v !== 'gantt';
  syncBuehnen();
  if (v === 'tabelle') { renderTable(); return; }
  gantt.relayout();
  // Kein Nachziehen per Zeitschätzung: der Gantt passt sich beim
  // Wiederauftauchen selbst ein (ResizeObserver) und meldet das über onView.
}

// ── Ebene wechseln ──────────────────────────────────────────────────────────
// Der EINZIGE Ort, der über die Ansicht entscheidet. Gantt und Tabelle bekommen
// Ebene und Abschnitt gereicht; der Rest der Kopfzeile richtet sich danach aus.
function setAnsicht(name) {
  ansicht = ANSICHTEN.includes(name) ? name : 'bau';
  ebene = ebeneVon(ansicht);
  abschnitt = abschnittVon(ansicht);
  localStorage.setItem('bzp_ansicht', ansicht);
  document.querySelectorAll('button[data-ansicht]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ansicht === ansicht)));
  // Eine Bühne, die es nicht mehr gibt, darf nicht ewig ausgeblendet bleiben.
  const da = new Set(sichtGewerke(store.state, 'show').map((g) => g.id));
  for (const id of [...ausBlend]) if (!da.has(id)) ausBlend.delete(id);

  // Vorgabe-Showtag: der, auf dem «jetzt» liegt — sonst der erste. Beim Aufbau
  // steht man vor dem Festival, dann ist der erste Showtag die richtige Antwort.
  const tage = programmTage(sichtTasks(store.state, 'show'));
  if (ebene === 'show' && (!showTag || !tage.includes(showTag))) {
    const jetzt = local(toDate(gantt.liveInfo().now)).slice(0, 10);
    showTag = tage.includes(jetzt) ? jetzt : (tage[0] || null);
  }
  if (ebene !== 'show') showTag = null;

  gantt.setEbene(ebene, ausBlend, showTag, abschnitt);
  table.setEbene(ebene, ausBlend, showTag, abschnitt);
  // Die Auswahl gehört der anderen Ebene und zeigt ins Leere.
  gantt.select(null);
  syncPanel();
  syncBuehnen();
  $('add-gewerk').textContent = ebene === 'show' ? '+ Bühne' : '+ Gewerk';
  $('fold').hidden = ebene === 'show';   // wenige Zeilen brauchen kein Zuklappen
  if (view === 'tabelle') renderTable();
  refreshChrome();
  refreshLive();
  // Die Zoom-Markierung gehört zum Bild: setEbene stellt die Stufe neu, ohne
  // das blieb «Tage» gedrückt, während der Gantt längst anders stand.
  if (syncZoomSeg) syncZoomSeg();
}

// Wird in mount() gesetzt — setEbene läuft auch von dort und darf die
// Markierung nicht anfassen, bevor es die Knöpfe gibt.
let syncZoomSeg = null;

// Häkchenleiste der Bühnen. Nur im Showablauf und nur in der Gantt-Ansicht —
// in der Tabelle steht ohnehin jede Bühne als Gruppenkopf da.
function syncBuehnen() {
  const box = $('buehnen');
  const zeigen = ebene === 'show';
  box.hidden = !zeigen;
  if (!zeigen) return;
  const buehnen = sichtGewerke(store.state, 'show');
  box.replaceChildren();

  // Showtag zuerst: er entscheidet, WELCHER Ablauf gezeigt wird. Die Bühnen
  // darunter entscheiden, WESSEN.
  const tage = programmTage(sichtTasks(store.state, 'show'));
  if (tage.length > 1) {
    const seg = el('div', 'seg seg-tag');
    for (const t of tage) {
      const btn = el('button', null, new Date(t + 'T12:00')
        .toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' }));
      btn.setAttribute('aria-pressed', String(t === showTag));
      btn.onclick = () => { showTag = t; setAnsicht(ansicht); };
      seg.append(btn);
    }
    box.append(seg);
  }

  for (const g of buehnen) {
    const lab = el('label', 'buehne-i');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !ausBlend.has(g.id);
    cb.onchange = () => {
      cb.checked ? ausBlend.delete(g.id) : ausBlend.add(g.id);
      gantt.setEbene(ebene, ausBlend, showTag, abschnitt);
      table.setEbene(ebene, ausBlend, showTag, abschnitt);
      if (view === 'tabelle') renderTable();
      refreshChrome();
    };
    const dot = el('span', 'bz-dot');
    dot.style.setProperty('--gw', gewerkVar(g.slot));
    if (gewerkTexture(g.slot)) dot.dataset.tex = '1';
    lab.append(cb, dot, el('span', null, g.name));
    box.append(lab);
  }
  if (!buehnen.length) {
    const hint = el('span', 'buehnen-leer', 'Noch keine Bühne — «+ Bühne» legt eine an.');
    box.append(hint);
  }
}

// Der EINZIGE Ort, der über die Sichtbarkeit des Panels entscheidet.
function syncPanel() {
  $('ins').hidden = view !== 'gantt' || !inspector.selection;
}

function renderTable() {
  table.setConflicts(gantt.conflicts());   // schon gerechnet, nicht wiederholen
  table.render();
}

// ── Versatz: die Ansage vom Pult ────────────────────────────────────────────
// Plus ist Delay — der Ablauf rutscht im Bild nach rechts, die Uhr bleibt echt.
//
// `setVersatz` ist der EINZIGE Schreiber von Wert, Anzeige und Speicher. Ein
// Zustand, ein Besitzer: als `#ins.hidden` vier Schreiber hatte, holte jede
// Änderung das Panel zurück, das gerade zu sein hatte.
const VZ_KEY = 'bzp_versatz';

/** Der Kalendertag, auf den sich ein gespeicherter Versatz bezieht. */
const versatzTag = () => local(toDate(gantt.liveInfo().now)).slice(0, 10);

/**
 * Der gespeicherte Versatz — aber nur, wenn er von HEUTE ist.
 *
 * Der Live-Knopf überlebt den Neustart bewusst, und der Versatz tut es auch:
 * nach einem Stromausfall soll der Monitor wieder stimmen. Über Nacht wird
 * daraus aber Unsinn — ein Plan, der am nächsten Morgen 45 Minuten neben der
 * Achse liegt, und niemand weiß, warum. Deshalb steht der Tag mit im Speicher.
 */
function gespeicherterVersatz() {
  try {
    const raw = JSON.parse(localStorage.getItem(VZ_KEY) || '{}');
    return raw && raw.tag === versatzTag() ? Number(raw.min) || 0 : 0;
  } catch (_) {
    return 0;                              // unlesbar heißt: kein Versatz
  }
}

function setVersatz(min, speichern = true) {
  const v = gantt.setVersatz(min);          // klemmt auf ±180 und zeichnet neu
  $('vz-n').value = String(v);
  const t = versatzText(v);
  const n = $('vz-txt');
  n.textContent = t.text;
  n.classList.toggle('is-late', t.klasse === 'is-late');
  n.classList.toggle('is-early', t.klasse === 'is-early');
  if (speichern) localStorage.setItem(VZ_KEY, JSON.stringify({ min: v, tag: versatzTag() }));
  refreshLive();
}

// ── Live ────────────────────────────────────────────────────────────────────
function setLive(on) {
  gantt.setLive(on);
  localStorage.setItem('bzp_live', on ? '1' : '0');
  $('live').setAttribute('aria-pressed', String(on));
  $('live').textContent = on ? '● Live' : 'Live';
  if (on) {
    setView('gantt');
    toast('Live: die Ansicht folgt jetzt der Zeit. Nochmal klicken beendet das.');
  }
  refreshLive();
}

function refreshLive() {
  if (!store || !gantt) return;
  refreshShowhead();
  // Der Stepper gehört zur laufenden Uhr: ohne Live sagt ein Versatz nichts,
  // und in beiden Ebenen ist er gleichermaßen nützlich (auch ein Aufbau hängt).
  $('vz').hidden = !gantt.isLive;
  $('vz-txt').hidden = !gantt.isLive;
  // planNow statt now: gezählt wird gegen den VERSCHOBENEN Plan. Wer fünf
  // Minuten angesagt hat und exakt fünf Minuten spät ist, ist im Plan.
  const st = liveStats(store.state.tasks, gantt.liveInfo().planNow);
  const n = $('live-bar');
  // Im Showablauf trägt die große Kopfzeile dieselbe Aussage, nur genauer und
  // auf den Tag bezogen. Beides nebeneinander widerspräche sich sichtbar: hier
  // «23 laufen», dort «CURSE».
  n.hidden = !gantt.isLive || ebene === 'show';
  if (n.hidden) return;
  const parts = [];
  parts.push(st.running + (st.running === 1 ? ' läuft' : ' laufen'));
  if (st.late) parts.push(st.late + ' im Verzug');
  if (st.next) parts.push('in ' + fmtMin(st.next.inMin) + ': ' + st.next.title);
  n.replaceChildren();
  const dot = el('span', 'live-dot');
  n.append(dot, el('span', 'live-txt', parts.join(' · ')));
  n.classList.toggle('is-late', st.late > 0);
}

const fmtMin = (m) => (m < 60 ? m + ' Min' : Math.round(m / 60) + ' Std');

// ── Live-Kopfzeile des Showablaufs ──────────────────────────────────────────
// Was läuft, was kommt als Nächstes, wie weit hängen wir. Sie rechnet über die
// Vorgänge der SICHTBAREN Ebene (gantt.sichtbareTasks) — sonst meldete sie den
// Aufbau, während auf der Bühne jemand spielt.
//
// Der Status wird dabei nie automatisch gesetzt. Der Verzug entsteht genau
// daraus, dass die menschliche Aussage «geplant» der Uhr widerspricht.
function refreshShowhead() {
  const n = $('showhead');
  const an = ebene === 'show' && gantt.isLive;
  n.hidden = !an;
  if (!an) return;

  // Gerechnet wird gegen den verschobenen Plan (planNow), angezeigt werden die
  // verschobenen Uhrzeiten (`vz`) — sonst stünde in der Kopfzeile 20:00, wo der
  // Balken daneben auf 20:05 liegt.
  const { planNow: now, now: echtNow, versatz: vz } = gantt.liveInfo();
  const punkte = gantt.sichtbareTasks();   // schon auf Ebene UND Showtag gefiltert
  const laeuft = runningAt(punkte, now);
  const jetzt = punkte.filter((t) => laeuft.has(t.id)).sort((a, b) => toMin(a.start) - toMin(b.start));
  const naechst = nextUp(punkte, now);

  // Verzug NUR aus dem, was noch aussteht oder gerade läuft.
  //
  // delaysAt meldet auch längst vergangene, nie abgehakte Punkte — bei DOORS
  // (12:00–14:00, Status «geplant») stand um 15:30 groß und rot «+4 Std», und
  // das an einem Abend, der exakt nach Plan lief. Das ist kein Verzug, sondern
  // fehlende Rückmeldung, und es überdeckte den Verzug, auf den es ankommt.
  // Die Regel bleibt unberührt: der Status wird nie automatisch gesetzt.
  const offen = new Set(punkte.filter((t) => toMin(t.end) >= now).map((t) => t.id));
  const verzug = delaysAt(punkte, now).filter((d) => offen.has(d.taskId));

  // Ein Changeover ist kein Auftritt — er wird als Umbau angesagt, sonst stünde
  // «JETZT: Changeover» da, wo das Publikum einen Namen erwartet. Trägt der
  // Titel das Wort schon, bleibt es bei einem: «Changeover: Changeover» war das
  // erste, was auf dem Probebild auffiel.
  const ansage = (t) => {
    const typ = typHinweis(t);
    return typ ? typ + ': ' + t.title : t.title;
  };
  const titelVon = (id) => punkte.find((t) => t.id === id);

  n.replaceChildren();
  const feld = (klasse, kopf, inhalt, zusatz) => {
    const d = el('div', 'sh-f ' + klasse);
    d.append(el('div', 'sh-k', kopf), el('div', 'sh-v', inhalt));
    if (zusatz) d.append(el('div', 'sh-z', zusatz));
    n.append(d);
  };

  const hhmm = (iso) => verschoben(iso, vz).slice(11, 16);

  feld('sh-now', 'Jetzt',
    jetzt.length ? jetzt.map(ansage).join(' · ') : 'nichts auf der Bühne',
    jetzt.length ? 'bis ' + jetzt.map((t) => hhmm(t.end)).join(' / ') : null);

  const nt = naechst && titelVon(naechst.taskId);
  // «in 12 Min» braucht keine Korrektur: Plan und Uhr sind gleich weit
  // verschoben, die Differenz bleibt dieselbe. Nur die absolute Uhrzeit wandert.
  feld('sh-next', 'Als Nächstes',
    nt ? ansage(nt) : 'Show zu Ende',
    nt ? 'in ' + fmtMin(naechst.inMin) + ' · ' + hhmm(nt.start) : null);

  const schlimm = verzug[0];
  const d = el('div', 'sh-f sh-late');
  d.classList.toggle('is-late', !!schlimm);
  d.append(el('div', 'sh-k', 'Verzug'),
    el('div', 'sh-v', schlimm ? '+' + fmtMin(schlimm.byMin) : 'im Plan'));
  if (schlimm) d.append(el('div', 'sh-z', schlimm.title + ' — ' + schlimm.message));
  n.append(d);

  // Die Uhr zeigt die ECHTE Zeit, nicht die des Ablaufs — sie ist der feste
  // Punkt, gegen den der Versatz überhaupt erst eine Aussage ist. Deshalb hier
  // `echtNow` statt `now` (das ist seit dem Versatz die Planzeit).
  const uhr = el('div', 'sh-f sh-clock');
  uhr.append(el('div', 'sh-k', 'Uhr'), el('div', 'sh-v', local(toDate(echtNow)).slice(11, 16)));
  n.append(uhr);
}

// ── Kontextmenü ─────────────────────────────────────────────────────────────
function showContext(sel, x, y) {
  const S = store.state;
  // Eine Verknüpfung zuerst abfangen: darunter wird `sel.id` als Vorgangs-id
  // gelesen, und die Suche liefe ins Leere.
  if (sel.kind === 'dep') {
    const d = S.deps.find((z) => z.id === sel.id);
    if (!d) return;
    const name = (id) => (S.tasks.find((t) => t.id === id) || {}).title || id;
    openMenu(x, y, [
      { label: 'Entfernen: ' + name(d.from) + ' → ' + name(d.to), danger: true, hint: 'Entf',
        run: () => apply({ type: 'removeDep', id: d.id }) },
    ]);
    return;
  }
  if (sel.kind === 'gewerk') {
    const g = S.gewerke.find((z) => z.id === sel.id);
    if (!g) return;
    const list = [...S.gewerke].sort((a, b) => a.sort - b.sort);
    const i = list.findIndex((z) => z.id === g.id);
    const count = S.tasks.filter((t) => t.gewerk === g.id).length;
    openMenu(x, y, [
      { label: 'Umbenennen', hint: 'Doppelklick', run: () => renameInPlace('gewerk', g.id) },
      { label: 'Vorgang hinzufügen', run: () => inspector.addTaskTo(g.id) },
      null,
      { label: 'Nach oben', hint: '↑', disabled: i === 0, run: () => apply({ type: 'reorderGewerk', id: g.id, dir: -1 }) },
      { label: 'Nach unten', hint: '↓', disabled: i === list.length - 1, run: () => apply({ type: 'reorderGewerk', id: g.id, dir: 1 }) },
      null,
      { label: 'Bearbeiten …', run: () => gantt.select(sel) },
      { label: count ? `Löschen (${count} ${count === 1 ? 'Vorgang' : 'Vorgänge'})` : 'Löschen', danger: true, run: () => {
        if (!confirm(count
          ? `«${g.name}» löschen? ${count} ${count === 1 ? 'Vorgang geht' : 'Vorgänge gehen'} mit. ⌘Z holt alles zurück.`
          : `«${g.name}» löschen?`)) return;
        apply({ type: 'removeGewerk', id: g.id });
      } },
    ]);
    return;
  }

  const t = S.tasks.find((z) => z.id === sel.id);
  if (!t) return;
  openMenu(x, y, [
    { label: 'Umbenennen', hint: 'Doppelklick', run: () => renameInPlace('task', t.id) },
    { label: 'Duplizieren', run: () => {
      const r = apply({ type: 'duplicateTask', id: t.id });
      if (r && r.id) {
        gantt.select({ kind: 'task', id: r.id });
        // Die Kopie hat keine Verknüpfungen (store.js, duplicateTask). Das sieht
        // man dem Balken nicht an — wer eine Kette erwartet, merkt es erst, wenn
        // der Plan nicht mitzieht.
        toast('Vorgang dupliziert — ohne Verknüpfungen.');
      }
    } },
    { label: t.milestone ? 'In Vorgang zurückverwandeln' : 'Zu Meilenstein machen', run: () => {
      apply(t.milestone
        ? { type: 'batch', label: 'Meilenstein aufheben', cmds: [
            { type: 'setTaskField', id: t.id, field: 'end', value: local(toDate(toMin(t.start) + 120)) },
            { type: 'setTaskField', id: t.id, field: 'milestone', value: false }] }
        : { type: 'batch', label: 'Zu Meilenstein', cmds: [
            { type: 'setTaskField', id: t.id, field: 'end', value: t.start },
            { type: 'setTaskField', id: t.id, field: 'milestone', value: true }] });
    } },
    null,
    { label: 'Bearbeiten …', run: () => gantt.select(sel) },
    { label: 'Löschen', danger: true, run: () => apply({ type: 'removeTask', id: t.id }) },
  ]);
}

function renameInPlace(kind, id) {
  const lab = kind === 'gewerk'
    ? document.querySelector(`.bz-lab[data-gewerk="${id}"] .bz-lab-name`)
    // ~= statt =: eine Zeile trägt seit den Serien ALLE ids ihrer Termine
    // («t5 t9 t14»). Mit Gleichheit fände das Umbenennen nur einzelne Vorgänge
    // und täte bei jeder Serie stillschweigend nichts.
    : document.querySelector(`.bz-lab[data-task~="${id}"] .bz-lab-name`);
  if (lab) lab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}

function apply(cmd) {
  const r = store.apply(cmd);
  if (r && r.ok === false) toast(r.error, 'bad', 6000);
  return r;
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
async function save(loud = false) {
  if (!store) return;
  // await ist für localStorage folgenlos (synchrones Objekt) und lässt den
  // PocketBase-Durchschrieb (Promise) sein Ergebnis melden.
  const r = await repo.save(store.state);
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

  // Datumsfeld an das (evtl. neue) Projekt anpassen.
  $('date-jump').min = (S.project.start || '').slice(0, 10);
  $('date-jump').max = (S.project.end || '').slice(0, 10);
  $('date-jump').value = gantt.centerDayIso();

  const st = gantt.stats();
  $('kpis').innerHTML = [
    [ebene === 'show' ? 'Bühnen' : 'Gewerke', st.gewerke],
    [ebene === 'show' ? 'Zeiteinträge' : 'Vorgänge', st.total],
    ['läuft', st.run],
    ['Crew', st.crew],
    ['kritisch', st.crit, 'kritisch'],
  ].map(([k, v, key]) => `<div class="kpi${key ? ' is-clickable' : ''}"${key ? ` data-kpi="${key}" title="Kritische Vorgänge prüfen"` : ''}><div class="kpi-v">${v}</div><div class="kpi-k">${k}</div></div>`).join('');

  const conf = gantt.conflicts();   // der Gantt hat sie gerade gerechnet
  const rb = $('resolve');
  rb.hidden = conf.length === 0;
  rb.textContent = conf.length === 1 ? '1 Konflikt auflösen' : conf.length + ' Konflikte auflösen';

  // Legende: Identität hängt nie an der Farbe allein — deshalb Namen, nicht nur Punkte.
  // Farbton und Schraffur kommen aus palette.js — nie hier zweitverdrahten,
  // sonst weicht die Legende von den Balken ab (genau das ist passiert, als die
  // Palette von 8 auf 9 Töne wuchs).
  // Nur die Bänder der sichtbaren Ebene: eine Legende mit zwanzig Gewerken über
  // einem Blatt mit zwei Bühnen erklärt nichts, sie verdeckt.
  $('legend').innerHTML = sichtGewerke(S, ebene, ausBlend)
    .map((g) => `<span class="legend-i"><span class="bz-dot" style="--gw:${gewerkVar(g.slot)}"${gewerkTexture(g.slot) ? ' data-tex="1"' : ''}></span>${escapeHtml(g.name)}</span>`)
    .join('');

  if (syncZoomSeg) syncZoomSeg();

  $('undo').disabled = !store.canUndo;
  $('redo').disabled = !store.canRedo;
}

// ── Gewerk anlegen ──────────────────────────────────────────────────────────
function addGewerk() {
  const buehne = ebene === 'show';
  const wort = buehne ? 'Bühne' : 'Gewerk';
  // Je Ebene gezählt: Gewerke und Bühnen teilen sich die Palette nicht, weil sie
  // nie zusammen zu sehen sind (freeSlot in store.js rechnet ebenso).
  const da = sichtGewerke(store.state, ebene).length;
  if (slotsExhausted(da + 1)) {
    toast(`Mehr als ${MAX_SLOTS} ${wort}e: ab hier trägt die Farbe die Zuordnung nicht mehr, nur noch der Name.`, 'warn', 7000);
  }
  const name = prompt(buehne ? 'Name der Bühne (z. B. Hauptbühne, Zelt, Halle 3):' : 'Name des Gewerks:');
  if (!name) return;
  const r = store.apply({ type: 'addGewerk', gewerk: { name, art: buehne ? 'buehne' : 'gewerk' } });
  if (r.ok === false) return toast(r.error, 'bad');
  syncBuehnen();
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
  // Ohne newId: die Datei bringt ihre eigene Projekt-ID mit → derselbe Plan
  // erneut geladen überschreibt sich, statt sich zu verdoppeln.
  const r = deserialize(await f.text());
  if (r.ok === false) return toast(r.error, 'bad', 8000);
  const name = r.plan.project.name;

  // Schon Projekte mit gleichem Namen da? Fragen, ob ersetzen (alte weg, nur
  // diese Datei) oder zusätzlich importieren — sonst sammeln sich Duplikate.
  const dupes = repo.list().filter((p) => p.name === name);
  if (dupes.length) {
    const choice = await askDialog({
      title: `«${name}» ist bereits vorhanden`,
      message: [
        dupes.length === 1
          ? 'Ein Projekt mit diesem Namen liegt schon in diesem Browser.'
          : `${dupes.length} Projekte mit diesem Namen liegen schon in diesem Browser.`,
        'Alte Version(en) ersetzen oder diese Datei zusätzlich als neues Projekt behalten?',
      ],
      buttons: [
        { label: 'Abbrechen', value: null },
        { label: 'Zusätzlich behalten', value: 'keep' },
        { label: 'Ersetzen', value: 'replace', primary: true },
      ],
    });
    if (choice === null) return;                 // Abbruch: gar nicht importieren
    if (choice === 'replace') for (const p of dupes) repo.remove(p.id);
    else r.plan.project.id = 'p' + Date.now().toString(36);
  }

  open(r.plan);
  $('dlg').hidden = true;      // sonst bleibt der Anlege-Dialog über allem liegen
  toast('«' + name + '» importiert');
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

  // Mitgelieferte Pläne — auch erreichbar, wenn man schon eigene Projekte hat.
  box.append(el('h3', 'dlg-h3', 'Mitgelieferte Pläne'));
  const bl = el('div', 'dlg-list');
  for (const [key, b] of Object.entries(BUNDLED)) {
    const row = el('div', 'dlg-row');
    const btn = el('button', 'dlg-open');
    btn.append(el('span', 'dlg-open-n', b.name));
    btn.append(el('span', 'dlg-open-m', 'aus ' + b.file + ' · Direktlink: ?plan=' + key));
    btn.onclick = async () => { if (await openBundled(key)) close(); };
    row.append(btn);
    bl.append(row);
  }
  box.append(bl);

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

// Popup im Bauzeitenplan-Design statt window.confirm/alert — die nativen Kästen
// fallen optisch aus dem Rahmen und sind je Browser anders. Nutzt dieselben
// .dlg-Bausteine wie der Projektdialog, legt sich als eigenes Overlay über alles
// (auch über einen offenen #dlg) und räumt sich selbst wieder ab.
// Liefert den `value` des gewählten Knopfs — oder null bei Abbruch (Escape,
// Klick auf den Hintergrund, Knopf mit value:null).
function askDialog({ title, message, buttons }) {
  return new Promise((resolve) => {
    const dlg = el('div', 'dlg');
    const box = el('div', 'dlg-box');
    if (title) box.append(el('h2', 'dlg-h', title));
    for (const line of [].concat(message || [])) {
      if (line) box.append(el('p', 'dlg-sub', line));
    }
    const actions = el('div', 'dlg-act');
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      dlg.remove();
      resolve(v);
    };
    for (const b of buttons) {
      const cls = 'btn' + (b.primary ? ' btn-p' : '') + (b.danger ? ' btn-danger' : '');
      const btn = el('button', cls, b.label);
      btn.onclick = () => finish(b.value);
      actions.append(btn);
    }
    box.append(actions);
    dlg.append(box);
    dlg.onclick = (e) => { if (e.target === dlg) finish(null); };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    document.body.append(dlg);
    (actions.querySelector('.btn-p') || actions.lastElementChild)?.focus();
  });
}

// ── Prüf-Liste ────────────────────────────────────────────────────────────────
// Zeigt, WELCHE Vorgänge kritisch bzw. im Konflikt sind, und lässt je Eintrag
// entscheiden: zeigen (auswählen + hinscrollen), lösen (früheste Lage) oder als
// „ist ok"/„gesehen" abhaken. Eine Quelle: gantt.conflicts()/criticals().
let reviewClose = null;
function openReview(focus) {
  if (reviewClose) reviewClose();          // immer nur eine Liste offen
  const dlg = el('div', 'dlg');
  const box = el('div', 'dlg-box rv');
  box.append(el('h2', 'dlg-h', 'Prüfen'));
  const bodyEl = el('div', 'rv-body');
  box.append(bodyEl);
  const foot = el('div', 'dlg-act');
  const closeBtn = el('button', 'btn btn-p', 'Schließen');
  closeBtn.onclick = () => finish();
  foot.append(closeBtn);
  box.append(foot);
  dlg.append(box);

  let unsub = null, done = false;
  const onKey = (e) => { if (e.key === 'Escape') finish(); };
  function finish() {
    if (done) return;
    done = true;
    document.removeEventListener('keydown', onKey);
    if (unsub) unsub();
    dlg.remove();
    reviewClose = null;
  }
  const showTask = (id) => { setView('gantt'); gantt.reveal(id); finish(); };

  function renderBody() {
    const S = store.state;
    const byId = (id) => S.tasks.find((t) => t.id === id);
    bodyEl.replaceChildren();

    // ── Konflikte ──
    const conf = gantt.conflicts();
    const ks = el('div', 'rv-sec rv-sec-konflikt');
    ks.append(el('h3', 'rv-h', 'Konflikte' + (conf.length ? ' (' + conf.length + ')' : '')));
    if (!conf.length) ks.append(el('p', 'rv-empty', 'Keine offenen Konflikte.'));
    for (const c of conf) {
      const t = byId(c.taskId); if (!t) continue;
      const row = el('div', 'rv-row is-conflict');
      const txt = el('div', 'rv-txt');
      txt.append(el('div', 'rv-name', t.title), el('div', 'rv-why', c.message));
      const acts = el('div', 'rv-acts');
      const show = el('button', 'btn', 'Zeigen'); show.onclick = () => showTask(t.id);
      const solve = el('button', 'btn', 'Lösen');
      solve.onclick = () => {
        const dur = toMin(t.end) - toMin(t.start);
        const es = toMin(c.es);
        apply({ type: 'moveTask', id: t.id, start: local(toDate(es)), end: local(toDate(es + dur)) });
      };
      const okb = el('button', 'btn', 'Ist ok');
      okb.title = 'Diesen Konflikt als in Ordnung abhaken';
      okb.onclick = () => apply({ type: 'setTaskField', id: t.id, field: 'ackConflictMin', value: c.shortByMin });
      acts.append(show, solve, okb);
      row.append(txt, acts);
      ks.append(row);
    }
    if (conf.length > 1) {
      const all = el('button', 'btn btn-warn rv-all', 'Alle auflösen');
      all.onclick = () => {
        const cmd = resolveConflictsCmd(store.state);
        if (!cmd.cmds.length) return;
        const r = store.apply(cmd);
        if (r.ok === false) toast(r.error, 'bad');
        else toast(cmd.cmds.length + ' Vorgänge verschoben — ⌘Z nimmt es zurück');
      };
      ks.append(all);
    }
    bodyEl.append(ks);

    // ── Kritisch ──
    const crit = gantt.criticals().map(byId).filter(Boolean);
    const offen = crit.filter((t) => !t.ackCrit).length;
    const cs = el('div', 'rv-sec rv-sec-kritisch');
    cs.append(el('h3', 'rv-h', 'Kritisch' + (offen ? ' (' + offen + ')' : '')));
    cs.append(el('p', 'rv-note', 'Kein Puffer — bestimmt das Enddatum. Kein Fehler; abhaken bringt Ruhe rein.'));
    if (!crit.length) cs.append(el('p', 'rv-empty', 'Kein Vorgang ohne Puffer.'));
    for (const t of crit) {
      const row = el('div', 'rv-row' + (t.ackCrit ? ' is-ack' : ''));
      const txt = el('div', 'rv-txt');
      txt.append(el('div', 'rv-name', t.title));
      const acts = el('div', 'rv-acts');
      const show = el('button', 'btn', 'Zeigen'); show.onclick = () => showTask(t.id);
      if (t.ackCrit) {
        const un = el('button', 'btn', 'Doch prüfen');
        un.onclick = () => apply({ type: 'setTaskField', id: t.id, field: 'ackCrit', value: false });
        acts.append(show, un);
      } else {
        const seen = el('button', 'btn', 'Gesehen');
        seen.onclick = () => apply({ type: 'setTaskField', id: t.id, field: 'ackCrit', value: true });
        acts.append(show, seen);
      }
      row.append(txt, acts);
      cs.append(row);
    }
    bodyEl.append(cs);
  }

  renderBody();
  unsub = store.subscribe(renderBody);     // hält die Liste live aktuell
  reviewClose = finish;
  dlg.onclick = (e) => { if (e.target === dlg) finish(); };
  document.addEventListener('keydown', onKey);
  document.body.append(dlg);
  bodyEl.querySelector(focus === 'kritisch' ? '.rv-sec-kritisch' : '.rv-sec-konflikt')
    ?.scrollIntoView({ block: 'start' });
}

$('undo').onclick = () => store && store.undo();
$('redo').onclick = () => store && store.redo();
$('new-proj').onclick = () => showProjectDialog({});

// Import MUSS auf Modulebene verdrahtet sein, nicht in mount(): mount() läuft
// erst, wenn ein Projekt offen ist. Beim allerersten Start gibt es keins — der
// Dialog bot «JSON importieren» an, aber der Knopf war tot. Wer die App frisch
// öffnet oder seinen Speicher geleert hat, konnte nichts importieren.
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = doImport;

$('ver').textContent = 'v' + VERSION;

// ── Hell/Dunkel ───────────────────────────────────────────────────────────────
// Der Betrachter schaltet das Erscheinungsbild über data-theme am <html>. Der
// Anfangswert steht schon (Inline-Script im <head>, Schlüssel bzp_mode); hier nur
// der Knopf. Ohne gespeicherte Wahl folgt die App der OS-Einstellung.
function currentMode() {
  return document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function paintModeToggle() {
  const dark = currentMode() === 'dark';
  const b = $('theme-toggle');
  b.textContent = dark ? '☀' : '☾';           // zeigt das Ziel, nicht den Ist-Zustand
  b.title = dark ? 'Auf Hell umschalten' : 'Auf Dunkel umschalten';
}
$('theme-toggle').onclick = () => {
  const next = currentMode() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('bzp_mode', next); } catch (e) { /* Privatmodus: nur diese Sitzung */ }
  paintModeToggle();
};
paintModeToggle();

// ── Start ─────────────────────────────────────────────────────────────────────
// Der Plan lebt im Browser (localStorage) plus JSON-Export. Die Seite ist eine
// reine statische Auslieferung ohne Nutzerverwaltung — es gibt nichts
// auszuwählen und nichts anzumelden.
function main() {
  repo = createRepo(window.localStorage);
  boot();
}
main();
