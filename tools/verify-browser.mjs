// ── Verhaltensprüfung im echten Browser ───────────────────────────────────────
// Fährt die App in jedem der fünf Themes hoch, prüft Verhalten, schießt Fotos.
//
//   node tools/verify-browser.mjs                 lokal (eigener Server)
//   node tools/verify-browser.mjs --base <url>    gegen eine veröffentlichte Seite
//   (Seit Mehrbenutzer: lokal läuft eine eigene PocketBase mit Prüfkonto und Plan, tools/plan-fixture.mjs.
//    Bei einer NICHT lokalen --base wird nichts angelegt und nicht angemeldet: geprüft wird nur,
//    was ohne Anmeldung geht — login.html in allen Themes und dass index.html dorthin weiterleitet.)
//
// Lokal läuft ein eigener HTTP-Server statt file:// — index.html lädt ES-Module,
// und die blockiert der Browser bei file:// per CORS.
//
// --base prüft die echte Live-Seite. Das ist die einzige Prüfung, die beantwortet,
// ob die Module über die Unteradresse (/Bauzeitenplan/) wirklich laden. Die
// Themes liegen im Deploy und laufen dort mit. Gegen fremde Server wird NICHTS geschrieben.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mustFirefox, chromiumExe } from './browsers.mjs';
import { festivalMitDaten } from './festival-fixture.mjs';
import { createServer } from 'node:http';
import { planLaden, planSeed } from './plan-fixture.mjs';
import { kontrast } from './farbpruefung.mjs';

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

// Lokal = localhost/127.0.0.1: dort startet das Skript eine eigene PocketBase. Alles andere ist «fremd».
const FREMD = !!argBase && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(argBase);
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


// ── Gerenderter Kontrast der Blöcke (Kopfzeile, Schiene, Legende, Fußzeile) ───
// Anlass: Theme «board» im Dunkelmodus, weiße Schrift auf fast weißer Fläche.
// Die Prüfung rechnet am ECHTEN Pixelzustand: Schriftfarbe (mit Deckkraft aller
// Vorfahren) gegen den ersten deckenden Hintergrund (halbtransparente Schichten
// werden durchgemischt). Schwelle 3,0 (UI/große Schrift).
// Übersprungen wird NUR: :disabled, aria-hidden, unsichtbar/ohne Fläche, und
// leere Eingabefelder (zeigen nur den Platzhalter) und Elemente mit
// Hintergrundbild/-verlauf (Farbe dort nicht bestimmbar).
const KONTRAST_MIN = 3.0;
const rgbaOf = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
const mixOn = (f, u) => ({ r: f.r * f.a + u.r * (1 - f.a), g: f.g * f.a + u.g * (1 - f.a), b: f.b * f.a + u.b * (1 - f.a), a: 1 });
const hexOf = (c) => '#' + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
async function kontrastFehler(page, label) {
  const items = await page.evaluate(() => {
    const out = [];
    const sel = '.hd, .rail, .legend, .ft';
    const seen = new Set();
    for (const blk of document.querySelectorAll(sel)) for (const e of [blk, ...blk.querySelectorAll('*')]) {
      if (seen.has(e)) continue; seen.add(e);
      const tag = e.tagName.toLowerCase();
      if (['svg', 'path', 'script', 'style'].includes(tag) || e.closest('svg')) continue;
      const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const ctl = ['button', 'input', 'select', 'label'].includes(tag);
      const text = own ? [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim() : (e.value || e.textContent || e.getAttribute('aria-label') || '').trim();
      if (tag === 'input' && !e.value) continue; // leeres Feld: nur Platzhalter, keine Schrift
      if (!own && !(ctl && text)) continue;
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      if (cs.visibility === 'hidden' || r.width < 1 || r.height < 1) continue;
      if (e.matches(':disabled') || e.closest('[aria-hidden="true"]')) continue;
      let op = 1, layers = [], skip = false, opaque = false;
      for (let p = e; p; p = p.parentElement) {
        const c = getComputedStyle(p);
        op *= parseFloat(c.opacity);
        if (!opaque) {
          if (c.backgroundImage !== 'none') { skip = true; break; }
          layers.push(c.backgroundColor);
          const m = c.backgroundColor.match(/[\d.]+/g);
          if (m && (m.length < 4 || parseFloat(m[3]) >= 1)) opaque = true;
        }
      }
      if (skip) continue;
      const cls = typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '';
      out.push({ sel: tag + (e.id ? '#' + e.id : '') + cls, text: text.slice(0, 24), color: cs.color, op, layers, opaque });
    }
    return out;
  });
  const bad = [];
  for (const it of items) {
    // Grund: weiß, wenn keine deckende Schicht gefunden wurde
    let bg = it.opaque ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
    for (const l of it.layers.reverse()) { const c = rgbaOf(l); if (c.a > 0) bg = mixOn(c, bg); }
    const fg = rgbaOf(it.color); fg.a *= it.op;
    const ratio = kontrast(hexOf(mixOn(fg, bg)), hexOf(bg));
    if (ratio < KONTRAST_MIN) bad.push(`${label}: ${it.sel} "${it.text}" ${ratio.toFixed(2)}`);
  }
  return bad;
}

const browser = await firefox.launch({ executablePath: exe });
let problems = 0;
const stops = [];   // lokale PocketBase je Skript (tools/plan-fixture.mjs), wird im finally beendet
// Seite mit Anmeldung bei der lokalen PB, eigenem Konto; `datei`: Plan, der dort schon liegt (null = keiner → Projektdialog)
const seite = async (opt, datei = null) => {
  const pg = await browser.newPage(opt);
  stops.push((await planLaden(pg, datei, { frisch: true })).stop);
  return pg;
};

// ── Fremde Seite (--base auf eine veröffentlichte URL): nur, was ohne Anmeldung geht ─────────
if (FREMD) {
  console.log('\nFREMDE SEITE: nur login.html und die Weiterleitung (nichts wird angelegt, niemand angemeldet)');
  try {
    // 1. index.html ohne Anmeldung leitet auf login.html weiter
    {
      const pg = await browser.newPage({ viewport: { width: 1600, height: 950 } });
      const err = [];
      pg.on('pageerror', (e) => err.push('JS: ' + e.message));
      await pg.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      let ok = true;
      try { await pg.waitForURL(/login\.html/, { timeout: 15000 }); } catch { ok = false; }
      if (ok) console.log('    ✓ index.html ohne Anmeldung leitet auf login.html weiter');
      else { console.log('    ✗ index.html ohne Anmeldung: keine Weiterleitung auf login.html (URL: ' + pg.url() + ')'); problems++; }
      await pg.close();
    }
    // 2. login.html in allen fünf Themes, hell und dunkel
    const fpL = new Map();
    for (const t of ['callboard', ...THEMES]) for (const scheme of ['light', 'dark']) {
      const pg = await browser.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: scheme });
      const err = [], missing = [];
      pg.on('pageerror', (e) => err.push('JS: ' + e.message));
      pg.on('console', (m) => { if (m.type() === 'error') err.push('console: ' + m.text()); });
      pg.on('response', (r) => { if (r.status() >= 400 && /\/(styles|js)\//.test(r.url())) missing.push(r.status() + ' ' + r.url()); });
      await pg.goto(BASE + '/login.html', { waitUntil: 'load', timeout: 30000 });
      await pg.waitForTimeout(1200);
      let themaFehler = null;
      if (t !== 'callboard') { try { await themeAn(pg, t); await pg.waitForTimeout(300); } catch (e) { themaFehler = e.message; } }
      const label = `login.html ${t} ${scheme === 'light' ? 'hell' : 'dunkel'}`;
      const r = await pg.evaluate(() => {
        const f = document.getElementById('f-anmelden'), k = f && f.querySelector('.lg-knopf');
        const sicht = (n) => { if (!n) return false; const q = n.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(n).visibility !== 'hidden'; };
        const c = getComputedStyle(document.body);
        return { formular: sicht(f), knopf: sicht(k), fp: c.backgroundColor + ' | ' + c.fontFamily };
      });
      const fehler = [];
      if (themaFehler) fehler.push(themaFehler);
      if (!r.formular) fehler.push('Anmeldeformular nicht sichtbar');
      if (!r.knopf) fehler.push('Anmelde-Knopf nicht sichtbar');
      if (missing.length) fehler.push('fehlende Dateien: ' + missing.slice(0, 2).join(' · '));
      if (err.length) fehler.push(err[0]);
      const key = t + '|' + scheme;
      const gleich = [...fpL].find(([k2, v2]) => v2 === r.fp && k2.split('|')[1] === scheme);
      if (gleich) fehler.push('sieht aus wie ' + gleich[0]);
      fpL.set(key, r.fp);
      if (fehler.length) { console.log(`    ✗ ${label}: ${fehler.join(' / ')}`); problems++; }
      else console.log(`    ✓ ${label}`);
      if (t === 'callboard') await pg.screenshot({ path: join(shots, `fremd-login-${scheme}.png`) });
      await pg.close();
    }
  } finally { await browser.close().catch(() => {}); }
  console.log(problems ? `\n${problems} Problem(e) gefunden.\n` : '\nAlle Prüfungen bestanden (fremde Seite: login.html + Weiterleitung).\n');
  process.exit(problems ? 1 : 0);
}
try {

// ── Primärknopf beim Hovern lesbar (alle Themes × alle Scopes) ────────────────
// Anlass: Callboard dunkel — `.btn:hover` (Spezifität 0,2,0) schlägt `.btn-p` (0,1,0), die Schrift
// wurde beim Hovern weiß auf weißer Fläche. Gemessen wird der ECHTE Zustand: Maus über dem Knopf,
// berechnete Schrift- gegen berechnete Hintergrundfarbe (halbtransparente Schichten durchgemischt).
// Scopes je Theme: hell · @media dunkel · [data-theme="dark"] · [data-theme="light"] bei dunklem System.
const HOVER_MIN = 4.5;
async function primaerHover() {
  console.log('\nPRIMÄRKNOPF BEIM HOVERN (Kontrast ≥ ' + HOVER_MIN + ':1, alle Themes, alle Scopes)');
  const pg = await seite({ viewport: { width: 1200, height: 800 } });
  await pg.goto(BASE + '/index.html?plan=leer', { waitUntil: 'load', timeout: 30000 });
  await pg.waitForTimeout(argBase ? 1600 : 800);
  await pg.evaluate(() => {
    const w = document.createElement('div');
    w.style.cssText = 'position:fixed;left:40px;top:40px;padding:24px;z-index:99999;background:var(--panel)';
    const b = document.createElement('button'); b.className = 'btn btn-p'; b.id = 'probe-btnp'; b.textContent = 'Kopieren';
    w.appendChild(b); document.body.appendChild(w);
  });
  const messen = async () => {
    const info = await pg.evaluate(() => {
      const b = document.getElementById('probe-btnp');
      const layers = []; let deckend = false;
      for (let p = b; p && !deckend; p = p.parentElement) {
        const c = getComputedStyle(p).backgroundColor; layers.push(c);
        const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || parseFloat(m[3]) >= 1)) deckend = true;
      }
      // color-mix() liefert «color(srgb …)»: über ein Canvas in 8-Bit-RGBA umrechnen
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const rgba = (c) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${d[3] / 255})`; };
      return { color: rgba(getComputedStyle(b).color), layers: layers.map(rgba) };
    });
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const l of info.layers.reverse()) { const c = rgbaOf(l); if (c.a > 0) bg = mixOn(c, bg); }
    const fg = mixOn(rgbaOf(info.color), bg);
    return { ratio: kontrast(hexOf(fg), hexOf(bg)), fg: hexOf(fg), bg: hexOf(bg) };
  };
  const SCOPES = [
    ['hell', 'light', null], ['dunkel (System)', 'dark', null],
    ['data-theme=dark', 'light', 'dark'], ['data-theme=light', 'dark', 'light'],
  ];
  let aktuell = 'callboard';
  for (const t of ['callboard', ...THEMES]) {
    if (t !== aktuell) { await themeAn(pg, t); aktuell = t; await pg.waitForTimeout(250); }
    for (const [name, scheme, attr] of SCOPES) {
      await pg.emulateMedia({ colorScheme: scheme });
      await pg.evaluate((a) => { if (a) document.documentElement.dataset.theme = a; else delete document.documentElement.dataset.theme; }, attr);
      await pg.mouse.move(600, 600);
      await pg.waitForTimeout(350);
      const ruhig = await messen();
      await pg.hover('#probe-btnp');
      await pg.waitForTimeout(450);
      const hover = await messen();
      const ok = hover.ratio >= HOVER_MIN && ruhig.ratio >= HOVER_MIN;
      if (ok) console.log(`    ✓ ${t} · ${name}: ruhig ${ruhig.ratio.toFixed(1)}:1, Hover ${hover.ratio.toFixed(1)}:1`);
      else { console.log(`    ✗ ${t} · ${name}: ruhig ${ruhig.ratio.toFixed(2)}:1 (${ruhig.fg} auf ${ruhig.bg}), Hover ${hover.ratio.toFixed(2)}:1 (${hover.fg} auf ${hover.bg})`); problems++; }
    }
  }
  await pg.screenshot({ path: join(shots, 'primaer-hover.png'), clip: { x: 0, y: 0, width: 300, height: 160 } });
  await pg.close();
}
if (process.argv.includes('--nur-hover')) {   // Auswahl-Schalter: nur diese Prüfung
  try { await primaerHover(); } finally { await browser.close().catch(() => {}); if (server) server.close(); for (const st of stops) await st().catch(() => {}); }
  console.log(problems ? `\n${problems} Problem(e).\n` : '\nHover-Prüfung grün.\n');
  process.exit(problems ? 1 : 0);
}

for (const pg of PAGES) {
  const v = pg.key || 'app';
  const page = await seite({ viewport: { width: 1600, height: 950 } });
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

  await check('Schrift in Kopfzeile, Schiene, Legende, Fußzeile hält 3:1 (hell)', async () => {
    const bad = await kontrastFehler(page, v + '/hell');
    return bad.length ? bad.slice(0, 8).join(' | ') : true;
  });

  // Dunkelmodus
  const dark = await seite({ viewport: { width: 1600, height: 950 }, colorScheme: 'dark' });
  await dark.goto(pg.url);
  await dark.waitForTimeout(700);
  if (pg.theme) { await themeAn(dark, pg.theme); await dark.waitForTimeout(300); }
  if (pg.app && await dark.locator('#dlg').isVisible()) {
    await festivalMitDaten(dark, 'Prüfprojekt');
    await dark.waitForTimeout(900);
  }
  await dark.screenshot({ path: join(shots, `${v}-dark.png`) });
  {
    const bad = await kontrastFehler(dark, v + '/dunkel');
    if (bad.length) { console.log('    ✗ Schrift in Kopfzeile, Schiene, Legende, Fußzeile hält 3:1 (dunkel): ' + bad.slice(0, 8).join(' | ')); problems++; }
    else console.log('    ✓ Schrift in Kopfzeile, Schiene, Legende, Fußzeile hält 3:1 (dunkel)');
  }
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
  const m = await seite({ viewport: { width: 390, height: 844 } });
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
  // Die Phase kommt mit dem Plan auf den Server (die App lädt von dort, ein Eingriff in die lokale Kopie wäre wirkungslos).
  const plan = planSeed('klassentreffen-festival.json').plan;
  const ende = new Date(plan.project.end);
  const fmt = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  (plan.phases ||= []).push({ id: 'ph-nach-ende', art: 'abbau', name: '', start: fmt(new Date(ende.getTime() + 10 * 86400000)), end: fmt(new Date(ende.getTime() + 12 * 86400000)) });
  const m = await seite({ viewport: { width: 1600, height: 950 } }, plan);
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
// Ziel: ≤ 300 px (vorher 285; seit Mehrbenutzer steht die Sende-Marke «✓ gesendet» im Studio-Theme in einer eigenen Zeile), ohne dass ein Bedienelement wegfällt. Themes überschreiben
// Kopfmaße (Titelgröße, Kennzahlen, Abstände), deshalb läuft es in jedem.
{
  console.log('\nHANDY-KOPF (390×844, alle Themes, Bauzeitenplan + Showablauf)');
  const HANDY_THEMES = ['callboard', ...THEMES];
  // Was je Modus sichtbar bleiben MUSS (Zoom-Gruppe gibt es nur im Bauzeitenplan).
  const MUSS = {
    bau: ['#tag-wahl', '[data-view="gantt"]', '[data-view="tabelle"]', '[data-view="bedarf"]', '#zoom-stufe', '#zout', '#zin', '#now', '#fold', '#undo', '#redo', '#live', '#suche', '#theme-toggle', '#drucken', '#sync-state'],
    show: ['#tag-wahl', '[data-ansicht="setup"]', '[data-ansicht="show"]', '[data-view="gantt"]', '[data-view="tabelle"]', '[data-view="bedarf"]', '#undo', '#redo', '#live', '#suche', '#theme-toggle', '#drucken', '#sync-state'],
  };
  for (const t of HANDY_THEMES) for (const modus of ['bau', 'show']) {
    const m = await seite({ viewport: { width: 390, height: 844 } }, 'klassentreffen-festival.json');
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
    await mc('Kopf ≤ 300 px', async () => {
      const h = await m.evaluate(() => Math.round(document.querySelector('.hd').getBoundingClientRect().bottom));
      return h <= 300 ? true : `Kopf ${h} px hoch`;
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
        if (s !== '#sync-state' && r.height < 39.5) return s + ' nur ' + Math.round(r.height) + ' px hoch';
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
// .claude/rules/tabelle-einrichten.md sagt: 16 im Bauzeitenplan, 14 im Showablauf — gemessen als sichtbare
// button/input/select in .hd-bar (Klassentreffen, ohne Live, ohne offenen
// Konflikt). Eine Zahl, die kein Werkzeug prüft, ist eine Zahl, die lügt.
// Desktop UND Handy müssen dieselbe Zahl liefern: nichts fällt weg, nichts kommt dazu.
{
  console.log('\nBEDIENELEMENTE (sichtbare button/input/select in .hd-bar)');
  const SOLL = { bau: 17, show: 15 };   // inkl. #sync-state (Button seit Mehrbenutzer; war #save-state, ein Text)
  for (const [w, h] of [[1600, 950], [390, 844]]) for (const modus of ['bau', 'show']) {
    const m = await seite({ viewport: { width: w, height: h } }, 'klassentreffen-festival.json');
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

await primaerHover();

} finally {
  await browser.close().catch(() => {});
  if (server) server.close();
  for (const st of stops) await st().catch(() => {});
}
console.log(problems ? `\n${problems} Problem(e) gefunden.\n` : `\nAlle Prüfungen bestanden (${PAGES.length} Seiten).\n`);
process.exit(problems ? 1 : 0);
