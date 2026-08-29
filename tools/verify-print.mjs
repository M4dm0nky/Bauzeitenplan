// Tagesblätter prüfen — und dabei ECHTE A3-PDFs erzeugen, nicht nur Screenshots.
// page.pdf() geht denselben Weg wie der Druckdialog: dieselben @page-Regeln,
// dieselben Seitenumbrüche. Ein Screenshot würde genau das nicht prüfen.
import { firefox, chromium } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
const here = dirname(fileURLToPath(import.meta.url)); const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });
const cache = join(process.env.HOME, 'Library/Caches/ms-playwright');
const exe = join(cache, readdirSync(cache).find((d) => d.startsWith('firefox-')), 'firefox/Nightly.app/Contents/MacOS/firefox');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer((q, s) => {
  const rel = normalize(decodeURIComponent(q.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = join(root, rel === '/' ? 'index.html' : rel);
  if (!f.startsWith(root) || !existsSync(f)) { s.writeHead(404); return s.end('x'); }
  s.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  s.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const b = await firefox.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 1700, height: 1000 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('JS: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let bad = 0;
const check = async (name, fn) => {
  let r; try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
  if (r === true) console.log('  ✓ ' + name); else { console.log('  ✗ ' + name + ': ' + r); bad++; }
};

console.log('\nTAGESBLÄTTER');
await p.goto(BASE + '/print.html?plan=klassentreffen');
await p.waitForSelector('.pr-sheet', { timeout: 15000 });
await p.waitForTimeout(600);

await check('ein Blatt je Tag — 14 Stück', async () => {
  const n = await p.locator('.pr-sheet').count();
  return n === 14 ? true : n + ' Blätter statt 14';
});
await check('die Blätter laufen chronologisch', async () => {
  const tage = await p.locator('.pr-sheet').evaluateAll((ns) => ns.map((n) => n.dataset.tag));
  const sortiert = [...tage].sort();
  return JSON.stringify(tage) === JSON.stringify(sortiert) ? true : tage.join(', ');
});
await check('jedes Blatt trägt Datum und Blattnummer', async () => {
  const n = await p.locator('.pr-sheet .pr-head-n').count();
  const erst = await p.locator('.pr-sheet .pr-head-n').first().textContent();
  return n === 14 && /Blatt 1 von 14/.test(erst) ? true : erst;
});

await check('kein Balken läuft über den Blattrand', async () => {
  const raus = await p.evaluate(() => {
    for (const sh of document.querySelectorAll('.pr-sheet')) {
      const r = sh.getBoundingClientRect();
      for (const bar of sh.querySelectorAll('.pr-bar')) {
        const x = bar.getBoundingClientRect();
        if (x.right > r.right + 1 || x.left < r.left - 1 || x.bottom > r.bottom + 1) return sh.dataset.tag;
      }
    }
    return null;
  });
  return raus ? 'Blatt ' + raus + ' läuft über' : true;
});

await check('keine zwei Balken derselben Zeile liegen übereinander', async () => {
  const kollision = await p.evaluate(() => {
    for (const tr of document.querySelectorAll('.pr-track')) {
      const bs = [...tr.querySelectorAll('.pr-bar')].map((x) => x.getBoundingClientRect());
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], c = bs[j];
        if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) return true;
      }
    }
    return false;
  });
  return kollision ? 'zwei Balken übereinander' : true;
});

await check('die Nachtschicht steht auf BEIDEN Blättern, angeschnitten', async () => {
  // «HELFER tse» läuft am 30.08. von 22:00 bis 04:00 am 31.
  const a = await p.locator('.pr-sheet[data-tag="2026-08-30"] .pr-bar.is-cut-r').count();
  const c = await p.locator('.pr-sheet[data-tag="2026-08-31"] .pr-bar.is-cut-l').count();
  if (!a) return 'am 30.08. ist nichts rechts angeschnitten';
  if (!c) return 'am 31.08. ist nichts links angeschnitten';
  return true;
});

await check('Namen sind nicht leer und nicht abgeschnitten dargestellt', async () => {
  const leer = await p.locator('.pr-name-t').evaluateAll((ns) => ns.filter((n) => !n.textContent.trim()).length);
  return leer === 0 ? true : leer + ' Zeilen ohne Namen';
});

const zeilenAm30 = async () => p.locator('.pr-sheet[data-tag="2026-08-30"] .pr-row').count();
const fensterText = async () => {
  const v = await p.locator('.pr-ctl input[type="time"]').first().inputValue();
  const b2 = await p.locator('.pr-ctl input[type="time"]').last().inputValue();
  return v + '–' + b2;
};

// Der Druckmodus muss auch am Bildschirm greifen — sonst prüfen wir eine Ansicht,
// die es beim Drucken nicht gibt.
console.log('\nDRUCKMODUS');
await p.emulateMedia({ media: 'print' });
await p.waitForTimeout(300);
await check('die Steuerleiste ist im Druck weg', async () =>
  (await p.locator('.pr-ctl').isHidden()) ? true : 'Steuerleiste würde mitgedruckt');
await check('die Blätter stehen auch im Druckmodus', async () => {
  const n = await p.locator('.pr-sheet').count();
  return n === 14 ? true : n + ' Blätter';
});
// locator.screenshot() scrollt selbst hin — ein clip auf ein Blatt weit unten
// läge sonst außerhalb des Bildes.
await p.locator('.pr-sheet').nth(7).screenshot({ path: join(here, 'shots', 'druck-blatt.png') });
await p.emulateMedia({ media: 'screen' });
await p.waitForTimeout(200);

console.log('\nWEGKLICKEN WIRKT');
const vorher = { zeilen: await zeilenAm30(), fenster: await fensterText() };
console.log('    alle Gewerke, ganzer Zeitraum: ' + vorher.zeilen + ' Zeilen am 30.08.');
await p.screenshot({ path: join(here, 'shots', 'druck-alle.png'), fullPage: false });

await check('weggeklickte Gewerke verschwinden von den Blättern', async () => {
  for (const name of ['Security', 'Crew']) {
    await p.locator('.pr-gw label', { hasText: new RegExp('^' + name + '$') }).locator('input').uncheck();
    await p.waitForTimeout(200);
  }
  const n = await zeilenAm30();
  console.log('    ohne Security+Crew:            ' + n + ' Zeilen am 30.08.');
  return n < vorher.zeilen ? true : 'Zeilenzahl unverändert (' + n + ')';
});
await check('die Legende zeigt nur noch die gewählten Gewerke', async () => {
  const n = await p.locator('.pr-sheet').first().locator('.pr-leg-i').count();
  return n === 18 ? true : n + ' Einträge statt 18 (20 minus Security und Crew)';
});

// Der eigentliche Effekt: der Maßstab. Über den GANZEN Zeitraum bleibt das
// Fenster bei 24 h, weil auch ohne Security Vorgänge über Mitternacht laufen
// (Produktion vor Ort bis 00:00, Ausbau bis 03:00). Auf die Aufbauwoche begrenzt
// schrumpft es auf den Arbeitstag — aus 14 mm je Stunde werden 34.
await check('ohne Security wird aus 24 h eine Aufbauwoche von 08–18 Uhr', async () => {
  const datum = p.locator('.pr-ctl input[type="date"]');
  await datum.first().fill('2026-08-21');
  await datum.first().dispatchEvent('change');
  await p.waitForTimeout(250);
  await datum.last().fill('2026-08-26');
  await datum.last().dispatchEvent('change');
  await p.waitForTimeout(400);
  const f = await fensterText();
  console.log('    Aufbauwoche ohne Security:     Fenster ' + f + ' (vorher ' + vorher.fenster + ')');
  const blaetter = await p.locator('.pr-sheet').count();
  if (blaetter !== 6) return blaetter + ' Blätter statt 6';
  return f === '08:00–18:00' ? true : 'Fenster ' + f;
});
await p.screenshot({ path: join(here, 'shots', 'druck-gefiltert.png'), fullPage: false });

// ── Echtes PDF, wenn Chromium da ist ────────────────────────────────────────
// page.pdf() geht denselben Weg wie der Druckdialog — nur kann das in Playwright
// ausschließlich Chromium. Ohne ihn prüfen wir das Layout (oben, im Druckmodus),
// aber nicht die Seitenaufteilung. Einmalig holen: npx playwright install chromium
console.log('\nPDF (A3 quer)');
const chromDir = readdirSync(cache).find((d) => d.startsWith('chromium-'));
// Den Pfad NICHT raten: der Ordner heißt je nach Architektur `chrome-mac` oder
// `chrome-mac-arm64`, und das Programm darin mal `Chromium.app`, mal
// «Google Chrome for Testing.app». Hart verdrahtet stürzte der Lauf ab, statt
// sauber zu überspringen — und ein abgebrochener Download hinterlässt einen
// leeren Ordner, der wie eine Installation aussieht.
const chromExe = (() => {
  if (!chromDir) return null;
  const bin = join(cache, chromDir);
  const arch = readdirSync(bin).find((d) => d.startsWith('chrome-mac'));
  if (!arch) return null;
  const app = readdirSync(join(bin, arch)).find((d) => d.endsWith('.app'));
  if (!app) return null;
  const p = join(bin, arch, app, 'Contents', 'MacOS', app.replace(/\.app$/, ''));
  return existsSync(p) ? p : null;
})();
if (!chromExe) {
  console.log('  – übersprungen: Chromium nicht installiert.');
  console.log('    Für echte PDFs einmalig:  npx playwright install chromium');
} else {
  const cb = await chromium.launch({ executablePath: chromExe });
  const cp = await cb.newPage();
  await cp.goto(BASE + '/print.html?plan=klassentreffen');
  await cp.waitForSelector('.pr-sheet', { timeout: 15000 });
  await cp.waitForTimeout(600);
  const pfad = join(here, 'shots', 'tagesblaetter.pdf');
  await cp.pdf({ path: pfad, width: '420mm', height: '297mm', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' } });
  await cb.close();
  await check('tagesblaetter.pdf ist erzeugt und nicht leer', async () => {
    if (!existsSync(pfad)) return 'fehlt';
    const kb = Math.round(statSync(pfad).size / 1024);
    return kb > 20 ? true : 'nur ' + kb + ' kB';
  });
  const roh = readFileSync(pfad, 'latin1');
  const seiten = (roh.match(/\/Type\s*\/Page[^s]/g) || []).length;
  await check('das PDF hat 14 Seiten — eine je Tag', async () => (seiten === 14 ? true : seiten + ' Seiten'));
}

if (errors.length) { console.log('\n  ✗ Fehler:'); errors.slice(0, 5).forEach((e) => console.log('      ' + e)); bad += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');
await b.close(); server.close();
console.log(bad ? `\n${bad} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(bad ? 1 : 0);
