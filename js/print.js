// ── Tagesblätter: ein A3 quer je Kalendertag ─────────────────────────────────
// Eine eigene Seite, kein Umbau der Render-Engine. Der Gantt ist EIN langer
// Scroll-Container; ihn für den Druck in Tage zu zerschneiden hieße, gantt.js
// umzubauen. Ein zweiter, kleiner Renderer für ein festes Format ist ehrlicher.
//
// Reihenfolge der Entscheidungen: AUSWAHL → ZEITFENSTER → BLATT. Wer Security
// wegklickt, ändert nicht nur den Inhalt: an einem normalen Aufbautag zwingt
// allein die Objektbewachung (00:01–23:59) das Blatt auf 24 Stunden, alles andere
// läuft 08:00–18:00. Ohne Security wird aus 14 mm je Stunde 34 mm.
//
// Alles Rechnende kommt aus den vorhandenen DOM-freien Modulen: tagesScheiben
// und seriesRows (schedule.js), ticksFor/fmtDay (timeaxis.js), palette.js.

import { createRepo, deserialize } from './persistence.js';
import { tagesScheiben, seriesRows, toMin, toDate } from './schedule.js';
import { ticksFor, fmtDay } from './timeaxis.js';
import { gewerkVar, gewerkTexture } from './palette.js';
import { local } from './conflicts.js';
import { el, $ } from './dom.js';
import { sichtGewerke, typHinweis } from './ebene.js';
import { VERSION } from './version.js';

// Mitgelieferte Pläne — dieselben Kennungen wie in app.js.
const BUNDLED = {
  klassentreffen: { file: 'klassentreffen-festival.json', name: 'Klassentreffen Festival 2026' },
  amk: { file: 'amk-singleshow.json', name: 'AMK Singleshow' },
};

// ── Reine Helfer (exportiert, damit sie geprüft werden können) ───────────────

/**
 * Die Notiz fürs Blatt. Ein `notes.split(' · ')[0]` klänge klug, liefert aber bei
 * «Sanitäter vor Ort» den Text «Uhrzeit in V07 nicht angegeben» — einen
 * QUELLENHINWEIS an der Stelle, wo eine Firma stehen soll. Deshalb: alles zeigen,
 * nur die Hinweise über das Quelldokument entfernen. Die sagen etwas über das
 * PDF, nicht über die Arbeit; dass eine Zeit geschätzt ist, sagt schon die
 * gestrichelte Kante des Balkens.
 */
export function notizFuerDruck(notes, max = 38) {
  const teile = String(notes || '').split(' · ')
    .filter((s) => s && !/nicht angegeben|nicht gedruckt|«open»/.test(s));
  const s = teile.join(' · ');
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/** Alle Kalendertage von…bis, einschließlich. */
export function tageZwischen(vonISO, bisISO) {
  const out = [];
  const d = new Date(vonISO + 'T12:00');       // 12:00 gegen Sommerzeit-Kanten
  const ende = new Date(bisISO + 'T12:00');
  const p = (n) => String(n).padStart(2, '0');
  while (d <= ende) {
    out.push(d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()));
    d.setDate(d.getDate() + 1);
    if (out.length > 400) break;               // Notbremse gegen Endlosschleifen
  }
  return out;
}

/**
 * Das Zeitfenster, das die AUSWAHL braucht — über alle Blätter gemeinsam, damit
 * die Blätter denselben Maßstab haben und vergleichbar bleiben. Auf volle Stunden
 * nach außen gerundet. Ohne passende Vorgänge: der ganze Tag.
 * @returns {{von:number, bis:number}} Stunden seit Tagesbeginn (0…24)
 */
export function fensterFuer(tasks, tage) {
  let lo = 24, hi = 0, was = false;
  for (const tag of tage) {
    const a = toMin(tag + 'T00:00');
    for (const s of tagesScheiben(tasks, tag)) {
      lo = Math.min(lo, (s.von - a) / 60);
      hi = Math.max(hi, (s.bis - a) / 60);
      was = true;
    }
  }
  if (!was) return { von: 0, bis: 24 };
  return { von: Math.max(0, Math.floor(lo)), bis: Math.min(24, Math.ceil(hi)) };
}

// ── Seite ───────────────────────────────────────────────────────────────────

const p2 = (n) => String(n).padStart(2, '0');
const hhmm = (h) => p2(Math.floor(h)) + ':' + p2(Math.round((h % 1) * 60));

let PLAN = null;
// `ebene` entscheidet, WAS gedruckt wird: das Gantt-Tagesblatt des
// Bauzeitenplans oder die Running-Order-Liste einer Bühne (js/ebene.js).
// Beide teilen sich Tagesauswahl und Blattformat, sonst nichts.
const wahl = { ebene: 'bau', gewerke: new Set(), von: null, bis: null, fenster: null, autoFenster: true };

async function ladePlan() {
  const key = new URLSearchParams(location.search).get('plan');
  const repo = createRepo(window.localStorage);
  if (key && BUNDLED[key]) {
    const b = BUNDLED[key];
    const da = repo.list().find((x) => x.name === b.name);
    if (da) { const pl = repo.load(da.id); if (pl) return pl; }
    const res = await fetch('./' + b.file + '?v=' + VERSION, { cache: 'no-cache' });
    const r = deserialize(await res.text());
    if (r.ok === false) throw new Error(r.error);
    return r.plan;
  }
  const aktiv = repo.getActive();
  const pl = aktiv && repo.load(aktiv);
  if (pl) return pl;
  const liste = repo.list();
  if (liste.length) return repo.load(liste[0].id);
  throw new Error('Kein Projekt in diesem Browser. Öffne zuerst die App.');
}

const gewaehlteTasks = () => PLAN.tasks.filter((t) => wahl.gewerke.has(t.gewerk));

/** Die Bänder der aktiven Ebene — Gewerke oder Bühnen. */
const baender = () => sichtGewerke(PLAN, wahl.ebene);

/**
 * Beim Ebenenwechsel den Tagesbereich neu setzen: der Bauzeitenplan läuft über
 * zwei Wochen, die Running Order über zwei Tage. Bliebe der Bereich stehen,
 * druckte man zwölf leere Blätter.
 */
function ebeneWechseln(name) {
  wahl.ebene = name;
  wahl.gewerke = new Set(baender().map((g) => g.id));
  const drin = gewaehlteTasks();
  if (drin.length) {
    wahl.von = local(toDate(Math.min(...drin.map((t) => toMin(t.start))))).slice(0, 10);
    wahl.bis = local(toDate(Math.max(...drin.map((t) => toMin(t.end))))).slice(0, 10);
  }
  wahl.autoFenster = true;
  zeichne();
}

function baueSteuerung() {
  const c = $('ctl');
  c.replaceChildren();

  const show = wahl.ebene === 'show';
  const kopf = el('div', 'pr-f');
  kopf.append(el('h1', null, PLAN.project.name),
    el('div', 'pr-sub', show
      ? 'Running Order · A3 quer · ein Blatt je Tag und Bühne'
      : 'Tagesblätter · A3 quer · ein Blatt je Tag'));
  c.append(kopf);

  // Ebene zuerst: sie entscheidet, was die Regler darunter überhaupt bedeuten.
  const seg = el('div', 'pr-seg');
  for (const [key, label] of [['bau', 'Tagesblätter'], ['show', 'Running Order']]) {
    const b = el('button', 'pr-btn' + (wahl.ebene === key ? ' is-on' : ''), label);
    b.disabled = key === 'show' && !sichtGewerke(PLAN, 'show').length;
    if (b.disabled) b.title = 'Dieser Plan hat noch keine Bühne.';
    b.onclick = () => ebeneWechseln(key);
    seg.append(b);
  }
  const segWrap = el('div', 'pr-f');
  segWrap.append(el('span', null, 'Ebene'), seg);
  c.append(segWrap);

  const feld = (label, node) => { const w = el('label', 'pr-f'); w.append(el('span', null, label), node); return w; };

  const von = el('input'); von.type = 'date'; von.value = wahl.von;
  const bis = el('input'); bis.type = 'date'; bis.value = wahl.bis;
  von.onchange = () => { wahl.von = von.value; zeichne(); };
  bis.onchange = () => { wahl.bis = bis.value; zeichne(); };
  c.append(feld('von', von), feld('bis', bis));

  // Gewerke wegklicken — der wichtigste Regler: er bestimmt auch den Maßstab.
  const box = el('div', 'pr-gw');
  for (const g of baender()) {
    const l = el('label');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = wahl.gewerke.has(g.id);
    cb.onchange = () => { cb.checked ? wahl.gewerke.add(g.id) : wahl.gewerke.delete(g.id); zeichne(); };
    const dot = el('span', 'pr-dot');
    dot.style.cssText = 'width:9px;height:9px;border-radius:50%;flex:none;background:' + gewerkVar(g.slot);
    l.append(cb, dot, el('span', null, g.name));
    box.append(l);
  }
  const alle = el('button', 'pr-btn', 'alle');
  alle.onclick = () => { baender().forEach((g) => wahl.gewerke.add(g.id)); zeichne(); };
  const keins = el('button', 'pr-btn', 'keins');
  keins.onclick = () => { wahl.gewerke.clear(); zeichne(); };
  const gwWrap = el('div', 'pr-f');
  gwWrap.append(el('span', null, show ? 'Bühnen' : 'Gewerke'), box);
  c.append(gwWrap, feld(' ', (() => { const d = el('div'); d.append(alle, ' ', keins); return d; })()));

  // Zeitfenster: Vorgabe automatisch aus der Auswahl, von Hand übersteuerbar.
  // Die Running-Order-Liste kennt keinen Maßstab — sie ist eine Liste, kein
  // Zeitstrahl. Die Regler wären dort ohne Wirkung und damit irreführend.
  if (!show) baueFenster(c, feld);

  const drucken = el('button', 'pr-btn pr-btn-p', 'Drucken');
  drucken.onclick = () => window.print();
  c.append(feld(' ', drucken));
  c.append(el('div', 'pr-hint', show
    ? 'Im Druckdialog A3 · Querformat wählen. Leere Felder drucken als Linien zum Ausfüllen mit dem Stift.'
    : 'Im Druckdialog A3 · Querformat wählen und „Hintergrundgrafiken" einschalten — '
      + 'sonst drucken die Balken weiß. Ränder: Standard.'));
}

function baueFenster(c, feld) {
  const f = wahl.fenster;
  const tv = el('input'); tv.type = 'time'; tv.step = 3600; tv.value = hhmm(f.von);
  const tb = el('input'); tb.type = 'time'; tb.step = 3600; tb.value = f.bis === 24 ? '23:59' : hhmm(f.bis);
  const setz = () => {
    wahl.autoFenster = false;
    wahl.fenster = { von: Number(tv.value.slice(0, 2)), bis: tb.value >= '23:59' ? 24 : Number(tb.value.slice(0, 2)) };
    zeichne();
  };
  tv.onchange = setz; tb.onchange = setz;
  const auto = el('button', 'pr-btn', 'automatisch');
  auto.onclick = () => { wahl.autoFenster = true; zeichne(); };
  c.append(feld('Zeitfenster ab', tv), feld('bis', tb), feld(' ', auto));
}

function zeichne() {
  const tasks = gewaehlteTasks();
  const tage = tageZwischen(wahl.von, wahl.bis);
  if (wahl.autoFenster) wahl.fenster = fensterFuer(tasks, tage);
  baueSteuerung();

  const wrap = $('sheets');
  wrap.replaceChildren();

  if (wahl.ebene === 'show') {
    // Ein Blatt je Tag UND Bühne: zwei Bühnen an zwei Tagen sind vier Blätter.
    // Leere Kombinationen fallen weg — ein Blatt für eine Bühne, die an diesem
    // Tag nicht bespielt wird, ist Papierverschwendung.
    const blaetter = [];
    for (const tag of tage) {
      for (const b of baender()) {
        if (!wahl.gewerke.has(b.id)) continue;
        const drauf = tagesScheiben(tasks.filter((t) => t.gewerk === b.id), tag);
        if (drauf.length) blaetter.push({ tag, b, drauf });
      }
    }
    if (!blaetter.length) {
      wrap.append(el('div', 'pr-sheet', '')).lastChild
        .append(el('div', 'pr-leer', 'Für die gewählten Bühnen und Tage ist nichts eingetragen.'));
      return;
    }
    blaetter.forEach((x, i) => wrap.append(roBlatt(x, i + 1, blaetter.length)));
    return;
  }

  tage.forEach((tag, i) => wrap.append(blatt(tag, tasks, i + 1, tage.length)));
}

// ── Running-Order-Blatt ─────────────────────────────────────────────────────
// Eine LISTE, kein Zeitstrahl. Genau so liest man einen Showablauf: von oben
// nach unten, Uhrzeit voran. Ein Gantt über zehn Stunden mit siebzehn Zeilen
// wäre auf Papier nur ein Streifenmuster — und die Felder, die von Hand
// ausgefüllt werden sollen, hätten keinen Platz.
//
// Anforderungen und Material sind der Zweck des Blattes. Sind sie leer, drucken
// sie als Linien: das Blatt geht mit auf die Bühne und wird dort beschrieben.
function roBlatt({ tag, b, drauf }, nr, gesamt) {
  const sheet = el('section', 'pr-sheet pr-ro');
  sheet.dataset.tag = tag;
  sheet.dataset.buehne = b.id;

  const head = el('div', 'pr-head');
  const d = new Date(tag + 'T12:00');
  head.append(el('span', 'pr-head-t', PLAN.project.name + ' · ' + b.name));
  head.append(el('span', 'pr-head-d', fmtDay(d) + ' ' + d.getFullYear()));
  head.append(el('span', 'pr-head-n', 'Blatt ' + nr + ' von ' + gesamt));
  sheet.append(head);

  const body = el('div', 'pr-body');

  const kopf = el('div', 'pr-ro-r pr-ro-h');
  for (const [label, cls] of [['Zeit', 'pr-ro-z'], ['Programmpunkt', 'pr-ro-t'],
    ['Anforderungen', 'pr-ro-a'], ['Benötigtes Material', 'pr-ro-m']]) {
    kopf.append(el('div', cls, label));
  }
  body.append(kopf);

  // Zeilenhöhe füllt das Blatt — aber nur bis zu einer Höhe, in der Handschrift
  // Platz hat, und nicht unter die Lesbarkeitsgrenze. Der Rest unten bleibt frei
  // für Notizen; das ist gewollt, kein Fehler im Satz.
  //
  // Gewichtet gerechnet: eine Umbauzeile ist 0,62 hoch (siehe print.css). Zählte
  // man nur Zeilen, blieb bei siebzehn Punkten ein Viertel des Blattes leer,
  // weil die Hälfte davon Umbauten sind.
  const platzMM = 277 - 10 - 6 - 12;
  const UM = 0.62;
  const gewicht = drauf.reduce((n, s) => n + ((s.task.punktTyp || 'act') === 'changeover' ? UM : 1), 1);
  const hoehe = Math.max(6, Math.min(18, platzMM / gewicht));
  sheet.style.setProperty('--pr-ro-h', hoehe.toFixed(2) + 'mm');

  for (const s of drauf) {
    const t = s.task;
    const r = el('div', 'pr-ro-r');
    r.dataset.typ = t.punktTyp || 'act';
    // Umbauten treten zurück: auf dem Blatt zählt, wer spielt.
    if ((t.punktTyp || 'act') === 'changeover') r.classList.add('is-um');

    const a = toDate(s.von), e = toDate(s.bis);
    const zeit = el('div', 'pr-ro-z');
    zeit.append(el('span', 'pr-ro-z1', p2(a.getHours()) + ':' + p2(a.getMinutes())));
    if (!t.milestone) {
      zeit.append(el('span', 'pr-ro-z2',
        'bis ' + (s.schnittRechts ? '›' : '') + p2(e.getHours()) + ':' + p2(e.getMinutes())));
    }
    r.append(zeit);

    const titel = el('div', 'pr-ro-t');
    titel.append(el('div', 'pr-ro-t1', t.title));
    // Typ, Kontakt und Soundcheck stehen klein unter dem Namen — je eine Zeile
    // mehr wäre eine Spalte, die meistens leer ist.
    const unten = [];
    const typ = typHinweis(t);
    if (typ) unten.push(typ);
    if (t.kontakt) unten.push(t.kontakt);
    if (t.soundcheck) unten.push('SC ' + String(t.soundcheck).slice(11, 16));
    const no = notizFuerDruck(t.notes);
    if (no) unten.push(no);
    if (unten.length) titel.append(el('div', 'pr-ro-t2', unten.join(' · ')));
    r.append(titel);

    for (const [feld, cls] of [['anforderungen', 'pr-ro-a'], ['material', 'pr-ro-m']]) {
      const c = el('div', cls);
      const wert = (t[feld] || '').trim();
      if (wert) c.append(el('span', 'pr-ro-w', wert));
      else c.classList.add('is-leer');   // druckt als Linie zum Ausfüllen
      r.append(c);
    }
    body.append(r);
  }

  sheet.append(body, roFuss(b));
  return sheet;
}

function roFuss(b) {
  const f = el('div', 'pr-foot');
  const q = PLAN.project.quelle || {};
  f.append(el('div', 'pr-leg', b.name),
    el('div', null, 'CallBoard · v' + VERSION + (q.exported ? ' · Stand ' + q.exported.slice(0, 10) : '')));
  return f;
}

function blatt(tag, tasks, nr, gesamt) {
  const sheet = el('section', 'pr-sheet');
  sheet.dataset.tag = tag;
  const { von: fv, bis: fb } = wahl.fenster;
  const tagStart = toMin(tag + 'T00:00');
  const wVon = tagStart + fv * 60;
  const wBis = tagStart + fb * 60;
  const spanne = Math.max(1, wBis - wVon);
  const pct = (min) => ((min - wVon) / spanne) * 100;

  // ── Kopf ──
  const head = el('div', 'pr-head');
  const d = new Date(tag + 'T12:00');
  head.append(el('span', 'pr-head-t', PLAN.project.name));
  head.append(el('span', 'pr-head-d', fmtDay(d) + ' ' + d.getFullYear()));
  head.append(el('span', 'pr-head-n', 'Blatt ' + nr + ' von ' + gesamt));
  sheet.append(head);

  // ── Zeitachse ──
  const axis = el('div', 'pr-axis');
  axis.append(el('div', 'pr-axis-pad'));
  const scale = el('div', 'pr-axis-scale');
  const stunden = fb - fv;
  // Bei engem Fenster jede Stunde, sonst jede zweite/dritte — sonst kleben die
  // Zahlen aneinander. ticksFor ist die eine Quelle für Ticks.
  const einheit = stunden <= 12 ? 'hour' : stunden <= 18 ? 'hour' : 'hour3';
  const jede = stunden <= 12 ? 1 : stunden <= 18 ? 2 : 1;
  for (const t of ticksFor(einheit, toDate(wVon), toDate(wBis))) {
    const m = toMin(local(t.t));
    if (m < wVon || m > wBis) continue;
    if (jede > 1 && t.t.getHours() % jede !== 0) continue;
    const n = el('div', 'pr-tick', t.label);
    const x = pct(m);
    n.style.left = x + '%';
    // Der letzte Tick sitzt sonst halb außerhalb des Blattes — der 24:00-Wert
    // wurde auf dem Probedruck zu einer einsamen «0».
    if (x > 97) n.style.transform = 'translateX(-100%)';
    else if (x < 1) n.style.transform = 'translateX(0)';
    scale.append(n);
  }
  axis.append(scale);
  sheet.append(axis);

  // ── Zeilen ──
  const body = el('div', 'pr-body');
  const zeilen = [];       // {kind:'grp'|'row', …}
  for (const g of baender()) {
    const scheiben = tagesScheiben(tasks.filter((t) => t.gewerk === g.id), tag)
      // Zweiter Zuschnitt auf das gewählte Fenster: wer es von Hand enger stellt,
      // soll keine Balken außerhalb des Blattes erzeugen.
      .map((s) => ({ ...s, von: Math.max(s.von, wVon), bis: Math.min(s.bis, wBis),
        schnittLinks: s.schnittLinks || s.von < wVon, schnittRechts: s.schnittRechts || s.bis > wBis }))
      .filter((s) => s.bis > s.von || s.task.milestone);
    if (!scheiben.length) continue;

    // Die Serien werden aus den ZUGESCHNITTENEN Zeiten gebildet — sonst stimmten
    // die Spuren für das Blatt nicht.
    const pseudo = scheiben.map((s) => ({
      id: s.task.id, title: s.task.title,
      start: local(toDate(s.von)), end: local(toDate(s.bis)),
    }));
    const proId = new Map(scheiben.map((s) => [s.task.id, s]));
    zeilen.push({ kind: 'grp', g });
    for (const serie of seriesRows(pseudo)) zeilen.push({ kind: 'row', g, serie, proId });
  }

  if (!zeilen.length) {
    body.append(el('div', 'pr-leer', 'An diesem Tag ist für die gewählten Gewerke nichts eingetragen.'));
    sheet.append(body, fuss());
    return sheet;
  }

  // Zeilenhöhe so, dass das Blatt gefüllt ist — ein Blatt mit 14 Zeilen soll
  // keine 3,7-mm-Zeilen haben, nur weil ein anderes 64 hat. Nach oben gedeckelt.
  const spuren = zeilen.reduce((n, z) => n + (z.kind === 'grp' ? 1 : z.serie.lanes), 0);
  const platzMM = 277 - 10 - 5 - 12;                 // Blatt minus Kopf, Achse, Fuß
  // Nach unten begrenzt, damit ein volles Blatt lesbar bleibt; nach oben, damit
  // ein leeres Blatt keine fingerbreiten Zeilen bekommt. Dazwischen füllt die
  // Zeilenhöhe das Papier — ein Blatt mit 17 Zeilen soll nicht aussehen wie eines
  // mit 64. Der Rest unten ist Platz für Notizen von Hand, das ist gewollt.
  const hoehe = Math.max(3.2, Math.min(11, platzMM / spuren));
  // Schriftgrößen an der Zeilenhöhe, nicht fest: sonst stößt die kleine
  // Notizzeile auf vollen Blättern unten an die Kante — genau das war auf dem
  // ersten Probedruck zu sehen. Die Notiz fällt weg, bevor sie unlesbar wird.
  const titelMM = Math.min(2.9, hoehe * 0.50);
  const notizMM = Math.min(2.3, hoehe * 0.36);
  const mitNotiz = notizMM >= 2.0;
  sheet.style.setProperty('--pr-row-h', hoehe.toFixed(2) + 'mm');
  sheet.style.setProperty('--pr-bar-h', Math.min(4.4, hoehe * 0.62).toFixed(2) + 'mm');
  sheet.style.setProperty('--pr-titel', titelMM.toFixed(2) + 'mm');
  sheet.style.setProperty('--pr-notiz', notizMM.toFixed(2) + 'mm');
  sheet.style.setProperty('--pr-grid', (100 / stunden) + '%');

  for (const z of zeilen) {
    if (z.kind === 'grp') {
      const n = el('div', 'pr-grp');
      n.style.setProperty('--gw', gewerkVar(z.g.slot));
      n.append(el('span', 'pr-dot'), el('span', null, z.g.name));
      body.append(n);
      continue;
    }
    const row = el('div', 'pr-row');
    row.style.height = 'calc(var(--pr-row-h) * ' + z.serie.lanes + ')';
    // Die Namensspalte trägt ALLES, was Text ist: Name, Zeit, Notiz. Im Balken
    // steht nichts — dort läge der Text über der Schraffur, stünde bei dunklen
    // Gewerkfarben schwarz auf dunkel und würde bei schmalen Balken abgeschnitten.
    // Auf Papier ist die Spalte ohnehin immer neben dem Balken; sie kann nicht
    // wegscrollen wie am Bildschirm.
    const name = el('div', 'pr-name');
    const erst = z.proId.get(z.serie.tasks[0].id).task;
    const kopf = el('div', 'pr-name-t');
    kopf.append(el('span', 'pr-name-x', z.serie.title));
    kopf.append(el('span', 'pr-name-z', zeitText(z)));
    name.append(kopf);
    // Die zweite Zeile nur, wenn sie auch hinpasst — sonst schneidet sie den
    // Namen darüber an. Genau das war auf dem ersten Probedruck zu sehen.
    const notiz = notizFuerDruck(erst.notes);
    if (notiz && mitNotiz) name.append(el('div', 'pr-name-n', notiz));
    const track = el('div', 'pr-track');
    for (const pt of z.serie.tasks) {
      const s = z.proId.get(pt.id);
      const lane = z.serie.laneOf.get(pt.id) || 0;
      if (s.task.milestone) {
        const m = el('div', 'pr-ms');
        m.style.left = pct(s.von) + '%';
        m.style.setProperty('--gw', gewerkVar(z.g.slot));
        m.style.setProperty('--lane', lane);
        track.append(m);
        continue;
      }
      const b = el('div', 'pr-bar');
      b.style.left = pct(s.von) + '%';
      b.style.width = Math.max(0.4, pct(s.bis) - pct(s.von)) + '%';
      b.style.setProperty('--gw', gewerkVar(z.g.slot));
      b.style.setProperty('--lane', lane);
      if (gewerkTexture(z.g.slot)) b.dataset.tex = '1';
      b.classList.toggle('is-est', !!s.task.estimated);
      b.classList.toggle('is-cut-l', s.schnittLinks);
      b.classList.toggle('is-cut-r', s.schnittRechts);
      track.append(b);
    }
    row.append(name, track);
    body.append(row);
  }

  sheet.append(body, fuss());
  return sheet;
}

/**
 * Die Zeitangabe für die Namensspalte. Bei einem Termin die Spanne, bei mehreren
 * ihre Zahl — «3 Termine» ist ehrlicher, als drei Spannen ineinanderzuschieben.
 * ‹ und › markieren, dass der Vorgang über die Blattkante hinausläuft.
 */
function zeitText(zeile) {
  const scheiben = zeile.serie.tasks.map((t) => zeile.proId.get(t.id));
  if (scheiben.length > 1) return scheiben.length + ' Termine';
  const s = scheiben[0];
  const a = toDate(s.von), b = toDate(s.bis);
  if (s.task.milestone) return p2(a.getHours()) + ':' + p2(a.getMinutes());
  return (s.schnittLinks ? '‹' : '') + p2(a.getHours()) + ':' + p2(a.getMinutes())
    + '–' + p2(b.getHours()) + ':' + p2(b.getMinutes()) + (s.schnittRechts ? '›' : '');
}

function fuss() {
  const f = el('div', 'pr-foot');
  const leg = el('div', 'pr-leg');
  for (const g of baender()) {
    if (!wahl.gewerke.has(g.id)) continue;
    const s = el('span', 'pr-leg-i');
    const i = el('i');
    i.style.setProperty('--gw', gewerkVar(g.slot));
    s.append(i, el('span', null, g.name));
    leg.append(s);
  }
  const q = PLAN.project.quelle || {};
  f.append(leg, el('div', null, 'CallBoard · v' + VERSION + (q.exported ? ' · Stand ' + q.exported.slice(0, 10) : '')));
  return f;
}

// ── Start ───────────────────────────────────────────────────────────────────
ladePlan().then((plan) => {
  PLAN = plan;
  const q = new URLSearchParams(location.search).get('ebene');
  if (q === 'show' && sichtGewerke(PLAN, 'show').length) wahl.ebene = 'show';
  baender().forEach((g) => wahl.gewerke.add(g.id));
  const alle = gewaehlteTasks().map((t) => toMin(t.start));
  const min = alle.length ? Math.min(...alle) : toMin(PLAN.project.start);
  const max = alle.length ? Math.max(...gewaehlteTasks().map((t) => toMin(t.end))) : toMin(PLAN.project.end);
  wahl.von = local(toDate(min)).slice(0, 10);
  wahl.bis = local(toDate(max)).slice(0, 10);
  wahl.fenster = { von: 0, bis: 24 };
  zeichne();
}).catch((e) => {
  $('sheets').append(el('div', 'pr-sheet', '')).lastChild
    .append(el('div', 'pr-leer', 'Konnte nicht laden: ' + (e.message || e)));
});
