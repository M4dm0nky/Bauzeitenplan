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
await page.goto(BASE + '/index.html?plan=leer');
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
  // gerechnet und danach nie wieder. Geprüft wird, dass die Linie MIT der Zeit
  // wandert und zwar LINEAR. Die px/min-Skala hängt am Zoom (volle Tagesansicht:
  // ein Kalendertag füllt die Breite) und wird deshalb NICHT hart verdrahtet,
  // sondern aus zwei Teilschritten abgeleitet — 10 + 20 min ergeben zusammen die
  // 30 min von früher, die Folgeprüfungen sehen also denselben Zeitstand.
  const t0 = await lineX();
  await page.clock.fastForward('10:00');
  await page.waitForTimeout(300);
  const t1 = await lineX();
  await page.clock.fastForward('20:00');
  await page.waitForTimeout(300);
  const t2 = await lineX();
  const d10 = t1 - t0, d20 = t2 - t1;
  if (d10 <= 0.5) return `${d10.toFixed(1)}px in 10 min — die Linie steht still`;
  if (Math.abs(d20 - 2 * d10) > Math.max(1, 0.25 * 2 * d10))
    return `unproportional: 10 min → ${d10.toFixed(1)}px, 20 min → ${d20.toFixed(1)}px`;
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
console.log('\nVERSATZ — die Ansage vom Pult');
// Der ganze Zweck: der ABLAUF rutscht, die UHR bleibt stehen. Beides wird
// getrennt gemessen, denn nur zusammen ist die Aussage richtig — ein Bild, in
// dem Balken UND Linie wandern, sähe beim flüchtigen Hinsehen genauso aus.
const balkenX = () => page.evaluate(() => {
  const b = document.querySelector('.bz-bar[data-task]');
  return b ? { id: b.dataset.task, left: parseFloat(b.style.left) } : null;
});
const pxProMin = () => page.evaluate(() =>
  parseFloat(getComputedStyle(document.querySelector('.bz')).getPropertyValue('--px')));
const vzText = () => page.locator('#vz-txt').textContent();
// Über das Feld statt über 30 Klicks — die Knöpfe haben ihre eigene Prüfung.
const setVz = async (v) => {
  await page.fill('#vz-n', String(v));
  await page.press('#vz-n', 'Enter');
  await page.waitForTimeout(350);
};

await check('der Stepper steht bei Live im Bild und sagt «im Plan»', async () => {
  if (!(await page.locator('#vz').isVisible())) return 'kein Stepper sichtbar';
  const t = (await vzText()).trim();
  return t === 'im Plan' ? true : 'Text: ' + t;
});

let vorher = null, ppm = 0;
await check('+5 schiebt den Ablauf 5 Minuten nach rechts', async () => {
  vorher = await balkenX();
  ppm = await pxProMin();
  if (!vorher || !ppm) return 'kein Balken oder keine Skala gefunden';
  await setVz(5);
  const nach = await balkenX();
  if (nach.id !== vorher.id) return 'anderer Balken gemessen';
  const soll = 5 * ppm, ist = nach.left - vorher.left;
  return Math.abs(ist - soll) < 0.5 ? true
    : `${ist.toFixed(1)}px statt ${soll.toFixed(1)}px (${ppm.toFixed(2)} px/min)`;
});

await check('DIE UHR BLEIBT STEHEN — die Linie rührt sich keinen Pixel', async () => {
  // Das ist der Kern der Entscheidung: verschöbe sich die Linie mit, wäre der
  // Versatz eine Lupe auf den Plan statt einer Aussage über die Wirklichkeit.
  const jetzt = await lineX();
  await setVz(0);
  const ohne = await lineX();
  await setVz(30);
  const mit = await lineX();
  await setVz(5);
  if (Math.abs(ohne - mit) > 0.01) return `Linie wandert: ${ohne} → ${mit}`;
  return Math.abs(jetzt - ohne) < 0.01 ? true : `Linie unruhig: ${jetzt} → ${ohne}`;
});

await check('die Anzeige nennt Delay in Rot', async () => {
  const t = (await vzText()).trim();
  const k = await page.locator('#vz-txt').getAttribute('class');
  if (t !== '5 Min Delay') return 'Text: ' + t;
  return /is-late/.test(k) ? true : 'ohne Verzugs-Klasse: ' + k;
});
await page.screenshot({ path: join(here, 'shots', 'live-2-delay.png') });

await check('Pfeile wandern mit ihren Balken', async () => {
  // Sonst zeigen sie nach dem Versatz daneben ins Leere — der Fehler wäre im
  // Bauzeitenplan mit seinen wenigen Pfeilen leicht zu übersehen.
  const d = await page.evaluate(() => {
    const p = document.querySelector('path.bz-dep[data-dep]');
    if (!p) return { fehler: 'kein Pfeil im Plan' };
    const dep = p.getAttribute('d');
    const x1 = parseFloat(dep.slice(1).split(',')[0]);
    const von = document.querySelector('.bz-bar.is-link-from') || null;
    return { x1, von: !!von };
  });
  if (d.fehler) return d.fehler;
  await setVz(0);
  const ohne = await page.evaluate(() =>
    parseFloat(document.querySelector('path.bz-dep[data-dep]').getAttribute('d').slice(1).split(',')[0]));
  await setVz(5);
  const soll = ohne + 5 * ppm;
  return Math.abs(d.x1 - soll) < 0.5 ? true
    : `Pfeilanfang ${d.x1.toFixed(1)} statt ${soll.toFixed(1)}`;
});

await check('Vorlauf ist minus, grün und schiebt nach links', async () => {
  const bei0 = await (async () => { await setVz(0); return balkenX(); })();
  await setVz(-3);
  const nach = await balkenX();
  const t = (await vzText()).trim();
  const k = await page.locator('#vz-txt').getAttribute('class');
  const ist = nach.left - bei0.left, soll = -3 * ppm;
  if (Math.abs(ist - soll) > 0.5) return `${ist.toFixed(1)}px statt ${soll.toFixed(1)}px`;
  if (t !== '3 Min vor Plan') return 'Text: ' + t;
  return /is-early/.test(k) ? true : 'ohne Vorlauf-Klasse: ' + k;
});
await page.screenshot({ path: join(here, 'shots', 'live-3-vorlauf.png') });

await check('zurück auf 0 stellt den Ausgangszustand her', async () => {
  await setVz(0);
  const nach = await balkenX();
  const t = (await vzText()).trim();
  if (Math.abs(nach.left - vorher.left) > 0.01) return `Balken bei ${nach.left} statt ${vorher.left}`;
  return t === 'im Plan' ? true : 'Text: ' + t;
});

await check('die Knöpfe zählen in Minutenschritten', async () => {
  await page.locator('#vz-plus').click();
  await page.locator('#vz-plus').click();
  await page.waitForTimeout(250);
  const auf2 = await page.locator('#vz-n').inputValue();
  await page.locator('#vz-minus').click();
  await page.waitForTimeout(250);
  const auf1 = await page.locator('#vz-n').inputValue();
  return (auf2 === '2' && auf1 === '1') ? true : `+ + ergab ${auf2}, − danach ${auf1}`;
});

await check('ein Vertipper wird geklemmt statt übernommen', async () => {
  // 999 Minuten sind keine Ansage mehr; ein Ablauf 16 Stunden neben der Achse
  // wäre kein Ablaufplan.
  await setVz(999);
  const v = await page.locator('#vz-n').inputValue();
  return v === '180' ? true : 'ergab ' + v;
});

await check('der Versatz überlebt das Neuladen', async () => {
  await setVz(7);
  await page.reload();
  await page.waitForTimeout(1000);
  const v = await page.locator('#vz-n').inputValue();
  const t = (await vzText()).trim();
  return (v === '7' && t === '7 Min Delay') ? true : `nach Reload: ${v} / ${t}`;
});

await check('ein Versatz von GESTERN gilt heute nicht mehr', async () => {
  // Sonst stünde der Plan am nächsten Morgen kommentarlos daneben, und niemand
  // wüsste, warum. Der Live-Knopf selbst überlebt bewusst — der Versatz nicht.
  await page.evaluate(() => localStorage.setItem('bzp_versatz',
    JSON.stringify({ min: 42, tag: '2020-01-01' })));
  await page.reload();
  await page.waitForTimeout(1000);
  const v = await page.locator('#vz-n').inputValue();
  const b = await page.evaluate(() => {
    const n = document.querySelector('.bz-bar[data-task]');
    return n ? parseFloat(n.style.left) : null;
  });
  if (v !== '0') return 'Feld zeigt ' + v;
  return Math.abs(b - vorher.left) < 0.01 ? true : `Balken steht bei ${b} statt ${vorher.left}`;
});

await check('Live ausschalten räumt die Marken weg', async () => {
  await page.locator('#live').click();
  await page.waitForTimeout(400);
  const n = await page.locator('.bz-bar.is-running, .bz-bar.is-late').count();
  const vis = await page.locator('#live-bar').isVisible();
  if (vis) return 'Leiste bleibt sichtbar';
  // Der Stepper gehört zur laufenden Uhr: ohne sie sagt ein Versatz nichts.
  if (await page.locator('#vz').isVisible()) return 'der Versatz-Stepper bleibt stehen';
  if (await page.locator('#vz-txt').isVisible()) return 'die Versatz-Anzeige bleibt stehen';
  return n === 0 ? true : `${n} Marken bleiben stehen`;
});

console.log('\nDIE LINIE ZEIGT DIE PROJEKT-ZEITZONE, NICHT DIE DES BETRACHTERS');
// nowInZone() rechnet «jetzt» in die Projekt-Zeitzone um. Scheitert das Parsen,
// fällt es stumm auf die LOKALE Zeit zurück — und niemand sieht es, weil das
// Projekt seine Zone standardmäßig vom Browser erbt, beide also ohnehin gleich
// sind. Deshalb hier zwei Betrachter in verschiedenen Zonen auf DASSELBE Projekt
// (Europe/Berlin): steht die Linie an zwei verschiedenen Stellen, greift der
// Rückfall.
//
// Der Zeitpunkt ist mit Bedacht Mitternacht in Berlin: «00:00» ist genau die
// Eingabe, an der hour12:false in manchen Engines «24:00» erzeugt — daraus macht
// new Date() ein Invalid Date. Ein geschütztes Leerzeichen aus Intl endet ebenso.
const BERLIN_MITTERNACHT = new Date('2026-08-05T22:00:00Z');   // = 06.08. 00:00 in Berlin
async function linieBeiBetrachterZone(tz) {
  const c = await browser.newContext({ viewport: { width: 1600, height: 950 }, timezoneId: tz });
  const p = await c.newPage();
  await p.clock.install({ time: BERLIN_MITTERNACHT });
  await p.goto(BASE + '/index.html?plan=leer');
  await p.waitForTimeout(600);
  await p.fill('.dlg-f:first-child input', 'Zonen-Test');
  await p.fill('.dlg-f:nth-child(3) input', '2026-08-05T06:00');
  await p.locator('.dlg-t[data-k="festival"]').click();
  await p.locator('.dlg-act .btn-p').click();
  await p.waitForTimeout(800);
  // Das Projekt erbt die Zone des Browsers — genau deshalb fällt der Fehler nie
  // auf. Hier wird sie fest auf Berlin gesetzt, damit die beiden Betrachter
  // wirklich dasselbe Projekt sehen.
  await p.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      try {
        const v = JSON.parse(localStorage.getItem(k));
        if (v && v.project && v.project.timezone) {
          v.project.timezone = 'Europe/Berlin';
          localStorage.setItem(k, JSON.stringify(v));
        }
      } catch { /* kein Plan unter diesem Schlüssel */ }
    }
  });
  await p.reload();
  await p.waitForTimeout(1000);
  const x = await p.locator('.bz-now').evaluate((n) => parseFloat(n.style.left));
  const zone = await p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await c.close();
  return { x, zone };
}
const inBerlin = await linieBeiBetrachterZone('Europe/Berlin');
const inNewYork = await linieBeiBetrachterZone('America/New_York');
await check('der Betrachter sitzt tatsächlich in zwei verschiedenen Zonen', async () =>
  inBerlin.zone !== inNewYork.zone ? true : `beide melden ${inBerlin.zone}`);
await check('beide Betrachter sehen die Linie an derselben Stelle', async () => {
  if (!Number.isFinite(inBerlin.x) || !Number.isFinite(inNewYork.x))
    return `keine Linie: Berlin ${inBerlin.x}, New York ${inNewYork.x}`;
  const d = Math.abs(inBerlin.x - inNewYork.x);
  return d <= 1 ? true
    : `${d.toFixed(1)}px auseinander (${inBerlin.x} vs ${inNewYork.x}) — nowInZone ist auf die lokale Zeit zurückgefallen`;
});

if (errors.length) { console.log('\n  ✗ Fehler auf der Seite:'); errors.slice(0, 6).forEach((e) => console.log('      ' + e)); problems += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');

await browser.close();
server.close();
console.log(problems ? `\n${problems} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(problems ? 1 : 0);
