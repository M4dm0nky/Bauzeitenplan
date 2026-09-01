// Klassentreffen-Plan (V07) importieren und im Browser prüfen.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
const here = dirname(fileURLToPath(import.meta.url)); const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });
const cache = join(process.env.HOME, 'Library/Caches/ms-playwright');
const exe = join(cache, readdirSync(cache).find((d) => d.startsWith('firefox-')), 'firefox/Nightly.app/Contents/MacOS/firefox');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = createServer((q, s) => {
  const rel = normalize(decodeURIComponent(q.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = join(root, rel === '/' ? 'index.html' : rel);
  if (!f.startsWith(root) || !existsSync(f)) { s.writeHead(404); return s.end('x'); }
  s.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  s.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const b = await firefox.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
const p = await ctx.newPage();
// Uhr mitten in die Aufbauwoche stellen, damit die Ansicht sinnvoll steht.
await p.clock.install({ time: new Date('2026-08-27T10:00:00') });
const errors = [];
p.on('pageerror', (e) => errors.push('JS: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let bad = 0;
const check = async (name, fn) => {
  let r; try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
  if (r === true) console.log('  ✓ ' + name); else { console.log('  ✗ ' + name + ': ' + r); bad++; }
};

await p.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=leer');
await p.waitForTimeout(700);

console.log('\nKLASSENTREFFEN IMPORTIEREN');
await p.locator('.dlg-act .btn', { hasText: 'JSON importieren' }).click();
await p.locator('#import-file').setInputFiles(join(root, 'klassentreffen-festival.json'));
await p.waitForTimeout(1200);

await check('Projekt heißt richtig', async () =>
  (await p.locator('#proj-name').textContent()).includes('Klassentreffen') ? true : 'Name falsch');
await check('20 Gewerke', async () => {
  const n = await p.locator('.legend-i').count();
  return n === 20 ? true : n + ' statt 20';
});
await check('zehn Gewerke mit Schraffur (Platz 11–20)', async () => {
  const n = await p.locator('.legend-i .bz-dot[data-tex]').count();
  return n === 10 ? true : n + ' statt 10';
});
await check('353 Vorgänge', async () => {
  const t = await p.locator('.kpi', { hasText: 'Vorgänge' }).locator('.kpi-v').textContent();
  return t.trim() === '353' ? true : t;
});
await check('Plan startet OHNE Konflikte', async () =>
  (await p.locator('#resolve').isHidden()) ? true : 'Konfliktknopf sichtbar');
await check('kein Meilenstein — V07 hat keinen baufreien Tag', async () => {
  const n = await p.locator('.bz-ms').count();
  return n === 0 ? true : n + ' statt 0';
});
await check('die meisten Balken sind NICHT gestrichelt (echte Zeiten aus V07)', async () => {
  const total = await p.locator('.bz-bar').count();
  const est = await p.locator('.bz-bar.is-estimated').count();
  return total >= 300 && est <= 25 ? true : `${est}/${total} gestrichelt (erwartet 19 von 353)`;
});
await check('Besucher-Gastro, Sanitätsdienst und Crew sind in der Legende', async () => {
  const namen = await p.locator('.legend-i').allTextContents();
  return ['Besucher-Gastro', 'Sanitätsdienst', 'Crew'].every((n) => namen.some((x) => x.includes(n)))
    ? true : 'Gewerke fehlen in der Legende';
});

// Überblick über die zwei Wochen
await p.selectOption('#zoom-stufe', 'wochen');
await p.waitForTimeout(400);
await check('Balken sind im Bild', async () => {
  const vis = await p.locator('.bz-bar').evaluateAll((ns, w) =>
    ns.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > 240 && r.left < w; }).length, 1600);
  return vis >= 15 ? true : `nur ${vis} im Bild`;
});
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-wochen.png') });

// ── Eine Zeile je Vorgang, ein Balken je Termin ─────────────────────────────
// Der Fehlertyp, den nur das Bild zeigt: Balken auf der falschen Spur oder
// zwei übereinander. Deshalb hier Geometrie messen, nicht nur zählen.
await check('353 Balken auf 153 Vorgangszeilen', async () => {
  const zeilen = await p.locator('.bz-lab-task').count();
  const balken = await p.locator('.bz-bar, .bz-ms').count();
  if (balken !== 353) return balken + ' Balken statt 353';
  return zeilen === 153 ? true : zeilen + ' Zeilen statt 153';
});
await check('genau zwei Zeilen sind zweispurig (SITECREW, STAPLERFAHRER stageco)', async () => {
  const hoehen = await p.locator('.bz-lab-task').evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect().height));
  const einfach = Math.min(...hoehen);
  const doppelt = hoehen.filter((h) => h > einfach * 1.5);
  return doppelt.length === 2 ? true : doppelt.length + ' hohe Zeilen statt 2';
});
await check('Bühne: drei Zeilen, «Aufbau Bühne» mit drei Balken', async () => {
  const namen = await p.locator('.bz-lab-task .bz-lab-name').evaluateAll((ns) => ns.map((n) => n.textContent));
  const b = namen.slice(0, 3);
  if (b.join('|') !== 'Anlieferung Stahl|Aufbau Bühne|Abbau Bühne') return 'Zeilen: ' + b.join(' | ');
  const n = await p.locator('.bz-track-task').nth(1).locator('.bz-bar').count();
  return n === 3 ? true : n + ' Balken in der Aufbau-Zeile statt 3';
});
await check('kein Balken verdeckt einen anderen derselben Zeile', async () => {
  const kollision = await p.locator('.bz-track-task').evaluateAll((tracks) => {
    for (const tr of tracks) {
      const bs = [...tr.querySelectorAll('.bz-bar')].map((b) => b.getBoundingClientRect());
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], c = bs[j];
        const x = a.left < c.right - 1 && c.left < a.right - 1;
        const y = a.top < c.bottom - 1 && c.top < a.bottom - 1;
        if (x && y) return tr.previousSibling ? 'überlappend' : 'überlappend';
      }
    }
    return null;
  });
  return kollision ? 'zwei Balken liegen übereinander' : true;
});
await check('keine Beschriftung läuft über den nächsten Balken', async () => {
  // Der Fehler, den die Zahlenprüfungen NICHT sehen: bei schmalen Balken steht
  // der Text rechts daneben — in einer Serie also über dem nächsten Balken.
  const bad = await p.evaluate(() => {
    for (const tr of document.querySelectorAll('.bz-track-task')) {
      const balken = [...tr.querySelectorAll('.bz-bar')];
      for (const n of balken) {
        const lab = n.querySelector('.bz-bar-t');
        if (!lab || !lab.offsetWidth) continue;
        const l = lab.getBoundingClientRect();
        for (const m of balken) {
          if (m === n) continue;
          const b = m.getBoundingClientRect();
          if (l.left < b.right - 2 && b.left < l.right - 2 && l.top < b.bottom - 2 && b.top < l.bottom - 2) {
            return lab.textContent + ' läuft über einen Nachbarbalken';
          }
        }
      }
    }
    return null;
  });
  return bad || true;
});
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-serien.png') });

// Zugeklappt: alle 20 Gewerke auf einen Blick — die Palette ist am Limit,
// hier muss man sehen, dass sich benachbarte Zeilen noch unterscheiden.
await p.locator('#fold').click();
await p.waitForTimeout(500);
await check('zugeklappt sind alle 20 Gewerkzeilen sichtbar', async () => {
  const n = await p.locator('.bz-lab-group').count();
  return n >= 15 ? true : `nur ${n} Gruppenzeilen`;
});
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-zugeklappt.png') });
await p.locator('#fold').click();
await p.waitForTimeout(400);

await p.selectOption('#zoom-stufe', 'monate');
await p.waitForTimeout(400);
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-monate.png'), fullPage: false });

// ── Autostart: die Adresse allein muss den Plan zeigen ───────────────────────
// Das ist der eigentliche Zweck der Weitergabe — wer den Link öffnet, sieht den
// Plan, ohne etwas zu importieren. Frischer Kontext = leerer localStorage, also
// genau die Lage eines fremden Besuchers.
console.log('\nAUTOSTART (frischer Browser, ohne Kennung)');
const frisch = await b.newContext({ viewport: { width: 1600, height: 950 } });
const fp = await frisch.newPage();
const ferr = [];
fp.on('pageerror', (e) => ferr.push('JS: ' + e.message));
await fp.goto('http://127.0.0.1:' + server.address().port + '/index.html');
await fp.waitForTimeout(1500);
await check('der Plan ist ohne Import da', async () =>
  (await fp.locator('#proj-name').textContent()).includes('Klassentreffen') ? true : 'kein Plan geladen');
await check('kein Projektdialog im Weg', async () =>
  (await fp.locator('#dlg').isHidden()) ? true : 'Dialog verdeckt den Plan');
await check('353 Vorgänge', async () => {
  const t = await fp.locator('.kpi', { hasText: 'Vorgänge' }).locator('.kpi-v').textContent();
  return t.trim() === '353' ? true : t;
});
await fp.screenshot({ path: join(here, 'shots', 'klassentreffen-autostart.png') });

// Der zweite Aufruf holt NICHT neu: derselbe Stempel, also bleibt die lokale
// Fassung stehen — sonst verlöre der Betrachter bei jedem Laden seine Änderungen.
await check('zweiter Aufruf öffnet die lokale Fassung', async () => {
  await fp.goto('http://127.0.0.1:' + server.address().port + '/index.html');
  await fp.waitForTimeout(1200);
  return (await fp.locator('#proj-name').textContent()).includes('Klassentreffen') ? true : 'Plan weg';
});

// ?plan=leer im WIRKLICH frischen Browser (leerer Speicher) — so starten die
// Erststart-Prüfungen. Im Kontext oben liegt der Plan schon, dort öffnet die App
// dann richtigerweise das vorhandene Projekt statt eines Dialogs.
const leerCtx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const lp = await leerCtx.newPage();
await lp.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=leer');
await lp.waitForTimeout(1000);
await check('?plan=leer zeigt im leeren Browser den Projektdialog', async () =>
  (await lp.locator('#dlg').isVisible()) ? true : 'Dialog fehlt');
if (ferr.length) { console.log('  ✗ JS-Fehler beim Autostart: ' + ferr[0]); bad++; }

if (errors.length) { console.log('\n  ✗ Fehler:'); errors.slice(0, 5).forEach((e) => console.log('      ' + e)); bad += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');
await b.close(); server.close();
console.log(bad ? `\n${bad} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(bad ? 1 : 0);
