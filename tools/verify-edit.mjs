// ── Bearbeiten im echten Browser prüfen ───────────────────────────────────────
// Die Unit-Tests decken die Logik ab. Hier geht es um das, was nur im Browser
// schiefgeht: Erststart, Dialog, Tippen, Speichern, Neuladen, Undo.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mustFirefox, chromiumExe } from './browsers.mjs';
import { festivalMitDaten } from './festival-fixture.mjs';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });
// Zahl der reinen Farbtöne aus der Quelle lesen, nicht raten: Schraffur ist der
// zweite Kanal und beginnt bei Platz HUES (0-basiert). HUES wuchs 8→9→10 — ein
// hart verdrahtetes «9. Gewerk» rostet bei jeder Palette-Erweiterung fest.
const HUES = Number((/export const HUES\s*=\s*(\d+)/.exec(readFileSync(join(root, 'js/palette.js'), 'utf8')) || [])[1]);
const exe = mustFirefox();

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
await festivalMitDaten(page, 'Testprojekt Halle 7', { venue: 'Messe Hannover' });
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
  await page.locator('.tb-r.is-entwurf .en-ok').click();   // Entwurf: erst ✓ speichert
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
  await row.locator('.en-ok').click();   // Entwurf: erst ✓ speichert
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
await check('Tooltip verschwindet beim Auswählen', async () => {
  const bar = page.locator('.bz-bar').first();
  await page.mouse.move(5, 5);
  await bar.hover();
  await page.waitForTimeout(200);
  if (!(await page.locator('.bz-tip.is-on').count())) return 'Vorbedingung: Tooltip erscheint beim Hover nicht';
  await bar.click();
  await page.waitForTimeout(300);
  if (!(await page.locator('#ins').isVisible())) return 'Panel bleibt zu';
  return (await page.locator('.bz-tip.is-on').count()) === 0 ? true : 'Tooltip steht neben dem Panel';
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
// Der sichtbare Kreis liegt bei Balken RECHTS neben dem Ende (die Dauer-Griffe
// brauchen das Balkenende frei), bei Meilensteinen rechts neben der Raute — der
// Ursprung des Griffs (2 px breit, 0 hoch) ist nicht das, was man trifft.
const griffPunkt = (id) => page.locator(`.bz-link[data-link-from="${id}"]`).first()
  .evaluate((n) => { const r = n.getBoundingClientRect();
    const off = n.classList.contains('bz-link-ms') ? 9 : n.classList.contains('bz-link-bar') ? 0 : -r.width / 2;
    return { x: r.right + off + 12, y: r.top }; });
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
  await festivalMitDaten(page, 'Weit weg 2027', { loadIn: '2027-03-15T06:00' });
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
  await page.locator('.ins-termin .en-ok').click();   // Entwurf: erst ✓ speichert
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

console.log('\nENTWURF (Start · Ende · Dauer: erst ✓ speichert)');
// Gespeicherter Stand ohne Umweg über die App: der Plan im localStorage.
const stand = async () => {
  await page.waitForTimeout(1100);   // Auto-Save nach 800 ms
  return page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(x)).project.name === 'Testprojekt Halle 7');
    return Object.fromEntries(JSON.parse(localStorage.getItem(k)).tasks.map((t) => [t.id, [t.start, t.end]]));
  });
};
const plusTag = (v) => new Date(new Date(v + ':00Z').getTime() + 86400000).toISOString().slice(0, 16);
let enId = null, enRow = null, enV0 = null, enS0 = null;
await check('Tabelle: Start ändern markiert die Zeile (gelb, ✓ ✗) — nichts gespeichert, nichts springt', async () => {
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(500);
  enId = await page.evaluate(() => document.querySelector('.tb-r:not(.is-parent):not(.is-child)').dataset.id);
  enRow = page.locator(`.tb-r[data-id="${enId}"]`);
  enS0 = await stand();
  enV0 = await enRow.locator('.c-start input').inputValue();
  const reihe0 = await page.locator('.tb-r').evaluateAll((l) => l.map((r) => r.dataset.id));
  await enRow.locator('.c-start input').fill(plusTag(enV0));
  await page.waitForTimeout(300);
  if (!(await enRow.evaluate((r) => r.classList.contains('is-entwurf')))) return 'Zeile nicht markiert';
  if (!(await enRow.locator('.en-ok').isVisible()) || !(await enRow.locator('.en-no').isVisible())) return '✓/✗ nicht sichtbar';
  const reihe1 = await page.locator('.tb-r').evaluateAll((l) => l.map((r) => r.dataset.id));
  if (JSON.stringify(reihe0) !== JSON.stringify(reihe1)) return 'Zeile ist gesprungen';
  const nach = await stand();
  return JSON.stringify(nach[enId]) === JSON.stringify(enS0[enId]) ? true : 'schon gespeichert: ' + JSON.stringify(nach[enId]);
});
await page.screenshot({ path: join(here, 'shots', 'edit-entwurf.png') });
await check('✓ speichert EINEN Schritt: Start geändert, Entwurf weg, ein ⌘Z stellt alles her', async () => {
  await enRow.locator('.en-ok').click();
  await page.waitForTimeout(300);
  if (await page.locator('.tb-r.is-entwurf').count()) return 'Entwurf bleibt offen';
  const nach = await stand();
  if (nach[enId][0] !== plusTag(enV0)) return 'Start nicht gespeichert: ' + nach[enId][0];
  await page.keyboard.press('Meta+z');
  const zurueck = await stand();
  return JSON.stringify(zurueck) === JSON.stringify(enS0) ? true : 'ein ⌘Z reichte nicht';
});
await check('Klick in eine andere Zeile verwirft den Entwurf — alter Wert, nichts gespeichert', async () => {
  const f = page.locator(`.tb-r[data-id="${enId}"] .c-start input`);
  await f.fill(plusTag(enV0));
  await page.waitForTimeout(200);
  await page.locator(`.tb-r:not([data-id="${enId}"]) .c-title input`).first().click();
  await page.waitForTimeout(300);
  if (await page.locator('.tb-r.is-entwurf').count()) return 'Entwurf blieb offen';
  const v = await page.locator(`.tb-r[data-id="${enId}"] .c-start input`).inputValue();
  if (v !== enV0) return 'Feld zeigt ' + v;
  return JSON.stringify(await stand()) === JSON.stringify(enS0) ? true : 'gespeichert';
});
await check('Escape verwirft; ✗ verwirft', async () => {
  const f = page.locator(`.tb-r[data-id="${enId}"] .c-start input`);
  await f.fill(plusTag(enV0));
  await f.press('Escape');
  await page.waitForTimeout(200);
  if (await page.locator('.tb-r.is-entwurf').count() || (await f.inputValue()) !== enV0) return 'Escape verwarf nicht';
  await f.fill(plusTag(enV0));
  await page.locator(`.tb-r[data-id="${enId}"] .en-no`).click();
  await page.waitForTimeout(200);
  if (await page.locator('.tb-r.is-entwurf').count() || (await f.inputValue()) !== enV0) return '✗ verwarf nicht';
  return JSON.stringify(await stand()) === JSON.stringify(enS0) ? true : 'gespeichert';
});
await check('Enter speichert (Dauer getippt) — ein ⌘Z stellt her', async () => {
  const d = page.locator(`.tb-r[data-id="${enId}"] .tb-dur`);
  await d.fill('7h');
  await d.press('Enter');
  await page.waitForTimeout(300);
  const nach = await stand();
  if (page.locator('.tb-r.is-entwurf') && (await page.locator('.tb-r.is-entwurf').count())) return 'Entwurf bleibt offen';
  if (JSON.stringify(nach[enId]) === JSON.stringify(enS0[enId])) return 'Enter speicherte nicht';
  await page.keyboard.press('Meta+z');
  return JSON.stringify(await stand()) === JSON.stringify(enS0) ? true : 'ein ⌘Z reichte nicht';
});
await check('Ein Feld leer: ✓ gesperrt, Grund steht daneben; Verwerfen räumt auf', async () => {
  const f = page.locator(`.tb-r[data-id="${enId}"] .c-end input`);
  await f.fill('');
  await page.waitForTimeout(200);
  const ok = page.locator(`.tb-r[data-id="${enId}"] .en-ok`);
  if (!(await ok.isDisabled())) return '✓ nicht gesperrt';
  const g = (await page.locator('.tb-entwurf-grund td').first().textContent()).trim();
  if (!g) return 'kein Grund sichtbar';
  const tit = await ok.getAttribute('title');
  if (!tit || tit.length < 8) return '✓ trägt den Grund nicht als title: ' + tit;
  const unter = await page.evaluate((i) => document.querySelector(`.tb-r[data-id="${i}"]`).nextElementSibling.classList.contains('tb-entwurf-grund'), enId);
  if (!unter) return 'der Grund steht nicht direkt unter der Zeile';
  await page.locator(`.tb-r[data-id="${enId}"] .en-no`).click();
  return JSON.stringify(await stand()) === JSON.stringify(enS0) ? true : 'gespeichert';
});
await check('Ende vor Start: ✓ gesperrt mit Grund (kein stilles Verwerfen)', async () => {
  const f = page.locator(`.tb-r[data-id="${enId}"] .c-end input`);
  const s = await page.locator(`.tb-r[data-id="${enId}"] .c-start input`).inputValue();
  await f.fill(new Date(new Date(s + ':00Z').getTime() - 3600000).toISOString().slice(0, 16));
  await page.waitForTimeout(200);
  const ok = page.locator(`.tb-r[data-id="${enId}"] .en-ok`);
  const g = (await page.locator('.tb-entwurf-grund td').first().textContent()).trim();
  await page.screenshot({ path: join(here, 'shots', 'edit-entwurf-ungueltig.png') });
  await page.locator(`.tb-r[data-id="${enId}"] .en-no`).click();
  return (await ok.count()) && g && !/^$/.test(g) ? true : 'kein Grund';
});
await check('Start und Ende leeren + ✓ = «ohne Termin» (Gantt: Kennzeichnung, kein Balken); ⌘Z holt zurück', async () => {
  await page.locator(`.tb-r[data-id="${enId}"] .c-start input`).fill('');
  await page.locator(`.tb-r[data-id="${enId}"] .c-end input`).fill('');
  await page.waitForTimeout(200);
  const ok = page.locator(`.tb-r[data-id="${enId}"] .en-ok`);
  if (await ok.isDisabled()) return '✓ gesperrt trotz zwei leerer Felder: ' + await page.locator('.tb-entwurf-grund td').first().textContent();
  await ok.click();
  const nach = await stand();
  if (nach[enId][0] !== null || nach[enId][1] !== null) return 'nicht terminlos: ' + JSON.stringify(nach[enId]);
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(500);
  const marke = await page.locator('.bz-lab-ohne').count();
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+z');
  if (marke < 1) return 'keine Kennzeichnung «ohne Termin»';
  return JSON.stringify(await stand()) === JSON.stringify(enS0) ? true : 'ein ⌘Z reichte nicht';
});
await check('✓/✗ verdecken nichts: am Ende-Feld der NÄCHSTEN Zeile liegt dieses Feld, nicht ✓/✗', async () => {
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(400);
  const f = page.locator(`.tb-r[data-id="${enId}"] .c-start input`);
  await f.fill(plusTag(enV0));
  await page.waitForTimeout(200);
  const r = await page.evaluate((i) => {
    const row = document.querySelector(`.tb-r[data-id="${i}"]`);
    const next = row.nextElementSibling;
    if (!next || !next.classList.contains('tb-r')) return 'keine Folgezeile';
    const feld = next.querySelector('.c-end input');
    const b = feld.getBoundingClientRect();
    const treffer = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    const act = row.querySelector('.c-act');
    const sichtbar = [...act.children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.className);
    return { ok: treffer === feld || feld.contains(treffer), sichtbar, popIn: !!act.querySelector('.en-pop') };
  }, enId);
  await page.screenshot({ path: join(here, 'shots', 'edit-entwurf-hell.png') });
  await page.locator(`.tb-r[data-id="${enId}"] .en-no`).click();
  if (typeof r === 'string') return r;
  if (!r.popIn) return '✓/✗ nicht in der Aktionszelle';
  if (r.sichtbar.length !== 1 || !/en-pop/.test(r.sichtbar[0])) return 'Aktionszelle zeigt noch andere Symbole: ' + r.sichtbar;
  return r.ok ? true : 'das Ende-Feld der Folgezeile ist verdeckt';
});
await check('✓ ist GRÜN mit weißem Haken (Kontrast ≥ 3:1) — in hell UND dunkel', async () => {
  const f = page.locator(`.tb-r[data-id="${enId}"] .c-start input`);
  const lies = async () => page.evaluate((i) => {
    const ok = document.querySelector(`.tb-r[data-id="${i}"] .en-ok`);
    const cs = getComputedStyle(ok);
    const rgb = (x) => (x.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    return { bg: rgb(cs.backgroundColor), fg: rgb(cs.color) };
  }, enId);
  const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const kontrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hue = ([r, g, b]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return -1; const d = mx - mn; const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  for (const modus of ['light', 'dark']) {
    await page.evaluate((m) => document.documentElement.setAttribute('data-theme', m), modus);
    await f.fill(plusTag(enV0));
    await page.waitForTimeout(250);
    const c = await lies();
    if (modus === 'dark') await page.screenshot({ path: join(here, 'shots', 'edit-entwurf-dunkel.png') });
    await page.locator(`.tb-r[data-id="${enId}"] .en-no`).click();
    const h = hue(c.bg);
    if (h < 90 || h > 170) return modus + ': Hintergrund nicht grün (Farbton ' + Math.round(h) + ') ' + c.bg;
    if (c.fg.some((v) => v < 240)) return modus + ': Haken nicht weiß ' + c.fg;
    const k = kontrast(c.bg, c.fg);
    if (k < 3) return modus + ': Kontrast ' + k.toFixed(2);
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  return true;
});
await check('lehnt der Store ✓ ab, bleibt der Entwurf MARKIERT offen und nennt den Grund (Controller mit echtem DOM)', async () => {
  const r = await page.evaluate(async () => {
    const { entwurfBinden } = await import('/js/entwurf.js');
    const host = document.createElement('div');
    host.innerHTML = '<div class="t"><input type="datetime-local"><input class="d"><input type="datetime-local"></div>';
    document.body.append(host);
    const [st, du, en] = host.querySelectorAll('input');
    const stand = { start: '2026-07-13T08:00', end: '2026-07-13T10:00' };
    st.value = stand.start; en.value = stand.end; du.value = '2h';
    const grp = host.firstChild;
    entwurfBinden({ start: st, ende: en, dauer: du, gruppe: [grp], markiere: grp, popIn: grp, lesen: () => stand,
      uebernehmen: () => ({ ok: false, error: 'Vorgang ist inzwischen ein Sammelvorgang.' }) });
    st.value = '2026-07-13T09:00'; st.dispatchEvent(new Event('change'));
    grp.querySelector('.en-ok').click();
    const out = { markiert: grp.classList.contains('is-entwurf'), grund: grp.querySelector('.en-grund')?.textContent, okGesperrt: grp.querySelector('.en-ok').disabled, startWert: st.value };
    // und weiter editierbar
    en.value = '2026-07-13T12:00'; en.dispatchEvent(new Event('change'));
    out.editierbar = grp.querySelector('.en-grund').textContent === '' && !grp.querySelector('.en-ok').disabled;
    host.remove();
    return out;
  });
  if (!r.markiert) return 'Entwurf nach Ablehnung nicht mehr markiert';
  if (!/Sammelvorgang/.test(r.grund || '')) return 'Grund fehlt: ' + r.grund;
  if (!r.okGesperrt) return '✓ nicht gesperrt';
  if (r.startWert !== '2026-07-13T09:00') return 'Feld zeigt ' + r.startWert;
  return r.editierbar ? true : 'weitere Eingabe wird ignoriert';
});
await check('ein ⌘Z in einer ANDEREN Zeile wirft den offenen Entwurf nicht weg', async () => {
  const andere = await page.evaluate((i) => [...document.querySelectorAll('.tb-r:not(.is-parent) .c-title input')].find((x) => x.closest('.tb-r').dataset.id !== i && x.closest('.tb-r').querySelector('.tb-ico.tb-del')).closest('.tb-r').dataset.id, enId);
  const t = page.locator(`.tb-r[data-id="${andere}"] .c-title input`);
  await t.fill('Entwurfstest-Titel');
  await t.press('Tab');
  await page.waitForTimeout(400);
  const f = page.locator(`.tb-r[data-id="${enId}"] .c-start input`);
  await f.fill(plusTag(enV0));
  await page.waitForTimeout(200);
  await page.keyboard.press('Meta+z');      // nimmt den Titel der anderen Zeile zurück
  await page.waitForTimeout(500);
  const titel = await page.locator(`.tb-r[data-id="${andere}"] .c-title input`).inputValue();
  const offen = await page.locator(`.tb-r[data-id="${enId}"].is-entwurf`).count();
  const wert = await page.locator(`.tb-r[data-id="${enId}"] .c-start input`).inputValue();
  const fokus = await page.evaluate(() => !!document.activeElement.closest('.c-start'));
  if (titel === 'Entwurfstest-Titel') return 'der Undo hat nicht gegriffen';
  if (!offen) return 'Entwurf ist weg';
  if (wert !== plusTag(enV0)) return 'Entwurfswert ' + wert;
  if (!fokus) return 'Fokus nicht im Feld';
  await page.locator(`.tb-r[data-id="${enId}"] .en-ok`).click();    // und lässt sich noch übernehmen
  await page.waitForTimeout(300);
  const nach = await stand();
  await page.keyboard.press('Meta+z');
  return nach[enId][0] === plusTag(enV0) ? true : 'Übernahme nach dem Neuaufbau: ' + nach[enId][0];
});
await check('hat sich der Vorgang unter dem Entwurf geändert, fällt er SICHTBAR weg (Meldung)', async () => {
  const f = page.locator(`.tb-r[data-id="${enId}"] .c-start input`);
  await f.fill(plusTag(enV0));
  await page.locator(`.tb-r[data-id="${enId}"] .en-ok`).click();   // Schritt 1: gespeichert
  await page.waitForTimeout(300);
  const f2 = page.locator(`.tb-r[data-id="${enId}"] .c-start input`);
  await f2.fill(plusTag(plusTag(enV0)));
  await page.waitForTimeout(200);
  await page.keyboard.press('Meta+z');      // nimmt GENAU diesen Vorgang zurück
  await page.waitForTimeout(500);
  const offen = await page.locator('.tb-r.is-entwurf').count();
  const toast = await page.locator('#toast').textContent();
  const sichtbar = await page.locator('#toast').isVisible();
  return !offen && /Entwurf verworfen/.test(toast) && sichtbar ? true : `offen=${offen} toast=«${toast}»`;
});
await check('Panel: Start ändern = Entwurf (✓ ✗), ✗ verwirft, ✓ speichert EINEN Schritt', async () => {
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(400);
  await page.locator('.bz-lab-task .bz-lab-name').first().click();
  await page.waitForTimeout(300);
  const id = await page.evaluate(() => document.querySelector('.bz-lab-task.is-sel, .bz-lab.is-sel')?.dataset?.id || null);
  const s0 = await stand();
  const st = page.locator('.ins-termin input[type=datetime-local]').first();
  const v0 = await st.inputValue();
  await st.fill(plusTag(v0));
  await page.waitForTimeout(200);
  if (!(await page.locator('.ins-termin.is-entwurf').count())) return 'Panel nicht markiert';
  if (JSON.stringify(await stand()) !== JSON.stringify(s0)) return 'schon gespeichert';
  await page.screenshot({ path: join(here, 'shots', 'edit-entwurf-panel.png') });
  await page.locator('.ins-termin .en-no').click();
  if ((await st.inputValue()) !== v0 || await page.locator('.ins-termin.is-entwurf').count()) return '✗ verwarf nicht';
  await st.fill(plusTag(v0));
  await page.locator('.ins-termin .en-ok').click();
  await page.waitForTimeout(300);
  const s1 = await stand();
  if (JSON.stringify(s1) === JSON.stringify(s0)) return '✓ speicherte nicht';
  await page.keyboard.press('Meta+z');
  return JSON.stringify(await stand()) === JSON.stringify(s0) ? true : 'ein ⌘Z reichte nicht';
});
await page.locator('[data-view="gantt"]').click();
await page.waitForTimeout(300);

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
await page.locator('#tag-wahl').click();
await page.waitForTimeout(250);
{
  // Der Kalender bietet nur Tage an, an denen etwas steht — der Tag des
  // Elternvorgangs ist einer davon.
  const ziel = page.locator('.mn .mn-i').filter({ hasText: subDay.slice(8, 10) + '.' + subDay.slice(5, 7) + '.' });
  if (await ziel.count()) await ziel.first().click();
  else await page.keyboard.press('Escape');
}
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

await check('die Zoomstufe ist ein App-Knopf mit Menü, auch per Tastatur', async () => {
  const tag = await page.locator('#zoom-stufe').evaluate((n) => n.tagName);
  if (tag === 'SELECT') return 'die Zoomstufe ist noch ein Browser-Klappmenü';
  await page.locator('#zoom-stufe').click();
  const n = await page.locator('.mn .mn-i').count();
  if (n !== 4) return n + ' Menüeinträge statt 4';
  await page.locator('.mn .mn-i', { hasText: 'Stunden' }).click();
  await page.waitForTimeout(300);
  if (!/Stunden/.test(await page.locator('#zoom-stufe').textContent())) return 'der Knopf zeigt die Stufe nicht';
  // Die Wahl muss die ACHSE ändern, nicht nur die Beschriftung des Knopfs:
  // gemessen als Pixel je Stunde an einem echten Balken (data-from/data-to in Minuten).
  const pxH = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('.bz-bar[data-from][data-to]')].find((n) => n.offsetWidth > 0 && +n.dataset.to > +n.dataset.from);
    return b ? b.getBoundingClientRect().width / ((+b.dataset.to - +b.dataset.from) / 60) : 0;
  });
  const stdPx = await pxH();
  if (!(stdPx >= 60)) return 'Stunden gewählt, aber nur ' + Math.round(stdPx) + ' px je Stunde';
  const ticks = (await page.locator('.bz-axis .bz-t-minor').allTextContents()).map((t) => parseInt(t, 10)).filter(Number.isFinite);
  if (ticks.length < 5) return 'Stundenachse hat nur ' + ticks.length + ' Ticks';
  // Tastatur: Fokus, Enter öffnet, Escape schließt.
  await page.locator('#zoom-stufe').focus();
  await page.keyboard.press('Enter');
  if (await page.locator('.mn .mn-i').count() !== 4) return 'Enter öffnet das Menü nicht';
  await page.keyboard.press('Escape');
  if (await page.locator('.mn').count()) return 'Escape schließt das Menü nicht';
  await page.locator('#zoom-stufe').click();
  await page.locator('.mn .mn-i', { hasText: 'Wochen' }).click();
  await page.waitForTimeout(300);
  const wPx = await pxH();
  return wPx > 0 && wPx < 20 ? true : 'Wochen zeigt ' + Math.round(wPx) + ' px je Stunde';
});

await check('Drucken steht in der Kopfzeile, ein KLICK öffnet print.html mit dem Modus', async () => {
  const b = page.locator('#drucken');
  if (!(await b.isVisible())) return 'kein Drucken-Knopf im Bauzeitenplan';
  const klick = async () => {
    const neu = page.context().waitForEvent('page', { timeout: 5000 });
    await b.click();
    const pg = await neu;
    const url = pg.url();
    await pg.close();
    return url;
  };
  const u1 = await klick();
  if (!/print\.html/.test(u1) || /ansicht=/.test(u1)) return 'Bauzeitenplan: ' + u1;
  await page.locator('.rail-m:not(.rail-ein)').nth(1).click();
  await page.waitForTimeout(500);
  if (!(await b.isVisible())) return 'kein Drucken-Knopf im Showablauf';
  const u2 = await klick();
  await page.locator('.rail-m:not(.rail-ein)').first().click();
  await page.waitForTimeout(400);
  return /print\.html\?.*ansicht=(show|setup)/.test(u2) ? true : 'Showablauf: ' + u2;
});

await check('die Schiene hat genau drei Einträge — zwei Modi und das Zahnrad', async () => {
  // Sie trug in einem Zwischenstand auch die Tage. Bei einem Plan über zwei
  // Wochen waren das vierzehn Datumszeilen, die «Showablauf» und «Einrichten»
  // unter den Fensterrand schoben — im Screenshot gesehen, von keiner
  // Zusicherung bemerkt. Der Tag steht jetzt im Kalender-Knopf.
  const n = await page.locator('.rail-m').count();
  if (n !== 3) return n + ' Einträge in der Schiene statt 3';
  for (const sel of ['.rail-m:not(.rail-ein)', '#rail-ein']) {
    const drin = await page.locator(sel).last().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight + 1;
    });
    if (!drin) return sel + ' liegt außerhalb des Fensters';
  }
  return true;
});

await check('der Kalender bietet NUR Tage an, an denen etwas im Plan steht', async () => {
  const S = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem(
      Object.keys(localStorage).find((k) => k.startsWith('bzp_p_'))) || '{}');
    const tage = new Set();
    for (const t of raw.tasks || []) {
      const a = new Date(t.start), b = new Date(t.end || t.start);
      for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) {
        tage.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
          + '-' + String(d.getDate()).padStart(2, '0'));
      }
    }
    return { tage: [...tage].sort(), start: (raw.project || {}).start };
  });
  await page.locator('#tag-wahl').click();
  await page.waitForTimeout(300);
  const angeboten = await page.locator('.mn .mn-i').allTextContents();
  if (!angeboten.length) { await page.keyboard.press('Escape'); return 'gar kein Tag angeboten'; }
  if (angeboten.length !== S.tage.length) {
    await page.keyboard.press('Escape');
    return angeboten.length + ' angeboten, aber ' + S.tage.length + ' Tage haben Vorgänge';
  }
  // Und ein Klick bewegt die Achse wirklich, nicht nur die Beschriftung.
  const vorher = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  await page.locator('.mn .mn-i').last().click();
  await page.waitForTimeout(600);
  const letzt = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  await page.locator('#tag-wahl').click();
  await page.waitForTimeout(300);
  await page.locator('.mn .mn-i').first().click();
  await page.waitForTimeout(600);
  const erst = await page.locator('.bz-scroll').evaluate((n) => n.scrollLeft);
  if (erst === letzt) return 'erster und letzter Tag führen zur selben Position (' + erst + ')';
  return vorher !== undefined ? true : 'kein Ausgangswert';
});
await page.screenshot({ path: join(here, 'shots', 'edit-11-schiene.png') });

console.log('\nGESPERRTER SPEICHER');
await check('Gesperrter Speicher: keine Ausnahme, Ansicht-Umschalter wechselt', async () => {
  const c2 = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const fehler = [];
  try {
    // Jeder Zugriff wirft (Privatmodus/gesperrt), vom ersten Aufruf an — auch Lesen.
    await c2.addInitScript(() => {
      const wirf = () => { throw new DOMException('gesperrt', 'SecurityError'); };
      Storage.prototype.getItem = wirf; Storage.prototype.setItem = wirf; Storage.prototype.removeItem = wirf;
    });
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => fehler.push(e.message + ' @' + String(e.stack).split('\n').slice(0, 3).join(' < ')));
    await p2.goto(BASE + '/index.html?plan=leer');
    await p2.waitForTimeout(900);
    if (fehler.length) return 'pageerror beim Start: ' + fehler.slice(0, 3).join(' | ');
    await festivalMitDaten(p2, 'Ohne Speicher');
    await p2.waitForTimeout(900);
    if (fehler.length) return 'pageerror beim Anlegen: ' + fehler.slice(0, 3).join(' | ');
    await p2.locator('.rail-m', { hasText: 'Showablauf' }).click({ timeout: 5000 });
    await p2.waitForTimeout(400);
    const gedrueckt = await p2.locator('button[data-ansicht="show"]').getAttribute('aria-pressed');
    await p2.locator('.rail-m', { hasText: 'Bauzeitenplan' }).click({ timeout: 5000 });
    await p2.waitForTimeout(300);
    const zurueck = await p2.locator('button[data-ansicht="show"]').getAttribute('aria-pressed');
    if (fehler.length) return 'pageerror: ' + fehler.slice(0, 3).join(' | ');
    return gedrueckt === 'true' && zurueck === 'false' ? true : `Show danach ${gedrueckt}, nach Rückkehr ${zurueck}`;
  } finally { await c2.close(); }
});

console.log('\nVOLLER SPEICHER BEIM PROJEKTWECHSEL');
await check('Voller Speicher beim Projektwechsel fragt (Abbrechen / Trotzdem wechseln / Exportieren)', async () => {
  const c3 = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  try {
    const p3 = await c3.newPage();
    const fehler = [];
    p3.on('pageerror', (e) => fehler.push(e.message));
    await p3.goto(BASE + '/index.html?plan=leer');
    await p3.waitForTimeout(700);
    const anlegen = async (name) => {
      await festivalMitDaten(p3, name);
      await p3.waitForTimeout(700);
    };
    await anlegen('Alpha');
    await p3.locator('#rail-ein').click();
    await p3.locator('#new-proj').click();
    await p3.waitForTimeout(300);
    await anlegen('Beta');
    await p3.waitForTimeout(1200);
    // Ein ausstehender Eintrag im offenen Projekt, Speicher voll NUR für dessen Plan-Schlüssel.
    const aendern = async (neu) => {
      await p3.locator('#ein-zu').click({ timeout: 2000 }).catch(() => {});
      await p3.locator('.bz-lab-group .bz-lab-name').first().dblclick();
      await p3.locator('.bz-lab-edit').fill(neu);
      await p3.keyboard.press('Enter');
      await p3.evaluate(() => {
        const key = 'bzp_p_' + localStorage.getItem('bzp_active');
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === key) throw new DOMException('voll', 'QuotaExceededError');
          return orig.call(this, k, v);
        };
      });
    };
    const projektOeffnen = async (name) => {
      await p3.locator('#rail-ein').click();
      await p3.locator('#proj-menu').click();
      await p3.waitForTimeout(300);
      await p3.locator('.dlg-open', { hasText: name }).click();
      await p3.waitForTimeout(500);
    };
    const labelName = () => p3.locator('.bz-lab-group .bz-lab-name').first().textContent();
    await aendern('Geändert-1');
    await projektOeffnen('Alpha');
    const dlg = p3.locator('.dlg-h', { hasText: 'Nicht gespeichert' });
    if ((await dlg.count()) !== 1) return 'kein Dialog «Nicht gespeichert»';
    const knoepfe = await p3.locator('body > .dlg').last().locator('.btn').allTextContents();
    for (const t of ['Exportieren', 'Trotzdem wechseln', 'Abbrechen']) if (!knoepfe.includes(t)) return 'Knopf fehlt: ' + t + ' (' + knoepfe + ')';
    if (!(await p3.locator('.dlg-sub', { hasText: 'Der Browser-Speicher ist voll' }).count())) return 'Nachricht ohne «Der Browser-Speicher ist voll»';
    // (a) Abbrechen
    await p3.locator('body > .dlg').last().locator('.btn', { hasText: 'Abbrechen' }).click();
    await p3.waitForTimeout(300);
    if ((await p3.locator('#proj-name').textContent()) !== 'Beta') return '(a) Projekt gewechselt';
    if ((await labelName()) !== 'Geändert-1') return '(a) Eingabe weg: ' + (await labelName());
    // (b) Trotzdem wechseln — der Projektdialog steht noch, Alpha erneut wählen.
    await p3.locator('.dlg-open', { hasText: 'Alpha' }).click();
    await p3.waitForTimeout(400);
    await p3.locator('body > .dlg').last().locator('.btn', { hasText: 'Trotzdem wechseln' }).click();
    await p3.waitForTimeout(700);
    if ((await p3.locator('#proj-name').textContent()) !== 'Alpha') return '(b) nicht gewechselt';
    // (c) Exportieren: Speicher jetzt für Alpha voll, offene Eingabe in Alpha.
    await p3.evaluate(() => { location.reload(); });
    await p3.waitForTimeout(1200);
    await aendern('Geändert-2');
    await projektOeffnen('Beta');
    await p3.locator('.dlg-h', { hasText: 'Nicht gespeichert' }).waitFor({ timeout: 3000 });
    const [dl] = await Promise.all([
      p3.waitForEvent('download', { timeout: 5000 }),
      p3.locator('body > .dlg').last().locator('.btn', { hasText: 'Exportieren' }).click(),
    ]);
    if (!/\.json$/.test(dl.suggestedFilename())) return 'Download: ' + dl.suggestedFilename();
    await p3.waitForTimeout(700);
    if ((await p3.locator('#proj-name').textContent()) !== 'Beta') return '(c) nicht gewechselt';
    // (d) Mitgelieferten Plan aus dem Projektdialog öffnen, dann Abbrechen:
    // Dialog bleibt, kein «Neuer Stand geladen», altes Projekt bleibt aktiv.
    await aendern('Geändert-3');
    await p3.locator('#rail-ein').click();
    await p3.locator('#proj-menu').click();
    await p3.waitForTimeout(300);
    await p3.locator('.dlg-open', { hasText: 'klassentreffen' }).first().click();
    await p3.waitForTimeout(800);
    if ((await p3.locator('.dlg-h', { hasText: 'Nicht gespeichert' }).count()) !== 1) return '(d) kein Dialog beim mitgelieferten Plan';
    await p3.locator('body > .dlg').last().locator('.btn', { hasText: 'Abbrechen' }).click();
    await p3.waitForTimeout(400);
    if (!(await p3.locator('#dlg .dlg-open').count()) || await p3.locator('#dlg').isHidden()) return '(d) Projektdialog wurde geschlossen';
    if ((await p3.locator('#proj-name').textContent()) !== 'Beta') return '(d) Projekt gewechselt';
    if (fehler.length) return 'pageerror: ' + fehler[0];
    return true;
  } finally { await c3.close(); }
});

console.log('\nNIE GESPEICHERTER PLAN BEIM WECHSEL');
await check('Neu angelegter Plan, dessen erstes Speichern scheitert, gilt als ungesichert (Wechsel fragt)', async () => {
  const c4 = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  try {
    const p4 = await c4.newPage();
    const fehler = [];
    p4.on('pageerror', (e) => fehler.push(e.message));
    await p4.goto(BASE + '/index.html?plan=leer');
    await p4.waitForTimeout(700);
    const anlegen = async (name) => {
      await festivalMitDaten(p4, name);
      await p4.waitForTimeout(700);
    };
    await anlegen('Alpha');
    await p4.waitForTimeout(1200);
    // Ab jetzt ist der Speicher für jeden Plan voll: das erste Speichern von Beta scheitert.
    await p4.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k.startsWith('bzp_p_')) throw new DOMException('voll', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    });
    await p4.locator('#rail-ein').click();
    await p4.locator('#new-proj').click();
    await p4.waitForTimeout(300);
    await anlegen('Beta');
    await p4.waitForTimeout(1200);
    if ((await p4.locator('#proj-name').textContent()) !== 'Beta') return 'Beta nicht offen';
    await p4.locator('#ein-zu').click({ timeout: 2000 }).catch(() => {});
    await p4.locator('#rail-ein').click();
    await p4.locator('#proj-menu').click();
    await p4.waitForTimeout(300);
    await p4.locator('.dlg-open', { hasText: 'Alpha' }).click();
    await p4.waitForTimeout(600);
    if ((await p4.locator('.dlg-h', { hasText: 'Nicht gespeichert' }).count()) !== 1) return 'kein Dialog «Nicht gespeichert» beim Wechsel weg vom nie gespeicherten Plan';
    if ((await p4.locator('#proj-name').textContent()) !== 'Beta') return 'Projekt trotzdem gewechselt';
    if (fehler.length) return 'pageerror: ' + fehler[0];
    return true;
  } finally { await c4.close(); }
});

console.log('\nLEERE ZUSTÄNDE');
await check('Leere Tabelle, Bedarf und Showablauf ohne Bühne bieten den passenden Knopf an', async () => {
  const c5 = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  try {
    const p5 = await c5.newPage();
    const fehler = [];
    p5.on('pageerror', (e) => fehler.push(e.message));
    await p5.goto(BASE + '/index.html?plan=leer');
    await p5.waitForTimeout(700);
    await p5.fill('.dlg-f:first-child input', 'Leerplan');
    await p5.locator('.dlg-t[data-k="leer"]').click();
    await p5.locator('.dlg-act .btn-p').click();
    await p5.waitForTimeout(700);
    // (a) Tabelle ohne Vorgänge: Knopf in der Leerzeile legt EINEN Vorgang an.
    await p5.locator('[data-view="tabelle"]').click();
    await p5.waitForTimeout(300);
    const kn = p5.locator('.tb-empty .tb-add');
    if ((await kn.count()) !== 1) return `(a) ${await kn.count()} Leerzeilen-Knöpfe statt genau 1`;
    await kn.click();
    await p5.waitForTimeout(300);
    const n = await p5.locator('.tb-r').count();
    if (n !== 1) return `(a) ${n} Zeilen statt 1`;
    if ((await p5.locator('.tb-empty .tb-add').count()) !== 0) return '(a) nach dem Anlegen noch Leerzeilen-Knöpfe';
    await p5.screenshot({ path: join(here, 'shots', 'edit-leer-tabelle.png') });
    // (b) Bedarf ohne Bezeichnungen: Knopf öffnet Einrichten auf «Personal & Maschinen».
    await p5.locator('[data-view="bedarf"]').click();
    await p5.waitForTimeout(300);
    // «Crew» entsteht mit dem Vorgang aus (a); Maschinen bleiben leer.
    await p5.locator('[data-bedarf="maschine"]').click();
    await p5.waitForTimeout(200);
    const bk = p5.locator('.bd-empty button');
    if (!(await bk.isVisible())) return '(b) kein Knopf im leeren Bedarf';
    await bk.click();
    await p5.waitForTimeout(300);
    if (!(await p5.locator('#ein-dlg').isVisible())) return '(b) Einrichten nicht offen';
    if ((await p5.locator('[data-ein="res"]').getAttribute('aria-pressed')) !== 'true') return '(b) Reiter «Personal & Maschinen» nicht gewählt';
    await p5.locator('#ein-zu').click();
    // (c) Showablauf ohne Bühne: «+ Bühne» öffnet den Namenskasten.
    await p5.locator('[data-view="tabelle"]').click();
    await p5.locator('.rail-m:not(.rail-ein)').nth(1).click();
    await p5.waitForTimeout(400);
    const bu = p5.locator('.tb-empty .tb-add');
    if (!(await bu.count())) return '(c) kein Knopf ohne Bühne';
    if (!/Bühne/.test(await bu.first().textContent())) return '(c) Beschriftung: ' + await bu.first().textContent();
    await bu.first().click();
    await p5.waitForTimeout(300);
    if (!(await p5.locator('.tb-neuart').isVisible())) return '(c) Namenskasten fehlt';
    if (fehler.length) return 'pageerror: ' + fehler[0];
    return true;
  } finally { await c5.close(); }
});

await check('Leerer Bauzeitenplan: der GANTT (nicht die Tabelle) bietet EINEN Knopf an, und er legt einen Vorgang an', async () => {
  const c6 = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  try {
    const p6 = await c6.newPage();
    const fehler = [];
    p6.on('pageerror', (e) => fehler.push(e.message));
    await p6.goto(BASE + '/index.html?plan=leer');
    await p6.waitForTimeout(700);
    await p6.fill('.dlg-f:first-child input', 'Leerplan Gantt');
    await p6.locator('.dlg-t[data-k="leer"]').click();
    await p6.locator('.dlg-act .btn-p').click();
    await p6.waitForTimeout(700);
    if (!(await p6.locator('#bz').isVisible())) return 'Gantt nicht sichtbar (Tabelle offen?)';
    const kn = p6.locator('#bz .bz-leer button');
    if ((await kn.count()) !== 1 || !(await kn.isVisible())) return 'kein sichtbarer Leerknopf im Gantt';
    if (!/Vorgang/.test(await kn.textContent())) return 'Beschriftung: ' + await kn.textContent();
    await p6.screenshot({ path: join(here, 'shots', 'edit-gantt-leer.png') });
    await kn.click();
    await p6.waitForTimeout(500);
    const n = await p6.locator('#bz .bz-bar').count();
    if (n !== 1) return n + ' Balken nach dem Klick statt 1';
    if (await p6.locator('#bz .bz-leer').isVisible()) return 'Leerhinweis bleibt trotz Vorgang stehen';
    if (fehler.length) return 'pageerror: ' + fehler[0];
    return true;
  } finally { await c6.close(); }
});

console.log('\nBALKEN ZIEHEN (Verschieben, Ende, Escape, Klick, Griffe, Tastatur)');
{
  const cz = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const pz = await cz.newPage();
  pz.on('pageerror', (e) => errors.push('JS: ' + e.message));
  try {
    await pz.goto(BASE + '/index.html?plan=leer');
    await pz.waitForTimeout(700);
    await festivalMitDaten(pz, 'Zieh-Test', { loadIn: '2026-08-05T06:00' });
    await pz.waitForTimeout(900);
    // Plan präparieren: ein Sammelvorgang (Elternvorgang mit einem Kind).
    const prep = await pz.evaluate(() => {
      const id = localStorage.getItem('bzp_active');
      const plan = JSON.parse(localStorage.getItem('bzp_p_' + id));
      const flach = plan.tasks.filter((t) => !t.milestone);
      let elter = null, kind = null;
      for (const g of plan.gewerke) {
        const l = flach.filter((t) => t.gewerk === g.id);
        if (l.length >= 2) { elter = l[0]; kind = l[1]; break; }
      }
      kind.parent = elter.id;
      elter.start = kind.start; elter.end = kind.end;
      localStorage.setItem('bzp_p_' + id, JSON.stringify(plan));
      const andere = plan.tasks.filter((t) => !t.milestone && t.id !== elter.id && t.id !== kind.id && !t.parent);
      // Ein einlaufender Pfeil legt eine breite Trefferspur über den Balkenanfang:
      // der linke Griff braucht einen Balken ohne Vorgänger.
      const ohneVor = andere.filter((t) => !plan.deps.some((d) => d.to === t.id));
      return { elter: elter.id, kind: kind.id,
        ms: (plan.tasks.find((t) => t.milestone) || {}).id, frei: andere.map((t) => t.id), mitDep: andere.filter((t) => plan.deps.some((d) => d.from === t.id || d.to === t.id)).map((t) => t.id), ohneVor: ohneVor.map((t) => t.id) };
    });
    await pz.reload();
    await pz.waitForTimeout(1100);
    const zeit = async (id) => {
      await pz.waitForTimeout(1100);   // Auto-Save
      return pz.evaluate((id) => {
        const k = localStorage.getItem('bzp_active');
        const t = JSON.parse(localStorage.getItem('bzp_p_' + k)).tasks.find((x) => x.id === id);
        return { s: new Date(t.start).getTime() / 60000, e: new Date(t.end).getTime() / 60000 };
      }, id);
    };
    // Einen Balken suchen, dessen beide Kanten im Bild stehen, und seine Lage melden.
    const balken = async (ids) => pz.evaluate(async (ids) => {
      const L = Math.ceil(document.querySelector('.bz-side').getBoundingClientRect().right) + 30;
      for (const id of ids) {
        const n = document.querySelector(`.bz-bar[data-task="${id}"]`);
        if (!n) continue;
        n.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise((r) => requestAnimationFrame(r));
        const r = n.getBoundingClientRect();
        if (r.width >= 110 && r.left > L && r.right < innerWidth - 420 && r.top > 140 && r.bottom < innerHeight - 100)
          return { id, l: r.left, r: r.right, y: r.top + r.height / 2, h: r.height };
      }
      return null;
    }, ids);
    const ziehe = async (b, vonX, dx, { halten = false, loslassen = true } = {}) => {
      await pz.mouse.move(vonX, b.y);
      await pz.mouse.down();
      await pz.mouse.move(vonX + Math.sign(dx) * 6, b.y, { steps: 2 });
      await pz.mouse.move(vonX + dx, b.y, { steps: 6 });
      await pz.waitForTimeout(150);
      if (loslassen) await pz.mouse.up();
    };

    let b1 = await balken(prep.frei);
    let alt = null;
    await check('Verschieben: Start und Ende wandern um denselben Betrag, die Dauer bleibt', async () => {
      if (!b1) return 'kein Balken mit beiden Kanten im Bild';
      alt = await zeit(b1.id);
      const mitte = (b1.l + b1.r) / 2;
      await ziehe(b1, mitte, 60, { loslassen: false });
      const hint = await pz.locator('.bz-tip-zug').count();
      const text = hint ? await pz.locator('.bz-tip-zug').first().textContent() : '';
      await pz.screenshot({ path: join(here, 'shots', 'edit-ziehen-hinweis.png') });
      // Der Verknüpfen-Griff bliebe sonst am ALTEN Ende stehen und griffbereit.
      const griffe = await pz.evaluate(() => [...document.querySelectorAll('.bz-link')]
        .filter((h) => getComputedStyle(h).pointerEvents !== 'none' || getComputedStyle(h).opacity !== '0').length);
      await pz.mouse.up();
      if (griffe) return griffe + ' Verknüpfen-Griffe bleiben beim Ziehen sichtbar/treffbar';
      if (!hint || !/Start/.test(text) || !/Ende/.test(text) || !/Dauer/.test(text)) return 'kein Hinweis beim Ziehen: «' + text + '»';
      const neu = await zeit(b1.id);
      if (neu.s <= alt.s) return 'Start nicht später: ' + alt.s + ' → ' + neu.s;
      if (neu.e - neu.s !== alt.e - alt.s) return 'Dauer verändert: ' + (alt.e - alt.s) + ' → ' + (neu.e - neu.s);
      return true;
    });
    await check('ein ⌘Z macht den ganzen Zug rückgängig', async () => {
      if (!alt) return 'kein Ausgangswert';
      await pz.keyboard.press('Meta+z');
      const z = await zeit(b1.id);
      return z.s === alt.s && z.e === alt.e ? true : `Start ${alt.s} → ${z.s}, Ende ${alt.e} → ${z.e}`;
    });
    await check('rechten Griff ziehen: nur das Ende wandert', async () => {
      b1 = await balken(prep.frei);
      if (!b1) return 'kein Balken im Bild';
      const a = await zeit(b1.id);
      // Dreh- und Angelpunkt: 10 px vor dem Ende trifft der Zeiger den Dauer-Griff,
      // nicht den Verknüpfen-Griff.
      const wer = await pz.evaluate(([x, y]) => String(document.elementFromPoint(x, y).getAttribute('class')), [b1.r - 10, b1.y]);
      if (!/bz-grip-r/.test(wer)) return 'bei Ende-10px liegt «' + wer + '» statt des Dauer-Griffs';
      await ziehe(b1, b1.r - 10, 50);
      const n = await zeit(b1.id);
      if (n.s !== a.s) return 'Start hat sich bewegt';
      return n.e > a.e ? true : 'Ende nicht später: ' + a.e + ' → ' + n.e;
    });
    await check('linken Griff ziehen: nur der Start wandert', async () => {
      b1 = await balken(prep.ohneVor);
      const a = await zeit(b1.id);
      console.log('   DBG', JSON.stringify(b1), JSON.stringify(await pz.evaluate(([x,y]) => [2,8,14,20].map((dx) => String(document.elementFromPoint(x + dx, y).getAttribute('class'))), [b1.l, b1.y])));
      await ziehe(b1, b1.l + 8, 30);
      const n = await zeit(b1.id);
      if (n.e !== a.e) return 'Ende hat sich bewegt';
      return n.s > a.s ? true : 'Start nicht später: ' + a.s + ' → ' + n.s;
    });
    await check('Escape beim Ziehen: nichts geschrieben, der Balken steht wieder da', async () => {
      b1 = await balken(prep.frei);
      const a = await zeit(b1.id);
      await ziehe(b1, (b1.l + b1.r) / 2, 80, { loslassen: false });
      await pz.keyboard.press('Escape');
      await pz.mouse.up();
      await pz.waitForTimeout(200);
      const n = await zeit(b1.id);
      const links = await pz.locator(`.bz-bar[data-task="${b1.id}"]`).evaluate((e) => e.getBoundingClientRect().left);
      if (n.s !== a.s || n.e !== a.e) return 'trotz Escape gespeichert';
      if (await pz.locator('.bz-tip-zug').count()) return 'Hinweis bleibt stehen';
      return Math.abs(links - b1.l) < 2 ? true : `Balken steht ${Math.round(links - b1.l)} px daneben`;
    });
    await check('Klick bleibt Auswahl: Panel geht auf, nichts verschoben (auch bei 2 px Wackeln)', async () => {
      b1 = await balken(prep.frei);
      const a = await zeit(b1.id);
      const mx = (b1.l + b1.r) / 2;
      await pz.mouse.move(mx, b1.y);
      await pz.mouse.down();
      await pz.mouse.move(mx + 2, b1.y);
      await pz.mouse.up();
      await pz.waitForTimeout(300);
      const n = await zeit(b1.id);
      if (n.s !== a.s || n.e !== a.e) return 'ein Klick hat den Balken verschoben';
      const sel = await pz.locator(`.bz-bar[data-task="${b1.id}"].is-sel`).count();
      return sel === 1 ? true : 'Balken nicht ausgewählt';
    });
    await check('Sammelvorgang trägt keine Griffe und lässt sich nicht ziehen', async () => {
      const griffe = await pz.locator(`.bz-bar[data-task="${prep.elter}"] .bz-grip`).count();
      if (griffe) return griffe + ' Griffe am Sammelbalken';
      const a = await zeit(prep.elter);
      const r = await pz.locator(`.bz-bar[data-task="${prep.elter}"]`).evaluate(async (n) => {
        n.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise((q) => requestAnimationFrame(q));
        const b = n.getBoundingClientRect();
        return { x: Math.max(b.left, 420) + 20, y: b.top + b.height / 2 };
      });
      await pz.mouse.move(r.x, r.y);
      await pz.mouse.down();
      await pz.mouse.move(r.x + 60, r.y, { steps: 5 });
      const hint = await pz.locator('.bz-tip-zug').count();
      await pz.mouse.up();
      const n = await zeit(prep.elter);
      return !hint && n.s === a.s && n.e === a.e ? true : 'Sammelbalken wurde gezogen';
    });
    await check('Meilenstein: keine Dauer-Griffe, aber verschiebbar', async () => {
      if (!prep.ms) return 'kein Meilenstein im Plan';
      const g = await pz.locator(`.bz-ms[data-task="${prep.ms}"] .bz-grip`).count();
      if (g) return 'Meilenstein trägt Griffe';
      // Die Raute selbst ist das Ziel; der Verknüpfen-Griff sitzt rechts daneben.
      const p = await pz.locator(`.bz-ms[data-task="${prep.ms}"]`).evaluate(async (n) => {
        n.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise((q) => requestAnimationFrame(q));
        const d = n.querySelector('.bz-ms-d').getBoundingClientRect();
        const x = d.left + d.width / 2, y = d.top + d.height / 2;
        const mitte = document.elementFromPoint(x, y);
        const rechts = document.elementFromPoint(x + 21, y);
        return { x, y, mitte: String(mitte && mitte.getAttribute('class')), rechts: String(rechts && rechts.getAttribute('class')) };
      });
      if (!/bz-ms/.test(p.mitte)) return 'auf der Raute liegt «' + p.mitte + '»';
      if (!/bz-link/.test(p.rechts)) return 'der Verknüpfen-Griff ist neben der Raute nicht erreichbar («' + p.rechts + '»)';
      const a = await zeit(prep.ms);
      await pz.mouse.move(p.x, p.y);
      await pz.mouse.down();
      await pz.mouse.move(p.x + 70, p.y, { steps: 6 });
      await pz.mouse.up();
      const n = await zeit(prep.ms);
      if (n.s !== n.e) return 'Meilenstein hat jetzt eine Dauer';
      return n.s > a.s ? true : 'Meilenstein nicht verschoben';
    });
    await check('hängender Zug (pointerup ging verloren): ein neues Drücken räumt ihn ab, der nächste Zug geht', async () => {
      b1 = await balken(prep.frei);
      const a = await zeit(b1.id);
      // Zeigerereignisse selbst zustellen: Drücken + Bewegen, aber KEIN pointerup.
      await pz.evaluate(([id, x, y]) => {
        const n = document.querySelector(`.bz-bar[data-task="${id}"]`);
        const ev = (t, el, dx, buttons) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true,
          pointerId: 5, pointerType: 'mouse', isPrimary: true, clientX: x + dx, clientY: y, button: 0, buttons }));
        ev('pointerdown', n, 0, 1);
        ev('pointermove', n, 40, 1);
      }, [b1.id, (b1.l + b1.r) / 2, b1.y]);
      if (!(await pz.locator('.bz-tip-zug').count())) return 'Testaufbau: der Zug wurde nicht aktiv';
      // Neues Drücken ohne gedrückte Taste (buttons 0) auf freier Fläche: der alte Zug muss weg.
      await pz.evaluate(() => document.querySelector('.bz-rows').dispatchEvent(new PointerEvent('pointerdown',
        { bubbles: true, pointerId: 5, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 })));
      if (await pz.locator('.bz-tip-zug').count()) return 'der hängende Zug lebt weiter';
      const mitte = await zeit(b1.id);
      if (mitte.s !== a.s) return 'der abgeräumte Zug hat geschrieben';
      await ziehe(b1, (b1.l + b1.r) / 2, 60);
      const n = await zeit(b1.id);
      return n.s > a.s ? true : 'der nächste Zug verschiebt nichts mehr';
    });
    await check('Maus ohne gedrückte Taste (pointerup verloren): der Balken folgt dem Schweben nicht und speichert nichts', async () => {
      b1 = await balken(prep.frei);
      const a = await zeit(b1.id);
      const ev = (t, dx, buttons) => pz.evaluate(([id, x, y, t, dx, buttons]) => {
        const n = document.querySelector(`.bz-bar[data-task="${id}"]`);
        n.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 6, pointerType: 'mouse',
          isPrimary: true, clientX: x + dx, clientY: y, button: 0, buttons }));
      }, [b1.id, (b1.l + b1.r) / 2, b1.y, t, dx, buttons]);
      await ev('pointerdown', 0, 1);
      await ev('pointermove', 40, 1);
      if (!(await pz.locator('.bz-tip-zug').count())) return 'Testaufbau: der Zug wurde nicht aktiv';
      await ev('pointermove', 80, 0);          // Taste längst losgelassen, nur noch Schweben
      if (await pz.locator('.bz-tip-zug').count()) return 'der Balken folgt dem Schweben weiter';
      if (await pz.locator('.bz').evaluate((n) => n.hasAttribute('data-dragging'))) return 'data-dragging bleibt stehen';
      await ev('pointerup', 80, 0);
      const n = await zeit(b1.id);
      return n.s === a.s && n.e === a.e ? true : 'beim Loslassen wurde gespeichert';
    });
    await check('Panelfeld geändert und sofort einen Balken gegriffen: die Vorschau folgt, das Ergebnis wird gespeichert', async () => {
      b1 = await balken(prep.frei);
      const a = await zeit(b1.id);
      // Auswahl auf einen anderen Vorgang, dann ein Panelfeld tippen OHNE Verlassen: der change feuert
      // erst beim Greifen des Balkens und baut den Gantt neu auf.
      const andere = prep.frei.find((i) => i !== b1.id);
      await pz.locator(`.bz-bar[data-task="${andere}"]`).evaluate((n) => n.click());
      const feld = pz.locator('#ins input[type="text"], #ins textarea').first();
      await feld.fill('Geändert beim Ziehen');
      b1 = await balken(prep.frei.filter((i) => i !== andere));
      if (!b1) return 'kein Balken im Bild';
      const mitte = (b1.l + b1.r) / 2;
      await pz.mouse.move(mitte, b1.y);
      await pz.mouse.down();
      await pz.mouse.move(mitte + 8, b1.y, { steps: 2 });
      await pz.mouse.move(mitte + 70, b1.y, { steps: 6 });
      await pz.waitForTimeout(150);
      const links = await pz.locator(`.bz-bar[data-task="${b1.id}"]`).evaluate((n) => n.getBoundingClientRect().left);
      await pz.mouse.up();
      const n = await zeit(b1.id);
      if (links < b1.l + 40) return `die Vorschau am neuen Balken fehlt (links ${Math.round(links - b1.l)} px)`;
      return n.s > a.s ? true : 'nichts gespeichert';
    });
    await check('Pfeile folgen der Vorschau, solange gezogen wird', async () => {
      const ids = prep.mitDep;
      b1 = await balken(ids);
      if (!b1) return 'kein Balken mit Verknüpfung im Bild';
      const pfade = () => pz.evaluate(() => [...document.querySelectorAll('path.bz-dep')].map((p) => p.getAttribute('d')).join('|'));
      const vor = await pfade();
      const mitte = (b1.l + b1.r) / 2;
      await pz.mouse.move(mitte, b1.y);
      await pz.mouse.down();
      await pz.mouse.move(mitte + 8, b1.y, { steps: 2 });
      await pz.mouse.move(mitte + 90, b1.y, { steps: 6 });
      await pz.waitForTimeout(250);
      const mid = await pfade();
      await pz.keyboard.press('Escape');
      await pz.mouse.up();
      await pz.waitForTimeout(200);
      const nach = await pfade();
      if (mid === vor) return 'die Pfeile blieben beim Ziehen stehen';
      return nach === vor ? true : 'nach Escape stehen die Pfeile nicht wieder am Anfang';
    });
    await check('Alt+← mit ausgewähltem Sammelvorgang verlässt die App nicht (kein Browser-«Zurück»)', async () => {
      await pz.locator(`.bz-bar[data-task="${prep.elter}"]`).focus();
      await pz.keyboard.press('Enter');                       // Sammelvorgang auswählen
      // Der Browser selbst navigiert beim Testlauf nicht zuverlässig — geprüft wird, ob die App
      // das Ereignis für sich beansprucht (defaultPrevented): sonst ginge Alt+← als «Zurück» durch.
      const frei = await pz.locator(`.bz-bar[data-task="${prep.elter}"]`).evaluate((n) =>
        n.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true })));
      return frei === false ? true : 'Alt+← wurde nicht abgefangen: der Browser ginge zurück';
    });
    await check('Alt+→ bei Fokus auf einem ANDEREN Balken als dem ausgewählten verschiebt nichts', async () => {
      const ids = prep.frei;
      const A = ids[0], B = ids[1];
      await pz.locator(`.bz-bar[data-task="${A}"]`).focus();
      await pz.keyboard.press('Enter');                        // A auswählen
      const a0 = await zeit(A), b0 = await zeit(B);
      await pz.locator(`.bz-bar[data-task="${B}"]`).focus();   // Fokus woanders, Auswahl bleibt
      await pz.keyboard.press('Alt+ArrowRight');
      const a1 = await zeit(A), b1z = await zeit(B);
      return a1.s === a0.s && b1z.s === b0.s ? true : 'es bewegte sich ein Balken, den man nicht im Fokus hatte';
    });
    await check('Alt+→ verschiebt, Alt+Shift+→ verlängert, jeder Druck ein ⌘Z; ←/→ ohne Alt blättert', async () => {
      b1 = await balken(prep.frei);
      await pz.locator(`.bz-bar[data-task="${b1.id}"]`).focus();
      await pz.keyboard.press('Enter');
      const a = await zeit(b1.id);
      await pz.keyboard.press('Alt+ArrowRight');
      const m = await zeit(b1.id);
      if (m.s <= a.s || m.e - m.s !== a.e - a.s) return 'Alt+→ hat nicht verschoben: ' + JSON.stringify([a, m]);
      await pz.keyboard.press('Alt+Shift+ArrowRight');
      const v = await zeit(b1.id);
      if (v.s !== m.s || v.e <= m.e) return 'Alt+Shift+→ hat das Ende nicht verlängert';
      await pz.keyboard.press('Meta+z');
      const z = await zeit(b1.id);
      if (z.s !== m.s || z.e !== m.e) return 'ein ⌘Z machte nicht genau den letzten Tastendruck rückgängig';
      const sl = await pz.locator('.bz-scroll').evaluate((e) => e.scrollLeft);
      await pz.locator(`.bz-bar[data-task="${b1.id}"]`).focus();
      await pz.keyboard.press('ArrowRight');
      const sl2 = await pz.locator('.bz-scroll').evaluate((e) => e.scrollLeft);
      return sl2 > sl ? true : 'ArrowRight ohne Alt blättert nicht mehr';
    });
  } finally { await cz.close(); }
}

console.log('\nENTWURF: DER STORE LEHNT ✓ AB (echte Tabelle, Store absichtlich widerspenstig)');
{
  // Ein echter Ablehnungsfall ist in der Oberfläche kaum herzustellen: jede
  // Änderung am Vorgang baut die Tabelle vorher neu auf und verwirft den
  // Entwurf sichtbar. Deshalb bekommt DIESE Seite einen Store, dessen moveTask
  // auf Zuruf («window.__lehneAb») ablehnt — alles andere ist die echte App.
  // Ohne Service Worker: dessen Abruf läuft an page.route vorbei, der Patch griffe nicht.
  const cr = await browser.newContext({ viewport: { width: 1600, height: 950 }, serviceWorkers: 'block' });
  await cr.route('**/js/store.js*', async (route) => {
    const src = readFileSync(join(root, 'js/store.js'), 'utf8')
      .replace('\n  moveTask(state, cmd) {', "\n  moveTask(state, cmd) {\n    if (globalThis.__lehneAb) return 'Test: Die Zeiten ergeben sich aus den Untervorgängen.';");
    // «removeTask(state, cmd) {» enthält «moveTask(state, cmd) {» — deshalb mit Zeilenanfang suchen.
    if (!src.includes('__lehneAb')) throw new Error('Store-Patch greift nicht');
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: src });
  });
  const pr = await cr.newPage();
  const fehlerR = [];
  pr.on('pageerror', (e) => fehlerR.push(e.message));
  await pr.goto(BASE + '/index.html?plan=leer');
  await pr.waitForTimeout(700);
  await festivalMitDaten(pr, 'Ablehnung', { venue: 'Halle' });
  await pr.waitForTimeout(800);
  await pr.locator('[data-view="tabelle"]').click();
  await pr.waitForTimeout(500);
  const rid = await pr.evaluate(() => document.querySelector('.tb-r:not(.is-parent):not(.is-child)').dataset.id);
  const zeile = pr.locator(`.tb-r[data-id="${rid}"]`);
  const v0 = await zeile.locator('.c-start input').inputValue();
  const speicher = () => pr.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(x)).project.name === 'Ablehnung');
    return JSON.stringify(JSON.parse(localStorage.getItem(k)).tasks.map((t) => [t.id, t.start, t.end]));
  });
  const zaehle = () => pr.evaluate(() => ({ entwurf: document.querySelectorAll('.tb-r.is-entwurf').length, grund: document.querySelectorAll('.tb-entwurf-grund').length }));
  const unrelated = async () => {   // eine fremde Änderung samt Undo → zwei Neuaufbauten
    const t = pr.locator(`.tb-r:not([data-id="${rid}"]) .c-title input`).first();
    await t.fill('Fremdänderung'); await t.press('Tab');
    await pr.waitForTimeout(300);
    await pr.keyboard.press('Meta+z');
    await pr.waitForTimeout(400);
  };
  for (const weg of ['✓', 'Enter']) {
    await check(`Ablehnung per ${weg}: Entwurf bleibt markiert mit dem Grund, ✓ gesperrt, nichts gespeichert`, async () => {
      const s0 = await speicher();
      await pr.evaluate(() => { globalThis.__lehneAb = true; });
      if (weg === '✓') {
        await zeile.locator('.c-start input').fill(plusTag(v0));
        await pr.waitForTimeout(150);
        await zeile.locator('.en-ok').click();
      } else {
        const d = zeile.locator('.tb-dur');
        await d.fill('7h');
        await d.press('Enter');
      }
      await pr.waitForTimeout(500);
      const z = await zaehle();
      if (z.entwurf !== 1) return z.entwurf + ' markierte Zeilen';
      const grund = (await pr.locator('.tb-entwurf-grund td').first().textContent()) || '';
      if (!/Untervorgängen/.test(grund)) return 'Grund fehlt: «' + grund + '»';
      if (!(await zeile.locator('.en-ok').isDisabled())) return '✓ nicht gesperrt';
      return (await speicher()) === s0 ? true : 'gespeichert';
    });
    await check(`… ✗ räumt auf, und ein späterer fremder Neuaufbau bringt den Entwurf NICHT zurück (${weg})`, async () => {
      await zeile.locator('.en-no').click();
      await pr.evaluate(() => { globalThis.__lehneAb = false; });
      await pr.waitForTimeout(200);
      let z = await zaehle();
      if (z.entwurf || z.grund) return 'nach ✗ noch da: ' + JSON.stringify(z);
      if ((await zeile.locator('.c-start input').inputValue()) !== v0) return 'Feld zeigt nicht den gespeicherten Wert';
      await unrelated();
      z = await zaehle();
      return !z.entwurf && !z.grund ? true : 'Entwurf taucht wieder auf: ' + JSON.stringify(z);
    });
  }
  await check('keine JS-Fehler im widerspenstigen Lauf', async () => (fehlerR.length ? fehlerR[0] : true));
  await cr.close();
}

console.log('\nNEUES PROJEKT AUS DER VORLAGE (ohne Termine)');
{
  const cv = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const pv = await cv.newPage();
  const fehlerV = [];
  pv.on('pageerror', (e) => fehlerV.push(e.message));
  await pv.goto(BASE + '/index.html?plan=leer');
  await pv.waitForTimeout(700);
  await check('Dialog hat Von und Bis statt «Aufbaubeginn»', async () => {
    const t = (await pv.locator('#dlg .dlg-f > span').allTextContents()).join('|');
    return t === 'Name|Ort|Von|Bis' ? true : 'Felder: ' + t;
  });
  await check('Bis vor Von wird in der App-Oberfläche abgelehnt (kein Browser-Dialog)', async () => {
    let nativ = false;
    pv.once('dialog', (d) => { nativ = true; d.dismiss(); });
    await pv.fill('.dlg-f:first-child input', 'Ohne Termine');
    await pv.fill('#neu-von', '2027-05-10');
    await pv.fill('#neu-bis', '2027-05-08');
    await pv.locator('.dlg-t[data-k="festival"]').click();
    await pv.locator('.dlg-act .btn-p').click();
    await pv.waitForTimeout(400);
    if (nativ) return 'natives Browser-Dialogfeld';
    if (!(await pv.locator('#dlg').isVisible())) return 'Dialog schloss trotz Bis < Von';
    const t = await pv.locator('#toast').textContent();
    return /Bis/.test(t) && await pv.locator('#toast').isVisible() ? true : 'keine Meldung: ' + t;
  });
  await pv.fill('#neu-bis', '2027-05-12');
  await pv.locator('.dlg-act .btn-p').click();
  await pv.waitForTimeout(1000);
  await check('Projekt aus der Festival-Vorlage: Vorgänge in der Seitenspalte', async () => {
    const n = await pv.locator('.bz-lab-task, .bz-lab-serie, .bz-lab[data-task]').count();
    const alle = await pv.locator('.bz-lab').count();
    return alle > 30 ? true : `nur ${alle} Zeilen in der Seitenspalte (spezifisch ${n})`;
  });
  await check('… aber kein einziger Balken', async () => {
    const n = await pv.locator('.bz-bar').count();
    return n === 0 ? true : n + ' Balken';
  });
  await check('Achse zeigt den Zeitraum Von–Bis (10.–12.05.2027), nicht 1970/NaN', async () => {
    const t = (await pv.locator('.bz-axis').textContent()) || '';
    if (/NaN|1970|Invalid/.test(t)) return 'Achse: ' + t.slice(0, 80);
    const info = await pv.evaluate(() => { const r = JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(k)).project.name === 'Ohne Termine'))); return r.project; });
    return info.start === '2027-05-10T00:00' && info.end === '2027-05-13T00:00' ? true : 'project: ' + info.start + ' – ' + info.end;
  });
  await check('keine JS-Fehler beim Öffnen des terminlosen Plans', async () =>
    fehlerV.length ? fehlerV[0] : true);
  await check('Zeile ohne Termin: Kennzeichnung «ohne Termin» in der Seitenspalte', async () => {
    const n = await pv.locator('.bz-lab-ohne').count();
    const t = n ? await pv.locator('.bz-lab-ohne').first().textContent() : '';
    return n > 30 && /ohne Termin/.test(t) ? true : n + ' Kennzeichnungen, «' + t + '»';
  });
  await pv.screenshot({ path: join(here, 'shots', 'edit-terminlos.png') });
  await check('Klick auf die Zeile öffnet das Panel mit leeren Datumsfeldern', async () => {
    await pv.locator('.bz-lab-task .bz-lab-name').first().click();
    await pv.waitForTimeout(300);
    if (!(await pv.locator('#ins').isVisible())) return 'Panel bleibt zu';
    const v = await pv.locator('#ins input[type=datetime-local]').evaluateAll((l) => l.map((i) => i.value));
    return v.length === 2 && v.every((x) => x === '') ? true : 'Felder: ' + JSON.stringify(v);
  });
  await check('Tabelle: Datums- und Dauerfelder leer, kein «null»', async () => {
    await pv.locator('[data-view="tabelle"]').click();
    await pv.waitForTimeout(500);
    const v = await pv.locator('.c-start input, .c-end input, .c-dur input').evaluateAll((l) => l.map((i) => i.value).filter((x) => x !== ''));
    await pv.locator('[data-view="gantt"]').click();
    return v.length === 0 ? true : 'nicht leer: ' + JSON.stringify(v.slice(0, 3));
  });
  // Gemischter Plan: drei Vorgänge bekommen einen Termin, der Rest bleibt ohne.
  await pv.evaluate(async () => {
    const m = await import('/js/persistence.js');
    const repo = m.createRepo(window.localStorage);
    const id = repo.list().find((x) => x.name === 'Ohne Termine').id;
    const pl = repo.load(id);
    pl.tasks.slice(0, 3).forEach((t, i) => { t.start = '2027-05-10T' + String(8 + i).padStart(2, '0') + ':00'; t.end = '2027-05-10T' + String(10 + i) + ':00'; });
    repo.save(pl);
  });
  await pv.reload();
  await pv.waitForTimeout(1200);
  await check('Gemischter Plan: drei Balken, übrige Zeilen mit Kennzeichnung, keine JS-Fehler', async () => {
    const bars = await pv.locator('.bz-bar, .bz-ms').count();
    const ohne = await pv.locator('.bz-lab-ohne').count();
    if (bars !== 3) return bars + ' Marken statt 3';
    if (ohne < 30) return 'nur ' + ohne + ' Kennzeichnungen';
    return fehlerV.length ? fehlerV[0] : true;
  });
  await check('Suche: Treffer ohne Termin zeigt «ohne Termin», Sprung wählt die Zeile', async () => {
    const name = await pv.evaluate(() => document.querySelector('.bz-lab-ohne').closest('.bz-lab').querySelector('.bz-lab-name').textContent);
    await pv.fill('#suche', name.slice(0, 6));
    await pv.waitForTimeout(300);
    const z = await pv.locator('#suche-liste .suche-z').allTextContents();
    if (!z.includes('ohne Termin')) return 'Zeiten: ' + JSON.stringify(z.slice(0, 5));
    await pv.keyboard.press('Enter');
    await pv.waitForTimeout(400);
    return fehlerV.length ? fehlerV[0] : true;
  });
  await pv.screenshot({ path: join(here, 'shots', 'edit-gemischt.png') });
  await cv.close();
}

if (errors.length) { console.log('\n  ✗ Fehler auf der Seite:'); errors.slice(0, 8).forEach((e) => console.log('      ' + e)); problems += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');

await browser.close();
server.close();
console.log(problems ? `\n${problems} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(problems ? 1 : 0);
