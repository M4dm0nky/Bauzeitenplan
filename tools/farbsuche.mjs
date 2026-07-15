import { validate } from '/private/tmp/claude-501/bundled-skills/2.1.210/c7ba277b215052fb2181b7c448b6d181/dataviz/scripts/validate_palette.js';

// Gewerk-Zeilenreihenfolge ist FIX (chronologisch nach typischem Load-In).
// Gesucht: welche Hue auf welches Gewerk, so dass benachbarte Zeilen maximal
// unterscheidbar sind. Licht=gelb und Pyro=rot sind semantisch gesetzt.
const ROWS = ['Buehne', 'Rigging', 'Licht', 'Ton', 'Video', 'Pyro', 'Catering', 'Sanitaer'];

const HUES = {
  blue:    { light: '#2a78d6', dark: '#3987e5' },
  green:   { light: '#008300', dark: '#008300' },
  magenta: { light: '#e87ba4', dark: '#d55181' },
  yellow:  { light: '#eda100', dark: '#c98500' },
  aqua:    { light: '#1baf7a', dark: '#199e70' },
  orange:  { light: '#eb6834', dark: '#d95926' },
  violet:  { light: '#4a3aa7', dark: '#9085e9' },
  red:     { light: '#e34948', dark: '#e66767' },
};

const LOCKED = { Licht: 'yellow', Pyro: 'red' };
const freeRows = ROWS.filter(r => !LOCKED[r]);
const freeHues = Object.keys(HUES).filter(h => !Object.values(LOCKED).includes(h));

const SURFACES = {
  blueprint: '#f2f6fb',
  studio:    '#faf9f6',
  console:   '#f6f3ec',
  board:     '#ffffff',
};

function* perms(arr) {
  if (arr.length <= 1) { yield arr; return; }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const p of perms(rest)) yield [arr[i], ...p];
  }
}

const num = (msg) => {
  const m = String(msg).match(/ΔE\s+([\d.]+)/);
  return m ? parseFloat(m[1]) : NaN;
};
const find = (report, name) => report.find(r => r[0] === name);

function evaluate(assign) {
  const lightHex = ROWS.map(r => HUES[assign[r]].light);
  const darkHex  = ROWS.map(r => HUES[assign[r]].dark);

  const runs = [
    ...Object.entries(SURFACES).map(([k, s]) => ({ name: k, palette: lightHex, mode: 'light', surface: s })),
    { name: 'dark', palette: darkHex, mode: 'dark', surface: '#1a1a19' },
  ];

  let minCvd = Infinity, minNormal = Infinity, hardFail = false;
  for (const run of runs) {
    const { report } = validate(run.palette, { mode: run.mode, surface: run.surface });
    const cvd = find(report, 'CVD separation');
    const nrm = find(report, 'Normal-vision floor');
    const band = find(report, 'Lightness band');
    const chroma = find(report, 'Chroma floor');

    minCvd = Math.min(minCvd, num(cvd[2]));
    minNormal = Math.min(minNormal, num(nrm[2]));
    // Band/Chroma sind harte Gates; Kontrast ist laut Skill ein WARN-Band (Relief-Regel).
    if (band[1] !== true || chroma[1] !== true) hardFail = true;
    if (nrm[1] === 'fail') hardFail = true;
  }
  return { minCvd, minNormal, hardFail };
}

const results = [];
for (const p of perms(freeHues)) {
  const assign = { ...LOCKED };
  freeRows.forEach((r, i) => { assign[r] = p[i]; });
  const ev = evaluate(assign);
  if (ev.hardFail) continue;
  results.push({ assign, ...ev });
}

// Sortieren: erst CVD (das knappe Gate), dann Normalsicht
results.sort((a, b) => (b.minCvd - a.minCvd) || (b.minNormal - a.minNormal));

console.log(`${results.length} von 720 Anordnungen bestehen alle harten Gates.\n`);
console.log('TOP 5:');
for (const r of results.slice(0, 5)) {
  console.log(`  minCVD ${r.minCvd.toFixed(1)} | minNormal ${r.minNormal.toFixed(1)} | ` +
    ROWS.map(k => `${k}=${r.assign[k]}`).join(' '));
}

if (results.length) {
  const best = results[0];
  console.log('\n── GEWINNER ──');
  for (const r of ROWS) console.log(`  ${r.padEnd(10)} ${r === 'Licht' || r === 'Pyro' ? '[fix]' : '     '} ${best.assign[r].padEnd(8)} ${HUES[best.assign[r]].light}  / dark ${HUES[best.assign[r]].dark}`);
  console.log('\n  light: ' + ROWS.map(r => HUES[best.assign[r]].light).join(','));
  console.log('  dark:  ' + ROWS.map(r => HUES[best.assign[r]].dark).join(','));
}
