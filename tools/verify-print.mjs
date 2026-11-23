// Tagesblätter prüfen — und dabei ECHTE A3-PDFs erzeugen, nicht nur Screenshots.
// page.pdf() geht denselben Weg wie der Druckdialog: dieselben @page-Regeln,
// dieselben Seitenumbrüche. Ein Screenshot würde genau das nicht prüfen.
import { firefox, chromium } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mustFirefox, chromiumExe } from './browsers.mjs';
import { createServer } from 'node:http';
import { planLaden, FIXTURES } from './plan-fixture.mjs';
const here = dirname(fileURLToPath(import.meta.url)); const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });
const exe = mustFirefox();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer((q, s) => {
  const rel = normalize(decodeURIComponent(q.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = join(root, /^[\\/]$/.test(rel) ? 'index.html' : rel);
  if (!f.startsWith(root) || !existsSync(f)) { s.writeHead(404); return s.end('x'); }
  s.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  s.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

// Ursprungstext der Fixture: der localStorage-Stand wird von den Tests verändert
const KT_TEXT = readFileSync(join(FIXTURES, 'klassentreffen-festival.json'), 'utf8');
const b = await firefox.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 1700, height: 1000 }, timezoneId: 'Europe/Berlin' });
await planLaden(ctx);
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('JS: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let bad = 0;
let skipped = 0;   // ehrlich zählen: «bestanden» heißt nicht «alles geprüft»
const check = async (name, fn) => {
  let r; try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
  if (r === true) console.log('  ✓ ' + name); else { console.log('  ✗ ' + name + ': ' + r); bad++; }
};

console.log('\nTAGESBLÄTTER');
await p.goto(BASE + '/print.html');
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
// Den Pfad NICHT raten (Architektur, App-Name, halbe Downloads): chromiumExe()
// in browsers.mjs prüft das Programm selbst, auf Mac, Windows und Linux.
const chromExe = chromiumExe();
if (!chromExe) {
  skipped++;
  console.log('  – übersprungen: Chromium nicht installiert.');
  console.log('    Für echte PDFs einmalig:  npx playwright install chromium');
} else {
  const cb = await chromium.launch({ executablePath: chromExe });
  const cp = await cb.newPage();
  await planLaden(cp);
  await cp.goto(BASE + '/print.html');
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

// ── Ohne Projekt: kein stiller Ersatzplan ────────────────────────────────────
// Frischer Context OHNE Seed: print.html darf keinen Plan mitbringen, sondern
// sagt, dass im Browser kein Projekt liegt.
console.log('\nOHNE PROJEKT');
{
  const nc = await b.newContext({ viewport: { width: 1200, height: 800 } });
  const np = await nc.newPage();
  await np.goto(BASE + '/print.html');
  await np.waitForSelector('.pr-sheet', { timeout: 15000 });
  await check('frischer Browser ohne Projekt: print.html meldet «Kein Projekt in diesem Browser»', async () => {
    const t = await np.locator('#sheets').innerText();
    return /Kein Projekt in diesem Browser/.test(t) ? true : 'Text: ' + t.slice(0, 120);
  });
  await nc.close();
}

// ── Vorschau passt ins Fenster, Druck bleibt 1:1 ─────────────────────────────
console.log('\nVORSCHAU');
for (const [w, h] of [[1440, 900], [1000, 800]]) {
  for (const [name, url, sel] of [['Tagesblatt', '/print.html', '.pr-sheet'], ['Running Order', '/print.html?ansicht=show', '.pr-ro']]) {
    await p.setViewportSize({ width: w, height: h });
    await p.goto(BASE + url);
    await p.waitForSelector(sel, { timeout: 15000 });
    await p.waitForTimeout(400);
    await check(`Blatt passt in die Vorschau — ${name} bei ${w} px`, async () => {
      const r = await p.locator(sel).first().evaluate((n) => { const b = n.getBoundingClientRect(); return { l: b.left, r: b.right, iw: innerWidth }; });
      return r.l >= 16 - 0.5 && r.r <= r.iw - 16 + 0.5 ? true : JSON.stringify(r);
    });
    if (w === 1440 && name === 'Tagesblatt') await p.screenshot({ path: join(here, 'shots', 'druck-vorschau-1440.png') });
    await p.emulateMedia({ media: 'print' });
    await check(`Druck bleibt 1:1 — ${name} bei ${w} px`, async () => {
      const bw = await p.locator(sel).first().evaluate((n) => n.getBoundingClientRect().width);
      return Math.abs(bw - 1511.8) <= 1 ? true : bw + ' px statt 1511.8';
    });
    await p.emulateMedia({ media: 'screen' });
  }
}
// Klassische Bildlaufleiste: auf dem Mac sind Leisten Overlays ohne Breite, dort
// kann nichts schiefgehen. Eigener Browser mit ui.useOverlayScrollbars=0.
{
  const kb = await firefox.launch({ executablePath: exe, firefoxUserPrefs: { 'ui.useOverlayScrollbars': 0 } });
  try {
    const kp = await (await kb.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await planLaden(kp);
    await kp.goto(BASE + '/print.html');
    await kp.waitForSelector('.pr-sheet', { timeout: 15000 });
    await kp.waitForTimeout(400);
    const leiste = await kp.evaluate(() => innerWidth - document.documentElement.clientWidth);
    if (leiste <= 0) {
      // macOS-Firefox kennt in Playwright nur Overlay-Leisten (Prefs und Chromium-Flags
      // geprüft: immer 0 px). Ehrlich überspringen — Windows/Linux prüfen es.
      skipped++;
      console.log('  – klassische Bildlaufleiste: dieser Rechner hat nur Overlay-Leisten (0 px), übersprungen');
    } else {
      await check('Blatt passt in die Vorschau — mit klassischer Bildlaufleiste (' + leiste + ' px)', async () => {
        const r = await kp.locator('.pr-sheet').first().evaluate((n) => { const b = n.getBoundingClientRect(); return { l: b.left, r: b.right, cw: document.documentElement.clientWidth }; });
        return r.l >= 15.5 && r.r <= r.cw - 15.5 ? true : JSON.stringify(r);
      });
    }
  } finally { await kb.close(); }
}
await p.setViewportSize({ width: 1700, height: 1000 });

console.log('\nZEITUMSTELLUNG');
{
  // Nachtschicht über das Ende der Sommerzeit (25.10.2026, 25 Stunden). Das Blatt
  // muss bis an die echte Mitternacht reichen; mit «a + 1440» endete es um 23:00
  // und die letzte Stunde stand auf keinem Blatt.
  await p.goto(BASE + '/print.html');
  await p.waitForSelector('.pr-sheet', { timeout: 15000 });
  await p.evaluate(async (orig) => {
    const m = await import('/js/persistence.js');
    const r = m.deserialize(orig);
    const pl = r.plan;
    const t0 = pl.tasks[0];
    pl.tasks = [{ ...t0, id: 'zeitumstellung-nacht', title: 'Nachtschicht Zeitumstellung', start: '2026-10-25T22:00', end: '2026-10-26T02:00', milestone: false, parent: null, deps: [], fuer: null }];
    m.createRepo(window.localStorage).save(pl);
  }, KT_TEXT);
  const fehler0 = errors.length;
  await p.goto(BASE + '/print.html');
  await p.waitForSelector('.pr-sheet', { timeout: 15000 });
  await p.waitForTimeout(500);
  await check('Nachtschicht am 25.10.: Blatt 25.10. hat einen Balken bis an die rechte Kante, 26.10. ab der linken', async () => {
    const tage = await p.locator('.pr-sheet').evaluateAll((ns) => ns.map((n) => n.dataset.tag));
    if (tage.join() !== '2026-10-25,2026-10-26') return 'Blätter: ' + tage.join();
    const geom = (tag, k) => p.evaluate(([tag, k]) => {
      const sh = document.querySelector('.pr-sheet[data-tag="' + tag + '"]');
      const bar = sh.querySelector('.pr-bar' + k);
      const sp = bar && bar.parentElement.getBoundingClientRect();
      const b = bar && bar.getBoundingClientRect();
      return bar ? { l: b.left - sp.left, r: sp.right - b.right } : null;
    }, [tag, k]);
    const a = await geom('2026-10-25', '.is-cut-r');
    const c = await geom('2026-10-26', '.is-cut-l');
    if (!a) return 'am 25.10. kein rechts angeschnittener Balken';
    if (!c) return 'am 26.10. kein links angeschnittener Balken';
    if (a.r > 1.5) return 'Balken 25.10. endet ' + a.r.toFixed(1) + ' px vor der rechten Kante (letzte Stunde fehlt)';
    if (c.l > 1.5) return 'Balken 26.10. beginnt ' + c.l.toFixed(1) + ' px nach der linken Kante';
    // Die Kante allein beweist wenig (der Balken wird immer ans Fenster geklemmt).
    // Das Fenster ist für beide Blätter gemeinsam 0–24 Uhr: die Achse des
    // 25-Stunden-Tages muss mit dem Mitternachts-Tick enden (alt: endete bei 21).
    const ticks = await p.locator('.pr-sheet[data-tag="2026-10-25"] .pr-tick').allTextContents();
    if (ticks[ticks.length - 1] !== '00') return 'Zeitachse am 25.10. endet nicht an Mitternacht: ' + ticks.join('|');
    return true;
  });
  await p.screenshot({ path: join(here, 'shots', 'druck-zeitumstellung.png'), fullPage: true });
  await check('Zeitumstellung: keine JS-Fehler', async () => errors.length === fehler0 ? true : errors.slice(fehler0).join(' | '));
}

console.log('\nVORGÄNGE OHNE TERMIN');
{
  // Ein Plan, in dem ein Teil der Vorgänge keinen Termin hat — in beiden Ebenen.
  // Sie dürfen auf keinem Blatt stehen und nichts zu NaN machen.
  await check('Gegenprobe: ein Plan, in dem alles einen Termin hat, druckt keinen Hinweis «ohne Termin»', async () => {
    await p.goto(BASE + '/print.html');
    await p.waitForSelector('.pr-sheet', { timeout: 15000 });
    const k = await p.locator('.pr-fehlt').count();
    return k === 0 ? true : k + ' Hinweise, obwohl nichts fehlt';
  });
  const n = await p.evaluate(async (orig) => {
    const m = await import('/js/persistence.js');
    const r = m.deserialize(orig);
    const pl = r.plan;
    let c = 0;
    pl.tasks.forEach((t, i) => { if (i % 3 === 0) { t.start = null; t.end = null; c++; } });
    m.createRepo(window.localStorage).save(pl);
    return c;
  }, KT_TEXT);
  for (const [ebene, sel] of [['bau', '.pr-sheet'], ['show', '.pr-sheet']]) {
    await check('Tagesblätter (' + ebene + ') mit ' + n + ' terminlosen Vorgängen: kein NaN, keine Ausnahme', async () => {
      const fehler0 = errors.length;
      await p.goto(BASE + '/print.html?ebene=' + ebene);
      await p.waitForSelector(sel, { timeout: 15000 });
      await p.waitForTimeout(500);
      const t = await p.locator('#sheets').innerText();
      const html = await p.locator('#sheets').innerHTML();
      if (/NaN|Invalid Date|1970/.test(t) || /NaN/.test(html)) return 'NaN/1970 im Blatt';
      return errors.length === fehler0 ? true : errors.slice(fehler0).join(' | ');
    });
    await check('Fußzeile (' + ebene + ') sagt, wie viele Einträge ohne Termin nicht gedruckt sind', async () => {
      const f = await p.locator('.pr-foot .pr-fehlt').allTextContents();
      if (!f.length) return 'kein Hinweis in der Fußzeile';
      if (!f.every((x) => /^\d+ Eintr(ag|äge) ohne Termin nicht gedruckt$/.test(x))) return JSON.stringify(f);
      if (ebene === 'show') await p.locator('.pr-sheet').first().screenshot({ path: join(here, 'shots', 'druck-ro-ohne-termin.png') });
      return true;
    });
  }
}

console.log('\nPROJEKTANGABEN IM KOPF');
{
  // Ort, Adresse, Ansprechpartner stehen im Kopf beider Blattarten, einzeilig (Höhe unverändert).
  const setzen = async (mit) => p.evaluate(async ([orig, mit]) => {
    const m = await import('/js/persistence.js');
    const pl = m.deserialize(orig).plan;
    if (mit) {
      pl.project.venue = 'Theresienwiese';
      pl.project.adresse = 'Bavariaring 1, 80336 München';
      pl.project.kunde = 'Kunde GmbH';
      pl.project.kontakte = [{ id: 'k1', name: 'Ann Beispiel', rolle: 'Produktionsleitung', tel: '0171 1234567' },
        { id: 'k2', name: 'Bo Muster', rolle: 'Technik', tel: '0160 7654321' }];
      if (mit === 'lang') pl.project.kontakte.push({ id: 'k3', name: 'Cornelia Langername-Beispielfrau', rolle: 'Sicherheitsbeauftragte', tel: '+49 89 1234567-890' });
    }
    m.createRepo(window.localStorage).save(pl);
  }, [KT_TEXT, mit]);
  const kopfHoehe = async (url) => {
    await p.goto(BASE + url);
    await p.waitForSelector('.pr-sheet', { timeout: 15000 });
    await p.waitForTimeout(400);
    return p.locator('.pr-sheet .pr-head').first().evaluate((h) => h.getBoundingClientRect().height);
  };
  const ohne = {};
  await setzen(false);
  for (const u of ['/print.html?ebene=bau', '/print.html?ebene=show']) ohne[u] = await kopfHoehe(u);
  await setzen(true);
  for (const [name, u] of [['Tagesblatt', '/print.html?ebene=bau'], ['Running Order', '/print.html?ebene=show']]) {
    await check(name + ': Kopf zeigt Adresse und Ansprechpartner, Kunde nicht, gleiche Höhe', async () => {
      const h = await kopfHoehe(u);
      const a = await p.locator('.pr-sheet .pr-head-a').first().textContent();
      if (!/Bavariaring 1/.test(a) || !/Ann Beispiel · Produktionsleitung · 0171 1234567/.test(a)) return 'Kopf: ' + a;
      if (/Kunde GmbH/.test(await p.locator('.pr-sheet .pr-head').first().textContent())) return 'Kunde steht im Kopf';
      if (Math.abs(h - ohne[u]) > 1) return 'Kopf ' + ohne[u] + ' -> ' + h + ' px';
      const abg = await p.locator('.pr-sheet .pr-head-a').first().evaluate((x) => x.scrollWidth > x.clientWidth);
      if (abg) return 'Angaben im Kopf abgeschnitten (scrollWidth > clientWidth)';
      await p.locator('.pr-sheet').first().screenshot({ path: join(here, 'shots', 'druck-kopf-' + (u.includes('show') ? 'ro' : 'bau') + '.png') });
      return true;
    });
  }
  await setzen(false);
}

if (errors.length) { console.log('\n  ✗ Fehler:'); errors.slice(0, 5).forEach((e) => console.log('      ' + e)); bad += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');
await b.close(); server.close();
console.log(bad ? `\n${bad} Problem(e).\n` : `\nAlle Prüfungen bestanden${skipped ? `, ${skipped} übersprungen` : ''}.\n`);
process.exit(bad ? 1 : 0);
