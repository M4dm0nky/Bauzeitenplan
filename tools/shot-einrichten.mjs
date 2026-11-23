// Screenshot der Einrichten-Seite in zwei Themes (dunkel/hell) — Sichtprüfung.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { mustFirefox } from './browsers.mjs';
import { planLaden } from './plan-fixture.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, /^[\\/]$/.test(rel) ? 'index.html' : rel);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); return res.end('x'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const browser = await firefox.launch({ executablePath: mustFirefox() });
try {
  for (const [theme, scheme] of [['console', 'dark'], ['studio', 'light']]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme, timezoneId: 'Europe/Berlin' });
    await planLaden(ctx, 'festival-mit-daten.json');
    const page = await ctx.newPage();
    await page.goto(BASE + '/index.html?plan=leer&ansicht=bau');
    await page.waitForSelector('.bz-t-major', { timeout: 20000 });
    await page.evaluate(async (t) => {
      const l = document.getElementById('theme-css');
      await new Promise((r) => { l.onload = r; l.href = 'styles/themes/' + t + '.css'; });
    }, theme);
    await page.waitForTimeout(300);
    await page.locator('#rail-ein').click();
    await page.waitForTimeout(300);
    await page.locator('#ein-kontakt-add').click();
    await page.locator('.ein-kontakt .k-name').fill('Ann Beispiel');
    await page.locator('.ein-kontakt .k-rolle').fill('Projektleitung');
    await page.keyboard.press('Tab');
    await page.screenshot({ path: join(here, 'shots', `einrichten-seite-${theme}-${scheme}.png`) });
    await page.locator('[data-ein="phasen"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(here, 'shots', `einrichten-zeitraum-${theme}-${scheme}.png`) });
    // Bereiche 3–5 und das Projektmenü
    for (const b of ['baender', 'res', 'arten']) {
      await page.locator(`[data-ein="${b}"]`).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(here, 'shots', `einrichten-${b}-${theme}-${scheme}.png`) });
    }
    await page.locator('#ein-zu').click();
    await page.locator('#proj-knopf').click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(here, 'shots', `proj-menue-${theme}-${scheme}.png`), clip: { x: 800, y: 0, width: 600, height: 300 } });
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
