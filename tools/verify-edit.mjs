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

await page.goto(BASE + '/index.html?plan=leer');
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
  // «+ Gewerk» steht im Einrichten-Fenster, Reiter «Gewerke & Bühnen».
  await page.locator('#rail-ein').click();
  await page.waitForTimeout(200);
  await page.locator('[data-ein="baender"]').click();
  await page.waitForTimeout(150);
  for (let slot = start; slot <= HUES; slot++) {
    // Eigener Kasten statt window.prompt — Name tippen, «Anlegen» klicken.
    await page.locator('#add-gewerk').click();
    await page.waitForTimeout(150);
    await page.locator('.tb-neuart-n').fill('Extra-Gewerk ' + slot);
    await page.locator('.tb-neuart-a .btn-p').click();
    await page.waitForTimeout(250);
  }
  await page.locator('#ein-zu').click();
  await page.waitForTimeout(200);
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

console.log('\nTASTATUR AUF DEN BALKEN');
// Balken und Rauten tragen tabIndex 0, sind also mit Tab erreichbar. Bis v0.9.6
// hing dort aber nur ein click-Handler: wer hingesprungen war, kam mit keiner
// Taste weiter — fokussierbar ohne Auslöser ist eine Sackgasse.
const titelVon = (i) => page.locator('.bz-bar').nth(i).locator('.bz-bar-t').textContent();
await check('Enter auf einem fokussierten Balken wählt ihn aus', async () => {
  await page.locator('.bz-bar').first().click();          // Ausgangsauswahl
  await page.waitForTimeout(250);
  const soll = (await titelVon(2)).trim();
  await page.locator('.bz-bar').nth(2).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const ist = (await page.locator('.ins-title').textContent()).trim();
  return ist === soll ? true : `Panel zeigt «${ist}» statt «${soll}»`;
});
await check('Leertaste wählt ebenfalls aus — und scrollt die Seite nicht', async () => {
  const soll = (await titelVon(1)).trim();
  const vorher = await page.evaluate(() => window.scrollY);
  await page.locator('.bz-bar').nth(1).focus();
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  const ist = (await page.locator('.ins-title').textContent()).trim();
  if (ist !== soll) return `Panel zeigt «${ist}» statt «${soll}»`;
  const nachher = await page.evaluate(() => window.scrollY);
  return nachher === vorher ? true : `Space hat gescrollt (${vorher} → ${nachher}) — preventDefault fehlt`;
});
await check('auch die Meilenstein-Raute ist mit Tab erreichbar', async () => {
  const n = await page.locator('.bz-ms').count();
  if (!n) return 'kein Meilenstein im Plan — Prüfung greift ins Leere';
  const ohne = await page.evaluate(() =>
    [...document.querySelectorAll('.bz-ms')].filter((d) => d.tabIndex !== 0).length);
  return ohne === 0 ? true : `${ohne} von ${n} Rauten ohne tabIndex`;
});

console.log('\nDUPLIZIEREN SAGT, WAS FEHLT');
await check('Duplizieren meldet, dass die Kopie ohne Verknüpfungen dasteht', async () => {
  // deps liegen in state.deps, die Kopie erbt sie also nicht. Das sieht man dem
  // Balken nicht an — ohne Meldung wartet man auf eine Kette, die nie kommt.
  await page.locator('.bz-bar').first().click({ button: 'right' });
  await page.waitForTimeout(300);
  const eintrag = page.locator('.mn-i', { hasText: 'Duplizieren' });
  if (!(await eintrag.count())) return 'kein «Duplizieren» im Menü';
  await eintrag.click();
  await page.waitForTimeout(400);
  if (await page.locator('#toast').isHidden()) return 'kein Toast';
  const t = await page.locator('#toast').textContent();
  return /Verknüpfungen/i.test(t) ? true : 'Toast schweigt zu den Verknüpfungen: ' + t;
});
await check('die Kopie steht im Plan und ist ausgewählt', async () => {
  const ist = (await page.locator('.ins-title').textContent()).trim();
  return /\(Kopie\)$/.test(ist) ? true : `Panel zeigt «${ist}», nicht die Kopie`;
});
await page.screenshot({ path: join(here, 'shots', 'edit-6b-tastatur-duplikat.png') });
await page.evaluate(() => document.getElementById('toast').hidden = true);

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

console.log('\nVERKNÜPFEN PER ZIEHEN (der Gantt ist die Ansicht für Pfeile)');
const pfeile = () => page.locator('path.bz-dep').count();
// Der Griff steht NEBEN dem Balken (wie .bz-slack) und ist 2 px breit, 0 hoch —
// sein Mittelpunkt liegt auf der Oberkante. getBoundingClientRect statt
// boundingBox(): der Griff ist bei opacity 0 trotzdem treffbar, aber Playwright
// wartete sonst auf «sichtbar».
const griffPunkt = (id) => page.locator(`.bz-link[data-link-from="${id}"]`).first()
  .evaluate((n) => { const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top }; });
// Eine Quelle suchen, deren Griff wirklich im Bild steht — und sie notfalls
// hinscrollen. Blind den ersten Balken zu nehmen schlug fehl: an dieser Stelle
// im Lauf ist der Gantt längst gezoomt und verschoben, und das Ende des ersten
// Balkens liegt dann weit außerhalb. Die Maus drückte ins Leere.
// Nutzbarer Bereich: links steht die Gewerk-Spalte, rechts das Panel.
const RAND = { l: 330, r: 390, t: 140, b: 140 };
// Der linke Rand muss die GEWERK-SPALTE freihalten: sie klebt sticky über dem
// Canvas, und ein dorthin geklemmter Zielpunkt liegt auf ihr statt auf dem
// Balken. Die 330 px waren dafür gerechnet, dass die Spalte am Fensterrand
// beginnt — seit der Schiene tut sie das nicht mehr, und der Punkt landete
// mitten in den Gewerknamen. Also fragen statt raten.
RAND.l = await page.evaluate(() =>
  Math.ceil(document.querySelector('.bz-side').getBoundingClientRect().right) + 34);

// Der Griff eines Vorgangs, ins Bild geholt. Blind den ersten Balken zu nehmen
// schlug fehl: an dieser Stelle im Lauf ist der Gantt längst gezoomt und
// verschoben, und das Ende des ersten Balkens liegt weit außerhalb — die Maus
// drückte dann ins Leere.
const imBild = (tid, m) => page.evaluate(([id, m]) => {
  const h = document.querySelector(`.bz-link[data-link-from="${id}"]`);
  if (!h) return false;
  h.scrollIntoView({ block: 'center', inline: 'center' });
  const r = h.getBoundingClientRect();
  return r.left > m.l && r.left < innerWidth - m.r
    && r.top > m.t && r.top < innerHeight - m.b;
}, [tid, m || RAND]);

async function waehleQuelle(ab = 0) {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.bz-bar[data-task]')].map((b) => b.dataset.task));
  for (let i = ab; i < Math.min(ids.length, 40); i++) {
    if (await imBild(ids[i])) return ids[i];
  }
  return null;
}

// Ein zulässiges Ziel mit anklickbarem Punkt. Der Balken muss NICHT ganz
// sichtbar sein — bei diesem Zoom sind viele breiter als der Ausschnitt. Der
// Punkt wird in den sichtbaren Streifen geklemmt und muss dort auf dem Balken
// liegen.
const zielImBild = () => page.evaluate((m) => {
  const L = m.l, R = innerWidth - m.r, T = m.t, B = innerHeight - m.b;
  const alle = [...document.querySelectorAll('.bz-bar.is-link-ok')];
  for (const b of alle) {
    const r = b.getBoundingClientRect();
    const y = r.top + r.height / 2;
    if (y < T || y > B) continue;
    const x = Math.max(L, Math.min(R, r.left + r.width / 2));
    if (x < r.left || x > r.right) continue;
    return { id: b.dataset.task, x, y };
  }
  return { fehler: alle.length + ' zulaessige Ziele, keines mit Punkt im Bild' };
}, RAND);

// Zieht vom Griff los und bleibt mit gedrückter Maus stehen — erst dann stehen
// die Markierungen im DOM und der Test weiß, welches Ziel die App zulässt.
async function zieheLos(id) {
  const p = await griffPunkt(id);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 26, p.y, { steps: 4 });
  await page.waitForTimeout(120);
}

await check('der Griff steht nicht dauerhaft im Bild, sondern erscheint beim Hinsehen', async () => {
  const ids = [await waehleQuelle()];
  if (!ids[0]) return 'kein Balken mit sichtbarem Griff gefunden';
  const g = page.locator(`.bz-link[data-link-from="${ids[0]}"]`).first();
  const o = await g.evaluate((n) => getComputedStyle(n).opacity);
  if (o !== '0') return `dauerhaft sichtbar (opacity ${o}) — bei 153 Zeilen wären das 153 Punkte`;
  await page.locator(`.bz-bar[data-task="${ids[0]}"]`).first().hover();
  await page.waitForTimeout(250);
  const o2 = await g.evaluate((n) => getComputedStyle(n).opacity);
  return o2 === '1' ? true : `beim Hover immer noch opacity ${o2}`;
});

let vonId = null, nachId = null, neuerDep = null;
await check('Ziehen vom Griff auf ein zulässiges Ziel legt eine Verknüpfung an', async () => {
  const vorher = await pfeile();
  vonId = await waehleQuelle();
  if (!vonId) return 'kein Balken mit sichtbarem Griff gefunden';
  await zieheLos(vonId);
  const z = await zielImBild();
  if (!z || z.fehler) { await page.mouse.up(); return z ? z.fehler : 'kein zulässiges Ziel markiert'; }
  nachId = z.id;
  await page.mouse.move(z.x, z.y, { steps: 6 });
  await page.waitForTimeout(150);
  const geist = await page.locator('.bz-dep-ghost').count();
  const markiert = await page.locator('.bz-bar.is-link-target').count();
  // Mitten in der Geste festhalten: Gummiband, gültige und gesperrte Ziele.
  await page.screenshot({ path: join(here, 'shots', 'edit-8-ziehen.png') });
  await page.mouse.up();
  await page.waitForTimeout(400);
  if (!geist) return 'kein Gummiband während des Ziehens';
  if (!markiert) return 'das Ziel unter dem Zeiger war nicht hervorgehoben';
  const nachher = await pfeile();
  if (nachher !== vorher + 1) return `${vorher} → ${nachher} Pfeile statt +1`;
  const kind = (await page.locator('.ins-kind').textContent()).trim();
  if (kind !== 'Verknüpfung') return `Panel zeigt «${kind}» statt der neuen Verknüpfung`;
  neuerDep = await page.locator('path.bz-dep.is-sel').getAttribute('data-dep');
  return neuerDep ? true : 'der neue Pfeil ist nicht als ausgewählt markiert';
});

await check('nach dem Ziehen räumt die App restlos auf', async () => {
  const r = await page.evaluate(() => ({
    geist: document.querySelectorAll('.bz-dep-ghost').length,
    marken: document.querySelectorAll('.is-link-ok, .is-link-no, .is-link-from, .is-link-target').length,
    flag: document.querySelector('.bz').hasAttribute('data-linking'),
  }));
  if (r.geist) return 'Gummiband bleibt stehen';
  if (r.marken) return `${r.marken} Markierungen bleiben stehen`;
  return r.flag ? 'data-linking bleibt gesetzt' : true;
});

await check('was einen Ring ergäbe, ist gesperrt — der Store sagt nicht erst hinterher nein', async () => {
  // Eben wurde vonId → nachId angelegt. Zieht man jetzt von nachId aus, muss
  // vonId gesperrt sein: nachId → vonId liefe im Kreis.
  if (!(await imBild(nachId))) return 'der Nachfolger liegt nicht im Bild';
  await zieheLos(nachId);
  const gesperrt = await page.locator(`.bz-bar[data-task="${vonId}"].is-link-no`).count();
  const faelschlichOk = await page.locator(`.bz-bar[data-task="${vonId}"].is-link-ok`).count();
  const selbst = await page.locator(`.bz-bar[data-task="${nachId}"].is-link-ok`).count();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(200);
  if (faelschlichOk) return 'der Vorgänger ist als gültiges Ziel markiert — das gäbe einen Ring';
  if (selbst) return 'der Ausgangsbalken ist als gültiges Ziel markiert — das wäre eine Selbstverknüpfung';
  return gesperrt ? true : 'der Vorgänger ist gar nicht markiert';
});

await check('Escape bricht ab: keine Verknüpfung, keine Reste', async () => {
  const vorher = await pfeile();
  const q = await waehleQuelle(2);
  if (!q) return 'kein Balken mit sichtbarem Griff gefunden';
  await zieheLos(q);
  const z = await zielImBild();
  if (z && !z.fehler) await page.mouse.move(z.x, z.y, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(300);
  if (await pfeile() !== vorher) return 'Escape hat trotzdem verknüpft';
  const reste = await page.evaluate(() =>
    document.querySelectorAll('.bz-dep-ghost, .is-link-ok, .is-link-no, .is-link-from').length);
  return reste === 0 ? true : `${reste} Reste nach dem Abbruch`;
});

console.log('\nPFEILE SIND ANKLICKBAR');
// Auf die LINIE klicken, nicht in die Mitte des umschließenden Rechtecks: der
// Pfad ist L-förmig, und `pointer-events: stroke` trifft nur die Linie selbst.
// Gesucht wird der erste Pfeil mit einem Punkt, der im Bild liegt UND an dem
// elementFromPoint wirklich diesen Pfad meldet — das prüft die Trefferfläche,
// statt sie mit dispatchEvent zu umgehen. Welcher Pfeil es ist, spielt keine
// Rolle; auf einen bestimmten zu zielen scheiterte daran, dass er zwischen zwei
// weit auseinander liegenden Balken verlief und komplett außerhalb war.
const freierPfeil = () => page.evaluate((m) => {
  const L = m.l, R = innerWidth - m.r, T = m.t, B = innerHeight - m.b;
  const alle = [...document.querySelectorAll('path.bz-dep-hit')];
  for (const n of alle) {
    const ctm = n.getScreenCTM();
    if (!ctm) continue;
    const len = n.getTotalLength();
    if (!len) continue;
    for (let f = 0.1; f <= 0.9; f += 0.1) {
      const q = n.getPointAtLength(len * f);
      const s = new DOMPoint(q.x, q.y).matrixTransform(ctm);
      if (s.x < L || s.x > R || s.y < T || s.y > B) continue;
      if (document.elementFromPoint(s.x, s.y) !== n) continue;
      return { dep: n.dataset.dep, x: s.x, y: s.y };
    }
  }
  return { fehler: alle.length + ' Pfeile, keiner mit freiem Punkt im Bild' };
}, RAND);

await check('Klick auf die Linie wählt die Verknüpfung aus', async () => {
  const p = await freierPfeil();
  if (p.fehler) return p.fehler;
  const vorher = (await page.locator('.ins-kind').count())
    ? (await page.locator('.ins-kind').textContent()).trim() : '';
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(350);
  const kind = (await page.locator('.ins-kind').textContent()).trim();
  if (kind !== 'Verknüpfung') return `Panel zeigt «${kind}» (vorher «${vorher}»)`;
  const n = await page.locator('path.bz-dep.is-sel').count();
  if (n !== 1) return `${n} Pfeile gleichzeitig als ausgewählt markiert`;
  const gewaehlt = await page.locator('path.bz-dep.is-sel').getAttribute('data-dep');
  return gewaehlt === p.dep ? true : 'es wurde ein anderer Pfeil ausgewählt als angeklickt';
});
await check('das Panel nennt beide Vorgänge und lässt Typ und Versatz ändern', async () => {
  const t = await page.locator('#ins').textContent();
  if (!/von/.test(t) || !/nach/.test(t)) return 'Richtung wird nicht benannt: ' + t.slice(0, 90);
  if (!(await page.locator('.ins-dep-t').count())) return 'keine Typ-Auswahl';
  return (await page.locator('.ins-dep-l').count()) ? true : 'kein Feld für den Versatz';
});
await page.screenshot({ path: join(here, 'shots', 'edit-9-pfeil-gewaehlt.png') });
await check('Entf entfernt die ausgewählte Verknüpfung, ⌘Z holt sie zurück', async () => {
  const vorher = await pfeile();
  await page.keyboard.press('Delete');
  await page.waitForTimeout(400);
  const weg = await pfeile();
  if (weg !== vorher - 1) return `${vorher} → ${weg} statt −1`;
  if (!(await page.locator('#ins').isHidden())) return 'das Panel zeigt noch die gelöschte Verknüpfung';
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
  const zurueck = await pfeile();
  return zurueck === vorher ? true : `⌘Z bringt ${zurueck} statt ${vorher}`;
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
  // Projekt/Export/Import/+Gewerk stehen auf der Einrichten-Seite, nicht mehr
  // in der Arbeitsleiste (siehe "Ansicht | Einrichten" oben im Kopf).
  await page.locator('#rail-ein').click();
  await page.waitForTimeout(200);
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
  // Zurück zur Arbeitsleiste — sonst steht der Gantt hinter «Einrichten» und
  // jeder .bz-bar hat eine leere Bounding-Box.
  await page.locator('#ein-zu').click();
  await page.waitForTimeout(300);
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
  await page.locator('#rail-ein').click();
  await page.waitForTimeout(200);
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('#export').click()]);
  const n = dl.suggestedFilename();
  return n.endsWith('.json') ? true : 'Dateiname: ' + n;
});

// ── Bedienkonzept: die Schiene ──────────────────────────────────────────────
// Der ganze Umbau von v0.12.0 hat EIN Versprechen: man sieht nur, was im
// aktiven Modus etwas bedeutet, und der andere Modus ist einen Klick weit.
// Diese vier Prüfungen halten genau das fest.
console.log('\nBEDIENKONZEPT (Schiene + Einrichten-Fenster)');

await check('Einrichten schließen — der Plan steht unverändert dahinter', async () => {
  // Das Fenster ist vom Export-Test her noch offen.
  const bzVorher = await page.locator('#bz').isVisible();
  await page.screenshot({ path: join(here, 'shots', 'edit-10-einrichten.png') });
  if (!bzVorher) return 'der Gantt ist hinter dem Fenster verschwunden — dann wäre es wieder eine Seite';
  const links = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  await page.locator('#ein-zu').click();
  await page.waitForTimeout(400);
  if (!(await page.locator('#ein-dlg').isHidden())) return 'das Fenster bleibt offen';
  const danach = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  return Math.abs(danach - links) < 2 ? true
    : 'der Ausschnitt ist um ' + Math.round(danach - links) + ' px gesprungen';
});

await check('im Bauzeitenplan steht nichts vom Showablauf', async () => {
  await page.locator('.rail-m:not(.rail-ein)').first().click();
  await page.waitForTimeout(700);
  if (await page.locator('#seg-abschnitt').isVisible()) return 'Setup/Show steht im Bauzeitenplan';
  if (await page.locator('#buehnen').isVisible()) return 'die Bühnen-Häkchen stehen im Bauzeitenplan';
  // …und die Zeitwerkzeuge, die hierher gehören, stehen sehr wohl da.
  return await page.locator('#zoom-stufe').isVisible() ? true : 'die Zoomstufe fehlt im Bauzeitenplan';
});

await check('beide Modi und das Zahnrad bleiben sichtbar, auch bei vielen Tagen', async () => {
  // Die Bautage füllten die Schiene und schoben «Showablauf» und «Einrichten»
  // unter den Rand — im Screenshot gesehen, von keiner Zusicherung bemerkt.
  // Scrollen darf nur die Tagesliste, nie die Schiene als Ganzes.
  const n = await page.locator('.rail-t').count();
  if (n < 5) return 'nur ' + n + ' Bautage — die Prüfung sagt so nichts aus';
  for (const sel of ['.rail-m:not(.rail-ein)', '#rail-ein']) {
    const drin = await page.locator(sel).last().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight + 1;
    });
    if (!drin) return sel + ' liegt außerhalb des Fensters';
  }
  return true;
});

await check('ein Klick auf einen Bautag bewegt die Achse wirklich', async () => {
  const tage = page.locator('.rail-t');
  const vorher = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  await tage.first().click();
  await page.waitForTimeout(500);
  const erst = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  await tage.last().click();
  await page.waitForTimeout(500);
  const letzt = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  if (erst === letzt) return 'erster und letzter Tag führen zur selben Position (' + erst + ')';
  const an = await page.locator('.rail-t[aria-pressed="true"]').count();
  if (an !== 1) return an + ' Tage markiert';
  return vorher !== undefined ? true : 'kein Ausgangswert';
});
await page.screenshot({ path: join(here, 'shots', 'edit-11-schiene.png') });

if (errors.length) { console.log('\n  ✗ Fehler auf der Seite:'); errors.slice(0, 8).forEach((e) => console.log('      ' + e)); problems += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');

await browser.close();
server.close();
console.log(problems ? `\n${problems} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(problems ? 1 : 0);
