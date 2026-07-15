// ── Live-Modus mit gestellter Uhr ─────────────────────────────────────────────
// page.clock friert die Zeit ein und spult vor. Damit lässt sich prüfen, dass
// die Linie nach 30 Minuten 30 Minuten weiter steht — ohne 30 Minuten zu warten
// und ohne Test-Code in der App.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });
const cache = join(process.env.HOME, 'Library/Caches/ms-playwright');
const exe = join(cache, readdirSync(cache).find((d) => d.startsWith('firefox-')), 'firefox/Nightly.app/Contents/MacOS/firefox');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer((q, s) => {
  const rel = normalize(decodeURIComponent(q.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = join(root, rel === '/' ? 'index.html' : rel);
  if (!f.startsWith(root) || !existsSync(f)) { s.writeHead(404); return s.end('x'); }
  s.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  s.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const browser = await firefox.launch({ executablePath: exe });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('JS: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let problems = 0;
const check = async (name, fn) => {
  let r;
  try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
  if (r === true) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name + ': ' + r); problems++; }
};

// Uhr auf einen Zeitpunkt MITTEN im Aufbau stellen — dort ist etwas los.
const AUFBAU = new Date('2026-08-05T09:00:00');
await page.clock.install({ time: AUFBAU });
await page.goto(BASE + '/index.html');
await page.waitForTimeout(600);

// Projekt anlegen: Aufbaubeginn = heute (die gestellte Uhr) minus nichts
await page.fill('.dlg-f:first-child input', 'Live-Test');
await page.fill('.dlg-f:nth-child(3) input', '2026-08-05T06:00');
await page.locator('.dlg-t[data-k="festival"]').click();
await page.locator('.dlg-act .btn-p').click();
await page.waitForTimeout(800);

const lineX = () => page.locator('.bz-now').evaluate((n) => parseFloat(n.style.left));

console.log('\nDIE LINIE TICKT — auch OHNE Live-Modus');
await check('Linie steht beim Laden auf der gestellten Zeit', async () => {
  const x = await lineX();
  return x > 0 ? true : 'x = ' + x;
});
await check('nach 30 Minuten steht die Linie 30 Minuten weiter', async () => {
  // DAS ist der Fehler, den du gefunden hast: NOW wurde einmal beim Laden
  // gerechnet und danach nie wieder.
  const vorher = await lineX();
  await page.clock.fastForward('30:00');
  await page.waitForTimeout(400);
  const nachher = await lineX();
  const gewandert = nachher - vorher;
  // Tage-Zoom: 0.25 px/min → 30 min = 7.5 px
  const erwartet = 30 * 0.25;
  if (Math.abs(gewandert - erwartet) > 1) return `${gewandert.toFixed(1)}px statt ${erwartet}px — die Linie steht still`;
  return true;
});
await check('Minimap-Marke wandert mit', async () => {
  const vorher = await page.locator('.bz-mini-now').evaluate((n) => parseFloat(n.style.left));
  await page.clock.fastForward('02:00:00');
  await page.waitForTimeout(400);
  const nachher = await page.locator('.bz-mini-now').evaluate((n) => parseFloat(n.style.left));
  return nachher > vorher ? true : `${vorher}% → ${nachher}%`;
});

console.log('\nLIVE-MODUS');
await check('Live einschalten aktiviert die Anzeige', async () => {
  await page.locator('#live').click();
  await page.waitForTimeout(500);
  const p = await page.locator('#live').getAttribute('aria-pressed');
  return p === 'true' ? true : 'aria-pressed=' + p;
});
await check('Live-Leiste erscheint', async () =>
  (await page.locator('#live-bar').isVisible()) ? true : 'keine Leiste');
await check('Live-Leiste nennt laufende Vorgänge', async () => {
  const t = await page.locator('#live-bar').textContent();
  return /laufen|läuft/.test(t) ? true : 'Text: ' + t;
});
await check('laufende Balken sind hervorgehoben', async () => {
  const n = await page.locator('.bz-bar.is-running').count();
  return n > 0 ? true : 'kein Balken als laufend markiert';
});
await check('Verzug wird angezeigt', async () => {
  // Zeitpunkt bewusst wählen: am Aufbautag steht in der Vorlage alles auf
  // «fertig» — da GIBT es keinen Verzug, und das ist richtig so. Erst am
  // dritten Tag hängen «Fokus & Programmierung» (geplant, Start 18:00) und
  // «Scheinwerfer hängen» (läuft, Ende 16:00).
  await page.clock.fastForward('56:00:00');   // → 07.08. 19:30
  await page.waitForTimeout(500);
  const n = await page.locator('.bz-bar.is-late').count();
  const t = await page.locator('#live-bar').textContent();
  if (n === 0) return 'kein Balken als überfällig markiert · Leiste: ' + t;
  if (!/Verzug/.test(t)) return 'Leiste nennt den Verzug nicht: ' + t;
  return true;
});
await check('Verzug steht auch in der Gewerk-Spalte', async () =>
  (await page.locator('.bz-lab.is-late').count()) > 0 ? true : 'keine Markierung links');
await check('fertige Vorgänge gelten nie als überfällig', async () => {
  // Der Status ist eine Aussage von Menschen und schlägt die Uhr.
  const bad = await page.evaluate(() => {
    const late = [...document.querySelectorAll('.bz-bar.is-late')];
    return late.filter((n) => n.classList.contains('bz-st-fertig')).length;
  });
  return bad === 0 ? true : bad + ' fertige Vorgänge sind als überfällig markiert';
});
await page.screenshot({ path: join(here, 'shots', 'live-1.png') });

await check('die Ansicht folgt der Zeit', async () => {
  const vorher = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  await page.clock.fastForward('06:00:00');
  await page.waitForTimeout(600);
  const nachher = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  return nachher > vorher ? true : `scrollLeft ${vorher} → ${nachher} — folgt nicht`;
});
await check('Live-Zustand überlebt das Neuladen', async () => {
  await page.reload();
  await page.waitForTimeout(1000);
  const p = await page.locator('#live').getAttribute('aria-pressed');
  return p === 'true' ? true : 'nach Reload aus';
});
await check('Live ausschalten räumt die Marken weg', async () => {
  await page.locator('#live').click();
  await page.waitForTimeout(400);
  const n = await page.locator('.bz-bar.is-running, .bz-bar.is-late').count();
  const vis = await page.locator('#live-bar').isVisible();
  if (vis) return 'Leiste bleibt sichtbar';
  return n === 0 ? true : `${n} Marken bleiben stehen`;
});

if (errors.length) { console.log('\n  ✗ Fehler auf der Seite:'); errors.slice(0, 6).forEach((e) => console.log('      ' + e)); problems += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');

await browser.close();
server.close();
console.log(problems ? `\n${problems} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(problems ? 1 : 0);
