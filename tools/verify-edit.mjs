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
// Zahl der reinen Farbtöne aus der Quelle lesen, nicht raten: Schraffur ist der
// zweite Kanal und beginnt bei Platz HUES (0-basiert). HUES wuchs 8→9→10 — ein
// hart verdrahtetes «9. Gewerk» rostet bei jeder Palette-Erweiterung fest.
const HUES = Number((/export const HUES\s*=\s*(\d+)/.exec(readFileSync(join(root, 'js/palette.js'), 'utf8')) || [])[1]);
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
await check('Konflikt-Knopf öffnet die Prüf-Liste MIT dem Konflikt (nicht blind lösen)', async () => {
  await page.locator('#resolve').click();
  await page.waitForTimeout(300);
  return (await page.locator('.rv-row.is-conflict').count()) >= 1 ? true : 'kein Konflikt in der Liste';
});
await page.screenshot({ path: join(here, 'shots', 'edit-4b-pruefliste.png') });
await check('«Ist ok» hakt den Konflikt ab — der Konflikt-Knopf verschwindet', async () => {
  await page.locator('.rv-row.is-conflict .rv-acts .btn', { hasText: 'Ist ok' }).first().click();
  await page.waitForTimeout(400);
  if (await page.locator('.rv-row.is-conflict').count() !== 0) return 'Konflikt noch in der Liste';
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return (await page.locator('#resolve').isHidden()) ? true : 'Konfliktknopf noch da';
});
await check('⌘Z nimmt das Abhaken zurück (Konflikt wieder da)', async () => {
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
  return !(await page.locator('#resolve').isHidden()) ? true : 'Konflikt nicht zurück';
});
await page.keyboard.press('Meta+z');  // auch das Vorziehen zurück
await page.waitForTimeout(400);

console.log('\nPRÜF-LISTE: KRITISCH');
await check('«kritisch»-Kachel öffnet die Liste mit kritischen Vorgängen', async () => {
  await page.locator('[data-kpi="kritisch"]').click();
  await page.waitForTimeout(300);
  return (await page.locator('.rv-sec-kritisch .rv-row').count()) >= 1 ? true : 'keine kritischen Vorgänge in der Liste';
});
await page.screenshot({ path: join(here, 'shots', 'edit-4c-kritisch.png') });
await check('«Gesehen» senkt die kritisch-Zahl; ⌘Z bringt sie zurück', async () => {
  const before = Number(await page.locator('[data-kpi="kritisch"] .kpi-v').textContent());
  await page.locator('.rv-sec-kritisch .rv-row .btn', { hasText: 'Gesehen' }).first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const after = Number(await page.locator('[data-kpi="kritisch"] .kpi-v').textContent());
  if (!(after < before)) return `kritisch nicht gesunken (${before} → ${after})`;
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
  const back = Number(await page.locator('[data-kpi="kritisch"] .kpi-v').textContent());
  return back === before ? true : `⌘Z hat kritisch nicht zurückgeholt (${after} → ${back})`;
});
await check('«Zeigen» springt zum Vorgang und wählt ihn im Gantt aus', async () => {
  await page.locator('[data-kpi="kritisch"]').click();
  await page.waitForTimeout(300);
  await page.locator('.rv-sec-kritisch .rv-row .btn', { hasText: 'Zeigen' }).first().click();
  await page.waitForTimeout(500);
  if ((await page.locator('.rv-body').count()) !== 0) return 'Prüf-Liste blieb offen';
  return (await page.locator('.bz-lab.is-sel, .bz-bar.is-sel, .bz-ms.is-sel').count()) >= 1 ? true : 'nichts ausgewählt';
});

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

console.log(`\nGEWERK ${HUES + 1}–${2 * HUES} (Schraffur als zweiter Kanal)`);
await check(`das ${HUES + 1}. Gewerk (Platz ${HUES}) bekommt Schraffur`, async () => {
  // Die ersten HUES Plätze (0…HUES-1) sind reine Farbtöne; erst Platz HUES
  // trägt zusätzlich 45°-Schraffur. So viele Gewerke anlegen, bis genau Platz
  // HUES besetzt ist — dann muss es GENAU EINEN schraffierten Punkt geben.
  // Der Store lehnt Namensdubletten ab, deshalb jedes Mal ein eigener Name.
  const start = await page.locator('.legend-i').count();
  for (let slot = start; slot <= HUES; slot++) {
    await page.evaluate((name) => { window.prompt = () => name; }, 'Extra-Gewerk ' + slot);
    await page.locator('#add-gewerk').click();
    await page.waitForTimeout(250);
  }
  const n = await page.locator('.legend-i .bz-dot[data-tex]').count();
  return n === 1 ? true : `${n} schraffierte Punkte (erwartet 1 bei Platz ${HUES})`;
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

console.log('\nVERKNÜPFUNGS-SUCHE');
let firstCand = '';
await check('Suchfeld: Unsinn zeigt „nichts", ein Teilstring filtert die Treffer', async () => {
  const s = page.locator('.ins-dep-search');
  await s.click();
  await page.waitForTimeout(200);
  const all = await page.locator('.ins-dep-opt').count();
  if (all < 2) return `zu wenige Kandidaten (${all})`;
  firstCand = (await page.locator('.ins-dep-opt-n').first().textContent()).trim();
  await s.fill('zzzqxnope');
  await page.waitForTimeout(200);
  if (await page.locator('.ins-dep-opt').count() !== 0) return 'Unsinns-Query zeigt trotzdem Treffer';
  if (await page.locator('.ins-dep-none').count() !== 1) return 'kein „Nichts gefunden"';
  await s.fill(firstCand.slice(0, 4));
  await page.waitForTimeout(200);
  const some = await page.locator('.ins-dep-opt').count();
  return (some >= 1 && some <= all) ? true : `Filter unplausibel (${all} → ${some})`;
});
await page.screenshot({ path: join(here, 'shots', 'edit-6b-verkn-suche.png') });
await check('Treffer wählen legt die Verknüpfung an (oder lehnt einen Ring ab)', async () => {
  const before = await page.locator('.ins-deps .ins-dep').count();
  await page.locator('.ins-dep-opt').first().click();   // mousedown-Handler wählt
  await page.waitForTimeout(400);
  const after = await page.locator('.ins-deps .ins-dep').count();
  const ring = await page.locator('.toast[data-kind="bad"]').isVisible().catch(() => false);
  return (after > before || ring) ? true : 'Klick auf einen Treffer bewirkte nichts';
});

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
  // Die Tagesansicht zieht GENAU EINEN Kalendertag auf die Breite (volle
  // Tagesansicht) — sichtbar sind also nur die Balken des Aufbau-Tags, nicht
  // «möglichst viele». Richtig positioniert ist die Ansicht, wenn die ersten
  // Aufbau-Vorgänge im Bild stehen und nicht Wochen daneben in der Planung.
  const r = await page.locator('.bz-bar').evaluateAll((ns, w) => {
    const vis = ns.filter((n) => { const b = n.getBoundingClientRect(); return b.width > 0 && b.right > 240 && b.left < w; });
    const AUFBAU = /Anlieferung Bühnenteile|Podest & Unterbau|Dach & Traversentürme/;
    return { count: vis.length, all: ns.length,
      hatAufbau: vis.some((n) => AUFBAU.test(n.querySelector('.bz-bar-t')?.textContent || '')) };
  }, 1600);
  return r.hatAufbau ? true
    : `Aufbau-Vorgänge nicht im Bild (${r.count} von ${r.all} Balken sichtbar) — Ansicht steht nicht beim Aufbau`;
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

console.log('\nPANEL-SICHTBARKEIT');
await check('Panel bleibt in der Tabellen-Ansicht zu, auch nach einer Änderung', async () => {
  // Regression: vier Stellen schrieben #ins.hidden, und inspector.render()
  // kannte die Ansicht nicht — jede Änderung holte das Panel zurück.
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(300);
  await page.locator('.bz-bar').first().click();       // Auswahl setzen
  await page.waitForTimeout(300);
  if (await page.locator('#ins').isHidden()) return 'Panel öffnet im Gantt gar nicht';
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(400);
  if (!(await page.locator('#ins').isHidden())) return 'Panel bleibt beim Wechsel offen';
  const t = page.locator('.tb-r .c-title input').first();
  await t.fill('Änderung in der Tabelle');
  await t.blur();
  await page.waitForTimeout(600);
  return (await page.locator('#ins').isHidden()) ? true : 'Panel poppt nach einer Änderung auf';
});
await check('zurück im Gantt ist das Panel wieder da', async () => {
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(400);
  return (await page.locator('#ins').isVisible()) ? true : 'Panel bleibt weg';
});

console.log('\nGESCHÄTZTE DAUER');
await check('echte Dauer eintippen räumt die Schätzung ab', async () => {
  // Sonst bleibt der Balken gestrichelt, obwohl die Zahl feststeht — und nach
  // drei Korrekturen weiß niemand mehr, was noch geraten ist.
  const id = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.bz-bar.is-estimated')][0];
    return b ? b.closest('.bz-track').previousSibling : null;
  });
  // Vorgang über das Panel schätzen lassen und dann korrigieren
  await page.locator('.bz-bar').first().click();
  await page.waitForTimeout(300);
  const hk = page.locator('.ins-check', { hasText: 'Dauer geschätzt' }).locator('input');
  if (!(await hk.isChecked())) await hk.check();
  await page.waitForTimeout(400);
  const du = page.locator('.ins-f', { hasText: 'Dauer' }).locator('input').first();
  await du.fill('3h');
  await du.blur();
  await page.waitForTimeout(500);
  const noch = await page.locator('.ins-check', { hasText: 'Dauer geschätzt' }).locator('input').isChecked();
  return !noch ? true : 'Häkchen bleibt gesetzt — der Balken bleibt gestrichelt';
});
await check('das Häkchen lässt sich weiterhin von Hand setzen', async () => {
  const hk = page.locator('.ins-check', { hasText: 'Dauer geschätzt' }).locator('input');
  await hk.check();
  await page.waitForTimeout(400);
  return (await hk.isChecked()) ? true : 'lässt sich nicht mehr setzen';
});

console.log('\nGEWERKE UMSORTIEREN PER DRAG (Tabelle)');
await check('Gewerk ganz nach oben ziehen — Farbe bleibt, ⌘Z zurück', async () => {
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(400);
  const names = () => page.locator('.tb-group[data-gewerk] .tb-gname').allTextContents();
  const before = await names();
  if (before.length < 2) return 'zu wenige Gewerke: ' + before.length;
  const lastName = before[before.length - 1];
  const lastDot = page.locator('.tb-group[data-gewerk]').last().locator('.bz-dot');
  const colorBefore = await lastDot.evaluate((n) => getComputedStyle(n).backgroundColor);

  // Pointer-Sequenz direkt auslösen: Playwrights synthetische Maus erzeugt in
  // Firefox nicht zuverlässig Pointer-Events. Echte Browser tun das sehr wohl —
  // hier geht es nur darum, dieselben Handler deterministisch zu treffen.
  await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.tb-group[data-gewerk]')];
    const handle = groups[groups.length - 1].querySelector('.tb-drag');
    const root = document.querySelector('.tb');
    const hb = handle.getBoundingClientRect();
    const fb = groups[0].getBoundingClientRect();
    const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type,
      { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, button: 0, pointerType: 'mouse', isPrimary: true }));
    fire(handle, 'pointerdown', hb.x + hb.width / 2, hb.y + hb.height / 2);
    fire(root, 'pointermove', fb.x + 30, fb.y + 3);   // knapp unter die Oberkante der ersten Zeile
    fire(root, 'pointerup', fb.x + 30, fb.y + 3);
  });
  await page.waitForTimeout(400);

  const after = await names();
  if (after[0] !== lastName) return `«${lastName}» sollte oben stehen, oben ist «${after[0]}»`;
  // Der Farbplatz (slot) darf NICHT mitwandern — Farbe gehört dem Gewerk.
  const colorAfter = await page.locator('.tb-group[data-gewerk]').first().locator('.bz-dot')
    .evaluate((n) => getComputedStyle(n).backgroundColor);
  if (colorAfter !== colorBefore) return `Farbe hat sich beim Sortieren geändert: ${colorBefore} → ${colorAfter}`;

  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
  const undone = await names();
  if (undone.join('|') !== before.join('|')) return '⌘Z hat die Reihenfolge nicht zurückgeholt';
  return true;
});

console.log('\nGLEICHE REIHENFOLGE (Gantt == Tabelle, nach Start)');
// Vorgänge eines Gewerks stehen in BEIDEN Ansichten nach Startzeit — aus einer
// Quelle (byStart). Vier echte Fehler sind hier früher durch die Prüfung
// gerutscht; diese vergleicht die tatsächliche Reihenfolge beider Ansichten.
const firstGroupOrder = {
  // Gantt: side-Labels sind eine flache Liste (Gruppe, Task, Task, Gruppe …).
  gantt: () => page.evaluate(() => {
    const labs = [...document.querySelectorAll('#bz .bz-side .bz-lab')];
    const out = []; let started = false;
    for (const l of labs) {
      if (l.dataset.gewerk != null) { if (started) break; started = true; continue; }
      if (started && l.dataset.task != null) out.push((l.querySelector('.bz-lab-name')?.textContent || '').trim());
    }
    return out;
  }),
  // Tabelle: Gruppenkopf, dann Vorgangszeilen bis zum nächsten Kopf.
  table: () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#tb tbody tr')];
    const titles = []; const starts = []; let started = false;
    for (const r of rows) {
      if (r.classList.contains('tb-group')) { if (started) break; started = true; continue; }
      if (!started) continue;
      if (r.classList.contains('tb-empty')) break;
      if (r.classList.contains('tb-r')) {
        titles.push((r.querySelector('.c-title input')?.value || '').trim());
        starts.push(r.querySelector('.c-start input')?.value || '');
      }
    }
    return { titles, starts };
  }),
};
await check('Gantt- und Tabellen-Reihenfolge des ersten Gewerks sind identisch', async () => {
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(300);
  const g = await firstGroupOrder.gantt();
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(300);
  const { titles: t } = await firstGroupOrder.table();
  if (!g.length || !t.length) return `leere Reihenfolge (Gantt ${g.length}, Tabelle ${t.length})`;
  if (g.join('|') !== t.join('|')) return `verschieden:\n        Gantt:   ${g.join(' · ')}\n        Tabelle: ${t.join(' · ')}`;
  return true;
});
await check('Reihenfolge ist nach Startzeit sortiert (08:00 vor 08:05)', async () => {
  const { starts } = await firstGroupOrder.table();   // ISO-Strings sind lexikografisch sortierbar
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] < starts[i - 1]) return `nicht aufsteigend: ${starts[i - 1]} vor ${starts[i]}`;
  }
  return true;
});

console.log('\nUNTERVORGÄNGE');
await page.locator('[data-view="tabelle"]').click();
await page.waitForTimeout(300);
const subParentId = await page.locator('#tb tr.tb-r').first().getAttribute('data-id');
await check('«+↳» legt einen eingerückten Untervorgang an; Eltern-Zeit ist schreibgeschützt', async () => {
  await page.locator(`#tb tr[data-id="${subParentId}"] .tb-subadd`).click();
  await page.waitForTimeout(400);
  if (await page.locator('#tb tr.tb-r.is-child').count() < 1) return 'kein Kind angelegt';
  if (await page.locator(`#tb tr[data-id="${subParentId}"] .tb-tog`).count() < 1) return 'Elternzeile ohne Klapp-Pfeil';
  if (!(await page.locator(`#tb tr[data-id="${subParentId}"] .c-start input`).isDisabled())) return 'Eltern-Start nicht schreibgeschützt';
  return true;
});
await page.screenshot({ path: join(here, 'shots', 'edit-8-sub-table.png') });
await check('Einklappen verbirgt die Untervorgänge, Ausklappen zeigt sie wieder', async () => {
  await page.locator(`#tb tr[data-id="${subParentId}"] .tb-tog`).click();
  await page.waitForTimeout(300);
  if (await page.locator('#tb tr.tb-r.is-child').count() !== 0) return 'eingeklappt, Kind noch sichtbar';
  await page.locator(`#tb tr[data-id="${subParentId}"] .tb-tog`).click();
  await page.waitForTimeout(300);
  return (await page.locator('#tb tr.tb-r.is-child').count()) >= 1 ? true : 'ausgeklappt, Kind fehlt';
});
await check('Eltern-Hülle deckt den Untervorgang (Start ≤ Kindstart)', async () => {
  const pStart = await page.locator(`#tb tr[data-id="${subParentId}"] .c-start input`).inputValue();
  const kStart = await page.locator('#tb tr.tb-r.is-child .c-start input').first().inputValue();
  return pStart <= kStart ? true : `Eltern-Start ${pStart} > Kindstart ${kStart}`;
});
// Datum des Elternvorgangs merken, um im Gantt gezielt dorthin zu navigieren.
const subDay = (await page.locator(`#tb tr[data-id="${subParentId}"] .c-start input`).inputValue()).slice(0, 10);
await check('Gantt zeigt den Elternvorgang als Sammelbalken mit eingerückter Unterzeile', async () => {
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(400);
  if (await page.locator('.bz-bar.is-summary').count() < 1) return 'kein Sammelbalken';
  if (await page.locator('.bz-side .bz-lab.is-child').count() < 1) return 'keine eingerückte Unterzeile';
  return true;
});
// Zum Tag des Elternvorgangs springen, damit der Sammelbalken im Bild ist —
// Screenshots ansehen, nicht nur Häkchen zählen (CLAUDE.md).
await page.fill('#date-jump', subDay);
await page.locator('#date-jump').dispatchEvent('change');
await page.waitForTimeout(400);
await page.screenshot({ path: join(here, 'shots', 'edit-9-sub-gantt.png') });

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
