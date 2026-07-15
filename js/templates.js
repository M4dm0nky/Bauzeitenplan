// ── Vorlagen ──────────────────────────────────────────────────────────────────
// Ein neues Projekt startet aus einer Vorlage. Alle Zeiten sind RELATIV zum
// Aufbaubeginn (`anchor`) notiert — du gibst dein Datum an, alles verschiebt
// sich mit.
//
// ACHTUNG beim Weiterbauen: «festival» ist abgenommener Praxisstand. Die drei
// anderen sind von mir entworfene GERÜSTE — richtige Gewerke, Phasen und
// Schlüssel-Meilensteine, aber bewusst keine erfundenen Detailvorgänge.
// Beim ersten echten Einsatz korrigieren, dann werden sie echt.

import { local } from './conflicts.js';

const H = 60, D = 1440;

// t(Gewerk, Titel, Start-Offset in Minuten ab Aufbaubeginn, Dauer, Extras)
const t = (gewerk, title, at, dur, extra = {}) => ({ gewerk, title, at, dur, ...extra });
const ms = (gewerk, title, at, extra = {}) => ({ gewerk, title, at, dur: 0, milestone: true, ...extra });

// ── Festival ────────────────────────────────────────────────────────────────
// Abgenommener Stand. Aufbaubeginn = Anlieferung Bühnenteile.
const FESTIVAL = {
  key: 'festival',
  name: 'Festival / Open Air',
  description: '8 Gewerke, 3-tägiger Aufbau, Genehmigungsvorlauf. Vollständig ausgearbeitet.',
  spanBefore: 70 * D,   // Planung beginnt 70 Tage vor Aufbau
  spanAfter: 9 * D,
  gewerke: ['Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Pyro', 'Catering', 'Sanitär'],
  phases: [
    { name: 'Planung', at: -70 * D, dur: 67 * D },
    { name: 'Aufbau', at: 0, dur: 4 * D },
    { name: 'Show', at: 4 * D + 6 * H, dur: 3 * D },
    { name: 'Abbau', at: 7 * D + 6 * H, dur: 2 * D },
  ],
  tasks: [
    ms('projekt', 'Doors — Publikum rein', 4 * D + 18 * H, { key: 'doors' }),

    t('Bühne', 'Statik & Genehmigung', -70 * D + 2 * H, 25 * D + 9 * H, { key: 'b1', status: 'fertig', progress: 100 }),
    t('Bühne', 'Anlieferung Bühnenteile', 0, 6 * H, { key: 'b2', status: 'fertig', progress: 100, crew: 6 }),
    t('Bühne', 'Podest & Unterbau', 2 * H, 10 * H, { key: 'b3', status: 'fertig', progress: 100, crew: 12 }),
    t('Bühne', 'Dach & Traversentürme', 6 * H, 26 * H, { key: 'b4', status: 'fertig', progress: 100, crew: 10 }),
    ms('Bühne', 'Bühne steht', 32 * H, { key: 'b5', status: 'fertig', progress: 100 }),
    t('Bühne', 'Bühne abbauen', 7 * D + 2 * H, 34 * H, { key: 'b6', crew: 14 }),

    t('Rigging', 'Rigging-Plan & Lastenberechnung', -63 * D + 3 * H, 32 * D + 8 * H, { key: 'r1', status: 'fertig', progress: 100 }),
    t('Rigging', 'Motoren hängen', D + H, 8 * H, { key: 'r2', status: 'fertig', progress: 100, crew: 8 }),
    t('Rigging', 'Traversen fliegen', D + 4 * H, 10 * H, { key: 'r3', status: 'fertig', progress: 100, crew: 8 }),
    ms('Rigging', 'Rigging freigegeben', D + 14 * H, { key: 'r4', status: 'fertig', progress: 100 }),

    t('Licht', 'Lichtdesign & Plot', -56 * D + 3 * H, 39 * D + 8 * H, { key: 'l1', status: 'fertig', progress: 100 }),
    t('Licht', 'Anlieferung Licht', D + 8 * H, 4 * H, { key: 'l2', status: 'fertig', progress: 100, crew: 4 }),
    t('Licht', 'Scheinwerfer hängen', 2 * D, 10 * H, { key: 'l3', status: 'laeuft', progress: 62, crew: 9 }),
    t('Licht', 'Verkabelung & DMX', 2 * D + 2 * H, 10 * H, { key: 'l4', status: 'laeuft', progress: 40, crew: 5 }),
    t('Licht', 'Fokus & Programmierung', 2 * D + 12 * H, 8 * H, { key: 'l5', crew: 3 }),
    ms('Licht', 'Licht fertig', 2 * D + 20 * H, { key: 'l6' }),

    t('Ton', 'Beschallungskonzept', -49 * D + 3 * H, 25 * D + 8 * H, { key: 't1', status: 'fertig', progress: 100 }),
    t('Ton', 'PA anliefern', 2 * D + 2 * H, 4 * H, { key: 't2', status: 'fertig', progress: 100, crew: 5 }),
    t('Ton', 'PA fliegen', 2 * D + 6 * H, 8 * H, { key: 't3', status: 'laeuft', progress: 15, crew: 7 }),
    t('Ton', 'FOH & Monitorwelt', 2 * D + 8 * H, 5 * H, { key: 't4', crew: 4 }),
    t('Ton', 'Systemcheck & Einmessen', 3 * D + 2 * H, 6 * H, { key: 't5', crew: 3 }),
    t('Ton', 'Soundcheck', 3 * D + 8 * H, 4 * H, { key: 't6', crew: 6 }),

    t('Video', 'LED-Wand Planung', -42 * D + 3 * H, 29 * D + 8 * H, { key: 'v1', status: 'fertig', progress: 100 }),
    t('Video', 'LED-Wand aufbauen', 2 * D + 4 * H, 26 * H, { key: 'v2', status: 'laeuft', progress: 20, crew: 8 }),
    t('Video', 'Medienserver & Signalweg', 3 * D + 3 * H, 7 * H, { key: 'v3', crew: 3 }),
    t('Video', 'Kameratest', 3 * D + 10 * H, 2 * H, { key: 'v4', crew: 4 }),

    t('Pyro', 'Genehmigung Pyrotechnik', -70 * D + 3 * H, 42 * D + 8 * H, { key: 'p1', status: 'fertig', progress: 100 }),
    t('Pyro', 'Sicherheitsabstände abstecken', 3 * D + 2 * H, 3 * H, { key: 'p2', crew: 2 }),
    t('Pyro', 'Pyro-Aufbau', 3 * D + 5 * H, 6 * H, { key: 'p3', crew: 4 }),
    ms('Pyro', 'Abnahme Brandschutz', 3 * D + 12 * H, { key: 'p4' }),

    t('Catering', 'Ausschreibung & Vergabe', -63 * D + 3 * H, 25 * D + 8 * H, { key: 'c1', status: 'fertig', progress: 100 }),
    t('Catering', 'Küchenzelt stellen', D + 2 * H, 8 * H, { key: 'c2', status: 'fertig', progress: 100, crew: 6 }),
    t('Catering', 'Kühlung & Stromanschluss', D + 10 * H, 4 * H, { key: 'c3', status: 'fertig', progress: 100, crew: 3 }),
    t('Catering', 'Crew-Catering Betrieb', 0, 8 * D + 14 * H, { key: 'c4', status: 'laeuft', progress: 45, crew: 8 }),

    t('Sanitär', 'Bedarfsplanung WC-Einheiten', -56 * D + 3 * H, 18 * D + 8 * H, { key: 's1', status: 'fertig', progress: 100 }),
    t('Sanitär', 'WC-Container liefern', H, 4 * H, { key: 's2', status: 'fertig', progress: 100, crew: 3 }),
    t('Sanitär', 'Wasser & Abwasser', 5 * H, 6 * H, { key: 's3', status: 'fertig', progress: 100, crew: 4 }),
    ms('Sanitär', 'Sanitär betriebsbereit', 11 * H, { key: 's4', status: 'fertig', progress: 100 }),
    t('Sanitär', 'Service & Reinigung', D, 7 * D + 14 * H, { key: 's5', status: 'laeuft', progress: 30, crew: 2 }),
  ],
  deps: [
    ['b1', 'b2', 'FS', 0], ['r1', 'r2', 'FS', 0], ['l1', 'l2', 'FS', 0], ['t1', 't2', 'FS', 0],
    ['v1', 'v2', 'FS', 0], ['c1', 'c2', 'FS', 0], ['c2', 'c3', 'FS', 0], ['s1', 's2', 'FS', 0],
    ['b2', 'b3', 'FS', -240], ['b3', 'b4', 'SS', 240], ['b4', 'b5', 'FS', 0],
    ['b5', 'r2', 'FS', -420], ['r2', 'r3', 'SS', 180], ['r3', 'r4', 'FS', 0],
    ['r4', 'l3', 'FS', 600], ['l2', 'l3', 'FS', 720], ['l3', 'l4', 'SS', 120],
    ['l3', 'l5', 'FS', 120], ['l4', 'l5', 'FS', 0], ['l5', 'l6', 'FS', 0],
    ['r4', 't3', 'FS', 960], ['t2', 't3', 'FS', 0], ['t3', 't5', 'FS', 720],
    ['t4', 't5', 'FS', 780], ['t5', 't6', 'FS', 0],
    ['v2', 'v3', 'FF', 240], ['v3', 'v4', 'FS', 0],
    ['p1', 'p2', 'FS', 0], ['p2', 'p3', 'FS', 0], ['p3', 'p4', 'FS', 60],
    ['s2', 's3', 'FS', 0], ['s3', 's4', 'FS', 0], ['b5', 'c2', 'SF', 120],
    ['l6', 'doors', 'FS', 0], ['t6', 'doors', 'FS', 0], ['v4', 'doors', 'FS', 0],
    ['p4', 'doors', 'FS', 0], ['s4', 'doors', 'FS', 0], ['c3', 'doors', 'FS', 0],
  ],
};

// ── Tour ────────────────────────────────────────────────────────────────────
// GERÜST — bitte beim ersten Einsatz korrigieren. Klassischer Showtag in einer
// Halle: Load-In früh, alles an einem Tag, Load-Out in der Nacht.
const TOUR = {
  key: 'tour',
  name: 'Tour / Showtag',
  description: 'Ein Showtag in einer Halle. Load-In bis Load-Out an einem Tag. Gerüst — bitte anpassen.',
  spanBefore: 2 * H,
  spanAfter: D + 6 * H,
  gewerke: ['Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Backline', 'Catering', 'Local Crew'],
  phases: [
    { name: 'Load-In', at: 0, dur: 6 * H },
    { name: 'Aufbau', at: 6 * H, dur: 6 * H },
    { name: 'Show', at: 12 * H, dur: 6 * H },
    { name: 'Load-Out', at: 18 * H, dur: 5 * H },
  ],
  tasks: [
    t('Local Crew', 'Trucks entladen', 0, 3 * H, { key: 'lc1', crew: 12 }),
    t('Rigging', 'Punkte setzen & Motoren', 0, 3 * H, { key: 'rg1', crew: 6 }),
    t('Bühne', 'Bühne & Podeste', 2 * H, 3 * H, { key: 'bu1', crew: 8 }),
    ms('Rigging', 'Rigging frei', 3 * H, { key: 'rg2' }),
    t('Licht', 'Traversen & Scheinwerfer', 3 * H, 4 * H, { key: 'li1', crew: 6 }),
    t('Ton', 'PA fliegen & FOH', 3 * H, 4 * H, { key: 'to1', crew: 5 }),
    t('Video', 'LED & Signalweg', 4 * H, 4 * H, { key: 'vi1', crew: 4 }),
    t('Backline', 'Backline aufbauen', 5 * H, 3 * H, { key: 'ba1', crew: 4 }),
    t('Licht', 'Fokus & Programmierung', 7 * H, 3 * H, { key: 'li2', crew: 2 }),
    t('Ton', 'Systemcheck', 7 * H, 2 * H, { key: 'to2', crew: 2 }),
    t('Catering', 'Crew-Catering', H, 18 * H, { key: 'ca1', crew: 3 }),
    t('Ton', 'Soundcheck', 9 * H, 2 * H, { key: 'to3', crew: 6 }),
    ms('projekt', 'Doors', 12 * H, { key: 'doors' }),
    t('Bühne', 'Show', 13 * H, 3 * H, { key: 'show', crew: 20 }),
    t('Local Crew', 'Load-Out', 18 * H, 4 * H, { key: 'lc2', crew: 16 }),
  ],
  deps: [
    ['lc1', 'rg1', 'SS', 0], ['rg1', 'bu1', 'SS', 120], ['rg1', 'rg2', 'FS', 0],
    ['rg2', 'li1', 'FS', 0], ['rg2', 'to1', 'FS', 0], ['bu1', 'vi1', 'FS', -60],
    ['bu1', 'ba1', 'FS', 0], ['li1', 'li2', 'FS', 0], ['to1', 'to2', 'FS', 0],
    ['to2', 'to3', 'FS', 0], ['li2', 'doors', 'FS', 0], ['to3', 'doors', 'FS', 0],
    ['ba1', 'doors', 'FS', 0], ['vi1', 'doors', 'FS', 0],
    ['doors', 'show', 'FS', 60], ['show', 'lc2', 'FS', 120],
  ],
};

// ── Corporate ───────────────────────────────────────────────────────────────
// GERÜST — bitte beim ersten Einsatz korrigieren.
const CORPORATE = {
  key: 'corporate',
  name: 'Corporate / Kongress',
  description: 'Firmenveranstaltung mit Generalprobe. Aufbau am Vortag. Gerüst — bitte anpassen.',
  spanBefore: 21 * D,
  spanAfter: 2 * D,
  gewerke: ['Bühne', 'Licht', 'Ton', 'Medientechnik', 'Strom', 'Möblierung', 'Catering', 'Empfang'],
  phases: [
    { name: 'Vorbereitung', at: -21 * D, dur: 21 * D },
    { name: 'Aufbau', at: 0, dur: D + 4 * H },
    { name: 'Veranstaltung', at: D + 8 * H, dur: 10 * H },
    { name: 'Abbau', at: D + 18 * H, dur: 6 * H },
  ],
  tasks: [
    t('Medientechnik', 'Technikkonzept & Zuspieler', -21 * D, 18 * D, { key: 'mt0', status: 'fertig', progress: 100 }),
    t('Strom', 'Stromversorgung & Verteilung', 0, 4 * H, { key: 'st1', crew: 3 }),
    t('Bühne', 'Bühne & Podeste', 2 * H, 5 * H, { key: 'bu1', crew: 6 }),
    ms('Bühne', 'Bühne steht', 7 * H, { key: 'bu2' }),
    t('Licht', 'Licht & Traversen', 7 * H, 5 * H, { key: 'li1', crew: 4 }),
    t('Ton', 'Beschallung & Mikrofonie', 7 * H, 4 * H, { key: 'to1', crew: 3 }),
    t('Medientechnik', 'Projektion & Regie', 8 * H, 6 * H, { key: 'mt1', crew: 4 }),
    t('Möblierung', 'Bestuhlung & Tische', D, 4 * H, { key: 'mo1', crew: 6 }),
    t('Medientechnik', 'Technikprobe', D + 2 * H, 3 * H, { key: 'mt2', crew: 4 }),
    ms('projekt', 'Generalprobe', D + 5 * H, { key: 'gp' }),
    t('Catering', 'Catering-Aufbau', D + 4 * H, 4 * H, { key: 'ca1', crew: 5 }),
    t('Empfang', 'Registrierung & Beschilderung', D + 6 * H, 2 * H, { key: 'em1', crew: 3 }),
    ms('projekt', 'Doors', D + 8 * H, { key: 'doors' }),
    t('Möblierung', 'Abbau', D + 18 * H, 6 * H, { key: 'mo2', crew: 8 }),
  ],
  deps: [
    ['st1', 'bu1', 'SS', 120], ['bu1', 'bu2', 'FS', 0], ['bu2', 'li1', 'FS', 0],
    ['bu2', 'to1', 'FS', 0], ['mt0', 'mt1', 'FS', 0], ['li1', 'mt1', 'SS', 60],
    ['mt1', 'mt2', 'FS', 720], ['mo1', 'mt2', 'FS', -120], ['mt2', 'gp', 'FS', 0],
    ['gp', 'doors', 'FS', 180], ['ca1', 'doors', 'FS', 0], ['em1', 'doors', 'FS', 0],
    ['doors', 'mo2', 'FS', 600],
  ],
};

// ── Messe ───────────────────────────────────────────────────────────────────
// GERÜST — bitte beim ersten Einsatz korrigieren.
const MESSE = {
  key: 'messe',
  name: 'Messe / Standbau',
  description: 'Standbau mit Abnahme und Messelaufzeit. Gerüst — bitte anpassen.',
  spanBefore: 42 * D,
  spanAfter: 6 * D + 12 * H,   // der Abbau endet 10h nach Tag 6, plus Luft
  gewerke: ['Standbau', 'Elektro', 'Licht', 'Medientechnik', 'Grafik', 'Möblierung', 'Catering', 'Reinigung'],
  phases: [
    { name: 'Planung', at: -42 * D, dur: 40 * D },
    { name: 'Aufbau', at: 0, dur: 2 * D + 10 * H },
    { name: 'Messelaufzeit', at: 3 * D, dur: 3 * D },
    { name: 'Abbau', at: 6 * D, dur: 12 * H },
  ],
  tasks: [
    t('Standbau', 'Standplanung & Genehmigung', -42 * D, 35 * D, { key: 'sb0', status: 'fertig', progress: 100 }),
    ms('Standbau', 'Standfläche übernommen', 0, { key: 'sb1' }),
    t('Standbau', 'Bodenaufbau', 0, 5 * H, { key: 'sb2', crew: 5 }),
    t('Standbau', 'Wände & Kabinen', 4 * H, 9 * H, { key: 'sb3', crew: 8 }),
    t('Elektro', 'Elektro & Verteilung', D, 5 * H, { key: 'el1', crew: 3 }),
    t('Licht', 'Standbeleuchtung', D + 4 * H, 4 * H, { key: 'li1', crew: 3 }),
    t('Medientechnik', 'Displays & Signalweg', D + 6 * H, 5 * H, { key: 'mt1', crew: 3 }),
    t('Grafik', 'Beschriftung & Grafik', 2 * D, 5 * H, { key: 'gr1', crew: 3 }),
    t('Möblierung', 'Möblierung & Theke', 2 * D + 3 * H, 4 * H, { key: 'mo1', crew: 4 }),
    t('Reinigung', 'Endreinigung', 2 * D + 8 * H, 2 * H, { key: 're1', crew: 2 }),
    ms('projekt', 'Abnahme & Standübergabe', 2 * D + 10 * H, { key: 'abn' }),
    t('Catering', 'Standcatering', 3 * D, 3 * D, { key: 'ca1', crew: 2 }),
    t('Standbau', 'Abbau', 6 * D, 10 * H, { key: 'sb4', crew: 10 }),
  ],
  deps: [
    ['sb0', 'sb1', 'FS', 0], ['sb1', 'sb2', 'FS', 0], ['sb2', 'sb3', 'SS', 240],
    ['sb3', 'el1', 'FS', 660], ['el1', 'li1', 'FS', -60], ['el1', 'mt1', 'FS', 60],
    ['sb3', 'gr1', 'FS', 1380], ['gr1', 'mo1', 'FS', -120], ['mo1', 're1', 'FS', 60],
    ['re1', 'abn', 'FS', 0], ['li1', 'abn', 'FS', 0], ['mt1', 'abn', 'FS', 0],
    ['abn', 'ca1', 'FS', 840], ['abn', 'sb4', 'FS', 0],
  ],
};

const LEER = {
  key: 'leer',
  name: 'Leer',
  description: 'Nur ein paar Standard-Gewerke, keine Vorgänge. Du tippst alles selbst.',
  spanBefore: 14 * D,
  spanAfter: 3 * D,
  gewerke: ['Bühne', 'Rigging', 'Licht', 'Ton', 'Video', 'Catering'],
  phases: [{ name: 'Aufbau', at: 0, dur: 2 * D }],
  tasks: [],
  deps: [],
};

export const TEMPLATES = [FESTIVAL, TOUR, CORPORATE, MESSE, LEER];
const templateByKey = (key) => TEMPLATES.find((x) => x.key === key) || LEER;

// ── Plan aus einer Vorlage bauen ────────────────────────────────────────────

const shift = (anchorMs, min) => local(new Date(anchorMs + min * 60000));

/**
 * @param {string} key        Vorlagen-Schlüssel
 * @param {object} o          { name, venue, loadIn: 'YYYY-MM-DDTHH:mm', timezone }
 * @returns Plan im Store-Format
 */
// Date.now() allein reicht nicht: zwei Projekte in derselben Millisekunde
// bekämen dieselbe id — und das zweite überschriebe das erste beim Speichern.
let projSeq = 0;

export function planFromTemplate(key, { name, venue = '', loadIn, timezone } = {}) {
  const tpl = templateByKey(key);
  const anchor = new Date(loadIn).getTime();
  const id = 'p' + Date.now().toString(36) + (projSeq++).toString(36);

  const gewerke = tpl.gewerke.map((n, i) => ({ id: 'g' + i, name: n, sort: i, slot: i }));
  const gid = new Map(gewerke.map((g) => [g.name, g.id]));

  const keyToId = new Map();
  const tasks = tpl.tasks.map((x, i) => {
    const tid = 't' + i;
    if (x.key) keyToId.set(x.key, tid);
    return {
      id: tid,
      gewerk: x.gewerk === 'projekt' ? 'projekt' : gid.get(x.gewerk),
      title: x.title,
      start: shift(anchor, x.at),
      end: shift(anchor, x.at + x.dur),
      milestone: !!x.milestone,
      progress: x.progress ?? 0,
      status: x.status || 'geplant',
      crew: x.crew ?? null,
      notes: '',
    };
  });

  const deps = tpl.deps
    .filter(([f, to]) => keyToId.has(f) && keyToId.has(to))
    .map(([f, to, type, lag], i) => ({ id: 'd' + i, from: keyToId.get(f), to: keyToId.get(to), type, lag }));

  return {
    project: {
      id,
      name: name || tpl.name,
      venue,
      start: shift(anchor, -tpl.spanBefore),
      end: shift(anchor, tpl.spanAfter),
      timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      template: tpl.key,
    },
    gewerke,
    tasks,
    deps,
    phases: tpl.phases.map((p) => ({ name: p.name, start: shift(anchor, p.at), end: shift(anchor, p.at + p.dur) })),
  };
}
