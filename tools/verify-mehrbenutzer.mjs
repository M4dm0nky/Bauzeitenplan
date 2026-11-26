// Mehrbenutzer-Prüfung im echten Browser (Firefox) gegen eine lokale PocketBase.
//   node tools/verify-mehrbenutzer.mjs [--nur ANMELDUNG|ZWEI_NUTZER|IMPORT|OFFLINE|MONITOR|MONITOR_ABGELAUFEN|ABMELDEN|MITGLIEDER|VERWALTUNG|FIXRUNDE|SAMMELVORGANG|UNDO_BEDARF|START_OFFLINE|ZWEI_TABS]
// ANMELDUNG: login.html — falsches/richtiges Passwort, «Passwort vergessen», Einladung (neues Konto,
// vorhandenes Konto, ungültig), Passwort zurücksetzen (Mail über einen kleinen lokalen SMTP-Empfänger).
// Task 11 ergänzt weitere Abschnitte in ABSCHNITTE. Alle Passwörter entstehen zur Laufzeit.
import { firefox } from 'playwright-core';
import { createServer } from 'node:http';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mustFirefox } from './browsers.mjs';
import { smtpEmpfaenger, qp } from './smtp-fang.mjs';
import { createPb } from '../js/pb.js';
import { createServerPlan } from '../js/server.js';
import { createStore } from '../js/store.js';
import { deserialize } from '../js/persistence.js';
import { startePb, kontoAnlegen, anmelden as anmeldenRoh } from './pb-lokal.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const shots = join(here, 'shots');
mkdirSync(shots, { recursive: true });
const exe = mustFirefox();
if (!exe || !existsSync(exe)) { console.error('Firefox nicht gefunden. Einmalig: npx playwright install firefox'); process.exit(1); }

let fehler = 0;
const ok = (b, text, extra = '') => { console.log(`${b ? '✓' : '✗'} ${text}${b ? '' : ' ' + extra}`); if (!b) fehler++; };
const pw = () => 'Pw-' + randomBytes(9).toString('hex'); // ≥ 10 Zeichen

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function statischerServer() {
  const s = createServer((req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, /^[\\/]$/.test(rel) ? 'index.html' : rel);
    if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}

// SMTP-Empfänger (tools/smtp-fang.mjs): sammelt Mails, damit der Reset-Link aus der echten PB-Mail kommt.

async function ANMELDUNG({ pb, base, browser, smtp }) {
  console.log('— ANMELDUNG');
  const api = encodeURIComponent(pb.url);
  const seite = (extra = '') => `${base}/login.html?api=${api}${extra}`;
  const neu = async (scheme = 'dark') => {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 760 }, serviceWorkers: 'block', colorScheme: scheme });
    const page = await ctx.newPage();
    const posts = [];
    page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()); });
    page.on('dialog', (d) => { ok(false, 'Browser-Dialog erschienen: ' + d.type()); d.dismiss(); });
    return { ctx, page, posts };
  };
  const hinweis = (page) => page.locator('#lg-hinweis');
  const text = async (page) => ((await hinweis(page).isVisible()) ? (await hinweis(page).textContent()).trim() : null);
  const auth = (page) => page.evaluate(() => localStorage.getItem('bzp_auth'));
  const mitglied = async (userId, planId) => (await pb.su('GET', `/api/collections/mitglieder/records?filter=${encodeURIComponent(`plan_id="${planId}" && user_id="${userId}"`)}`)).body.items[0];
  const einladung = async (email, extra = {}) => {
    const r = await pb.su('POST', '/api/collections/einladungen/records', { plan_id: 'planA', email, rolle: 'gewerkeleiter', gewerke: ['g1'], token: 'T'.repeat(32), ablauf: '2099-01-01 00:00:00.000Z', ...extra });
    if (!r.ok || !r.body.token) throw new Error('Einladung: ' + JSON.stringify(r.body));
    return r.body;
  };

  const PW = pw();
  const konto = await kontoAnlegen(pb, { email: 'Anna@BZP.test', name: 'Anna', passwort: PW });

  // 1) Falsches Passwort: Hinweis, keine Weiterleitung, nichts gespeichert
  {
    const { ctx, page } = await neu();
    await page.goto(seite());
    await page.fill('#a-email', 'anna@bzp.test'); await page.fill('#a-pw', 'falsch-falsch-1');
    await page.click('#f-anmelden button[type=submit]');
    await hinweis(page).waitFor({ timeout: 8000 });
    ok(/stimmt nicht/.test(await text(page)) && (await hinweis(page).getAttribute('data-art')) === 'fehler', 'falsches Passwort → Hinweis (fehler)', await text(page));
    ok(page.url().includes('login.html'), 'falsches Passwort → keine Weiterleitung', page.url());
    ok((await auth(page)) === null, 'falsches Passwort → bzp_auth leer');
    ok((await page.evaluate(() => getComputedStyle(document.getElementById('lg-hinweis'), '::before').content)).includes('\u2715'), 'Fehlerhinweis trägt ✕ (zweite Kodierung)');
    await page.screenshot({ path: join(shots, 'login.png') }); // dunkel, mit Fehlerhinweis
    await ctx.close();
  }
  // 2) Richtiges Passwort (E-Mail mit Großbuchstaben) → index.html, Projektdialog
  {
    const { ctx, page } = await neu();
    await page.goto(seite());
    await page.fill('#a-email', ' Anna@BZP.test '); await page.fill('#a-pw', PW);
    await page.click('#f-anmelden button[type=submit]');
    await page.waitForURL(/index\.html/, { timeout: 10000 });
    ok(new URL(page.url()).searchParams.get('api') === pb.url, '?api= wird an index.html weitergereicht', page.url());
    const a = JSON.parse(await auth(page) || 'null');
    ok(!!a?.token && a.record?.id === konto.id, 'bzp_auth gespeichert (Token + Konto)');
    await page.locator('#dlg .dlg-box').waitFor({ timeout: 10000 });
    ok(await page.locator('#dlg .dlg-h', { hasText: 'Bauzeitenplan' }).isVisible(), 'Projektdialog sichtbar');
    await ctx.close();
  }
  // 3) Passwort vergessen: gleicher Text für bekannte und unbekannte Adresse
  {
    const { ctx, page, posts } = await neu();
    await page.goto(seite());
    await page.click('#a-vergessen');
    ok(await page.locator('#f-vergessen').isVisible() && !(await page.locator('#f-anmelden').isVisible()), '«Passwort vergessen» zeigt das eigene Formular');
    const antworten = [];
    for (const m of ['anna@bzp.test', 'unbekannt@bzp.test']) {
      await page.fill('#v-email', m); await page.click('#f-vergessen button[type=submit]');
      await page.waitForFunction(() => document.getElementById('lg-hinweis').dataset.art === 'ok' && !document.getElementById('lg-hinweis').hidden, null, { timeout: 8000 });
      antworten.push(await text(page));
      await page.evaluate(() => { document.getElementById('lg-hinweis').hidden = true; document.getElementById('lg-hinweis').dataset.art = ''; });
    }
    ok(antworten[0] === 'Wenn die Adresse bekannt ist, kommt eine Mail.' && antworten[0] === antworten[1], 'Antwort immer gleich', JSON.stringify(antworten));
    ok(posts.filter((u) => u.includes('request-password-reset')).length === 2, 'beide Anfragen an request-password-reset');
    await ctx.close();
  }
  // 4) Einladung: neues Konto
  const e1 = await einladung('Neu@BZP.test');
  ok(e1.link.startsWith(`${base}/login.html?einladung=`), 'Einladungslink zeigt auf login.html der App', e1.link);
  {
    const { ctx, page, posts } = await neu();
    await page.goto(seite('&einladung=' + e1.token));
    ok(await page.locator('#f-einladung').isVisible(), 'Einladungslink → Formular Name + Passwort');
    const sendeE = () => page.click('#f-einladung button[type=submit]');
    const vorher = () => posts.filter((u) => u.includes('/api/bzp/einladung')).length;
    await page.fill('#e-name', 'Neu Nutzer'); await page.fill('#e-pw', 'kurz'); await page.fill('#e-pw2', 'kurz'); await sendeE();
    ok(/mindestens 10/.test(await text(page)) && vorher() === 0, 'zu kurzes Passwort → Hinweis, nichts gesendet', await text(page));
    const P = pw();
    await page.fill('#e-pw', P); await page.fill('#e-pw2', P + 'x'); await sendeE();
    ok(/nicht gleich/.test(await text(page)) && vorher() === 0, 'Passwörter verschieden → Hinweis, nichts gesendet', await text(page));
    await page.fill('#e-pw2', P); await sendeE();
    await page.waitForURL(/index\.html/, { timeout: 10000 });
    const a = JSON.parse(await auth(page) || 'null');
    ok(a?.record?.email === 'neu@bzp.test' && a.record.name === 'Neu Nutzer', 'Einladung angenommen → angemeldet als neues Konto');
    const m = await mitglied(a.record.id, 'planA');
    ok(m && m.rolle === 'gewerkeleiter' && JSON.stringify(m.gewerke) === '["g1"]', 'im Plan mit eingeladener Rolle und Gewerken', JSON.stringify(m));
    await page.locator('#dlg .dlg-box').waitFor({ timeout: 10000 });
    await ctx.close();
  }
  // 4b) Fremde Sitzung in bzp_auth vorbelegt (kein Abmelden vorher): Einladung als neues Konto muss trotzdem klappen
  {
    const e = await einladung('frisch@bzp.test', { rolle: 'bearbeiter', gewerke: [] });
    const { ctx, page } = await neu();
    await page.goto(seite());
    await page.evaluate((a) => localStorage.setItem('bzp_auth', JSON.stringify(a)), { token: konto.token, record: { id: konto.id, email: 'anna@bzp.test' } });
    await page.goto(seite('&einladung=' + e.token));
    const P = pw();
    await page.fill('#e-name', 'Frisch'); await page.fill('#e-pw', P); await page.fill('#e-pw2', P);
    await page.click('#f-einladung button[type=submit]');
    await page.waitForURL(/index\.html/, { timeout: 10000 });
    const a = JSON.parse(await auth(page) || 'null');
    ok(a?.record?.email === 'frisch@bzp.test', 'fremde Sitzung vorbelegt → neues Konto ist angemeldet', JSON.stringify(a?.record?.email));
    const m = await mitglied(a?.record?.id, 'planA');
    ok(m && m.rolle === 'bearbeiter', 'fremde Sitzung vorbelegt → Mitgliedschaft mit eingeladener Rolle', JSON.stringify(m));
    await ctx.close();
  }
  // 5) Einladung mit unbekanntem Token → Hinweis, kein Wechsel
  {
    const { ctx, page } = await neu();
    await page.goto(seite('&einladung=' + 'x'.repeat(32)));
    await page.fill('#e-name', 'X'); const P = pw(); await page.fill('#e-pw', P); await page.fill('#e-pw2', P);
    await page.click('#f-einladung button[type=submit]');
    await hinweis(page).waitFor({ timeout: 8000 });
    ok(/unbekannt oder schon verwendet/.test(await text(page)) && page.url().includes('login.html'), 'unbekannter Token → Hinweis des Servers, Seite bleibt', await text(page));
    await ctx.close();
  }
  // 6) Einladung, obwohl das Konto inzwischen existiert → Wechsel auf «mit Konto annehmen»
  {
    const e = await einladung('spaet@bzp.test', { rolle: 'bearbeiter', gewerke: [] });
    const P = pw();
    const spaet = await kontoAnlegen(pb, { email: 'spaet@bzp.test', name: 'Spät', passwort: P });
    const { ctx, page } = await neu();
    await page.goto(seite('&einladung=' + e.token));
    await page.fill('#e-name', 'Spät'); const Q = pw(); await page.fill('#e-pw', Q); await page.fill('#e-pw2', Q);
    await page.click('#f-einladung button[type=submit]');
    await page.locator('#f-anmelden').waitFor({ state: 'visible', timeout: 8000 });
    ok(/schon ein Konto/.test(await text(page)) && /annehmen/.test(await page.locator('#a-knopf').textContent()), 'vorhandenes Konto → Anmeldeformular «Anmelden und annehmen»', await text(page));
    await page.fill('#a-email', 'spaet@bzp.test'); await page.fill('#a-pw', P);
    await page.click('#f-anmelden button[type=submit]');
    await page.waitForURL(/index\.html/, { timeout: 10000 });
    const m = await mitglied(spaet.id, 'planA');
    ok(m && m.rolle === 'bearbeiter', 'vorhandenes Konto: nach Anmeldung im Plan mit Rolle', JSON.stringify(m));
    await ctx.close();
  }
  // 7) Passwort zurücksetzen mit dem Token aus der echten Mail
  {
    const r = await pb.su('PATCH', '/api/settings', { smtp: { enabled: true, host: '127.0.0.1', port: smtp.port, tls: false, username: '', password: '' }, meta: { senderAddress: 'bzp@bzp.test', senderName: 'BZP' } });
    if (!r.ok) throw new Error('SMTP setzen: ' + JSON.stringify(r.body));
    // eigenes Konto: PocketBase sendet an dieselbe Adresse höchstens alle 2 Minuten eine Reset-Mail (Schritt 3 hat Anna verbraucht)
    const PWB = pw();
    await kontoAnlegen(pb, { email: 'berta@bzp.test', name: 'Berta', passwort: PWB });
    const { ctx, page } = await neu();
    await page.goto(seite());
    await page.click('#a-vergessen');
    await page.fill('#v-email', 'berta@bzp.test'); await page.click('#f-vergessen button[type=submit]');
    const bis = Date.now() + 10000;
    while (!smtp.mails.length && Date.now() < bis) await new Promise((x) => setTimeout(x, 100));
    ok(smtp.mails.length === 1, 'PocketBase hat die Reset-Mail gesendet');
    const m = qp(smtp.mails[0] || '').match(/login\.html\?reset=([A-Za-z0-9._-]+)/);
    ok(!!m, 'Mail enthält Link auf login.html?reset=…');
    const neuesPw = pw();
    await page.goto(seite('&reset=' + (m ? m[1] : 'x')));
    ok(await page.locator('#f-reset').isVisible(), '?reset= → Formular «Neues Passwort»');
    await page.fill('#r-pw', neuesPw); await page.fill('#r-pw2', neuesPw + 'x'); await page.click('#f-reset button[type=submit]');
    ok(/nicht gleich/.test(await text(page)), 'Reset: Passwörter verschieden → Hinweis', await text(page));
    await page.fill('#r-pw2', neuesPw); await page.click('#f-reset button[type=submit]');
    await page.locator('#f-fertig').waitFor({ state: 'visible', timeout: 8000 });
    ok((await page.evaluate(() => getComputedStyle(document.getElementById('lg-hinweis'), '::before').content)).includes('\u2713'), 'Erfolgshinweis trägt ✓');
    ok(/geändert/.test(await text(page)) && (await hinweis(page).getAttribute('data-art')) === 'ok', 'Reset → «Passwort geändert» (ok)', await text(page));
    let alt = true, neuOk = false;
    try { await anmeldenRoh(pb.url, 'berta@bzp.test', PWB); } catch { alt = false; }
    try { await anmeldenRoh(pb.url, 'berta@bzp.test', neuesPw); neuOk = true; } catch { /* bleibt false */ }
    ok(!alt && neuOk, 'altes Passwort ungültig, neues gilt');
    await page.click('#z-anmelden');
    await page.locator('#f-anmelden').waitFor({ state: 'visible', timeout: 8000 });
    ok(true, '«Zur Anmeldung» führt zurück');
    // ungültiger/benutzter Token → Hinweis
    await page.goto(seite('&reset=' + (m ? m[1] : 'x')));
    await page.fill('#r-pw', neuesPw); await page.fill('#r-pw2', neuesPw); await page.click('#f-reset button[type=submit]');
    await hinweis(page).waitFor({ timeout: 8000 });
    ok(/ungültig oder abgelaufen/.test(await text(page)) && (await hinweis(page).getAttribute('data-art')) === 'fehler', 'benutzter/ungültiger Reset-Link → Hinweis (fehler)', await text(page));
    await ctx.close();
  }
  // 8) Hell: die Seite lädt und der Kontrast der Karte stimmt grob (Text ≠ Grund)
  {
    const { ctx, page } = await neu('light');
    await page.goto(seite());
    const f = await page.evaluate(() => { const k = getComputedStyle(document.querySelector('.lg-karte')); return [k.backgroundColor, getComputedStyle(document.querySelector('.lg-titel')).color]; });
    ok(f[0] !== f[1], 'hell: Karte und Titel unterscheiden sich', f.join(' / '));
    await page.screenshot({ path: join(shots, 'login-hell.png') });
    await ctx.close();
  }
}

// ── Hilfen für ZWEI NUTZER / IMPORT ──────────────────────────────────────────
const fixturePfad = (n) => join(here, 'fixtures', n + '.json');
const fixturePlan = (n) => deserialize(readFileSync(fixturePfad(n), 'utf8')).plan;
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
// Node-seitiger Client (Plan anlegen); Token nur im Speicher dieses Prozesses
async function nodeClient(pb, email, passwort) {
  const a = await anmeldenRoh(pb.url, email, passwort);
  const m = new Map([['bzp_auth', JSON.stringify({ token: a.token, record: a.record })]]);
  const sp = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  return createPb({ basis: pb.url, fetch, speicher: sp, autostart: false });
}
// Browserkontext, bereits angemeldet (bzp_auth wie nach login.html); blockRealtime kappt die SSE-Strecke
async function nutzer(browser, pb, email, passwort, { blockRealtime = false, batchMs = 0, batchSchalter = false, live = false } = {}) {
  const a = await anmeldenRoh(pb.url, email, passwort);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript((v) => { try { if (!localStorage.getItem('bzp_seeded')) { localStorage.setItem('bzp_seeded', '1'); localStorage.setItem('bzp_auth', v); } } catch (e) { /* egal */ } }, JSON.stringify({ token: a.token, record: a.record }));
  // Realtime stumm: die Verbindung steht (PB_CONNECT, Abo), aber Datenereignisse kommen nie an. Die Strecke ganz
  // zu kappen (route abort) meldet «getrennt» → die App geht offline, lädt beim Wiederverbinden neu und sähe den Konflikt nie.
  if (blockRealtime) await ctx.addInitScript(() => { const E = window.EventSource; window.EventSource = class extends E { addEventListener(n, f, o) { if (n === 'PB_CONNECT') super.addEventListener(n, f, o); } }; });
  // Senden verzögern: fetch an /api/batch im Seitenkontext aufhalten. (page.route würde in Firefox auch die
  // Realtime-Strecke (EventSource) puffern; hier läuft sie unberührt.)
  if (batchMs) await ctx.addInitScript((ms) => { const f = window.fetch.bind(window); window.fetch = (u, o) => (String(u && u.url || u).includes('/api/batch') ? new Promise((r) => setTimeout(r, ms)).then(() => f(u, o)) : f(u, o)); }, batchMs);
  // Netzfehler beim Senden nachstellen: solange window.__batchNetz gesetzt ist, scheitert /api/batch wie ohne Netz
  // (Realtime bleibt unberührt, anders als bei page.route).
  if (batchSchalter) await ctx.addInitScript(() => { const f = window.fetch.bind(window); window.fetch = (u, o) => (window.__batchNetz && String(u && u.url || u).includes('/api/batch') ? Promise.reject(new TypeError('NetworkError')) : f(u, o)); });
  if (live) await ctx.addInitScript(() => { try { if (!localStorage.getItem('bzp_live_seed')) { localStorage.setItem('bzp_live_seed', '1'); localStorage.setItem('bzp_live', '1'); } } catch (e) { /* egal */ } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => { ok(false, 'Browser-Dialog erschienen: ' + d.type()); d.dismiss(); });
  page.on('pageerror', (e) => ok(false, 'Seitenfehler: ' + e.message));
  return { ctx, page };
}
const appUrl = (base, pb, extra = '') => `${base}/index.html?api=${encodeURIComponent(pb.url)}${extra}`;
async function planOeffnen(page, base, pb) {
  await page.goto(appUrl(base, pb, '&plan=leer'));
  await page.waitForFunction(() => (document.getElementById('proj-name')?.textContent || '').trim().length > 1, null, { timeout: 15000 });
  await page.locator('[data-view="tabelle"]').click();
  try { await page.locator('.tb-r .c-title input').first().waitFor({ timeout: 10000 }); }
  catch (e) { await page.screenshot({ path: join(shots, '_fehler.png') }); console.log('  URL ' + page.url() + ' | ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)); throw e; }
}
const titel = (page, id) => page.locator(`tr[data-id="${id}"] .c-title input`);
async function titelSetzen(page, id, text) {
  const f = titel(page, id);
  await f.fill(text);
  await f.press('Tab');
  await page.evaluate(() => document.activeElement?.blur());
}
const gesendet = (page) => page.waitForFunction(() => document.getElementById('sync-state')?.dataset.state === 'ok' && /gesendet/.test(document.getElementById('sync-state').textContent), null, { timeout: 10000 });
const wertBis = async (page, id, erwartet, ms = 3000) => {
  try { await page.waitForFunction(([i, w]) => document.querySelector(`tr[data-id="${i}"] .c-title input`)?.value === w, [id, erwartet], { timeout: ms }); return true; } catch { return false; }
};
const dlgKnopf = (page, text) => page.locator('.dlg:not([hidden]) .btn', { hasText: text });
async function serverTitel(pb, planId, id) {
  const r = await pb.su('GET', `/api/collections/vorgaenge/records?filter=${encodeURIComponent(`plan_id="${planId}" && eid="${id}"`)}`);
  return r.body.items[0]?.daten?.title;
}

async function ZWEI_NUTZER({ pb, base, browser }) {
  console.log('— ZWEI NUTZER');
  const PW = pw();
  const pl = await kontoAnlegen(pb, { email: 'pl@bzp.test', name: 'Paula', passwort: PW, produktionsleitung: true });
  const bearb = await kontoAnlegen(pb, { email: 'bearb@bzp.test', name: 'Ben', passwort: PW });
  const KT = fixturePlan('klassentreffen-festival');
  const ang = await createServerPlan({ pb: await nodeClient(pb, 'pl@bzp.test', PW), planId: null }).planAnlegen(KT);
  ok(ang.ok, 'Plan über den Server angelegt', JSON.stringify(ang).slice(0, 200));
  const planId = ang.planId;
  const m = await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: planId, user_id: bearb.id, rolle: 'bearbeiter', gewerke: [] });
  ok(m.ok, 'bearb ist Bearbeiter im Plan');
  const ctxs = [];
  try {
    const A = await nutzer(browser, pb, 'pl@bzp.test', PW); ctxs.push(A.ctx);
    const B = await nutzer(browser, pb, 'bearb@bzp.test', PW); ctxs.push(B.ctx);
    await Promise.all([planOeffnen(A.page, base, pb), planOeffnen(B.page, base, pb)]);
    const ids = await A.page.$$eval('.tb-r', (rs) => rs.filter((r) => r.querySelector('.c-title input')).slice(0, 8).map((r) => r.dataset.id));
    const [X, Y, Z] = ids.slice(2, 5);
    const orig = {}; for (const i of [X, Y, Z]) orig[i] = await titel(A.page, i).inputValue();
    await warte(1500); // Realtime-Handshake
    ok((await A.page.locator('#sync-state').textContent()).includes('gesendet'), 'A: Speicherstand «gesendet» nach dem Laden');
    ok((await A.page.locator('#sync-state').getAttribute('data-state')) === 'ok', 'A: Speicherstand grün (data-state ok)');

    // 1) A ändert X → B sieht es ≤ 3 s, ohne Undo-Eintrag bei B
    await titelSetzen(A.page, X, 'A: neuer Titel');
    await gesendet(A.page);
    ok(await wertBis(B.page, X, 'A: neuer Titel'), 'B sieht As Änderung binnen 3 s (Realtime)');
    ok(await B.page.locator('#undo').isDisabled(), 'B: kein Undo-Eintrag durch die Fremdänderung');
    ok((await serverTitel(pb, planId, X)) === 'A: neuer Titel', 'Server hat As Titel');
    ok(!(await A.page.locator('.dlg:not([hidden])').count()), 'A: kein Dialog');

    // 2) B ändert anderen Vorgang Y → kein Dialog, A sieht es
    await titelSetzen(B.page, Y, 'B: anderer Vorgang');
    await gesendet(B.page);
    ok(await wertBis(A.page, Y, 'B: anderer Vorgang'), 'A sieht Bs Änderung an Y');
    ok(!(await A.page.locator('.dlg:not([hidden])').count()) && !(await B.page.locator('.dlg:not([hidden])').count()), 'verschiedene Vorgänge → kein Konfliktdialog');

    // 3) A macht seine Änderung an X rückgängig → Bs Änderung an Y bleibt
    await A.page.keyboard.press('Control+z');
    ok(await wertBis(A.page, X, orig[X]), 'A: ⌘Z nimmt As Änderung an X zurück');
    await A.page.waitForTimeout(500);
    ok((await titel(A.page, Y).inputValue()) === 'B: anderer Vorgang', 'A: Bs Änderung an Y bleibt nach ⌘Z');
    await gesendet(A.page);
    ok(await wertBis(B.page, X, orig[X]), 'B sieht As Rücknahme');
    ok((await serverTitel(pb, planId, Y)) === 'B: anderer Vorgang', 'Server: Y bleibt Bs Titel');

    // 4) Konflikt: C (Bearbeiter, Realtime gekappt) ändert dasselbe wie A
    const C = await nutzer(browser, pb, 'bearb@bzp.test', PW, { blockRealtime: true }); ctxs.push(C.ctx);
    await planOeffnen(C.page, base, pb);
    await titelSetzen(A.page, X, 'A: Konfliktwert');
    await gesendet(A.page);
    await warte(1500);
    ok((await titel(C.page, X).inputValue()) === orig[X], 'C: ohne Realtime noch der alte Titel (Strecke wirklich gekappt)');
    await titelSetzen(C.page, X, 'C: mein Wert');
    await C.page.locator('.dlg:not([hidden]) .dlg-h').first().waitFor({ timeout: 10000 });
    const kt = (await C.page.locator('.dlg:not([hidden]) .dlg-h').first().textContent()).trim();
    ok(/wurde gerade von jemand anderem geändert/.test(kt), 'C: Konfliktdialog «… wurde gerade von … geändert»', kt);
    ok(await dlgKnopf(C.page, 'Ihre Fassung nehmen').isVisible() && await dlgKnopf(C.page, 'Meine behalten').isVisible() && await dlgKnopf(C.page, 'Abbrechen').isVisible(), 'C: Knöpfe Ihre Fassung nehmen / Meine behalten / Abbrechen');
    await C.page.screenshot({ path: join(shots, 'mehrbenutzer-konflikt.png') });
    await dlgKnopf(C.page, 'Ihre Fassung nehmen').click();
    ok(await wertBis(C.page, X, 'A: Konfliktwert'), 'C: «Ihre Fassung nehmen» zeigt As Wert');
    await gesendet(C.page);
    ok((await serverTitel(pb, planId, X)) === 'A: Konfliktwert', 'Server behält As Wert');
    // «Meine behalten»
    await titelSetzen(A.page, Y, 'A: zweiter Konflikt');
    await gesendet(A.page);
    await titelSetzen(C.page, Y, 'C: ich bleibe');
    await dlgKnopf(C.page, 'Meine behalten').waitFor({ timeout: 10000 });
    await dlgKnopf(C.page, 'Meine behalten').click();
    await gesendet(C.page);
    ok((await titel(C.page, Y).inputValue()) === 'C: ich bleibe', 'C: «Meine behalten» bleibt stehen');
    ok((await serverTitel(pb, planId, Y)) === 'C: ich bleibe', 'Server: Cs Fassung nach «Meine behalten»');
    ok(await wertBis(A.page, Y, 'C: ich bleibe'), 'A bekommt Cs Fassung per Realtime');

    // 5) Undo-Konflikt: A ändert Z, B ändert Z danach, A macht rückgängig
    await titelSetzen(A.page, Z, 'A: Z eins');
    await gesendet(A.page);
    ok(await wertBis(B.page, Z, 'A: Z eins'), 'B sieht Z');
    await titelSetzen(B.page, Z, 'B: Z zwei');
    await gesendet(B.page);
    ok(await wertBis(A.page, Z, 'B: Z zwei'), 'A sieht Bs Z');
    await A.page.keyboard.press('Control+z');
    await A.page.locator('.dlg:not([hidden]) .dlg-h').first().waitFor({ timeout: 5000 });
    const ut = (await A.page.locator('.dlg:not([hidden])').first().textContent());
    ok(/wurde inzwischen von jemand anderem geändert\. Trotzdem zurücknehmen\?/.test(ut), 'A: Undo-Konflikt «… Trotzdem zurücknehmen?»', ut.slice(0, 200));
    await dlgKnopf(A.page, 'Trotzdem zurücknehmen').click();
    ok(await wertBis(A.page, Z, orig[Z]), 'A: erzwungenes Undo setzt Z zurück');
    await gesendet(A.page);
    ok((await serverTitel(pb, planId, Z)) === orig[Z], 'Server: Z zurückgesetzt');
    // Abbrechen lässt Bs Wert
    await titelSetzen(A.page, Z, 'A: Z drei'); await gesendet(A.page);
    ok(await wertBis(B.page, Z, 'A: Z drei'), 'B sieht As Z drei, bevor er selbst ändert');   // sonst ändert B auf altem Inhalt: das ist (seit C1) ein Konflikt, kein stilles Überschreiben
    await titelSetzen(B.page, Z, 'B: Z vier'); await gesendet(B.page);
    await wertBis(A.page, Z, 'B: Z vier');
    await A.page.keyboard.press('Control+z');
    await A.page.locator('.dlg-act .btn', { hasText: 'Abbrechen' }).click();
    ok((await titel(A.page, Z).inputValue()) === 'B: Z vier', 'A: Undo-Konflikt «Abbrechen» ändert nichts');
    // 6) Fremdänderung überschreibt keine offene eigene Änderung (Realtime LÄUFT bei E, nur dessen Senden ist verzögert)
    const E = await nutzer(browser, pb, 'bearb@bzp.test', PW, { batchMs: 3500 }); ctxs.push(E.ctx);
    await planOeffnen(E.page, base, pb);
    await warte(1500);
    await titelSetzen(E.page, X, 'E: mein Wert');          // Senden hängt 3,5 s
    await warte(400);
    // Zweimal: das Ereignis mit der rev, die Es eigenes Senden erwartet (Echo-Schlüssel), schluckt server.js;
    // erst das zweite (rev+2) kommt als Fremdereignis bei E an.
    await titelSetzen(A.page, X, 'A: kommt dazwischen');
    await gesendet(A.page);
    await titelSetzen(A.page, X, 'A: und nochmal');
    await gesendet(A.page);
    await warte(1500);                                      // As Ereignis ist längst bei E angekommen
    ok((await titel(E.page, X).inputValue()) === 'E: mein Wert', 'E: Realtime-Ereignis überschreibt die offene eigene Änderung nicht');
    await E.page.locator('.dlg:not([hidden]) .dlg-h').first().waitFor({ timeout: 10000 });
    ok(/wurde gerade von jemand anderem geändert/.test(await E.page.locator('.dlg:not([hidden]) .dlg-h').first().textContent()), 'E: Konfliktdialog');
    ok((await titel(E.page, X).inputValue()) === 'E: mein Wert', 'E: Bildschirm zeigt im Dialog den eigenen Wert');
    await dlgKnopf(E.page, 'Meine behalten').click();
    await gesendet(E.page);
    await warte(1200);
    ok((await titel(E.page, X).inputValue()) === 'E: mein Wert', 'E: nach «Meine behalten» zeigt der Bildschirm den eigenen Wert');
    ok((await serverTitel(pb, planId, X)) === 'E: mein Wert', 'Server: Es Wert nach «Meine behalten»');
    ok(await wertBis(A.page, X, 'E: mein Wert'), 'A sieht Es Wert');
    // Ein Betrachter darf nicht ändern
    const betr = await kontoAnlegen(pb, { email: 'betr@bzp.test', name: 'Bea', passwort: PW });
    await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: planId, user_id: betr.id, rolle: 'betrachter', gewerke: [] });
    const D = await nutzer(browser, pb, 'betr@bzp.test', PW); ctxs.push(D.ctx);
    await planOeffnen(D.page, base, pb);
    ok(await markeBis(D.page, '👁 Nur ansehen'), 'Betrachter: Marke «👁 Nur ansehen»', await markeText(D.page));
    ok(await titel(D.page, X).evaluate((n) => n.readOnly), 'Betrachter: Titelfeld schreibgeschützt');
    // Die Sperre der Oberfläche umgehen: der Store lehnt trotzdem ab (Meldung statt Änderung)
    await titel(D.page, X).evaluate((n) => { n.readOnly = false; }); await titelSetzen(D.page, X, 'Betrachter darf nicht');
    await D.page.locator('#toast').waitFor({ state: 'visible', timeout: 3000 });
    ok(/Nur ansehen: du bist Betrachter/.test(await D.page.locator('#toast').textContent()), 'Betrachter: Store lehnt ab «Nur ansehen: du bist Betrachter.»');
    await warte(800);
    ok((await serverTitel(pb, planId, X)) === 'E: mein Wert', 'Betrachter: Server unverändert');
    await A.page.screenshot({ path: join(shots, 'mehrbenutzer-kopfzeile.png') });
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
}

async function IMPORT({ pb, base, browser }) {
  console.log('— IMPORT');
  const PW = pw();
  const pl = await kontoAnlegen(pb, { email: 'pl@bzp.test', name: 'Paula', passwort: PW, produktionsleitung: true });
  const bearb = await kontoAnlegen(pb, { email: 'bearb@bzp.test', name: 'Ben', passwort: PW });
  const AMK = fixturePlan('amk-singleshow');
  const ctxs = [];
  try {
    const P = await nutzer(browser, pb, 'pl@bzp.test', PW); ctxs.push(P.ctx);
    await P.page.goto(appUrl(base, pb));
    await P.page.locator('#dlg .dlg-box').waitFor({ timeout: 15000 });
    await P.page.locator('#neu-import').waitFor();
    ok(await P.page.locator('#neu-import').isEnabled(), 'pl: Import-Knopf aktiv');
    await P.page.setInputFiles('#import-file', fixturePfad('amk-singleshow'));
    await P.page.waitForFunction((n) => (document.getElementById('proj-name')?.textContent || '').includes(n), AMK.project.name, { timeout: 20000 });
    ok(true, 'pl: AMK importiert und geöffnet');
    const plaene = await pb.su('GET', '/api/collections/plaene/records');
    const rec = plaene.body.items[0];
    ok(plaene.body.items.length === 1 && rec.plan_id !== AMK.project.id, 'Server: ein Plan mit NEUER plan_id', rec?.plan_id);
    const lokal = await P.page.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));
    const tok = JSON.parse(lokal.find(([k]) => k === 'bzp_auth')[1]).token;
    ok(lokal.filter(([k]) => k !== 'bzp_auth').every(([, v]) => !v.includes(tok)), 'lokale Kopie enthält kein Token');
    ok(lokal.some(([k]) => k === 'bzp_p_' + rec.plan_id), 'lokale Kopie (für den Druck) liegt unter der neuen plan_id');
    const dl = P.page.waitForEvent('download');
    await P.page.locator('#proj-knopf').click(); await P.page.locator('.mn #export').click();
    const d = await dl; const txt = readFileSync(await d.path(), 'utf8');
    ok(!txt.includes(tok) && !/"token"/.test(txt), 'Export enthält kein Token');
    // Projektdialog von pl: Rolle Besitzer
    await P.page.locator('#proj-knopf').click(); await P.page.locator('.mn #proj-menu').click();
    await P.page.locator('.dlg-open').first().waitFor();
    ok(/Besitzer/.test(await P.page.locator('.dlg-open-m').first().textContent()) && (await P.page.locator('.dlg-open-n').first().textContent()).includes(AMK.project.name), 'pl: AMK im Dialog mit Rolle 👑 Besitzer');
    await P.page.screenshot({ path: join(shots, 'mehrbenutzer-projektdialog.png') });
    // bearb: Mitglied → sieht den Plan; darf nicht anlegen/importieren/löschen
    await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: rec.plan_id, user_id: bearb.id, rolle: 'bearbeiter', gewerke: [] });
    const B = await nutzer(browser, pb, 'bearb@bzp.test', PW); ctxs.push(B.ctx);
    await B.page.goto(appUrl(base, pb));
    await B.page.locator('.dlg-open').first().waitFor({ timeout: 15000 });
    ok((await B.page.locator('.dlg-open-n').first().textContent()).includes(AMK.project.name) && /Bearbeiter/.test(await B.page.locator('.dlg-open-m').first().textContent()), 'bearb: AMK im Dialog mit Rolle ✏ Bearbeiter');
    ok(await B.page.locator('#neu-import').isDisabled() && await B.page.locator('#neu-anlegen').isDisabled(), 'bearb: Neu und Import gesperrt (mit Grund)');
    ok(!(await B.page.locator('.dlg-del').count()), 'bearb: kein Löschen-Knopf');
    // Löschen durch den Besitzer
    await P.page.locator('.dlg-del').first().click();
    await dlgKnopf(P.page, 'Löschen').click();
    await P.page.waitForFunction(() => !document.querySelector('.dlg-open'), null, { timeout: 10000 });
    ok((await pb.su('GET', '/api/collections/plaene/records')).body.items.length === 0, 'Server: Plan nach Löschen weg');
    // Abmelden führt zur Anmeldeseite
    await P.page.locator('#dlg-abmelden').click();
    await P.page.waitForURL(/login\.html/, { timeout: 10000 });
    ok((await P.page.evaluate(() => localStorage.getItem('bzp_auth'))) === null, 'Abmelden: bzp_auth geleert → login.html');
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
}

// ── OFFLINE / MONITOR / ABMELDEN (Task 10) ───────────────────────────────────
const marke = (page) => page.locator('#hd-offline');
const markeText = async (page) => ((await marke(page).isVisible()) ? (await marke(page).textContent()).trim() : null);
const nurAnsicht = (page) => page.evaluate(() => document.body.classList.contains('nur-ansicht'));
async function markeBis(page, text, ms = 8000) {
  try { await page.waitForFunction((t) => { const m = document.getElementById('hd-offline'); return m && !m.hidden && m.dataset.an !== '0' && m.textContent.trim() === t; }, text, { timeout: ms }); return true; } catch { return false; }
}
async function markeWeg(page, ms = 20000) {
  try { await page.waitForFunction(() => document.getElementById('hd-offline')?.hidden === true, null, { timeout: ms }); return true; } catch { return false; }
}
async function planAnlegenFuer(pb, PW, plan = fixturePlan('klassentreffen-festival')) {
  await kontoAnlegen(pb, { email: 'pl@bzp.test', name: 'Paula', passwort: PW, produktionsleitung: true });
  const ang = await createServerPlan({ pb: await nodeClient(pb, 'pl@bzp.test', PW), planId: null }).planAnlegen(plan);
  if (!ang.ok) throw new Error('Plan anlegen: ' + JSON.stringify(ang).slice(0, 200));
  return ang.planId;
}
async function serverStart(pb, planId, id) {
  const r = await pb.su('GET', `/api/collections/vorgaenge/records?filter=${encodeURIComponent(`plan_id="${planId}" && eid="${id}"`)}`);
  return r.body.items[0]?.daten?.start;
}

async function OFFLINE({ pb, base, browser }) {
  console.log('— OFFLINE');
  const PW = pw();
  const planId = await planAnlegenFuer(pb, PW);
  const bearb = await kontoAnlegen(pb, { email: 'bearb@bzp.test', name: 'Ben', passwort: PW });
  await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: planId, user_id: bearb.id, rolle: 'bearbeiter', gewerke: [] });
  const ctxs = [];
  try {
    const A = await nutzer(browser, pb, 'pl@bzp.test', PW, { batchSchalter: true }); ctxs.push(A.ctx);
    const B = await nutzer(browser, pb, 'bearb@bzp.test', PW); ctxs.push(B.ctx);
    await A.page.clock.install({ time: new Date('2026-08-21T10:00:00') });   // Uhr stellen (Jetzt-Linie mitten im Plan)
    await Promise.all([planOeffnen(A.page, base, pb), planOeffnen(B.page, base, pb)]);
    await warte(1500);
    ok(!(await marke(A.page).isVisible()) && !(await nurAnsicht(A.page)), 'online: keine Marke, nicht nur Ansicht');
    const ids = await A.page.$$eval('.tb-r', (rs) => rs.filter((r) => r.querySelector('.c-title input')).slice(0, 8).map((r) => r.dataset.id));
    const [X] = ids.slice(2, 3);

    // 1) Änderung kurz vor dem Abbruch: Senden scheitert am Netz → bleibt in der Warteschlange
    await A.page.evaluate(() => { window.__batchNetz = true; });
    await titelSetzen(A.page, X, 'A: kurz vor Abbruch');
    // Entprellt: sobald «nur Ansicht» gilt, ist die Marke noch unsichtbar (visibility:hidden, 3 s), erscheint dann aber
    await A.page.waitForFunction(() => document.body.classList.contains('nur-ansicht'), null, { timeout: 8000 });
    ok(!(await marke(A.page).isVisible()), 'Marke erscheint nicht sofort (entprellt 3 s)');
    ok(await markeBis(A.page, '📡 Offline – nur Ansicht'), 'Netzfehler beim Senden → Marke «📡 Offline – nur Ansicht»', await markeText(A.page));
    ok((await A.page.locator('#sync-state').textContent()).includes('offen (1)'), 'Speicherstand «⚠ offen (1)»', await A.page.locator('#sync-state').textContent());
    ok(await nurAnsicht(A.page), 'body.nur-ansicht gesetzt');
    ok((await titel(B.page, X).inputValue()) !== 'A: kurz vor Abbruch', 'B sieht die Änderung noch nicht');

    // 2) Verbindung wirklich weg (Browser offline): Ansicht, Ziehen, Felder, Uhr
    await A.ctx.setOffline(true);
    await A.page.locator('[data-view="gantt"]').click();
    await A.page.locator('.bz-bar[data-task]:not(.is-summary)').first().waitFor({ timeout: 10000 });
    await warte(1500);   // Gantt hat sich eingepasst
    ok(await markeBis(A.page, '📡 Offline – nur Ansicht'), 'Marke bleibt offline');
    const bar = await A.page.evaluate(async () => {
      const L = Math.ceil(document.querySelector('.bz-side').getBoundingClientRect().right) + 30;
      for (const n of document.querySelectorAll('.bz-bar[data-task]:not(.is-summary)')) {
        n.scrollIntoView({ block: 'center', inline: 'center' });
        await new Promise((r) => requestAnimationFrame(r));
        const r = n.getBoundingClientRect();
        if (r.width >= 60 && r.left > L && r.right < innerWidth - 100 && r.top > 140 && r.bottom < innerHeight - 100) return { id: n.dataset.task, x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return null;
    });
    ok(!!bar, 'ein Balken im Bild');
    // Erst auswählen: das Panel öffnet sich, der Gantt passt sich neu ein. Danach neu messen.
    await A.page.mouse.click(bar.x, bar.y); await warte(1200);
    const bar2 = await A.page.locator(`.bz-bar[data-task="${bar.id}"]`).evaluate((n) => { n.scrollIntoView({ block: 'center', inline: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    bar.x = bar2.x; bar.y = bar2.y;
    const links = () => A.page.locator(`.bz-bar[data-task="${bar.id}"]`).evaluate((n) => parseFloat(n.style.left));
    const vorher = await links();
    const startVorher = await serverStart(pb, planId, bar.id);
    await A.page.evaluate(() => { const t = document.getElementById('toast'); t.hidden = true; t.textContent = ''; });
    await A.page.mouse.move(bar.x, bar.y); await A.page.mouse.down();
    await A.page.mouse.move(bar.x + 6, bar.y, { steps: 2 }); await A.page.mouse.move(bar.x + 90, bar.y, { steps: 6 });
    await A.page.mouse.up(); await warte(300);
    const nachher = await links();
    ok(Math.abs(nachher - vorher) < 0.5, 'Ziehen eines Balkens ändert nichts (Balken steht)', vorher + ' → ' + nachher);
    ok((await A.page.locator('#toast').isHidden()), 'Ziehen: gar nicht erst begonnen (kein Fehlerhinweis)', await A.page.locator('#toast').textContent());
    ok((await serverStart(pb, planId, bar.id)) === startVorher, 'Server: Termin unverändert');
    await A.page.locator(`.bz-bar[data-task="${bar.id}"]`).click({ force: true });
    await A.page.locator('#ins input').first().waitFor({ timeout: 5000 });
    const offeneFelder = await A.page.$$eval('#ins input:not([type=hidden]), #ins textarea, #ins select', (fs) => fs.filter((f) => !(f.readOnly || f.disabled)).map((f) => f.id || f.name || f.className || f.type));
    ok(offeneFelder.length === 0, 'Panel: alle Felder schreibgeschützt/gesperrt', offeneFelder.join(','));
    const jetzt = () => A.page.locator('.bz-now').evaluate((n) => parseFloat(n.style.left));
    const j0 = await jetzt();
    await A.page.clock.fastForward('30:00'); await warte(400);
    const j1 = await jetzt();
    ok(j1 > j0 + 0.5, 'Jetzt-Linie wandert offline mit der gestellten Uhr', `${j0} → ${j1}`);
    await A.page.screenshot({ path: join(shots, 'offline.png') });
    await A.page.locator('[data-view="tabelle"]').click();
    await A.page.locator('.tb-r .c-title input').first().waitFor({ timeout: 5000 });
    ok(await titel(A.page, ids[0]).evaluate((n) => n.readOnly), 'Tabelle: Titelfeld schreibgeschützt');

    // 3) Wieder online: Marke weg, Warteschlange kommt bei B an, Bearbeiten geht wieder
    await A.page.evaluate(() => { window.__batchNetz = false; });
    await A.ctx.setOffline(false);
    ok(await markeWeg(A.page), 'wieder online → Marke weg');
    ok(!(await nurAnsicht(A.page)), 'wieder online → nicht mehr nur Ansicht');
    ok(await wertBis(B.page, X, 'A: kurz vor Abbruch', 15000), 'die Änderung aus der Warteschlange kommt bei B an');
    ok((await serverTitel(pb, planId, X)) === 'A: kurz vor Abbruch', 'Server hat die Änderung');
    await gesendet(A.page);
    ok(!(await titel(A.page, X).evaluate((n) => n.readOnly)), 'Tabelle: Titelfeld wieder bearbeitbar');
    await titelSetzen(A.page, X, 'A: wieder online'); await gesendet(A.page);
    ok(await wertBis(B.page, X, 'A: wieder online'), 'nach dem Wiederverbinden geht Bearbeiten und Realtime wieder');
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
}

async function MONITOR({ pb, base, browser }) {
  console.log('— MONITOR');
  const PW = pw();
  const planId = await planAnlegenFuer(pb, PW);
  const KT = fixturePlan('klassentreffen-festival');
  const P = await nutzer(browser, pb, 'pl@bzp.test', PW, { live: true });
  try {
    // 1) Mit Netz öffnen: die lokale Kopie entsteht (ohne Token)
    await planOeffnen(P.page, base, pb);
    await warte(1500);
    const kopie = await P.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bzp_p_')).map((k) => localStorage.getItem(k)));
    const auth = await P.page.evaluate(() => JSON.parse(localStorage.getItem('bzp_auth')));
    ok(kopie.length === 1 && !kopie[0].includes(auth.token), 'lokale Kopie vorhanden, ohne Token');
    const sichtbar = (page) => page.evaluate(() => document.querySelectorAll('[data-task], .tb-r').length);
    // 2) PocketBase weg, Monitor (bzp_live=1) neu laden: Plan mit Marke, nie login.html
    await pb.stop();
    await P.page.goto(appUrl(base, pb));
    ok(await markeBis(P.page, '📡 Offline – nur Ansicht', 15000), 'ohne Netz: Monitor zeigt «📡 Offline – nur Ansicht»', await markeText(P.page));
    ok(!P.page.url().includes('login.html') && !(await P.page.locator('#dlg:not([hidden])').count()), 'kein login.html, kein Projektdialog', P.page.url());
    ok((await P.page.locator('#proj-name').textContent()).includes(KT.project.name) && (await sichtbar(P.page)) > 0, 'der Plan steht da (aus der lokalen Kopie)');
    ok(await nurAnsicht(P.page), 'nur Ansicht');
    await P.page.screenshot({ path: join(shots, 'monitor-offline.png') });
  } finally { await P.ctx.close().catch(() => {}); }
}

// Anmeldung abgelaufen: eigener Lauf mit lebendiger PB (der 401 kommt vom Server)
async function MONITOR_ABGELAUFEN({ pb, base, browser }) {
  console.log('— MONITOR (Anmeldung abgelaufen)');
  const PW = pw();
  await planAnlegenFuer(pb, PW);
  const KT = fixturePlan('klassentreffen-festival');
  const P = await nutzer(browser, pb, 'pl@bzp.test', PW, { live: true });
  try {
    await planOeffnen(P.page, base, pb);
    await warte(1500);
    const abgelaufen = () => P.page.evaluate(() => localStorage.setItem('bzp_auth', JSON.stringify({ token: 'abgelaufen.x.y', record: { id: 'x' } })));
    await abgelaufen();
    await P.page.goto(appUrl(base, pb));
    ok(await markeBis(P.page, '🔑 Anmeldung abgelaufen – lokale Kopie', 15000), 'Live-Monitor: «🔑 Anmeldung abgelaufen – lokale Kopie»', await markeText(P.page));
    ok(!P.page.url().includes('login.html'), 'Live-Monitor springt nicht auf login.html', P.page.url());
    ok((await P.page.locator('#proj-name').textContent()).includes(KT.project.name), 'der Plan steht da');
    ok(await nurAnsicht(P.page), 'nur Ansicht');
    ok((await P.page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('bzp_p_')))), 'lokale Kopie bleibt bei abgelaufener Anmeldung');
    await P.page.screenshot({ path: join(shots, 'monitor-abgelaufen.png') });
    // Gegenprobe: ohne Live-Monitor geht es auf login.html — und bleibt dort (keine Schleife zurück nach index.html)
    await P.page.evaluate(() => localStorage.setItem('bzp_live', '0'));
    await abgelaufen();
    await P.page.goto(appUrl(base, pb));
    await P.page.waitForURL(/login\.html/, { timeout: 10000 });
    await warte(2500);
    ok(P.page.url().includes('login.html'), 'ohne Live: abgelaufene Anmeldung → login.html, keine Schleife', P.page.url());
    ok(await P.page.locator('#f-anmelden').isVisible(), 'login.html zeigt das Anmeldeformular');
  } finally { await P.ctx.close().catch(() => {}); }
}

async function ABMELDEN({ pb, base, browser }) {
  console.log('— ABMELDEN');
  const PW = pw();
  await planAnlegenFuer(pb, PW);
  const P = await nutzer(browser, pb, 'pl@bzp.test', PW, { live: true });
  try {
    await planOeffnen(P.page, base, pb);
    await warte(1500);
    const kopien = () => P.page.evaluate(() => Object.keys(localStorage).filter((k) => k === 'bzp_active' || k.startsWith('bzp_p_') || (k === 'bzp_projects' && localStorage.getItem(k) !== '[]')));
    ok((await kopien()).length >= 2, 'vor dem Abmelden: lokale Kopie vorhanden', (await kopien()).join(','));
    await P.page.locator('#proj-knopf').click();
    await P.page.locator('.mn #abmelden').click();
    await P.page.waitForURL(/login\.html/, { timeout: 10000 });
    await warte(1500);   // pagehide darf nichts zurückschreiben
    ok((await kopien()).length === 0, 'manuelles Abmelden löscht die lokalen Kopien', (await kopien()).join(','));
    ok((await P.page.evaluate(() => localStorage.getItem('bzp_auth'))) === null, 'und das Token');
  } finally { await P.ctx.close().catch(() => {}); }
}

// ── MITGLIEDER / VERWALTUNG (Task 11) ─────────────────────────────────────────
const toastText = (page) => page.evaluate(() => { const t = document.getElementById('toast'); return t && !t.hidden ? t.textContent : null; });
const toastBis = async (page, re, ms = 6000) => { try { await page.waitForFunction((r) => { const t = document.getElementById('toast'); return t && !t.hidden && new RegExp(r).test(t.textContent); }, re.source, { timeout: ms }); return true; } catch { return false; } };
async function menueOeffnen(page) { await page.locator('#proj-knopf').click(); await page.locator('.mn').waitFor({ timeout: 5000 }); }
async function menueZu(page) { await page.keyboard.press('Escape'); await page.locator('.mn').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {}); }

async function MITGLIEDER({ pb, base, browser }) {
  console.log('— MITGLIEDER');
  const PW = pw();
  const plId = await planAnlegenFuer(pb, PW);
  const bearb = await kontoAnlegen(pb, { email: 'bearb@bzp.test', name: 'Ben', passwort: PW });
  await kontoAnlegen(pb, { email: 'vorhanden@bzp.test', name: 'Vera', passwort: PW });
  await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: plId, user_id: bearb.id, rolle: 'bearbeiter', gewerke: [] });
  const LICHT = 't149', TON = 't151'; // Fixture: g2 Licht, g3 Ton
  const ctxs = [];
  try {
    const A = await nutzer(browser, pb, 'pl@bzp.test', PW); ctxs.push(A.ctx);
    const B = await nutzer(browser, pb, 'bearb@bzp.test', PW); ctxs.push(B.ctx);
    await Promise.all([planOeffnen(A.page, base, pb), planOeffnen(B.page, base, pb)]);

    // bearb: kein «Mitglieder…», kein «Verwaltung…»
    await menueOeffnen(B.page);
    ok((await B.page.locator('#mitglieder-oeffnen').count()) === 0, 'Bearbeiter sieht «Mitglieder…» nicht');
    ok((await B.page.locator('#verwaltung-oeffnen').count()) === 0, 'Bearbeiter sieht «Verwaltung…» nicht');
    await menueZu(B.page);

    // pl: Dialog, Eingaben prüfen
    await menueOeffnen(A.page);
    ok((await A.page.locator('#mitglieder-oeffnen').count()) === 1 && (await A.page.locator('#verwaltung-oeffnen').count()) === 0, 'Produktionsleitung sieht «Mitglieder…», nicht «Verwaltung…»');
    await A.page.locator('#mitglieder-oeffnen').click();
    const dlg = A.page.locator('#mg-dlg');
    await dlg.locator('#mg-einladen').waitFor({ timeout: 8000 });
    ok((await dlg.locator('[data-mitglied]').count()) === 1 && /Ben/.test(await dlg.locator('[data-mitglied]').textContent()), 'Liste zeigt Ben als Mitglied');
    ok((await dlg.locator('[data-besitzer]').count()) === 1, 'Besitzer steht als eigene Zeile (ohne Entfernen)');
    const einladungenZahl = async () => (await pb.su('GET', '/api/collections/einladungen/records')).body.totalItems;
    await dlg.locator('#mg-mail').fill('kaputt');
    await dlg.locator('#mg-einladen').click();
    ok(/gültige E-Mail/.test(await dlg.locator('.mg-fehler').textContent()) && (await einladungenZahl()) === 0, 'ungültige Adresse → Hinweis, nichts angelegt');
    await dlg.locator('#mg-mail').fill('Neuling@BZP.test');
    await dlg.locator('#mg-rolle-neu').selectOption('gewerkeleiter');
    await dlg.locator('#mg-einladen').click();
    ok(/mindestens ein Gewerk/.test(await dlg.locator('.mg-fehler').textContent()) && (await einladungenZahl()) === 0, 'Gewerkeleiter ohne Gewerk → Hinweis, nichts angelegt');
    await dlg.locator('.mg-einladen .mg-chip[data-gewerk="g2"]').click();
    ok((await dlg.locator('.mg-einladen .mg-chip[data-gewerk="g2"]').getAttribute('aria-pressed')) === 'true', 'Chip «Licht» gewählt (aria-pressed)');
    await dlg.locator('#mg-einladen').click();
    await dlg.locator('#mg-link').waitFor({ timeout: 8000 });
    const link = await dlg.locator('#mg-link').inputValue();
    ok(link.startsWith(`${base}/login.html?einladung=`), 'Einladungslink steht im Feld', link);
    ok((await dlg.locator('#mg-kopieren').count()) === 1, '«Kopieren» neben dem Link');
    await dlg.locator('#mg-kopieren').click();
    ok(await dlg.locator('.mg-link .mg-leer').textContent() !== '', 'Kopieren meldet «Kopiert.» oder «Markiert»', await dlg.locator('.mg-link .mg-leer').textContent());
    const token = new URL(link).searchParams.get('einladung');
    const speicher = await A.page.evaluate(() => JSON.stringify({ ...localStorage }));
    ok(!speicher.includes(token), 'Einladungstoken steht in keinem localStorage-Eintrag (Plan, Kopie, Export)');
    ok((await dlg.locator('[data-einladung]').count()) === 1 && /neuling@bzp\.test/.test(await dlg.locator('[data-einladung]').textContent()), 'offene Einladung steht in der Liste');
    const eRec = (await pb.su('GET', '/api/collections/einladungen/records')).body.items[0];
    ok(eRec.rolle === 'gewerkeleiter' && JSON.stringify(eRec.gewerke) === '["g2"]' && eRec.email === 'neuling@bzp.test', 'Einladung am Server: Rolle, Gewerk Licht, E-Mail klein', JSON.stringify(eRec));
    ok((await A.page.locator('#undo').isDisabled()), 'Einladen schafft keinen Undo-Eintrag');
    await A.page.emulateMedia({ colorScheme: 'dark' });
    await A.page.screenshot({ path: join(shots, 'mitglieder.png') });   // dunkel, mit Link und offener Einladung
    await A.page.emulateMedia({ colorScheme: 'light' });

    // vorhandenes Konto → direkt Mitglied
    await dlg.locator('#mg-mail').fill('vorhanden@bzp.test');
    await dlg.locator('#mg-rolle-neu').selectOption('betrachter');
    await dlg.locator('#mg-einladen').click();
    ok(await toastBis(A.page, /vorhanden@bzp\.test ist jetzt Mitglied/), 'vorhandenes Konto: Toast «… ist jetzt Mitglied.»', await toastText(A.page));
    await dlg.locator('[data-mitglied]', { hasText: 'Vera' }).waitFor({ timeout: 5000 });
    ok(true, 'Vera erscheint sofort in der Liste');
    await A.page.screenshot({ path: join(shots, 'mitglieder-2.png') });

    // Neuling nimmt an (zweiter, frischer Kontext) und arbeitet als Gewerkeleiter Licht
    const C = { ctx: await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' }) }; ctxs.push(C.ctx);
    C.page = await C.ctx.newPage();
    C.page.on('dialog', (d) => { ok(false, 'Browser-Dialog erschienen: ' + d.type()); d.dismiss(); });
    C.page.on('pageerror', (e) => ok(false, 'Seitenfehler: ' + e.message));
    await C.page.goto(link.replace(/^[^?]*/, `${base}/login.html`) + '&api=' + encodeURIComponent(pb.url));
    const PWC = pw();
    await C.page.fill('#e-name', 'Nele Neu'); await C.page.fill('#e-pw', PWC); await C.page.fill('#e-pw2', PWC);
    await C.page.click('#f-einladung button[type=submit]');
    await C.page.waitForURL(/index\.html/, { timeout: 10000 });
    await planOeffnen(C.page, base, pb);
    await warte(1200);
    ok((await C.page.locator('#undo').isDisabled()), 'C: Undo leer vor der ersten Änderung');
    // Ton (fremdes Gewerk) → Toast, kein Undo-Eintrag
    await titelSetzen(C.page, TON, 'Ton von Licht');
    ok(await toastBis(C.page, /Nur Licht darfst du ändern\./), 'C: Ton-Vorgang ändern → Toast «Nur Licht darfst du ändern.»', await toastText(C.page));
    ok(await C.page.locator('#undo').isDisabled(), 'C: abgelehnte Änderung hinterlässt keinen Undo-Eintrag');
    ok((await serverTitel(pb, plId, TON)) !== 'Ton von Licht', 'C: Server hat den Ton-Vorgang nicht geändert');
    // Licht (eigenes Gewerk) → geht
    await titelSetzen(C.page, LICHT, 'Licht von Nele');
    await gesendet(C.page);
    ok((await serverTitel(pb, plId, LICHT)) === 'Licht von Nele', 'C: Licht-Vorgang ändern gelingt, Server hat ihn');
    ok(!(await C.page.locator('#undo').isDisabled()), 'C: Licht-Änderung steht im Undo');
    await menueOeffnen(C.page);
    ok((await C.page.locator('#mitglieder-oeffnen').count()) === 0, 'Gewerkeleiter sieht «Mitglieder…» nicht');
    await menueZu(C.page);

    // pl ändert Neles Rolle auf Betrachter; zweiter Versuch von C wird abgelehnt und zieht die neue Rolle nach
    await dlg.locator('#mg-fertig').click();      // Liste ist veraltet (Nele kam dazu): Dialog neu öffnen
    await menueOeffnen(A.page); await A.page.locator('#mitglieder-oeffnen').click();
    await dlg.locator('#mg-einladen').waitFor({ timeout: 8000 });
    const nele = dlg.locator('[data-mitglied]', { hasText: 'Nele Neu' });
    await nele.locator('.mg-rolle').selectOption('betrachter');
    await nele.locator('.mg-speichern').click();
    ok(await toastBis(A.page, /Nele Neu: Rolle gespeichert/), 'pl: Rolle ändern → Toast');
    const nm = (await pb.su('GET', '/api/collections/mitglieder/records?filter=' + encodeURIComponent('rolle="betrachter" && plan_id="' + plId + '"'))).body.items;
    ok(nm.length === 2, 'Server: Nele und Vera sind Betrachter', String(nm.length));
    await dlg.locator('#mg-fertig').click();
    await titelSetzen(C.page, LICHT, 'Licht nochmal');
    await dlgKnopf(C.page, 'OK').waitFor({ timeout: 8000 });
    await dlgKnopf(C.page, 'OK').click();
    await C.page.waitForFunction(() => document.body.classList.contains('nur-ansicht'), null, { timeout: 8000 });
    ok(true, 'C: nach der abgelehnten Änderung gilt die neue Rolle (nur Ansicht)');

    // Entfernen über askDialog; Zurückziehen
    await menueOeffnen(A.page); await A.page.locator('#mitglieder-oeffnen').click();
    const d2 = A.page.locator('#mg-dlg'); await d2.locator('#mg-einladen').waitFor({ timeout: 8000 });
    await d2.locator('[data-mitglied]', { hasText: 'Vera' }).locator('.mg-weg').click();
    await A.page.locator('.dlg-act .btn', { hasText: 'Abbrechen' }).click();
    ok((await d2.locator('[data-mitglied]', { hasText: 'Vera' }).count()) === 1, 'Entfernen → Abbrechen lässt Vera drin');
    await d2.locator('[data-mitglied]', { hasText: 'Vera' }).locator('.mg-weg').click();
    await A.page.locator('.dlg-act .btn-danger', { hasText: 'Entfernen' }).click();
    await d2.locator('[data-mitglied]', { hasText: 'Vera' }).waitFor({ state: 'detached', timeout: 6000 });
    ok(true, 'Entfernen bestätigt → Vera weg');
    await d2.locator('#mg-mail').fill('offen@bzp.test');
    await d2.locator('#mg-einladen').click();
    await d2.locator('[data-einladung]', { hasText: 'offen@bzp.test' }).waitFor({ timeout: 6000 });
    await d2.locator('[data-einladung]', { hasText: 'offen@bzp.test' }).locator('.mg-weg').click();
    await A.page.locator('.dlg-act .btn-danger', { hasText: 'Zurückziehen' }).click();
    await d2.locator('[data-einladung]', { hasText: 'offen@bzp.test' }).waitFor({ state: 'detached', timeout: 6000 });
    ok(true, 'Einladung zurückgezogen (über askDialog)');
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
}

async function VERWALTUNG({ pb, base, browser }) {
  console.log('— VERWALTUNG');
  const PW = pw();
  const plId = await planAnlegenFuer(pb, PW);
  const sa = await kontoAnlegen(pb, { email: 'sa@bzp.test', name: 'Sabine', passwort: PW, superadmin: true });
  const nu = await kontoAnlegen(pb, { email: 'nutzer@bzp.test', name: 'Nora', passwort: PW });
  void sa;
  const ctxs = [];
  try {
    const N0 = await nutzer(browser, pb, 'nutzer@bzp.test', PW); ctxs.push(N0.ctx);
    await N0.page.goto(appUrl(base, pb, '&plan=leer'));
    await N0.page.locator('#neu-anlegen').waitFor({ timeout: 10000 });
    ok(await N0.page.locator('#neu-anlegen').isDisabled(), 'Nutzer ohne Flag: «Projekt anlegen» gesperrt');
    const S = await nutzer(browser, pb, 'sa@bzp.test', PW); ctxs.push(S.ctx);
    await planOeffnen(S.page, base, pb);
    await menueOeffnen(S.page);
    ok((await S.page.locator('#verwaltung-oeffnen').count()) === 1, 'Superadmin sieht «Verwaltung…»');
    await S.page.locator('#verwaltung-oeffnen').click();
    const v = S.page.locator('#vw-dlg');
    await v.locator('#vw-fertig').waitFor({ timeout: 8000 });
    ok((await v.locator('[data-plan]').count()) === 1 && /Paula/.test(await v.locator('[data-plan]').textContent()), 'Pläne mit Besitzer (Paula) gelistet');
    const zeile = v.locator(`[data-konto="${nu.id}"]`);
    ok(!(await zeile.locator('.mg-leitung').isChecked()), 'Konto Nora: Schalter Produktionsleitung aus');
    await zeile.locator('.mg-leitung').check();
    ok(await toastBis(S.page, /Nora darf jetzt Pläne anlegen/), 'Schalter an → Toast', await toastText(S.page));
    const rec = (await pb.su('GET', `/api/collections/users/records/${nu.id}`)).body;
    ok(rec.produktionsleitung === true, 'Server: produktionsleitung gesetzt');
    await S.page.screenshot({ path: join(shots, 'verwaltung.png') });
    // Nora lädt neu: «Neu» geht jetzt (Anmeldung wird beim Laden erneuert)
    await N0.page.goto(appUrl(base, pb, '&plan=leer'));
    await N0.page.locator('#neu-anlegen').waitFor({ timeout: 10000 });
    ok(!(await N0.page.locator('#neu-anlegen').isDisabled()), 'Nora kann nach dem Schalter «Projekt anlegen»');
    void plId;
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
}


// ── Fix-Runde nach dem Gesamtreview (C1, C2, I1–I3, I5–I7) ─────────────────────────────────────
const nurAnsichtBis = async (page, ms) => { // war «nur Ansicht» irgendwann in den nächsten ms an?
  const ende = Date.now() + ms;
  while (Date.now() < ende) { if (await nurAnsicht(page)) return true; await warte(250); }
  return false;
};
const dlgOffen = (page) => page.locator('.dlg:not([hidden])').count();
const esMerken = (ctx) => ctx.addInitScript(() => { const E = window.EventSource; window.__es = []; window.EventSource = class extends E { constructor(...a) { super(...a); window.__es.push(this); } }; });
// Die Realtime-Verbindung wie nach 300 s Ruhe verlieren: der Browser-Strom schließt, `error` kommt an
const stromAbbrechen = (page) => page.evaluate(() => { const es = window.__es[window.__es.length - 1]; es.close(); es.dispatchEvent(new Event('error')); });

async function FIXRUNDE({ pb, base, browser }) {
  console.log('— FIXRUNDE (C1 Basis, C2 Karenz, I2 5xx, I3 Ladefehler)');
  const PW = pw();
  const planId = await planAnlegenFuer(pb, PW);
  const bearb = await kontoAnlegen(pb, { email: 'bearb@bzp.test', name: 'Ben', passwort: PW });
  await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: planId, user_id: bearb.id, rolle: 'bearbeiter', gewerke: [] });
  const ctxs = [];
  try {
    // ── C1: Basis steht beim Bearbeiten fest, nicht erst wenn die Reihe dran ist ──
    const A = await nutzer(browser, pb, 'pl@bzp.test', PW); ctxs.push(A.ctx);
    const B = await nutzer(browser, pb, 'bearb@bzp.test', PW, { batchMs: 3500 }); ctxs.push(B.ctx);
    await Promise.all([planOeffnen(A.page, base, pb), planOeffnen(B.page, base, pb)]);
    await warte(1500);
    const ids = await A.page.$$eval('.tb-r', (rs) => rs.filter((r) => r.querySelector('.c-title input')).slice(0, 8).map((r) => r.dataset.id));
    const [X, Y] = ids.slice(2, 4);
    await titelSetzen(B.page, Y, 'B: Y zuerst');       // Batch 1 ist 3,5 s unterwegs
    await warte(400);
    await titelSetzen(B.page, X, 'B: X dahinter');     // wartet in der Reihe hinter Batch 1
    await warte(600);
    await titelSetzen(A.page, X, 'A: X dazwischen');   // A ändert X, solange B noch wartet
    await gesendet(A.page);
    await B.page.locator('.dlg:not([hidden]) .dlg-h').first().waitFor({ timeout: 20000 }).catch(() => {});
    const kt = (await B.page.locator('.dlg:not([hidden]) .dlg-h').count()) ? (await B.page.locator('.dlg:not([hidden]) .dlg-h').first().textContent()).trim() : '';
    ok(/wurde gerade von jemand anderem geändert/.test(kt), 'C1: B sendet nach As Änderung auf alter Basis → Konfliktdialog statt stillem Überschreiben', kt || 'kein Dialog');
    ok((await serverTitel(pb, planId, X)) === 'A: X dazwischen', 'C1: Server: As Änderung ist nicht überschrieben', await serverTitel(pb, planId, X));
    if (kt) { await dlgKnopf(B.page, 'Ihre Fassung nehmen').click(); await gesendet(B.page); }
    ok(await wertBis(B.page, X, 'A: X dazwischen', 5000), 'C1: B zeigt nach «Ihre Fassung nehmen» As Wert');
    ok(await wertBis(B.page, Y, 'B: Y zuerst', 3000), 'C1: Bs Änderung an Y bleibt');

    // ── C2: Realtime-Abbruch allein ist nicht «offline» (PocketBase schließt nach 300 s Ruhe) ──
    const K = await nutzer(browser, pb, 'pl@bzp.test', PW); ctxs.push(K.ctx);
    await esMerken(K.ctx);
    await planOeffnen(K.page, base, pb);
    await warte(1500);
    const n0 = await K.page.evaluate(() => window.__es.length);
    await stromAbbrechen(K.page);
    ok(!(await nurAnsichtBis(K.page, 8000)), 'C2: Stromabbruch mit schnellem Neuaufbau (< 10 s) löst KEIN «nur Ansicht» aus');
    ok((await K.page.evaluate(() => window.__es.length)) > n0, 'C2: die Verbindung wurde neu aufgebaut');
    await warte(1500);
    await titelSetzen(K.page, X, 'K: tippen nach Abbruch'); await gesendet(K.page);
    ok((await serverTitel(pb, planId, X)) === 'K: tippen nach Abbruch', 'C2: Eingabe nach dem Abbruch kommt an');
    // Gegenprobe: bleibt die Verbindung > 10 s weg, ist es offline (und kommt zurück)
    await K.page.route('**/api/realtime', (r) => r.abort());
    await stromAbbrechen(K.page);
    ok(!(await nurAnsichtBis(K.page, 6000)), 'C2: nach 6 s ohne Strom noch nicht offline (Karenz 10 s)');
    ok(await nurAnsichtBis(K.page, 12000), 'C2: nach der Karenz ohne Verbindung → «nur Ansicht»');
    await K.page.unroute('**/api/realtime');
    ok(await markeWeg(K.page, 60000), 'C2: Strom wieder da → Marke weg');

    // ── I2: 503 beim Senden ist vorübergehend ──
    let n503 = 0;
    await B.page.route('**/api/batch', (r) => (n503++ < 2 ? r.fulfill({ status: 503, contentType: 'text/plain', body: 'Service Unavailable' }) : r.continue()));
    await titelSetzen(B.page, Y, 'B: nach 503');
    await warte(1500);
    ok(!(await dlgOffen(B.page)), 'I2: bei 503 kein «Nicht gespeichert»-Dialog', await B.page.locator('.dlg:not([hidden])').first().textContent().catch(() => ''));
    ok((await titel(B.page, Y).inputValue()) === 'B: nach 503', 'I2: die Änderung bleibt sichtbar (nicht zurückgenommen)');
    await gesendet(B.page).catch(() => {});
    ok((await serverTitel(pb, planId, Y)) === 'B: nach 503', 'I2: nach den Wiederholungen liegt sie auf dem Server', await serverTitel(pb, planId, Y));
    ok(n503 >= 3, 'I2: der Server wurde mehrfach versucht', String(n503));
    await B.page.unroute('**/api/batch');

    // ── I3: Ladefehler nach dem Wiederverbinden bleibt nicht liegen ──
    const T = await nutzer(browser, pb, 'bearb@bzp.test', PW, { blockRealtime: true }); ctxs.push(T.ctx);   // T erfährt Änderungen nur durchs Laden
    await planOeffnen(T.page, base, pb);
    await warte(1500);
    await T.ctx.setOffline(true);
    await warte(600);
    await titelSetzen(A.page, X, 'A: während T offline');   // T verpasst das Realtime-Ereignis
    await gesendet(A.page);
    const bis = Date.now() + 26000;   // länger als jeder Auslöser eines späteren Ladens (Wiederverbinden, Realtime-Neuaufbau)
    await T.page.route('**/api/collections/plaene/records**', (r) => (Date.now() < bis ? r.fulfill({ status: 503, contentType: 'text/plain', body: 'x' }) : r.continue()));
    await T.ctx.setOffline(false);
    ok(await wertBis(T.page, X, 'A: während T offline', 55000), 'I3: nach 503 beim Laden nach dem Wiederverbinden wird erneut geladen, T sieht As Änderung');
    await T.page.unroute('**/api/collections/plaene/records**');
    ok(await markeWeg(T.page, 20000), 'I3: Marke weg');
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
}

// I1: zwei Nutzer ändern verschiedene Kinder eines Sammelvorgangs → kein Konflikt am Elternvorgang
async function SAMMELVORGANG({ pb, base, browser }) {
  console.log('— SAMMELVORGANG (I1)');
  const PW = pw();
  const st = createStore(fixturePlan('klassentreffen-festival'));
  const g = st.state.gewerke[0].id;
  const e = st.apply({ type: 'addTask', task: { gewerk: g, title: 'Sammel-E', start: '2026-07-13T08:00', end: '2026-07-13T09:00' } }).id;
  const k1 = st.apply({ type: 'addTask', task: { gewerk: g, parent: e, title: 'Kind-1', start: '2026-07-13T08:00', end: '2026-07-13T10:00' } }).id;
  const k2 = st.apply({ type: 'addTask', task: { gewerk: g, parent: e, title: 'Kind-2', start: '2026-07-13T09:00', end: '2026-07-13T12:00' } }).id;
  const planId = await planAnlegenFuer(pb, PW, st.state);
  const bearb = await kontoAnlegen(pb, { email: 'bearb@bzp.test', name: 'Ben', passwort: PW });
  await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: planId, user_id: bearb.id, rolle: 'bearbeiter', gewerke: [] });
  const ctxs = [];
  try {
    const A = await nutzer(browser, pb, 'pl@bzp.test', PW); ctxs.push(A.ctx);
    const B = await nutzer(browser, pb, 'bearb@bzp.test', PW, { blockRealtime: true }); ctxs.push(B.ctx);   // B erfährt von As Änderung nichts: die rev der Hülle ist bei B veraltet
    await Promise.all([planOeffnen(A.page, base, pb), planOeffnen(B.page, base, pb)]);
    await warte(1500);
    const feld = (page, id, f) => page.locator(`.tb-r[data-id="${id}"] .c-${f} input`);
    const setze = async (page, id, f, wert) => { await feld(page, id, f).fill(wert); await page.locator(`.tb-r[data-id="${id}"] .en-ok`).click(); };
    await setze(A.page, k1, 'start', '2026-07-13T06:00'); await gesendet(A.page);
    await setze(B.page, k2, 'end', '2026-07-13T14:00');
    await warte(2500);
    ok(!(await dlgOffen(B.page)), 'I1: kein Dialog bei B, obwohl A ein anderes Kind geändert hat', await B.page.locator('.dlg:not([hidden]) .dlg-h').first().textContent().catch(() => ''));
    await gesendet(B.page).catch(() => {});
    const daten = async (id) => (await pb.su('GET', `/api/collections/vorgaenge/records?filter=${encodeURIComponent(`plan_id="${planId}" && eid="${id}"`)}`)).body.items[0].daten;
    ok((await daten(k1)).start === '2026-07-13T06:00', 'I1: Server: As Änderung an Kind-1 bleibt', (await daten(k1)).start);
    ok((await daten(k2)).end === '2026-07-13T14:00', 'I1: Server: Bs Änderung an Kind-2 ist angekommen', (await daten(k2)).end);
    // Die Hülle stimmt bei beiden (A bekommt Bs Kind per Realtime; ein frischer Stand rechnet sie neu)
    await warte(1500);
    ok((await feld(A.page, e, 'start').inputValue()) === '2026-07-13T06:00' && (await feld(A.page, e, 'end').inputValue()) === '2026-07-13T14:00', 'I1: A: Hülle 06:00–14:00', await feld(A.page, e, 'start').inputValue() + ' – ' + await feld(A.page, e, 'end').inputValue());
    await planOeffnen(B.page, base, pb);   // frisch laden
    await B.page.locator(`.tb-r[data-id="${e}"]`).waitFor({ timeout: 10000 });
    ok((await feld(B.page, e, 'start').inputValue()) === '2026-07-13T06:00' && (await feld(B.page, e, 'end').inputValue()) === '2026-07-13T14:00', 'I1: B (frisch geladen): Hülle 06:00–14:00');
  } finally { for (const c of ctxs) await c.close().catch(() => {}); }
}

// I7: Undo nach einer Zeitänderung mit bestätigtem Bedarf klappt auch ohne Leitungsrecht
async function UNDO_BEDARF({ pb, base, browser }) {
  console.log('— UNDO BEDARF (I7)');
  const PW = pw();
  const plan = fixturePlan('klassentreffen-festival');
  const ziel = plan.tasks.find((t) => t.start && t.end && !t.parent && !plan.tasks.some((k) => k.parent === t.id));
  ziel.res = [{ rid: 'crew', n: 2, von: null, bis: null, status: 'bestaetigt', bestaetigtAm: '2026-09-01T10:00:00.000Z', notiz: 'Zusage' }];
  const planId = await planAnlegenFuer(pb, PW, plan);
  const bearb = await kontoAnlegen(pb, { email: 'bearb@bzp.test', name: 'Ben', passwort: PW });
  await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: planId, user_id: bearb.id, rolle: 'bearbeiter', gewerke: [] });
  const B = await nutzer(browser, pb, 'bearb@bzp.test', PW);
  try {
    await planOeffnen(B.page, base, pb);
    await warte(1500);
    const daten = async () => (await pb.su('GET', `/api/collections/vorgaenge/records?filter=${encodeURIComponent(`plan_id="${planId}" && eid="${ziel.id}"`)}`)).body.items[0].daten;
    ok((await daten()).res[0].status === 'bestaetigt', 'Vorbedingung: Bedarf bestätigt auf dem Server');
    const row = B.page.locator(`.tb-r[data-id="${ziel.id}"]`);
    const start0 = await row.locator('.c-start input').inputValue();
    const d = new Date(start0 + ':00Z'); d.setUTCHours(d.getUTCHours() - 1);
    await row.locator('.c-start input').fill(d.toISOString().slice(0, 16));
    await row.locator('.en-ok').click();
    await gesendet(B.page);
    const nach = await daten();
    ok(nach.start !== ziel.start && nach.res[0].status === undefined, 'Zeit verschoben, Bedarf wieder «angefragt» (Server)', JSON.stringify(nach.res));
    await B.page.evaluate(() => document.activeElement?.blur());
    await B.page.keyboard.press('Control+z');
    const toast = await B.page.waitForFunction(() => { const t = document.getElementById('toast'); return t && !t.hidden && t.textContent ? t.textContent : null; }, null, { timeout: 4000 }).then((h) => h.jsonValue()).catch(() => null);
    await warte(1500);
    ok(!(await dlgOffen(B.page)), 'I7: ⌘Z → kein «Nicht gespeichert»-Dialog', await B.page.locator('.dlg:not([hidden])').first().textContent().catch(() => ''));
    await gesendet(B.page).catch(() => {});
    const zurueck = await daten();
    ok(zurueck.start === ziel.start, 'I7: die Zeit ist auf dem Server zurück', zurueck.start + ' vs ' + ziel.start);
    ok(zurueck.res[0].status === undefined && zurueck.res[0].notiz === undefined, 'I7: der Bedarf bleibt «angefragt» (Status nicht wiederhergestellt)', JSON.stringify(zurueck.res));
    ok(/angefragt/.test(toast || ''), 'I7: Toast sagt, dass der Bedarf angefragt bleibt', String(toast));
  } finally { await B.ctx.close().catch(() => {}); }
}

// I5: Start ohne Netz zeigt für JEDEN Start die lokale Kopie (nicht nur beim Live-Monitor)
async function START_OFFLINE({ pb, base, browser }) {
  console.log('— START OHNE NETZ (I5)');
  const PW = pw();
  await planAnlegenFuer(pb, PW);
  const KT = fixturePlan('klassentreffen-festival');
  const P = await nutzer(browser, pb, 'pl@bzp.test', PW);   // KEIN Live-Monitor
  try {
    await planOeffnen(P.page, base, pb);
    await warte(1500);
    ok((await P.page.evaluate(() => localStorage.getItem('bzp_live'))) !== '1', 'Vorbedingung: kein Live-Monitor');
    await pb.stop();
    for (const [name, url] of [['normaler Start', appUrl(base, pb)], ['?plan=leer', appUrl(base, pb, '&plan=leer')]]) {
      await P.page.goto(url);
      ok(await markeBis(P.page, '📡 Offline – nur Ansicht', 20000), `I5: ${name} ohne Netz → «📡 Offline – nur Ansicht»`, await markeText(P.page));
      ok(!P.page.url().includes('login.html') && !(await P.page.locator('#dlg:not([hidden])').count()), `I5: ${name}: kein login.html, kein Projektdialog`, P.page.url());
      ok((await P.page.locator('#proj-name').textContent()).includes(KT.project.name), `I5: ${name}: der Plan steht da (aus der lokalen Kopie)`);
    }
    // Ohne Kopie bleibt es beim bisherigen Weg (Projektdialog mit Fehlermeldung)
    await P.page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k !== 'bzp_auth' && k !== 'bzp_seeded') localStorage.removeItem(k); });
    await P.page.goto(appUrl(base, pb));
    await P.page.locator('#dlg .dlg-sub', { hasText: 'Keine Verbindung' }).waitFor({ timeout: 15000 }).catch(() => {});
    ok(await P.page.locator('#dlg .dlg-sub', { hasText: 'Keine Verbindung' }).isVisible(), 'I5: ohne Kopie: Projektdialog nennt «Keine Verbindung»');
  } finally { await P.ctx.close().catch(() => {}); }
}

// I6: geteilter Rechner, zwei Tabs: Abmelden in Tab 1 beendet auch Tab 2
async function ZWEI_TABS({ pb, base, browser }) {
  console.log('— ZWEI TABS (I6)');
  const PW = pw();
  await planAnlegenFuer(pb, PW);
  const P = await nutzer(browser, pb, 'pl@bzp.test', PW);
  try {
    const p1 = P.page, p2 = await P.ctx.newPage();
    p2.on('pageerror', (e) => ok(false, 'Seitenfehler (Tab 2): ' + e.message));
    await planOeffnen(p1, base, pb);
    await planOeffnen(p2, base, pb);
    await warte(1500);
    const kopien = () => p1.evaluate(() => Object.keys(localStorage).filter((k) => k === 'bzp_active' || k.startsWith('bzp_p_') || (k === 'bzp_projects' && localStorage.getItem(k) !== '[]')));
    ok((await kopien()).length >= 2, 'Vorbedingung: lokale Kopie vorhanden');
    await p1.locator('#proj-knopf').click();
    await p1.locator('.mn #abmelden').click();
    await p1.waitForURL(/login\.html/, { timeout: 10000 });
    await p2.waitForURL(/login\.html/, { timeout: 10000 }).catch(() => {});
    ok(p2.url().includes('login.html'), 'I6: Tab 2 ist nach dem Abmelden in Tab 1 auf login.html', p2.url());
    await warte(2000);   // nichts darf zurückschreiben (Erneuerung, Kopie)
    ok((await kopien()).length === 0, 'I6: keine lokale Kopie mehr', (await kopien()).join(','));
    ok((await p1.evaluate(() => localStorage.getItem('bzp_auth'))) === null, 'I6: kein Token im Speicher');
  } finally { await P.ctx.close().catch(() => {}); }
}

const ABSCHNITTE = { ANMELDUNG, ZWEI_NUTZER, IMPORT, OFFLINE, MONITOR, MONITOR_ABGELAUFEN, ABMELDEN, MITGLIEDER, VERWALTUNG, FIXRUNDE, SAMMELVORGANG, UNDO_BEDARF, START_OFFLINE, ZWEI_TABS };
const i = process.argv.indexOf('--nur');
const nur = i > 0 ? (process.argv[i + 1] || '').toUpperCase().replace(' ', '_') : null;
if (nur && !ABSCHNITTE[nur]) { console.error('Unbekannter Abschnitt: ' + nur + ' (' + Object.keys(ABSCHNITTE).join(', ') + ')'); process.exit(2); }

let server, browser, pb, smtp;
try {
  server = await statischerServer();
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await firefox.launch({ executablePath: exe });
  for (const [n, f] of Object.entries(ABSCHNITTE)) {
    if (nur && nur !== n) continue;
    smtp = await smtpEmpfaenger();
    pb = await startePb({ origins: base, appUrl: base }); // frischer Server je Abschnitt
    try { await f({ pb, base, browser, smtp }); } catch (e) { console.log('  PB-Log: ' + pb.log().slice(-800)); throw e; } finally { await pb.stop(); pb = null; smtp.schliessen(); }
  }
} catch (e) { console.log('✗ Abbruch: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')); fehler++; }
finally {
  if (pb) await pb.stop();
  if (browser) await browser.close();
  if (server) server.close();
}
console.log(fehler ? `\n${fehler} Fehler` : '\nAlle Prüfungen grün');
process.exit(fehler ? 1 : 0);
