// ── Einstiegspunkt ────────────────────────────────────────────────────────────
// Hält Store, Ablage und Ansichten zusammen. Bewusst dünn: alles Fachliche liegt
// in store.js (Befehle), schedule.js (Termine), conflicts.js (Konflikte),
// gantt.js (Darstellung) und table.js (Eingabe).

import { createStore, verschiebeZeit, SHIFT_MAX_TAGE, SHIFT_MAX_MIN } from './store.js';
import { createRepo, serialize, deserialize } from './persistence.js';
import { createSync, abgleich, gleicherPlan, SYNC_REPO } from './sync.js';
import { TEMPLATES, planFromTemplate } from './templates.js';
import { createGantt } from './gantt.js';
import { createTable } from './table.js';
import { createBedarf } from './bedarf.js';
import { createRail } from './rail.js';
import { createEinrichten } from './einrichten.js';
import { createSuche } from './suche.js';
import { resolveConflictsCmd, local } from './conflicts.js';
import { slotsExhausted, MAX_SLOTS, gewerkVar, gewerkTexture } from './palette.js';
import { createInspector } from './inspector.js';
import { openMenu } from './menu.js';
import { liveStats, runningAt, nextUp, offeneVerspaetungen, verschoben, versatzText } from './live.js';
import { sichtGewerke, sichtTasks, typHinweis, programmTage, buehnenIds, abschnittOf, amTag } from './ebene.js';
import { toMin, toDate, ohneTermin } from './schedule.js';
import { isoWeek } from './timeaxis.js';
import { $, el, escapeHtml } from './dom.js';
import { VERSION } from './version.js';
import { createPhasenEditor } from './phasen-editor.js';
import { phasenJetzt, aufbauPhase } from './phasen.js';

// Der Speicher wird in main() gesetzt. Bis dahin null — nichts greift vorher
// darauf zu.
let repo = null;
let store = null, gantt = null, table = null, bedarf = null, inspector = null, rail = null, suche = null, phasen = null;

// ── Darstellung ─────────────────────────────────────────────────────────────
// Plan · Tabelle · Bedarf. Personal und Maschinen sind KEINE eigenen
// Darstellungen mehr, sondern eine Unterwahl innerhalb von «Bedarf» — als
// «Personalbedarf» und «Maschinenbedarf» waren sie die zwei längsten
// Beschriftungen der Werkzeugzeile und die Ursache des Handy-Überlaufs.
let view = 'gantt';
let bedarfKind = 'personal';

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
// Welcher Abschnitt beim Rücksprung in den Showablauf gilt. Nur setAnsicht()
// schreibt ihn — er ist eine Erinnerung, kein zweiter Zustand.
let letzteShowAnsicht = 'show';

const ausBlend = new Set();   // ausgeblendete Bühnen (nur im Showablauf)
// Der gezeigte Showtag. Eine Running Order ist tagesbezogen: beide Showtage
// nebeneinander ergäben zehn Zeilen ohne Balken — genau die Fehlerart, die in
// diesem Projekt schon dreimal erst auf dem Screenshot aufgefallen ist.
let showTag = null;

// Gesperrter Speicher (Privatmodus, Richtlinie): jeder Zugriff darf werfen, die
// App läuft dann nur für diese Sitzung. Lesen liefert die Vorgabe, Schreiben
// verpufft — ein Wurf beim Start oder Umschalten legte sonst die ganze Seite lahm.
const lsLies = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSchreibe = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* Privatmodus: nur diese Sitzung */ } };

const startAnsicht = () => {
  const q = new URLSearchParams(location.search);
  const neu = q.get('ansicht');
  if (ANSICHTEN.includes(neu)) return neu;
  // Die alten Parameter aus v0.8.0–0.9.2 weiter verstehen: sie stehen in
  // Lesezeichen, in CLAUDE.md und in den Prüfwerkzeugen.
  const e = q.get('ebene'), a = q.get('abschnitt');
  if (e === 'bau') return 'bau';
  if (e === 'show') return a === 'setup' ? 'setup' : 'show';
  const gemerkt = lsLies('bzp_ansicht');
  if (ANSICHTEN.includes(gemerkt)) return gemerkt;
  // Und den gemerkten Stand einer laufenden Sitzung nicht wegwerfen.
  if (lsLies('bzp_ebene') === 'show') {
    return lsLies('bzp_abschnitt') === 'setup' ? 'setup' : 'show';
  }
  return 'bau';
};

// Eingabetypen, in denen ⌘Z dem Browser gehört (Tastatur-Undo im Feld).
const TEXT_EINGABEN = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number',
  'date', 'time', 'datetime-local', 'month', 'week']);

// ── Erststart ───────────────────────────────────────────────────────────────
// Kein mitgelieferter Plan: die App holt nie eine JSON von selbst — ein Plan, der
// von allein erscheint, wäre für den Nutzer unerwartet und zöge Netzabrufe nach
// sich (Entscheidung 2026-11-22). Pläne kommen nur über Import, Vorlage oder Sync.
// `?plan=leer` ist der Schalter der Prüfwerkzeuge.
async function boot() {
  await bootLokal();
  // Danach, nicht davor und nicht blockierend: lokal starten, dann abgleichen.
  abgleichen();
}

async function bootLokal() {
  const wunsch = new URLSearchParams(location.search).get('plan');
  const live = lsLies('bzp_live') === '1';

  // Ein Live-Monitor startet nach Stromausfall von selbst: niemand klickt dort
  // einen Dialog weg, und das zuletzt offene Projekt ist das richtige.
  const activeId = repo.getActive();
  const aktiv = activeId && repo.load(activeId);
  if (live && aktiv && await open(aktiv)) return;
  // `?plan=leer` ist der Schalter der Prüfwerkzeuge beim Neuladen (alle verify-Skripte):
  // aktives, sonst erstes Projekt öffnet; der Dialog kommt, wenn keines da ist.
  if (wunsch === 'leer') {
    const erstes = aktiv || (repo.list().length ? repo.load(repo.list()[0].id) : null);
    if (erstes && await open(erstes)) return;
  }

  // Sonst entscheidet der Mensch: zuletzt geöffnete, Neu, Import.
  showProjectDialog({ firstRun: !store });
}

// Liefert true, wenn das Projekt offen ist, false nach «Abbrechen» im
// Sicherungsdialog (dann bleibt alles wie es war). Asynchron wird es nur beim
// Wechsel auf ein ANDERES Projekt mit gescheitertem Sichern; ein Sync-Update
// desselben Projekts läuft ohne Warten durch und fragt nie.
async function open(plan) {
  // Unverändert wieder geöffnet (kein Import, kein Abgleich-Ergebnis) bleibt
  // abgeglichen — sonst würde jedes Öffnen einen Upload auslösen.
  const id = plan.project.id;
  const alt = repo.load(id), info = repo.syncInfo(id);
  const abgeglichen = !!(alt && info.remoteSha && !info.dirty && gleicherPlan(alt, plan));
  const wechsel = !!store;
  // Projektwechsel heißt andere id. Ein Sync-Update desselben Projekts ersetzt
  // nur den Inhalt: der Versatz gehört dem Abend, nicht dem Stand des Plans.
  const andereId = wechsel && store.state.project.id !== id;
  verworfen.delete(id);     // wird (wieder) geöffnet, also kein Gelöschtes mehr
  // Ein anderes Projekt (auch «Neu») schließt die Einrichten-Seite des bisherigen —
  // vor dem Sichern, damit «eingerichtet» noch zum alten Plan gehört.
  if (andereId) { einScroll = null; closeEinrichten(); }
  if (store) {
    // Eine noch ausstehende Eingabe gehört dem bisherigen Projekt und wäre nach
    // dem Ersetzen weg (der Timer schriebe den NEUEN Plan). Deshalb sofort sichern.
    if (andereId && (saveTimer || store.dirty || ungesichert)) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const r = await sichern({ still: true });
      if (!r.ok && !(await wechselnOhneSicherung(r))) {
        scheduleSave();          // die Eingabe bleibt im Store und wird weiter versucht
        return false;
      }
    }
    store.replace(plan);
    // Der Gantt des neuen Projekts hat sich selbst auf den Aufbau eingepasst — der
    // Scrollstand, den die Einrichten-Seite beim Öffnen gemerkt hat, gehört dem alten.
    einScroll = null;
    // Ein Versatz gilt dem Abend, den man gerade fährt — nicht dem nächsten
    // Projekt. Beim Wechsel zurück auf null, sonst stünde der neue Plan
    // kommentarlos verschoben da.
    if (andereId) setVersatz(0);
  } else {
    store = createStore(plan);
    mount();
  }
  repo.setActive(plan.project.id);   // wirft nie (persistence.js)
  refreshChrome();
  save();
  if (abgeglichen) repo.markSynced(id, info.remoteSha);
  // Projektwechsel: sofort abgleichen (Änderungen am bisherigen Projekt hochladen).
  if (wechsel && !abgleichLaeuft) abgleichen();
  return true;
}

// Das Sichern des bisherigen Projekts ist gescheitert (Speicher voll): nicht
// still wechseln, sonst ist die Eingabe weg. true = wechseln, false = bleiben.
async function wechselnOhneSicherung(r) {
  const wahl = await askDialog({
    title: 'Nicht gespeichert',
    message: [
      `Die letzten Änderungen an «${store.state.project.name}» konnten nicht gesichert werden.`,
      r.error,
      'Exportiere den Plan als JSON, wechsle ohne Sicherung oder bleib im Projekt.',
    ],
    buttons: [
      { label: 'Abbrechen', value: null },
      { label: 'Trotzdem wechseln', value: 'wechseln', danger: true },
      { label: 'Exportieren', value: 'export', primary: true },
    ],
  });
  if (wahl === 'export') doExport();
  return wahl === 'export' || wahl === 'wechseln';
}

// ── Aufbau ──────────────────────────────────────────────────────────────────
function mount() {
  gantt = createGantt($('bz'), {
    // Geometrie ~30 % größer, damit sie zur um 30 % größeren Schrift passt.
    store, rowH: 31, groupH: 36, barH: 16, sideW: 296, milestoneSize: 12, initialZoom: 'tage',
    onSelect: (sel) => { inspector.show(sel); syncPanel(); },
    onContext: showContext,
    onError: (msg) => toast(msg, 'bad'),
    // Klick auf die Phasen-Leiste über dem Zeitstrahl: derselbe Editor wie im
    // Einrichten-Reiter «Phasen», als schwebender Kasten.
    onPhase: (id, rect) => phasen.openBox(id, rect),
    onTick: () => { refreshLive(); syncPhaseHeute(); },
    // Im Gantt vom Griff eines Balkens auf einen anderen gezogen. Immer FS —
    // den Typ stellt man danach im Panel um, dort steht die Auswahl schon.
    onLink: (from, to) => {
      const r = apply({ type: 'addDep', dep: { from, to, type: 'FS', lag: 0 } });
      if (r && r.id) gantt.select({ kind: 'dep', id: r.id });
    },
    onRemoveDep: (id) => apply({ type: 'removeDep', id }),
    // Leerer Gantt: derselbe Weg wie in der Tabelle (addRow bzw. addGewerk).
    onLeer: (w) => (w.art === 'gewerk' ? addGewerk(w.anker) : table.anlegen(w.gewerk)),
    // Der Gantt hat sich von selbst neu eingepasst — die Kopfzeile muss nach.
    onView: () => {
      if (syncZoomSeg) syncZoomSeg();
      syncTagKnopf();
    },
  });
  rail = createRail($('rail-nav'), {
    on: {
      // Der Klick auf einen Modus setzt die ANSICHT — die Schiene selbst
      // schreibt nichts. «Showablauf» kehrt in den zuletzt gewählten
      // Abschnitt zurück.
      modus: (m) => { closeEinrichten(); setAnsicht(m === 'bau' ? 'bau' : letzteShowAnsicht); },
      einrichten: () => openEinrichten(),
    },
  });
  table = createTable($('tb'), {
    store,
    onConflicts: ({ error }) => toast(error, 'bad'),
    onHinweis: (text) => toast(text),
    onGewerkAnlegen: (anker) => addGewerk(anker),
  });
  // Die Suche rechnet über die GANZE aktive Ebene — auch über Bühnen, deren
  // Häkchen aus sind: ein Treffer, den ein Filter verschluckt, wäre «gibt's
  // nicht». Der Sprung stellt dann das Häkchen wieder an (springeZu).
  suche = createSuche($('suche'), $('suche-liste'), {
    // Wie der Gantt (syncState): im Bauzeitenplan gehören die Zieltermine
    // (`gewerk: 'projekt'`, ohne Band) dazu — sonst sind «Doors» und «Abnahme»
    // nicht zu finden. Der Versatz geht mit, die Liste zeigt verschobene Zeiten.
    daten: () => ({
      tasks: ebene === 'bau'
        ? [...sichtTasks(store.state, ebene), ...store.state.tasks.filter((t) => t.gewerk === 'projekt')]
        : sichtTasks(store.state, ebene),
      gewerke: sichtGewerke(store.state, ebene),
      versatz: gantt.versatz,
      ebene,
    }),
    onWahl: springeZu,
    blockiert: () => !!document.querySelector('.dlg:not([hidden])'),
  });
  phasen = createPhasenEditor({ store, askDialog, onError: (msg) => toast(msg, 'bad'), onHinweis: (msg) => toast(msg) });
  phasen.mountListe($('ei-ph-liste'), $('ei-ph-add'));
  einrichten = createEinrichten($('ein-seite'), {
    store,
    send: apply,
    zu: $('ein-zu'),
    zurueck: $('ein-zurueck'),
    weiter: $('ein-weiter'),
    onZu: closeEinrichten,
    onBereich: (name) => {
      if (name === 'phasen') phasen?.refresh();
    },
    // Eine Quelle für Löschen, Anlegen und den «Neu…»-Kasten — dieselben Wege wie
    // Rechtsklick im Plan und Tabelle.
    loescheGewerk,
    neuGewerk: (anker, art) => addGewerk(anker, art),
    neuFragen: (opt, ankerEl, fertig) => table.openNeuFragen(opt, ankerEl, fertig),
  });
  bedarf = createBedarf($('bd'), { store, onEinrichten: (tab) => openEinrichten(tab) });
  inspector = createInspector($('ins'), {
    store,
    onError: (msg) => toast(msg, 'bad'),
    onHinweis: (msg) => toast(msg),
    onClose: () => { gantt.select(null); syncPanel(); },
    // Eigene App-Dialoge statt window.confirm/prompt — dieselben Bausteine
    // wie überall sonst (askDialog hier, der schwebende Kasten aus table.js).
    onConfirm: (opts) => askDialog(opts),
    openNeuFragen: (opt, ankerEl, fertig) => table.openNeuFragen(opt, ankerEl, fertig),
  });
  if (gantt.minimapNode) $('mini').append(gantt.minimapNode);

  // Live-Modus überlebt das Neuladen — der Monitor beim Aufbau soll nach einem
  // Stromausfall wieder live sein, ohne dass jemand hinläuft.
  const wantLive = lsLies('bzp_live') === '1';
  $('live').onclick = () => setLive(!gantt.isLive);
  $('vz-minus').onclick = () => setVersatz(gantt.versatz - 1);
  $('vz-plus').onclick = () => setVersatz(gantt.versatz + 1);
  // Nur `change`, nie zusätzlich `blur` — dieselbe Falle wie in der Tabelle.
  $('vz-n').onchange = () => setVersatz(parseInt($('vz-n').value, 10) || 0);
  setVersatz(gespeicherterVersatz(), false);
  if (wantLive) setLive(true);
  refreshLive();

  store.subscribe(() => {
    phasen.refresh();
    einrichten.refresh();
    refreshChrome();
    syncBuehnen();          // eine neue oder gelöschte Bühne gehört in die Leiste
    refreshLive();
    scheduleSave();
    if (view === 'tabelle') renderTable();
    if (view === 'bedarf') bedarf.render();
    inspector.render();       // Panel zeigt sonst veraltete Werte
    syncPanel();
  });

  // ── Zoom und Tag ──
  // Der Kalender-Knopf zeigt den Tag in der Bildmitte. Ihn aktuell zu halten
  // und die Zoom-Markierung zu setzen gehört zusammen: beides nach jeder
  // Navigation.
  // Die Zoomstufe ist ein Klappmenü, keine Segmentgruppe: sie wird selten
  // gewechselt und kostete als vier Knöpfe ein Viertel der Leistenbreite.
  const zsel = $('zoom-stufe');
  const ZOOM = { monate: 'Monate', wochen: 'Wochen', tage: 'Tage', stunden: 'Stunden' };
  const syncSeg = () => { zsel.textContent = ZOOM[gantt.zoomName] + ' ▾'; };
  syncZoomSeg = syncSeg;
  const afterNav = () => { syncSeg(); syncTagKnopf(); };
  zsel.onclick = () => {
    const r = zsel.getBoundingClientRect();
    openMenu(r.left, r.bottom + 4, Object.entries(ZOOM).map(([k, label]) => ({
      label, hint: k === gantt.zoomName ? '●' : '',
      run: () => { gantt.setZoomPreset(k); afterNav(); },
    })));
  };
  $('drucken').onclick = (e) => window.open(e.currentTarget.dataset.href, '_blank');
  $('zin').onclick = () => { gantt.zoomIn(); afterNav(); };
  $('zout').onclick = () => { gantt.zoomOut(); afterNav(); };
  $('now').onclick = () => { gantt.goToNow(); afterNav(); };
  $('tag-wahl').onclick = (e) => tagWahl(e.currentTarget);
  $('bz').addEventListener('wheel', () => requestAnimationFrame(afterNav), { passive: true });
  $('bz').addEventListener('keyup', afterNav);
  syncSeg();
  requestAnimationFrame(syncTagKnopf);

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

  // ── Bedarf: Personal oder Maschinen ──
  document.querySelectorAll('button[data-bedarf]').forEach((b) => {
    b.onclick = () => {
      bedarfKind = b.dataset.bedarf;
      document.querySelectorAll('button[data-bedarf]')
        .forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.bedarf === bedarfKind)));
      bedarf.setKind(bedarfKind);
      bedarf.render();
    };
  });
  document.querySelector('button[data-bedarf="personal"]').setAttribute('aria-pressed', 'true');

  // ── Projekt ──
  // Der Konflikt-Knopf zeigt jetzt die Liste, statt blind alle zu verschieben —
  // im Popup entscheidet man je Konflikt (zeigen · lösen · ist ok) oder auf einmal.
  $('resolve').onclick = () => openReview();

  // ── Tastatur ──
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    // ⌘Z in einem Feld gehört dem Browser; sonst nähme es den letzten Store-Befehl
    // zurück und würfe die Eingabe weg.
    // Nur echte Texteingabe: in select, Checkbox und Co. hat der Browser kein Undo,
    // dort soll ⌘Z weiter den Store-Befehl zurücknehmen (Tastaturbedienung der Tabelle).
    const ziel = e.target.closest ? e.target : null;
    const eingabe = ziel && (ziel.closest('textarea, [contenteditable]:not([contenteditable="false"])')
      || (ziel.closest('input') && TEXT_EINGABEN.has((ziel.closest('input').type || 'text').toLowerCase())));
    if (eingabe && e.key.toLowerCase() === 'z') return;
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
    if (!store || verworfen.has(store.state.project.id) || !(store.dirty || ungesichert)) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

function setView(v) {
  view = v;
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('bz').hidden = v !== 'gantt';
  $('tb').hidden = v !== 'tabelle';
  $('bd').hidden = v !== 'bedarf';
  syncPanel();
  // Die Zeitwerkzeuge gehören zum Plan UND zum Bauzeitenplan: der Showablauf
  // ist tagesbezogen, dort sagen Zoomstufen, Datumsfeld und «Alle zuklappen»
  // nichts. Genau solche Knöpfe waren gemeint, als die Leiste zu voll wurde.
  document.querySelector('.hd-zoom').hidden = v !== 'gantt' || ebene !== 'bau';
  $('seg-bedarf').hidden = v !== 'bedarf';
  syncTagKnopf();
  syncBuehnen();
  if (v === 'tabelle') { renderTable(); return; }
  if (v === 'bedarf') { bedarf.setKind(bedarfKind); bedarf.render(); return; }
  gantt.relayout();
  // Kein Nachziehen per Zeitschätzung: der Gantt passt sich beim
  // Wiederauftauchen selbst ein (ResizeObserver) und meldet das über onView.
}

// ── Einrichten: eine eigene Seite derselben App ─────────────────────────────
// Die Seite (`#ein-seite`, js/einrichten.js) ersetzt den Plan als MODUS, ohne
// ihn abzubauen: `.col.ist-ein` verbirgt nur Kopfzeile, Arbeitsbereich und Fuß.
// Zoom, Tag und Auswahl bleiben also im Speicher; den Scrollstand merken wir
// beim Öffnen und stellen ihn beim Schließen zurück.
//
// `openEinrichten` steht auf MODULEBENE (Aufrufer: Schiene, Bedarf), die Seite
// selbst entsteht erst in mount() — sie braucht den Store. Ohne Projekt ist das
// Öffnen ein Nichts; Import, Neu und Projekte laufen vorher über den
// Projektdialog (siehe «Was der erste Start braucht» in CLAUDE.md).
let einrichten = null;
let einScroll = null;      // { gantt: [l, t], tabelle: [l, t], … } vom Öffnen; ein Projektwechsel verwirft ihn

const scrollerListe = () => [
  ['gantt', document.querySelector('#bz .bz-scroll')],
  ['tabelle', $('tb')],
  ['bedarf', $('bd')],
];

function openEinrichten(bereich = 'projekt', opt = {}) {
  if (bereich === 'sync') { oeffneSpeicherort(); return; }   // Speicherort ist ein Dialog, kein Bereich
  if (!einrichten) return;
  if (!einrichten.offen) {
    einScroll = {};
    for (const [k, n] of scrollerListe()) if (n) einScroll[k] = [n.scrollLeft, n.scrollTop];
    document.querySelector('.col').classList.add('ist-ein');
  }
  einrichten.open(typeof bereich === 'string' ? bereich : 'projekt', opt);
  rail?.setEinrichten(true);
}

function closeEinrichten() {
  if (!einrichten?.offen) return;
  einrichten.close();
  // Wer die Seite verlässt (Zum Plan, «Fertig», Schiene), hat das erste Einrichten
  // hinter sich — auch mitten in den Schritten. EIN Befehl = ein ⌘Z, über den Store.
  if (store.state.project.eingerichtet === false) apply({ type: 'setProjectField', field: 'eingerichtet', value: true });
  document.querySelector('.col').classList.remove('ist-ein');
  rail?.setEinrichten(false);
  const merk = einScroll; einScroll = null;
  if (!merk) return;
  // Der Plan behielt seine Breite (siehe base.css) — der Gantt passt sich daher
  // nicht neu ein; zurückgestellt wird trotzdem, falls ein Browser den Stand
  // beim Verbergen verwirft.
  requestAnimationFrame(() => {
    for (const [k, n] of scrollerListe()) {
      if (n && merk[k]) { n.scrollLeft = merk[k][0]; n.scrollTop = merk[k][1]; }
    }
  });
}

// ── Speicherort (GitHub-Sync) ────────────────────────────────────────────────
// Optional: ohne Schlüssel in localStorage (`bzp_sync`) tut dieser Block nichts
// und die App verhält sich wie ohne Sync. Der Schlüssel lebt NUR dort — nie im
// Plan, nie im Export, nie in persistence.js. Auf MODULEBENE, damit Verbinden
// auch ohne offenes Projekt geht.
const SYNC_KEY = 'bzp_sync';
const UPLOAD_NACH_MS = 10000;      // gebündelt: frühestens 10 s nach der letzten Speicherung
let uploadTimer = null, abgleichLaeuft = false, abgleichNochmal = false, uebersprungen = false, letzterAbgleich = null;

function syncKonfig() {
  try {
    const k = JSON.parse(window.localStorage.getItem(SYNC_KEY) || 'null');
    return k && typeof k.token === 'string' && k.token && typeof k.repo === 'string' ? { token: k.token, repo: k.repo } : null;
  } catch { return null; }
}

const syncClient = (k) => createSync({ fetch: (...a) => window.fetch(...a), token: k.token, repo: k.repo });

// EINZIGER Schreiber von #sync-state. null = nicht verbunden → ausgeblendet.
function setSyncState(state, titel) {
  const n = $('sync-state');
  if (!state) { n.hidden = true; return; }
  n.hidden = false;
  n.dataset.state = state;
  n.title = titel || '';
  n.setAttribute('aria-label', titel || '');
}

function paintSyncInfo() {
  const k = syncKonfig();
  const info = $('sync-info');
  $('sync-trennen').disabled = !k;
  if (!k) { info.textContent = 'Nicht verbunden — die Pläne bleiben in diesem Browser.'; return; }
  const offen = repo ? repo.syncListe().filter((e) => e.dirty).length : 0;
  const zeit = letzterAbgleich ? letzterAbgleich.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : 'noch keiner';
  info.textContent = `Verbunden mit ${k.repo}. Letzter Abgleich: ${zeit}. Offene Uploads: ${offen}.`;
}

function planeUpload() {
  if (!syncKonfig()) return;
  clearTimeout(uploadTimer);
  setSyncState('wartet', 'Änderungen warten auf den Upload');
  uploadTimer = setTimeout(abgleichen, UPLOAD_NACH_MS);
}

const GRUND_TEXT = {
  offline: 'Keine Verbindung zu GitHub — es wird später abgeglichen.',
  schluessel: 'Schlüssel ungültig oder ohne Zugriff.',
  repo: 'Das Daten-Repo ist für diesen Schlüssel nicht sichtbar (oder es existiert nicht).',
  konflikt: 'Das Projekt wurde zwischenzeitlich anderswo geändert.',
  fehler: 'GitHub meldet einen Fehler.',
};

async function abgleichen() {
  const k = syncKonfig();
  if (!k) { setSyncState(null); return; }
  if (abgleichLaeuft) { abgleichNochmal = true; return; }
  abgleichLaeuft = true;
  clearTimeout(uploadTimer);
  try {
    // Ein Überspringen (es wurde weitergetippt) löst höchstens EINEN sofortigen
    // zweiten Durchlauf aus. Scheitert das Speichern dauerhaft (Speicher voll),
    // bliebe es sonst eine Endlosschleife mit je list()+pull().
    let nachSkip = false;
    for (;;) {
      abgleichNochmal = false; uebersprungen = false;
      await abgleichenEinmal(k);
      if (uebersprungen) {
        if (nachSkip) {
          setSyncState('wartet', 'Ungesicherte Änderung – Abgleich folgt nach dem Speichern');
          abgleichNochmal = false;      // die nächste erfolgreiche save() → planeUpload startet neu
          break;
        }
        nachSkip = true;
        continue;
      }
      if (!abgleichNochmal) break;
    }
  } catch (e) {
    setSyncState('fehler', 'Abgleich fehlgeschlagen: ' + (e && e.message || e));
  } finally {
    abgleichLaeuft = false;
    paintSyncInfo();
  }
}

// Ein Durchlauf. Bricht bei offline/Schlüssel ab (alles Weitere scheiterte genauso),
// macht bei anderen Fehlern mit dem nächsten Projekt weiter.
async function abgleichenEinmal(k) {
  const sync = syncClient(k);
  // Offene Tipp-Änderungen (800-ms-Verzögerung) erst in die Ablage bringen,
  // sonst wüsste der Abgleich nicht, dass das offene Projekt dirty ist.
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await save(); }
  setSyncState('wartet', 'Gleiche ab …');
  const l = await sync.list();
  if (!l.ok) return syncScheitert(l);
  let problem = null, abbruch = false;
  for (const a of abgleich(repo.syncListe().filter((x) => !verworfen.has(x.id)), l.dateien)) {
    const r = await fuehreAus(sync, a);
    if (r && r.ok === false) {
      problem = problem || r;
      if (r.grund === 'offline' || r.grund === 'schluessel') { abbruch = true; break; }
    }
  }
  if (abbruch) return syncScheitert(problem);
  if (problem) {
    return setSyncState(problem.grund === 'abgebrochen' ? 'fehler' : 'wartet',
      problem.grund === 'abgebrochen' ? 'Konflikt nicht gelöst — Pläne weichen voneinander ab' : grundText(problem));
  }
  letzterAbgleich = new Date();
  clearTimeout(uploadTimer);       // open()/save() im Durchlauf haben ihn evtl. neu gestellt
  setSyncState('ok', 'Abgeglichen mit ' + k.repo);
}

// Text zu einem Fehlschlag, mit HTTP-Code, wo GitHub einen geliefert hat — sonst
// bleibt «GitHub meldet einen Fehler» ein Rätsel (z. B. Token ohne Schreibrecht).
const grundText = (r) => (GRUND_TEXT[r.grund] || GRUND_TEXT.fehler) + (r.status ? ` (HTTP ${r.status})` : '');

function syncScheitert(r) {
  setSyncState(r.grund === 'offline' ? 'wartet' : 'fehler', grundText(r));
}

const offenId = () => (store ? store.state.project.id : null);

// Lokal ablegen; ist es das offene Projekt, auch anzeigen. open() speichert
// selbst (dirty) — deshalb danach noch einmal als abgeglichen markieren.
function uebernehmen(plan, sha) {
  repo.save(plan, { remoteSha: sha });
  if (plan.project.id === offenId()) open(plan);   // gleiche id: wartet und fragt nie
  repo.markSynced(plan.project.id, sha);
}

async function hochladen(sync, id, sha) {
  const plan = repo.load(id);
  if (!plan) return { ok: true };
  const vorher = (repo.list().find((x) => x.id === id) || {}).modified;
  const r = await sync.push(id, serialize(plan), sha);
  if (!r.ok) return r;
  repo.markSynced(id, r.sha);
  // Zwischenzeitlich weitergetippt? Dann gilt der Plan wieder als geändert.
  const jetzt = (repo.list().find((x) => x.id === id) || {}).modified;
  if (jetzt !== vorher) repo.save(repo.load(id));
  return r;
}

// Darf der Abgleich Projekt `id` JETZT überschreiben/entfernen? Die Entscheidung
// stammt aus einem Snapshot vor dem Netzwerk-await; wer inzwischen weitergetippt
// hat (dirty, offener 800-ms-Timer, ungesicherter Store), wird nie überschrieben.
function ueberschreibenSicher(id) {
  // Lokal gar nicht vorhanden (neues Projekt vom anderen Gerät): nichts, was
  // verloren gehen könnte. syncInfo() meldet für unbekannte ids dirty:true —
  // ohne diese Zeile wurde jedes fremde Projekt übersprungen und nie geholt.
  if (!repo.list().some((x) => x.id === id)) return true;
  if (repo.syncInfo(id).dirty) return false;
  if (id === offenId() && (saveTimer || store.dirty || ungesichert)) return false;
  return true;
}

async function fuehreAus(sync, a) {
  if (a.art === 'hochladen') return hochladen(sync, a.id, a.sha);

  if (a.art === 'lokal-loeschen') {
    if (!ueberschreibenSicher(a.id)) { uebersprungen = true; return { ok: true }; }
    const name = (repo.list().find((x) => x.id === a.id) || {}).name || a.id;
    // Nie still löschen: «nicht im Repo» kann auch ein Fehlgriff sein (anderes
    // Repo, zurückgesetzter Verlauf). Abbruch heißt behalten.
    const wahl = await askDialog({
      title: 'Im Daten-Repo gelöscht',
      message: [`«${name}» ist im Daten-Repo nicht mehr vorhanden — vermutlich auf einem anderen Gerät gelöscht.`,
        'Hier behalten und neu hochladen, oder auch lokal löschen?'],
      buttons: [
        { label: 'Behalten und neu hochladen', value: 'behalten', primary: true },
        { label: 'Lokal löschen', value: 'loeschen', danger: true },
      ],
    });
    // Der Dialog hat gewartet: inzwischen Weitergetipptes nicht mehr löschen.
    if (wahl === 'loeschen' && ueberschreibenSicher(a.id)) {
      if (await loescheProjekt(a.id)) toast('«' + name + '» lokal gelöscht', undefined, 6000);
      return { ok: true };
    }
    // Nur bei Erfolg nachlaufen: sonst käme derselbe Dialog in jedem Durchlauf.
    const v = repo.vergessenRemote(a.id);
    if (!v.ok) { toast(v.error || 'Konnte nicht vermerken, dass das Projekt neu hochgeladen werden soll.', 'bad', 8000); return { ok: true }; }
    abgleichNochmal = true;
    return { ok: true };
  }

  const p = await sync.pull(a.id);
  if (!p.ok) return p;
  const d = deserialize(p.text);
  if (d.ok === false) return { ok: false, grund: 'fehler' };

  if (a.art === 'herunterladen') {
    // Nach dem Netz-await neu prüfen; übersprungen holt der nächste Durchlauf
    // es als normalen Konflikt (dirty + andere sha) nach.
    if (!ueberschreibenSicher(a.id)) { uebersprungen = true; return { ok: true }; }
    const offen = a.id === offenId();
    uebernehmen(d.plan, p.sha);
    if (d.hinweis) toast(d.hinweis, 'bad', 8000);
    else if (offen) toast('Neuere Fassung vom anderen Gerät geladen');
    return { ok: true };
  }

  // Konflikt. Gleicher Inhalt (z. B. derselbe Plan auf zwei Geräten
  // importiert) ist keiner: still als abgeglichen vermerken.
  const lokal = repo.load(a.id);
  if (lokal && gleicherPlan(lokal, d.plan)) { repo.markSynced(a.id, p.sha); return { ok: true }; }
  const wahl = await askDialog({
    title: 'Zwei verschiedene Fassungen',
    message: [`«${(lokal && lokal.project.name) || a.id}» wurde auf einem anderen Gerät geändert, und hier auch.`,
      'Welche Fassung soll gelten? Nichts wird ohne deine Wahl überschrieben.'],
    buttons: [
      { label: 'Meine behalten', value: 'mein', primary: true },
      { label: 'Die vom anderen Gerät nehmen', value: 'fremd', danger: true },
      { label: 'Beide behalten (Kopie)', value: 'beide' },
    ],
  });
  if (wahl === null) return { ok: false, grund: 'abgebrochen' };
  if (wahl === 'fremd') {
    // Auch im Dialog kann weitergetippt worden sein.
    const jetzt = repo.load(a.id);
    const offenUngesichert = a.id === offenId() && (saveTimer || store.dirty || ungesichert);
    if (offenUngesichert || (lokal && jetzt && !gleicherPlan(lokal, jetzt))) { uebersprungen = true; return { ok: true }; }
    uebernehmen(d.plan, p.sha);
    if (d.hinweis) toast(d.hinweis, 'bad', 8000);
    return { ok: true };
  }
  if (wahl === 'beide') {
    const kopie = deserialize(p.text, { newId: true }).plan;
    kopie.project.name += ' (anderes Gerät)';
    repo.save(kopie);           // ohne remoteSha → wird im nächsten Durchlauf hochgeladen
    abgleichNochmal = true;
  }
  return hochladen(sync, a.id, p.sha);
}

$('sync-verbinden').onclick = async () => {
  const token = $('sync-token').value.trim();
  if (!token) return toast('Bitte den Schlüssel eintragen.', 'bad');
  const r = await syncClient({ token, repo: SYNC_REPO }).pruefe();
  if (!r.ok) return toast(grundText(r), 'bad', 8000);
  try { window.localStorage.setItem(SYNC_KEY, JSON.stringify({ token, repo: SYNC_REPO })); }
  catch { return toast('Der Schlüssel konnte in diesem Browser nicht gespeichert werden.', 'bad', 8000); }
  $('sync-token').value = '';
  toast('Verbunden mit ' + SYNC_REPO);
  paintSyncInfo();
  abgleichen();
};
$('sync-trennen').onclick = () => {
  try { window.localStorage.removeItem(SYNC_KEY); } catch { /* Privatmodus */ }
  clearTimeout(uploadTimer);
  setSyncState(null);
  paintSyncInfo();
  toast('Getrennt — die lokalen Pläne bleiben.');
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') abgleichen(); });
window.addEventListener('online', () => abgleichen());

// Mit aktivem Sync wird ein hochgeladenes Projekt NUR gelöscht, wenn das Entfernen
// im Daten-Repo gelingt — sonst käme es beim nächsten Abgleich zurück.
// Liefert true = lokal löschen erlaubt.
async function loescheImDatenRepo(id, sha) {
  const k = syncKonfig();
  if (!k) return true;
  const r = await syncClient(k).remove(id, sha);
  if (r.ok) return true;
  toast(r.grund === 'konflikt'
    ? 'Das Projekt wurde auf einem anderen Gerät geändert – erst abgleichen, dann löschen.'
    : 'Löschen braucht Verbindung zu GitHub – das Projekt bleibt erhalten.', 'bad', 8000);
  return false;
}

// ── Anderer Tab ─────────────────────────────────────────────────────────────
// Zwei Tabs desselben Browsers teilen localStorage. Ohne diesen Block schreibt
// jeder Autosave den vollen Stand und überschreibt still, was der andere Tab
// gespeichert hat. `storage` feuert nur im ANDEREN Tab, nie im schreibenden.
// Eigene Bedingung statt ueberschreibenSicher(): dessen dirty-Merker meint
// «noch nicht hochgeladen» — den setzt jeder fremde Speichervorgang, auch ohne Sync.
const tabUngesichert = () => !!(saveTimer || store.dirty || ungesichert);
let tabPruefung = false, tabNochmal = false;

// Im anderen Tab gelöscht: weder Plan noch Indexeintrag. Nie wieder anlegen.
// Ein nie gesichertes Projekt (Speicher voll) fehlt ebenfalls — das ist keine Löschung.
function geloeschtImAnderenTab(id) {
  if (ungesichert || repo.load(id) || repo.list().some((x) => x.id === id)) return false;
  verworfen.add(id);
  clearTimeout(saveTimer); saveTimer = null;
  toast('Dieses Projekt wurde in einem anderen Tab gelöscht.', 'bad', 8000);
  showProjectDialog({ firstRun: !repo.list().length });
  return true;
}

// open() ersetzt den Inhalt (gleiche id, fragt nie) und sichert selbst; das
// store.replace löst aber über das Abonnement einen 800-ms-Autosave aus. Der
// bliebe als «ungesichert» stehen und ließe die nächste fremde Änderung
// fälschlich als Konflikt erscheinen.
async function uebernimm(plan) {
  if (!(await open(plan))) return;
  clearTimeout(saveTimer); saveTimer = null;
}

async function pruefeAndererTab() {
  if (!store) return;
  const id = offenId();
  if (verworfen.has(id)) return;
  const plan = repo.load(id);    // Schnappschuss: nur DIESER Stand ist «der aus dem anderen Tab»
  if (!plan) { geloeschtImAnderenTab(id); return; }
  if (gleicherPlan(store.state, plan)) return;
  if (!tabUngesichert()) {
    await uebernimm(plan);
    toast('In einem anderen Tab geändert — übernommen');
    return;
  }
  // Der Autosave darf während der Frage nicht laufen: er schriebe meinen Stand
  // über den fremden, bevor jemand gewählt hat. store.dirty/ungesichert bleiben.
  clearTimeout(saveTimer); saveTimer = null;
  const wahl = await askDialog({
    title: 'Dieses Projekt wurde in einem anderen Tab geändert',
    message: [`«${plan.project.name}» wurde in einem anderen Tab gespeichert, und hier gibt es ungesicherte Änderungen.`,
      'Welche Fassung soll gelten? Nichts wird ohne deine Wahl überschrieben.'],
    buttons: [
      { label: 'Meine behalten', value: 'meine', primary: true },
      { label: 'Die aus dem anderen Tab nehmen', value: 'fremd', danger: true },
      { label: 'Beide behalten (Kopie)', value: 'beide' },
    ],
  });
  // Während des Dialogs gelöscht: weder übernehmen noch neu anlegen.
  if (geloeschtImAnderenTab(id)) return;
  // Der andere Tab kann während des Dialogs weitergespeichert haben: «fremd» und
  // «beide» nehmen den Stand von JETZT, nicht den vom Öffnen des Dialogs (der
  // Autosave ruht, mein Stand ist noch nicht geschrieben, das Lesen ist sicher).
  // Der Schnappschuss `plan` dient nur noch dem Dialogtext.
  const neu = (wahl === 'fremd' || wahl === 'beide') ? repo.load(id) : null;
  if ((wahl === 'fremd' || wahl === 'beide') && !neu) { geloeschtImAnderenTab(id); return; }
  if (wahl === 'fremd') { await uebernimm(neu); return; }
  if (wahl === 'beide') {
    const kopie = JSON.parse(JSON.stringify(neu));
    kopie.project.id = 'p' + Date.now().toString(36);
    kopie.project.name = neu.project.name + ' (anderer Tab)';
    delete kopie.project.quelle;
    const r = repo.save(kopie);
    if (!r.ok) { toast(r.error, 'bad', 8000); return; }
    toast('Der Stand aus dem anderen Tab liegt als Kopie vor.');
  }
  // «Meine behalten», «Beide» und Abbruch (null): mein Stand gilt, sofort —
  // kein Pfad bleibt still.
  await save();
}

// Ein Lauf zur Zeit; Ereignisse während Dialog oder Übernahme lösen genau eine
// weitere Prüfung aus (das letzte gewinnt, kein zweiter Dialog).
async function fremderTab(e) {
  if (e.storageArea && e.storageArea !== window.localStorage) return;
  if (e.key !== null && e.key !== 'bzp_projects' && e.key !== 'bzp_p_' + offenId()) return;
  if (tabPruefung) { tabNochmal = true; return; }
  tabPruefung = true;
  try {
    do { tabNochmal = false; await pruefeAndererTab(); } while (tabNochmal);
  } finally { tabPruefung = false; }
}
window.addEventListener('storage', (e) => { fremderTab(e).catch((err) => console.error(err)); });

// ── Der Tag ─────────────────────────────────────────────────────────────────
// EIN Kalender-Knopf für beide Modi — «welcher Tag» ist dieselbe Frage, ob im
// Bauzeitenplan oder im Showablauf; nur die Antwort wirkt verschieden (dort
// springt die Achse, hier wechselt der Showtag).
//
// Angeboten wird ausschließlich, was im Plan auch steht: `programmTage` zählt
// die Kalendertage, die von einem Vorgang berührt werden (über Mitternacht
// laufende zählen auf beiden Tagen). Ein freies `<input type="date">` stand
// vorher hier und ließ einen auf einen Tag springen, an dem kein einziger
// Vorgang liegt — man landete vor einem leeren Blatt, ohne zu wissen warum.

/** Die Tage, die der aktive Modus überhaupt kennt. */
const planTage = () => programmTage(sichtTasks(store.state, ebene));

// «Mi 02.09.», nicht «Mi., 02.09.» — das gebündelte Format setzt hinter die
// abgekürzte Wochentagsform noch einen Punkt UND ein Komma, und in Versalien
// («MI., 02.09.») liest sich das wie ein Tippfehler.
const tagText = (iso) => {
  const d = new Date(iso + 'T12:00');
  const wt = d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
  return wt + ' ' + String(d.getDate()).padStart(2, '0') + '.'
    + String(d.getMonth() + 1).padStart(2, '0') + '.';
};

/** Der Tag, auf den der Knopf gerade zeigt. */
const aktiverTag = () => (ebene === 'show' ? showTag : gantt.centerDayIso());

function syncTagKnopf() {
  const knopf = $('tag-wahl');
  // Im Bauzeitenplan ist ein Tagessprung nur in der Plan-Darstellung eine
  // Aussage — die Tabelle zeigt dort alle Tage zugleich. Im Showablauf filtert
  // der Tag auch die Tabelle und den Bedarf, dort steht der Knopf immer.
  knopf.hidden = ebene === 'bau' && view !== 'gantt';
  const t = aktiverTag();
  knopf.textContent = t ? '🗓 ' + tagText(t) : '🗓 Tag';
}

/** Die Auswahl. Nutzt das vorhandene Kontextmenü — es kann Anker, Klick
 *  daneben, Escape und Fokus schon, ein zweiter schwebender Kasten wäre
 *  dieselbe Logik ein zweites Mal. */
function tagWahl(anker) {
  const tage = planTage();
  const jetzt = aktiverTag();
  const r = anker.getBoundingClientRect();
  if (!tage.length) {
    openMenu(r.left, r.bottom + 4, [{ label: 'Noch kein Tag im Plan', disabled: true }]);
    return;
  }
  const items = tage.map((iso) => ({
    label: tagText(iso),
    hint: 'KW ' + isoWeek(new Date(iso + 'T12:00')) + (iso === jetzt ? ' ●' : ''),
    run: () => {
      if (ebene === 'show') { showTag = iso; setAnsicht(ansicht); return; }
      gantt.goToDay(iso);
      syncTagKnopf();
    },
  }));
  openMenu(r.left, r.bottom + 4, items);
}

// ── Ebene wechseln ──────────────────────────────────────────────────────────
// Der EINZIGE Ort, der über die Ansicht entscheidet. Gantt und Tabelle bekommen
// Ebene und Abschnitt gereicht; der Rest der Kopfzeile richtet sich danach aus.
function setAnsicht(name) {
  ansicht = ANSICHTEN.includes(name) ? name : 'bau';
  ebene = ebeneVon(ansicht);
  abschnitt = abschnittVon(ansicht);
  // Der Klick auf «Showablauf» in der Schiene soll dorthin zurückkehren, wo man
  // war — wer zuletzt im Setup stand, will nicht in der Running Order landen.
  if (ansicht !== 'bau') letzteShowAnsicht = ansicht;
  lsSchreibe('bzp_ansicht', ansicht);
  // Drucken meint den Modus: Bauzeitenplan → Tagesblätter, sonst die Running
  // Order mit dem aktuellen Abschnitt.
  $('drucken').dataset.href = ansicht === 'bau' ? 'print.html' : 'print.html?ansicht=' + ansicht;
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
  bedarf.setEbene(ebene, ausBlend, showTag, abschnitt);
  rail.setEbene(ebene);
  // Die Auswahl gehört der anderen Ebene und zeigt ins Leere.
  gantt.select(null);
  syncPanel();
  syncBuehnen();
  // Nur der Showablauf hat Abschnitte, nur der Bauzeitenplan Zeitwerkzeuge.
  // Was im aktiven Modus nichts bedeutet, steht nicht da.
  $('seg-abschnitt').hidden = ebene !== 'show';
  document.querySelector('.hd-zoom').hidden = view !== 'gantt' || ebene !== 'bau';
  syncTagKnopf();
  if (view === 'tabelle') renderTable();
  if (view === 'bedarf') bedarf.render();
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

  // Der Showtag steht NICHT mehr hier, sondern in der Schiene: er entscheidet,
  // WELCHER Ablauf gezeigt wird, und ist damit Navigation, keine Filterung.
  // Übrig bleiben die Bühnen-Häkchen — sie entscheiden, WESSEN.
  for (const g of buehnen) {
    const lab = el('label', 'buehne-i');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !ausBlend.has(g.id);
    cb.onchange = () => {
      cb.checked ? ausBlend.delete(g.id) : ausBlend.add(g.id);
      gantt.setEbene(ebene, ausBlend, showTag, abschnitt);
      table.setEbene(ebene, ausBlend, showTag, abschnitt);
      bedarf.setEbene(ebene, ausBlend, showTag, abschnitt);
      if (view === 'tabelle') renderTable();
      if (view === 'bedarf') bedarf.render();
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

// ── Suche: zum Treffer springen ──────────────────────────────────────────────
// Der EINZIGE Ort, der aus einem Treffer eine Ansicht macht. Reihenfolge:
// erst Modus/Abschnitt/Tag/Bühne über die vorhandenen Schreiber (setAnsicht,
// showTag, ausBlend) — nie ansicht/ebene/abschnitt direkt —, dann auswählen
// und hinscrollen. setAnsicht() setzt die Auswahl zurück, also kommt sie danach.
function springeZu(id) {
  const t = store.state.tasks.find((x) => x.id === id);
  if (!t) return;
  let ziel = ansicht;
  if (ebene === 'show') {
    // Der Eintrag zählt zu genau einem Abschnitt und (über Mitternacht: zu
    // seinem Starttag zuerst) zu einem Tag. Beides muss stimmen, sonst blendet
    // der Filter den Treffer sofort wieder aus.
    ziel = abschnittOf(t) === 'setup' ? 'setup' : 'show';
    const tage = programmTage(sichtTasks(store.state, 'show'));
    const start = ohneTermin(t) ? null : String(t.start).slice(0, 10);
    // Ohne Termin gibt es keinen Tag, zu dem man springen könnte: der Tag bleibt.
    const tag = ohneTermin(t) ? showTag : tage.includes(start) ? start
      : tage.find((d) => amTag([t], d).length) || showTag;
    showTag = tag;
    ausBlend.delete(t.gewerk);               // abgehakte Bühne: Treffer zeigen
    setAnsicht(ziel);
  } else if (ziel !== 'bau') {
    setAnsicht('bau');
  }
  if (view === 'bedarf') setView('gantt');    // der Bedarf kennt keinen einzelnen Vorgang
  if (view === 'tabelle') {
    gantt.select({ kind: 'task', id });
    table.zeige(id);
    return;
  }
  gantt.reveal(id);
  syncTagKnopf();
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
    const raw = JSON.parse(lsLies(VZ_KEY) || '{}');
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
  if (speichern) lsSchreibe(VZ_KEY, JSON.stringify({ min: v, tag: versatzTag() }));
  refreshLive();
}

// ── Live ────────────────────────────────────────────────────────────────────
function setLive(on) {
  gantt.setLive(on);
  lsSchreibe('bzp_live', on ? '1' : '0');
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
  // Die Leiste zählt die Sicht, wie die Show-Kopfzeile (sonst zählt sie Vorgänge,
  // die gerade gar nicht zu sehen sind).
  const st = liveStats(gantt.sichtbareTasks(), gantt.liveInfo().planNow, buehnenIds(store.state));
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

  // Verzug NUR aus dem, was noch aussteht oder läuft (Regel in live.js, auch fürs Zeilen-⚠).
  const verzug = offeneVerspaetungen(punkte, now, buehnenIds(store.state));

  // Ein Changeover ist kein Auftritt — er wird als Umbau angesagt, sonst stünde
  // «JETZT: Changeover» da, wo das Publikum einen Namen erwartet. Trägt der
  // Titel das Wort schon, bleibt es bei einem: «Changeover: Changeover» war das
  // erste, was auf dem Probebild auffiel.
  const ansage = (t) => {
    const typ = typHinweis(t, store.state);
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
      { label: count ? `Löschen (${count} ${count === 1 ? 'Vorgang' : 'Vorgänge'})` : 'Löschen', danger: true, run: () => loescheGewerk(g.id) },
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
    { label: t.milestone ? 'In Vorgang zurückverwandeln' : 'Zu Meilenstein machen',
      disabled: ohneTermin(t), run: () => {
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
// Ein gescheitertes Sichern lässt store.dirty NICHT stehen (store.replace setzt
// es zurück, bevor save() läuft). Deshalb merkt sich das EINE Variable: gesetzt
// bei Fehlschlag, gelöscht bei Erfolg — Wechsel und Neuladen fragen sie ab.
let ungesichert = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  setSaveState('dirty');
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 800);
}
// Entfernt ein Projekt; ein Schreibfehler des Index wird gemeldet, ändert aber
// den Ablauf nicht.
// Gelöschte Projekt-ids, die noch im Store stehen (offenes Projekt ohne
// Alternative): sichern() und beforeunload lassen sie in Ruhe.
const verworfen = new Set();

// Löscht lokal. Das OFFENE Projekt wird vorher verlassen (open() sichert das
// bisherige und fragt bei Fehlschlag); nur wenn der Nutzer den Wechsel abbricht,
// bleibt alles stehen. `vorEntfernen` (async, true = weiter) läuft NACH dem
// Verlassen und VOR dem lokalen Entfernen: der Dialog löscht darin im Daten-Repo,
// damit ein abgebrochener Wechsel nichts im Repo anrichtet. Gibt false zurück,
// wenn nichts gelöscht wurde.
async function loescheProjekt(id, vorEntfernen) {
  // Während des Löschens kein Abgleich über diese id (der Wechsel startet einen):
  // die Datei kann im Repo schon weg sein, das Projekt ist aber gewollt gelöscht.
  verworfen.add(id);
  const weiter = async () => !vorEntfernen || vorEntfernen();
  if (id === offenId()) {
    const anderes = repo.list().find((x) => x.id !== id);
    const plan = anderes && repo.load(anderes.id);
    if (plan) {
      // Das zu löschende Projekt nicht mehr sichern: open() würde es sonst
      // noch einmal ablegen, bevor entferne() es entfernt.
      if (!(await open(plan))) { verworfen.delete(id); return false; }
    } else {
      if (!(await weiter())) { verworfen.delete(id); return false; }
      clearTimeout(saveTimer); saveTimer = null;
      entferne(id);
      showProjectDialog({ firstRun: true });
      return true;
    }
  }
  if (!(await weiter())) { verworfen.delete(id); return false; }
  entferne(id);
  return true;
}

function entferne(id) {
  const r = repo.remove(id);
  if (!r.ok) toast(r.error, 'bad', 8000);
  return r;
}
// EIN Weg, den Stand zu sichern und den Zustand anzuzeigen — für save() und
// den Projektwechsel in open(). `still`: kein Toast (der Aufrufer fragt selbst).
async function sichern({ loud = false, still = false } = {}) {
  if (!store) return { ok: true };
  // Ein gelöschtes offenes Projekt bleibt bis zum Wechsel im Store; Speichern
  // legte es sonst wieder an (und mit Sync auch im Daten-Repo).
  if (verworfen.has(store.state.project.id)) { ungesichert = false; return { ok: true }; }
  // await ist für localStorage folgenlos (synchrones Objekt) und lässt den
  // PocketBase-Durchschrieb (Promise) sein Ergebnis melden.
  const r = await repo.save(store.state);
  ungesichert = !r.ok;
  if (r.ok) {
    store.markSaved();
    setSaveState('saved');
    if (loud) toast('Gesichert');
    if (repo.syncInfo(store.state.project.id).dirty) planeUpload();
  } else {
    setSaveState('error');
    if (!still) toast(r.error, 'bad', 8000);
  }
  return r;
}
async function save(loud = false) { await sichern({ loud }); }
function setSaveState(s) {
  const n = $('save-state');
  n.dataset.state = s;
  n.textContent = s === 'saved' ? 'gesichert' : s === 'dirty' ? 'ungesichert …' : 'NICHT gesichert!';
}

// ── Kopfzeile ───────────────────────────────────────────────────────────────
// «heute: Aufbau» / «heute: Show-Tag 2» — nur, wenn heute in einer Phase liegt.
// Gerechnet gegen die ECHTE Uhr (liveInfo().now), nie gegen den Versatz: der
// verschiebt den Ablauf eines Abends, nicht den Kalender.
function syncPhaseHeute() {
  const n = $('phase-heute');
  if (!n || !store || !gantt) return;
  const jetzt = phasenJetzt(store.state.phases, gantt.liveInfo().now);
  n.hidden = !jetzt.length;
  if (!jetzt.length) { n.textContent = ''; delete n.dataset.art; return; }
  n.dataset.art = jetzt[0].art;
  n.style.setProperty('--ph-c', 'var(--ph-' + jetzt[0].art + ')');
  n.textContent = 'heute: ' + jetzt.map((x) => x.text).join(' · ');
}

function refreshChrome() {
  const S = store.state;
  $('proj-name').textContent = S.project.name;
  $('proj-venue').textContent = S.project.venue || '';
  document.title = S.project.name + ' — Bauzeitenplan';

  // Datumsfeld an das (evtl. neue) Projekt anpassen.
  syncTagKnopf();
  syncPhaseHeute();

  const st = gantt.stats();
  $('kpis').innerHTML = [
    [ebene === 'show' ? 'Bühnen' : 'Gewerke', st.gewerke],
    [ebene === 'show' ? 'Zeiteinträge' : 'Vorgänge', st.total],
    ['läuft', st.run],
    ['Crew', st.crew],
  ].map(([k, v]) => `<div class="kpi"><div class="kpi-v">${v}</div><div class="kpi-k">${k}</div></div>`).join('');

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

// ── Gewerk löschen ──────────────────────────────────────────────────────────
// EINE Umsetzung für Rechtsklick im Plan und die Einrichten-Seite: Rückfrage mit
// der Zahl der Vorgänge, die mitgehen, dann ein Befehl (⌘Z holt alles zurück).
async function loescheGewerk(id) {
  const g = store.state.gewerke.find((z) => z.id === id);
  if (!g) return;
  const count = store.state.tasks.filter((t) => t.gewerk === g.id).length;
  const ok = await askDialog({
    title: 'Gewerk löschen?',
    message: [count
      ? `«${g.name}» löschen? ${count} ${count === 1 ? 'Vorgang geht' : 'Vorgänge gehen'} mit. ⌘Z holt alles zurück.`
      : `«${g.name}» löschen?`],
    buttons: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, danger: true }],
  });
  if (!ok) return;
  return apply({ type: 'removeGewerk', id: g.id });
}

// ── Gewerk anlegen ──────────────────────────────────────────────────────────
// `art` ('gewerk' | 'buehne') nennt die Einrichten-Seite; ohne sie entscheidet
// die Ebene (leerer Gantt, Rechtsklick).
function addGewerk(anker, art) {
  const buehne = (art || (ebene === 'show' ? 'buehne' : 'gewerk')) === 'buehne';
  const wort = buehne ? 'Bühne' : 'Gewerk';
  // Je Art gezählt: Gewerke und Bühnen teilen sich die Palette nicht, weil sie
  // nie zusammen zu sehen sind (freeSlot in store.js rechnet ebenso).
  const da = sichtGewerke(store.state, buehne ? 'show' : 'bau').length;
  if (slotsExhausted(da + 1)) {
    toast(`Mehr als ${MAX_SLOTS} ${wort}e: ab hier trägt die Farbe die Zuordnung nicht mehr, nur noch der Name.`, 'warn', 7000);
  }
  // Eigener App-Kasten statt window.prompt — derselbe schwebende Kasten wie
  // beim Anlegen einer Eintragsart, nur mit einer anderen Befehlsform: der
  // Name gehört hier in gewerk.name, nicht obenauf als label.
  table.openNeuFragen({
    titel: buehne ? 'Name der Bühne (z. B. Hauptbühne, Zelt, Halle 3)' : 'Name des Gewerks',
    buildCmd: (name) => ({ type: 'addGewerk', gewerk: { name, art: buehne ? 'buehne' : 'gewerk' } }),
  }, anker instanceof Element ? anker : $('proj-knopf'), () => syncBuehnen());
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
  let r;
  try { r = deserialize(await f.text()); }
  catch (err) { return toast('Die Datei lässt sich nicht lesen: ' + ((err && err.message) || err), 'bad', 8000); }
  if (r.ok === false) return toast(r.error, 'bad', 8000);
  if (r.hinweis) toast(r.hinweis, 'bad', 8000);
  const name = r.plan.project.name;

  // Schon Projekte mit gleichem Namen da? Fragen, ob ersetzen (alte weg, nur
  // diese Datei) oder zusätzlich importieren — sonst sammeln sich Duplikate.
  const dupes = repo.list().filter((p) => p.name === name);
  let choice = null;
  if (dupes.length) {
    choice = await askDialog({
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
    if (choice !== 'replace') r.plan.project.id = 'p' + Date.now().toString(36);
  }

  // Erst öffnen, dann die Alten entfernen: bricht der Nutzer den Wechsel ab,
  // darf nichts gelöscht sein. Dieselbe id überschreibt open() ohnehin.
  if (!(await open(r.plan))) return;
  const weg = choice === 'replace' ? dupes.filter((p) => p.id !== r.plan.project.id) : [];
  for (const p of weg) entferne(p.id);
  $('dlg').hidden = true;      // sonst bleibt der Anlege-Dialog über allem liegen
  // Die alten Fassungen waren der Platz: erst jetzt kann der neue Plan passen.
  // Scheitert es weiter, steht der Speicherfehler da — kein «importiert».
  if (weg.length && ungesichert && !(await sichern()).ok) return;
  toast('«' + name + '» importiert');
}

// ── Projektdialog ───────────────────────────────────────────────────────────
function showProjectDialog({ firstRun = false }) {
  const dlg = $('dlg');
  dlg.replaceChildren();

  const box = el('div', 'dlg-box');
  box.append(el('h2', 'dlg-h', firstRun ? 'Bauzeitenplan' : 'Projekte'));
  const list = repo.list();
  if (firstRun) box.append(el('p', 'dlg-sub', list.length
    ? 'Öffne ein Projekt oder leg ein neues an. Alles bleibt in diesem Browser; sichere regelmäßig per Export.'
    : 'Leg ein Projekt an — aus einer Vorlage oder leer. Alles bleibt in diesem Browser; sichere regelmäßig per Export.'));

  // Bestehende Projekte

  if (list.length) {
    box.append(el('h3', 'dlg-h3', 'Öffnen'));
    const ul = el('div', 'dlg-list');
    for (const p of list) {
      const row = el('div', 'dlg-row');
      const b = el('button', 'dlg-open');
      b.append(el('span', 'dlg-open-n', p.name));
      b.append(el('span', 'dlg-open-m', (p.venue ? p.venue + ' · ' : '') + 'geändert ' + new Date(p.modified).toLocaleString('de-DE')));
      b.onclick = async () => {
        const pl = repo.load(p.id);
        if (!pl) return;
        if (await open(pl)) close();
      };
      const del = el('button', 'dlg-del', '×');
      del.title = 'Projekt löschen';
      del.onclick = async () => {
        const sha = repo.syncInfo(p.id).remoteSha;
        const zurSync = !!(syncKonfig() && sha);
        const ok = await askDialog({
          title: 'Projekt löschen?',
          message: [`«${p.name}» endgültig löschen? Das lässt sich nicht rückgängig machen — exportiere vorher, wenn du unsicher bist.`,
            ...(zurSync ? ['Wird auch auf allen anderen Geräten gelöscht.'] : [])],
          buttons: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, danger: true }],
        });
        if (!ok) return;
        if (!(await loescheProjekt(p.id, () => !zurSync || loescheImDatenRepo(p.id, sha)))) return;
        // Ohne Alternative zeigt loescheProjekt den Erststart-Dialog selbst.
        if (repo.list().length) showProjectDialog({ firstRun: false });
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
  // Der Event als Zeitraum: Von/Bis. Die Vorlage bringt nur das Gerüst mit
  // (Vorgänge ohne Termin) — wann sie liegen, trägt man danach ein.
  const vonIn = el('input'), bisIn = el('input');
  vonIn.type = bisIn.type = 'date';
  vonIn.id = 'neu-von'; bisIn.id = 'neu-bis';
  const d = new Date(); d.setDate(d.getDate() + 14);
  vonIn.value = tagIso(d);
  d.setDate(d.getDate() + 2);
  bisIn.value = tagIso(d);

  form.append(field('Name', nameIn), field('Ort', venueIn), field('Von', vonIn), field('Bis', bisIn));
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
  create.onclick = async () => {
    if (!nameIn.value.trim()) { nameIn.focus(); return; }
    if (!vonIn.value) { toast('Bitte «Von» eintragen.', 'bad'); vonIn.focus(); return; }
    if (!bisIn.value) { toast('Bitte «Bis» eintragen.', 'bad'); bisIn.focus(); return; }
    if (bisIn.value < vonIn.value) { toast('«Bis» liegt vor «Von».', 'bad'); bisIn.focus(); return; }
    // Von = Mitternacht des ersten Tages, Bis = Mitternacht NACH dem letzten:
    // der letzte Eventtag steht ganz im Bild.
    const bisEnde = new Date(bisIn.value + 'T00:00'); bisEnde.setDate(bisEnde.getDate() + 1);
    const neu = planFromTemplate(chosen, { name: nameIn.value.trim(), venue: venueIn.value.trim(), von: vonIn.value + 'T00:00', bis: local(bisEnde) });
    neu.project.eingerichtet = false;     // nur hier: «Neu» führt einmal durch die Schritte
    if (await open(neu)) { close(); openEinrichten('projekt', { erst: true }); }
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

const tagIso = (d) => local(d).slice(0, 10);

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

// ── Plan verschieben ──────────────────────────────────────────────────────────
// Der ganze Plan wandert um Tage und Minuten (ein Befehl `shiftPlan`, ein ⌘Z).
// Die Vorschau ruft dieselbe Funktion wie der Store (`verschiebeZeit`) — eine
// zweite Rechnung wiche an der Zeitumstellung ab.
function verschobenText(iso, tage, minuten) {
  const n = new Date(toMin(verschiebeZeit(iso, tage, minuten)) * 60000);
  const p = (x) => String(x).padStart(2, '0');
  return p(n.getDate()) + '.' + p(n.getMonth() + 1) + '.' + (minuten !== 0 ? ' ' + p(n.getHours()) + ':' + p(n.getMinutes()) : '');
}

function verschiebeText(tage, minuten) {
  const t = Math.abs(tage), m = Math.abs(minuten);
  const teile = [];
  if (tage) teile.push((tage < 0 ? '−' : '') + t + (t === 1 ? ' Tag' : ' Tage'));
  if (minuten) teile.push((minuten < 0 ? '−' : '') + m + (m === 1 ? ' Minute' : ' Minuten'));
  return teile.join(' und ');
}

function showShiftDialog() {
  if (!store) return;
  const dlg = el('div', 'dlg');
  const box = el('div', 'dlg-box');
  box.append(el('h2', 'dlg-h', 'Plan verschieben'));
  box.append(el('p', 'dlg-sub', 'Verschiebt alle Vorgänge, Phasen und den Projektrahmen. Negative Werte ziehen vor.'));

  const form = el('div', 'dlg-form');
  const feld = (label, cls, text) => {
    const w = el('label', 'dlg-f');
    w.append(el('span', '', label));
    const i = el('input', cls);
    // Stunden:Minuten braucht einen Doppelpunkt, den ein number-Feld nicht trägt.
    if (text) { i.type = 'text'; i.setAttribute('inputmode', 'numeric'); i.placeholder = 'h:mm oder Minuten'; }
    else { i.type = 'number'; i.step = '1'; }
    i.value = '0';
    w.append(i);
    form.append(w);
    return i;
  };
  const tageI = feld('Tage', 'sv-tage');
  const minI = feld('Stunden:Minuten', 'sv-min', true);
  box.append(form);
  const vorschau = el('p', 'dlg-sub sv-vorschau');
  box.append(vorschau);

  const actions = el('div', 'dlg-act');
  const abbr = el('button', 'btn', 'Abbrechen');
  const ok = el('button', 'btn btn-p', 'Verschieben');
  actions.append(abbr, ok);
  box.append(actions);
  dlg.append(box);

  // Ganzzahl innerhalb der Store-Grenze oder null: leer, «1.5», Exponenten und
  // Riesenwerte gelten als ungültig (sonst Invalid Date und «NaN.NaN.»).
  const zahl = (i, max) => {
    if (!/^-?\d+$/.test(i.value.trim())) return null;
    const n = Number(i.value.trim());
    return Math.abs(n) <= max ? n : null;
  };
  // Stunden:Minuten: «h:mm», «-h:mm» oder reine Minuten («90», «-30»); in Minuten
  // umgerechnet, der Store bleibt bei {tage, minuten}. Minutenteil immer zweistellig.
  const hm = (i, max) => {
    const w = i.value.trim();
    const m = /^(-?)(\d+):([0-5]\d)$/.exec(w);
    if (!m) return zahl(i, max);
    const n = (m[1] ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    return Math.abs(n) <= max ? n : null;
  };
  const aktualisiere = () => {
    const tage = zahl(tageI, SHIFT_MAX_TAGE), minuten = hm(minI, SHIFT_MAX_MIN);
    const gueltig = tage !== null && minuten !== null && (tage !== 0 || minuten !== 0);
    ok.disabled = !gueltig;
    const S = store.state;
    const ph = aufbauPhase(S.phases);
    const alt = ph ? ph.start : S.project.start;
    const was = ph ? 'Aufbaubeginn' : 'Projektbeginn';
    vorschau.textContent = alt && tage !== null && minuten !== null
      ? `${was} ${verschobenText(alt, 0, 0)} → ${verschobenText(alt, tage, minuten)}`
      : '';
  };
  tageI.oninput = minI.oninput = aktualisiere;

  const finish = () => { document.removeEventListener('keydown', onKey); dlg.remove(); };
  const geben = () => {
    if (ok.disabled) return;
    const tage = zahl(tageI, SHIFT_MAX_TAGE), minuten = hm(minI, SHIFT_MAX_MIN);
    const r = apply({ type: 'shiftPlan', tage, minuten });
    if (r && r.ok === false) return;     // apply() hat den Grund schon gezeigt; Fenster bleibt für die Korrektur
    finish();
    toast(`Plan um ${verschiebeText(tage, minuten)} verschoben — ⌘Z nimmt es zurück`);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') finish();
    // Enter auf «Abbrechen» gehört dem Knopf, nicht dem Verschieben.
    else if (e.key === 'Enter' && e.target !== abbr) { e.preventDefault(); geben(); }
  };
  abbr.onclick = finish;
  ok.onclick = geben;
  dlg.onclick = (e) => { if (e.target === dlg) finish(); };
  document.addEventListener('keydown', onKey);
  document.body.append(dlg);
  aktualisiere();
  tageI.focus();
  tageI.select();
}

// ── Prüf-Liste ────────────────────────────────────────────────────────────────
// Zeigt, WELCHE Vorgänge im Konflikt sind, und lässt je Eintrag entscheiden:
// zeigen (auswählen + hinscrollen), lösen (früheste Lage) oder als „ist ok"
// abhaken. Eine Quelle: gantt.conflicts().
let reviewClose = null;
function openReview() {
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
  }

  renderBody();
  unsub = store.subscribe(renderBody);     // hält die Liste live aktuell
  reviewClose = finish;
  dlg.onclick = (e) => { if (e.target === dlg) finish(); };
  document.addEventListener('keydown', onKey);
  document.body.append(dlg);
}

$('undo').onclick = () => store && store.undo();
$('redo').onclick = () => store && store.redo();
$('plan-verschieben').onclick = showShiftDialog;

// ── Projektmenü (Kopfzeile) ─────────────────────────────────────────────────
// Ein Knopf, ein Menü (openMenu); die Einträge rufen benannte Funktionen. Nichts
// davon hängt an einem dauerhaft vorhandenen Knopf: Neu und Import müssen schon
// beim allerersten Start gehen (kein Projekt, kein mount()) — der Projektdialog
// bietet «JSON importieren» an, und `import-file` wird auf Modulebene verdrahtet.
const neuesProjekt = () => showProjectDialog({});
const projekteWaehlen = () => showProjectDialog({});
const importieren = () => $('import-file').click();
const exportieren = () => { if (store) doExport(); };

function oeffneSpeicherort() {
  paintSyncInfo();
  $('sync-dlg').hidden = false;
  $('sync-token').focus();
}
function schliesseSpeicherort() { $('sync-dlg').hidden = true; }
$('sync-zu').onclick = schliesseSpeicherort;
$('sync-dlg').onclick = (e) => { if (e.target === $('sync-dlg')) schliesseSpeicherort(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('sync-dlg').hidden) { e.preventDefault(); schliesseSpeicherort(); }
});

function projektMenue() {
  const r = $('proj-knopf').getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, [
    { id: 'new-proj', label: '＋ Neu…', run: neuesProjekt },
    { id: 'proj-menu', label: '📂 Projekte…', run: projekteWaehlen },
    { id: 'import', label: '⬆ Import…', run: importieren },
    { id: 'export', label: '⬇ Export', disabled: !store, run: exportieren },
    null,
    { id: 'sync-oeffnen', label: '☁ Speicherort…', run: oeffneSpeicherort },
  ]);
}
$('proj-knopf').onclick = projektMenue;
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
  b.setAttribute('aria-label', b.title);
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
  paintSyncInfo();
  boot();
}
main();
