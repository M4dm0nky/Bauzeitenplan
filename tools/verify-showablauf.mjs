// ── Showablauf: Bühnen, Programmpunkte, Live-Kopfzeile, Running-Order-Blatt ───
// Die zweite Ebene desselben Plans (js/ebene.js). Geprüft wird das, was die
// Zahlenprüfungen in tests/ nicht sehen können: dass der Bauzeitenplan nach dem
// Umschalten UNVERÄNDERT aussieht, dass das Wegklicken einer Bühne den Maßstab
// bewegt und nicht nur Zeilen versteckt, und dass die Live-Kopfzeile bei
// gestellter Uhr den richtigen Act ansagt.
//
// Die Uhr wird gestellt (page.clock), nicht abgewartet: ein Test, der auf den
// 29.08.2026 wartet, ist kein Test.
import { firefox, chromium } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
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
p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let bad = 0;
const check = async (name, fn) => {
  let r; try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
  if (r === true) console.log('  ✓ ' + name); else { console.log('  ✗ ' + name + ': ' + r); bad++; }
};

// Mitten in der Show am Samstag: 15:30 läuft CURSE (15:20–15:55), danach kommt
// ein Changeover. Genau dieser Zeitpunkt macht die Kopfzeile prüfbar.
await p.clock.install({ time: new Date('2026-08-29T15:30:00') });

// ── Ebene ───────────────────────────────────────────────────────────────────
console.log('\nEBENE UMSCHALTEN');
await p.goto(BASE + '/index.html?plan=klassentreffen');
await p.waitForSelector('.bz-lab', { timeout: 20000 });
await p.waitForTimeout(700);

const gruppen = () => p.locator('.bz-lab-group').count();
const kpi = (name) => p.locator('.kpi', { hasText: name }).locator('.kpi-v').textContent();

await check('der Bauzeitenplan zeigt 20 Gewerke, keine Bühne', async () => {
  const n = await gruppen();
  const namen = await p.locator('.bz-lab-group .bz-lab-name').allTextContents();
  if (namen.includes('Hauptbühne')) return 'die Bühne steht im Bauzeitenplan';
  return n === 20 ? true : n + ' Gewerkzeilen statt 20';
});
await check('die Bühnen-Häkchen sind im Bauzeitenplan nicht im Weg', async () =>
  (await p.locator('#buehnen').isHidden()) ? true : 'Leiste sichtbar');
await check('der Bauzeitenplan bündelt weiter und trägt KEINE Uhrzeit in der Spalte', async () => {
  // Dort steht eine Zeile für mehrere Termine — eine einzelne Uhrzeit stünde
  // stellvertretend für alle und wäre schlicht falsch.
  const zeiten = await p.locator('.bz-lab-zeit').count();
  if (zeiten) return zeiten + ' Uhrzeiten im Bauzeitenplan';
  // «Aufbau Bühne» läuft an drei Tagen und muss EINE Zeile mit drei Balken sein.
  const n = await p.locator('.bz-lab-task').filter({ hasText: 'Aufbau Bühne' }).count();
  return n === 1 ? true : n + ' Zeilen für «Aufbau Bühne» — die Bündelung ist mit weggefallen';
});

await p.locator('[data-ansicht="show"]').click();
await p.waitForTimeout(700);

await check('der Showablauf zeigt genau die Bühne', async () => {
  const namen = await p.locator('.bz-lab-group .bz-lab-name').allTextContents();
  return namen.join('|') === 'Hauptbühne' ? true : namen.join('|');
});
await check('die Kopfzeile zählt Bühnen und Zeiteinträge DES TAGES', async () => {
  // 17 am Samstag, nicht 32: der Showablauf ist tagesbezogen.
  const bu = (await kpi('Bühnen')).trim();
  const pr = (await kpi('Zeiteinträge')).trim();
  return bu === '1' && pr === '17' ? true : bu + ' Bühnen / ' + pr + ' Zeiteinträge';
});
await check('keine Zeile ohne Balken — die Acts des anderen Tages sind weg', async () => {
  const namen = await p.locator('.bz-lab-task .bz-lab-name').allTextContents();
  if (namen.some((x) => /MAX HERRE|CHEFKET|MEGALOH/.test(x))) return 'Sonntag steht am Samstag im Bild';
  const leer = await p.locator('.bz-track-task').evaluateAll((ts) =>
    ts.filter((t) => t.querySelectorAll('.bz-bar, .bz-ms').length === 0).length);
  return leer === 0 ? true : leer + ' Zeilen ohne einen einzigen Balken';
});
await check('der Tages-Umschalter bringt den Sonntag', async () => {
  const knoepfe = p.locator('#buehnen .seg-tag button');
  if (await knoepfe.count() !== 2) return (await knoepfe.count()) + ' Tage statt 2';
  await knoepfe.nth(1).click();
  await p.waitForTimeout(600);
  const pr = (await kpi('Zeiteinträge')).trim();
  const namen = await p.locator('.bz-lab-task .bz-lab-name').allTextContents();
  if (pr !== '15') return pr + ' Zeiteinträge am Sonntag statt 15';
  if (!namen.some((x) => x.trim() === 'MAX HERRE & JOY DENALANE')) return 'MAX HERRE fehlt';
  if (namen.length !== 15) return namen.length + ' Zeilen am Sonntag statt 15';
  await knoepfe.nth(0).click();          // zurück auf Samstag für die Folgeprüfungen
  await p.waitForTimeout(600);
  return true;
});
await check('die Zeitachse steht auf den Showtagen, nicht auf zwei Projektwochen', async () => {
  // Der Bauzeitenplan läuft 21.08.–03.09. Zöge der Showablauf seine Achse
  // daraus, wären zwei Showtage in vierzehn — jeder Act ein Strich.
  const ticks = await p.locator('.bz-axis-major .bz-t-major').allTextContents();
  const text = ticks.join(' ');
  return /29|30/.test(text) && !/21\.|22\.|01\.09/.test(text) ? true : 'Achse: ' + text.slice(0, 90);
});
await check('die Namensspalte IST der Ablaufplan — Zeile für Zeile wie im PDF', async () => {
  // Die wertvollste Prüfung dieser Datei. Gebündelt (seriesRows) stand hier eine
  // Zeile «Changeover» mit sechs Balken zwischen den Acts, und die Zeilenfolge
  // richtete sich nach dem frühesten Termin jeder Serie statt nach dem Abend.
  // Gelesen wird, was in der Seitenspalte steht — nicht, was der Store meint.
  const zeilen = await p.locator('.bz-lab-task').evaluateAll((ns) => ns.map((n) => [
    n.querySelector('.bz-lab-zeit')?.textContent.trim() || '',
    n.querySelector('.bz-lab-dauer')?.textContent.trim() || '',
    n.querySelector('.bz-lab-name')?.textContent.trim() || '',
  ].join(' ')));
  const soll = [
    '12:00 Uhr (120 min) DOORS', '14:00 Uhr (30 min) CREUTZFELD & JAKOB',
    '14:30 Uhr (10 min) Changeover', '14:40 Uhr (30 min) OLLI BANJO',
    '15:10 Uhr (10 min) Changeover', '15:20 Uhr (35 min) CURSE',
    '15:55 Uhr (10 min) Changeover', '16:05 Uhr (40 min) STIEBER TWINS & CORA E',
    '16:45 Uhr (10 min) Changeover', '16:55 Uhr (40 min) TORCH FEAT. TONI L',
    '17:35 Uhr (15 min) Changeover + FLYING STEPS', '17:50 Uhr (40 min) EKO FRESH',
    '18:30 Uhr (30 min) Changeover', '19:00 Uhr (60 min) KOOL SAVAS',
    '20:00 Uhr (40 min) Changeover', '20:40 Uhr (70 min) SIDO',
    '21:50 Uhr — SHOW END',
  ];
  if (zeilen.length !== soll.length) return zeilen.length + ' Zeilen statt ' + soll.length;
  for (let i = 0; i < soll.length; i++) {
    if (zeilen[i] !== soll[i]) return 'Zeile ' + (i + 1) + ': «' + zeilen[i] + '» statt «' + soll[i] + '»';
  }
  return true;
});
await check('die Achse beschriftet JEDE Stunde', async () => {
  // Ein Ablauf wird nach Uhrzeiten gelesen; «zwischen 12 und 15» hilft nicht.
  const ticks = (await p.locator('.bz-axis-minor .bz-t-n').allTextContents()).map((x) => x.trim());
  const zahlen = ticks.map(Number).filter((n) => !Number.isNaN(n));
  if (zahlen.length < 8) return 'nur ' + zahlen.length + ' Stundenmarken: ' + ticks.join(' ');
  const lueckig = zahlen.slice(1).some((n, i) => (n - zahlen[i] + 24) % 24 !== 1);
  return lueckig ? 'Marken springen: ' + zahlen.join(' ') : true;
});
await check('Zeit, Dauer und Name stehen auf EINER Zeile', async () => {
  // «12:00 Uhr» in einer zu schmalen Spalte brach um und schob das «Uhr» unter
  // die Zahl. Die Namensprüfung sah das nicht — sie misst nur die linke Kante.
  const kaputt = await p.locator('.bz-lab-task').evaluateAll((ns) => ns
    .map((n) => {
      const t = (s) => Math.round(n.querySelector(s).getBoundingClientRect().top);
      return [n.querySelector('.bz-lab-name').textContent.trim(),
        t('.bz-lab-zeit'), t('.bz-lab-dauer'), t('.bz-lab-name')];
    })
    .filter(([, a, b, c]) => Math.abs(a - b) > 1 || Math.abs(a - c) > 1)
    .map(([name]) => name));
  return kaputt.length ? 'umgebrochen bei: ' + kaputt.slice(0, 3).join(' · ') : true;
});
await check('die Uhrzeiten stehen tabellarisch untereinander', async () => {
  // Ohne feste Breite und tabular-nums beginnen die Namen auf fünf Höhen.
  const x = await p.locator('.bz-lab-task .bz-lab-name')
    .evaluateAll((ns) => [...new Set(ns.map((n) => Math.round(n.getBoundingClientRect().left)))]);
  return x.length === 1 ? true : 'Namen beginnen an ' + x.length + ' verschiedenen Stellen: ' + x.join(', ');
});
await check('kein Actname wird abgeschnitten', async () => {
  const kurz = await p.locator('.bz-lab-task .bz-lab-name')
    .evaluateAll((ns) => ns.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent.trim()));
  return kurz.length ? 'abgeschnitten: ' + kurz.join(' · ') : true;
});
await check('keine Zieltermin-Zeile im Showablauf', async () =>
  (await p.locator('.bz-lab-projekt').count()) === 0 ? true : 'Zieltermine sind mitgekommen');

await p.screenshot({ path: join(here, 'shots', 'showablauf-gantt.png') });

// ── Farbe ───────────────────────────────────────────────────────────────────
console.log('\nFARBE UND SCHRAFFUR');

const balken = (titel) => p.locator('.bz-bar').filter({ hasText: titel }).first();
const gwVon = (loc) => loc.evaluate((n) => n.style.getPropertyValue('--gw').trim());

await check('die Balken sind GEFÜLLT, nicht nur umrandet', async () => {
  // «geplant» wird sonst transparent mit farbigem Innenrand dargestellt — im
  // Showablauf pflegt den Status niemand, also sähe der ganze Abend leer aus.
  const bg = await balken('CURSE').evaluate((n) => getComputedStyle(n).backgroundColor);
  if (/transparent|rgba\(0, 0, 0, 0\)/.test(bg)) return 'transparent: ' + bg;
  return true;
});

await check('im Bauzeitenplan bleiben sie umrandet', async () => {
  await p.locator('[data-ansicht="bau"]').click();
  await p.waitForTimeout(700);
  const bg = await p.locator('.bz-bar.bz-st-geplant').first()
    .evaluate((n) => getComputedStyle(n).backgroundColor);
  const leer = /transparent|rgba\(0, 0, 0, 0\)/.test(bg);
  await p.locator('[data-ansicht="show"]').click();
  await p.waitForTimeout(700);
  return leer ? true : 'auch dort gefüllt: ' + bg;
});

await check('ohne eigene Farbe tragen alle Punkte die der Bühne', async () => {
  const alle = await p.locator('.bz-bar').evaluateAll((ns) =>
    [...new Set(ns.map((n) => n.style.getPropertyValue('--gw').trim()))]);
  return alle.length === 1 ? true : alle.length + ' Farben, erwartet 1: ' + alle.join(' ');
});

await check('ein Ton im Panel färbt genau diesen Balken um', async () => {
  await balken('CURSE').click();
  await p.waitForTimeout(500);
  if (await p.locator('#ins .ins-farbe').isHidden()) return 'keine Farbwahl im Panel';
  const vorher = await gwVon(balken('CURSE'));
  const nachbar = await gwVon(balken('OLLI BANJO'));
  // Ton 4 — irgendeiner, der nicht der geerbte ist.
  await p.locator('#ins .ins-ton').nth(3).click();
  await p.waitForTimeout(600);
  const nachher = await gwVon(balken('CURSE'));
  if (nachher === vorher) return 'die Farbe hat sich nicht geändert (' + nachher + ')';
  if ((await gwVon(balken('OLLI BANJO'))) !== nachbar) return 'der Nachbar hat sich mitgefärbt';
  return true;
});

await check('der gewählte Ton ist im Panel markiert', async () => {
  const an = await p.locator('#ins .ins-ton.is-on').count();
  if (an !== 1) return an + ' markierte Töne';
  const i = await p.locator('#ins .ins-ton').evaluateAll((ns) => ns.findIndex((n) => n.classList.contains('is-on')));
  return i === 3 ? true : 'markiert ist Ton ' + (i + 1) + ', geklickt war 4';
});

await check('Schraffur macht aus dem Ton denselben Ton mit Muster', async () => {
  const farbe = await gwVon(balken('CURSE'));
  await p.locator('#ins .ins-tex input').check();
  await p.waitForTimeout(600);
  if ((await gwVon(balken('CURSE'))) !== farbe) return 'der Farbton hat sich mitgeändert';
  const tex = await balken('CURSE').getAttribute('data-tex');
  return tex === '1' ? true : 'keine Schraffur am Balken';
});

await check('die Farbe überlebt das Neuladen', async () => {
  const vorher = await gwVon(balken('CURSE'));
  await p.waitForTimeout(1200);          // Auto-Save wartet 800 ms
  await p.reload();
  await p.waitForSelector('.bz-lab', { timeout: 20000 });
  await p.waitForTimeout(900);
  const nachher = await gwVon(balken('CURSE'));
  if (nachher !== vorher) return 'nach dem Neuladen ' + nachher + ' statt ' + vorher;
  return (await balken('CURSE').getAttribute('data-tex')) === '1' ? true : 'Schraffur ist weg';
});

await check('die Beschriftung bleibt auf JEDEM der zehn Töne lesbar', async () => {
  // Der Punkt, der bei gefüllten Balken wirklich zählt. Drei Töne (Rigging,
  // Licht, Ton) liegen auf hellem Grund unter 3:1 — auf ihnen steht weiße
  // Schrift mit Schatten, genau wie bei «läuft» im Bauzeitenplan. Geprüft wird
  // an DOORS, weil dieser Balken breit genug ist, dass der Text IM Balken steht.
  await balken('DOORS').click();
  await p.waitForTimeout(400);
  const schlecht = [];
  for (let i = 0; i < 10; i++) {
    await p.locator('#ins .ins-ton').nth(i).click();
    await p.waitForTimeout(250);
    const v = await balken('DOORS').evaluate((n) => {
      const t = n.querySelector('.bz-bar-t');
      if (!t || getComputedStyle(t).position === 'absolute') return null;  // steht daneben
      const lum = (c) => {
        const [r, g, b] = (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number)
          .map((x) => { const u = x / 255; return u <= 0.03928 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const a = lum(getComputedStyle(t).color), b = lum(getComputedStyle(n).backgroundColor);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    if (v !== null && v < 3) schlecht.push('Ton ' + (i + 1) + ': ' + v.toFixed(2) + ':1');
  }
  if (schlecht.length) return schlecht.join(' · ');
  // Zum Schluss einen hellen Ton stehen lassen — das Bild soll den harten Fall zeigen.
  await p.locator('#ins .ins-ton').nth(2).click();
  await p.waitForTimeout(400);
  return true;
});

await p.screenshot({ path: join(here, 'shots', 'showablauf-farbe.png') });

await check('«wie Bühne» nimmt die eigene Farbe zurück', async () => {
  const geerbt = await gwVon(balken('OLLI BANJO'));   // hat nie eine eigene bekommen
  await balken('CURSE').click();
  await p.waitForTimeout(500);
  await p.locator('#ins .ins-farbe-x').click();
  await p.waitForTimeout(600);
  if ((await gwVon(balken('CURSE'))) !== geerbt) return 'CURSE trägt weiter eine eigene Farbe';
  return (await balken('CURSE').getAttribute('data-tex')) === null ? true : 'Schraffur blieb hängen';
});

await check('im Bauzeitenplan gibt es keine Farbwahl', async () => {
  // Dort ist die Zuordnung gerechnet (docs/farbsuche.md) und bleibt es.
  await p.locator('[data-ansicht="bau"]').click();
  await p.waitForTimeout(600);
  await p.locator('.bz-bar').first().click();
  await p.waitForTimeout(500);
  const da = await p.locator('#ins .ins-farbe').count();
  await p.locator('[data-ansicht="show"]').click();
  await p.waitForTimeout(700);
  return da === 0 ? true : 'die Farbwahl steht auch im Bauzeitenplan';
});

// ── Bühnen-Filter ───────────────────────────────────────────────────────────
console.log('\nBÜHNEN-FILTER');
await check('die Häkchenleiste zeigt jede Bühne', async () => {
  if (await p.locator('#buehnen').isHidden()) return 'Leiste versteckt';
  const n = await p.locator('#buehnen .buehne-i').count();
  return n === 1 ? true : n + ' Häkchen statt 1';
});
await check('die einzige Bühne wegklicken leert die Ansicht — und füllt sie wieder', async () => {
  const cb = p.locator('#buehnen .buehne-i input').first();
  await cb.uncheck();
  await p.waitForTimeout(400);
  const leer = await gruppen();
  await cb.check();
  await p.waitForTimeout(400);
  const wieder = await gruppen();
  if (leer !== 0) return leer + ' Zeilen trotz abgewählter Bühne';
  return wieder === 1 ? true : 'nach dem Wiedereinschalten ' + wieder + ' Zeilen';
});

// ── Tabelle ─────────────────────────────────────────────────────────────────
console.log('\nTABELLE — Anforderungen und Material');
await p.locator('[data-view="tabelle"]').click();
await p.waitForTimeout(600);

await check('die Showablauf-Spalten stehen da', async () => {
  const th = await p.locator('.tb-t th').allTextContents();
  const soll = ['Bühne', 'Zeiteintrag', 'Abschnitt', 'Typ', 'Start', 'Dauer', 'Ende', 'Kontakt', 'Anforderungen', 'Benötigtes Material'];
  const fehlt = soll.filter((x) => !th.some((y) => y.trim() === x || (x === 'Benötigtes Material' && y.trim() === 'Material')));
  return fehlt.length ? 'fehlt: ' + fehlt.join(', ') : true;
});
await check('die Tabelle scrollt in sich, die Seite nicht', async () => {
  const seite = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  return seite ? 'die Seite läuft seitlich über' : true;
});

// Über die id, nicht über [value="…"]: `input.value` ist eine EIGENSCHAFT, kein
// Attribut — der Attributselektor findet nie etwas und läuft stumm in den Timeout.
const idVon = (titel) => p.evaluate((t) => {
  const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
  return (raw.tasks || []).find((x) => x.title === t)?.id;
}, titel);
const zeileVon = async (titel) => p.locator('tr[data-id="' + await idVon(titel) + '"]');

await check('eine Anforderung tippen kommt an — und ⌘Z nimmt sie zurück', async () => {
  const r = await zeileVon('CURSE');
  const feld = r.locator('.c-anf input');
  await feld.fill('2× Wedge, Barrierengasse');
  await feld.press('Tab');
  await p.waitForTimeout(1400);        // Auto-Save wartet 800 ms
  const drin = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    return (raw.tasks || []).find((t) => t.title === 'CURSE')?.anforderungen;
  });
  if (drin !== '2× Wedge, Barrierengasse') return 'gespeichert: ' + JSON.stringify(drin);
  await p.keyboard.press('Meta+z');
  await p.waitForTimeout(500);
  const zurueck = await (await zeileVon('CURSE')).locator('.c-anf input').inputValue();
  return zurueck === '' ? true : 'nach ⌘Z steht noch «' + zurueck + '» im Feld';
});

await check('Material und Kontakt gehen denselben Weg', async () => {
  const r = await zeileVon('SIDO');
  await r.locator('.c-mat input').fill('1 Riser 2×1 m');
  await r.locator('.c-mat input').press('Tab');
  await r.locator('.c-kon input').fill('Tourmanager Ruth');
  await r.locator('.c-kon input').press('Tab');
  await p.waitForTimeout(1400);        // Auto-Save wartet 800 ms
  const t = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    return (raw.tasks || []).find((x) => x.title === 'SIDO');
  });
  return t.material === '1 Riser 2×1 m' && t.kontakt === 'Tourmanager Ruth'
    ? true : JSON.stringify({ m: t.material, k: t.kontakt });
});

await check('der Typ ist ein Auswahlfeld und steht auf changeover', async () => {
  const v = await (await zeileVon('Changeover')).locator('.c-typ select').inputValue();
  return v === 'changeover' ? true : v;
});

// Von vorn: das Tippen in die hinteren Spalten hat die Tabelle nach rechts
// gescrollt, und die Bühnenspalte lag außerhalb des Bildes.
await p.locator('.tb').evaluate((n) => { n.scrollLeft = 0; });
await p.waitForTimeout(300);
await p.screenshot({ path: join(here, 'shots', 'showablauf-tabelle.png') });

await check('der Bauzeitenplan hat KEINE der neuen Spalten', async () => {
  await p.locator('[data-ansicht="bau"]').click();
  await p.waitForTimeout(500);
  const th = (await p.locator('.tb-t th').allTextContents()).map((x) => x.trim());
  const zuviel = ['Typ', 'Abschnitt', 'Kontakt', 'Anforderungen', 'Material'].filter((x) => th.includes(x));
  if (zuviel.length) return 'im Bauzeitenplan sichtbar: ' + zuviel.join(', ');
  return th.includes('Crew') ? true : 'die Crew-Spalte ist verschwunden: ' + th.join('|');
});

// ── Live-Kopfzeile ──────────────────────────────────────────────────────────
console.log('\nLIVE-KOPFZEILE (Uhr auf Sa 29.08.2026, 15:30)');
await p.locator('[data-ansicht="show"]').click();
await p.locator('[data-view="gantt"]').click();
await p.waitForTimeout(400);
await p.locator('#live').click();
await p.waitForTimeout(800);

const shText = async (cls) => (await p.locator('#showhead .' + cls + ' .sh-v').textContent()).trim();

await check('die Kopfzeile ist da', async () =>
  (await p.locator('#showhead').isVisible()) ? true : 'versteckt');
await check('JETZT sagt CURSE an', async () => {
  const v = await shText('sh-now');
  return v === 'CURSE' ? true : '«' + v + '»';
});
await check('ALS NÄCHSTES sagt den Umbau an, nicht «Act»', async () => {
  const v = await shText('sh-next');
  return v === 'Changeover: Changeover' || /Changeover/.test(v) ? true : '«' + v + '»';
});
await check('die Uhr zeigt die gestellte Zeit', async () => {
  // Die gestellte Uhr läuft mit der echten Zeit weiter — geprüft wird die
  // Viertelstunde, nicht die Minute, sonst hängt der Test an der Laufzeit.
  const v = await shText('sh-clock');
  return /^15:3\d$/.test(v) ? true : v;
});
await check('die laufende Zeile ist hervorgehoben', async () =>
  (await p.locator('.bz-bar.is-run, .bz-row.is-run, .is-running').count()) > 0
    ? true : 'nichts markiert');
// ── Versatz im Showablauf ───────────────────────────────────────────────────
// Hier zahlt er sich aus: die Seitenspalte IST der Ablaufplan, und wenn dort
// «20:00 Uhr» steht, während der Balken auf 20:05 liegt, widerspricht sich das
// Blatt selbst. Genau das sieht keine Zahlenprüfung — nur diese hier.
const spaltenZeit = () => p.locator('.bz-lab-zeit').first().textContent();
const setVzShow = async (v) => {
  await p.fill('#vz-n', String(v));
  await p.press('#vz-n', 'Enter');
  await p.waitForTimeout(400);
};

await check('die Uhrzeit in der Seitenspalte wandert mit dem Balken', async () => {
  const vorher = (await spaltenZeit()).trim();
  await setVzShow(5);
  const nachher = (await spaltenZeit()).trim();
  const zuMin = (s) => {
    const m = /^(\d\d):(\d\d)/.exec(s);
    return m ? +m[1] * 60 + +m[2] : null;
  };
  const a = zuMin(vorher), b = zuMin(nachher);
  if (a == null || b == null) return `unlesbar: «${vorher}» → «${nachher}»`;
  return b - a === 5 ? true : `${vorher} → ${nachher} (${b - a} statt 5 Minuten)`;
});

await check('die Kopfzeile nennt ebenfalls die verschobene Uhrzeit', async () => {
  // «bis 20:45» und «· 20:00» sind absolute Zeiten und müssen mitwandern —
  // «in 12 Min» dagegen nicht, das ist eine Differenz und bleibt richtig.
  const z = (await p.locator('#showhead .sh-now .sh-z').textContent()).trim();
  return /^bis \d\d:\d\d/.test(z) ? true : 'kein «bis HH:MM»: ' + z;
});

await check('die Uhr in der Kopfzeile bleibt die ECHTE Zeit', async () => {
  // Der feste Punkt, gegen den der Versatz überhaupt eine Aussage ist. Wanderte
  // sie mit, wäre der Versatz unsichtbar — alles verschöbe sich gleichmäßig.
  const v = await shText('sh-clock');
  return /^15:3\d$/.test(v) ? true : 'die Uhr ist mitgewandert: ' + v;
});
await check('DIE ANSAGE ZÄHLT: der Versatz rechnet den Verzug herunter', async () => {
  // Die Kernentscheidung — aber sie ist RELATIV zu lesen, und das ist keine
  // Schwäche der Umsetzung, sondern eine Eigenschaft des Showablaufs: dort
  // steht alles auf «geplant», weil im Betrieb niemand Häkchen pflegt. Für den
  // gerade laufenden Punkt meldet die Rechnung deshalb IMMER Verzug in Höhe
  // seiner bisherigen Laufzeit. «im Plan» erscheint hier also nie, solange
  // etwas läuft — auch schon vor dem Versatz war das so.
  //
  // Was der Versatz leisten muss und hier geprüft wird: er zieht seinen Betrag
  // vom gemeldeten Verzug DESSELBEN Punktes ab, Minute für Minute.
  const lies = async () => {
    const v = (await p.locator('#showhead .sh-late .sh-v').textContent()).trim();
    const z = (await p.locator('#showhead .sh-late .sh-z').textContent()).trim();
    const m = /(\d+)\s*Min/.exec(v);
    return { min: m ? Number(m[1]) : null, wer: z.split('—')[0].trim(), v };
  };
  await setVzShow(0);
  const ohne = await lies();
  if (ohne.min == null) return 'ohne Versatz kein «+N Min»: ' + ohne.v;
  await setVzShow(3);
  const mit = await lies();
  if (mit.wer !== ohne.wer) return `anderer Punkt gemeldet: «${ohne.wer}» → «${mit.wer}»`;
  return mit.min === ohne.min - 3 ? true
    : `${ohne.min} − 3 sollte ${ohne.min - 3} sein, gemeldet wird ${mit.min}`;
});
await setVzShow(5);
await p.screenshot({ path: join(here, 'shots', 'showablauf-versatz.png') });
await setVzShow(0);

await check('im Bauzeitenplan bleibt die Kopfzeile weg', async () => {
  await p.locator('[data-ansicht="bau"]').click();
  await p.waitForTimeout(400);
  return (await p.locator('#showhead').isHidden()) ? true : 'sie steht auch dort';
});
await p.locator('[data-ansicht="show"]').click();
await p.waitForTimeout(500);
await p.screenshot({ path: join(here, 'shots', 'showablauf-live.png') });

// ── Running-Order-Blatt ─────────────────────────────────────────────────────
console.log('\nRUNNING-ORDER-BLATT (A3 quer)');
await p.goto(BASE + '/print.html?plan=klassentreffen&ansicht=show');
await p.waitForSelector('.pr-ro', { timeout: 20000 });
await p.waitForTimeout(700);

await check('zwei Blätter — ein Showtag je Blatt', async () => {
  const n = await p.locator('.pr-ro').count();
  return n === 2 ? true : n + ' Blätter statt 2';
});
await check('Blatt 1 trägt alle 17 Zeilen des Samstags', async () => {
  const n = await p.locator('.pr-ro').first().locator('.pr-ro-r:not(.pr-ro-h)').count();
  return n === 17 ? true : n + ' Zeilen statt 17';
});
await check('die Zeiten stehen in der Reihenfolge des PDFs', async () => {
  const z = await p.locator('.pr-ro').first().locator('.pr-ro-z1').allTextContents();
  const soll = '12:00,14:00,14:30,14:40,15:10,15:20,15:55,16:05,16:45,16:55,17:35,17:50,18:30,19:00,20:00,20:40,21:50';
  return z.map((x) => x.trim()).join(',') === soll ? true : z.join(',');
});
await check('leere Felder drucken als Ausfülllinie', async () => {
  const leer = await p.locator('.pr-ro').first().locator('.pr-ro-a.is-leer').count();
  if (leer < 15) return 'nur ' + leer + ' Linien';
  const rand = await p.locator('.pr-ro-a.is-leer').first()
    .evaluate((n) => getComputedStyle(n).borderBottomWidth);
  return parseFloat(rand) > 0 ? true : 'die Linie hat keine Stärke';
});
await check('ausgefüllte Felder drucken ihren Text', async () => {
  // «1 Riser 2×1 m» wurde oben bei SIDO eingetragen und liegt in localStorage.
  const t = await p.locator('.pr-ro-r', { hasText: 'SIDO' }).first().locator('.pr-ro-m').textContent();
  return /Riser/.test(t) ? true : '«' + t.trim() + '»';
});
await check('kein Typ steht doppelt — «Changeover / Changeover»', async () => {
  const t = await p.locator('.pr-ro-r.is-um').first().textContent();
  const n = (t.match(/Changeover/g) || []).length;
  if (n > 1) return 'Changeover steht ' + n + '× in derselben Zeile';
  const ende = await p.locator('.pr-ro-r[data-typ="ende"]').first().textContent();
  return /Show-Ende/.test(ende) ? 'SHOW END trägt zusätzlich «Show-Ende»' : true;
});
await check('die Zeilen füllen das Blatt', async () => {
  const [hSheet, hBody] = await p.locator('.pr-ro').first().evaluate((s) => [
    s.getBoundingClientRect().height,
    s.querySelector('.pr-body').getBoundingClientRect().height,
  ]);
  const anteil = hBody / hSheet;
  return anteil > 0.82 ? true : 'nur ' + Math.round(anteil * 100) + '% des Blattes genutzt';
});
await check('Changeover-Zeilen treten zurück, verschwinden aber nicht', async () => {
  const um = await p.locator('.pr-ro-r.is-um').count();
  if (um < 12) return um + ' Umbauzeilen';
  const hUm = await p.locator('.pr-ro-r.is-um').first().evaluate((n) => n.getBoundingClientRect().height);
  const hAct = await p.locator('.pr-ro-r[data-typ="act"]').first().evaluate((n) => n.getBoundingClientRect().height);
  return hUm < hAct ? true : `Umbau ${hUm.toFixed(0)}px, Act ${hAct.toFixed(0)}px`;
});
await check('nichts läuft über die Blattkante', async () => {
  const ueber = await p.locator('.pr-ro').first().evaluate((s) => {
    const r = s.getBoundingClientRect();
    return [...s.querySelectorAll('.pr-ro-r')].filter((n) => {
      const q = n.getBoundingClientRect();
      return q.bottom > r.bottom + 1 || q.right > r.right + 1;
    }).length;
  });
  return ueber === 0 ? true : ueber + ' Zeilen ragen hinaus';
});
await check('das Blatt lässt sich auf Setup oder Show eingrenzen', async () => {
  // Setup läuft bis zum Showstart, Show danach — zwei Abläufe mit ganz
  // verschiedenen Lesern. Wer der Crew den Vormittag gibt, will nicht die
  // Running Order darunter.
  const knopf = (t) => p.locator('.pr-seg .pr-btn', { hasText: t }).first();
  if (!(await knopf('beides').count())) return 'keine Abschnitts-Auswahl';

  await knopf('Show').click();
  await p.waitForTimeout(900);
  const nurShow = await p.locator('.pr-ro').first().locator('.pr-ro-r:not(.pr-ro-h)').count();
  if (nurShow !== 17) return nurShow + ' Zeilen im Show-Blatt statt 17';

  await knopf('Setup').click();
  await p.waitForTimeout(900);
  // Im Klassentreffen-Plan gibt es keine Setup-Einträge — das Blatt sagt das,
  // statt eine leere Liste zu drucken.
  const blaetter = await p.locator('.pr-ro').count();
  const leer = await p.locator('.pr-leer').count();
  if (blaetter || !leer) return blaetter + ' Setup-Blätter, ' + leer + ' Hinweise';

  await knopf('beides').click();
  await p.waitForTimeout(900);
  return (await p.locator('.pr-ro').count()) === 2 ? true : 'nach «beides» stimmt die Blattzahl nicht';
});

await check('der Blattkopf sagt, welchen Abschnitt man in der Hand hält', async () => {
  await p.locator('.pr-seg .pr-btn', { hasText: 'Show' }).first().click();
  await p.waitForTimeout(900);
  const kopf = await p.locator('.pr-ro .pr-head-t').first().textContent();
  if (!/Show/.test(kopf)) return 'Kopf: «' + kopf.trim() + '»';
  await p.locator('.pr-seg .pr-btn', { hasText: 'beides' }).first().click();
  await p.waitForTimeout(900);
  const ohne = await p.locator('.pr-ro .pr-head-t').first().textContent();
  return /Setup|Show/.test(ohne) ? 'bei «beides» steht trotzdem ein Abschnitt: ' + ohne.trim() : true;
});

await check('die Tagesblätter des Bauzeitenplans sind weiter erreichbar', async () => {
  await p.locator('.pr-seg .pr-btn', { hasText: 'Tagesblätter' }).click();
  await p.waitForTimeout(900);
  const ro = await p.locator('.pr-ro').count();
  const gantt = await p.locator('.pr-sheet:not(.pr-ro)').count();
  return ro === 0 && gantt > 10 ? true : `${ro} Listen / ${gantt} Gantt-Blätter`;
});
await p.locator('.pr-seg .pr-btn', { hasText: 'Running Order' }).click();
await p.waitForTimeout(700);
// Die Steuerleiste ist sticky und läge im Element-Screenshot ÜBER dem Blatt —
// im Druck ist sie weg (display:none). Für das Bild also auch.
await p.addStyleTag({ content: '.pr-ctl{display:none!important}' });
await p.waitForTimeout(300);
await p.locator('.pr-ro').first().screenshot({ path: join(here, 'shots', 'showablauf-blatt.png') });

// ── Uhrzeit statt Datum ─────────────────────────────────────────────────────
console.log('\nUHRZEIT STATT DATUM');

await check('Start und Ende zeigen nur die Uhrzeit', async () => {
  await p.goto(BASE + '/index.html?plan=klassentreffen&ansicht=show');
  await p.waitForSelector('.bz-lab', { timeout: 20000 });
  await p.locator('[data-view="tabelle"]').click();
  await p.waitForTimeout(700);
  const [typ, wert] = await p.locator('.tb-r .c-start input').first()
    .evaluate((n) => [n.type, n.value]);
  if (typ !== 'time') return 'Feldtyp ist «' + typ + '»';
  return /^\d{2}:\d{2}$/.test(wert) ? true : 'Wert ist «' + wert + '»';
});

await check('die Tabelle passt jetzt ohne seitliches Scrollen ins Bild', async () => {
  const [breit, sicht] = await p.locator('.tb').evaluate((n) => [n.scrollWidth, n.clientWidth]);
  return breit <= sicht + 1 ? true : breit + ' px in einem ' + sicht + ' px breiten Fenster';
});

await check('eine Uhrzeit ändern verschiebt den Eintrag NICHT auf einen anderen Tag', async () => {
  // Der Datumsteil muss erhalten bleiben — sonst spränge ein Eintrag vom Vortag
  // beim ersten Antippen einen Tag weit.
  const feld = p.locator('.tb-r .c-start input').first();
  await feld.fill('13:00');
  await feld.press('Tab');
  await p.waitForTimeout(1400);
  const t = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    return (raw.tasks || []).find((x) => x.title === 'DOORS' && x.start.startsWith('2026-08-29'));
  });
  if (!t) return 'DOORS ist vom 29.08. verschwunden';
  return t.start === '2026-08-29T13:00' ? true : 'steht jetzt auf ' + t.start;
});

// ── Soundcheck ──────────────────────────────────────────────────────────────
console.log('\nSOUNDCHECK ALS EIGENER ZEITEINTRAG');

await check('im Panel eines Acts steht ein Soundcheck-Bereich', async () => {
  await p.locator('[data-view="gantt"]').click();
  await p.waitForTimeout(600);
  await p.locator('.bz-bar').filter({ hasText: 'SIDO' }).first().click();
  await p.waitForTimeout(600);
  return (await p.locator('#ins .ins-sc').count()) === 1 ? true : 'kein Soundcheck-Bereich';
});

await check('ANLEGEN ERZEUGT EINEN BALKEN IM SETUP', async () => {
  // Der Kern: als Feld tauchte der Soundcheck in keiner Zeitachse auf. Nur ein
  // Balken zeigt, ob sich zwei überschneiden.
  await p.locator('#ins .ins-sc button').first().click();
  await p.waitForTimeout(900);
  const sc = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    const sido = (raw.tasks || []).find((x) => x.title === 'SIDO');
    return (raw.tasks || []).find((x) => x.fuer === (sido || {}).id) || null;
  });
  if (!sc) return 'kein Zeiteintrag angelegt';
  if (sc.abschnitt !== 'setup') return 'liegt im Abschnitt «' + sc.abschnitt + '»';
  if (sc.title !== 'Soundcheck SIDO') return 'heißt «' + sc.title + '»';
  // Am Vormittag, nicht kurz vor dem Auftritt: ein Soundcheck läuft im Setup.
  if (!sc.start.startsWith('2026-08-29T08:00')) return 'beginnt um ' + sc.start.slice(11) + ', erwartet 08:00';

  await p.locator('[data-ansicht="setup"]').click();
  await p.waitForTimeout(900);
  const namen = await p.locator('.bz-lab-task .bz-lab-name').allTextContents();
  if (!namen.some((x) => x.trim() === 'Soundcheck SIDO')) return 'im Setup nicht zu sehen: ' + namen.join('|');
  const balken = await p.locator('.bz-bar').filter({ hasText: 'Soundcheck SIDO' }).count();
  return balken === 1 ? true : balken + ' Balken für den Soundcheck';
});

await p.screenshot({ path: join(here, 'shots', 'showablauf-soundcheck.png') });

await check('er hat eine Dauer, die sich ändern lässt', async () => {
  await p.locator('[data-ansicht="show"]').click();
  await p.waitForTimeout(800);
  await p.locator('.bz-bar').filter({ hasText: 'SIDO' }).first().click();
  await p.waitForTimeout(600);
  const dauer = p.locator('#ins .ins-sc input').nth(1);
  if ((await dauer.inputValue()) !== '1h') return 'Vorgabe ist «' + (await dauer.inputValue()) + '», erwartet 1h';
  await dauer.fill('90m');
  await dauer.press('Tab');
  await p.waitForTimeout(900);
  const min = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    const sido = (raw.tasks || []).find((x) => x.title === 'SIDO');
    const sc = (raw.tasks || []).find((x) => x.fuer === (sido || {}).id);
    return sc ? (new Date(sc.end) - new Date(sc.start)) / 60000 : null;
  });
  return min === 90 ? true : min + ' Minuten statt 90';
});

await check('den Act löschen nimmt den Soundcheck mit', async () => {
  // Sonst bliebe eine Waise mit totem `fuer` zurück, die niemand mehr findet.
  await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    window.__sido = (raw.tasks || []).find((x) => x.title === 'SIDO').id;
  });
  await p.locator('#ins .ins-x').click();
  await p.waitForTimeout(400);
  await p.locator('.bz-bar').filter({ hasText: 'SIDO' }).first().click({ button: 'right' });
  await p.waitForTimeout(500);
  await p.locator('.mn-i', { hasText: 'Löschen' }).first().click();
  await p.waitForTimeout(1400);
  const rest = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    return (raw.tasks || []).filter((x) => x.fuer === window.__sido).length;
  });
  if (rest) return rest + ' verwaiste Soundchecks';
  await p.keyboard.press('Meta+z');       // Act und Soundcheck zusammen zurück
  await p.waitForTimeout(1200);
  return true;
});

// Aufräumen: die folgenden Blöcke prüfen einen LEEREN Setup-Abschnitt. Jeder
// Block hinterlässt den Zustand, den der nächste erwartet — sonst prüft man
// irgendwann die Reste des vorigen.
await check('den Soundcheck wieder entfernen räumt den Setup leer', async () => {
  await p.locator('[data-ansicht="show"]').click();
  await p.waitForTimeout(700);
  await p.locator('.bz-bar').filter({ hasText: 'SIDO' }).first().click();
  await p.waitForTimeout(600);
  await p.locator('#ins .ins-sc .btn-danger').click();
  await p.waitForTimeout(1200);
  const rest = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    return (raw.tasks || []).filter((x) => x.abschnitt === 'setup').length;
  });
  return rest === 0 ? true : rest + ' Setup-Einträge übrig';
});

// ── Setup-Abschnitt: anlegen und wiederfinden ───────────────────────────────
console.log('\nSETUP-ABSCHNITT');

await p.goto(BASE + '/index.html?plan=klassentreffen&ansicht=setup');
await p.waitForSelector('[data-ansicht="setup"][aria-pressed="true"]', { timeout: 20000 });
await p.waitForTimeout(900);

await check('die Bühne steht in BEIDEN Abschnitten — sie ist dieselbe', async () => {
  // Es gibt eine Bühne mit zwei Abläufen, nicht zwei Bühnen. Sie darf im Setup
  // nicht fehlen, nur weil dort noch nichts eingetragen ist — genau da legt man
  // den ersten Setup-Eintrag an.
  const namen = await p.locator('.bz-lab-group .bz-lab-name').allTextContents();
  if (namen.join('|') !== 'Hauptbühne') return 'Bänder: ' + namen.join('|');
  const zeilen = await p.locator('.bz-lab-task').count();
  return zeilen === 0 ? true : zeilen + ' Zeiteinträge im Setup, erwartet 0';
});

await check('der Knopf sieht aus wie ein Knopf und heißt «+ Zeiteintrag»', async () => {
  await p.locator('[data-view="tabelle"]').click();
  await p.waitForTimeout(600);
  const knopf = p.locator('.tb-add').first();
  const txt = (await knopf.textContent()).trim();
  if (txt !== '+ Zeiteintrag') return 'beschriftet mit «' + txt + '»';
  const [bg, h] = await knopf.evaluate((n) => [
    getComputedStyle(n).backgroundColor, n.getBoundingClientRect().height]);
  if (/transparent|rgba\(0, 0, 0, 0\)/.test(bg)) return 'randlos und ohne Fläche: ' + bg;
  return h >= 22 ? true : 'nur ' + Math.round(h) + ' px hoch';
});

await check('EIN NEUER ZEITEINTRAG LANDET IM GEZEIGTEN ABSCHNITT UND TAG', async () => {
  // Der Kern. Vorher suchte defaultStart() den letzten Punkt über ALLE Tage und
  // hängte den neuen an den ZWEITEN Showtag; der Filter blendete ihn sofort aus.
  await p.locator('.tb-add').first().click();
  await p.waitForTimeout(900);

  const zeilen = await p.locator('.tb-r').count();
  if (zeilen !== 1) return zeilen + ' Zeilen in der Tabelle, erwartet 1';
  // Das Feld zeigt nur noch die Uhrzeit — der Tag steht in den Daten.
  const start = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    const neu = (raw.tasks || []).find((t) => t.title === 'Neuer Zeiteintrag');
    return neu ? neu.start : '(nicht angelegt)';
  });
  if (!start.startsWith('2026-08-29')) return 'angelegt am ' + start + ' statt am 29.08.';
  const abs = await p.locator('.tb-r .c-abs select').first().inputValue();
  if (abs !== 'setup') return 'im Abschnitt «' + abs + '» statt setup';

  await p.locator('[data-view="gantt"]').click();
  await p.waitForTimeout(700);
  const balken = await p.locator('.bz-bar').count();
  return balken === 1 ? true : balken + ' Balken im Gantt, erwartet 1';
});

await check('EINE UHRZEIT LÄSST SICH ZIFFER FÜR ZIFFER EINTIPPEN', async () => {
  // Der Fehler, den Marco gemeldet hat: «die aktualisiert sich nach jeder
  // Ziffer». `type="time"` feuert `change`, sobald ein VOLLSTÄNDIGER Wert
  // dasteht — beim vorbelegten Feld also schon nach der Stunde. Das change
  // schickte einen Store-Befehl, der die Tabelle per replaceChildren neu baute;
  // das Eingabefeld war danach ein anderer Knoten, der Fokus weg, und die
  // Minuten landeten nirgends.
  //
  // Getippt wird bewusst Ziffer für Ziffer über die Tastatur, nicht per fill():
  // fill() setzt den Wert in einem Rutsch und hätte den Fehler nie gesehen.
  await p.locator('[data-view="tabelle"]').click();
  await p.waitForTimeout(600);
  const feld = p.locator('.tb-r .c-start input').first();
  // Auf den LINKEN Rand klicken: ein Klick in die Feldmitte landet im
  // Minuten-Segment, und der Test prüfte dann etwas anderes als das, was ein
  // Mensch tut, der die Uhrzeit von vorne eintippt.
  await feld.click({ position: { x: 6, y: 10 } });
  for (const z of '0930') {
    await p.keyboard.press(z);
    await p.waitForTimeout(120);          // Zeit für ein Re-Render, falls es kommt
  }
  const wert = await feld.inputValue();
  const drin = await p.evaluate(() => {
    const a = document.activeElement;
    return !!a && a.closest('.c-start') !== null;
  });
  if (wert !== '09:30') return `Feld zeigt «${wert}» statt 09:30`;
  if (!drin) return 'der Fokus wurde aus dem Feld geworfen';

  // Jetzt das Feld verlassen: der aufgeschobene Neuaufbau muss nachgeholt
  // werden, und der Auto-Save (800 ms) den Stand in die Ablage schreiben.
  await p.locator('.tb-r .c-title input').first().click();
  await p.waitForTimeout(1200);
  const gespeichert = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    const neu = (raw.tasks || []).find((t) => t.title === 'Neuer Zeiteintrag');
    return neu ? neu.start : '(weg)';
  });
  if (!gespeichert.endsWith('T09:30')) return 'gespeichert wurde ' + gespeichert;
  // Und die Tabelle zeigt danach den echten Stand — nicht den aufgeschobenen.
  const nachher = await p.locator('.tb-r .c-start input').first().inputValue();
  return nachher === '09:30' ? true : `nach dem Verlassen steht «${nachher}» im Feld`;
});

await check('ein ⌘Z aus dem Feld heraus zeichnet SOFORT neu', async () => {
  // Die Gegenprobe zum Aufschieben: verschluckte der Neuaufbau jede Änderung,
  // solange irgendwo ein Cursor steht, zeigte die Tabelle nach einem Undo stumm
  // Veraltetes. Aufgeschoben wird nur, was das fokussierte Feld SELBST ausgelöst
  // hat.
  await p.keyboard.press('Meta+z');
  await p.waitForTimeout(500);
  const wert = await p.locator('.tb-r .c-start input').first().inputValue();
  return wert !== '09:30' ? true : 'die Tabelle zeigt nach dem Undo noch 09:30';
});

await check('eine EIGENE ART lässt sich im Dropdown anlegen', async () => {
  // Angelegt wird dort, wo man ohnehin steht. Geprüft wird der ganze Weg:
  // Auswahl «+ Neue Art…» → Name eintippen → die Art ist da UND für diese Zeile
  // gewählt.
  const sel = p.locator('.tb-r .c-typ select').first();
  await sel.selectOption('__neu__');
  await p.waitForTimeout(400);
  if (!(await p.locator('.tb-neuart').isVisible())) return 'kein Eingabefeld erschienen';
  // Die Auswahl darf NICHT auf «+ Neue Art…» stehen bleiben — sonst sähe die
  // Zeile so aus, als wäre das ein Typ.
  if ((await sel.inputValue()) === '__neu__') return 'die Auswahl steht auf «+ Neue Art…»';
  await p.locator('.tb-neuart-n').fill('Line-Check');
  await p.locator('.tb-neuart-k input').check();      // tritt auf dem Blatt zurück
  // Das offene Feld festhalten — es ist der einzige neue Baustein dieser
  // Version, und ob er lesbar über der Tabelle steht, sagt kein Häkchen.
  await p.screenshot({ path: join(here, 'shots', 'showablauf-neue-art.png') });
  await p.locator('.tb-neuart .btn-p').click();
  await p.waitForTimeout(600);
  if (await p.locator('.tb-neuart').count()) return 'das Eingabefeld bleibt offen';
  const gewaehlt = await p.locator('.tb-r .c-typ select').first().inputValue();
  if (gewaehlt !== 'linecheck') return 'gewählt ist «' + gewaehlt + '» statt der neuen Art';
  const labels = await p.locator('.tb-r .c-typ select option').allTextContents();
  return labels.includes('Line-Check') ? true : 'nicht im Dropdown: ' + labels.join(' · ');
});
await p.screenshot({ path: join(here, 'shots', 'showablauf-eigene-art.png') });

await check('sie überlebt das Neuladen und steht im Plan', async () => {
  await p.waitForTimeout(900);              // Auto-Save
  await p.reload();
  await p.waitForTimeout(1200);
  await p.locator('[data-view="tabelle"]').click();
  await p.waitForTimeout(600);
  const labels = await p.locator('.tb-r .c-typ select option').allTextContents();
  if (!labels.includes('Line-Check')) return 'nach dem Neuladen weg: ' + labels.join(' · ');
  const imPlan = await p.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('bzp_p_klassentreffen-festival-2026') || '{}');
    return (raw.project && raw.project.punktTypen) || [];
  });
  return imPlan.some((t) => t.id === 'linecheck' && t.kompakt === true)
    ? true : 'im Plan steht: ' + JSON.stringify(imPlan);
});

await check('dieselbe Art ein zweites Mal wird abgelehnt', async () => {
  const sel = p.locator('.tb-r .c-typ select').first();
  await sel.selectOption('__neu__');
  await p.waitForTimeout(400);
  await p.locator('.tb-neuart-n').fill('line-check');   // andere Schreibweise
  await p.locator('.tb-neuart .btn-p').click();
  await p.waitForTimeout(500);
  const offen = await p.locator('.tb-neuart').count();
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  return offen ? true : 'das Feld schloss sich, die Dopplung wurde also angelegt';
});

await check('Escape bricht ab, ohne etwas anzulegen', async () => {
  const vorher = (await p.locator('.tb-r .c-typ select option').allTextContents()).length;
  const sel = p.locator('.tb-r .c-typ select').first();
  await sel.selectOption('__neu__');
  await p.waitForTimeout(300);
  await p.locator('.tb-neuart-n').fill('Wegwerf');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  if (await p.locator('.tb-neuart').count()) return 'das Feld bleibt offen';
  const nachher = (await p.locator('.tb-r .c-typ select option').allTextContents()).length;
  return nachher === vorher ? true : `${vorher} → ${nachher} Einträge im Dropdown`;
});

await check('im Show-Abschnitt ist er WEG — dieselbe Bühne, anderer Ablauf', async () => {
  await p.locator('[data-view="gantt"]').click();
  await p.waitForTimeout(500);
  await p.locator('[data-ansicht="show"]').click();
  await p.waitForTimeout(800);
  const namen = await p.locator('.bz-lab-task .bz-lab-name').allTextContents();
  if (namen.some((x) => /Neuer Zeiteintrag/.test(x))) return 'der Setup-Eintrag steht in der Show';
  if (namen.length !== 17) return namen.length + ' Zeiteinträge in der Show statt 17';
  // Und die Bühne heißt in beiden dasselbe — sie ist dieselbe.
  const band = await p.locator('.bz-lab-group .bz-lab-name').allTextContents();
  if (band.join('|') !== 'Hauptbühne') return 'Bänder in der Show: ' + band.join('|');
  await p.locator('[data-ansicht="setup"]').click();
  await p.waitForTimeout(800);
  return true;
});

await check('Zoomstufe und Datumsfeld zeigen, was die Achse zeigt', async () => {
  const datum = await p.locator('#date-jump').inputValue();
  if (datum !== '2026-08-29') return 'Datumsfeld steht auf ' + datum;
  const an = await p.locator('[data-z][aria-pressed="true"]').allTextContents();
  if (an.length > 1) return 'mehrere Zoomstufen markiert: ' + an.join(' ');
  return !an.length || an[0].trim() === 'Stunden' ? true : 'markiert: ' + an[0].trim();
});

await check('der Setup-View rechnet seine eigene Zeitachse', async () => {
  const ticks = (await p.locator('.bz-axis-minor .bz-t-n').allTextContents())
    .map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
  if (!ticks.length) return 'keine Stundenmarken';
  return ticks[0] < 12 ? true : 'die Achse beginnt erst bei ' + ticks[0] + ' Uhr';
});

await check('eine eigene Art TRITT AUF DEM BLATT ZURÜCK, wenn sie soll', async () => {
  // Bisher entschied ein fest verdrahteter Vergleich auf 'changeover', wer eine
  // niedrigere Zeile bekommt. Jetzt sagt es die Art selbst — sonst nähme eine
  // selbst angelegte «Umbaupause» genauso viel Platz weg wie ein Act.
  // ctx.newPage(), nicht b.newPage(): ein neuer Context hätte einen eigenen
  // localStorage, print.html fiele auf die mitgelieferte JSON zurück und kennte
  // die eben angelegte Art gar nicht.
  const seite = await ctx.newPage();
  await seite.goto(BASE + '/print.html?plan=klassentreffen&ansicht=show&abschnitt=setup');
  await seite.waitForSelector('.pr-ro-r', { timeout: 20000 });
  await seite.waitForTimeout(600);
  const treffer = await seite.evaluate(() => {
    const r = [...document.querySelectorAll('.pr-ro-r')]
      .find((x) => /Neuer Zeiteintrag/.test(x.textContent));
    if (!r) return { fehler: 'der Setup-Eintrag steht nicht auf dem Blatt' };
    return { typ: r.dataset.typ, um: r.classList.contains('is-um') };
  });
  await seite.close();
  if (treffer.fehler) return treffer.fehler;
  if (treffer.typ !== 'linecheck') return 'die Zeile trägt den Typ «' + treffer.typ + '»';
  return treffer.um ? true : 'die Zeile tritt nicht zurück, obwohl die Art kompakt ist';
});

if ((await p.locator('#live').getAttribute('aria-pressed')) === 'true') {
  await p.locator('#live').click();
  await p.waitForTimeout(500);
}
await p.screenshot({ path: join(here, 'shots', 'showablauf-setup.png') });

await check('IMMER GENAU EINE Ansicht ist gedrückt', async () => {
  // Der Fehler, der das ausgelöst hat: zwei Umschalter im selben Stil
  // nebeneinander, mit je einem dunklen Knopf. Das las sich als eine Leiste, in
  // der zwei Dinge gleichzeitig angewählt sind.
  for (const a of ['bau', 'setup', 'show']) {
    await p.locator(`[data-ansicht="${a}"]`).click();
    await p.waitForTimeout(700);
    const an = await p.locator('[data-ansicht][aria-pressed="true"]').allTextContents();
    if (an.length !== 1) return a + ': ' + an.length + ' gedrückt (' + an.join(' ') + ')';
    const soll = { bau: 'Bauzeitenplan', setup: 'Setup', show: 'Show' }[a];
    if (an[0].trim() !== soll) return a + ': gedrückt ist «' + an[0].trim() + '»';
  }
  return true;
});

await check('die Reihenfolge ist Bauzeitenplan, Setup, Show', async () => {
  const namen = (await p.locator('[data-ansicht]').allTextContents()).map((x) => x.trim());
  return namen.join(' · ') === 'Bauzeitenplan · Setup · Show' ? true : namen.join(' · ');
});

await check('der Wechsel greift wirklich, nicht nur die Markierung', async () => {
  await p.locator('[data-ansicht="setup"]').click();
  await p.waitForTimeout(800);
  const imSetup = await p.locator('.bz-lab-task .bz-lab-name').allTextContents();
  await p.locator('[data-ansicht="show"]').click();
  await p.waitForTimeout(800);
  const inShow = await p.locator('.bz-lab-task .bz-lab-name').allTextContents();
  if (imSetup.length === inShow.length) return 'beide zeigen ' + inShow.length + ' Zeilen';
  if (inShow.length !== 17) return 'die Show zeigt ' + inShow.length + ' Zeiteinträge statt 17';
  return imSetup.some((x) => /Neuer Zeiteintrag/.test(x)) ? true : 'im Setup fehlt der angelegte Eintrag';
});

await check('kein zweiter Umschalter mehr in der Werkzeugzeile', async () => {
  // Nur KNÖPFE: der Gantt-Container trägt weiterhin ein `data-ebene`, damit das
  // CSS die gefüllten Balken je Ebene setzen kann. Das ist kein Umschalter.
  const alt = await p.locator('button[data-ebene], button[data-abschnitt]').count();
  return alt === 0 ? true : alt + ' Knöpfe des alten Umschalters stehen noch da';
});

// ── Dunkel und schmal ───────────────────────────────────────────────────────
console.log('\nDUNKEL UND SCHMAL');
await p.goto(BASE + '/index.html?plan=klassentreffen&ansicht=show');
await p.waitForSelector('.bz-lab', { timeout: 20000 });
await p.waitForTimeout(800);

await check('der Umschalter greift in beide Richtungen (Dunkel über Hell)', async () => {
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await p.waitForTimeout(300);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const hell = /255,\s*255,\s*255/.test(bg) || /241,\s*239,\s*233/.test(bg);
  return hell ? 'im Dunkelmodus bleibt der Grund hell: ' + bg : true;
});
await check('die Live-Kopfzeile ist auch dunkel lesbar', async () => {
  // NICHT blind klicken: der Live-Zustand überlebt das Neuladen (bzp_live), ein
  // Klick hätte ihn hier ausgeschaltet — und die Farbprüfung liefe an einem
  // unsichtbaren Element durch. Genau das stand im ersten Dunkel-Bild.
  if ((await p.locator('#live').getAttribute('aria-pressed')) !== 'true') {
    await p.locator('#live').click();
    await p.waitForTimeout(700);
  }
  if (await p.locator('#showhead').isHidden()) return 'die Kopfzeile ist gar nicht da';
  const [fg, bg] = await p.locator('#showhead .sh-now .sh-v').evaluate((n) => {
    const c = getComputedStyle(n);
    return [c.color, getComputedStyle(n.closest('.sh-f')).backgroundColor];
  });
  if (fg === bg) return 'Schrift und Grund sind dieselbe Farbe';
  // Auf dunklem Grund muss helle Schrift stehen — ein Theme, das nur die Tokens
  // der Kopfzeile vergisst, fiele sonst nicht auf.
  const hell = (c) => (c.match(/\d+/g) || [0, 0, 0]).slice(0, 3).reduce((a, x) => a + +x, 0) / 3;
  return hell(fg) > hell(bg) ? true : 'dunkle Schrift auf dunklem Grund: ' + fg + ' auf ' + bg;
});
await p.screenshot({ path: join(here, 'shots', 'showablauf-dunkel.png') });
await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

await check('auf Handybreite läuft die Seite nicht seitlich über', async () => {
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(700);
  const ueber = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ueber > 1) return ueber + ' px Überlauf im Gantt';
  await p.locator('[data-view="tabelle"]').click();
  await p.waitForTimeout(500);
  const ueber2 = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  return ueber2 > 1 ? ueber2 + ' px Überlauf in der Tabelle' : true;
});
await check('auf dem Handy bricht die Dauer unter die Zeile, statt den Namen zu drücken', async () => {
  await p.locator('[data-view="gantt"]').click();
  await p.waitForTimeout(600);
  const [zeitTop, dauerTop, nameTop] = await p.locator('.bz-lab-task').first()
    .evaluate((n) => ['.bz-lab-zeit', '.bz-lab-dauer', '.bz-lab-name']
      .map((s) => Math.round(n.querySelector(s).getBoundingClientRect().top)));
  if (dauerTop <= zeitTop) return 'die Dauer steht noch in derselben Zeile';
  if (Math.abs(nameTop - zeitTop) > 2) return 'der Name ist mit umgebrochen';
  // Und die Zeile darf dabei nicht aus ihrer Höhe laufen.
  const [h, inhalt] = await p.locator('.bz-lab-task').first()
    .evaluate((n) => [n.getBoundingClientRect().height, n.scrollHeight]);
  return inhalt <= h + 1 ? true : 'Inhalt ' + inhalt + ' px in einer ' + Math.round(h) + ' px hohen Zeile';
});
await check('Tages- und Bühnenwahl bleiben auf dem Handy bedienbar', async () => {
  const h = await p.locator('#buehnen .seg-tag button').first()
    .evaluate((n) => n.getBoundingClientRect().height);
  return h >= 28 ? true : 'nur ' + Math.round(h) + ' px hoch';
});
// Fürs BILD ein höheres Fenster bei gleicher Breite: bei 390×844 füllt die
// Werkzeugzeile samt Live-Kopfzeile den Viewport, und der Ablauf — worum es hier
// geht — bliebe unter dem Rand. Die Prüfungen oben liefen bei echter Handyhöhe.
await p.setViewportSize({ width: 390, height: 1400 });
await p.locator('[data-view="gantt"]').click();
await p.waitForTimeout(700);
await p.screenshot({ path: join(here, 'shots', 'showablauf-handy.png') });
await p.setViewportSize({ width: 1700, height: 1000 });

// ── Echtes A3-PDF ───────────────────────────────────────────────────────────
console.log('\nPDF (A3 quer)');
let chromeExe = null;
try {
  // Nicht raten: der Ordner heißt je nach Architektur `chrome-mac` oder
  // `chrome-mac-arm64`, das Programm darin mal `Chromium.app`, mal «Google
  // Chrome for Testing.app». Hart verdrahtet wurde das PDF auf Apple Silicon
  // stillschweigend übersprungen, obwohl Chromium installiert war.
  const d = readdirSync(cache).find((x) => x.startsWith('chromium-'));
  const arch = d && readdirSync(join(cache, d)).find((x) => x.startsWith('chrome-mac'));
  const app = arch && readdirSync(join(cache, d, arch)).find((x) => x.endsWith('.app'));
  if (app) chromeExe = join(cache, d, arch, app, 'Contents/MacOS', app.replace(/\.app$/, ''));
} catch { /* nicht da */ }
if (chromeExe && existsSync(chromeExe)) {
  const cb = await chromium.launch({ executablePath: chromeExe });
  const cp = await cb.newPage();
  await cp.goto(BASE + '/print.html?plan=klassentreffen&ansicht=show');
  await cp.waitForSelector('.pr-ro', { timeout: 20000 });
  await cp.waitForTimeout(600);
  const out = join(here, 'shots', 'running-order-a3.pdf');
  await cp.pdf({ path: out, format: 'A3', landscape: true, printBackground: true });
  await cb.close();
  console.log('  ✓ ' + out);
} else {
  console.log('  – übersprungen: Chromium nicht installiert.');
  console.log('    Für echte PDFs einmalig:  npx playwright install chromium');
}

console.log('');
await check('keine JS-Fehler', async () => (errors.length ? errors.slice(0, 3).join(' | ') : true));

await b.close();
server.close();
console.log(bad ? `\n${bad} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(bad ? 1 : 0);
