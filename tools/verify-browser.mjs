// ── Verhaltensprüfung im echten Browser ───────────────────────────────────────
// Fährt die App und jeden Design-Prototyp hoch, prüft Verhalten, schießt Fotos.
//
//   node tools/verify-browser.mjs                 lokal (eigener Server)
//   node tools/verify-browser.mjs --base <url>    gegen eine veröffentlichte Seite
//
// Lokal läuft ein eigener HTTP-Server statt file:// — index.html lädt ES-Module,
// und die blockiert der Browser bei file:// per CORS.
//
// --base prüft die echte Live-Seite. Das ist die einzige Prüfung, die beantwortet,
// ob die Module über die Unteradresse (/Bauzeitenplan/) wirklich laden. Die
// Prototypen werden dabei übersprungen — sie liegen nicht im Deploy.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

// Browser aus dem Playwright-Cache statt Neuinstallation
const cache = join(process.env.HOME, 'Library/Caches/ms-playwright');
const ffDir = readdirSync(cache).find((d) => d.startsWith('firefox-'));
const exe = ffDir && join(cache, ffDir, 'firefox/Nightly.app/Contents/MacOS/firefox');
if (!exe || !existsSync(exe)) {
  console.error('Firefox nicht gefunden. Einmalig: npx playwright install firefox');
  process.exit(1);
}

// ── Statischer Server ───────────────────────────────────────────────────────
// charset=utf-8 ist Pflicht, nicht Kosmetik: ohne die Angabe rät der Browser,
// und bei «Bühne»/«Sanitär» rät er falsch.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
// --base <url> → gegen eine veröffentlichte Seite prüfen statt lokal
const argBase = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : null;
if (process.argv.includes('--base') && !argBase) {
  console.error('--base braucht eine URL, z.B. --base https://aniflu.github.io/Bauzeitenplan/');
  process.exit(2);
}

let server = null, BASE;
if (argBase) {
  BASE = argBase.replace(/\/+$/, '');
  console.log('Prüfe die veröffentlichte Seite: ' + BASE);
} else {
  server = createServer((req, res) => {
    // normalize + Präfixprüfung: kein Ausbrechen aus dem Projektordner
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;
}

// Die App selbst zuerst — sie ist das Produkt; die Prototypen sind Entwürfe.
// Live sind nur die App und der Service Worker im Deploy, die Prototypen nicht.
const PAGES = [
  { name: 'APP (index.html)', url: BASE + '/index.html', app: true },
  ...(argBase ? [] : ['console', 'blueprint', 'studio', 'board'].map((v) =>
    ({ name: 'Prototyp ' + v, url: BASE + '/tools/out/' + v + '.html', key: v }))),
];
const browser = await firefox.launch({ executablePath: exe });
let problems = 0;

for (const pg of PAGES) {
  const v = pg.key || 'app';
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  const missing = [];
  page.on('pageerror', (e) => errors.push('JS: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  // Fehlende Dateien fallen bei ES-Modulen sonst nur als kryptischer Ladefehler auf
  page.on('response', (r) => { if (r.status() >= 400) missing.push(r.status() + ' ' + r.url()); });

  await page.goto(pg.url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(argBase ? 1600 : 700);

  // Die App startet ohne Projekt mit dem Anlege-Dialog. Für die Darstellungs-
  // prüfungen brauchen wir Inhalt: Festival-Vorlage anlegen. Die Prototypen
  // bringen ihre Daten selbst mit.
  if (pg.app && await page.locator('#dlg').isVisible()) {
    await page.fill('.dlg-f:first-child input', 'Prüfprojekt');
    await page.locator('.dlg-t[data-k="festival"]').click();
    await page.locator('.dlg-act .btn-p').click();
    await page.waitForTimeout(900);
  }

  // ── Verhaltensprüfungen ───────────────────────────────────────────────────
  const check = async (name, fn) => {
    const r = await fn();
    if (r !== true) { console.log(`    ✗ ${name}: ${r}`); problems++; }
    else console.log(`    ✓ ${name}`);
  };

  console.log('\n' + pg.name.toUpperCase());

  await check('alle angeforderten Dateien wurden ausgeliefert', () =>
    missing.length === 0 ? true : missing.slice(0, 3).join(' · '));

  if (pg.app) {
    await check('Service Worker ist registriert und aktiv', async () => {
      // Ohne ihn holt der Browser die Untermodule (gantt.js & Co.) aus dem
      // Cache und Änderungen kommen nach einem Deploy nicht an.
      const r = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) return 'Browser kann keine Service Worker';
        const reg = await navigator.serviceWorker.getRegistration();
        if (!reg) return 'keine Registrierung';
        const w = reg.active || reg.installing || reg.waiting;
        return w ? w.scriptURL : 'Registrierung ohne Worker';
      });
      return String(r).endsWith('sw.js') ? true : r;
    });
  }

  await check('Balken gerendert', async () => {
    const n = await page.locator('.bz-bar').count();
    return n > 20 ? true : `nur ${n} Balken`;
  });
  await check('beim Öffnen sind Balken auch WIRKLICH ZU SEHEN', async () => {
    // Im DOM zu stehen reicht nicht: liegt der Aufbau zwei Wochen in der
    // Zukunft, sprang die Ansicht auf «jetzt» und der Plan öffnete leer.
    const vis = await page.locator('.bz-bar').evaluateAll((ns, w) =>
      ns.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > 240 && r.left < w; }).length, 1600);
    return vis >= 3 ? true : `nur ${vis} Balken im Sichtfeld — der Plan öffnet fast leer`;
  });
  await check('Meilensteine gerendert', async () => {
    const n = await page.locator('.bz-ms').count();
    return n >= 6 ? true : `nur ${n} Meilensteine`;
  });
  await check('Abhängigkeitspfeile haben Geometrie', async () => {
    const bad = await page.locator('.bz-dep').evaluateAll(
      (ns) => ns.filter((n) => !n.getAttribute('d') || n.getAttribute('d').includes('NaN')).length);
    const n = await page.locator('.bz-dep').count();
    if (n < 20) return `nur ${n} Pfeile`;
    return bad === 0 ? true : `${bad} Pfade mit NaN/leer`;
  });
  await check('kritischer Pfad markiert', async () => {
    const n = await page.locator('.bz-bar.is-crit, .bz-ms.is-crit').count();
    return n > 8 ? true : `nur ${n} kritische Marken`;
  });
  await check('Auto-Scroll zu Heute (nicht am Anfang stehengeblieben)', async () => {
    const sl = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
    return sl > 100 ? true : `scrollLeft = ${sl}`;
  });
  // Ab hier auf «heute» springen: die Erstansicht steht bewusst beim Aufbau,
  // nicht bei jetzt (siehe initialFocus in gantt.js). Die folgenden Prüfungen
  // gelten der Jetzt-Linie selbst, also erst dorthin fahren.
  await page.click('#now');
  await page.waitForTimeout(350);

  await check('«Heute» bringt die Jetzt-Linie ins Bild', async () => {
    const box = await page.locator('.bz-now').boundingBox();
    if (!box) return 'nicht gefunden';
    return box.x > 0 && box.x < 1600 ? true : `x = ${Math.round(box.x)} außerhalb`;
  });
  await check('JETZT-Fahne ist vollständig lesbar', async () => {
    // Die Fahne steht als sticky im Fluss und schnurrte schon einmal auf die
    // 2px Breite der Linie zusammen — sichtbar blieb nur noch «J».
    return page.locator('.bz-now-flag').evaluate((n) => {
      const r = n.getBoundingClientRect();
      if (r.width < 8) return `nur ${Math.round(r.width)}px breit — Text abgeschnitten`;
      if (n.scrollWidth > n.clientWidth + 1) return `Text läuft über (${n.scrollWidth} > ${n.clientWidth})`;
      return true;
    });
  });
  await check('Seitenspalte bleibt beim Scrollen stehen (sticky)', async () => {
    const before = await page.locator('.bz-side').boundingBox();
    await page.locator('.bz-scroll').evaluate((n) => { n.scrollLeft += 900; });
    await page.waitForTimeout(220);
    const after = await page.locator('.bz-side').boundingBox();
    return Math.abs(before.x - after.x) < 1 ? true : `verschoben um ${Math.round(after.x - before.x)}px`;
  });
  await check('Zeitachse bleibt oben stehen (sticky)', async () => {
    const before = await page.locator('.bz-axis').boundingBox();
    await page.locator('.bz-scroll').evaluate((n) => { n.scrollTop += 250; });
    await page.waitForTimeout(220);
    const after = await page.locator('.bz-axis').boundingBox();
    await page.locator('.bz-scroll').evaluate((n) => { n.scrollTop = 0; });
    return Math.abs(before.y - after.y) < 1 ? true : `verschoben um ${Math.round(after.y - before.y)}px`;
  });
  await check('Seite scrollt nicht horizontal über den Rand', async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    return !over ? true : 'body überläuft horizontal';
  });
  await check('Gewerk-Spalte überdeckt die Pfeile', async () => {
    // Das Pfeil-SVG ist so breit wie der ganze Zeitraum und ragt beim Scrollen
    // zwangsläufig unter die klebende Spalte. Entscheidend ist deshalb nicht die
    // Geometrie, sondern dass die Spalte darüber liegt.
    return page.evaluate(() => {
      const z = (sel) => parseInt(getComputedStyle(document.querySelector(sel)).zIndex, 10);
      const canvasZ = getComputedStyle(document.querySelector('.bz-canvas')).zIndex;
      if (canvasZ !== 'auto') return '.bz-canvas bildet einen eigenen Stapelkontext (z-index ' + canvasZ + ')';
      return z('.bz-side') > z('.bz-deps') ? true
        : `Spalte z=${z('.bz-side')} liegt nicht über Pfeilen z=${z('.bz-deps')}`;
    });
  });
  await check('laufende Phase ist benannt und nicht von der Spalte verdeckt', async () => {
    // Die Phase unter der Jetzt-Linie füllt den Blick — ihr Name beginnt weit
    // links außerhalb und muss per sticky rechts NEBEN der Gewerk-Spalte andocken.
    return page.evaluate(() => {
      const side = document.querySelector('.bz-side').getBoundingClientRect();
      const now = document.querySelector('.bz-now').getBoundingClientRect().left;
      const phase = [...document.querySelectorAll('.bz-ph')].find((p) => {
        const r = p.getBoundingClientRect();
        return r.left <= now && r.right >= now;
      });
      if (!phase) return 'keine Phase unter der Jetzt-Linie';
      const t = phase.querySelector('.bz-ph-t').getBoundingClientRect();
      if (t.width === 0) return 'Phasenname nicht gerendert';
      if (t.left < side.right - 1) return `«${phase.textContent.trim()}» liegt unter der Gewerk-Spalte`;
      if (t.left > window.innerWidth) return `«${phase.textContent.trim()}» rechts außerhalb`;
      return true;
    });
  });
  await check('Puffer-Schraffuren bleiben disponierbar breit', async () => {
    // Zoom-unabhängig: ein freier Puffer kann NIE breiter sein als der ganze Plan.
    // (Früher gegen feste 1400 px geprüft — das hing an der alten Standard-Zoomstufe;
    // seit die Tagesansicht einen Tag voll aufzieht, ist Pixelbreite kein Maß mehr.)
    const wide = await page.evaluate(() => {
      const canvas = document.querySelector('.bz-canvas');
      const planW = canvas ? canvas.scrollWidth : Infinity;
      return [...document.querySelectorAll('.bz-slack')].filter((n) => n.offsetWidth > planW + 4).length;
    });
    return wide === 0 ? true : `${wide} Schraffur(en) breiter als der ganze Plan`;
  });
  await check('keine Beschriftung ohne sichtbaren Balken', async () => {
    // Balken links aus dem Bild dürfen keinen Text unter der Gewerk-Spalte
    // hervorschieben; angeschnittene Balken führen ihre Beschriftung mit.
    return page.evaluate(() => {
      const side = document.querySelector('.bz-side').getBoundingClientRect();
      const bad = [...document.querySelectorAll('.bz-bar')].filter((bar) => {
        const l = bar.querySelector('.bz-bar-t');
        if (!l || getComputedStyle(l).display === 'none') return false;
        const r = l.getBoundingClientRect();
        return r.width > 0 && r.left < side.right && r.right > side.right;
      });
      return bad.length === 0 ? true
        : `${bad.length}× Text ragt unter der Spalte hervor: «${bad[0].textContent.trim()}»`;
    });
  });
  await check('Balkentext wird nicht mitten im Wort abgeschnitten', async () => {
    // Ein Balken zeigt Text entweder vollständig innen oder außen daneben.
    const clipped = await page.locator('.bz-bar:not(.is-narrow) .bz-bar-t').evaluateAll(
      (ns) => ns.filter((n) => n.scrollWidth > n.clientWidth + 2).length);
    return clipped <= 2 ? true : `${clipped} Beschriftungen abgeschnitten`;
  });

  // ── Zoomstufen durchfahren ────────────────────────────────────────────────
  // Nach jedem Zoom zurück auf «heute», sonst hält der Zoom-Anker die Mitte
  // fest und die Bilder landen in der Mai-Planung statt im Aufbau.
  for (const z of ['monate', 'wochen', 'tage', 'stunden']) {
    await page.click(`[data-z="${z}"]`);
    await page.waitForTimeout(120);
    await page.click('#now');
    await page.waitForTimeout(420);
    await check(`Zoom «${z}»: Achse beschriftet`, async () => {
      const n = await page.locator('.bz-t-minor').count();
      if (n === 0) return 'keine Ticks';
      if (n > 400) return `${n} Ticks im DOM — Virtualisierung greift nicht`;
      return true;
    });
    await page.screenshot({ path: join(shots, `${v}-${z}.png`) });
  }

  // Wieder auf Tage + Heute für den Hauptshot
  await page.click('[data-z="tage"]');
  await page.click('#now');
  await page.waitForTimeout(400);

  // Tooltip zeigen
  await page.locator('.bz-bar').nth(14).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, `${v}-tooltip.png`) });

  // Zugeklappt
  await page.click('#fold');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(shots, `${v}-collapsed.png`) });
  await check('zugeklappt: Sammelbalken sichtbar', async () => {
    const n = await page.locator('.bz-sum').count();
    return n >= 8 ? true : `nur ${n} Sammelbalken`;
  });
  await page.click('#fold');

  // Dunkelmodus
  const dark = await browser.newPage({ viewport: { width: 1600, height: 950 }, colorScheme: 'dark' });
  await dark.goto(pg.url);
  await dark.waitForTimeout(700);
  if (pg.app && await dark.locator('#dlg').isVisible()) {
    await dark.fill('.dlg-f:first-child input', 'Prüfprojekt');
    await dark.locator('.dlg-t[data-k="festival"]').click();
    await dark.locator('.dlg-act .btn-p').click();
    await dark.waitForTimeout(900);
  }
  await dark.screenshot({ path: join(shots, `${v}-dark.png`) });
  await dark.close();

  if (errors.length) { console.log('    ✗ Fehler auf der Seite:'); errors.slice(0, 6).forEach((e) => console.log('        ' + e)); problems += errors.length; }
  else console.log('    ✓ keine JS-Fehler');

  await page.close();
}

// ── Handy-Durchlauf (390×844) ─────────────────────────────────────────────────
// Die Seite war am Telefon unbrauchbar (fixe Seitenleiste, breiter Kopf). Hier im
// echten schmalen Viewport prüfen: keine horizontale SEITEN-Scrollleiste, das Panel
// öffnet als Overlay-Drawer, Gantt und Tabelle scrollen für sich.
{
  console.log('\nHANDY (390×844)');
  // isMobile/hasTouch unterstützt Firefox nicht — der schmale Viewport allein
  // löst die Media-Query aus, mehr braucht die Darstellungsprüfung nicht.
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const merr = [];
  m.on('pageerror', (e) => merr.push('JS: ' + e.message));
  m.on('console', (e) => { if (e.type() === 'error') merr.push('console: ' + e.text()); });
  await m.goto(PAGES[0].url, { waitUntil: 'load', timeout: 30000 });
  await m.waitForTimeout(argBase ? 1600 : 800);
  if (await m.locator('#dlg').isVisible()) {
    await m.fill('.dlg-f:first-child input', 'Handy');
    await m.locator('.dlg-t[data-k="festival"]').click();
    await m.locator('.dlg-act .btn-p').click();
    await m.waitForTimeout(900);
  }
  const mcheck = async (name, fn) => {
    let r; try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
    if (r === true) console.log('    ✓ ' + name);
    else { console.log('    ✗ ' + name + ': ' + r); problems++; }
  };

  // Nur Elemente, die den Überlauf WIRKLICH verursachen: right > Viewport UND
  // kein Vorfahr klippt (overflow ≠ visible). Alles im .bz-scroll/.tb ist geklippt
  // und zählt nicht — das echte Leck steht außerhalb.
  const widestCulprit = () => m.evaluate(() => {
    const w = window.innerWidth; let worst = null;
    const clipped = (n) => {
      for (let p = n.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'hidden' || o === 'scroll') return true;
      }
      return false;
    };
    for (const n of document.querySelectorAll('*')) {
      const r = n.getBoundingClientRect();
      if (r.right > w + 1 && !clipped(n) && (!worst || r.right > worst.right)) {
        worst = { right: Math.round(r.right), tag: n.tagName.toLowerCase(), cls: (n.className && String(n.className).slice(0, 40)) || '', id: n.id };
      }
    }
    return worst;
  });
  await mcheck('keine horizontale Seiten-Scrollleiste', async () => {
    if (await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) return true;
    return `scrollWidth ${await m.evaluate(() => document.documentElement.scrollWidth)} > 390 · breitestes: ${JSON.stringify(await widestCulprit())}`;
  });
  await mcheck('Ansichts-Umschalter ist fingergroß (≥ 38 px)', async () =>
    (await m.locator('[data-view="gantt"]').evaluate((n) => n.getBoundingClientRect().height)) >= 38
      ? true : 'Knopf zu niedrig');
  await mcheck('Gantt zeigt Balken im schmalen Viewport', async () =>
    (await m.locator('.bz-bar').count()) > 20 ? true : 'zu wenige Balken');
  await m.screenshot({ path: join(shots, 'mobile-gantt.png') });

  await mcheck('Panel öffnet als Overlay-Drawer (position:fixed, schmal)', async () => {
    // Auswahl auslösen, ohne Hit-Testing: dispatchEvent stellt den Klick direkt
    // zu (der Balken liegt teils unter der klebenden Spalte/Achse). Getestet wird
    // hier die Drawer-POSITIONIERUNG, nicht die Klickbarkeit.
    await m.locator('.bz-side .bz-lab[data-gewerk]').first().dispatchEvent('click');
    await m.waitForTimeout(300);
    return m.locator('#ins').evaluate((n) => {
      if (n.hidden) return 'Panel blieb zu';
      const s = getComputedStyle(n);
      if (s.position !== 'fixed') return 'position=' + s.position + ' (kein Drawer)';
      if (n.getBoundingClientRect().width > 362) return 'Drawer zu breit: ' + Math.round(n.getBoundingClientRect().width);
      return true;
    });
  });
  await m.screenshot({ path: join(shots, 'mobile-drawer.png') });
  await m.locator('#ins .ins-x').click().catch(() => {});
  await m.waitForTimeout(200);

  await mcheck('Tabelle: Seite bleibt ohne horizontalen Überlauf', async () => {
    await m.locator('[data-view="tabelle"]').click();
    await m.waitForTimeout(400);
    if (await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) return true;
    return `Seite läuft horizontal über · breitestes: ${JSON.stringify(await widestCulprit())}`;
  });
  await m.screenshot({ path: join(shots, 'mobile-table.png') });

  if (merr.length) { console.log('    ✗ Fehler auf der Seite:'); merr.slice(0, 6).forEach((e) => console.log('        ' + e)); problems += merr.length; }
  else console.log('    ✓ keine JS-Fehler');
  await m.close();
}

await browser.close();
if (server) server.close();
console.log(problems ? `\n${problems} Problem(e) gefunden.\n` : `\nAlle Prüfungen bestanden (${PAGES.length} Seiten).\n`);
process.exit(problems ? 1 : 0);
