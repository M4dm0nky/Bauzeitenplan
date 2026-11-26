// ── Einstiegspunkt ────────────────────────────────────────────────────────────
// Hält Store, Ablage und Ansichten zusammen. Bewusst dünn: alles Fachliche liegt
// in store.js (Befehle), schedule.js (Termine), conflicts.js (Konflikte),
// gantt.js (Darstellung) und table.js (Eingabe).

import { createStore, verschiebeZeit, SHIFT_MAX_TAGE, SHIFT_MAX_MIN } from './store.js';
import { createRepo, serialize, deserialize } from './persistence.js';
import { createPb, apiBasis, ERNEUERN_MS } from './pb.js';
import { createServerPlan, listePlaene } from './server.js';
import { rechteFehler, darfPlanAnlegen } from './rechte.js';
import { anwenden, umkehren, aenderungen, istLeer, zerlegen, zusammensetzen } from './aenderungen.js';
import { eintragTitel, gruppen, fremdUebernehmen, ohne, meineBehalten, wiederherstellen, offeneSchluessel, uebernehmeOhneOffene } from './konflikt.js';
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

// ── Start ───────────────────────────────────────────────────────────────────
// Der Plan lebt auf dem Server (PocketBase). Ohne Anmeldung gibt es nichts zu zeigen:
// zurück zur Anmeldeseite. (Ausnahme wird der Live-Monitor mit lokaler Kopie, Task 10.)
// `?plan=leer` ist der Schalter der Prüfwerkzeuge: angemeldet öffnet er das aktive,
// sonst das erste Projekt; der Dialog kommt, wenn es keines gibt.
const loginSeite = () => {
  const api = new URLSearchParams(location.search).get('api');
  return 'login.html' + (api ? '?api=' + encodeURIComponent(api) : '');
};
let zuLoginLaeuft = false;
// Anmeldung weg: zur Anmeldeseite. Einzige Ausnahme: der Live-Monitor (`bzp_live=1`) mit lokaler
// Kopie zeigt sie weiter («Anmeldung abgelaufen – lokale Kopie») und springt nie auf login.html.
// Manuelles Abmelden (grund 'manuell') gilt nie als Ausnahme: der Rechner kann geteilt sein.
function zuLogin(grund) {
  if (grund !== 'manuell' && lsLies('bzp_live') === '1' && zeigeKopie('abgemeldet')) return;
  if (zuLoginLaeuft) return;
  zuLoginLaeuft = true;
  location.replace(loginSeite());
}

async function boot() {
  if (!pb.istAngemeldet) { zuLogin(); return; }
  const live = lsLies('bzp_live') === '1';
  const leer = new URLSearchParams(location.search).get('plan') === 'leer';
  // Der Live-Monitor öffnet das aktive Projekt ohne Dialog; `?plan=leer` (Prüfwerkzeuge) auch.
  if (leer || live) {
    let liste = [];
    try { liste = await listePlaene(pb); } catch (e) {
      if (e.abgemeldet) { zuLogin(); return; }
      if (live && zeigeKopie('offline')) return;      // kein Netz: der Monitor zeigt die lokale Kopie
    }
    const aktiv = repo.getActive();
    const erstes = liste.find((p) => p.plan_id === aktiv) || (leer ? liste[0] : null);
    if (erstes && await open(erstes.plan_id, { still: live })) return;
    if (live && !store && zeigeKopie('offline')) return;
  }
  showProjectDialog({ firstRun: !store });
}

// Öffnet den Plan vom Server. true = offen, false = nicht geöffnet (Fehler gemeldet oder
// «Abbrechen» bei ungesendeten Änderungen des bisherigen Plans).
async function open(planId, { still = false } = {}) {
  await ablauf;     // laufende Sendungen und Konfliktfragen des bisherigen Plans abwarten
  if (server && (server.offen.length || geparkt.length)) {
    const wahl = await askDialog({
      title: 'Ungesendete Änderungen',
      message: [`In «${store.state.project.name}» gibt es Änderungen, die noch nicht beim Server angekommen sind.`,
        'Beim Wechsel gehen sie verloren.'],
      buttons: [
        { label: 'Abbrechen', value: null, primary: true },
        { label: 'Verwerfen und wechseln', value: 'weg', danger: true },
      ],
    });
    if (wahl !== 'weg') return false;
  }
  const srv = createServerPlan({ pb, planId });
  const r = await srv.laden();
  if (!r.ok) { if (!still || r.abgemeldet) await ladeFehler(r); return false; }

  const wechsel = !!store;
  const andereId = wechsel && store.state.project.id !== r.state.project.id;
  schliesseServer();
  server = srv;
  rolle = r.rolle;
  offline = false;
  kopieModus = null; clearTimeout(kopieWiederTimer);
  if (store) {
    // Ein anderes Projekt (auch «Neu») schließt die Einrichten-Seite des bisherigen —
    // direkt vor dem Ersetzen, damit «eingerichtet» noch zum alten Plan gehört.
    if (andereId) { einScroll = null; closeEinrichten(); }
    store.replace(r.state);
    // Der Gantt des neuen Projekts hat sich selbst auf den Aufbau eingepasst — der
    // Scrollstand, den die Einrichten-Seite beim Öffnen gemerkt hat, gehört dem alten.
    einScroll = null;
    // Ein Versatz gilt dem Abend, den man gerade fährt — nicht dem nächsten Projekt.
    if (andereId) setVersatz(0);
  } else {
    store = createStore(r.state, storeOptionen());
    mount();
  }
  stopAbo = srv.abonnieren(beiFremd);
  repo.setActive(r.state.project.id);   // wirft nie (persistence.js)
  refreshChrome();
  kopieSchreiben();
  syncNurAnsicht();
  paintSpeicher();
  return true;
}

// Meldung zu einem gescheiterten Laden. Abgemeldet → Anmeldeseite.
async function ladeFehler(r) {
  if (r.abgemeldet) { zuLogin('401'); return; }
  const text = r.offline ? 'Keine Verbindung zum Server. Der Plan lässt sich nur mit Verbindung öffnen.'
    : r.nichtGefunden ? 'Dieser Plan existiert nicht mehr oder du hast keinen Zugriff darauf.'
      : 'Der Plan konnte nicht geladen werden' + (r.fehler?.message ? ': ' + r.fehler.message : '.');
  await askDialog({ title: 'Nicht geöffnet', message: [text], buttons: [{ label: 'OK', value: true, primary: true }] });
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
      // Seite schon offen: nichts tun (geführtes Einrichten und Bereich bleiben).
      einrichten: () => { if (!einrichten?.offen) openEinrichten(); },
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
    blockiert: () => !!document.querySelector('.dlg:not([hidden])') || !!document.querySelector('.col.ist-ein'),
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
  bedarf = createBedarf($('bd'), {
    store, onEinrichten: (tab) => openEinrichten(tab),
    neuFragen: (opt, ankerEl, fertig) => table.openNeuFragen(opt, ankerEl, fertig),
  });
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
  // Neu aufgebaute Felder (Panel, Tabelle, Einrichten, Bedarf) erben die Sperre der Nur-Ansicht.
  const sperrBeob = new MutationObserver(() => { if (document.body.classList.contains('nur-ansicht')) felderSperren(true); });
  for (const id of SPERR_WURZELN) if ($(id)) sperrBeob.observe($(id), { childList: true, subtree: true });

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

  store.subscribe((_s, info) => {
    // Eigene Änderungen (lokal, Undo, Redo) gehen an den Server; Fremdes (remote) und
    // Laden (replace) nie. Zuerst, damit ein Fehler beim Neuzeichnen das Senden nicht verhindert.
    if (info && info.aend && (info.quelle === 'lokal' || info.quelle === 'undo' || info.quelle === 'redo')) sende(info.aend);
    kopieSpaeter();
    phasen.refresh();
    einrichten.refresh();
    refreshChrome();
    syncBuehnen();          // eine neue oder gelöschte Bühne gehört in die Leiste
    refreshLive();
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
      macheUndo(e.shiftKey);
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      toast(speicherStand().t.replace(/^\S+\s/, ''));
    }
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

// ── Server: Senden, Konflikte, Fremdänderungen ──────────────────────────────
// Der Store ändert, der Server (js/server.js) speichert. Jede eigene Änderung (lokal, Undo,
// Redo) geht als Änderungsliste an `server.senden`; Fremdänderungen kommen per Realtime und
// laufen NUR über `store.applyRemote` (kein Undo-Eintrag, kein Hinweis je Änderung). Alle
// Abläufe mit Netz oder Rückfrage laufen hintereinander durch `reihe`.
let pb = null, server = null, stopAbo = null;
let rolle = null;            // {rolle, gewerke} im offenen Plan
let offline = false;
let wartend = 0;             // eigene Änderungen, die noch nicht beim Server angekommen sind
let konfliktOffen = false;   // ein Konfliktdialog wartet auf Antwort
const geparkt = [];          // Konflikte, die mit «Abbrechen» offen blieben ({aend, konflikt})
const unterwegs = [];        // Änderungslisten, die gerade gesendet werden (Schritt in `reihe` läuft)
const gehalten = new Set();  // Fremdereignisse für Datensätze mit offener eigener Änderung (coll|eid)
// Datensätze, die eine eigene, noch nicht abgeschlossene Änderung berühren: sie darf kein
// Fremdstand überschreiben (nie still überschreiben), bis der Konflikt gelöst oder gesendet ist.
const offeneEigene = () => offeneSchluessel([...unterwegs, ...(server ? server.offen : []), ...geparkt.map((p) => p.aend)]);
let ablauf = Promise.resolve();
const reihe = (fn) => { const p = ablauf.then(fn); ablauf = p.catch((e) => console.error(e)); return p; };

const gewerkName = (id) => store.state.gewerke.find((g) => g.id === id)?.name || id;
const storeOptionen = () => ({
  // Dieselben Regeln wie der Server (js/rechte.js); der Server bleibt die Sicherheit.
  pruefe: (vorher, nachher, aend) => rechteFehler(rolle, aend, vorher, gewerkName),
  gesperrt: () => (!server ? (kopieModus ? 'Nur lokale Kopie – keine Verbindung zum Server.' : 'Kein Plan geöffnet.')
    : offline ? 'Offline – nur Ansicht'
      : rolle?.rolle === 'betrachter' ? 'Nur ansehen: du bist Betrachter.' : null),
});

// EINZIGER Schreiber von #sync-state: gesendet (grün) · sendet… / offen (n) (gelb).
function speicherStand() {
  const n = (server ? server.offen.length : 0) + geparkt.length;
  if (konfliktOffen) return { s: 'wartet', t: `⚠ offen (${n + wartend})`, titel: 'Konflikt: Rückfrage offen' };
  if (wartend > 0) return { s: 'wartet', t: '⟳ sendet…', titel: 'Änderungen werden gesendet' };
  if (n > 0 || offline) return { s: 'wartet', t: n ? `⚠ offen (${n})` : '⚠ offline', titel: offline ? 'Keine Verbindung – nur Ansicht' : 'Änderungen warten auf den Server' };
  return { s: 'ok', t: '✓ gesendet', titel: 'Alles beim Server angekommen' };
}
function paintSpeicher() {
  const n = $('sync-state');
  if (!n) return;
  const st = speicherStand();
  n.dataset.state = st.s;
  if (geparkt.length) n.dataset.klick = '1'; else delete n.dataset.klick;
  n.textContent = st.t;
  n.title = st.titel + (geparkt.length ? ' – anklicken, um den Konflikt zu klären' : '');
  n.setAttribute('aria-label', st.t.replace(/^\S+\s/, ''));
}
function setOffline(v) {
  if (offline === v) return;
  offline = v;
  syncNurAnsicht();
  paintSpeicher();
  if (v) planeWieder();
}

// ── Nur Ansicht ──────────────────────────────────────────────────────────────
// `setNurAnsicht` ist der EINZIGE Schreiber von body.nur-ansicht und der Kopfzeilenmarke
// (#hd-offline). Der Store sperrt über `opt.gesperrt` ohnehin; die Klasse sperrt zusätzlich die
// Oberfläche (Ziehen in gantt.js, Felder, Menüs). Jetzt-Linie und Live-Ansicht laufen weiter (Uhr).
let kopieModus = null;        // null | 'offline' | 'abgemeldet': ohne Server, nur die lokale Kopie
let kopieWiederTimer = null;
const NUR_TEXT = {
  offline: '📡 Offline – nur Ansicht',
  betrachter: '👁 Nur ansehen',
  abgemeldet: '🔑 Anmeldung abgelaufen – lokale Kopie',
};
function setNurAnsicht(grund) {
  document.body.classList.toggle('nur-ansicht', !!grund);
  const m = $('hd-offline');
  if (m) { m.hidden = !grund; m.textContent = grund ? NUR_TEXT[grund] : ''; m.dataset.grund = grund || ''; }
  felderSperren(!!grund);
}
const nurAnsichtGrund = () => kopieModus || (offline ? 'offline' : rolle?.rolle === 'betrachter' ? 'betrachter' : null);
const syncNurAnsicht = () => setNurAnsicht(nurAnsichtGrund());

// Felder in Seitenpanel, Tabelle, Einrichten und Bedarf: Text schreibgeschützt, Auswahl gesperrt.
// Sie werden bei jedem Neuaufbau neu gesetzt (MutationObserver in mount()).
const SPERR_WURZELN = ['ins', 'tb', 'ein-seite', 'bd'];
function felderSperren(an) {
  for (const id of SPERR_WURZELN) {
    const wurzel = $(id);
    if (!wurzel) continue;
    for (const f of wurzel.querySelectorAll('input, textarea, select')) {
      const hart = f.matches('select, [type=checkbox], [type=radio], [type=color], [type=range], [type=button], [type=file]');
      if (an) {
        if (hart ? !f.disabled : !f.readOnly) { f[hart ? 'disabled' : 'readOnly'] = true; f.dataset.na = hart ? 'd' : 'r'; }
      } else if (f.dataset.na) {
        f[f.dataset.na === 'd' ? 'disabled' : 'readOnly'] = false; delete f.dataset.na;
      }
    }
  }
}
// Kein Server (Start ohne Netz, Anmeldung abgelaufen): die lokale Kopie ansehen. true = sie steht.
function zeigeKopie(grund) {
  if (!store) {
    const id = repo.getActive() || repo.list()[0]?.id;
    const plan = id ? repo.load(id) : null;
    if (!plan) return false;
    schliesseServer();
    kopieModus = grund;
    store = createStore(plan, storeOptionen());
    mount();
    refreshChrome();
  } else {
    schliesseServer();
    kopieModus = grund;
  }
  syncNurAnsicht();
  paintSpeicher();
  clearTimeout(kopieWiederTimer);
  // Ohne Netz, aber angemeldet: regelmäßig prüfen, ob der Server wieder da ist.
  if (grund === 'offline') kopieWiederTimer = setTimeout(kopieWieder, WIEDER_MS * 3);
  return true;
}
async function kopieWieder() {
  if (kopieModus !== 'offline' || !store || !pb.istAngemeldet) return;
  if (await open(store.state.project.id, { still: true })) return;
  if (kopieModus === 'offline') kopieWiederTimer = setTimeout(kopieWieder, WIEDER_MS * 3);
}

// Eigene Änderung senden (aus dem Abonnement des Stores).
function sende(aend) {
  const srv = server;
  if (!srv) return;
  wartend++;
  unterwegs.push(aend);
  paintSpeicher();
  reihe(async () => {
    try {
      if (srv !== server) return;
      await ergebnis(srv, await srv.senden(aend), aend);
    } finally {
      wartend--;
      const i = unterwegs.indexOf(aend); if (i >= 0) unterwegs.splice(i, 1);
      paintSpeicher();
      freigeben();
    }
  });
}

// Antwort von senden/wiederVerbunden abarbeiten, bis alles gesendet oder bewusst offen ist.
async function ergebnis(srv, r, eigene) {
  for (let i = 0; i < 20 && srv === server; i++) {
    if (r.ok) { setOffline(false); return; }
    if (r.abgemeldet) { zuLogin('401'); return; }
    if (r.offline) { setOffline(true); return; }       // bleibt in srv.offen, geht später raus
    if (r.zuGross) {
      await askDialog({ title: 'Zu viele Änderungen auf einmal', message: ['Diese Änderung ist für einen Schritt zu groß und wurde nicht gesendet.', 'Sie wird hier zurückgenommen. Mach sie in kleineren Schritten.'], buttons: [{ label: 'OK', value: true, primary: true }] });
      zuruecknehmen(eigene);
      return;
    }
    if (r.konflikt) { r = await loeseKonflikt(srv, r); if (!r) return; continue; }
    if (r.fehler) {
      await askDialog({ title: 'Nicht gespeichert', message: ['Der Server hat die Änderung abgelehnt: ' + (r.fehler.message || r.fehler.code || r.fehler.status), 'Sie wird hier zurückgenommen.'], buttons: [{ label: 'OK', value: true, primary: true }] });
      zuruecknehmen(r.aend);
      r = await srv.wiederVerbunden();
      continue;
    }
    return;
  }
  // Nach 20 Runden ohne Ende: nicht still aufgeben. Der Rest bleibt in der Warteschlange (offen (n)).
  if (srv === server) await askDialog({ title: 'Senden nicht abgeschlossen', message: ['Die Änderungen ließen sich nach mehreren Versuchen nicht senden. Sie bleiben offen und gehen beim nächsten Senden mit.'], buttons: [{ label: 'OK', value: true, primary: true }] });
}

// Eine Änderungsliste lokal rückgängig machen, OHNE Undo-Eintrag (sie war nie gültig).
function zuruecknehmen(aend) {
  if (!aend || !store) return;
  const x = anwenden(store.state, umkehren(aend), { erzwingen: true });
  if (x.ok) store.applyRemote(x.state);
  store.entferneEintrag(aend);   // ⌘Z soll keine Änderung «zurücknehmen», die nie gültig war
  refreshChrome();
  nachladen();                   // ein währenddessen verschlucktes Fremd-Echo wieder sichtbar machen
}

// Konfliktdialog je Art. Der Name des anderen steht nicht in den Daten (der Server speichert
// keinen Bearbeiter je Datensatz) → «jemand anderem». Abbrechen lässt alles offen (geparkt).
// Rückgabe: Ergebnis des erneuten Sendens, oder null (geparkt / nichts mehr zu tun).
async function loeseKonflikt(srv, r) {
  const wer = 'jemand anderem';
  const entscheid = [];
  konfliktOffen = true; paintSpeicher();
  try {
    for (const g of gruppen(r.konflikt)) {
      const k = g.eintraege[0];
      const titel = eintragTitel(k.coll, k.eid, { state: store.state, aend: r.aend, fremd: k.fremd });
      const mehr = g.eintraege.length > 1 ? ` (und ${g.eintraege.length - 1} weitere)` : '';
      const abbr = { label: 'Abbrechen', value: null };
      const dlg = g.art === 'geaendert' ? {
        title: `«${titel}» wurde gerade von ${wer} geändert`,
        message: ['Du hast denselben Eintrag gleichzeitig geändert' + mehr + '. Welche Fassung soll gelten?'],
        buttons: [abbr, { label: 'Ihre Fassung nehmen', value: 'fremd', danger: true }, { label: 'Meine behalten', value: 'mein', primary: true }],
      } : g.art === 'geloescht' ? {
        title: `«${titel}» wurde von ${wer} gelöscht`,
        message: ['Du hast ihn gleichzeitig geändert' + mehr + '. Wiederherstellen legt ihn mit deiner Änderung neu an.'],
        buttons: [abbr, { label: 'Verwerfen', value: 'verwerfen', danger: true }, { label: 'Wiederherstellen', value: 'wieder', primary: true }],
      } : {
        title: `Der aktuelle Stand von «${titel}» ließ sich nicht lesen`,
        message: ['Die Verbindung zum Server ist gestört. Deine Änderung ist noch nicht gesendet.'],
        buttons: [abbr, { label: 'Zurücknehmen', value: 'weg', danger: true }, { label: 'Erneut senden', value: 'nochmal', primary: true }],
      };
      const w = await askDialog(dlg);
      if (w === null) { geparkt.push({ aend: r.aend, konflikt: r.konflikt }); return null; }
      entscheid.push({ g, w });
    }
  } finally { konfliktOffen = false; paintSpeicher(); }

  let aend = r.aend;
  for (const { g, w } of entscheid) {
    if (w === 'fremd' || w === 'verwerfen') { store.applyRemote(fremdUebernehmen(store.state, g.eintraege)); aend = ohne(aend, g.eintraege); }
    else if (w === 'mein') aend = meineBehalten(aend, g.eintraege);
    else if (w === 'wieder') aend = wiederherstellen(aend, g.eintraege);
    else if (w === 'weg') { zuruecknehmen(r.aend); aend = null; break; }
  }
  return aend && !istLeer(aend) ? srv.senden(aend) : srv.wiederVerbunden();
}

// Klick auf den Speicherstand: einen offen gelassenen Konflikt erneut stellen.
function geparktesLoesen() {
  const p = geparkt[0];
  if (!p || !server) return;
  const srv = server;
  unterwegs.push(p.aend);       // bleibt «offen», solange der Dialog steht
  geparkt.shift();
  paintSpeicher();
  reihe(async () => {
    try { await ergebnis(srv, { ok: false, konflikt: p.konflikt, aend: p.aend }); }
    finally { const i = unterwegs.indexOf(p.aend); if (i >= 0) unterwegs.splice(i, 1); paintSpeicher(); freigeben(); }
  });
}

// ⌘Z / ⌘⇧Z: hat jemand den betroffenen Eintrag inzwischen geändert, fragt der Store nicht,
// sondern meldet einen Konflikt. Die Antwort entscheidet «Trotzdem zurücknehmen».
async function macheUndo(wieder) {
  if (!store) return;
  const r = wieder ? store.redo() : store.undo();
  if (!r || r.ok !== false) return;
  if (!r.konflikt) { toast(r.error || 'Nicht möglich.', 'bad', 6000); return; }
  const k = r.konflikt[0];
  const titel = eintragTitel(k.coll, k.eid, { state: store.state });
  const verb = wieder ? 'wiederholen' : 'zurücknehmen';
  const wahl = await askDialog({
    title: wieder ? 'Wiederholen nicht eindeutig' : 'Zurücknehmen nicht eindeutig',
    message: [k.art === 'geloescht'
      ? `«${titel}» wurde inzwischen von jemand anderem gelöscht. Trotzdem ${verb}?`
      : `«${titel}» wurde inzwischen von jemand anderem geändert. Trotzdem ${verb}?`],
    buttons: [{ label: 'Abbrechen', value: null }, { label: 'Trotzdem ' + verb, value: 'ja', danger: true }],
  });
  if (wahl !== 'ja') return;
  const r2 = wieder ? store.redo({ erzwingen: true }) : store.undo({ erzwingen: true });
  if (r2 && r2.ok === false) toast(r2.error || 'Nicht möglich.', 'bad', 6000);
}

// ── Fremdänderungen (Realtime) ──────────────────────────────────────────────
// Mehrere Ereignisse (ein Batch eines anderen = viele Datensätze) in einem Schritt anwenden.
let fremdListe = [], fremdTimer = null;
function beiFremd(e) {
  fremdListe.push(e);
  if (!fremdTimer) fremdTimer = setTimeout(fremdAnwenden, 120);
}
function fremdAnwenden() {
  fremdTimer = null;
  const liste = fremdListe; fremdListe = [];
  if (!store || !server) return;
  if (liste.some((e) => e.coll === 'plaene' && e.objekt === null && e.eid === store.state.project.id)) { planWeg(); return; }
  const offen = offeneEigene();
  const teile = zerlegen(store.state);
  for (const { coll, eid, objekt } of liste) {
    if (!teile[coll]) continue;
    if (offen.has(coll + '|' + eid)) { gehalten.add(coll + '|' + eid); continue; }   // eigene Änderung offen: zurückhalten
    if (objekt === null) { if (coll !== 'plaene') teile[coll].delete(eid); } else teile[coll].set(eid, objekt);
  }
  store.applyRemote({ ...store.state, ...zusammensetzen(teile) });
}

// Zurückgehaltene Fremdereignisse, deren eigene Änderung erledigt ist: den DANN gültigen Stand vom
// Server holen (hat meine Fassung gewonnen, bleibt sie; gilt die fremde, steht sie schon da).
function freigeben() {
  if (!gehalten.size || !server) return;
  const offen = offeneEigene();
  const frei = [...gehalten].filter((k) => !offen.has(k));
  if (!frei.length) return;
  for (const k of frei) gehalten.delete(k);
  nachladen();
}
// Einmal den Serverstand holen und anwenden (ohne Datensätze mit offener eigener Änderung).
function nachladen() {
  const srv = server;
  if (!srv) return;
  reihe(async () => {
    if (srv !== server) return;
    const l = await srv.laden();
    if (srv !== server || !l.ok) return;
    uebernehmeStand(l.state);
  });
}
// Server-Stand anwenden, ohne Datensätze mit offener eigener Änderung zu überschreiben.
function uebernehmeStand(serverStand) {
  const neu = uebernehmeOhneOffene(store.state, serverStand, offeneEigene());
  if (!istLeer(aenderungen(store.state, neu))) store.applyRemote(neu);
}

// Der offene Plan wurde von jemand anderem gelöscht.
async function planWeg() {
  const id = store.state.project.id;
  schliesseServer();
  repo.remove(id);
  await askDialog({ title: 'Plan gelöscht', message: ['Dieser Plan wurde von jemand anderem gelöscht.'], buttons: [{ label: 'Projekte anzeigen', value: true, primary: true }] });
  showProjectDialog({ firstRun: true });
}

function schliesseServer() {
  if (stopAbo) { stopAbo(); stopAbo = null; }
  clearTimeout(fremdTimer); fremdTimer = null; fremdListe = []; gehalten.clear(); unterwegs.length = 0;
  clearTimeout(wiederTimer); wiederTimer = null;
  server = null; offline = false; rolle = null; kopieModus = null;
  geparkt.length = 0;
  syncNurAnsicht();
  paintSpeicher();
}

// ── Verbindung ──────────────────────────────────────────────────────────────
// Nach einer Trennung gibt es Lücken bei den Realtime-Ereignissen: ungesendete Änderungen senden,
// dann den Stand neu laden und per applyRemote übernehmen (Undo-Verlauf bleibt).
async function abgleichen(srv) {
  if (srv !== server) return;
  if (srv.offen.length) {
    const w = await srv.wiederVerbunden();
    // Konflikt: die betroffene Liste gilt während des Dialogs als unterwegs, damit Fremdereignisse zurückgehalten werden.
    if (w.konflikt && w.aend) unterwegs.push(w.aend);
    try { await ergebnis(srv, w, w.aend); } finally {
      const i = unterwegs.indexOf(w.aend); if (i >= 0) unterwegs.splice(i, 1);
      freigeben();
    }
    if (srv !== server || srv.offen.length || geparkt.length) return;
  }
  if (wartend > 0 || geparkt.length) return;     // Eigenes ist unterwegs: ein Laden würde es überrollen
  const l = await srv.laden();
  if (srv !== server) return;
  if (l.abgemeldet) { zuLogin('401'); return; }
  if (l.offline) { setOffline(true); return; }
  if (!l.ok) return;
  rolle = l.rolle;
  syncNurAnsicht();
  uebernehmeStand(l.state);     // Eingaben während des Ladens werden nicht überrollt
}

// Offline: alle 5 s prüfen, ob der Server wieder da ist (Wiederverbinden: Anmeldung erneuern,
// neu abonnieren, offene Warteschlange senden, Stand laden; Marke weg).
let wiederTimer = null;
const WIEDER_MS = 5000;
function planeWieder() {
  clearTimeout(wiederTimer);
  wiederTimer = setTimeout(() => reihe(versucheWieder), WIEDER_MS);
}
async function versucheWieder() {
  const srv = server;
  if (!srv || !offline) return;
  const e = await pb.erneuern();
  if (!e.ok && (e.status === 401 || e.code === 'auth')) { zuLogin('401'); return; }
  if (!e.ok) { planeWieder(); return; }
  setOffline(false);
  srv.neuAbonnieren();
  await abgleichen(srv);
  paintSpeicher();
}

// ── Lokale Kopie ────────────────────────────────────────────────────────────
// print.html liest den Plan weiter aus localStorage. Sie wird nach jedem Laden und jeder
// Änderung geschrieben (ohne Token — der Plan allein) und gilt nie als Wahrheit.
let kopieTimer = null, kopieGemeldet = false, kopieAus = false;
function kopieSpaeter() { clearTimeout(kopieTimer); kopieTimer = setTimeout(kopieSchreiben, 800); }
function kopieSchreiben() {
  clearTimeout(kopieTimer); kopieTimer = null;
  if (!store || !server || kopieAus) return;
  const r = repo.save(store.state);
  if (!r.ok && !kopieGemeldet) { kopieGemeldet = true; toast('Die lokale Kopie (für den Druck) ließ sich nicht speichern: ' + r.error, 'bad', 8000); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && kopieTimer) kopieSchreiben(); });
window.addEventListener('pagehide', () => { if (kopieTimer) kopieSchreiben(); });

// Ungesendetes nicht stillschweigend verlieren.
window.addEventListener('beforeunload', (e) => {
  if (!server || !(wartend || server.offen.length || geparkt.length)) return;
  e.preventDefault();
  e.returnValue = '';
});

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
  if (document.body.classList.contains('nur-ansicht')) return;   // nur Ansicht: kein Menü, das ändert
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

// ── Projekt löschen ─────────────────────────────────────────────────────────
// Nur Besitzer und Superadmin (der Server prüft es ebenfalls; der Hook kaskadiert alle
// Datensätze). Das OFFENE Projekt wird dabei geschlossen: der Dialog fordert ein neues.
async function loescheProjekt(planId) {
  const istOffen = !!server && store.state.project.id === planId;
  const s = istOffen ? server : createServerPlan({ pb, planId });
  const r = await s.planLoeschen();
  if (!r.ok && !r.nichtGefunden) {
    if (r.abgemeldet) zuLogin();
    else toast(r.offline ? 'Keine Verbindung – das Projekt wurde nicht gelöscht.' : 'Löschen nicht möglich: ' + (r.fehler?.message || 'Fehler'), 'bad', 8000);
    return false;
  }
  if (istOffen) schliesseServer();
  const e = repo.remove(planId);
  if (!e.ok) toast(e.error, 'bad', 8000);
  return true;
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
// Export = JSON-Sicherung des Plans (nie ein Token). Import legt einen NEUEN Plan auf dem
// Server an (neue plan_id, Spec 15); wer ihn sehen darf, entscheidet die Mitgliederliste.
function doExport() {
  const blob = new Blob([serialize(store.state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = store.state.project.name.replace(/[^\w\-]+/g, '-').toLowerCase() + '-bauzeitenplan.json';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Exportiert');
}

const KEIN_ANLEGEN = 'Neue Projekte legen nur Produktionsleitung und Superadmin an.';

// Neuen Plan auf dem Server anlegen und öffnen. true = offen.
async function planNeu(plan) {
  if (!darfPlanAnlegen(pb.auth?.record)) { toast(KEIN_ANLEGEN, 'bad'); return false; }
  const r = await createServerPlan({ pb, planId: null }).planAnlegen(plan);
  if (!r.ok) {
    if (r.abgemeldet) zuLogin();
    else if (r.zuGross) await askDialog({ title: 'Plan zu groß', message: ['Dieser Plan hat zu viele Einträge für einen Schritt und wurde nicht angelegt.'], buttons: [{ label: 'OK', value: true, primary: true }] });
    else toast(r.offline ? 'Keine Verbindung – der Plan wurde nicht angelegt.' : 'Der Plan konnte nicht angelegt werden: ' + (r.fehler?.message || r.message || 'Fehler'), 'bad', 8000);
    return false;
  }
  return open(r.planId);
}

async function doImport(e) {
  const f = e.target.files[0];
  if (!f) return;
  e.target.value = '';
  if (!darfPlanAnlegen(pb.auth?.record)) return toast(KEIN_ANLEGEN, 'bad');
  let r;
  try { r = deserialize(await f.text()); }
  catch (err) { return toast('Die Datei lässt sich nicht lesen: ' + ((err && err.message) || err), 'bad', 8000); }
  if (r.ok === false) return toast(r.error, 'bad', 8000);
  if (r.hinweis) toast(r.hinweis, 'bad', 8000);
  if (!(await planNeu(r.plan))) return;
  $('dlg').hidden = true;      // sonst bleibt der Anlege-Dialog über allem liegen
  toast('«' + r.plan.project.name + '» importiert');
}

// ── Projektdialog ───────────────────────────────────────────────────────────
// Rolle immer als Symbol + Text (nie Farbe allein).
const ROLLEN_ANZEIGE = {
  besitzer: '👑 Besitzer', superadmin: '⭐ Superadmin', produktionsleitung: '🎬 Produktionsleitung',
  bearbeiter: '✏ Bearbeiter', gewerkeleiter: '🔧 Gewerkeleiter', betrachter: '👁 Betrachter',
};

async function showProjectDialog({ firstRun = false } = {}) {
  const dlg = $('dlg');
  dlg.replaceChildren(el('div', 'dlg-box', 'Projekte werden geladen …'));
  dlg.hidden = false;
  let list = [], problem = null;
  try { list = await listePlaene(pb); }
  catch (e) {
    if (e.abgemeldet) { zuLogin(); return; }
    problem = e.offline ? 'Keine Verbindung zum Server. Die Projektliste lässt sich nur mit Verbindung laden.' : 'Die Projekte ließen sich nicht laden: ' + e.message;
  }
  const user = pb.auth?.record;
  const darfAnlegen = darfPlanAnlegen(user);
  dlg.replaceChildren();

  const box = el('div', 'dlg-box');
  box.append(el('h2', 'dlg-h', firstRun ? 'Bauzeitenplan' : 'Projekte'));
  if (problem) box.append(el('p', 'dlg-sub', '⚠ ' + problem));
  else if (firstRun) box.append(el('p', 'dlg-sub', list.length
    ? 'Öffne ein Projekt' + (darfAnlegen ? ' oder leg ein neues an.' : '.') + ' Die Pläne liegen auf dem Server, Änderungen anderer erscheinen sofort.'
    : darfAnlegen ? 'Leg ein Projekt an — aus einer Vorlage oder leer — oder importiere eine JSON-Sicherung.'
      : 'Du bist noch in keinem Projekt. Die Produktionsleitung lädt dich ein.'));

  // Bestehende Projekte
  if (list.length) {
    box.append(el('h3', 'dlg-h3', 'Öffnen'));
    const ul = el('div', 'dlg-list');
    for (const p of list) {
      const row = el('div', 'dlg-row');
      const b = el('button', 'dlg-open');
      b.dataset.planId = p.plan_id;
      b.append(el('span', 'dlg-open-n', p.name || '(ohne Namen)'));
      b.append(el('span', 'dlg-open-m', (p.venue ? p.venue + ' · ' : '') + (ROLLEN_ANZEIGE[p.rolle] || 'ohne Rolle')));
      b.onclick = async () => { if (await open(p.plan_id)) close(); };
      row.append(b);
      if (p.rolle === 'besitzer' || p.rolle === 'superadmin') {
        const del = el('button', 'dlg-del', '×');
        del.title = 'Projekt löschen';
        del.onclick = async () => {
          const ok = await askDialog({
            title: 'Projekt löschen?',
            message: [`«${p.name}» endgültig löschen? Der Plan verschwindet für ALLE Mitglieder und lässt sich nicht rückgängig machen — exportiere vorher, wenn du unsicher bist.`],
            buttons: [{ label: 'Abbrechen', value: false }, { label: 'Löschen', value: true, danger: true }],
          });
          if (!ok || !(await loescheProjekt(p.plan_id))) return;
          showProjectDialog({ firstRun: firstRun || !server });
        };
        row.append(del);
      }
      ul.append(row);
    }
    box.append(ul);
  }

  // Neu anlegen
  box.append(el('h3', 'dlg-h3', 'Neues Projekt'));
  if (!darfAnlegen) box.append(el('p', 'dlg-sub', '🔒 ' + KEIN_ANLEGEN));
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
  create.id = 'neu-anlegen';
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
    if (await planNeu(neu)) { close(); openEinrichten('projekt', { erst: true }); }
  };
  const imp = el('button', 'btn', 'JSON importieren');
  imp.id = 'neu-import';
  imp.onclick = () => $('import-file').click();
  if (!darfAnlegen) {
    for (const b of [create, imp]) { b.disabled = true; b.title = KEIN_ANLEGEN; }
    for (const i of [nameIn, venueIn, vonIn, bisIn]) i.disabled = true;
  }
  actions.append(imp, create);
  if (!firstRun) {
    const cancel = el('button', 'btn', 'Abbrechen');
    cancel.onclick = close;
    actions.prepend(cancel);
  } else {
    // Ohne Projekt gibt es noch keine Kopfzeile: hier muss man sich abmelden können.
    const aus = el('button', 'btn', '⎋ Abmelden');
    aus.id = 'dlg-abmelden';
    aus.onclick = abmelden;
    actions.prepend(aus);
  }
  box.append(actions);

  dlg.append(box);
  dlg.hidden = false;
  if (darfAnlegen) nameIn.focus();

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

$('undo').onclick = () => macheUndo(false);
$('redo').onclick = () => macheUndo(true);
$('plan-verschieben').onclick = showShiftDialog;

// ── Projektmenü (Kopfzeile) ─────────────────────────────────────────────────
// Ein Knopf, ein Menü (openMenu); die Einträge rufen benannte Funktionen. Nichts
// davon hängt an einem dauerhaft vorhandenen Knopf: Neu und Import müssen schon
// beim allerersten Start gehen (kein Projekt, kein mount()) — der Projektdialog
// bietet «JSON importieren» an, und `import-file` wird auf Modulebene verdrahtet.
// Die Anmeldung (Name, Abmelden) steht am Ende des Menüs.
const neuesProjekt = () => showProjectDialog({});
const projekteWaehlen = () => showProjectDialog({});
const importieren = () => $('import-file').click();
const exportieren = () => { if (store) doExport(); };

async function abmelden() {
  if (server && (wartend || server.offen.length || geparkt.length)) {
    const wahl = await askDialog({
      title: 'Ungesendete Änderungen',
      message: ['Es gibt Änderungen, die noch nicht beim Server angekommen sind. Beim Abmelden gehen sie verloren.'],
      buttons: [{ label: 'Abbrechen', value: null, primary: true }, { label: 'Trotzdem abmelden', value: 'ja', danger: true }],
    });
    if (wahl !== 'ja') return;
  }
  pb.abmelden();     // meldet «abgemeldet» → zuLogin (nicht zusätzlich weiterleiten)
}

function projektMenue() {
  const r = $('proj-knopf').getBoundingClientRect();
  const user = pb.auth?.record;
  const darf = darfPlanAnlegen(user);
  const ohneNetz = !!kopieModus || offline;
  const grund = ohneNetz ? 'offline' : darf ? '' : 'nur Leitung';
  openMenu(r.left, r.bottom + 4, [
    { id: 'new-proj', label: '＋ Neu…', disabled: !darf || ohneNetz, hint: grund, run: neuesProjekt },
    { id: 'proj-menu', label: '📂 Projekte…', run: projekteWaehlen },
    { id: 'import', label: '⬆ Import…', disabled: !darf || ohneNetz, hint: grund, run: importieren },
    { id: 'export', label: '⬇ Export', disabled: !store, run: exportieren },
    null,
    { id: 'konto', label: '👤 ' + (user?.name || user?.email || 'Angemeldet'), disabled: true },
    { id: 'abmelden', label: '⎋ Abmelden', run: abmelden },
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
// Der Plan lebt auf dem Server (PocketBase); localStorage hält nur die Kopie für den Druck
// und das Token (js/pb.js). Ohne Anmeldung geht es zur Anmeldeseite.
function main() {
  repo = createRepo(window.localStorage);
  // Das Token erneuert die App selbst (alle 6 h), damit sie danach die Realtime-Verbindung
  // neu aufbauen kann: sie trägt sonst bis zum nächsten Verbinden das alte Token.
  pb = createPb({ basis: apiBasis(), autostart: false });
  pb.on('abgemeldet', (e) => {
    // Manuelles Abmelden räumt die lokalen Kopien weg (geteilter Rechner); abgelaufen (401) lässt sie stehen.
    if (e?.grund === 'manuell') { kopieAus = true; for (const x of repo.list()) repo.remove(x.id); }
    zuLogin(e?.grund);
  });
  let getrennt = false;
  pb.on('getrennt', () => { getrennt = true; if (server) setOffline(true); });
  window.addEventListener('offline', () => { if (server) setOffline(true); });
  window.addEventListener('online', () => { if (server && offline) reihe(versucheWieder); });
  pb.on('verbunden', () => {
    if (!getrennt) return;
    getrennt = false;
    const srv = server;
    if (srv) reihe(async () => { if (srv !== server) return; setOffline(false); await abgleichen(srv); paintSpeicher(); });
  });
  setInterval(async () => { const r = await pb.erneuern(); if (r.ok && server) server.neuAbonnieren(); }, ERNEUERN_MS);
  $('sync-state').onclick = () => { if (geparkt.length) geparktesLoesen(); };
  paintSpeicher();
  boot();
}
main();
