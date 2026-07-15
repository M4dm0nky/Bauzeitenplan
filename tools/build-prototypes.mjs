// ── Design-Prototypen bauen ───────────────────────────────────────────────────
// Erzeugt aus derselben Engine vier EIGENSTÄNDIGE HTML-Dateien, eine je Theme.
// Nur dafür gedacht, die Entwürfe als Artifact zu teilen (strikte CSP: keine
// externen Ressourcen, alles muss inline sein). Die echte App unter index.html
// braucht KEINEN Build — sie lädt ES-Module und CSS direkt.
//
//   node tools/build-prototypes.mjs   →  tools/out/<theme>.html
//
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const read = (...p) => readFileSync(join(root, ...p), 'utf8');

// Die Reihenfolge ist die Bauanleitung: Abhängigkeit vor Verwender. Diese Liste
// gibt es genau EINMAL — sie dreimal zu pflegen wäre selbst eine Fehlerquelle.
const FILES = ['version.js', 'dom.js', 'schedule.js', 'timeaxis.js', 'palette.js',
               'conflicts.js', 'live.js', 'store.js', 'templates.js', 'gantt.js'];

// ES-Module zu einem inline-Skript zusammenziehen: Importe zwischen den eigenen
// Modulen fallen weg, die Reihenfolge oben macht den Rest.
const strip = (code) =>
  code
    .replace(/^import\s+[\s\S]*?from\s+'\.\/[^']+';\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\}\s+from\s+'\.\/[^']+';\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\};\s*$/gm, '')
    .replace(/^export\s+(const|function|class|let)\s/gm, '$1 ');

const JS = FILES.map((f) => strip(read('js', f))).join('\n');

// Zeilenmaße je Theme: Board will Plakat-Format, Console dichte Datenaufstellung.
// console steht zuerst — das ist die gewählte Variante.
export const VARIANTS = [
  { key: 'console',   name: 'Console',   title: 'Bauzeitenplan — Console',
    opts: { rowH: 24, groupH: 28, barH: 12, sideW: 228, initialZoom: 'tage' } },
  { key: 'blueprint', name: 'Blueprint', title: 'Bauzeitenplan — Blueprint',
    opts: { rowH: 26, groupH: 32, barH: 13, sideW: 236, initialZoom: 'tage' } },
  { key: 'studio',    name: 'Studio',    title: 'Bauzeitenplan — Studio',
    opts: { rowH: 34, groupH: 44, barH: 20, sideW: 254, initialZoom: 'tage' } },
  { key: 'board',     name: 'Board',     title: 'Bauzeitenplan — Board',
    opts: { rowH: 40, groupH: 50, barH: 28, sideW: 268, initialZoom: 'tage' } },
];

// Naives Aneinanderhängen kann Namen doppeln (zwei Module mit demselben
// const). Als ES-Module fällt das nie auf, im Bündel ist es ein SyntaxError
// und die Seite bleibt leer. Also hier prüfen, nicht erst im Browser.
{
  const dup = new Map();
  for (const f of FILES) {
    for (const m of read('js', f).matchAll(/^(?:export\s+)?(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/gm)) {
      const prev = dup.get(m[1]);
      if (prev && prev !== f) {
        console.error(`\n  ✗ «${m[1]}» ist in ${prev} UND ${f} deklariert.`);
        console.error('    Im Bündel gäbe das einen SyntaxError. Eines importiert es besser vom anderen.\n');
        process.exit(1);
      }
      dup.set(m[1], f);
    }
  }
}

// Der Build prüfte bisher nur auf DOPPELTE Namen. Fehlende fielen durch: als
// gantt.js anfing, `el` aus dom.js zu importieren, war es im Bündel schlicht
// undefiniert — der Prototyp blieb leer, ohne dass hier etwas aufgefallen wäre.
{
  const gebuendelt = new Set(FILES);
  const fehlen = new Set();
  for (const f of FILES) {
    for (const m of read('js', f).matchAll(/^import\s+\{[^}]*\}\s+from\s+'\.\/([^']+)'/gm)) {
      if (!gebuendelt.has(m[1])) fehlen.add(`${f} braucht ${m[1]}`);
    }
  }
  if (fehlen.size) {
    console.error('\n  ✗ Nicht gebündelte Abhängigkeit — der Prototyp bliebe leer:');
    for (const x of fehlen) console.error('    ' + x);
    console.error('    → in die JS-Liste aufnehmen (Reihenfolge: Abhängigkeit zuerst).\n');
    process.exit(1);
  }
}

const shell = read('tools', 'prototype-shell.html');
const base = read('styles', 'base.css');
mkdirSync(join(here, 'out'), { recursive: true });

for (const v of VARIANTS) {
  const html = shell
    .replaceAll('{{TITLE}}', v.title)
    .replaceAll('{{NAME}}', v.name)
    .replaceAll('{{KEY}}', v.key)
    .replace('{{BASE_CSS}}', base)
    .replace('{{THEME_CSS}}', read('styles', 'themes', v.key + '.css'))
    .replace('{{JS}}', JS)
    .replace('{{OPTS}}', JSON.stringify(v.opts));
  writeFileSync(join(here, 'out', v.key + '.html'), html);
  console.log('  ✓ ' + v.key.padEnd(10) + (html.length / 1024).toFixed(0).padStart(4) + ' kB  → tools/out/' + v.key + '.html');
}
console.log('\n' + VARIANTS.length + ' Prototypen gebaut.');
