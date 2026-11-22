// ── Bearbeiten im echten Browser prüfen ───────────────────────────────────────
// Die Unit-Tests decken die Logik ab. Hier geht es um das, was nur im Browser
// schiefgeht: Erststart, Dialog, Tippen, Speichern, Neuladen, Undo.
import { firefox, chromium } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mustFirefox, chromiumExe } from './browsers.mjs';
import { festivalMitDaten } from './festival-fixture.mjs';
import { createServer } from 'node:http';
import { planSeed } from './plan-fixture.mjs';

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

// Zeitumstellungs-Checks (25.10.2026 hat 25 Stunden) sind nur in dieser Zone bedeutungsvoll; die
// Unit-Tests laufen ebenfalls mit TZ=Europe/Berlin. Alle Kontexte dieser Datei sind darauf gepinnt.
const ZONE = 'Europe/Berlin';
const browser = await firefox.launch({ executablePath: exe });
const ctx = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('JS: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let problems = 0;
let skipped = 0;   // ehrlich zählen: «bestanden» heißt nicht «alles geprüft»
// ⌘Z in einem fokussierten Feld gehört dem Browser (Fund 11). Wer den Store-
// Undo prüft, löst vorher den Fokus, sonst greift der Guard in app.js.
const undoOhneFeld = async (pg = page) => {
  await pg.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  await pg.keyboard.press('Meta+z');
};
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
  await undoOhneFeld();   // die Dauer 6h zurück
  await page.waitForTimeout(400);
  const d = await page.locator('.tb-r .tb-dur').first().inputValue();
  if (d === '6h') return 'ein ⌘Z reichte nicht — Befehl liegt doppelt auf dem Stapel';
  await undoOhneFeld();   // die Umbenennung zurück
  await page.waitForTimeout(400);
  const v = await page.locator('.tb-r .c-title input').first().inputValue();
  return v !== 'Umbenannt durch Test' ? true : 'Umbenennung nicht zurück: ' + v;
});
await check('⌘Z im Titelfeld nimmt keinen Store-Befehl zurück (Verschiebung bleibt)', async () => {
  // Regression: das globale ⌘Z lief auch aus einem Textfeld heraus und machte
  // den letzten Store-Befehl (hier das Verschieben) rückgängig. Im Feld gehört
  // ⌘Z dem Browser.
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(400);
  const bar = page.locator('.bz-bar[data-task]').first();
  const id = await bar.getAttribute('data-task');
  const vorher = await bar.getAttribute('data-from');
  await bar.click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(400);
  const nach = await page.locator(`.bz-bar[data-task="${id}"]`).first().getAttribute('data-from');
  if (nach === null) return 'kein Balken gefunden';
  if (nach === vorher) return 'Alt+→ verschob nichts (' + vorher + ')';
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(400);
  const feld = page.locator('.tb-r .c-title input').first();
  await feld.click();
  await feld.press('End');
  await feld.pressSequentially('QQ');
  await page.keyboard.press('Meta+z');   // bewusst OHNE Fokuswechsel: ⌘Z im Feld gehört dem Browser
  await page.waitForTimeout(400);
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(400);
  const danach = await page.locator(`.bz-bar[data-task="${id}"]`).first().getAttribute('data-from');
  if (danach === null) return 'kein Balken gefunden';
  await page.locator('[data-view="tabelle"]').click();   // die Folgeprüfungen erwarten die Tabelle
  await page.waitForTimeout(300);
  return danach === nach ? true : 'Verschiebung zurückgenommen: ' + danach + ' statt ' + nach;
});
await check('⌘Z nach Gewerk-Wechsel in der Auswahlliste (Fokus bleibt im select) nimmt den Wechsel zurück', async () => {
  // Nur echte Texteingabe gehört dem Browser; ein select hat dort kein Undo.
  const id = await page.locator('.tb-r:has(.c-gw select)').first().getAttribute('data-id');
  const zeile = () => page.locator(`.tb-r[data-id="${id}"] .c-gw select`);
  const sel = zeile();
  const vorher = await sel.inputValue();
  const anders = await sel.evaluate((s, v) => [...s.options].map((o) => o.value).find((x) => x !== v), vorher);
  if (!anders) return 'kein zweites Gewerk zur Auswahl';
  await sel.selectOption(anders);
  await page.waitForTimeout(500);
  const neu = zeile();
  if ((await neu.inputValue()) !== anders) return 'Wechsel kam nicht an';
  await neu.focus();
  const fokus = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
  if (fokus !== 'SELECT') return 'Voraussetzung fehlt: Fokus liegt auf ' + fokus;
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(500);
  const danach = await zeile().inputValue();
  return danach === vorher ? true : `Gewerk ${vorher} → ${anders} → ${danach} (⌘Z im select ohne Wirkung)`;
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
  await undoOhneFeld();
  await page.waitForTimeout(400);
  return !(await page.locator('#resolve').isHidden()) ? true : 'Konflikt nicht zurück';
});
await undoOhneFeld();  // auch das Vorziehen zurück
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
  await undoOhneFeld();
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

console.log('\nPLAN VERSCHIEBEN');
await check('Plan verschieben: Tage 7 → Vorschau, Balken und Phase +7 Kalendertage, 0/0 gesperrt, ⌘Z stellt zurück', async () => {
  const bar = () => page.locator('.bz-bar', { hasText: 'Podest' }).first().evaluate((b) => +b.dataset.from);
  const oeffne = async () => {
    await page.locator('#rail-ein').click();
    await page.locator('[data-ein="projekt"]').click();
  };
  // Phasenbeginn aus dem Reiter «Phasen» lesen (die Achse trägt kein data-from).
  const phase = async () => {
    await oeffne();
    await page.locator('[data-ein="phasen"]').click();
    // Die Vorschau nennt den AUFBAUbeginn, also auch hier die Aufbau-Zeile.
    const v = await page.locator('.ph-z').evaluateAll((zs) => {
      const z = zs.find((n) => n.querySelector('.ph-art').value === 'aufbau');
      return z ? z.querySelector('.ph-von').value : null;
    });
    if (!v) throw new Error('keine Aufbau-Phase');
    await page.locator('#ein-zu').click();
    return v;
  };
  const plus7 = (iso) => {
    const d = new Date(iso); d.setDate(d.getDate() + 7);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + 'T' + iso.slice(11, 16);
  };
  const vor = await bar();
  const phVor = await phase();
  await oeffne();
  if (!(await page.locator('#plan-verschieben').count())) return '#plan-verschieben fehlt';
  await page.locator('#plan-verschieben').click();
  const ok = page.locator('.dlg-box .btn-p', { hasText: 'Verschieben' });
  if (!(await ok.isDisabled())) return '0/0 nicht gesperrt';
  await page.locator('.dlg-box .sv-tage').fill('7');
  const vorschau = await page.locator('.dlg-box .sv-vorschau').textContent();
  const d7 = new Date(phVor); d7.setDate(d7.getDate() + 7);
  const erw = String(d7.getDate()).padStart(2, '0') + '.' + String(d7.getMonth() + 1).padStart(2, '0') + '.';
  if (!/→/.test(vorschau) || !vorschau.includes(erw)) return `Vorschau «${vorschau}» nennt ${erw} nicht`;
  await ok.click();
  await page.waitForTimeout(400);
  await page.locator('#ein-zu').click();
  await page.waitForTimeout(300);
  const nach = await bar();
  const soll = Math.round(new Date(new Date(vor * 60000).setDate(new Date(vor * 60000).getDate() + 7)).getTime() / 60000);
  if (nach !== soll) return `Balken ${vor} → ${nach}, erwartet ${soll}`;
  const phNach = await phase();
  if (phNach !== plus7(phVor)) return `Phase ${phVor} → ${phNach}, erwartet ${plus7(phVor)}`;
  await undoOhneFeld();
  await page.waitForTimeout(400);
  if ((await bar()) !== vor) return '⌘Z stellt den Balken nicht zurück';
  const phZu = await phase();
  return phZu === phVor ? true : `Phase nach ⌘Z ${phZu}`;
});
await check('Plan verschieben: Feld «Stunden:Minuten» nimmt h:mm und reine Minuten, Vorschau und Sperre rechnen gleich', async () => {
  await page.locator('#rail-ein').click();
  await page.locator('[data-ein="projekt"]').click();
  await page.locator('#plan-verschieben').click();
  const ok = page.locator('.dlg-box .btn-p', { hasText: 'Verschieben' });
  const min = page.locator('.dlg-box .sv-min');
  if ((await min.getAttribute('type')) !== 'text') return 'Feld ist kein Textfeld (Doppelpunkt unmöglich)';
  if (!(await page.locator('.dlg-box', { hasText: 'Stunden:Minuten' }).count())) return 'Beschriftung «Stunden:Minuten» fehlt';
  const vor = async (w) => { await min.fill(w); return (await page.locator('.dlg-box .sv-vorschau').textContent()).trim(); };
  const uhr = (v) => { const m = v.match(/(\d\d):(\d\d)$/); return m ? +m[1] * 60 + +m[2] : null; };
  const p30 = await vor('0:30'), pm30 = await vor('30');
  if (p30 !== pm30) return `«0:30» «${p30}» ≠ «30» «${pm30}»`;
  if (await ok.isDisabled()) return '0:30 gesperrt';
  if ((await vor('1:30')) !== (await vor('90'))) return '1:30 und 90 rechnen verschieden';
  const pn = await vor('-30');
  if ((await vor('-0:30')) !== pn) return '-0:30 und -30 rechnen verschieden';
  if (uhr(p30) === null || uhr(pn) === null) return `keine Uhrzeit in der Vorschau: «${p30}» / «${pn}»`;
  if ((((uhr(p30) - uhr(pn)) % 1440) + 1440) % 1440 !== 60) return `+30 und −30 liegen nicht 60 Minuten auseinander: «${p30}» / «${pn}»`;
  for (const schlecht of ['1:75', '1:5', 'abc', '1:30:00', ':30']) {
    await min.fill(schlecht);
    if (!(await ok.isDisabled())) return `«${schlecht}» nicht gesperrt`;
  }
  await min.fill('-30');
  await ok.click();
  await page.waitForTimeout(300);
  const toast = await page.locator('#toast').textContent();
  await page.locator('#ein-zu').click();
  await undoOhneFeld();
  await page.waitForTimeout(300);
  return /30 Minuten/.test(toast) && /−/.test(toast) ? true : 'Hinweis «' + toast + '»';
});
await check('Plan verschieben: Escape schließt nur den Dialog, Einrichten bleibt; Riesenwert sperrt den Knopf ohne NaN', async () => {
  await page.locator('#rail-ein').click();
  await page.locator('[data-ein="projekt"]').click();
  await page.locator('#plan-verschieben').click();
  const ok = page.locator('.dlg-box .btn-p', { hasText: 'Verschieben' });
  await page.locator('.dlg-box .sv-tage').fill('99999999999');
  if (!(await ok.isDisabled())) return 'Riesenwert nicht gesperrt';
  if ((await page.locator('.dlg-box .sv-vorschau').textContent()).includes('NaN')) return 'NaN in der Vorschau';
  await page.locator('.dlg-box .sv-tage').fill('36501');
  if (!(await ok.isDisabled())) return '36501 Tage nicht gesperrt';
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  if (await page.locator('.sv-vorschau').count()) return 'Dialog noch offen';
  if (!(await page.locator('#ein-dlg').isVisible())) return 'Escape hat auch Einrichten geschlossen';
  await page.locator('#ein-zu').click();
  return true;
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
  await undoOhneFeld();
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

await check('Wechsel über den Projektdialog verwirft den Entwurf', async () => {
  // Zeilen-Ids (t0, t1 …) wiederholen sich zwischen Projekten: ein Entwurf aus A
  // würde sonst in der gleichnamigen Zeile von B wieder aufgehen. Der Wechsel
  // läuft per DOM-click, damit kein focusout den Entwurf schon vorher verwirft.
  // Projekt B ist eine KOPIE von A (gleiche Zeilen-Ids UND gleiche Zeiten) — nur
  // dann würde die Wiederöffnungs-Regel (Zeiten stimmen) allein den Entwurf
  // zurückholen. Hier greift aber schon focusout (der Dialog nimmt den Fokus) — die
  // Sperre für table.js:72 selbst steht in verify-sync («Löschen unter offenem Entwurf»).
  await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('bzp_projects'));
    const a = idx.find((e) => e.name === 'Testprojekt Halle 7');
    const plan = JSON.parse(localStorage.getItem('bzp_p_' + a.id));
    plan.project.id = 'kopie-entwurf'; plan.project.name = 'Kopie Entwurf';
    localStorage.setItem('bzp_p_kopie-entwurf', JSON.stringify(plan));
    localStorage.setItem('bzp_projects', JSON.stringify([...idx, { ...a, id: 'kopie-entwurf', name: 'Kopie Entwurf' }]));
  });
  await page.reload();
  await page.waitForTimeout(900);
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(500);
  const zeile = page.locator('.tb-r:not(.is-parent):not(.is-child)').first();
  const id = await zeile.getAttribute('data-id');
  const wert0 = await zeile.locator('.c-start input').inputValue();
  await zeile.locator('.c-start input').fill(new Date(new Date(wert0 + ':00Z').getTime() + 86400000).toISOString().slice(0, 16));
  await page.waitForTimeout(300);
  if (!(await page.locator('.tb-r.is-entwurf').count())) return 'Entwurf nicht offen (Vorbedingung)';
  const wechsle = async (name) => {
    await page.evaluate(() => document.querySelector('#proj-menu').click());
    await page.waitForTimeout(400);
    await page.evaluate((n) => [...document.querySelectorAll('.dlg-open')].find((b) => b.textContent.includes(n)).click(), name);
    await page.waitForTimeout(1000);
  };
  await wechsle('Kopie Entwurf');
  const inB = await page.locator('.tb-r.is-entwurf').count();
  await wechsle('Testprojekt Halle 7');
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(500);
  const inA = await page.locator('.tb-r.is-entwurf').count();
  const wertA = await page.locator(`.tb-r[data-id="${id}"] .c-start input`).inputValue();
  const store = await page.evaluate((i) => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(x)).project.name === 'Testprojekt Halle 7');
    const t = JSON.parse(localStorage.getItem(k)).tasks.find((x) => x.id === i);
    return t.start;
  }, id);
  await page.evaluate(() => {
    localStorage.removeItem('bzp_p_kopie-entwurf');
    localStorage.setItem('bzp_projects', JSON.stringify(JSON.parse(localStorage.getItem('bzp_projects')).filter((e) => e.id !== 'kopie-entwurf')));
  });
  if (inB) return 'Entwurf taucht im anderen Projekt auf (' + inB + ')';
  if (inA) return 'Entwurf nach der Rückkehr noch offen (' + inA + ')';
  return wertA === store.slice(0, 16) && wertA === wert0 ? true : `Feld ${wertA}, Store ${store}, vorher ${wert0}`;
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
  await undoOhneFeld();
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
  const hinweis = (await page.locator('#toast').textContent()) || '';
  if (!/Entwurf verworfen — ✓ oder Enter übernimmt/.test(hinweis) || !(await page.locator('#toast').isVisible())) return 'kein Hinweis beim Verlassen: «' + hinweis + '»';
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
  await undoOhneFeld();
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
  await undoOhneFeld();
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
  // Store-Undo über den Knopf OHNE Fokuswechsel (dispatchEvent): ein echter
  // Klick aufs Feld-Umfeld verwirft den Entwurf (Absicht), das soll dieser Check nicht prüfen.
  await page.locator('#undo').dispatchEvent('click');
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
  await undoOhneFeld();
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
  await undoOhneFeld();      // nimmt GENAU diesen Vorgang zurück
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
  await undoOhneFeld();
  return JSON.stringify(await stand()) === JSON.stringify(s0) ? true : 'ein ⌘Z reichte nicht';
});
await check('Panel: ein Undo in der TABELLE (anderer Vorgang) wirft den offenen Panel-Entwurf nicht weg', async () => {
  const titel = () => page.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(x)).project.name === 'Testprojekt Halle 7');
    return JSON.parse(localStorage.getItem(k)).tasks.map((t) => t.title);
  });
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(300);
  const t = page.locator('.tb-r:not(.is-parent) .c-title input').first();
  await t.fill('Panel-Undo-Test');
  await t.press('Tab');
  await page.waitForTimeout(1200);
  if (!(await titel()).includes('Panel-Undo-Test')) return 'Umbenennung nicht angekommen';
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(400);
  await page.locator('.bz-lab-task .bz-lab-name', { hasNotText: 'Panel-Undo-Test' }).nth(4).click();
  await page.waitForTimeout(300);
  const st = page.locator('.ins-termin input[type=datetime-local]').first();
  const v0 = await st.inputValue();
  await st.fill(plusTag(v0));
  await page.waitForTimeout(200);
  if (!(await page.locator('.ins-termin.is-entwurf').count())) return 'Panel-Entwurf nicht offen';
  await page.locator('#undo').dispatchEvent('click');   // Store-Undo ohne Fokuswechsel, Panel-Entwurf bleibt offen
  await page.waitForTimeout(1200);
  if ((await titel()).includes('Panel-Undo-Test')) return 'der Undo hat nicht gegriffen';
  const offen = await page.locator('.ins-termin.is-entwurf').count();
  const wert = await page.locator('.ins-termin input[type=datetime-local]').first().inputValue();
  if (!offen) return 'Panel-Entwurf ist weg';
  if (wert !== plusTag(v0)) return 'Entwurfswert ' + wert;
  await page.locator('.ins-termin .en-no').click();   // aufräumen
  return true;
});
await check('Panel: Klick aus den Feldern verwirft den Entwurf MIT Hinweis (✓ oder Enter übernimmt)', async () => {
  const st = page.locator('.ins-termin input[type=datetime-local]').first();
  const v0 = await st.inputValue();
  await st.fill(plusTag(v0));
  await page.waitForTimeout(200);
  await page.locator('.ins-title').click();
  await page.waitForTimeout(300);
  const hinweis = (await page.locator('#toast').textContent()) || '';
  if (await page.locator('.ins-termin.is-entwurf').count()) return 'Entwurf blieb offen';
  return /Entwurf verworfen — ✓ oder Enter übernimmt/.test(hinweis) && (await page.locator('#toast').isVisible()) ? true : 'Hinweis: «' + hinweis + '»';
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

  await undoOhneFeld();
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
  const c2 = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
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
  const c3 = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
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
    // (d) Eine zweite eigene Projektzeile (Alpha) aus dem Projektdialog öffnen, dann Abbrechen:
    // Dialog bleibt, altes Projekt (Beta) bleibt aktiv.
    await aendern('Geändert-3');
    await p3.locator('#rail-ein').click();
    await p3.locator('#proj-menu').click();
    await p3.waitForTimeout(300);
    await p3.locator('.dlg-open', { hasText: 'Alpha' }).first().click();
    await p3.waitForTimeout(800);
    if ((await p3.locator('.dlg-h', { hasText: 'Nicht gespeichert' }).count()) !== 1) return '(d) kein Dialog beim Wechsel zur zweiten Projektzeile';
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
  const c4 = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
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
  const c5 = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
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
  const c6 = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
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

console.log('\nTOUCH: VERKNÜPFEN-GRIFF NUR AM AUSGEWÄHLTEN BALKEN (Handy 390×844)');
{
  // Firefox kennt hasTouch/isMobile nicht — ohne sie greift `pointer: coarse`
  // nicht. Darum Chromium.
  const chromExe = chromiumExe();
  if (!chromExe) { skipped++; console.log('  – übersprungen: Chromium nicht installiert (npx playwright install chromium).'); }
  else {
    const cb = await chromium.launch({ executablePath: chromExe });
    const ct = await cb.newContext({ timezoneId: ZONE, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const pt = await ct.newPage();
    pt.on('pageerror', (e) => errors.push('JS: ' + e.message));
    try {
      await pt.goto(BASE + '/index.html?plan=leer');
      await pt.waitForTimeout(700);
      await festivalMitDaten(pt, 'Touch-Test', { loadIn: '2026-08-05T06:00' });
      await pt.waitForTimeout(900);
      await pt.locator('[data-view="gantt"]').tap();
      await pt.waitForTimeout(500);
      const sichtbar = () => pt.evaluate(() => [...document.querySelectorAll('.bz-link')]
        .filter((h) => getComputedStyle(h).opacity !== '0').map((h) => h.dataset.linkFrom));
      await check('Touch-Kontext ist grob (pointer: coarse)', async () =>
        (await pt.evaluate(() => matchMedia('(pointer: coarse)').matches)) ? true : 'pointer: coarse greift nicht');
      await check('vor der Auswahl ist kein Verknüpfen-Griff sichtbar', async () => {
        const v = await sichtbar();
        return v.length === 0 ? true : v.length + ' Griffe sichtbar';
      });
      await check('unsichtbare Griffe fangen auf Touch keine Fingertipps (Treffer am Kreis ist nicht der Griff)', async () => {
        const r = await pt.evaluate(() => {
          let geprueft = 0; const faenger = [];
          for (const h of document.querySelectorAll('.bz-link:not(.is-sel)')) {
            const b = h.getBoundingClientRect();
            const x = b.left + (h.classList.contains('bz-link-ms') ? 9 : 0) + 12, y = b.top;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
            geprueft++;
            const hit = document.elementFromPoint(x, y);
            if (hit && hit.closest('.bz-link')) faenger.push(h.dataset.linkFrom);
          }
          return { geprueft, faenger };
        });
        if (r.geprueft < 1) return 'Voraussetzung: nur ' + r.geprueft + ' Griffe im Bild geprüft';
        return r.faenger.length === 0 ? true : r.faenger.length + ' unsichtbare Griffe fangen Tipps';
      });
      await check('Antippen von «Podest» zeigt genau EINEN Griff, den von «Podest»', async () => {
        const bar = pt.locator('.bz-bar', { hasText: 'Podest' }).first();
        await bar.scrollIntoViewIfNeeded();
        const id = await bar.evaluate((n) => n.dataset.task);
        await bar.tap();
        await pt.waitForTimeout(400);
        const v = await sichtbar();
        return v.length === 1 && v[0] === id ? true : `sichtbar: [${v}], erwartet [${id}]`;
      });
      await check('Beschriftung eines Balkens wird von keinem sichtbaren Griff überdeckt', async () => {
        const r = await pt.evaluate(() => {
          // Sichtbar = weder visibility:hidden noch opacity:0 (so wie es der Finger sieht).
          const sich = [...document.querySelectorAll('.bz-link')].filter((h) => {
            const c = getComputedStyle(h);
            return c.visibility !== 'hidden' && c.opacity !== '0';
          });
          // Der Kreis ist das ::after: Box aus seinen echten berechneten Werten
          // (left, top, Größe + Polster, translate), nicht aus einer festen Annahme.
          const kreise = sich.map((h) => {
            const b = h.getBoundingClientRect();
            const a = getComputedStyle(h, '::after');
            const m = new DOMMatrix(a.transform === 'none' ? undefined : a.transform);
            const pad = parseFloat(a.paddingLeft) || 0;
            const w = parseFloat(a.width) + 2 * pad, hh = parseFloat(a.height) + 2 * pad;
            const l = b.left + parseFloat(a.left) + m.e, t = b.top + parseFloat(a.top) + m.f;
            return { l, r: l + w, t, b: t + hh, id: h.dataset.linkFrom };
          });
          const out = [];
          let beschriftungen = 0;
          for (const t of document.querySelectorAll('.bz-bar-t')) {
            const q = t.getBoundingClientRect();
            if (!q.width || !q.height) continue;
            beschriftungen++;
            const bar = t.closest('[data-task]');
            for (const k of kreise) {
              if (bar && bar.dataset.task === k.id) continue; // der eigene Griff liegt neben dem Balken
              if (q.left < k.r && q.right > k.l && q.top < k.b && q.bottom > k.t) out.push(t.textContent.trim());
            }
          }
          return { out, griffe: kreise.length, beschriftungen };
        });
        if (r.griffe !== 1) return 'Voraussetzung: ' + r.griffe + ' sichtbare Griffe statt 1';
        if (r.beschriftungen < 2) return 'Voraussetzung: keine Beschriftungen zum Vergleich';
        return r.out.length === 0 ? true : 'überdeckt: ' + r.out.join(', ');
      });
      await pt.screenshot({ path: join(here, 'shots', 'touch-griff.png') });
      await check('Panel schließen hebt die Auswahl auf — kein Griff mehr sichtbar', async () => {
        // Auf dem Handy ragt das Panel über den Rand (× liegt nahe am Bildrand) — der
        // Schließen-Klick ist hier nicht der Prüfgegenstand.
        await pt.locator('.ins-x').evaluate((n) => n.click());
        await pt.waitForTimeout(400);
        const v = await sichtbar();
        return v.length === 0 ? true : 'noch sichtbar: ' + v;
      });
      await check('Antippen eines anderen Balkens: wieder genau EIN Griff, der des angetippten', async () => {
        // Echter Fingertipp auf einen Balken, der nicht vom Kopf verdeckt ist.
        const ziel = await pt.evaluate(() => {
          for (const b of document.querySelectorAll('.bz-bar')) {
            const r = b.getBoundingClientRect();
            const x = r.left + Math.min(r.width / 2, 20), y = r.top + r.height / 2;
            if (x < 0 || y < 120 || x > innerWidth || y > innerHeight - 4) continue;
            const hit = document.elementFromPoint(x, y);
            if (hit && b.contains(hit)) return { x, y, id: b.dataset.task };
          }
          return null;
        });
        if (!ziel) return 'kein antippbarer Balken im Bild';
        await pt.touchscreen.tap(ziel.x, ziel.y);
        await pt.waitForTimeout(400);
        const v = await sichtbar();
        return v.length === 1 && v[0] === ziel.id ? true : `sichtbar: [${v}], erwartet [${ziel.id}]`;
      });
    } finally { await cb.close(); }
  }
}

console.log('\nBALKEN ZIEHEN (Verschieben, Ende, Escape, Klick, Griffe, Tastatur)');
{
  const cz = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
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
  const cr = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 }, serviceWorkers: 'block' });
  await cr.route('**/js/store.js*', async (route) => {
    const src = readFileSync(join(root, 'js/store.js'), 'utf8')
      .replace('\n  moveTask(state, cmd) {', "\n  moveTask(state, cmd) {\n    if (globalThis.__lehneAb) return 'Test: Die Zeiten ergeben sich aus den Untervorgängen.';");
    // «removeTask(state, cmd) {» enthält «moveTask(state, cmd) {» — deshalb mit Zeilenanfang suchen.
    if (!src.includes('__lehneAb')) throw new Error('Store-Patch greift nicht');
    // Marker IN der Seite: beweist, dass der Browser die gepatchte Fassung geladen hat.
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: 'globalThis.__storePatch = true;\n' + src });
  });
  const pr = await cr.newPage();
  const fehlerR = [];
  pr.on('pageerror', (e) => fehlerR.push(e.message));
  await pr.goto(BASE + '/index.html?plan=leer');
  await pr.waitForTimeout(700);
  await check('Store-Patch greift in der Seite (sonst wäre jede Ablehnungsprüfung hohl)', async () =>
    (await pr.evaluate(() => globalThis.__storePatch === true)) ? true : 'die Seite lief mit dem ungepatchten Store');
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
    await undoOhneFeld(pr);
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
  await check('Entwurf in einer Zeile, die danach nicht mehr gerendert wird (Anlegen rückgängig), fällt SICHTBAR weg', async () => {
    const ids0 = await pr.locator('.tb-r').evaluateAll((l) => l.map((r) => r.dataset.id));
    await pr.locator('.tb-add').first().click();
    await pr.waitForTimeout(500);
    const neu = (await pr.locator('.tb-r').evaluateAll((l) => l.map((r) => r.dataset.id))).find((i) => !ids0.includes(i));
    if (!neu) return 'keine neue Zeile';
    const f = pr.locator(`.tb-r[data-id="${neu}"] .c-start input`);
    await f.fill(plusTag(await f.inputValue()));
    await pr.waitForTimeout(200);
    if (!(await pr.locator(`.tb-r[data-id="${neu}"].is-entwurf`).count())) return 'Entwurf nicht offen';
    await undoOhneFeld(pr);      // nimmt das Anlegen zurück: die Zeile gibt es nicht mehr
    await pr.waitForTimeout(500);
    const da = await pr.locator(`.tb-r[data-id="${neu}"]`).count();
    const toast = (await pr.locator('#toast').textContent()) || '';
    const z = await zaehle();
    if (da) return 'Zeile noch da — der Undo hat nicht gegriffen';
    return !z.entwurf && !z.grund && /Entwurf verworfen/.test(toast) && (await pr.locator('#toast').isVisible()) ? true : `entwurf=${z.entwurf} grund=${z.grund} toast=«${toast}»`;
  });
  await check('keine JS-Fehler im widerspenstigen Lauf', async () => (fehlerR.length ? fehlerR[0] : true));
  await cr.close();
}

console.log('\nNEUES PROJEKT AUS DER VORLAGE (ohne Termine)');
{
  const cv = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
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

// ── PHASEN: Leiste, Show-Tage, Editor, «heute» ────────────────────────────────
// Eigener Kontext mit gestellter Uhr: «heute: Show-Tag 2» ist nur prüfbar, wenn
// die Uhr mitten in der Show steht. Die Fixture beginnt am 14.09.2026 06:00 —
// Aufbau 14.–18.09.; zwei Show-Phasen = zwei Showtage (Fr 18:00–Sa 02:00, Sa 18:00–So 02:00).
{
  console.log('\nPHASEN');
  const cp = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
  const pp = await cp.newPage();
  const fehlerP = [];
  pp.on('pageerror', (e) => fehlerP.push(e.message));
  pp.on('console', (m) => { if (m.type() === 'error') fehlerP.push('console: ' + m.text()); });
  await pp.clock.install({ time: new Date('2026-09-19T20:00:00') });
  await pp.goto(BASE + '/index.html?plan=leer');
  await pp.waitForTimeout(600);
  await festivalMitDaten(pp, 'Phasen-Test', { loadIn: '2026-09-14T06:00', phasen: [
    { name: 'Planung', start: '2026-07-06T06:00', end: '2026-09-11T06:00' },
    { name: 'Aufbau', start: '2026-09-14T06:00', end: '2026-09-18T06:00' },
    { name: 'Show', start: '2026-09-18T18:00', end: '2026-09-19T02:00' },
    { name: 'Show', start: '2026-09-19T18:00', end: '2026-09-20T02:00' },
    { name: 'Abbau', start: '2026-09-20T02:00', end: '2026-09-22T12:00' },
  ] });
  await pp.waitForTimeout(1000);
  const seg = (txt) => pp.locator('.bz-axis-phase .bz-ph', { hasText: txt });
  const bg = (loc) => loc.first().evaluate((n) => getComputedStyle(n).backgroundColor);

  await check('Leiste: Planung, Aufbau, zwei Show-Phasen = Show-Tag 1 und 2, Abbau', async () => {
    const t = (await pp.locator('.bz-axis-phase .bz-ph-t').allTextContents()).map((x) => x.trim());
    const soll = ['Planung', 'Aufbau', 'Show-Tag 1', 'Show-Tag 2', 'Abbau'];
    return JSON.stringify(t) === JSON.stringify(soll) ? true : JSON.stringify(t);
  });
  await check('jede Art hat ihre eigene Farbe in der Leiste (4 Arten → 4 verschiedene Farben)', async () => {
    const f = new Set([await bg(seg('Planung')), await bg(seg('Aufbau')), await bg(seg('Show-Tag 1')), await bg(seg('Abbau'))]);
    return f.size === 4 ? true : [...f].join(' | ');
  });
  await check('Tönung im Zeitstrahl: je Phase eine Fläche, Show anders als Aufbau', async () => {
    const n = await pp.locator('.bz-phase').count();
    if (n !== 5) return n + ' Flächen statt 5';
    const a = await pp.locator('.bz-phase-aufbau').evaluate((e) => getComputedStyle(e).backgroundColor);
    const s2 = await pp.locator('.bz-phase-show').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    return a !== s2 && a !== 'rgba(0, 0, 0, 0)' ? true : a + ' / ' + s2;
  });
  await check('Kopfzeile: «heute: Show-Tag 2» bei gestellter Uhr (19.09. 20:00)', async () => {
    const n = pp.locator('#phase-heute');
    if (!(await n.isVisible())) return 'unsichtbar';
    const t = (await n.textContent()).trim();
    return t === 'heute: Show-Tag 2' ? true : t;
  });
  await pp.screenshot({ path: join(here, 'shots', 'phasen-strip-hell.png'), clip: { x: 0, y: 0, width: 1600, height: 330 } });
  await check('Kopfzeile: außerhalb jeder Phase verschwindet die Marke', async () => {
    await pp.clock.setSystemTime(new Date('2026-12-30T10:00:00'));
    await pp.clock.runFor('00:20');
    await pp.waitForTimeout(300);
    return (await pp.locator('#phase-heute').isHidden()) ? true : 'noch sichtbar: ' + (await pp.locator('#phase-heute').textContent());
  });
  await check('Kopfzeile: im Aufbau «heute: Aufbau»', async () => {
    await pp.clock.setSystemTime(new Date('2026-09-15T10:00:00'));
    await pp.clock.runFor('00:20');
    await pp.waitForTimeout(300);
    const t = (await pp.locator('#phase-heute').textContent()).trim();
    return t === 'heute: Aufbau' ? true : t;
  });

  // Einrichten → Phasen
  await pp.locator('#rail-ein').click();
  await pp.locator('[data-ein="phasen"]').click();
  await check('Reiter «Phasen» listet die fünf Phasen', async () => {
    const n = await pp.locator('.ph-z').count();
    return n === 5 ? true : n + ' Zeilen';
  });
  await check('Phasen-Reiter: je Phase EINE Reihe — Art, Name, Von–Bis, × auf einer Höhe (kein einsames ×)', async () => {
    const r = await pp.locator('.ph-z').evaluateAll((ns) => ns.map((n) => {
      const a = n.querySelector('.ph-art').getBoundingClientRect(), d = n.querySelector('.ph-del').getBoundingClientRect(), b = n.querySelector('.ph-bis').getBoundingClientRect();
      return { dy: Math.abs(d.top - a.top), by: Math.abs(b.top - a.top), h: n.getBoundingClientRect().height };
    }));
    const schlecht = r.filter((x) => x.dy > 12 || x.by > 12);
    return schlecht.length ? JSON.stringify(r) : true;
  });
  await check('Show-Tag-Notiz steht unter der Art, nicht neben dem ×', async () => {
    const n = await pp.locator('.ph-z', { has: pp.locator('select[data-art="show"]') }).first().evaluate((z) => {
      const t = z.querySelector('.ph-tage').getBoundingClientRect(), a = z.querySelector('.ph-art').getBoundingClientRect();
      return { unter: t.top >= a.bottom - 1, text: z.querySelector('.ph-tage').textContent };
    });
    return n.unter && /^Show-Tag 1$/.test(n.text) ? true : JSON.stringify(n);
  });
  await check('jedes Leistenetikett trägt den vollen Text als aria-label', async () => {
    const f = await pp.locator('.bz-axis-phase .bz-ph').evaluateAll((ns) => ns.filter((n) => !n.getAttribute('aria-label')).length);
    return f === 0 ? true : f + ' ohne aria-label';
  });
  await pp.screenshot({ path: join(here, 'shots', 'phasen-tab-hell.png') });
  const zeileArt = (art) => pp.locator('.ph-z', { has: pp.locator(`select[data-art="${art}"]`) });
  await check('+ Phase legt eine Phase einer noch unbenutzten Art an (Vorbereitung)', async () => {
    await pp.locator('#ei-ph-add').click();
    await pp.waitForTimeout(150);
    return (await zeileArt('vorbereitung').count()) === 1 && (await pp.locator('.ph-z').count()) === 6 ? true : 'keine neue Zeile';
  });
  await check('Von/Bis: tippen ist nur ein ENTWURF (✓ ✗ erscheinen, Leiste bleibt), ✓ übernimmt', async () => {
    const z = zeileArt('vorbereitung');
    const x0 = await seg('Vorbereitung').first().evaluate((n) => n.style.left);
    await z.locator('.ph-von').fill('2026-09-12T08:00');
    await z.locator('.ph-bis').fill('2026-09-13T08:00');
    await pp.waitForTimeout(100);
    if (!(await z.locator('.en-ok').isVisible())) return '✓ fehlt';
    if ((await z.evaluate((n) => n.classList.contains('is-entwurf'))) !== true) return 'Zeile nicht markiert';
    const x1 = await seg('Vorbereitung').first().evaluate((n) => n.style.left);
    if (x0 !== x1) return 'die Leiste hat sich schon vor ✓ bewegt';
    await z.locator('.en-ok').click();
    await pp.waitForTimeout(200);
    const x2 = await seg('Vorbereitung').first().evaluate((n) => n.style.left);
    return x2 !== x0 && (await pp.locator('.ph-z.is-entwurf').count()) === 0 ? true : `links ${x0} → ${x2}`;
  });
  await check('✗ verwirft den Entwurf: Feld springt zurück, nichts ändert sich', async () => {
    const z = zeileArt('vorbereitung');
    await z.locator('.ph-von').fill('2026-09-01T08:00');
    await z.locator('.en-no').click();
    await pp.waitForTimeout(100);
    return (await z.locator('.ph-von').inputValue()) === '2026-09-12T08:00' ? true : await z.locator('.ph-von').inputValue();
  });
  await check('gleiche Art darf nicht überlappen: Art auf «Aufbau» wird abgelehnt, Zeile bleibt Vorbereitung', async () => {
    const z = zeileArt('vorbereitung');
    // Vorbereitung auf den Aufbau-Zeitraum legen, dann Art wechseln — der Wechsel selbst kollidiert.
    await z.locator('.ph-von').fill('2026-09-15T08:00');
    await z.locator('.ph-bis').fill('2026-09-16T08:00');
    await z.locator('.en-ok').click();
    await pp.waitForTimeout(150);
    await zeileArt('vorbereitung').locator('.ph-art').selectOption('aufbau');
    await pp.waitForTimeout(250);
    const toast = (await pp.locator('#toast').textContent()) || '';
    if (!/überschneid/i.test(toast)) return 'keine Ablehnung: «' + toast + '»';
    return (await zeileArt('vorbereitung').count()) === 1 ? true : 'Art wurde trotzdem geändert';
  });
  await check('Löschen fragt über den App-Dialog (kein Browser-Dialog) und löscht erst nach «Löschen»', async () => {
    let nativ = false;
    pp.once('dialog', (d) => { nativ = true; d.dismiss(); });
    await zeileArt('vorbereitung').locator('.ph-del').click();
    await pp.waitForTimeout(150);
    if (!(await pp.locator('.dlg:not([hidden]) .dlg-h', { hasText: 'Phase löschen?' }).isVisible())) return 'kein App-Dialog';
    await pp.locator('.dlg:not([hidden]) .btn', { hasText: 'Abbrechen' }).click();
    if ((await pp.locator('.ph-z').count()) !== 6) return 'Abbrechen hat trotzdem gelöscht';
    await zeileArt('vorbereitung').locator('.ph-del').click();
    await pp.locator('.dlg:not([hidden]) .btn-danger').click();
    await pp.waitForTimeout(200);
    if (nativ) return 'nativer Dialog';
    return (await pp.locator('.ph-z').count()) === 5 ? true : (await pp.locator('.ph-z').count()) + ' Zeilen';
  });
  await pp.locator('#ein-zu').click();

  // Klick auf die Leiste → derselbe Editor als Kasten
  await check('Klick auf die Leiste öffnet den Editor als Kasten (Abbau), Bis mit ✓ ändern verkürzt den Balken', async () => {
    const s0 = seg('Abbau').first();
    const w0 = await s0.evaluate((n) => parseFloat(n.style.width));
    await s0.click();
    await pp.waitForTimeout(200);
    const box = pp.locator('.ph-box');
    if (!(await box.isVisible())) return 'kein Kasten';
    if ((await box.locator('select.ph-art').inputValue()) !== 'abbau') return 'falsche Zeile im Kasten';
    await box.locator('.ph-bis').fill('2026-09-21T12:00');   // verkürzen: Verlängern klemmt am Planende
    await box.locator('.en-ok').click();
    await pp.waitForTimeout(250);
    const w1 = await seg('Abbau').first().evaluate((n) => parseFloat(n.style.width));
    return w1 < w0 - 1 && (await pp.locator('.ph-box').isVisible()) ? true : `Breite ${w0} → ${w1}`;
  });
  await pp.screenshot({ path: join(here, 'shots', 'phasen-kasten-hell.png'), clip: { x: 0, y: 0, width: 1600, height: 330 } });
  await check('Escape schließt den Kasten; Enter auf der fokussierten Leiste öffnet ihn wieder (Tastatur)', async () => {
    await pp.keyboard.press('Escape');
    if (await pp.locator('.ph-box').count()) return 'Kasten noch offen';
    await seg('Aufbau').first().focus();
    await pp.keyboard.press('Enter');
    await pp.waitForTimeout(150);
    if (!(await pp.locator('.ph-box').isVisible())) return 'Enter öffnet nichts';
    await pp.keyboard.press('Escape');
    await seg('Aufbau').first().focus();
    await pp.keyboard.press(' ');
    await pp.waitForTimeout(150);
    const ok = await pp.locator('.ph-box').isVisible();
    await pp.keyboard.press('Escape');
    return ok ? true : 'Leertaste öffnet nichts';
  });
  await check('⌘Z/Undo macht die Verkürzung rückgängig (ein Schritt)', async () => {
    const w0 = await seg('Abbau').first().evaluate((n) => parseFloat(n.style.width));
    await pp.locator('#undo').click();
    await pp.waitForTimeout(200);
    const w1 = await seg('Abbau').first().evaluate((n) => parseFloat(n.style.width));
    return w1 > w0 + 1 ? true : `Breite ${w0} → ${w1}`;
  });
  // Weit herauszoomen: die Leiste zeigt alle Phasen auf einmal (Planung bis Abbau).
  await pp.clock.setSystemTime(new Date('2026-09-19T20:00:00'));
  for (let i = 0; i < 5; i++) await pp.locator('#zout').click();
  // Den Anfang des Aufbaus an den linken Rand der Zeitachse rücken: von dort
  // sind Aufbau, zwei Show-Tage und Abbau in einem Bild.
  await pp.evaluate(() => {
    const sc = document.querySelector('.bz-scroll');
    const a = [...document.querySelectorAll('.bz-axis-phase .bz-ph')].find((n) => /Aufbau/.test(n.textContent));
    sc.scrollLeft = parseFloat(a.style.left) - 20;
  });
  await pp.waitForTimeout(400);
  await check('JETZT-Fähnchen liegt UNTER der Achse (Phasen-Leiste und Datumszeilen bleiben frei)', async () => {
    const r = await pp.evaluate(() => ({ f: document.querySelector('.bz-now-flag').getBoundingClientRect().top, a: document.querySelector('.bz-axis').getBoundingClientRect().bottom }));
    return r.f >= r.a - 1 ? true : `Fähnchen ${r.f} < Achsenende ${r.a}`;
  });
  await check('weit herausgezoomt: jedes Show-Etikett trägt seine Nummer (Show-Tag/Tag/★ je nach Breite), nichts abgeschnitten', async () => {
    const t = (await pp.locator('.bz-axis-phase .bz-ph-t').allTextContents()).map((x) => x.trim());
    const show = t.filter((x) => /Show-Tag|^Tag|★/.test(x));
    if (show.length !== 2 || !show.every((x, i) => x.endsWith(String(i + 1)))) return JSON.stringify(t);
    const ab = await pp.locator('.bz-axis-phase .bz-ph').evaluateAll((ns) => ns.filter((n) => n.querySelector('.bz-ph-t').scrollWidth + 6 > n.clientWidth && n.clientWidth > 0).map((n) => n.textContent));
    return ab.length === 0 ? true : 'abgeschnitten: ' + JSON.stringify(ab);
  });
  await check('Sa 01:00 (nach Mitternacht) gehört noch zu «Show-Tag 1»', async () => {
    await pp.clock.setSystemTime(new Date('2026-09-19T01:00:00'));
    await pp.clock.runFor('00:20');
    await pp.waitForTimeout(300);
    const t = (await pp.locator('#phase-heute').textContent()).trim();
    await pp.clock.setSystemTime(new Date('2026-09-19T20:00:00'));
    await pp.clock.runFor('00:20');
    return t === 'heute: Show-Tag 1' ? true : t;
  });
  await pp.screenshot({ path: join(here, 'shots', 'phasen-uebersicht-hell.png'), clip: { x: 0, y: 0, width: 1600, height: 330 } });
  // Dunkel
  await pp.locator('#theme-toggle').click();
  await pp.waitForTimeout(300);
  await pp.screenshot({ path: join(here, 'shots', 'phasen-strip-dunkel.png'), clip: { x: 0, y: 0, width: 1600, height: 330 } });
  await pp.locator('#rail-ein').click();
  await pp.locator('[data-ein="phasen"]').click();
  await pp.screenshot({ path: join(here, 'shots', 'phasen-tab-dunkel.png') });
  await check('keine JS-Fehler im Phasen-Block', async () => (fehlerP.length ? fehlerP[0] : true));
  await cp.close();
}

console.log('\nMEILENSTEIN OHNE TERMIN DATIEREN (Vorlage, Tabelle und Panel)');
{
  const cm = await browser.newContext({ timezoneId: ZONE, viewport: { width: 1600, height: 950 } });
  const mp = await cm.newPage();
  const fehlerM = [];
  mp.on('pageerror', (e) => fehlerM.push(e.message));
  await mp.goto(BASE + '/index.html?plan=leer');
  await mp.waitForTimeout(700);
  await mp.locator('#dlg .dlg-f input').first().fill('Meilenstein-Test');
  await mp.locator('#dlg .dlg-act .btn-p').click();
  await mp.waitForTimeout(900);
  await mp.locator('[data-view="tabelle"]').click();
  await mp.waitForTimeout(500);
  const gespeichert = (id) => mp.evaluate(async (i) => {
    await new Promise((r) => setTimeout(r, 1100));
    const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(x)).project.name === 'Meilenstein-Test');
    const t = JSON.parse(localStorage.getItem(k)).tasks.find((x) => x.id === i);
    return [t.start, t.end, t.status, t.progress];
  }, id);
  const msIds = await mp.locator('.tb-r.is-ms').evaluateAll((l) => l.map((r) => r.dataset.id));
  await check('Vorlage: mehrere terminlose Meilensteine in der Tabelle, Status überall «geplant»', async () => {
    if (msIds.length < 2) return msIds.length + ' Meilensteine';
    const st = await mp.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_'));
      return [...new Set(JSON.parse(localStorage.getItem(k)).tasks.map((t) => t.status + ':' + t.progress))];
    });
    return JSON.stringify(st) === '["geplant:0"]' ? true : JSON.stringify(st);
  });
  await check('Tabelle: Meilenstein ohne Termin — Start tippen, ✓ aktiv, speichert Start = Ende, ein ⌘Z macht ihn wieder terminlos', async () => {
    const z = mp.locator(`.tb-r[data-id="${msIds[0]}"]`);
    const f = z.locator('.c-start input');
    await f.fill('2026-12-01T09:00');
    await mp.waitForTimeout(250);
    if (!(await z.locator('.en-ok').isVisible())) return '✓ fehlt';
    if (await z.locator('.en-ok').isDisabled()) return '✓ gesperrt: ' + (await mp.locator('.tb-entwurf-grund td').first().textContent());
    await mp.screenshot({ path: join(here, 'shots', 'edit-meilenstein-entwurf.png') });
    await z.locator('.en-ok').click();
    await mp.waitForTimeout(300);
    const g = await gespeichert(msIds[0]);
    if (g[0] !== '2026-12-01T09:00' || g[1] !== '2026-12-01T09:00') return 'gespeichert: ' + JSON.stringify(g);
    await mp.screenshot({ path: join(here, 'shots', 'edit-meilenstein-datiert.png') });
    await undoOhneFeld(mp);
    const z2 = await gespeichert(msIds[0]);
    return z2[0] === null && z2[1] === null ? true : 'ein ⌘Z: ' + JSON.stringify(z2);
  });
  await check('Tabelle: Start wieder leeren — beide leer, ✓ aktiv (zurück zu «ohne Termin»)', async () => {
    const z = mp.locator(`.tb-r[data-id="${msIds[0]}"]`);
    await z.locator('.c-start input').fill('2026-12-01T09:00');
    await z.locator('.en-ok').click();
    await mp.waitForTimeout(300);
    await z.locator('.c-start input').fill('');
    await mp.waitForTimeout(250);
    if (await z.locator('.en-ok').isDisabled()) return '✓ gesperrt beim Leeren';
    await z.locator('.en-ok').click();
    const g = await gespeichert(msIds[0]);
    return g[0] === null && g[1] === null ? true : JSON.stringify(g);
  });
  await check('Panel: Meilenstein ohne Termin — Start setzen, ✓ speichert Start = Ende', async () => {
    // Terminlose Zeilen haben keinen Balken: das Panel öffnet über die Beschriftung im Gantt.
    const name = (await mp.locator(`.tb-r[data-id="${msIds[1]}"] .c-title input`).inputValue()).trim();
    await mp.locator('[data-view="gantt"]').click();
    await mp.waitForTimeout(500);
    const lab = mp.locator('.bz-lab-task .bz-lab-name', { hasText: name }).first();
    if (!(await lab.count())) return 'Beschriftung «' + name + '» nicht im Gantt';
    await lab.click();
    await mp.waitForTimeout(300);
    const f = mp.locator('.ins-termin input[type=datetime-local]').first();
    await f.fill('2026-12-02T10:30');
    await mp.waitForTimeout(250);
    if (await mp.locator('.ins-termin .en-ok').isDisabled()) return '✓ gesperrt: ' + (await mp.locator('.ins-termin .en-grund').textContent());
    await mp.locator('.ins-termin .en-ok').click();
    const g = await gespeichert(msIds[1]);
    return g[0] === '2026-12-02T10:30' && g[1] === '2026-12-02T10:30' ? true : JSON.stringify(g);
  });
  await check('keine JS-Fehler im Meilenstein-Block', async () => (fehlerM.length ? fehlerM[0] : true));
  await cm.close();
}

console.log('\nABSCHNITT IM PANEL');
// Das Panel zeigt das Abschnittsfeld nur bei Bühnen-Einträgen. Die Festival-
// Vorlage hat keine Bühne, daher der Plan mit Hauptbühne (wie verify-showablauf).
// Der Plan kommt als Testdaten in den localStorage (App liefert keinen mehr mit);
// das Klassentreffen-Projekt wird zum aktiven, die übrigen Projekte bleiben im Index.
const { plan: kt, id: ktId } = planSeed('klassentreffen-festival.json');
const ktText = JSON.stringify(kt);   // Ursprungstext: der localStorage-Stand wird von den Tests verändert
await page.evaluate(({ text, id, name, venue }) => {
  localStorage.setItem('bzp_p_' + id, text);
  const idx = JSON.parse(localStorage.getItem('bzp_projects') || '[]').filter((e) => e.id !== id);
  idx.push({ id, name, venue: venue || '', modified: new Date().toISOString(), remoteSha: null, dirty: false });
  localStorage.setItem('bzp_projects', JSON.stringify(idx));
  localStorage.setItem('bzp_active', id);
}, { text: ktText, id: ktId, name: kt.project.name, venue: kt.project.venue });
await page.goto(BASE + '/index.html?plan=leer&ansicht=show');
await page.waitForSelector('[data-ansicht="show"][aria-pressed="true"]', { timeout: 20000 });
await page.waitForTimeout(900);
await check('eigener Abschnitt «Load-in» erscheint im Panel-Abschnittsfeld', async () => {
  // Der Abschnitt wird im Showablauf-Tabellenfeld angelegt (+ Neu…); danach
  // öffnet der Balken dieses Eintrags das Panel, das den Abschnitt gewählt zeigt.
  await page.locator('[data-view="tabelle"]').click();
  await page.waitForTimeout(400);
  const titel = await page.locator('.tb-r .c-title input').first().inputValue();
  await page.locator('.tb-r .c-abs select').first().selectOption('__neu__');
  await page.waitForTimeout(400);
  if (!(await page.locator('.tb-neuart').isVisible())) return 'kein Eingabefeld für den Abschnitt';
  await page.locator('.tb-neuart-n').fill('Load-in');
  await page.locator('.tb-neuart .btn-p').click();
  await page.waitForTimeout(500);
  await page.locator('[data-view="gantt"]').click();
  await page.waitForTimeout(400);
  await page.locator('.bz-bar', { hasText: titel }).first().click();
  await page.waitForTimeout(300);
  const gewaehlt = await page.locator('#ins select')
    .filter({ has: page.locator('option', { hasText: 'Load-in' }) })
    .first().evaluate((s) => s.selectedOptions[0] && s.selectedOptions[0].textContent.trim());
  return gewaehlt === 'Load-in' ? true : 'Panel-Abschnitt zeigt «' + gewaehlt + '»';
});

console.log('\nZEITUMSTELLUNG');
// Muss der letzte Block bleiben: ändert project.start/end und speichert den Plan.
{
  // Der 25.10.2026 hat 25 Stunden. Mit «Tag = 1440 min» war das Datumsband an diesem Tag
  // eine Stunde zu schmal, und der Tagessprung hielt einen Vorgang um 23:30 (liegt hinter
  // d0 + 1440) für «nicht am Tag». Plan: je Gewerk ein Vorgang am 24.10. (viele Zeilen, so
  // dass gescrollt werden muss), der letzte Gewerk-Vorgang um 23:30 am 25.10., einer am 26.10.
  await page.goto(BASE + '/index.html?plan=leer');
  await page.waitForTimeout(900);
  const letztesGewerk = await page.evaluate(async (orig) => {
    const m = await import('/js/persistence.js');
    const r = m.deserialize(orig);
    const pl = r.plan;
    const t0 = pl.tasks[0];
    const gw = [...pl.gewerke].sort((a, b) => a.sort - b.sort).filter((g) => g.art === 'gewerk');
    const vor = (id, g, a, e) => ({ ...t0, id, gewerk: g.id, title: 'Z ' + id, start: a, end: e, milestone: false, parent: null, deps: [], fuer: null });
    pl.project = { ...pl.project, start: '2026-10-23T00:00', end: '2026-10-27T00:00' };   // die Achse folgt der Projektspanne

    pl.tasks = gw.map((g, i) => vor('z' + i, g, '2026-10-24T10:00', '2026-10-24T11:00'));
    const last = gw[gw.length - 1];
    pl.tasks.push(vor('zumstellung', last, '2026-10-25T23:30', '2026-10-25T23:45'));
    pl.tasks.push(vor('znach', gw[0], '2026-10-26T10:00', '2026-10-26T11:00'));
    const repo = m.createRepo(window.localStorage);
    repo.save(pl);
    repo.setActive(pl.project.id);   // sonst lädt ?plan=leer ein anderes «erstes» Projekt
    return { id: last.id, n: gw.length };
  }, ktText);
  await page.goto(BASE + '/index.html?plan=leer&ansicht=bau');
  await page.waitForSelector('.bz-t-major', { timeout: 20000 });
  await page.waitForTimeout(600);
  const springe = async (name) => {
    await page.locator('#tag-wahl').click();
    await page.locator('.mn-i', { hasText: name }).first().click();
    await page.waitForTimeout(500);
  };
  await check('Datumsband am 25.10. ist 25 Stunden breit (1500 min), am 24.10. 24 Stunden', async () => {
    await springe('25.10.');
    const w = (datum) => page.evaluate((d) => {
      const kopf = [...document.querySelectorAll('.bz-t-major')].find((n) => n.textContent.includes(d));
      return kopf ? kopf.getBoundingClientRect().width : null;
    }, datum);
    const b25 = await w('25.10.'), b24 = await w('24.10.');
    if (!b25 || !b24) return 'Band nicht gefunden: 25.=' + b25 + ' 24.=' + b24;
    const px = b24 / 1440;     // der 24.10. ist ein normaler Tag: seine Breite eicht die Skala
    if (Math.abs(b25 - 1500 * px) > 1) return 'Band 25.10. ist ' + (b25 / px).toFixed(1) + ' min breit statt 1500';
    return true;
  });
  await check('Tagessprung auf den 25.10. scrollt zur Gruppenzeile des Vorgangs um 23:30', async () => {
    await springe('25.10.');   // der Check erbt den Sprung nicht vom vorigen
    // Die letzte Gruppe kann nicht bis unter die Achse scrollen (Ende des Inhalts): geprüft wird,
    // dass ihre Zeile im Bild steht (vorher lag sie ~1300 px darunter, außerhalb).
    const r = await page.evaluate((id) => {
      const g = document.querySelector('.bz-lab-group[data-gewerk="' + id + '"]');
      const ax = document.querySelector('.bz-axis'), sc = document.querySelector('.bz-scroll');
      if (!g || !ax || !sc) return null;
      const q = g.getBoundingClientRect();
      return { unterAchse: q.top - ax.getBoundingClientRect().bottom, bisUnten: sc.getBoundingClientRect().bottom - q.bottom };
    }, letztesGewerk.id);
    if (!r) return 'Gruppenzeile/Achse nicht gefunden';
    if (letztesGewerk.n < 8) return 'zu wenige Gewerke, Prüfung nicht aussagekräftig';
    return r.unterAchse >= -1 && r.bisUnten >= -1 ? true : 'Gruppenzeile nicht im Bild: ' + r.unterAchse.toFixed(0) + ' px unter der Achse, ' + r.bisUnten.toFixed(0) + ' px bis zum unteren Rand (' + letztesGewerk.n + ' Gewerke)';
  });
  await check('«+ Phase» vor der Zeitumstellung endet einen KALENDERtag später (24.10. 18:00 → 25.10. 18:00, nicht 17:00)', async () => {
    // Alle fünf Arten belegt → «+ Phase» nimmt «Aufbau»; dessen letzte Phase endet am 24.10. um 18:00.
    await page.evaluate(async () => {
      const m = await import('/js/persistence.js');
      const repo = m.createRepo(window.localStorage);
      const pl = repo.load(repo.getActive());
      const arten = ['planung', 'vorbereitung', 'aufbau', 'show', 'abbau'];
      pl.phases = arten.map((art, i) => ({ id: 'zp' + i, art, start: '2026-10-23T0' + i + ':00', end: art === 'aufbau' ? '2026-10-24T18:00' : '2026-10-23T0' + i + ':30' }));
      repo.save(pl);
    });
    await page.goto(BASE + '/index.html?plan=leer&ansicht=bau');
    await page.waitForSelector('.bz-t-major', { timeout: 20000 });
    await page.locator('#rail-ein').click();
    await page.locator('[data-ein="phasen"]').click();
    const vorher = await page.locator('.ph-z').count();
    await page.locator('#ei-ph-add').click();
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => [...document.querySelectorAll('.ph-z')].map((z) => z.querySelector('.ph-bis').value));
    await page.locator('#ein-zu').click();
    if (r.length !== vorher + 1) return 'keine neue Zeile (' + vorher + ' → ' + r.length + ')';
    return r.includes('2026-10-25T18:00') ? true : 'Bis-Werte: ' + r.join(', ');
  });
}

if (errors.length) { console.log('\n  ✗ Fehler auf der Seite:'); errors.slice(0, 8).forEach((e) => console.log('      ' + e)); problems += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');

await browser.close();
server.close();
console.log(problems ? `\n${problems} Problem(e).\n` : `\nAlle Prüfungen bestanden${skipped ? `, ${skipped} übersprungen` : ''}.\n`);
process.exit(problems ? 1 : 0);
