// ── Bearbeiten im echten Browser prüfen ───────────────────────────────────────
// Die Unit-Tests decken die Logik ab. Hier geht es um das, was nur im Browser
// schiefgeht: Erststart, Dialog, Tippen, Speichern, Neuladen, Undo.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });
const cache = join(process.env.HOME, 'Library/Caches/ms-playwright');
const ff = readdirSync(cache).find((d) => d.startsWith('firefox-'));
const exe = join(cache, ff, 'firefox/Nightly.app/Contents/MacOS/firefox');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); return res.end('x'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
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

await page.goto(BASE + '/index.html');
await page.waitForTimeout(900);

console.log('\nERSTSTART');
await check('Projektdialog erscheint (kein Projekt vorhanden)', async () =>
  (await page.locator('#dlg').isVisible()) ? true : 'Dialog fehlt');
await check('alle fünf Vorlagen stehen zur Wahl', async () => {
  const n = await page.locator('.dlg-t').count();
  return n === 5 ? true : `${n} statt 5`;
});
await page.screenshot({ path: join(here, 'shots', 'edit-1-dialog.png') });

console.log('\nPROJEKT ANLEGEN');
await page.fill('.dlg-f:first-child input', 'Testprojekt Halle 7');
await page.fill('.dlg-f:nth-child(2) input', 'Messe Hannover');
await page.locator('.dlg-t[data-k="festival"]').click();
await page.locator('.dlg-act .btn-p').click();
await page.waitForTimeout(900);

await check('Dialog geschlossen', async () => !(await page.locator('#dlg').isVisible()) ? true : 'noch offen');
await check('Projektname steht im Kopf', async () =>
  (await page.locator('#proj-name').textContent()) === 'Testprojekt Halle 7' ? true : 'falscher Name');
await check('Gantt zeigt Balken', async () => {
  const n = await page.locator('.bz-bar').count();
  return n > 20 ? true : `nur ${n}`;
});
await check('Vorlage startet ohne Konflikte', async () =>
  (await page.locator('#resolve').isHidden()) ? true : 'Konfliktknopf sichtbar — die Vorlage ist nicht stimmig');
await check('als gesichert markiert', async () =>
  (await page.locator('#save-state').getAttribute('data-state')) === 'saved' ? true : 'nicht gesichert');
await page.screenshot({ path: join(here, 'shots', 'edit-2-gantt.png') });

console.log('\nTABELLE');
await page.locator('[data-view="tabelle"]').click();
await page.waitForTimeout(400);
await check('Tabelle zeigt Zeilen', async () => {
  const n = await page.locator('.tb-r').count();
  return n > 30 ? true : `nur ${n}`;
});
await check('Gantt ist ausgeblendet', async () => (await page.locator('#bz').isHidden()) ? true : 'noch sichtbar');
await page.screenshot({ path: join(here, 'shots', 'edit-3-tabelle.png') });

console.log('\nBEARBEITEN');
const firstTitle = page.locator('.tb-r .c-title input').first();
await check('Vorgang umbenennen wirkt', async () => {
  await firstTitle.fill('Umbenannt durch Test');
  await firstTitle.blur();
  await page.waitForTimeout(300);
  const v = await page.locator('.tb-r .c-title input').first().inputValue();
  return v === 'Umbenannt durch Test' ? true : 'Wert: ' + v;
});
await check('Änderung markiert als ungesichert, dann gesichert', async () => {
  await page.waitForTimeout(1200);
  const s = await page.locator('#save-state').getAttribute('data-state');
  return s === 'saved' ? true : 'Zustand: ' + s;
});
await check('Dauer-Kurzform «6h» wird übernommen', async () => {
  const d = page.locator('.tb-r .tb-dur').first();
  await d.fill('6h');
  await d.blur();
  await page.waitForTimeout(300);
  const v = await page.locator('.tb-r .tb-dur').first().inputValue();
  return v === '6h' ? true : 'Wert: ' + v;
});
await check('Unsinn als Dauer wird abgelehnt, alter Wert bleibt', async () => {
  const d = page.locator('.tb-r .tb-dur').first();
  await d.fill('bald mal');
  await d.blur();
  await page.waitForTimeout(300);
  const v = await page.locator('.tb-r .tb-dur').first().inputValue();
  return v === '6h' ? true : 'Wert: ' + v;
});
await check('EIN ⌘Z nimmt genau EINE Änderung zurück', async () => {
  // Regression: 'change' + 'blur' hatten jede Änderung doppelt eingebucht —
  // ein ⌘Z bewirkte scheinbar nichts.
  await page.keyboard.press('Meta+z');   // die Dauer 6h zurück
  await page.waitForTimeout(400);
  const d = await page.locator('.tb-r .tb-dur').first().inputValue();
  if (d === '6h') return 'ein ⌘Z reichte nicht — Befehl liegt doppelt auf dem Stapel';
  await page.keyboard.press('Meta+z');   // die Umbenennung zurück
  await page.waitForTimeout(400);
  const v = await page.locator('.tb-r .c-title input').first().inputValue();
  return v !== 'Umbenannt durch Test' ? true : 'Umbenennung nicht zurück: ' + v;
});
await check('neuen Vorgang anlegen', async () => {
  const before = await page.locator('.tb-r').count();
  await page.locator('.tb-add').first().click();
  await page.waitForTimeout(400);
  const after = await page.locator('.tb-r').count();
  return after === before + 1 ? true : `${before} → ${after}`;
});

console.log('\nKONFLIKTE');
await check('Start vorziehen erzeugt einen sichtbaren Konflikt', async () => {
  // «Podest & Unterbau» hängt an «Anlieferung Bühnenteile» — 3 Tage vorziehen.
  // Über die Eigenschaft suchen, nicht über das value-ATTRIBUT: das setzt die
  // App nie, ein Selektor darauf trifft also grundsätzlich nichts.
  const id = await page.evaluate(() => {
    const i = [...document.querySelectorAll('.tb-r .c-title input')].find((x) => x.value.includes('Podest'));
    return i ? i.closest('.tb-r').dataset.id : null;
  });
  if (!id) return 'Zeile «Podest» nicht gefunden';
  const row = page.locator(`.tb-r[data-id="${id}"]`);
  const start = row.locator('.c-start input');
  const v = await start.inputValue();
  const d = new Date(v); d.setDate(d.getDate() - 3);
  await start.fill(d.toISOString().slice(0, 16));
  await start.blur();
  await page.waitForTimeout(500);
  return !(await page.locator('#resolve').isHidden()) ? true : 'kein Konfliktknopf';
});
await page.screenshot({ path: join(here, 'shots', 'edit-4-konflikt.png') });
await check('«Konflikte auflösen» räumt auf', async () => {
  await page.locator('#resolve').click();
  await page.waitForTimeout(600);
  return (await page.locator('#resolve').isHidden()) ? true : 'noch Konflikte';
});
await check('⌘Z holt die Auflösung als Ganzes zurück', async () => {
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(500);
  return !(await page.locator('#resolve').isHidden()) ? true : 'Konflikt nicht zurück';
});
await page.keyboard.press('Meta+z');  // auch das Vorziehen zurück
await page.waitForTimeout(400);

console.log('\nDAUERHAFTIGKEIT');
await check('nach Neuladen ist das Projekt noch da', async () => {
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForTimeout(1000);
  const n = await page.locator('#proj-name').textContent();
  return n === 'Testprojekt Halle 7' ? true : 'Name nach Reload: ' + n;
});
await check('kein Projektdialog nach Neuladen', async () =>
  (await page.locator('#dlg').isHidden()) ? true : 'Dialog wieder da');
await check('Balken sind nach Neuladen wieder da', async () => {
  const n = await page.locator('.bz-bar').count();
  return n > 20 ? true : `nur ${n}`;
});

console.log('\nGEWERK 9–16 (Schraffur als zweiter Kanal)');
await check('9. Gewerk bekommt Schraffur', async () => {
  await page.evaluate(() => { window.__p = window.prompt; window.prompt = () => 'Security'; });
  await page.locator('#add-gewerk').click();
  await page.waitForTimeout(500);
  const n = await page.locator('.legend-i .bz-dot[data-tex]').count();
  return n === 1 ? true : `${n} schraffierte Punkte (erwartet 1)`;
});
await page.screenshot({ path: join(here, 'shots', 'edit-5-16gewerke.png') });

console.log('\nSEITENPANEL');
await page.locator('[data-view="gantt"]').click();
await page.waitForTimeout(400);
await check('Klick auf einen Balken öffnet das Panel', async () => {
  await page.locator('.bz-bar').first().click();
  await page.waitForTimeout(300);
  return (await page.locator('#ins').isVisible()) ? true : 'Panel bleibt zu';
});
await check('Panel zeigt den angeklickten Vorgang', async () => {
  const titel = await page.locator('.ins-title').textContent();
  const bar = await page.locator('.bz-bar').first().locator('.bz-bar-t').textContent();
  return titel.trim() === bar.trim() ? true : `Panel «${titel}» vs Balken «${bar}»`;
});
await check('Name im Panel ändern zieht in den Gantt durch', async () => {
  const f = page.locator('.ins-f', { hasText: 'Name' }).locator('input').first();
  await f.fill('Panel-Test');
  await f.blur();
  await page.waitForTimeout(400);
  const n = await page.evaluate(() => [...document.querySelectorAll('.bz-lab-name')].map((x) => x.textContent));
  return n.includes('Panel-Test') ? true : 'Gantt kennt den neuen Namen nicht';
});
await check('Panel zeigt Puffer bzw. kritischen Pfad', async () => {
  const t = await page.locator('.ins-f', { hasText: 'Puffer' }).textContent();
  return /Puffer|kritisch/i.test(t) ? true : 'kein Puffer im Panel: ' + t;
});
await check('Verknüpfungen stehen im Panel', async () =>
  (await page.locator('.ins-deps').count()) === 1 ? true : 'kein Verknüpfungsblock');
await page.screenshot({ path: join(here, 'shots', 'edit-6-panel.png') });

console.log('\nRECHTSKLICK-MENÜ');
await check('Rechtsklick auf ein Gewerk öffnet das Menü', async () => {
  await page.locator('.bz-lab-group').first().click({ button: 'right' });
  await page.waitForTimeout(300);
  return (await page.locator('.mn').isVisible()) ? true : 'kein Menü';
});
await check('Menü bietet Umbenennen, Sortieren und Löschen', async () => {
  const t = await page.locator('.mn').textContent();
  for (const w of ['Umbenennen', 'Nach oben', 'Nach unten', 'Löschen', 'Bearbeiten']) {
    if (!t.includes(w)) return 'fehlt: ' + w;
  }
  return true;
});
await page.screenshot({ path: join(here, 'shots', 'edit-7-menu.png') });
await check('«Nach oben» beim obersten Gewerk ist ausgegraut', async () => {
  const d = await page.locator('.mn-i', { hasText: 'Nach oben' }).isDisabled();
  return d ? true : 'anklickbar, obwohl es nicht geht';
});
await check('Escape schließt das Menü', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return (await page.locator('.mn').count()) === 0 ? true : 'Menü bleibt offen';
});
await check('Umsortieren ändert die Reihenfolge, DIE FARBEN BLEIBEN', async () => {
  const vorher = await page.evaluate(() => [...document.querySelectorAll('.bz-lab-group')]
    .map((n) => ({ name: n.querySelector('.bz-lab-name').textContent,
                   farbe: getComputedStyle(n.querySelector('.bz-dot')).backgroundColor })));
  await page.locator('.bz-lab-group').nth(1).click({ button: 'right' });
  await page.waitForTimeout(250);
  await page.locator('.mn-i', { hasText: 'Nach oben' }).click();
  await page.waitForTimeout(450);
  const nachher = await page.evaluate(() => [...document.querySelectorAll('.bz-lab-group')]
    .map((n) => ({ name: n.querySelector('.bz-lab-name').textContent,
                   farbe: getComputedStyle(n.querySelector('.bz-dot')).backgroundColor })));
  if (nachher[0].name !== vorher[1].name) return 'Reihenfolge nicht getauscht';
  const f = (arr, name) => (arr.find((x) => x.name === name) || {}).farbe;
  for (const v of vorher) {
    if (f(nachher, v.name) !== v.farbe) return `«${v.name}» hat die Farbe gewechselt — der Farbplatz muss stabil bleiben`;
  }
  return true;
});

console.log('\nUMBENENNEN PER DOPPELKLICK');
await check('Doppelklick auf einen Gewerknamen macht ein Eingabefeld', async () => {
  await page.locator('.bz-lab-group .bz-lab-name').first().dblclick();
  await page.waitForTimeout(250);
  return (await page.locator('.bz-lab-edit').count()) === 1 ? true : 'kein Eingabefeld';
});
await check('Enter übernimmt den neuen Namen', async () => {
  await page.locator('.bz-lab-edit').fill('Umbenannt');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const n = await page.locator('.bz-lab-group .bz-lab-name').first().textContent();
  return n === 'Umbenannt' ? true : 'Name: ' + n;
});
await check('Escape verwirft', async () => {
  await page.locator('.bz-lab-group .bz-lab-name').first().dblclick();
  await page.waitForTimeout(200);
  await page.locator('.bz-lab-edit').fill('Verworfen');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);
  const n = await page.locator('.bz-lab-group .bz-lab-name').first().textContent();
  return n === 'Umbenannt' ? true : 'Name wurde doch geändert: ' + n;
});

console.log('\nPROJEKTWECHSEL');
await check('zweites Projekt mit ganz anderem Zeitraum anlegen', async () => {
  await page.locator('#new-proj').click();
  await page.waitForTimeout(400);
  await page.fill('.dlg-f:first-child input', 'Weit weg 2027');
  await page.fill('.dlg-f:nth-child(3) input', '2027-03-15T06:00');
  await page.locator('.dlg-t[data-k="festival"]').click();
  await page.locator('.dlg-act .btn-p').click();
  await page.waitForTimeout(900);
  return (await page.locator('#proj-name').textContent()) === 'Weit weg 2027' ? true : 'nicht gewechselt';
});
await check('nach dem Wechsel steht die Ansicht beim AUFBAU, nicht irgendwo', async () => {
  // Pixel bedeuten nach einem Projektwechsel einen anderen Zeitpunkt: T0 ist
  // ein anderes Datum. Wer scrollLeft einfach behält, landet Wochen daneben.
  await page.locator('#proj-menu').click();
  await page.waitForTimeout(400);
  await page.locator('.dlg-open', { hasText: 'Testprojekt Halle 7' }).click();
  await page.waitForTimeout(1000);
  const vis = await page.locator('.bz-bar').evaluateAll((ns, w) =>
    ns.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > 240 && r.left < w; }).length, 1600);
  const all = await page.locator('.bz-bar').count();
  return vis >= 10 ? true : `nur ${vis} von ${all} Balken im Bild — die Ansicht steht nicht beim Aufbau`;
});
await check('nach dem Wechsel zeigt das Panel nichts Altes mehr', async () => {
  // Die Auswahl gehört zum alten Projekt und muss weg.
  return (await page.locator('#ins').isHidden()) ? true : 'Panel zeigt noch die alte Auswahl';
});
await check('das gewechselte Projekt ist danach das aktive', async () => {
  await page.reload();
  await page.waitForTimeout(900);
  const n = await page.locator('#proj-name').textContent();
  return n === 'Testprojekt Halle 7' ? true : 'nach Reload: ' + n;
});

console.log('\nEXPORT');
await check('Export lädt eine JSON-Datei herunter', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('#export').click()]);
  const n = dl.suggestedFilename();
  return n.endsWith('.json') ? true : 'Dateiname: ' + n;
});

if (errors.length) { console.log('\n  ✗ Fehler auf der Seite:'); errors.slice(0, 8).forEach((e) => console.log('      ' + e)); problems += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');

await browser.close();
server.close();
console.log(problems ? `\n${problems} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(problems ? 1 : 0);
