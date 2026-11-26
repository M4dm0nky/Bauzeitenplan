// Mehrbenutzer-Prüfung im echten Browser (Firefox) gegen eine lokale PocketBase.
//   node tools/verify-mehrbenutzer.mjs [--nur ANMELDUNG]
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
  const s = tcpServer((sock) => {
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
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ s, mails, port: s.address().port })));
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
  ok(e1.link.startsWith(`${base.replace(/127\.0\.0\.1:\d+/, '127.0.0.1:' + new URL(base).port)}/login.html?einladung=`), 'Einladungslink zeigt auf login.html der App', e1.link);
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

const ABSCHNITTE = { ANMELDUNG };
const i = process.argv.indexOf('--nur');
const nur = i > 0 ? (process.argv[i + 1] || '').toUpperCase() : null;
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
    try { await f({ pb, base, browser, smtp }); } catch (e) { console.log('  PB-Log: ' + pb.log().slice(-800)); throw e; } finally { await pb.stop(); pb = null; smtp.s.close(); }
  }
} catch (e) { console.log('✗ Abbruch: ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')); fehler++; }
finally {
  if (pb) await pb.stop();
  if (browser) await browser.close();
  if (server) server.close();
}
console.log(fehler ? `\n${fehler} Fehler` : '\nAlle Prüfungen grün');
process.exit(fehler ? 1 : 0);
