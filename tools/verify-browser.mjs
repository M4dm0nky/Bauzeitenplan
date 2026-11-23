// ── Verhaltensprüfung im echten Browser ───────────────────────────────────────
// Fährt die App in jedem der fünf Themes hoch, prüft Verhalten, schießt Fotos.
//
//   node tools/verify-browser.mjs                 lokal (eigener Server)
//   node tools/verify-browser.mjs --base <url>    gegen eine veröffentlichte Seite
//
// Lokal läuft ein eigener HTTP-Server statt file:// — index.html lädt ES-Module,
// und die blockiert der Browser bei file:// per CORS.
//
// --base prüft die echte Live-Seite. Das ist die einzige Prüfung, die beantwortet,
// ob die Module über die Unteradresse (/Bauzeitenplan/) wirklich laden. Die
// Themes liegen im Deploy und laufen dort mit.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mustFirefox, chromiumExe } from './browsers.mjs';
import { festivalMitDaten } from './festival-fixture.mjs';
import { createServer } from 'node:http';
import { planLaden } from './plan-fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });

// Browser aus dem Playwright-Cache statt Neuinstallation
const exe = mustFirefox();
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
    const file = join(root, /^[\\/]$/.test(rel) ? 'index.html' : rel);
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;
}

// Die App selbst zuerst — sie ist das Produkt. Die anderen Themes laufen in
// DERSELBEN App: gleiche Adresse, nach dem Laden wird `#theme-css` umgestellt
// (siehe themeAn). Ein Theme, das in der App bricht, ist ein Fehler.
const THEMES = ['console', 'blueprint', 'studio', 'board'];
const PAGES = [
  // ?plan=leer: Testschalter, öffnet das gesetzte Projekt ohne Dialog (ohne Projekt: Dialog).
  { name: 'APP (index.html)', url: BASE + '/index.html?plan=leer', app: true },
  ...THEMES.map((t) => ({ name: 'APP Theme ' + t, url: BASE + '/index.html?plan=leer', app: true, theme: t, key: t })),
];
// Stellt das Stylesheet um und wartet, bis das neue geladen ist.
const themeAn = (page, t) => page.evaluate((t) => new Promise((res, rej) => {
  // Zeitlimit: lädt dieselbe Adresse nochmal, kommt kein load — dann nicht hängen.
  setTimeout(() => rej(new Error('Theme-CSS: kein load-Ereignis für ' + t)), 8000);
  const l = document.getElementById('theme-css');
  l.addEventListener('load', () => res(true), { once: true });
  l.addEventListener('error', () => rej(new Error('Theme-CSS nicht geladen: ' + t)), { once: true });
  l.dataset.themeName = t;
  // Version aus dem vorhandenen Link übernehmen, nicht von Hand raten.
  const v = (l.getAttribute('href').match(/\?v=([^&]+)/) || [])[1] || '';
  l.href = `styles/themes/${t}.css` + (v ? '?v=' + v : '');
}), t);
// Fingerabdruck eines Themes: Hintergrund + Schrift des body. Alle fünf
// unterscheiden sich darin (Callboard, Console, Blueprint, Studio, Board).
const fingerprint = (page) => page.evaluate(() => {
  const c = getComputedStyle(document.body);
  return c.backgroundColor + ' | ' + c.fontFamily;
});
const prints = new Map(); // Fingerabdruck → Seitenname
const setZoom = async (page, z) => { await page.click('#zoom-stufe'); await page.locator('.mn .mn-i', { hasText: z[0].toUpperCase() + z.slice(1) }).click(); };

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
  // prüfungen brauchen wir Inhalt: Festival-Vorlage anlegen.
  if (pg.theme) { await themeAn(page, pg.theme); await page.waitForTimeout(300); }
  const fp = await fingerprint(page);
  if (pg.app && await page.locator('#dlg').isVisible()) {
    await festivalMitDaten(page, 'Prüfprojekt');
    await page.waitForTimeout(900);
  }

  // ── Verhaltensprüfungen ───────────────────────────────────────────────────
  const check = async (name, fn) => {
    const r = await fn();
    if (r !== true) { console.log(`    ✗ ${name}: ${r}`); problems++; }
    else console.log(`    ✓ ${name}`);
  };

  console.log('\n' + pg.name.toUpperCase());

  await check(pg.theme ? `Theme ${pg.theme} ist wirklich aktiv` : 'Theme callboard ist aktiv', async () => {
    // Das load-Ereignis beweist nur, dass IRGENDEIN Stylesheet kam. Aktiv ist das
    // Theme, wenn sein Fingerabdruck sich von jedem schon gesehenen unterscheidet.
    const prev = prints.get(fp);
    prints.set(fp, pg.name);
    return prev ? `sieht aus wie «${prev}» (${fp})` : true;
  });
  if (pg.app) {
    await check('Suchfeld und -liste sind in diesem Theme nicht durchsichtig', async () => {
      const bg = await page.evaluate(() => {
        const l = document.getElementById('suche-liste'), wasHidden = l.hidden;
        l.hidden = false;
        const f = getComputedStyle(document.getElementById('suche')).backgroundColor;
        const g = getComputedStyle(l).backgroundColor;
        l.hidden = wasHidden;
        return [f, g];
      });
      return bg.every((c) => !/^rgba\(.*,\s*0\)$/.test(c) && c !== 'transparent') ? true : 'durchsichtig: ' + bg.join(' | ');
    });
  }
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
  await check('kein «kritisch» mehr; Tooltip nennt den Engpass', async () => {
    const n = await page.locator('.is-crit').count();
    if (n !== 0) return `${n} .is-crit-Marken`;
    const bars = page.locator('.bz-bar');
    for (let i = 0; i < Math.min(await bars.count(), 40); i++) {
      await page.mouse.move(5, 5);
      if (!(await bars.nth(i).hover({ timeout: 1500 }).then(() => true, () => false))) continue;
      await page.waitForTimeout(120);
      const t = await page.locator('.bz-tip.is-on').first().textContent().catch(() => '');
      if (/Luft (bis|nach) .+\(|überlappt|schließt direkt an/.test(t)) return true;
    }
    return 'kein Tooltip mit Engpass';
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
    await setZoom(page, z);
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
  await setZoom(page, 'tage');
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
  if (pg.theme) { await themeAn(dark, pg.theme); await dark.waitForTimeout(300); }
  if (pg.app && await dark.locator('#dlg').isVisible()) {
    await festivalMitDaten(dark, 'Prüfprojekt');
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
    await festivalMitDaten(m, 'Handy');
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

  // Touch: Firefox kennt hasTouch nicht — die Zeigerereignisse werden mit
  // pointerType 'touch' selbst zugestellt. Wischen (zu früh bewegt) scrollt und
  // verschiebt nichts; Halten (300 ms) und dann Ziehen verschiebt.
  const touchBar = () => m.evaluate(() => {
    const n = [...document.querySelectorAll('.bz-bar[data-task]:not(.is-summary)')].find((b) => b.getBoundingClientRect().width > 30);
    if (!n) return null;
    n.scrollIntoView({ block: 'center', inline: 'center' });
    const r = n.getBoundingClientRect();
    return { id: n.dataset.task, x: Math.min(Math.max(r.left + r.width / 2, 120), 330), y: r.top + r.height / 2 };
  });
  const touchEv = (id, type, x, y) => m.evaluate(([id, type, x, y]) => {
    document.querySelector(`.bz-bar[data-task="${id}"]`).dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0 }));
  }, [id, type, x, y]);
  const touchStart = async (id) => {
    await m.waitForTimeout(1100);
    return m.evaluate((id) => {
      const k = localStorage.getItem('bzp_active');
      return JSON.parse(localStorage.getItem('bzp_p_' + k)).tasks.find((x) => x.id === id).start;
    }, id);
  };
  await mcheck('Touch: Wischen über einen Balken verschiebt nichts (scrollt)', async () => {
    const b = await touchBar();
    if (!b) return 'kein Balken';
    const vor = await touchStart(b.id);
    await touchEv(b.id, 'pointerdown', b.x, b.y);
    await touchEv(b.id, 'pointermove', b.x + 40, b.y);     // zu früh bewegt = Wischen
    await m.waitForTimeout(450);
    await touchEv(b.id, 'pointermove', b.x + 120, b.y);
    const hinweis = await m.locator('.bz-tip-zug').count();
    await touchEv(b.id, 'pointerup', b.x + 120, b.y);
    const nach = await touchStart(b.id);
    if (hinweis) return 'Hinweis erschien trotz Wischen';
    return nach === vor ? true : 'Start verschoben: ' + vor + ' → ' + nach;
  });
  await mcheck('Touch: Halten OHNE Bewegung öffnet das Menü des Balkens, nichts verschoben', async () => {
    const b = await touchBar();
    const vor = await touchStart(b.id);
    await touchEv(b.id, 'pointerdown', b.x, b.y);
    await m.waitForTimeout(450);
    await touchEv(b.id, 'pointerup', b.x, b.y);
    await m.waitForTimeout(250);
    const menu = await m.locator('.mn').isVisible().catch(() => false);
    const nach = await touchStart(b.id);
    await m.keyboard.press('Escape');
    await m.waitForTimeout(150);
    if (!menu) return 'kein Menü nach langem Drücken';
    return nach === vor ? true : 'Start verschoben';
  });
  await mcheck('Touch: Halten und nur senkrecht ziehen öffnet kein Menü', async () => {
    const b = await touchBar();
    await touchEv(b.id, 'pointerdown', b.x, b.y);
    await m.waitForTimeout(450);
    await touchEv(b.id, 'pointermove', b.x, b.y + 25);
    await touchEv(b.id, 'pointerup', b.x, b.y + 25);
    await m.waitForTimeout(250);
    const menu = await m.locator('.mn').isVisible().catch(() => false);
    if (menu) await m.keyboard.press('Escape');
    return menu ? 'Menü öffnete sich nach senkrechtem Ziehen' : true;
  });
  await mcheck('Touch: touchmove wird nur während des Ziehens abgefangen (Listener nicht passiv)', async () => {
    const b = await touchBar();
    const abgefangen = () => m.evaluate((id) => {
      const ev = new Event('touchmove', { bubbles: true, cancelable: true });
      document.querySelector(`.bz-bar[data-task="${id}"]`).dispatchEvent(ev);
      return ev.defaultPrevented;
    }, b.id);
    if (await abgefangen()) return 'abgefangen, obwohl nichts gezogen wird (Wischen würde blockiert)';
    await touchEv(b.id, 'pointerdown', b.x, b.y);
    if (await abgefangen()) return 'schon vor dem Halten abgefangen';
    await m.waitForTimeout(450);
    await touchEv(b.id, 'pointermove', b.x + 40, b.y);
    const beimZiehen = await abgefangen();
    await touchEv(b.id, 'pointerup', b.x + 40, b.y);
    const danach = await abgefangen();
    if (!beimZiehen) return 'beim Ziehen nicht abgefangen — der Browser würde scrollen';
    return danach ? 'nach dem Ziehen weiter abgefangen' : true;
  });
  await mcheck('Touch: Halten und Ziehen verschiebt den Balken', async () => {
    const b = await touchBar();
    const vor = await touchStart(b.id);
    await touchEv(b.id, 'pointerdown', b.x, b.y);
    await m.waitForTimeout(450);                           // > 300 ms gehalten
    await touchEv(b.id, 'pointermove', b.x + 60, b.y);
    await touchEv(b.id, 'pointermove', b.x + 130, b.y);
    const hinweis = await m.locator('.bz-tip-zug').count();
    await m.screenshot({ path: join(shots, 'mobile-ziehen.png') });
    await touchEv(b.id, 'pointerup', b.x + 130, b.y);
    await m.waitForTimeout(250);
    const menu = await m.locator('.mn').isVisible().catch(() => false);
    const nach = await touchStart(b.id);
    if (!hinweis) return 'kein Hinweis beim Ziehen';
    if (menu) return 'Menü öffnete sich trotz Ziehen';
    return nach > vor ? true : 'Start nicht später: ' + vor + ' → ' + nach;
  });

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

// ── Phase nach Projektende ───────────────────────────────────────────────────
// Die Achse spannte nur project.start…end: eine Phase dahinter fehlte (Fall:
// Projektende 12.08., Phasen bis 30.08.). Der Store ist in der Seite nicht
// erreichbar, darum legt ein zweites Init-Skript die Phase im gespeicherten Plan
// an, bevor die App lädt (Form wie addPhase: id, art, name, start, end).
{
  console.log('\nPHASE NACH PROJEKTENDE (Achse = planSpanne)');
  const m = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const id = await planLaden(m);
  await m.addInitScript(`try {
    const k = 'bzp_p_' + ${JSON.stringify(id)};
    if (localStorage.getItem('bzp_phase_nach_ende') !== '1') {
      localStorage.setItem('bzp_phase_nach_ende', '1');
      const p = JSON.parse(localStorage.getItem(k));
      const ende = new Date(p.project.end);
      const fmt = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const a = new Date(ende.getTime() + 10 * 86400000), b = new Date(ende.getTime() + 12 * 86400000);
      (p.phases ||= []).push({ id: 'ph-nach-ende', art: 'abbau', name: '', start: fmt(a), end: fmt(b) });
      localStorage.setItem(k, JSON.stringify(p));
    }
  } catch (e) {}`);
  await m.goto(BASE + '/index.html?plan=leer', { waitUntil: 'load', timeout: 30000 });
  await m.waitForSelector('.bz-lab', { timeout: 20000 });
  await m.waitForTimeout(argBase ? 1600 : 800);
  const r = await m.evaluate(() => {
    const n = document.querySelector('.bz-ph[data-phase="ph-nach-ende"]');
    const c = document.querySelector('.bz-canvas');
    if (!n) return { da: false };
    const b = n.getBoundingClientRect(), cb = c.getBoundingClientRect();
    return { da: true, w: Math.round(b.width), links: Math.round(b.left - cb.left), cw: Math.round(cb.width) };
  });
  if (r.da && r.w > 0 && r.links < r.cw) console.log(`    ✓ Phase nach Projektende sichtbar (Breite ${r.w} px, left ${r.links} < Canvas ${r.cw})`);
  else { console.log('    ✗ Phase nach Projektende sichtbar: ' + JSON.stringify(r)); problems++; }
  await m.screenshot({ path: join(shots, 'phase-nach-ende.png') });
  await m.close();
}

// ── Handy-Kopf in allen fünf Themes, beide Modi ──────────────────────────────
// Der Kopf belegte auf 390×844 ~470 px (Board: 574) — die Hälfte des Bildes.
// Ziel: ≤ 285 px, ohne dass ein Bedienelement wegfällt. Themes überschreiben
// Kopfmaße (Titelgröße, Kennzahlen, Abstände), deshalb läuft es in jedem.
{
  console.log('\nHANDY-KOPF (390×844, alle Themes, Bauzeitenplan + Showablauf)');
  const HANDY_THEMES = ['callboard', ...THEMES];
  // Was je Modus sichtbar bleiben MUSS (Zoom-Gruppe gibt es nur im Bauzeitenplan).
  const MUSS = {
    bau: ['#tag-wahl', '[data-view="gantt"]', '[data-view="tabelle"]', '[data-view="bedarf"]', '#zoom-stufe', '#zout', '#zin', '#now', '#fold', '#undo', '#redo', '#live', '#suche', '#theme-toggle', '#drucken', '#save-state'],
    show: ['#tag-wahl', '[data-ansicht="setup"]', '[data-ansicht="show"]', '[data-view="gantt"]', '[data-view="tabelle"]', '[data-view="bedarf"]', '#undo', '#redo', '#live', '#suche', '#theme-toggle', '#drucken', '#save-state'],
  };
  for (const t of HANDY_THEMES) for (const modus of ['bau', 'show']) {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await planLaden(m);
    const label = `${t} · ${modus === 'bau' ? 'Bauzeitenplan' : 'Showablauf'}`;
    const mc = async (name, fn) => {
      let r; try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
      if (r === true) console.log(`    ✓ ${label}: ${name}`);
      else { console.log(`    ✗ ${label}: ${name}: ${r}`); problems++; }
    };
    await m.goto(BASE + '/index.html?plan=leer&ansicht=' + modus, { waitUntil: 'load', timeout: 30000 });
    await m.waitForSelector('.bz-lab', { timeout: 20000 });
    await m.waitForTimeout(argBase ? 1600 : 800);
    if (t !== 'callboard') { await themeAn(m, t); await m.waitForTimeout(400); }
    await mc('Kopf ≤ 285 px', async () => {
      const h = await m.evaluate(() => Math.round(document.querySelector('.hd').getBoundingClientRect().bottom));
      return h <= 285 ? true : `Kopf ${h} px hoch`;
    });
    await mc('Titel einzeilig, Ort ausgeblendet, Kennzahlen in einer Reihe', async () => {
      const r = await m.evaluate(() => {
        const t = document.querySelector('.hd-title'); const k = [...document.querySelectorAll('#kpis .kpi')];
        const tops = new Set(k.map((n) => Math.round(n.getBoundingClientRect().top)));
        return { th: t.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(t).lineHeight) || 0, fs: parseFloat(getComputedStyle(t).fontSize), sub: getComputedStyle(document.querySelector('.hd-sub')).display, rows: tops.size, n: k.length };
      });
      if (r.sub !== 'none') return 'der Ort steht noch da';
      if (r.th > Math.max(r.lh, r.fs * 1.4) * 1.3) return `Titel läuft über mehrere Zeilen (${Math.round(r.th)} px)`;
      if (r.n < 4) return 'zu wenige Kennzahlen: ' + r.n;
      return r.rows === 1 ? true : `Kennzahlen in ${r.rows} Reihen`;
    });
    await mc('kein Bedienelement fällt weg, alle liegen im Bild, Touch-Höhe ≥ 40', async () => {
      const bad = await m.evaluate((sel) => sel.map((s) => {
        const n = document.querySelector(s); if (!n) return s + ' fehlt';
        const r = n.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return s + ' unsichtbar';
        if (r.right > window.innerWidth + 1 || r.left < -1) return s + ' ragt aus dem Bild';
        if (s !== '#save-state' && r.height < 39.5) return s + ' nur ' + Math.round(r.height) + ' px hoch';
        return null;
      }).filter(Boolean), MUSS[modus]);
      return bad.length ? bad.join(' · ') : true;
    });
    await mc('Gantt-Bildlauffläche ≥ 50 % der Bildhöhe (Fuß frisst nicht den Plan)', async () => {
      const r = await m.evaluate(() => ({ h: Math.round(document.querySelector('.bz-scroll').getBoundingClientRect().height), ih: innerHeight, ft: Math.round(document.querySelector('.ft').getBoundingClientRect().height) }));
      return r.h >= r.ih * 0.5 ? true : `Gantt nur ${r.h} px von ${r.ih} (Fuß ${r.ft} px)`;
    });
    await mc('Kopf läuft nicht seitlich über', async () => {
      // Nur der Kopf: die Seitenbreite prüft der HANDY-Block oben (Festival-Vorlage);
      // mit dem Klassentreffen-Plan stünde hier die Minimap-Jetzt-Marke (.bz-mini-now,
      // «heute» liegt hinter dem Planende) außerhalb — vom Kopf unabhängig.
      const r = await m.evaluate(() => { const h = document.querySelector('.hd'); return [h.scrollWidth, h.clientWidth]; });
      return r[0] <= r[1] + 1 ? true : `Kopf ${r[0]} > ${r[1]}`;
    });
    await m.screenshot({ path: join(shots, `handy-kopf-${t}-${modus}.png`) });
    await m.close();
  }
}

// ── Bedienelemente zählen ────────────────────────────────────────────────────
// CLAUDE.md sagt: 15 im Bauzeitenplan, 13 im Showablauf — gemessen als sichtbare
// button/input/select in .hd-bar (Klassentreffen, ohne Live, ohne offenen
// Konflikt). Eine Zahl, die kein Werkzeug prüft, ist eine Zahl, die lügt.
// Desktop UND Handy müssen dieselbe Zahl liefern: nichts fällt weg, nichts kommt dazu.
{
  console.log('\nBEDIENELEMENTE (sichtbare button/input/select in .hd-bar)');
  const SOLL = { bau: 15, show: 13 };
  for (const [w, h] of [[1600, 950], [390, 844]]) for (const modus of ['bau', 'show']) {
    const m = await browser.newPage({ viewport: { width: w, height: h } });
    await planLaden(m);
    let r;
    try {
      await m.goto(BASE + '/index.html?plan=leer&ansicht=' + modus, { waitUntil: 'load', timeout: 30000 });
      await m.waitForSelector('.bz-lab', { timeout: 20000 });
      await m.waitForTimeout(argBase ? 1600 : 800);
      r = await m.evaluate(() => [...document.querySelectorAll('.hd-bar button, .hd-bar input, .hd-bar select')]
        .filter((n) => { const q = n.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(n).visibility !== 'hidden' && n.type !== 'hidden'; }).length);
    } catch (e) { r = 'Ausnahme: ' + e.message; }
    await m.close();
    if (r === SOLL[modus]) console.log(`  ✓ ${w}×${h} ${modus === 'bau' ? 'Bauzeitenplan' : 'Showablauf'}: ${r} Bedienelemente`);
    else { console.log(`  ✗ ${w}×${h} ${modus === 'bau' ? 'Bauzeitenplan' : 'Showablauf'}: ${r} statt ${SOLL[modus]}`); problems++; }
  }
}

await browser.close();
if (server) server.close();
console.log(problems ? `\n${problems} Problem(e) gefunden.\n` : `\nAlle Prüfungen bestanden (${PAGES.length} Seiten).\n`);
process.exit(problems ? 1 : 0);
