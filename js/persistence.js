// ── Speichern, Laden, Export ──────────────────────────────────────────────────
// Bis PocketBase steht, lebt alles im Browser. Das ist bequem, aber fragil:
// privater Modus, Verlauf löschen, anderer Rechner — und die Daten sind weg.
// Deshalb ist der JSON-Export hier kein Beiwerk, sondern die einzige Sicherung.
//
// Der Speicher wird hereingereicht (statt global localStorage zu greifen), damit
// die Logik ohne Browser testbar bleibt.

import { VERSION } from './version.js';
import { spanFehler } from './schedule.js';
import { artAusName, phasenFehler } from './phasen.js';

export const SCHEMA_VERSION = 1;

const K_INDEX = 'bzp_projects';
const K_ACTIVE = 'bzp_active';
const K_PLAN = (id) => 'bzp_p_' + id;

const clone = (o) => JSON.parse(JSON.stringify(o));

const speicherFehler = (e) => {
  const voll = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
  if (e && e.name === 'SecurityError') {
    return 'Speicher gesperrt (Privatmodus) – Änderungen gelten nur für diese Sitzung. Bitte exportieren.';
  }
  return voll
    ? 'Der Browser-Speicher ist voll. Exportiere den Plan als JSON und lösche alte Projekte.'
    : 'Speichern fehlgeschlagen: ' + ((e && e.message) || e);
};

// Ein gesperrter Speicher (Privatmodus, Richtlinie) wirft schon beim LESEN.
// Alle Zugriffe laufen deshalb durch diese drei Helfer: Lesen liefert null,
// Löschen verschluckt, Schreiben wirft weiter (der Aufrufer meldet es).
const lies = (storage, key) => {
  try { return storage.getItem(key); } catch { return null; }
};
const loesche = (storage, key) => {
  try { storage.removeItem(key); } catch { /* nichts zu löschen, wenn nichts da ist */ }
};

const readJSON = (storage, key, fallback) => {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;   // beschädigte Daten dürfen die App nicht töten
  }
};

// ── Migration ───────────────────────────────────────────────────────────────
// Läuft bei jedem Laden. Muss mehrfach anwendbar sein, ohne etwas kaputtzumachen.

export function migrate(plan) {
  const p = clone(plan);
  p.tasks ??= [];
  // Ein fehlender Schlüssel ist «ohne Termin» wie ein null — einheitlich null,
  // damit ohneTermin() und der Rundlauf nicht zwischen undefined und null raten.
  for (const t of p.tasks) { t.start ??= null; t.end ??= null; }
  p.deps ??= [];
  p.gewerke ??= [];
  p.project ??= {};
  p.project.timezone ??= Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Selbst angelegte Eintragsarten (Line-Check, Catering …). Sie stehen am
  // Projekt und reisen dadurch im Export mit, ohne dass deserialize einen
  // weiteren Zweig durchreichen müsste. Altpläne kennen nur die eingebauten.
  if (!Array.isArray(p.project.punktTypen)) p.project.punktTypen = [];
  // Ebenso die selbst angelegten Abschnitte (Load-in, Aftershow …). Sie sind
  // Etiketten am Eintrag; gefiltert wird weiter nach Setup und Show.
  if (!Array.isArray(p.project.abschnitte)) p.project.abschnitte = [];
  // Und die selbst angelegten Bezeichnungen für Personal & Maschinen.
  if (!Array.isArray(p.project.ressourcen)) p.project.ressourcen = [];

  // Der Farbplatz ist Identität und muss stabil sein — beim Umsortieren darf
  // sich nichts umfärben. Bestandsdaten bekommen ihn aus der Reihenfolge.
  // `art` trennt die beiden Ebenen (js/ebene.js): Gewerke tragen den
  // Bauzeitenplan, Bühnen den Showablauf. Altpläne kennen das Feld nicht und
  // sind deshalb durchweg Gewerke — der Bauzeitenplan sieht aus wie immer.
  p.gewerke.forEach((g, i) => {
    g.slot ??= i; g.sort ??= i;
    g.art = g.art === 'buehne' ? 'buehne' : 'gewerk';
  });

  // Bis v0.9.1 trug die BÜHNE den Abschnitt. Das war falsch herum: es gibt EINE
  // Bühne mit zwei zeitlichen Abläufen, nicht zwei Bühnen — und der Store
  // verbietet doppelte Bühnennamen, man hätte sie künstlich verschieden nennen
  // müssen. Jetzt trägt ihn der Zeiteintrag.
  //
  // Idempotent: beim zweiten Lauf ist g.abschnitt weg und t.abschnitt gesetzt.
  // Eine Setup-Bühne aus v0.9.1 gibt ihren Abschnitt an ihre Einträge weiter und
  // bleibt als Bühne stehen — Bänder automatisch zusammenzuführen hieße raten,
  // welches das Ziel ist, und Daten zu verschieben, die niemand zurückholt.
  const setupBand = new Set(p.gewerke.filter((g) => g.abschnitt === 'setup').map((g) => g.id));
  p.gewerke.forEach((g) => { delete g.abschnitt; });

  // Bis v0.9.3 war der Soundcheck ein einzelnes Datumsfeld am Zeiteintrag: ein
  // Startzeitpunkt ohne Dauer und ohne Ende. Damit tauchte er in keiner
  // Zeitachse auf, und zwei sich überschneidende Soundchecks sah niemand.
  // Jetzt ist er ein eigener Zeiteintrag im Setup-Abschnitt.
  //
  // ERZEUGENDE Migration — sie muss besonders sauber einmalig sein: nach der
  // Umwandlung wird `soundcheck` gelöscht, damit der zweite Ladevorgang keinen
  // zweiten Eintrag anlegt. migrate() läuft bei JEDEM Laden.
  const geboren = [];
  for (const t of p.tasks) {
    if (!t.soundcheck) { delete t.soundcheck; continue; }
    const von = String(t.soundcheck).slice(0, 16);
    const bis = new Date(von);
    bis.setMinutes(bis.getMinutes() + 60);   // 60 min als Vorgabe, änderbar
    geboren.push({
      id: 'sc' + t.id, gewerk: t.gewerk, title: 'Soundcheck ' + t.title,
      start: von,
      end: bis.getFullYear() + '-' + String(bis.getMonth() + 1).padStart(2, '0') + '-'
        + String(bis.getDate()).padStart(2, '0') + 'T' + String(bis.getHours()).padStart(2, '0')
        + ':' + String(bis.getMinutes()).padStart(2, '0'),
      milestone: false, abschnitt: 'setup', punktTyp: 'act', fuer: t.id,
    });
    delete t.soundcheck;
  }
  // Nicht doppelt anlegen, falls ein Plan die Umwandlung schon hinter sich hat.
  const da = new Set(p.tasks.map((t) => t.id));
  for (const sc of geboren) if (!da.has(sc.id)) p.tasks.push(sc);

  // `crew` war eine blanke Zahl je Vorgang — eine Person ohne Bezeichnung,
  // ohne eigenes Zeitfenster, ohne Gegenrechnung. Ersetzt durch `res`: eine
  // ganz normale Ressourcen-Zuweisung auf die Bezeichnung «Crew», über die
  // volle Vorgangsdauer (von/bis: null).
  //
  // ERZEUGEND wie die Soundcheck-Migration — sie muss besonders sauber
  // einmalig sein: läuft NUR, solange `t.crew` noch da ist. Danach wird es
  // gelöscht, damit ein zweiter Durchlauf keine zweite Zuweisung anlegt.
  if (p.tasks.some((t) => t.crew)) {
    if (!p.project.ressourcen.some((r) => r.id === 'crew')) {
      p.project.ressourcen.push({ id: 'crew', label: 'Crew', kind: 'personal' });
    }
    for (const t of p.tasks) {
      if (!t.crew) continue;
      if (!Array.isArray(t.res)) t.res = [];
      if (!t.res.some((z) => z.rid === 'crew')) {
        t.res.push({ rid: 'crew', n: t.crew, von: null, bis: null });
      }
    }
  }
  for (const t of p.tasks) delete t.crew;

  for (const t of p.tasks) {
    t.milestone = !!t.milestone;
    t.progress ??= 0;
    t.status ??= 'geplant';
    t.notes ??= '';
    // Personal & Maschinen: `res` ist der Bedarf, `bereitstellung` macht daraus
    // ein Angebot (der Pool, aus dem andere Vorgänge ihre Zuweisung nehmen).
    if (!Array.isArray(t.res)) t.res = [];
    t.bereitstellung = !!t.bereitstellung;
    // Untervorgänge: parent = id des Elternvorgangs, sonst null. Altpläne ohne
    // das Feld sind reine top-level → voll abwärtskompatibel.
    t.parent ??= null;
    // Abhaken: menschliche Aussage über eine gerechnete Warnung.
    // ackCrit = „kritisch gesehen"; ackConflictMin = akzeptierte Konfliktgröße
    // in Minuten (null = nicht akzeptiert). Meldet sich neu, wenn er größer wird.
    t.ackCrit = !!t.ackCrit;
    t.ackConflictMin ??= null;
    // Dauer geschätzt, nicht aus der Quelle. Muss sichtbar sein — sonst weiß in
    // drei Wochen niemand mehr, welcher Balken eine Zahl aus dem Plan ist und
    // welcher eine Annahme.
    t.estimated = !!t.estimated;
    // Showablauf-Felder. Sie stehen an JEDEM Vorgang, gezeigt werden sie nur in
    // der Showablauf-Ebene — ein Aufbauschritt hat halt keine Anforderungen.
    // Hier normalisiert, damit kein `undefined` in den Export gerät: ein Feld,
    // das mal da ist und mal nicht, ist beim Diff zweier Sicherungen Rauschen.
    //
    // `kontakt` ist bewusst NICHT das vorhandene `crew`: das ist eine Zahl und
    // wird in den Kennzahlen aufsummiert. Ein Tourmanager namens «Max» hätte
    // dort still eine NaN-Summe erzeugt.
    t.punktTyp ??= 'act';
    t.anforderungen ??= '';
    t.material ??= '';
    t.kontakt ??= '';
    // Wem gehört dieser Eintrag? Ein Soundcheck zeigt auf seinen Act. Text-id,
    // nie Relation — dieselbe Regel wie bei `parent`.
    t.fuer ??= null;
    // Eigener Farbplatz des Programmpunkts. null = erbt die Farbe seiner Bühne
    // (so verhalten sich alle Altpläne). Gewählt wird AUS der Palette, nie eine
    // freie Farbe — sonst wäre die Farbsuche aus docs/farbsuche.md wertlos.
    t.slot ??= null;
    // Setup (Load-in bis Showstart) oder Show (die Running Order). Nur im
    // Showablauf sichtbar; Aufbauschritte im Bauzeitenplan tragen es mit, ohne
    // dass es dort je greift — ein Feld, das je nach Band bedeutungslos ist,
    // aber überall gleich aussieht, ist billiger als eine Ausnahme.
    t.abschnitt ??= setupBand.has(t.gewerk) ? 'setup' : 'show';
    // Nur noch UNBEKANNTES auf «show» ziehen. Vorher wurde alles außer 'setup'
    // plattgemacht — mit selbst angelegten Abschnitten hätte das jeden
    // «Load-in» beim nächsten Laden gelöscht, still und ohne Rückweg.
    const bekannt = t.abschnitt === 'setup' || t.abschnitt === 'show'
      || (p.project.abschnitte || []).some((a) => a.id === t.abschnitt);
    if (!bekannt) t.abschnitt = 'show';
  }
  for (const d of p.deps) {
    d.type ??= 'FS';
    d.lag ??= 0;
  }

  // Phasen: Zeiträume mit einer FUNKTION (Planung, Vorbereitung, Aufbau, Show,
  // Abbau). Altdaten tragen nur einen Namen — die Art wird daraus erraten, sonst
  // 'aufbau'. Eine vorhandene Art bleibt, auch wenn der Name etwas anderes sagt.
  // Fehlende ids werden vergeben, aus der Reihenfolge — stabil über jeden Ladevorgang.
  // Geprüft wird hier NICHT (das macht deserialize): migrate darf nichts ablehnen.
  p.phases = Array.isArray(p.phases) ? p.phases.filter((ph) => ph && typeof ph === 'object') : [];
  const phIds = new Set(p.phases.map((ph) => ph.id).filter(Boolean));
  p.phases.forEach((ph, i) => {
    if (!ph.art) ph.art = artAusName(ph.name) || 'aufbau';
    if (!ph.id) {
      let id = 'ph' + (i + 1);
      for (let k = 2; phIds.has(id); k++) id = 'ph' + (i + 1) + '-' + k;
      ph.id = id; phIds.add(id);
    }
    ph.name = typeof ph.name === 'string' ? ph.name : '';
    ph.start ??= null; ph.end ??= null;
  });
  return p;
}

// ── Ablage ──────────────────────────────────────────────────────────────────

export function createRepo(storage) {
  const readIndex = () => {
    const idx = readJSON(storage, K_INDEX, []);
    return Array.isArray(idx) ? idx : [];
  };

  const writeIndex = (idx) => storage.setItem(K_INDEX, JSON.stringify(idx));

  return {
    list() {
      return readIndex().slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    },

    load(id) {
      const raw = readJSON(storage, K_PLAN(id), null);
      if (!raw || !raw.project) return null;
      return migrate(raw);
    },

    save(plan, { remoteSha } = {}) {
      const id = plan.project.id;
      const neu = JSON.stringify(plan);
      // Gleicher Inhalt wie schon gespeichert und ohne neue remoteSha: nichts ist
      // passiert — kein dirty, sonst laden zwei Geräte einander endlos hoch
      // (open() speichert jedes Projekt, auch ein eben heruntergeladenes).
      if (typeof remoteSha !== 'string' && lies(storage, K_PLAN(id)) === neu
          && readIndex().some((x) => x.id === id)) return { ok: true };
      try {
        storage.setItem(K_PLAN(id), neu);
      } catch (e) {
        // Verschluckt man das, glaubt man gesichert zu haben — und verliert alles.
        return { ok: false, error: speicherFehler(e) };
      }
      const alt = readIndex().find((x) => x.id === id) || {};
      const idx = readIndex().filter((x) => x.id !== id);
      // Sync-Metadaten leben NUR hier im Index, nie im Plan. Ohne Option bleibt
      // die bekannte remoteSha stehen, der Plan gilt aber als geändert.
      const mitSha = typeof remoteSha === 'string';
      idx.push({
        ...alt, id, name: plan.project.name, venue: plan.project.venue || '',
        modified: new Date().toISOString(),
        remoteSha: mitSha ? remoteSha : (alt.remoteSha ?? null),
        dirty: !mitSha,
      });
      // Der Index trägt dirty/remoteSha. Scheitert er still, gilt der Plan als
      // synchron, obwohl er es nicht ist — und der Sync überschriebe ihn.
      try { writeIndex(idx); } catch (e) { return { ok: false, error: speicherFehler(e) }; }
      return { ok: true };
    },

    remove(id) {
      loesche(storage, K_PLAN(id));
      let r = { ok: true };
      try { writeIndex(readIndex().filter((x) => x.id !== id)); } catch (e) { r = { ok: false, error: speicherFehler(e) }; }
      if (this.getActive() === id) loesche(storage, K_ACTIVE);
      return r;
    },

    syncInfo(id) {
      const e = readIndex().find((x) => x.id === id);
      return { remoteSha: e?.remoteSha ?? null, dirty: e?.dirty ?? true };
    },

    markSynced(id, sha) {
      const idx = readIndex();
      const e = idx.find((x) => x.id === id);
      if (!e) return;
      e.remoteSha = sha;
      e.dirty = false;
      try { writeIndex(idx); } catch { /* Index ist nachrangig */ }
    },

    syncListe() {
      return readIndex().map((e) => ({ id: e.id, remoteSha: e.remoteSha ?? null, dirty: e.dirty ?? true }));
    },

    getActive() { return lies(storage, K_ACTIVE); },
    // Nur eine Merkhilfe für den nächsten Start: scheitert sie, läuft die Sitzung weiter.
    setActive(id) { try { storage.setItem(K_ACTIVE, id); } catch { /* Privatmodus */ } },
  };
}

// ── Export / Import ─────────────────────────────────────────────────────────

export function serialize(plan) {
  return JSON.stringify({
    schema: SCHEMA_VERSION,
    exported: new Date().toISOString(),
    app: 'Bauzeitenplan',
    // Metadatum, keine Anzeige: wenn eine Sicherung später komisch aussieht,
    // ist die erste Frage, welche Version sie geschrieben hat.
    version: VERSION,
    ...clone(plan),
  }, null, 2);
}

// Die Spannenregel kommt aus schedule.js (spanFehler) — dieselbe wie im Store.
// Verknüpfungen auf unbekannte
// Vorgänge fallen weg (wie bei removeTask) — sie sind Ballast, kein Datenverlust.
function inhaltFehler(plan) {
  const ids = new Set();
  const eltern = new Set(plan.tasks.map((t) => t.parent).filter(Boolean));
  for (const t of plan.tasks) {
    const name = `Vorgang «${t.title ?? t.id}»`;
    if (ids.has(t.id)) return `${name}: Die id ${t.id} kommt mehrfach vor.`;
    ids.add(t.id);
    // Dieselbe Regel wie im Store; Sammelvorgänge (jemand zeigt per parent auf sie)
    // tragen eine abgeleitete Hülle und dürfen null lang sein.
    const bad = spanFehler(t.start, t.end, { milestone: !!t.milestone, sammel: eltern.has(t.id) });
    if (bad) return `${name}: ${bad}`;
  }
  plan.deps = plan.deps.filter((d) => ids.has(d.from) && ids.has(d.to));
  // Phasen: ein Fehler lehnt den Import ab und nennt die Phase — dieselbe Haltung
  // wie bei Vorgängen (still reparieren hieße, ein Datum zu erfinden).
  return phasenFehler(plan.phases);
}

export function deserialize(text, { newId = false } = {}) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Das ist keine gültige JSON-Datei.' };
  }
  if (!j || typeof j !== 'object' || !j.project) {
    return { ok: false, error: 'Die Datei enthält keinen Bauzeitenplan.' };
  }
  if (Number(j.schema) > SCHEMA_VERSION) {
    return { ok: false, error: `Die Datei stammt aus einer neueren Version (Schema ${j.schema}, hier ${SCHEMA_VERSION}). Bitte die App aktualisieren.` };
  }
  const plan = migrate({ project: j.project, gewerke: j.gewerke, tasks: j.tasks, deps: j.deps,
    phases: j.phases });
  const bad = inhaltFehler(plan);
  if (bad) return { ok: false, error: bad };
  if (newId) plan.project.id = 'p' + Date.now().toString(36);
  return { ok: true, plan };
}
