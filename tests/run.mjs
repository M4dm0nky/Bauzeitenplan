// ── Testläufer ────────────────────────────────────────────────────────────────
//   node tests/run.mjs
//
// Deckt die reine Rechenlogik ab (schedule.js, timeaxis.js) plus statische
// Prüfungen am DOM-Code, den Node nicht ausführen kann. Das Verhalten im
// Browser prüft `node tools/verify-browser.mjs`.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
let failed = 0;

// ── 1. Unit-Tests ───────────────────────────────────────────────────────────
for (const f of readdirSync(here).filter((x) => x.endsWith('.test.mjs')).sort()) {
  try {
    const out = execFileSync('node', [join(here, f)], { encoding: 'utf8' });
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
  const r = fn();
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

check('index.html lädt nur vorhandene Dateien', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const bad = [];
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)) {
    try { readFileSync(join(root, m[1])); } catch { bad.push(m[1]); }
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

check('jedes Theme gestaltet alle Bausteine der Engine', () => {
  // Fängt den Fall, dass ein neuer Baustein in gantt.js entsteht und ein Theme
  // ihn nicht kennt — dann fehlt er dort unsichtbar.
  const needed = ['bz-bar', 'bz-ms-d', 'bz-sum', 'bz-now', 'bz-dep', 'bz-tip', 'bz-ph-t', 'bz-slack', 'bz-corner-cap'];
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
  // herum und wurde trotzdem in jeden Prototyp gebündelt.
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

console.log(failed ? `\n✗ ${failed} Testgruppe(n) fehlgeschlagen\n` : '\n✓ Alles grün\n');
process.exit(failed ? 1 : 0);
