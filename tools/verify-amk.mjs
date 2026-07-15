// AMK-Plan importieren und im Browser prüfen.
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
// Uhr auf den Aufbautag stellen, damit die Ansicht sinnvoll steht
const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
const p = await ctx.newPage();
await p.clock.install({ time: new Date('2026-07-17T09:40:00') });
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

console.log('\nAMK IMPORTIEREN');
await p.locator('.dlg-act .btn', { hasText: 'JSON importieren' }).click();
await p.locator('#import-file').setInputFiles(join(root, 'amk-singleshow.json'));
await p.waitForTimeout(1200);

await check('Projekt heißt richtig', async () =>
  (await p.locator('#proj-name').textContent()).includes('AnnenMayKantereit') ? true : 'Name falsch');
await check('8 Gewerke', async () => {
  const n = await p.locator('.legend-i').count();
  return n === 8 ? true : n + ' statt 8';
});
await check('kein Gewerk braucht Schraffur', async () => {
  const n = await p.locator('.legend-i .bz-dot[data-tex]').count();
  return n === 0 ? true : n + ' schraffierte';
});
await check('37 Vorgänge', async () => {
  const t = await p.locator('.kpi', { hasText: 'Vorgänge' }).locator('.kpi-v').textContent();
  return t.trim() === '37' ? true : t;
});
await check('Plan startet OHNE Konflikte', async () =>
  (await p.locator('#resolve').isHidden()) ? true : 'Konfliktknopf sichtbar');
await check('Balken sind sichtbar (Ansicht steht beim Aufbau)', async () => {
  const vis = await p.locator('.bz-bar').evaluateAll((ns, w) =>
    ns.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > 240 && r.left < w; }).length, 1600);
  return vis >= 8 ? true : `nur ${vis} im Bild`;
});
await check('geschätzte Balken sind gestrichelt markiert', async () => {
  const n = await p.locator('.bz-bar.is-estimated').count();
  return n >= 20 ? true : `nur ${n} markiert (erwartet 25)`;
});
await check('Vorgänge mit PDF-Zeiten sind NICHT markiert', async () => {
  const r = await p.evaluate(() => {
    const bar = [...document.querySelectorAll('.bz-bar')].find((n) =>
      (n.querySelector('.bz-bar-t') || {}).textContent === 'Aufbau LED Backwall');
    return bar ? bar.classList.contains('is-estimated') : 'nicht gefunden';
  });
  return r === false ? true : 'Aufbau LED Backwall ist als Schätzung markiert: ' + r;
});
await check('drei Meilensteine', async () => {
  const n = await p.locator('.bz-ms').count();
  return n === 3 ? true : n + ' statt 3';
});
await p.locator('[data-z="stunden"]').click();
await p.waitForTimeout(300);
await p.click('#now'); await p.waitForTimeout(500);
await p.screenshot({ path: join(here, 'shots', 'amk-aufbau.png') });

console.log('\nQUELLENTREUE IM BROWSER');
await check('Notiz enthält Ansprechpartner und Firma', async () => {
  const id = await p.evaluate(() => {
    const l = [...document.querySelectorAll('.bz-lab-name')].find((x) => x.textContent === 'Motoren LoadIn & Setup');
    return l ? l.closest('.bz-lab').dataset.task : null;
  });
  if (!id) return 'Vorgang nicht gefunden';
  await p.locator(`.bz-lab[data-task="${id}"]`).click();
  await p.waitForTimeout(400);
  const t = await p.locator('.ins-f', { hasText: 'Notiz' }).locator('textarea').inputValue();
  return /Jens/.test(t) && /BigRig/.test(t) ? true : 'Notiz: ' + t;
});
await check('Häkchen «Dauer geschätzt» ist gesetzt', async () => {
  const c = await p.locator('.ins-check', { hasText: 'Dauer geschätzt' }).locator('input').isChecked();
  return c ? true : 'nicht gesetzt';
});
await p.screenshot({ path: join(here, 'shots', 'amk-panel.png') });

console.log('\nDIE EINE VERKNÜPFUNG AUS DEM PDF');
await p.locator('[data-z="wochen"]').click(); await p.waitForTimeout(300);
await check('«Leitern runter» hat zwei Vorgänger', async () => {
  const id = await p.evaluate(() => {
    const l = [...document.querySelectorAll('.bz-lab-name')].find((x) => x.textContent === 'Leitern runter');
    return l ? l.closest('.bz-lab').dataset.task : null;
  });
  if (!id) return 'nicht gefunden';
  await p.locator(`.bz-lab[data-task="${id}"]`).click();
  await p.waitForTimeout(400);
  const t = await p.locator('.ins-deps').textContent();
  return /Laden an Dock/.test(t) && /Set weg/.test(t) ? true : 'Verknüpfungen: ' + t;
});
await p.screenshot({ path: join(here, 'shots', 'amk-abbau.png') });

if (errors.length) { console.log('\n  ✗ Fehler:'); errors.slice(0, 5).forEach((e) => console.log('      ' + e)); bad += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');
await b.close(); server.close();
console.log(bad ? `\n${bad} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(bad ? 1 : 0);
