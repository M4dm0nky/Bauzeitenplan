// ── Testläufer ────────────────────────────────────────────────────────────────
//   node tests/run.mjs
//
// Deckt die reine Rechenlogik ab (schedule.js, timeaxis.js) plus statische
// Prüfungen am DOM-Code, den Node nicht ausführen kann. Das Verhalten im
// Browser prüft `node tools/verify-browser.mjs`.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
let failed = 0;

// ── 1. Unit-Tests ───────────────────────────────────────────────────────────
for (const f of readdirSync(here).filter((x) => x.endsWith('.test.mjs')).sort()) {
  try {
    // Feste Zone: die Testdaten liegen an der deutschen Zeitumstellung (25.10.2026),
    // sie sind für Europe/Berlin geschrieben. Die Grenze selbst steht in docs/entscheidungen.md («Bekannte Grenze: Zeitzone des Betrachters»).
    const out = execFileSync('node', [join(here, f)], { encoding: 'utf8', env: { ...process.env, TZ: 'Europe/Berlin' } });
    process.stdout.write(out);
  } catch (e) {
    process.stdout.write(e.stdout || '');
    process.stderr.write(e.stderr || '');
    failed++;
  }
}

// ── 2. Statische Prüfungen ──────────────────────────────────────────────────
console.log('\nStatische Prüfungen');
const check = (name, fn) => {
  // try/catch ist Pflicht: eine werfende Prüfung riss vorher den ganzen Läufer
  // mit und verdeckte alles danach.
  let r;
  try { r = fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
  if (r === true) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name + '\n      ' + r); failed++; }
};

const js = (f) => readFileSync(join(root, 'js', f), 'utf8');
const JS_FILES = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js'));

check('alle Importe zwischen den Modulen lassen sich auflösen', () => {
  const bad = [];
  for (const f of JS_FILES) {
    for (const m of js(f).matchAll(/from\s+'(\.\/[^']+)'/g)) {
      const target = m[1].replace('./', '');
      if (!JS_FILES.includes(target)) bad.push(f + ' → ' + m[1]);
    }
  }
  return bad.length ? bad.join(', ') : true;
});

check('index.html und login.html laden nur vorhandene Dateien', () => {
  const bad = [];
  for (const seite of ['index.html', 'login.html']) {
    const html = readFileSync(join(root, seite), 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)) {
      try { readFileSync(join(root, m[1])); } catch { bad.push(seite + ' → ' + m[1]); }
    }
  }
  return bad.length ? 'fehlt: ' + bad.join(', ') : true;
});

check('jedes Theme deckt beide Dunkel-Scopes ab', () => {
  // Nur die Media-Query reicht nicht: der Theme-Umschalter des Betrachters
  // muss die OS-Einstellung in beide Richtungen schlagen können.
  const bad = [];
  for (const f of readdirSync(join(root, 'styles/themes'))) {
    const s = readFileSync(join(root, 'styles/themes', f), 'utf8');
    if (!s.includes('prefers-color-scheme: dark')) bad.push(f + ' (keine Media-Query)');
    if (!s.includes('[data-theme="dark"]')) bad.push(f + ' (kein Umschalter-Scope)');
  }
  return bad.length ? bad.join(', ') : true;
});

check('Gewerk-Farben stehen nur in base.css, nicht in den Themes', () => {
  // Die Farbe ist Identität des Gewerks und muss über alle Themes gleich sein.
  const bad = [];
  for (const f of readdirSync(join(root, 'styles/themes'))) {
    const s = readFileSync(join(root, 'styles/themes', f), 'utf8');
    if (/--gw-\w+\s*:/.test(s)) bad.push(f);
  }
  return bad.length ? 'Theme definiert Gewerk-Farben neu: ' + bad.join(', ') : true;
});

check('Schrift auf Gewerkfarbe hält 3:1 — in hell UND dunkel', () => {
  // Gefüllte Balken tragen ihre Beschriftung AUF der Farbe, und die Beschriftung
  // ist die vorgeschriebene sekundäre Kodierung (docs/entscheidungen.md) — sie
  // muss lesbar sein. Weiß auf Gelb erreicht nur 2,17:1, deshalb steht neben
  // jedem Ton in base.css eine gerechnete Textfarbe (--gw-t-*).
  // Diese Prüfung schlägt an, sobald jemand an --gw-* dreht, ohne mitzurechnen.
  const css = readFileSync(join(root, 'styles/base.css'), 'utf8');
  const lum = (hex) => {
    const n = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const kontrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const tinte = {};
  for (const m of css.matchAll(/--gw-t-(\d):\s*(#[0-9a-fA-F]{6})/g)) tinte[m[1]] = m[2];
  // Alle Vorkommen je Ton: der erste Satz ist hell, die weiteren sind dunkel.
  const toene = {};
  for (const m of css.matchAll(/--gw-(\d):\s*(#[0-9a-fA-F]{6})/g)) (toene[m[1]] ||= []).push(m[2]);

  const fehlt = [...Array(10).keys()].filter((i) => !tinte[i] || !toene[i]);
  if (fehlt.length) return 'ohne Farbe oder Tinte: Ton ' + fehlt.join(', ');

  const schlecht = [];
  for (const i of Object.keys(toene)) {
    for (const farbe of toene[i]) {
      const k = kontrast(lum(farbe), lum(tinte[i]));
      if (k < 3) schlecht.push(`--gw-${i} ${farbe} auf ${tinte[i]}: ${k.toFixed(2)}:1`);
    }
  }
  return schlecht.length ? schlecht.join(' | ') : true;
});

check('Callboard hell ist warmes Weiß, kein Flächen-#fff — Text hält den Kontrast in hell UND dunkel', () => {
  // Marco: hell darf nicht grell sein. Alle Flächen-Tokens im hellen Callboard
  // (beide Scopes) sind getönt; Schrift AUF Farbflächen (--on-accent) bleibt weiß.
  const css = readFileSync(join(root, 'styles/themes/callboard.css'), 'utf8');
  const lum = (hex) => {
    const n = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const kontrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (fg, bg, a) => '#' + rgb(fg).map((c, i) => Math.round(c * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
  // Blöcke je Scope: :root { … } (hell), :root[data-theme="light"] { … }, :root[data-theme="dark"] { … }
  const block = (head) => { const i = css.indexOf(head + ' {'); return i < 0 ? '' : css.slice(i, css.indexOf('}', i)); };
  const tok = (b, n) => (b.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];
  const scopes = { 'hell :root': block(':root'), 'hell [data-theme=light]': block(':root[data-theme="light"]'), 'dunkel [data-theme=dark]': block(':root[data-theme="dark"]') };
  const fehler = [];
  for (const [name, b] of Object.entries(scopes)) {
    const hell = name.startsWith('hell');
    for (const f of ['bg', 'panel', 'panel2']) {
      const v = tok(b, f);
      if (!v) { fehler.push(`${name}: --${f} fehlt`); continue; }
      if (hell && /^#f{6}$/i.test(v)) fehler.push(`${name}: --${f} ist reinweiß`);
    }
    for (const f of ['panel', 'bg']) {
      const bg = tok(b, f), ink = tok(b, 'ink'), mu = tok(b, 'muted'), i2 = tok(b, 'ink-2');
      if (!bg || !ink || !mu || !i2) continue;
      const k1 = kontrast(lum(ink), lum(bg)), k2 = kontrast(lum(mu), lum(bg));
      if (k1 < 7) fehler.push(`${name}: --ink auf --${f} ${k1.toFixed(2)}:1 < 7`);
      if (k2 < 4.5) fehler.push(`${name}: --muted auf --${f} ${k2.toFixed(2)}:1 < 4.5`);
      // «◌ ohne Termin» (base.css .bz-lab-ohne, gedämpft per opacity) steht in der
      // Seitenspalte (--panel) und kann auf der Arbeitsfläche (--bg) landen: beide Flächen.
      {
        const op = Number((readFileSync(join(root, 'styles/base.css'), 'utf8').match(/\.bz-lab-ohne\s*\{[^}]*opacity:\s*([\d.]+)/) || [])[1]);
        if (!op) fehler.push('.bz-lab-ohne ohne opacity gefunden');
        else { const k3 = kontrast(lum(mix(i2, bg, op)), lum(bg)); if (k3 < 4.5) fehler.push(`${name}: «ohne Termin» ${k3.toFixed(2)}:1 < 4.5`); }
      }
    }
  }
  return fehler.length ? fehler.join(' | ') : true;
});

check('Phasen-Leiste: Schrift auf jeder Art-Farbe hält 4,5:1 — in allen fünf Themes, hell UND beide Dunkel-Scopes', () => {
  // Die Beschriftung IST die sekundäre Kodierung der Leiste (Farbe allein trägt
  // keine Identität) — sie muss lesbar sein. Gerechnet wird aus den Tokens,
  // nicht aus dem Augenschein.
  const lum = (hex) => {
    const n = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const kontrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const arten = ['planung', 'vorbereitung', 'aufbau', 'show', 'abbau'];
  const scopes = [':root {', '@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) {', ':root[data-theme="dark"] {', ':root[data-theme="light"] {'];
  const fehler = [];
  for (const f of readdirSync(join(root, 'styles/themes'))) {
    const css = readFileSync(join(root, 'styles/themes', f), 'utf8');
    for (const sc of scopes) {
      const i = css.lastIndexOf(sc + ' --ph-planung');
      if (i < 0) { fehler.push(`${f}: Scope «${sc}» ohne Phasen-Tokens`); continue; }
      const b = css.slice(i, css.indexOf('}', i));
      const ink = (b.match(/--ph-t:\s*(#[0-9a-fA-F]{6})/) || [])[1];
      if (!ink) { fehler.push(`${f} ${sc}: --ph-t fehlt`); continue; }
      for (const a of arten) {
        const c = (b.match(new RegExp('--ph-' + a + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];
        if (!c) { fehler.push(`${f} ${sc}: --ph-${a} fehlt`); continue; }
        const k = kontrast(lum(c), lum(ink));
        if (k < 4.5) fehler.push(`${f} ${sc}: ${a} ${k.toFixed(2)}:1 < 4.5`);
      }
    }
  }
  return fehler.length ? fehler.join(' | ') : true;
});

check('Marke «Nur Ansicht»: Schrift auf Fläche hält 4,5:1 — in allen fünf Themes, hell UND beide Dunkel-Scopes', () => {
  const lum = (hex) => {
    const n = hex.replace('#', '');
    const v = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((u) => (u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const kontrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const scopes = [':root {', '@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) {', ':root[data-theme="dark"] {', ':root[data-theme="light"] {'];
  const fehler = [];
  for (const f of readdirSync(join(root, 'styles/themes'))) {
    const css = readFileSync(join(root, 'styles/themes', f), 'utf8');
    for (const sc of scopes) {
      const i = css.lastIndexOf(sc + ' --nur-bg');
      if (i < 0) { fehler.push(`${f}: Scope «${sc}» ohne Marken-Tokens`); continue; }
      const b = css.slice(i, css.indexOf('}', i));
      const bg = (b.match(/--nur-bg:\s*(#[0-9a-fA-F]{6})/) || [])[1], t = (b.match(/--nur-t:\s*(#[0-9a-fA-F]{6})/) || [])[1];
      if (!bg || !t) { fehler.push(`${f} ${sc}: Token fehlt`); continue; }
      const k = kontrast(lum(bg), lum(t));
      if (k < 4.5) fehler.push(`${f} ${sc}: ${k.toFixed(2)}:1 < 4.5`);
    }
  }
  return fehler.length ? fehler.join(' | ') : true;
});

check('Phasen-Farbe hängt an der ART: gantt.js klassiert nie nach ph.name', () => {
  const s = js('gantt.js');
  return /bz-ph(ase)?-'\s*\+\s*ph\.name/.test(s) ? 'Klasse aus ph.name' : true;
});
check('gantt.js liest keine erfundene Gewerk-Eigenschaft (g.light)', () => {
  return /\bg\.light\b/.test(js('gantt.js')) ? 'g.light in gantt.js' : true;
});

check('GitHub-Sync entfernt: js/sync.js existiert nicht, kein bzp_sync in js/', () => {
  if (existsSync(join(root, 'js/sync.js'))) return 'js/sync.js existiert noch';
  const treffer = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js') && readFileSync(join(root, 'js', f), 'utf8').includes('bzp_sync'));
  if (treffer.length) return 'bzp_sync in js/' + treffer.join(', js/');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const rest = ['sync-dlg', 'sync-oeffnen', 'save-state'].filter((x) => html.includes(x));
  return rest.length ? 'index.html enthält noch: ' + rest.join(', ') : true;
});

check('die App holt keinen mitgelieferten Plan (kein BUNDLED/openBundled, fetch nur in der Erlaubnisliste, kein XHR/JSON-Import)', () => {
  // Erlaubnisliste statt Muster: eine zusammengesetzte URL (`fetch('./' + datei + '?v=')`)
  // ist durch kein Muster auf «.json» fassbar. Darum zählt jedes `fetch(` je Datei; erlaubt
  // sind genau die Stellen mit Netzzugriff: pb.js (die eine Anfrage an die PocketBase-API,
  // nie eine Plan-JSON).
  const ERLAUBT = { 'pb.js': 1 };
  // Nur ganze Kommentarzeilen fallen weg (Beginn `//`, `*`, `/*`), sonst zählt Prosa mit.
  // Kein Muster-Strip über den Text: `//` oder `/*` in einer Zeichenkette ließe sonst den
  // Rest der Zeile — und damit ein echtes `fetch(` — unsichtbar werden. Ein `fetch(` in
  // einem Zeilenende-Kommentar zählt mit; das fällt sofort auf und ist der sichere Fehler.
  // Die Sperre ist eine Heuristik gegen Versehen, nicht gegen absichtliche Umgehung
  // (`const f = fetch`, `globalThis['fetch']`, `sendBeacon`).
  const ohneKommentar = (s) => s.split('\n').filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n');
  const treffer = [];
  for (const f of JS_FILES) {
    const roh = js(f);
    const s = ohneKommentar(roh);
    if (/\bBUNDLED\b|openBundled|bundledKey/.test(roh)) treffer.push('js/' + f + ': BUNDLED/openBundled');
    const n = (s.match(/\bfetch\s*\(/g) || []).length;
    if (n !== (ERLAUBT[f] || 0)) treffer.push('js/' + f + ': ' + n + ' fetch( (erlaubt ' + (ERLAUBT[f] || 0) + ')');
    if (/XMLHttpRequest/.test(s)) treffer.push('js/' + f + ': XMLHttpRequest');
    if (/\bimport\s*\(|(with|assert)\s*\{\s*type\s*:\s*['"]json['"]/.test(s)) treffer.push('js/' + f + ': dynamischer/JSON-Import');
  }
  return treffer.length ? treffer.join(' | ') : true;
});

check('«kritisch» ist entfernt (js: kein critical/ackCrit/criticals/minFloat/KRIT/is-crit, Themes: keine Kritisch-Regeln)', () => {
  // Überlappung bleibt ein Konflikt; einen kritischen Pfad gibt es nicht mehr.
  // Zeilenbasiert wie die fetch-Sperre: ganze Kommentarzeilen fallen weg.
  const ohneKommentar = (s) => s.split('\n').filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z)).join('\n');
  const treffer = [];
  for (const f of JS_FILES) {
    // Einzige Ausnahme: persistence.js löscht das Altfeld beim Laden.
    const m = ohneKommentar(js(f)).replace(/^\s*delete t\.ackCrit;\s*$/m, '').match(/\.critical\b|\bcritical\s*:|\{\s*critical\s*[,}]|,\s*critical\s*[,}]|\.crit\b|ackCrit|criticals\(|minFloat|KRIT|is-crit/);
    if (m) treffer.push('js/' + f + ': ' + m[0]);
  }
  for (const f of readdirSync(join(root, 'styles/themes'))) {
    const m = readFileSync(join(root, 'styles/themes', f), 'utf8').match(/is-crit|bz-crit-tag|ft-crit/);
    if (m) treffer.push('styles/themes/' + f + ': ' + m[0]);
  }
  // Auch die ausgelieferten Seiten und die Grundformatierung: Kachel, Legende, Marken.
  for (const f of ['index.html', 'print.html', 'styles/base.css']) {
    const m = readFileSync(join(root, f), 'utf8').match(/ft-crit|data-kpi="kritisch"|is-crit|bz-crit/);
    if (m) treffer.push(f + ': ' + m[0]);
  }
  return treffer.length ? treffer.join(' | ') : true;
});

check('jedes Theme gestaltet alle Bausteine der Engine', () => {
  // Fängt den Fall, dass ein neuer Baustein in gantt.js entsteht und ein Theme
  // ihn nicht kennt — dann fehlt er dort unsichtbar.
  const needed = ['bz-bar', 'bz-ms-d', 'bz-sum', 'bz-now', 'bz-dep', 'bz-tip', 'bz-ph-t', 'bz-slack', 'bz-corner-cap',
    // Showablauf-Ebene (v0.8.0). Sie fehlten hier zunächst — nur das aktive
    // Theme kannte sie, die vier anderen hätten die Ebene ungestaltet gezeigt.
    'bz-lab-zeit', 'bz-lab-dauer', 'showhead', 'sh-v', 'buehne-i',
    // Verknüpfen per Ziehen (v0.9.7): Griff, Gummiband, ausgewählter Pfeil.
    'bz-link', 'bz-dep-ghost', 'is-link-no',
    // Versatz-Stepper: ohne Farbe ist «Delay» von «vor Plan» nicht zu
    // unterscheiden — und rot/grün ist die halbe Aussage.
    'vz-n', 'vz-txt',
    // Neue Eintragsart: schwebt über der Tabelle. Ohne eigene Fläche stünde die
    // Eingabe durchsichtig auf den Zeilen darunter.
    'tb-neuart',
    // Verwalten: ohne Rahmen sind Namensfeld und Knöpfe nicht zu unterscheiden.
    'tb-verw-n', 'tb-verw-b',
    // Die Schiene (v0.12.0): sie ist die einzige Stelle, an der der Modus
    // gewechselt wird. Ohne eigene Fläche und ohne Markierung des aktiven
    // Eintrags wäre nicht zu sehen, in welcher der beiden Welten man steht.
    'rail', 'rail-m',
    // Sync-Symbol (Speicherort): grün/gelb/rot je Zustand. Ohne eigene Regeln
    // stünde es in den anderen Themes ungestaltet im Kopf.
    'sync-state',
    // Marke «Nur Ansicht» (offline, Betrachter, Anmeldung abgelaufen): gelb mit Rahmen.
    'hd-offline', '--nur-bg', '--nur-t',
    // Zeilen-Entwurf: gelbe Zeile, grünes ✓, rotes ✗, Grund darunter.
    // Ohne eigene Regeln verlöre ✓ gegen `.tb-ico { color: var(--muted) }`.
    'is-entwurf', 'en-ok', 'en-no', 'en-grund',
    // Phasen: Farbe je ART (nicht je Name) — Leiste, Tönung und Kopfzeilen-Marke
    // lesen --ph-<art>/--ph-t aus dem Theme. Ohne sie wäre die Leiste farblos.
    '--ph-planung', '--ph-vorbereitung', '--ph-aufbau', '--ph-show', '--ph-abbau', '--ph-t',
    'bz-ph-planung', 'bz-ph-vorbereitung', 'bz-ph-aufbau', 'bz-ph-show', 'bz-ph-abbau',
    'bz-phase-planung', 'bz-phase-vorbereitung', 'bz-phase-aufbau', 'bz-phase-show', 'bz-phase-abbau',
    // Einrichten als Seite: Fläche, Navigation und die drei Statuszeichen
    // (grün/gelb/gedämpft). Ohne sie stünde die Seite in den anderen Themes ungestaltet da.
    'ein-seite', 'ein-nav', 'ein-erst', 'ein-schritt', 'ein-st-ok', 'ein-st-warn', 'ein-st-leer',
    // Bereich «Zeitraum & Phasen»: Warnleiste und Mini-Zeitleiste.
    'ein-zl', 'ein-warn',
    // Bereich «Gewerke & Bühnen»: das Farbfeld der Zeile (Schraffur ab Platz 11).
    'ein-gw-farbe',
    // Kontextmenü (Zoom, Tag, Projektmenü, Rechtsklick): fehlte in Board, Blueprint und Studio.
    'mn-i', 'mn-sep',
    // Such-Auswahl Helfer/Maschinen: schwebende Fläche, Suchfeld, Kategorie-Kopf, Eintrag.
    'rp-pop', 'rp-kopf', 'rp-item', 'rp-such',
    // Bedarfsstatus (⏳ ✓ ✕) und der Bereich «Offene Bedarfe».
    'res-st-angefragt', 'res-st-bestaetigt', 'res-st-abgelehnt', 'bd-offen',
    // Mitglieder- und Verwaltungsdialog: Zeile, Feld, Entfernen, Fehlerhinweis, Gewerk-Chip.
    'mg-zeile', 'mg-feld', 'mg-weg', 'mg-fehler', 'mg-chip'];
  const bad = [];
  for (const f of readdirSync(join(root, 'styles/themes'))) {
    const s = readFileSync(join(root, 'styles/themes', f), 'utf8');
    const miss = needed.filter((n) => !s.includes(n));
    if (miss.length) bad.push(f + ': ' + miss.join(', '));
  }
  return bad.length ? bad.join(' | ') : true;
});

// \b taugt hier NICHT: «$» ist kein Wortzeichen, also matcht \b\$ nie — die
// Prüfung meldete jeden $-Import fälschlich als ungenutzt. JS-Bezeichner dürfen
// $ und _ enthalten, die Grenze muss das abbilden.
const kommtVor = (text, sym) =>
  new RegExp('(?<![\\w$])' + sym.replace(/[$]/g, '\\$') + '(?![\\w$])').test(text);

check('jedes var(--x) ohne Rückfall in einem Theme ist dort oder in base.css definiert', () => {
  // Fängt den Fall, dass ein Theme ein Token eines ANDEREN Themes benutzt (z. B. --panel
  // in Blueprint/Studio): die Eigenschaft fiele still weg, Fläche und Kontrast fehlten.
  // Geladen wird immer base.css + genau ein Theme (index.html).
  const defs = (t) => new Set([...t.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  const base = readFileSync(join(root, 'styles/base.css'), 'utf8');
  // Zur Laufzeit per JS gesetzt (palette.js, gantt.js) — gehören keinem Theme.
  const baseDefs = new Set([...defs(base), '--gw', '--gw-t', '--grid-day', '--grid-hour']);
  const bad = [];
  for (const f of readdirSync(join(root, 'styles/themes'))) {
    const t = readFileSync(join(root, 'styles/themes', f), 'utf8');
    const d = defs(t);
    const fehlt = new Set();
    for (const m of t.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/gi)) {
      if (!d.has(m[1]) && !baseDefs.has(m[1])) fehlt.add(m[1]);
    }
    if (fehlt.size) bad.push(f + ': ' + [...fehlt].join(', '));
  }
  return bad.length ? bad.join(' | ') : true;
});

check('kein Modul importiert etwas, das es nicht benutzt', () => {
  const bad = [];
  for (const f of JS_FILES) {
    const src = js(f);
    for (const m of src.matchAll(/^import\s+\{([^}]*)\}\s+from\s+'\.\/[^']+';/gm)) {
      const nachImport = src.slice(m.index + m[0].length);
      for (const sym of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
        if (!kommtVor(nachImport, sym)) bad.push(f + ' → ' + sym);
      }
    }
  }
  return bad.length ? bad.join(', ') : true;
});

check('kein Export, den niemand importiert', () => {
  // Toter Code sammelt sich sonst still an: applyGewerk lag monatelang ungenutzt
  // herum und wurde trotzdem ausgeliefert.
  const bad = [];
  const alle = [...JS_FILES.map((f) => js(f)),
    ...readdirSync(join(root, 'tests')).map((f) => readFileSync(join(root, 'tests', f), 'utf8')),
    ...readdirSync(join(root, 'tools')).filter((f) => f.endsWith('.mjs'))
      .map((f) => readFileSync(join(root, 'tools', f), 'utf8'))];
  for (const f of JS_FILES) {
    const src = js(f);
    for (const m of src.matchAll(/^export\s+(?:const|function)\s+([A-Za-z_$][\w$]*)/gm)) {
      const sym = m[1];
      const woanders = alle.some((other) => other !== src && kommtVor(other, sym));
      if (!woanders) bad.push(f + ' → ' + sym);
    }
  }
  return bad.length ? bad.join(', ') : true;
});

// ── Version ─────────────────────────────────────────────────────────────────
// Der eigentliche Gewinn gegenüber Crewplaner: dort verlangt CLAUDE.md, in fünf
// Dateien von Hand hochzuzählen — geprüft wird nichts. Vergisst man eine, sieht
// der Nutzer alten Code und niemand merkt es. Hier fällt es sofort auf.

const versionStellen = () => {
  const raw = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };
  const holen = (p, re, was) => {
    const m = raw(p).match(re);
    return { wo: was, wert: m ? m[1] : null };
  };
  // JEDE ausgelieferte HTML-Seite, nicht nur index.html — eine zweite Seite mit
  // eigenen ?v= liefe sonst still auseinander (siehe tools/version.mjs).
  const vs = ['index.html', 'print.html', 'login.html'].flatMap((datei) =>
    [...raw(datei).matchAll(/\?v=([^"']+)["']/g)]
      .map((m, i) => ({ wo: `${datei} ?v= #${i + 1}`, wert: m[1] })));
  return [
    holen('js/version.js', /export const VERSION = '([^']+)'/, 'js/version.js'),
    holen('package.json', /"version":\s*"([^"]+)"/, 'package.json'),
    holen('sw.js', /const SW_VERSION = 'v([^']+)'/, 'sw.js'),
    ...vs,
  ];
};

check('alle Versionsstellen tragen dieselbe Nummer', () => {
  const st = versionStellen();
  const fehlt = st.filter((x) => !x.wert);
  if (fehlt.length) return 'keine Version gefunden in: ' + fehlt.map((x) => x.wo).join(', ');
  const einzig = [...new Set(st.map((x) => x.wert))];
  if (einzig.length > 1) {
    return 'laufen auseinander:\n      ' + st.map((x) => `${x.wo.padEnd(22)} ${x.wert}`).join('\n      ');
  }
  return true;
});

check('die Version ist gültiges SemVer', () => {
  const v = versionStellen()[0].wert;
  return /^\d+\.\d+\.\d+$/.test(v || '') ? true : 'kein SemVer: ' + v;
});

check('CHANGELOG hat einen Abschnitt für die aktuelle Version', () => {
  // Zwingt dazu, den Eintrag beim Versionswechsel wirklich zu füllen.
  const v = versionStellen()[0].wert;
  let cl;
  try { cl = readFileSync(join(root, 'CHANGELOG.md'), 'utf8'); }
  catch { return 'CHANGELOG.md fehlt'; }
  return cl.includes('## ' + v) ? true : `kein Abschnitt «## ${v}»`;
});

check('jede ausgelieferte Datei steht in HUELLE (sw.js) — und keine tote', () => {
  // Offline geht nur, was der Worker beim Installieren einsammelt. Eine neue
  // Datei ohne Eintrag fehlt offline unsichtbar; ein Eintrag ohne Datei lässt
  // addAll() scheitern und damit die ganze Installation.
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const m = sw.match(/const HUELLE = \[([\s\S]*?)\];/);
  if (!m) return 'sw.js hat kein «const HUELLE = [...]»';
  const drin = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((x) => x !== './');
  const rekursiv = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? rekursiv(dir + '/' + d.name) : [dir + '/' + d.name]);
  const soll = [
    ...readdirSync(root).filter((f) => f.endsWith('.html')),
    ...rekursiv('js').filter((f) => f.endsWith('.js')),
    ...rekursiv('styles').filter((f) => f.endsWith('.css')),
    ...rekursiv('assets'),
  ];
  const fehlt = soll.filter((f) => !drin.includes(f));
  const tot = drin.filter((f) => !soll.includes(f));
  const dopp = drin.filter((f, i) => drin.indexOf(f) !== i);
  const r = [];
  if (fehlt.length) r.push('fehlt in HUELLE: ' + fehlt.join(', '));
  if (tot.length) r.push('tot (Datei gibt es nicht / nicht ausgeliefert): ' + tot.join(', '));
  if (dopp.length) r.push('doppelt: ' + dopp.join(', '));
  return r.length ? r.join(' | ') : true;
});

// ── Auslieferung: Docker-Image enthält genau die ausgelieferten Dateien ───────────────────────────
// Rein: welche Repo-Dateien landen laut Dockerfile (COPY) und .dockerignore im Image? `dateien` = Repo-relative
// Pfade (real: `git ls-files`, wie Coolify sie auscheckt). Mustersprache wie Docker: letzter Treffer gewinnt,
// `!` hebt auf, `*` bleibt in einer Ebene, `**/` darf Ebenen überspringen, ein Muster gilt auch für alles darunter.
const dockerRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?') + '(?:/.*)?$');
const imageDateien = (dockerfile, ignore, dateien) => {
  const regeln = ignore.split('\n').map((z) => z.trim()).filter((z) => z && !z.startsWith('#'))
    .map((z) => ({ neg: z.startsWith('!'), re: dockerRe(z.replace(/^!/, '').replace(/^\//, '').replace(/\/$/, '')) }));
  const ausgeschlossen = (f) => regeln.reduce((aus, r) => (r.re.test(f) ? !r.neg : aus), false);
  const quellen = [];
  for (const z of dockerfile.split('\n')) {
    const m = z.match(/^\s*COPY\s+(.+)$/i);
    if (!m) continue;
    const teile = m[1].trim().split(/\s+/).filter((x) => !x.startsWith('--'));
    quellen.push(...teile.slice(0, -1));
  }
  const drin = new Set();
  for (const q of quellen) {
    const pfad = q.replace(/^\.\//, '');
    const alle = pfad === '.' || pfad === './';
    for (const f of dateien) {
      if (ausgeschlossen(f)) continue;
      if (alle || f === pfad.replace(/\/$/, '') || f.startsWith(pfad.replace(/\/?$/, '/'))) drin.add(f);
    }
  }
  return [...drin].sort();
};
const huelleListe = () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const m = sw.match(/const HUELLE = \[([\s\S]*?)\];/);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((x) => x !== './') : [];
};
const imageProbleme = (dockerfile, ignore, dateien, huelle) => {
  const drin = imageDateien(dockerfile, ignore, dateien);
  const r = [];
  const verboten = drin.filter((f) => /^(docs|tools|tests|pocketbase|\.superpowers|\.claude|node_modules|\.git)\//.test(f) || /\.(md|mjs)$/.test(f) || f === 'Dockerfile');
  if (verboten.length) r.push('gehört nicht ins Image: ' + verboten.slice(0, 5).join(', ') + (verboten.length > 5 ? ` (+${verboten.length - 5})` : ''));
  const fehlt = [...huelle, 'sw.js'].filter((f) => !drin.includes(f));
  if (fehlt.length) r.push('fehlt im Image (steht in HUELLE): ' + fehlt.join(', '));
  const extra = drin.filter((f) => ![...huelle, 'sw.js', 'nginx.conf'].includes(f) && !verboten.includes(f));
  if (extra.length) r.push('nicht ausgeliefert, aber im Image: ' + extra.slice(0, 5).join(', '));
  return r;
};

check('Docker-Image (Dockerfile + .dockerignore): genau die ausgelieferten Dateien, alle aus HUELLE, nichts aus docs/tools/tests/pocketbase', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const df = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const ign = readFileSync(join(root, '.dockerignore'), 'utf8');
  // Selbstprüfung (Rot-Nachweis): die Prüfung MUSS bei einem kaputten Image anschlagen.
  const baum = ['index.html', 'print.html', 'login.html', 'sw.js', 'nginx.conf', 'Dockerfile', 'js/app.js', 'js/version.js', 'styles/base.css',
    'assets/a.svg', 'docs/x.md', 'tools/t.mjs', 'tests/run.mjs', 'pocketbase/setup.mjs', '.claude/rules/a.md', 'README.md'];
  const huelle = ['index.html', 'print.html', 'login.html', 'js/app.js', 'js/version.js', 'styles/base.css', 'assets/a.svg'];
  const gut = 'COPY nginx.conf /c\nCOPY index.html print.html login.html sw.js /h/\nCOPY js/ /h/js/\nCOPY styles/ /h/styles/\nCOPY assets/ /h/assets/\n';
  const gutIgn = '*\n!index.html\n!print.html\n!login.html\n!sw.js\n!nginx.conf\n!js\n!styles\n!assets\n';
  const selbst = [
    ['Allowlist ok', gut, gutIgn, 0],
    ['COPY . ohne .dockerignore', 'COPY . /h/\n', '', 1],
    ['COPY . mit leerem Ausschluss von docs', 'COPY . /h/\n', '*\n!js\n!styles\n!assets\n!index.html\n!print.html\n!login.html\n!sw.js\n!docs\n', 1],
    ['assets fehlt', gut.replace('COPY assets/ /h/assets/\n', ''), gutIgn, 1],
    ['.dockerignore sperrt js', gut, gutIgn.replace('!js\n', ''), 1],
  ];
  const kaputt = selbst.filter(([, d, i, n]) => (imageProbleme(d, i, baum, huelle).length > 0) !== (n > 0)).map(([n]) => n);
  if (kaputt.length) return 'Selbstprüfung der Image-Sperre falsch bei: ' + kaputt.join(', ');
  const r = imageProbleme(df, ign, tracked, huelleListe());
  return r.length ? r.join(' | ') : true;
});

check('nginx.conf: sw.js ohne HTTP-Cache, gzip an, kein SPA-Fallback, Health-Check', () => {
  const n = readFileSync(join(root, 'nginx.conf'), 'utf8');
  const r = [];
  if (!/location = \/sw\.js \{[^}]*Cache-Control "no-cache/.test(n)) r.push('sw.js ohne no-cache');
  if (!/^\s*gzip on;/m.test(n)) r.push('gzip aus');
  if (/try_files[^;]*\/index\.html/.test(n)) r.push('SPA-Fallback auf index.html (unbekannte Pfade müssen 404 sein)');
  if (!/location = \/healthz/.test(n)) r.push('/healthz fehlt (HEALTHCHECK im Dockerfile)');
  if (!/EXPOSE 80/.test(readFileSync(join(root, 'Dockerfile'), 'utf8'))) r.push('Dockerfile: EXPOSE 80 fehlt');
  return r.length ? r.join(' | ') : true;
});


check('sw.js legt die HUELLE am HTTP-Cache vorbei an (cache: reload)', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const inst = sw.match(/addEventListener\('install'[\s\S]*?\n\}\);/);
  return inst && /cache:\s*'reload'/.test(inst[0]) ? true : "install ohne { cache: 'reload' }";
});

check('CLAUDE.md (Kern) hat höchstens 130 Zeilen und 9 200 Zeichen, keine Zeile über 300 Zeichen (Tabellenzeilen ausgenommen)', () => {
  // Wird bei jeder Sitzung geladen. Gemessen wird in Zeichen (= Token), nicht nur in
  // Zeilen: lange Zeilen sparen nichts. Wächst der Kern, gehört die Regel in eine
  // `.claude/rules/*.md` mit `paths:` (lädt nur bei passenden Dateien), Begründungen
  // und Vorgeschichten nach docs/entscheidungen.md.
  const t = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  const zeilen = t.split('\n');
  const r = [];
  if (zeilen.length > 130) r.push(`${zeilen.length} Zeilen (Grenze 130)`);
  if (t.length > 9200) r.push(`${t.length} Zeichen (Grenze 9 200)`);
  const lang = zeilen.map((z, i) => [i + 1, z]).filter(([, z]) => z.length > 300 && !z.startsWith('|'));
  if (lang.length) r.push(`${lang.length} Zeile(n) über 300 Zeichen, erste: Zeile ${lang[0][0]}`);
  return r.length ? r.join(' | ') + ' — Regel in .claude/rules/ auslagern, Begründungen nach docs/entscheidungen.md' : true;
});

// Regeldateien: `paths:`-Muster müssen existierende Dateien treffen, sonst lädt die Regel nie.
const globRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0000').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\u0000/g, '(?:.*/)?') + '$');
function pruefeRegeln(dir) {
  const r = [];
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  let dateien = [];
  try { dateien = readdirSync(dir).filter((x) => x.endsWith('.md')).sort(); } catch { return [`${dir} fehlt`]; }
  if (!dateien.length) r.push('keine Regeldatei');
  for (const f of dateien) {
    const t = readFileSync(join(dir, f), 'utf8');
    if (t.length > 6000) r.push(`${f}: ${t.length} Zeichen (Grenze 6 000)`);
    const m = t.match(/^---\n([\s\S]*?)\n---\n/);
    const pm = m && m[1].match(/^paths:\n((?:  - ".+"\n?)+)$/);
    if (!pm) { r.push(`${f}: Frontmatter mit paths: fehlt oder ist ungültig`); continue; }
    for (const g of [...pm[1].matchAll(/"(.+)"/g)].map((x) => x[1])) {
      const re = globRe(g);
      if (!tracked.some((x) => re.test(x))) r.push(`${f}: Muster «${g}» trifft keine Datei`);
    }
  }
  return r;
}
check('.claude/rules/*.md: gültiges Frontmatter paths:, jedes Muster trifft eine Datei, höchstens 6 000 Zeichen', () => {
  const r = pruefeRegeln(join(root, '.claude', 'rules'));
  return r.length ? r.join(' | ') : true;
});

check('alle in index.html verdrahteten IDs kommen in app.js vor', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const app = js('app.js');
  const bad = [];
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    const id = m[1];
    if (id === 'theme-css') continue; // nur Umschaltpunkt, kein JS nötig
    if (!app.includes("'" + id + "'") && !app.includes('"' + id + '"')) bad.push(id);
  }
  return bad.length ? 'ohne Verwendung: ' + bad.join(', ') : true;
});

// Rein: true, sobald nach dem ERSTEN process.exit (außerhalb von Kommentarzeilen)
// noch ein test()/check() folgt — so ein Test läuft nie.
const hatToteTests = (src) => {
  const zeilen = src.split('\n');
  const kommentar = (z) => /^\s*(\/\/|\*|\/\*)/.test(z);
  const i = zeilen.findIndex((z) => !kommentar(z) && /process\.exit/.test(z));
  if (i < 0) return false;
  return zeilen.slice(i + 1).some((z) => !kommentar(z) && /^\s*(await\s+)?(test|check)\(/.test(z));
};

check('kein test()/check() nach process.exit in tests/*.test.mjs (toter Test)', () => {
  const selbst = [
    ['Exit mitten in der Datei', "test('a')\nprocess.exit(0);\ntest('b')\nprocess.exit(0)", true],
    ['await test nach Exit', "process.exit(0);\nawait test('b', () => {})", true],
    ['Exit nur im Kommentar', "// process.exit(0)\ntest('a')\nprocess.exit(0)", false],
    ['sauber', "test('a')\nprocess.exit(0)", false],
  ];
  const kaputt = selbst.filter(([, q, erwartet]) => hatToteTests(q) !== erwartet).map(([n]) => n);
  if (kaputt.length) return 'Selbstprüfung der Sperre falsch bei: ' + kaputt.join(', ');
  const bad = readdirSync(join(root, 'tests')).filter((x) => x.endsWith('.test.mjs'))
    .filter((f) => hatToteTests(readFileSync(join(root, 'tests', f), 'utf8')));
  return bad.length ? 'Tests nach process.exit (laufen nie): ' + bad.join(', ') : true;
});

check('Keine absoluten Import-Pfade in tools/*.mjs und js/*.js', () => {
  // Ein Import aus «/private/tmp/…» o. ä. bricht auf jedem anderen Rechner (Issue #4).
  const dateien = [
    ...readdirSync(join(root, 'tools')).filter((x) => x.endsWith('.mjs')).map((x) => 'tools/' + x),
    ...readdirSync(join(root, 'js')).filter((x) => x.endsWith('.js')).map((x) => 'js/' + x),
  ];
  // Nur statische Importe am Zeilenanfang; `await import('/js/…')` in page.evaluate läuft im Browser gegen den Server und ist ok.
  const re = /^\s*(?:import\b[^;'"]*?\bfrom|import|export\b[^;'"]*?\bfrom)\s*['"]\//m;
  const bad = dateien.filter((f) => re.test(readFileSync(join(root, f), 'utf8')));
  return bad.length ? 'absoluter Import in: ' + bad.join(', ') : true;
});

console.log(failed ? `\n✗ ${failed} Testgruppe(n) fehlgeschlagen\n` : '\n✓ Alles grün\n');
process.exit(failed ? 1 : 0);
