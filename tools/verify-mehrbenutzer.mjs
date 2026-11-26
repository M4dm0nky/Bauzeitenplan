// Mehrbenutzer-Prüfung im echten Browser (Firefox) gegen eine lokale PocketBase.
//   node tools/verify-mehrbenutzer.mjs [--nur ANMELDUNG|ZWEI_NUTZER|IMPORT]
// ANMELDUNG: login.html — falsches/richtiges Passwort, «Passwort vergessen», Einladung (neues Konto,
// vorhandenes Konto, ungültig), Passwort zurücksetzen (Mail über einen kleinen lokalen SMTP-Empfänger).
// Task 11 ergänzt weitere Abschnitte in ABSCHNITTE. Alle Passwörter entstehen zur Laufzeit.
import { firefox } from 'playwright-core';
import { createServer } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mustFirefox } from './browsers.mjs';
import { createPb } from '../js/pb.js';
import { createServerPlan } from '../js/server.js';
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

// Minimaler SMTP-Empfänger: sammelt Mails, damit der Reset-Link aus der echten PB-Mail kommt.
function smtpEmpfaenger() {
  const mails = [];
  const socks = new Set();
  const s = tcpServer((sock) => {
    socks.add(sock); sock.on('close', () => socks.delete(sock));
    let puffer = '', daten = null;
    sock.write('220 localhost ESMTP\r\n');
    sock.on('data', (d) => {
      puffer += d.toString('latin1');
      for (;;) {
        if (daten !== null) {
          const i = puffer.indexOf('\r\n.\r\n');
          if (i < 0) return;
          mails.push(daten + puffer.slice(0, i)); daten = null; puffer = puffer.slice(i + 5);
          sock.write('250 OK\r\n'); continue;
        }
        const i = puffer.indexOf('\r\n');
        if (i < 0) return;
        const z = puffer.slice(0, i).toUpperCase(); puffer = puffer.slice(i + 2);
        if (z.startsWith('DATA')) { daten = ''; sock.write('354 go\r\n'); }
        else if (z.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
        else if (z.startsWith('EHLO')) sock.write('250 localhost\r\n');
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, mails, port: s.address().port, schliessen: () => { for (const k of socks) k.destroy(); s.close(); } })));
}
const qp = (t) => t.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

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
async function nutzer(browser, pb, email, passwort, { blockRealtime = false, batchMs = 0 } = {}) {
  const a = await anmeldenRoh(pb.url, email, passwort);
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
  await ctx.addInitScript((v) => { try { if (!localStorage.getItem('bzp_seeded')) { localStorage.setItem('bzp_seeded', '1'); localStorage.setItem('bzp_auth', v); } } catch (e) { /* egal */ } }, JSON.stringify({ token: a.token, record: a.record }));
  if (blockRealtime) await ctx.route('**/api/realtime**', (r) => r.abort());
  // Senden verzögern: fetch an /api/batch im Seitenkontext aufhalten. (page.route würde in Firefox auch die
  // Realtime-Strecke (EventSource) puffern; hier läuft sie unberührt.)
  if (batchMs) await ctx.addInitScript((ms) => { const f = window.fetch.bind(window); window.fetch = (u, o) => (String(u && u.url || u).includes('/api/batch') ? new Promise((r) => setTimeout(r, ms)).then(() => f(u, o)) : f(u, o)); }, batchMs);
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
    await titelSetzen(B.page, Z, 'B: Z vier'); await gesendet(B.page);
    await wertBis(A.page, Z, 'B: Z vier');
    await A.page.keyboard.press('Control+z');
    await dlgKnopf(A.page, 'Abbrechen').click();
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
    await titelSetzen(D.page, X, 'Betrachter darf nicht');
    await D.page.locator('#toast').waitFor({ state: 'visible', timeout: 3000 });
    ok(/Nur ansehen: du bist Betrachter/.test(await D.page.locator('#toast').textContent()), 'Betrachter: «Nur ansehen: du bist Betrachter.»');
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

const ABSCHNITTE = { ANMELDUNG, ZWEI_NUTZER, IMPORT };
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
