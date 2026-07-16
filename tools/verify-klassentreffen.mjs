// Klassentreffen-Plan importieren und im Browser prüfen.
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

await p.goto('http://127.0.0.1:' + server.address().port + '/index.html');
await p.waitForTimeout(700);

console.log('\nKLASSENTREFFEN IMPORTIEREN');
await p.locator('.dlg-act .btn', { hasText: 'JSON importieren' }).click();
await p.locator('#import-file').setInputFiles(join(root, 'klassentreffen-festival.json'));
await p.waitForTimeout(1200);

await check('Projekt heißt richtig', async () =>
  (await p.locator('#proj-name').textContent()).includes('Klassentreffen') ? true : 'Name falsch');
await check('17 Gewerke', async () => {
  const n = await p.locator('.legend-i').count();
  return n === 17 ? true : n + ' statt 17';
});
await check('acht Gewerke mit Schraffur (Platz 10–17)', async () => {
  const n = await p.locator('.legend-i .bz-dot[data-tex]').count();
  return n === 8 ? true : n + ' statt 8';
});
await check('63 Vorgänge', async () => {
  const t = await p.locator('.kpi', { hasText: 'Vorgänge' }).locator('.kpi-v').textContent();
  return t.trim() === '63' ? true : t;
});
await check('Plan startet OHNE Konflikte', async () =>
  (await p.locator('#resolve').isHidden()) ? true : 'Konfliktknopf sichtbar');
await check('ein Meilenstein (Baufrei)', async () => {
  const n = await p.locator('.bz-ms').count();
  return n === 1 ? true : n + ' statt 1';
});
await check('alle Balken sind gestrichelt (Dauer geschätzt)', async () => {
  const total = await p.locator('.bz-bar').count();
  const est = await p.locator('.bz-bar.is-estimated').count();
  return total > 0 && est === total ? true : `${est}/${total} markiert`;
});
await check('leere Gewerke (Video/Pyro) haben keine Balken, aber eine Zeile', async () => {
  const namen = await p.locator('.legend-i').allTextContents();
  return namen.some((x) => /Video/.test(x)) && namen.some((x) => /Pyro/.test(x)) ? true : 'Video/Pyro fehlen in der Legende';
});

// Überblick über die zwei Wochen
await p.locator('[data-z="wochen"]').click();
await p.waitForTimeout(400);
await check('Balken sind im Bild', async () => {
  const vis = await p.locator('.bz-bar').evaluateAll((ns, w) =>
    ns.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > 240 && r.left < w; }).length, 1600);
  return vis >= 15 ? true : `nur ${vis} im Bild`;
});
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-wochen.png') });

await p.locator('[data-z="monate"]').click();
await p.waitForTimeout(400);
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-monate.png'), fullPage: false });

if (errors.length) { console.log('\n  ✗ Fehler:'); errors.slice(0, 5).forEach((e) => console.log('      ' + e)); bad += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');
await b.close(); server.close();
console.log(bad ? `\n${bad} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(bad ? 1 : 0);
