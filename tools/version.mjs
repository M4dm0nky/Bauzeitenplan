// ── Version setzen ────────────────────────────────────────────────────────────
// Der EINZIGE Weg, die Version zu ändern.
//
//   node tools/version.mjs            zeigt die aktuelle
//   node tools/version.mjs 0.2.0      setzt sie überall
//
// Ohne dieses Werkzeug laufen die Stellen auseinander — genau das Problem, das
// Crewplaner mit drei Zählern und einer Regel in CLAUDE.md hat. `tests/run.mjs`
// prüft die Übereinstimmung; dieses Werkzeug stellt sie her.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const P = (...p) => join(root, ...p);
const read = (p) => readFileSync(P(p), 'utf8');

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

const aktuell = () => {
  const m = read('js/version.js').match(/export const VERSION = '([^']+)'/);
  if (!m) { console.error('js/version.js enthält keine VERSION.'); process.exit(1); }
  return m[1];
};

// Größer? Stellenweise vergleichen — "0.10.0" ist größer als "0.9.0", als Text
// wäre es kleiner.
const groesser = (neu, alt) => {
  const a = neu.match(SEMVER).slice(1, 4).map(Number);
  const b = alt.match(SEMVER).slice(1, 4).map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
};

const neu = process.argv[2];

if (!neu) {
  console.log('  Aktuelle Version: ' + aktuell());
  console.log('  Ändern:           node tools/version.mjs 0.2.0');
  process.exit(0);
}

if (!SEMVER.test(neu)) {
  console.error(`\n  ✗ «${neu}» ist kein SemVer. Erwartet: Groß.Klein.Patch, z.B. 0.2.0\n`);
  process.exit(1);
}

const alt = aktuell();
if (!groesser(neu, alt)) {
  // Eine Version zurückzudrehen wäre still tödlich: Browser, die schon die
  // höhere Nummer gesehen haben, hielten den alten Stand für den neueren.
  console.error(`\n  ✗ ${neu} ist nicht größer als ${alt}.`);
  console.error('    Eine Version zurückzudrehen bricht den Cache-Schutz.\n');
  process.exit(1);
}

// ── Stempeln ────────────────────────────────────────────────────────────────
const stempel = [];

const ersetze = (datei, re, mach, was) => {
  const s = read(datei);
  const n = s.replace(re, mach);
  if (n === s) { console.error(`\n  ✗ ${datei}: ${was} nicht gefunden — Stelle umbenannt?\n`); process.exit(1); }
  writeFileSync(P(datei), n);
  stempel.push(`${datei.padEnd(20)} ${was}`);
};

ersetze('js/version.js', /export const VERSION = '[^']+'/, `export const VERSION = '${neu}'`, 'VERSION');
ersetze('package.json', /"version":\s*"[^"]+"/, `"version": "${neu}"`, '"version"');
ersetze('sw.js', /const SW_VERSION = 'v[^']+'/, `const SW_VERSION = 'v${neu}'`, 'SW_VERSION');

// ALLE ?v= in index.html — nicht nur das erste. Genau dort entsteht sonst der
// Drift: eine Stelle wandert, zwei bleiben stehen.
{
  const s = read('index.html');
  const treffer = [...s.matchAll(/\?v=[^"']+(["'])/g)].length;
  if (!treffer) { console.error('\n  ✗ index.html: kein ?v= gefunden.\n'); process.exit(1); }
  writeFileSync(P('index.html'), s.replace(/\?v=[^"']+(["'])/g, `?v=${neu}$1`));
  stempel.push('index.html'.padEnd(20) + `${treffer}× ?v=`);
}

// ── CHANGELOG ───────────────────────────────────────────────────────────────
// Ortszeit, nicht UTC: toISOString() lieferte in Berlin abends das Datum von
// gestern — ein Tag daneben, still.
const d = new Date();
const heute = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  + '-' + String(d.getDate()).padStart(2, '0');
const kopf = `## ${neu} — ${heute}\n\n_Noch zu füllen._\n\n`;
if (!existsSync(P('CHANGELOG.md'))) {
  writeFileSync(P('CHANGELOG.md'), `# Changelog\n\nNeueste Version oben.\n\n${kopf}`);
  stempel.push('CHANGELOG.md'.padEnd(20) + 'angelegt');
} else {
  const cl = read('CHANGELOG.md');
  if (cl.includes(`## ${neu}`)) stempel.push('CHANGELOG.md'.padEnd(20) + 'Abschnitt existiert schon');
  else {
    // Vor den ersten bestehenden Abschnitt, damit die neueste Version oben steht.
    const i = cl.indexOf('\n## ');
    writeFileSync(P('CHANGELOG.md'), i < 0 ? cl + '\n' + kopf : cl.slice(0, i + 1) + kopf + cl.slice(i + 1));
    stempel.push('CHANGELOG.md'.padEnd(20) + 'Abschnitt angelegt');
  }
}

console.log(`\n  ${alt} → ${neu}\n`);
for (const z of stempel) console.log('    ' + z);
console.log(`
  Als Nächstes:
    1. CHANGELOG.md füllen — der Testlauf verlangt einen Abschnitt für ${neu}
    2. node tests/run.mjs
    3. git commit && git push
    3b. git tag -a v${neu} -m "…" && git push origin v${neu}
    4. Alle offenen Tabs laden sich beim nächsten Aufruf selbst neu (sw.js hat
       sich geändert). Beim Aufbau mit dem Plan auf dem Monitor: kurz springt
       der Live-Modus.
`);
