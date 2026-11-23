// ── Sync & Offline im echten Browser prüfen ──────────────────────────────────
// Zwei Geräte = zwei Browser-Kontexte mit gemeinsamem Fake-GitHub (eine Map im
// Node-Prozess, Antwortformen wie in tests/sync.test.mjs). Geprüft wird, was nur
// im Browser schiefgeht: Reiter «Speicherort», Statussymbol, Konfliktdialog,
// Löschen, Bündelfenster, Service Worker ohne Netz.
//
//   node tools/verify-sync.mjs           Fake-GitHub, alle Schritte
//   node tools/verify-sync.mjs --echt    echtes Daten-Repo: nur «Zwei Geräte» + Aufräumen
//                                        (BZP_TOKEN erforderlich, BZP_REPO optional,
//                                         Vorgabe M4dm0nky/Bauzeitenplan-Daten)
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mustFirefox, chromiumExe } from './browsers.mjs';
import { festivalMitDaten } from './festival-fixture.mjs';
import { createServer } from 'node:http';
import { planLaden } from './plan-fixture.mjs';
import { einrichten, projektMenue } from './ui-helfer.mjs';

const ECHT = process.argv.includes('--echt');
const TOKEN = process.env.BZP_TOKEN || '';
const ECHT_REPO = process.env.BZP_REPO || 'M4dm0nky/Bauzeitenplan-Daten';
if (ECHT && !TOKEN) {
  console.error('--echt braucht den Schlüssel in der Umgebung: BZP_TOKEN=github_pat_… [BZP_REPO=owner/repo] node tools/verify-sync.mjs --echt');
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });
const shot = (page, name) => ECHT ? null : page.screenshot({ path: join(here, 'shots', 'verify-sync-' + name + '.png') });

const exe = mustFirefox();

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, /^[\\/]$/.test(rel) ? 'index.html' : rel);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); return res.end('x'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

let browser = null;
let problems = 0;
const jsErrors = [];
const check = async (name, fn) => {
  let r;
  try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
  if (r === true) console.log('  ✓ ' + name);
  else { console.log('  ✗ ' + name + ': ' + r); problems++; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); }
  return false;
};

// ── Fake-GitHub: «das Repo» ──────────────────────────────────────────────────
// Antwortformen wie tests/sync.test.mjs (Contents-API). Ohne `no-store` kann der
// Fake hier nicht unterscheiden (Playwright sieht den Cache-Modus nicht) — das
// deckt tests/sync.test.mjs ab.
const neuerFake = () => {
  const dateien = new Map();            // Pfad → { text, sha }
  const f = { dateien, puts: 0, deletes: 0, gets: 0, schluesselOk: true, netz: true, repoWeg: false, zaehler: 0 };
  const b64 = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  f.handler = async (route) => {
    const req = route.request();
    const antwort = (status, json) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(json) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    if (!f.netz) return route.abort('failed');
    if (!f.schluesselOk) return antwort(401, { message: 'Bad credentials' });
    const u = new URL(req.url());
    const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    const pfad = m ? decodeURIComponent(m[1]) : '';
    const methode = req.method();
    if (methode === 'GET' && f.repoWeg) { f.gets++; return antwort(404, { message: 'Not Found' }); }   // Token ohne Zugriff: Repo und Verzeichnis 404
    if (methode === 'GET') {
      f.gets++;
      if (!m) return antwort(200, { full_name: 'x/y', private: true });   // pruefe(): GET /repos/{repo}
      if (pfad === 'projekte') {
        const liste = [...dateien].filter(([p]) => p.startsWith('projekte/'))
          .map(([p, e]) => ({ name: p.slice(9), path: p, sha: e.sha, type: 'file' }));
        return liste.length ? antwort(200, liste) : antwort(404, { message: 'Not Found' });
      }
      const e = dateien.get(pfad);
      if (!e) return antwort(404, { message: 'Not Found' });
      return antwort(200, { name: pfad.split('/').pop(), path: pfad, content: b64(e.text), sha: e.sha, encoding: 'base64', type: 'file' });
    }
    const body = JSON.parse(req.postData() || '{}');
    const e = dateien.get(pfad);
    if (methode === 'PUT') {
      f.puts++;
      if (e && body.sha !== e.sha) return antwort(409, { message: 'does not match' });
      if (!e && body.sha) return antwort(422, { message: "sha wasn't supplied" });
      const sha = 'sha' + (++f.zaehler).toString(16).padStart(8, '0');
      dateien.set(pfad, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha });
      return antwort(e ? 200 : 201, { content: { name: pfad.split('/').pop(), path: pfad, sha }, commit: { sha: 'c' + sha } });
    }
    if (methode === 'DELETE') {
      f.deletes++;
      if (!e) return antwort(404, { message: 'Not Found' });
      if (body.sha !== e.sha) return antwort(409, { message: 'does not match' });
      dateien.delete(pfad);
      return antwort(200, { content: null, commit: { sha: 'cdel' } });
    }
    return antwort(405, {});
  };
  f.namen = () => [...dateien.values()].map((e) => { try { return JSON.parse(e.text).project.name; } catch { return '?'; } });
  f.setzeNetz = (an) => { f.netz = an; };
  return f;
};

// ── Geräte ───────────────────────────────────────────────────────────────────
// serviceWorkers:'block': ein Worker könnte Playwrights Route umgehen; für die
// Sync-Schritte ist er ohnehin nicht Gegenstand (Offline-Start prüft ihn gesondert).
const geraet = async (fake, base) => {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, serviceWorkers: 'block' });
  if (ECHT) {
    await ctx.addInitScript(([t, r]) => { try { localStorage.setItem('bzp_sync', JSON.stringify({ token: t, repo: r })); } catch { /* */ } }, [TOKEN, ECHT_REPO]);
  } else {
    // Jedes Gerät hat sein eigenes Netz: zwei Geräte teilen sich EIN Repo, nicht den Offline-Zustand.
    await ctx.route('https://api.github.com/**', (route) => (g.offline ? route.abort('failed') : fake.handler(route)));
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => jsErrors.push('JS: ' + e.message));
  const g = { ctx, page, base, offline: false };
  // Netz aus/an: Kontext-Offline für Seitenabrufe UND der Fake kappt die API.
  // (Playwright lässt gerouteten Verkehr je nach Engine am Offline-Schalter vorbei.)
  g.netz = async (an) => { await ctx.setOffline(!an); g.offline = !an; };
  return g;
};

const start = async (g, query = '?plan=leer') => {
  await g.page.goto(g.base + '/index.html' + query);
  await g.page.waitForTimeout(700);
};

const legeAn = async (g, name) => {
  const p = g.page;
  if (await p.locator('#dlg').isHidden()) {
    await projektMenue(p, 'new-proj');
  }
  // Die Vorlage hat keine Termine mehr; der Abgleich soll einen Plan MIT Balken sehen.
  await festivalMitDaten(p, name);
  await p.waitForTimeout(700);
};

const verbinden = async (g, token = 'ghp_fake') => {
  const p = g.page;
  await einrichten(p, 'sync');
  await p.fill('#sync-token', token);
  await p.locator('#sync-verbinden').click();
  await p.waitForTimeout(150);
  await p.keyboard.press('Escape');      // der Speicherort-Dialog liegt über der App
};
// Ein frisch geöffnetes Gerät ohne Projekt hat keine Schiene (rail.js entsteht erst in
// mount()) und damit keinen Weg zum Reiter «Speicherort». Für solche Geräte den
// Schlüssel direkt hinterlegen und neu laden; der UI-Weg ist in Schritt 1 geprüft.
const verbindenStill = async (g) => {
  await g.page.evaluate(() => localStorage.setItem('bzp_sync', JSON.stringify({ token: 'ghp_fake', repo: 'M4dm0nky/Bauzeitenplan-Daten' })));
  await start(g);
  await warteZustand(g, 'ok');
};
const einZu = (g) => g.page.evaluate(() => document.getElementById('ein-zu').click());

const syncZustand = (g) => g.page.evaluate(() => { const n = document.getElementById('sync-state'); return n.hidden ? 'aus' : n.dataset.state; });
const warteZustand = async (g, soll, ms = 8000) => {
  const ok = await bis(async () => (await syncZustand(g)) === soll, ms);
  return ok ? true : `Zustand «${await syncZustand(g)}» statt «${soll}»`;
};
// Abgleich wie beim Wegwechseln des Tabs auslösen (statt 10 s Bündelfenster abzuwarten).
const ausloesen = async (g) => {
  await g.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  });
  await g.page.waitForTimeout(250);
};

const dialogZu = async (g) => {
  const p = g.page;
  if (await p.locator('#dlg').isVisible()) {
    const abbr = p.locator('#dlg .dlg-act .btn', { hasText: 'Abbrechen' });
    if (await abbr.count()) await abbr.click();
    else await p.evaluate(() => { document.getElementById('dlg').hidden = true; });
  }
  await p.evaluate(() => document.getElementById('ein-zu').click());
};
// Nur die EIGENEN Projekte (erste .dlg-list).
const eigeneProjekte = async (g) => {
  const p = g.page;
  await projektMenue(p, 'proj-menu');
  await p.locator('#dlg').waitFor({ state: 'visible' });
  const namen = await p.evaluate(() => {
    const h = [...document.querySelectorAll('#dlg .dlg-h3')].find((x) => x.textContent === 'Öffnen');
    return h ? [...h.nextElementSibling.querySelectorAll('.dlg-open-n')].map((n) => n.textContent) : [];
  });
  await dialogZu(g);
  return namen;
};

const ersteZeileTitel = async (g, text) => {
  const p = g.page;
  if (await p.locator('.tb-r').count() === 0) await p.locator('[data-view="tabelle"]').click();
  const t = p.locator('.tb-r .c-title input').first();
  await t.fill(text);
  await t.blur();
  await p.waitForTimeout(1300);   // 800-ms-Speicherverzögerung + Luft
};
const zeilen = (g) => g.page.locator('.tb-r').count();

// Der Abgleich fragt vor jedem lokalen Löschen. `label` = Knopf im Dialog.
const repoLoeschDialog = async (g, label) => {
  const dlg = g.page.locator('.dlg', { hasText: 'Im Daten-Repo gelöscht' });
  if (!(await bis(async () => (await dlg.count()) > 0, 8000))) return false;
  await dlg.locator('.dlg-act .btn', { hasText: label }).click();
  await g.page.waitForTimeout(500);
  return true;
};
const indexIds = (g) => g.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bzp_projects')).map((e) => e.id); } catch { return []; } });
const planKeys = (g) => g.page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('bzp_p_')));

const schliesse = async (...gs) => { for (const g of gs) { try { await g.ctx.close(); } catch { /* */ } } };

// ── Lauf ─────────────────────────────────────────────────────────────────────
let BASE = '';
try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = 'http://127.0.0.1:' + server.address().port;
  browser = await firefox.launch({ executablePath: exe });

  const geraetFn = (fake) => geraet(fake, BASE);

  // ─── 1. Zwei Geräte ───────────────────────────────────────────────────────
  console.log('\nZWEI GERÄTE' + (ECHT ? ' (echtes Repo ' + ECHT_REPO + ')' : ''));
  {
    const fake = neuerFake();
    const suffix = ECHT ? '-' + Date.now().toString(36) : '';
    const PROBE = 'Sync-Probe' + suffix, NURB = 'Nur-B' + suffix;
    const A = await geraetFn(fake), B = await geraetFn(fake);
    try {
      await start(A);
      await legeAn(A, PROBE);
      if (!ECHT) await check('A: vor dem Verbinden ist die Statusmarke ausgeblendet (Nicht-Treffer)', async () => (await syncZustand(A)) === 'aus' ? true : 'sichtbar: ' + await syncZustand(A));
      if (!ECHT) await check('Fake ist vor dem Verbinden leer (Nicht-Treffer)', async () => fake.dateien.size === 0 ? true : fake.dateien.size + ' Dateien');
      if (ECHT) { await A.page.reload(); await A.page.waitForTimeout(800); }
      else await verbinden(A);
      await check('A: Reiter «Speicherort» zeigt «Verbunden mit …»', async () => {
        if (ECHT) { await einrichten(A.page, 'sync'); }
        const ok = await bis(async () => /Verbunden mit/.test(await A.page.locator('#sync-info').textContent()), 5000);
        if (ECHT) await A.page.keyboard.press('Escape');
        return ok ? true : 'Text: ' + await A.page.locator('#sync-info').textContent();
      });
      await check('A: Abgleich endet auf «ok»', () => warteZustand(A, 'ok'));
      await shot(A.page, 'speicherort');
      await einZu(A);
      await shot(A.page, 'kopfzeile');
      if (!ECHT) await check('A: Datei «' + PROBE + '» steht im Fake', async () => fake.namen().includes(PROBE) ? true : 'Dateien: ' + fake.namen().join(','));

      // B: lokal «Nur-B» anlegen, DANN verbinden → bekommt Sync-Probe, schickt Nur-B
      await start(B);
      await legeAn(B, NURB);
      if (ECHT) { await B.page.reload(); await B.page.waitForTimeout(800); }
      else await verbinden(B);
      await check('B: Abgleich endet auf «ok»', async () => { const r = await warteZustand(B, 'ok'); return r === true ? true : r + ' — title: ' + await B.page.locator('#sync-state').getAttribute('title'); });
      await einZu(B);
      await check('B: kein Konfliktdialog bei sauberem Abgleich (Nicht-Treffer)', async () =>
        (await B.page.locator('.dlg', { hasText: 'Zwei verschiedene Fassungen' }).count()) === 0 ? true : 'Dialog erschien');
      await start(B);
      await warteZustand(B, 'ok');
      await check('B: nach Neuladen steht «' + PROBE + '» in der Projektliste', async () => {
        const n = await eigeneProjekte(B);
        return n.includes(PROBE) ? true : 'Liste: ' + n.join(', ');
      });
      await check('Phasen reisen mit: das Gerät B hat die vier Phasen von A samt Art und id (Repo → B)', async () => {
        const von = (g) => g.page.evaluate((name) => {
          for (const k of Object.keys(localStorage)) {
            if (!k.startsWith('bzp_p_')) continue;
            const pl = JSON.parse(localStorage.getItem(k));
            if (pl.project && pl.project.name === name) return (pl.phases || []).map((p) => p.art + ':' + p.id);
          }
          return null;
        }, PROBE);
        const a = await von(A), b = await von(B);
        if (!a || a.length !== 4) return 'A hat ' + JSON.stringify(a);
        if (!b || b.length !== 4) return 'B hat ' + JSON.stringify(b);
        if (!a.every((x) => /^(planung|vorbereitung|aufbau|show|abbau):.+/.test(x))) return 'ohne Art: ' + a;
        return JSON.stringify(a) === JSON.stringify(b) ? true : a.join(',') + ' ≠ ' + b.join(',');
      });
      if (!ECHT) await check('Phasen stehen in der Datei im Repo (Fake), mit Art', async () => {
        const e = [...fake.dateien].find(([pf]) => pf.startsWith('projekte/') && JSON.parse(fake.dateien.get(pf).text).project.name === PROBE);
        const ph = e ? JSON.parse(e[1].text).phases : null;
        return ph && ph.length === 4 && ph.every((x) => x.art && x.id) ? true : JSON.stringify(ph);
      });
      if (!ECHT) await check('«Nur-B» steht danach im Fake (Richtung B → Repo)', async () =>
        fake.namen().includes(NURB) ? true : 'Dateien: ' + fake.namen().join(','));
      await check('A kennt «Nur-B» noch NICHT vor seinem nächsten Abgleich (Nicht-Treffer)', async () => {
        const n = await eigeneProjekte(A);
        return n.includes(NURB) ? '«Nur-B» schon da' : true;
      });
      await ausloesen(A);
      await check('A: nach dem nächsten Abgleich steht «Nur-B» in der Liste (Richtung Repo → A)', async () => {
        let n = [];
        const ok = await bis(async () => { n = await eigeneProjekte(A); return n.includes(NURB); }, 6000);
        return ok ? true : 'Liste: ' + n.join(', ');
      });

      if (ECHT) {
        // Aufräumen: beide Testprojekte über die Oberfläche löschen (online → auch im Repo), dann A nachziehen lassen.
        for (const name of [PROBE, NURB]) {
          await projektMenue(B.page, 'proj-menu');
          const zeile = B.page.locator('#dlg .dlg-row', { hasText: name });
          if (await zeile.count()) {
            await zeile.locator('.dlg-del').click();
            await B.page.locator('.dlg .dlg-act .btn-danger').click();
            await B.page.waitForTimeout(1500);
          }
          await dialogZu(B);
        }
        await ausloesen(A); await A.page.waitForTimeout(2500);
        await check('Aufräumen: Testprojekte sind auf B und A weg', async () => {
          // Aus dem Index lesen, nicht über die Oberfläche: ohne offenes Projekt
          // gibt es keine Schiene (#rail-ein entsteht erst in mount()).
          const index = (g) => g.page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bzp_projects') || '[]').map((e) => e.name); } catch { return []; } });
          const nb = await index(B), na = await index(A);
          return [...nb, ...na].some((n) => n === PROBE || n === NURB) ? 'noch da: ' + nb.join(',') + ' | ' + na.join(',') : true;
        });
      }
    } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A, B); }
  }

  if (!ECHT) {
    // ─── 2. Konflikt ────────────────────────────────────────────────────────
    console.log('\nKONFLIKT');
    {
      const fake = neuerFake();
      const mk = () => geraet(fake, BASE);
      const A = await mk(), B = await mk();
      try {
        await start(A); await legeAn(A, 'Sync-Probe');
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await start(B); await verbindenStill(B);
        await start(B); await warteZustand(B, 'ok');
        await check('Ausgangslage: beide Geräte haben «Sync-Probe» und sind abgeglichen', async () => {
          const a = await eigeneProjekte(A), b = await eigeneProjekte(B);
          return a.includes('Sync-Probe') && b.includes('Sync-Probe') && fake.dateien.size === 1 ? true : `A ${a} / B ${b} / Fake ${fake.dateien.size}`;
        });

        await A.netz(false); await B.netz(false);
        await ersteZeileTitel(A, 'Titel von A');
        await ersteZeileTitel(B, 'Titel von B');
        await check('offline: nichts ging ins Repo (Nicht-Treffer)', async () => !fake.dateien.size || !/Titel von/.test([...fake.dateien.values()][0].text) ? true : 'Repo enthält schon eine Änderung');

        await A.netz(true);
        await ausloesen(A);
        await check('A online: lädt hoch, Repo trägt «Titel von A»', async () => {
          const ok = await bis(async () => /Titel von A/.test([...fake.dateien.values()][0].text), 6000);
          return ok ? true : 'Repo trägt A nicht';
        });
        await check('A: Abgleich endet auf «ok»', () => warteZustand(A, 'ok'));

        await B.netz(true);
        await ausloesen(B);
        const dlg = B.page.locator('.dlg', { hasText: 'Zwei verschiedene Fassungen' });
        await check('B online: Konfliktdialog erscheint', async () => {
          const ok = await bis(async () => (await dlg.count()) === 1, 6000);
          return ok ? true : 'kein Dialog';
        });
        await check('Dialog hat genau drei Knöpfe in der vorgeschriebenen Wahl', async () => {
          const t = await dlg.locator('.dlg-act .btn').allTextContents();
          const soll = ['Meine behalten', 'Die vom anderen Gerät nehmen', 'Beide behalten (Kopie)'];
          return JSON.stringify(t) === JSON.stringify(soll) ? true : 'Knöpfe: ' + JSON.stringify(t);
        });
        await check('solange der Dialog offen ist, ist nichts überschrieben (B trägt weiter «Titel von B»)', async () => {
          const v = await B.page.locator('.tb-r .c-title input').first().inputValue();
          return v === 'Titel von B' ? true : 'Wert: ' + v;
        });
        await shot(B.page, 'konflikt');
        await dlg.locator('.btn', { hasText: 'Beide behalten' }).click();
        await check('«Beide behalten»: zwei Projekte, eines mit «(anderes Gerät)»', async () => {
          await warteZustand(B, 'ok', 8000);
          const n = await eigeneProjekte(B);
          const mitZusatz = n.filter((x) => /\(anderes Gerät\)/.test(x));
          const ohne = n.filter((x) => x === 'Sync-Probe');
          return n.length === 2 && mitZusatz.length === 1 && ohne.length === 1 ? true : 'Liste: ' + JSON.stringify(n);
        });
        await check('die Kopie landet im Repo (zwei Dateien)', async () => {
          const ok = await bis(async () => fake.dateien.size === 2, 6000);
          return ok ? true : fake.dateien.size + ' Dateien';
        });
        await check('B: kein zweiter Dialog hinterher (Nicht-Treffer)', async () => (await dlg.count()) === 0 ? true : 'Dialog erneut');
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A, B); }
    }

    // ─── 2b. Nur die Phasen ändern sich ─────────────────────────────────────
    console.log('\nPHASEN ALLEIN (Abgleich sieht auch Phasenänderungen)');
    {
      const fake = neuerFake();
      const mk = () => geraet(fake, BASE);
      const A = await mk(), B = await mk();
      const phasenEnde = (g) => g.page.evaluate(() => {
        for (const k of Object.keys(localStorage)) {
          if (!k.startsWith('bzp_p_')) continue;
          const pl = JSON.parse(localStorage.getItem(k));
          if (pl.project && pl.project.name === 'Sync-Probe') return (pl.phases || []).map((x) => x.end).join('|');
        }
        return null;
      });
      const repoEnde = () => { const e = [...fake.dateien.values()][0]; return e ? JSON.parse(e.text).phases.map((x) => x.end).join('|') : null; };
      const plusTage = (v, n) => { const d = new Date(v + ':00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 16); };
      const phaseAendern = async (g, tage) => {
        const p = g.page;
        await p.locator('#rail-ein').click();
        await p.locator('[data-ein="phasen"]').click();
        const bisFeld = p.locator('.ph-z').first().locator('.ph-bis');
        await bisFeld.fill(plusTage(await bisFeld.inputValue(), tage));
        await p.locator('.ph-z').first().locator('.en-ok').click();
        await p.waitForTimeout(1300);
        await einZu(g);
      };
      try {
        await start(A); await legeAn(A, 'Sync-Probe');
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await start(B); await verbindenStill(B);
        await start(B); await warteZustand(B, 'ok');
        const E0 = await phasenEnde(A);
        await check('Ausgangslage: beide Geräte tragen dieselben Phasen', async () => {
          const b = await phasenEnde(B);
          return E0 && E0 === b && repoEnde() === E0 ? true : `A ${E0} / B ${b} / Repo ${repoEnde()}`;
        });
        await phaseAendern(A, 1);
        const EA = await phasenEnde(A);
        await check('A: Phase geändert (Nicht-Treffer-Gegenprobe: Stand weicht ab)', async () => EA !== E0 ? true : 'unverändert ' + EA);
        await ausloesen(A);
        await check('A lädt die geänderte Phase hoch', async () => (await bis(async () => repoEnde() === EA, 6000)) ? true : 'Repo ' + repoEnde());
        await ausloesen(B);
        await check('B (unverändert) bekommt die Phase von A — ohne Dialog', async () => {
          const ok = await bis(async () => (await phasenEnde(B)) === EA, 6000);
          const dlg = await B.page.locator('.dlg', { hasText: 'Zwei verschiedene Fassungen' }).count();
          return ok && !dlg ? true : `B ${await phasenEnde(B)} / Dialog ${dlg}`;
        });
        // Beide ändern DIESELBE Phase unterschiedlich, offline → Konflikt.
        await A.netz(false); await B.netz(false);
        await phaseAendern(A, 2);
        await phaseAendern(B, 3);
        await A.netz(true); await ausloesen(A);
        await B.netz(true); await ausloesen(B);
        await check('beide Phasen geändert → Konfliktdialog auf B (nur Phasen verschieden)', async () => {
          const dlg = B.page.locator('.dlg', { hasText: 'Zwei verschiedene Fassungen' });
          return (await bis(async () => (await dlg.count()) === 1, 6000)) ? true : 'kein Dialog';
        });
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A, B); }
    }

    // ─── 3. Falscher Schlüssel ──────────────────────────────────────────────
    console.log('\nFALSCHER SCHLÜSSEL');
    {
      const fake = neuerFake();
      const A = await geraet(fake, BASE);
      try {
        await start(A); await legeAn(A, 'Schlüssel-Probe');
        fake.schluesselOk = false;
        await verbinden(A, 'ghp_falsch');
        await check('«Verbinden» mit falschem Schlüssel wird abgelehnt: Meldung, nichts gespeichert', async () => {
          const ok = await bis(async () => /Schlüssel ungültig/.test(await A.page.locator('#toast').textContent()), 5000);
          const gespeichert = await A.page.evaluate(() => localStorage.getItem('bzp_sync'));
          return ok && gespeichert === null && (await syncZustand(A)) === 'aus' ? true : `Toast ${ok}, gespeichert ${gespeichert}, Zustand ${await syncZustand(A)}`;
        });
        fake.schluesselOk = true;
        await einrichten(A.page, 'sync');          // der Dialog wurde nach dem ersten Versuch geschlossen; das Feld behält den Schlüssel
        await A.page.locator('#sync-verbinden').click();
        await A.page.keyboard.press('Escape');
        await check('Gegenprobe: mit gültigem Schlüssel verbindet er (Zustand «ok»)', () => warteZustand(A, 'ok'));
        await einZu(A);
        fake.schluesselOk = false;      // Schlüssel wird nachträglich ungültig
        await start(A);
        await check('Start mit ungültigem Schlüssel: Zustand «fehler»', () => warteZustand(A, 'fehler'));
        await shot(A.page, 'fehler');
        await check('Marke trägt eine Erklärung (title)', async () => {
          const t = await A.page.locator('#sync-state').getAttribute('title');
          return /Schlüssel/.test(t || '') ? true : 'title: ' + t;
        });
        await check('die App bleibt bedienbar: Vorgang anlegen klappt', async () => {
          await A.page.locator('[data-view="tabelle"]').click();
          const vor = await zeilen(A);
          await A.page.locator('.tb-add').first().click();
          await A.page.waitForTimeout(400);
          const nach = await zeilen(A);
          return nach === vor + 1 ? true : `${vor} → ${nach}`;
        });
        await check('Zustand bleibt «fehler» (kein stilles Zurückfallen auf «ok»)', async () => (await syncZustand(A)) === 'fehler' ? true : await syncZustand(A));
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A); }
    }

    // ─── 4. Löschen ─────────────────────────────────────────────────────────
    console.log('\nLÖSCHEN');
    {
      const fake = neuerFake();
      const mk = () => geraet(fake, BASE);
      const A = await mk(), B = await mk();
      try {
        await start(A); await legeAn(A, 'Löschprobe');
        await legeAn(A, 'Bleibt');
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await start(B); await verbindenStill(B);
        await start(B); await warteZustand(B, 'ok');
        await check('Ausgangslage: beide Projekte im Repo und auf B', async () => {
          const b = await eigeneProjekte(B);
          return fake.dateien.size === 2 && b.includes('Löschprobe') && b.includes('Bleibt') ? true : `Fake ${fake.dateien.size}, B ${b}`;
        });
        const loesche = async (g, name) => {
          const p = g.page;
          if (await p.locator('#dlg').isHidden()) { await projektMenue(p, 'proj-menu'); }
          await p.locator('#dlg .dlg-row', { hasText: name }).locator('.dlg-del').click();
          await p.locator('.dlg .dlg-act .btn-danger', { hasText: 'Löschen' }).click();
          await p.waitForTimeout(700);
        };
        await A.netz(false);
        await loesche(A, 'Löschprobe');
        await check('offline löschen: Toast «Löschen braucht Verbindung …»', async () => {
          const t = await A.page.locator('#toast').textContent();
          return /Löschen braucht Verbindung zu GitHub/.test(t) ? true : 'Toast: ' + t;
        });
        await check('offline löschen: Projekt bleibt lokal UND im Repo (Treffer)', async () => {
          const n = await A.page.evaluate(() => [...document.querySelectorAll('#dlg .dlg-open-n')].map((x) => x.textContent));
          return n.includes('Löschprobe') && fake.dateien.size === 2 ? true : `Liste ${n}, Fake ${fake.dateien.size}`;
        });
        await A.netz(true);
        await loesche(A, 'Löschprobe');
        await check('online löschen: Datei im Fake weg, «Bleibt» steht noch (Treffer + Nicht-Treffer)', async () => {
          const ok = await bis(async () => fake.dateien.size === 1, 5000);
          return ok && fake.namen().join() === 'Bleibt' ? true : 'Fake: ' + fake.namen().join(',');
        });
        await dialogZu(A);
        await ausloesen(B);
        await check('B: fragt vor dem lokalen Löschen (Dialog «Im Daten-Repo gelöscht»)', async () =>
          (await repoLoeschDialog(B, 'Lokal löschen')) ? true : 'kein Dialog');
        await check('B: «Löschprobe» verschwindet nach dem Abgleich, «Bleibt» bleibt', async () => {
          let n = [];
          const ok = await bis(async () => { n = await eigeneProjekte(B); return !n.includes('Löschprobe'); }, 6000);
          return ok && n.includes('Bleibt') ? true : 'B: ' + n.join(',');
        });
        await check('A: «Bleibt» bleibt ebenfalls (Nicht-Treffer)', async () => (await eigeneProjekte(A)).includes('Bleibt') ? true : 'weg');
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A, B); }
    }

    // ─── 4a. Gelöscht auf B: Entwurf auf A darf nicht ins Folgeprojekt wandern ─
    // js/app.js: lokal-loeschen öffnet rest[0] OHNE Fokuswechsel; der focusout-Pfad
    // verwirft den Entwurf dann nicht (markiere ist abgehängt). Nur das Leeren der
    // Entwurfs-Map in js/table.js:72 hält ihn aus der gleichnamigen Zeile des
    // Folgeprojekts (Kopie: gleiche Ids und Zeiten) heraus.
    console.log('\nLÖSCHEN UNTER OFFENEM ENTWURF');
    {
      const fake = neuerFake();
      const mk = () => geraet(fake, BASE);
      const A = await mk(), B = await mk();
      try {
        await start(A); await legeAn(A, 'Rest-Kopie');
        await legeAn(A, 'Offen-Kopie');          // zuletzt angelegt = offen; gleiche Ids und Zeiten
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await start(B); await verbindenStill(B);
        await start(B); await warteZustand(B, 'ok');
        await check('Ausgangslage: zwei Projekte mit gleichen Ids und Zeiten, Offen-Kopie ist offen', async () => {
          const r = await A.page.evaluate(() => {
            const pl = (n) => { const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(x)).project.name === n); return JSON.parse(localStorage.getItem(k)).tasks.map((t) => [t.id, t.start, t.end].join('|')).join(';'); };
            return { gleich: pl('Rest-Kopie') === pl('Offen-Kopie'), name: document.getElementById('proj-name').textContent };
          });
          return r.gleich && r.name === 'Offen-Kopie' ? true : JSON.stringify(r);
        });
        // B löscht das offene Projekt (online → auch im Repo).
        {
          const p = B.page;
          await projektMenue(p, 'proj-menu');
          await p.locator('#dlg .dlg-row', { hasText: 'Offen-Kopie' }).locator('.dlg-del').click();
          await p.locator('.dlg .dlg-act .btn-danger', { hasText: 'Löschen' }).click();
          await p.waitForTimeout(700);
          await dialogZu(B);
        }
        await check('B hat «Offen-Kopie» im Repo gelöscht, «Rest-Kopie» bleibt', async () =>
          (await bis(async () => fake.namen().join() === 'Rest-Kopie', 5000)) ? true : 'Fake: ' + fake.namen().join(','));
        // A: Entwurf in der Tabelle öffnen (Fokus bleibt im Feld), dann Abgleich.
        await A.page.locator('[data-view="tabelle"]').click();
        await A.page.waitForTimeout(500);
        const feld = A.page.locator('.tb-r:not(.is-parent):not(.is-child)').first().locator('.c-start input');
        const id = await A.page.locator('.tb-r:not(.is-parent):not(.is-child)').first().getAttribute('data-id');
        const v0 = await feld.inputValue();
        await feld.fill(new Date(new Date(v0 + ':00Z').getTime() + 86400000).toISOString().slice(0, 16));
        await A.page.waitForTimeout(300);
        if (!(await A.page.locator('.tb-r.is-entwurf').count())) throw new Error('Vorbedingung: Entwurf nicht offen');
        await ausloesen(A);
        await repoLoeschDialog(A, 'Lokal löschen');
        await check('A: Abgleich wechselt ins Folgeprojekt — dort kein Entwurf, Feldwerte = Store', async () => {
          const ok = await bis(async () => (await A.page.locator('#proj-name').textContent()) === 'Rest-Kopie', 8000);
          if (!ok) return 'A wechselte nicht: ' + await A.page.locator('#proj-name').textContent();
          // Kein Ansichtswechsel dazwischen: der würde die Tabelle neu bauen und einen
          // fälschlich geöffneten Entwurf nebenbei wegräumen (so blieb der Fehler unsichtbar).
          await A.page.waitForTimeout(600);
          const offen = await A.page.locator('.tb-r.is-entwurf').count();
          const wert = await A.page.locator(`.tb-r[data-id="${id}"] .c-start input`).inputValue();
          const store = await A.page.evaluate((i) => {
            const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(x)).project.name === 'Rest-Kopie');
            return JSON.parse(localStorage.getItem(k)).tasks.find((t) => t.id === i).start.slice(0, 16);
          }, id);
          if (offen) return offen + ' Entwurf offen im Folgeprojekt';
          return wert === store && wert === v0 ? true : `Feld ${wert}, Store ${store}, vorher ${v0}`;
        });
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A, B); }
    }

    // ─── 4c. Repo-404, Datei gelöscht, gelöschtes offenes Projekt ───────────
    console.log('\nREPO WEG, DATEI GELÖSCHT, OFFENES PROJEKT GELÖSCHT');
    {
      const fake = neuerFake();
      const A = await geraet(fake, BASE);
      try {
        await start(A); await legeAn(A, 'S1'); await legeAn(A, 'S2');
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await check('Ausgangslage: S1 und S2 im Repo', async () => fake.dateien.size === 2 ? true : 'Fake ' + fake.dateien.size);

        fake.repoWeg = true;
        await ausloesen(A);
        await check('Repo 404: Status rot mit «Repo», nichts gelöscht, kein Dialog', async () => {
          const ok = await bis(async () => (await syncZustand(A)) === 'fehler', 6000);
          const titel = await A.page.locator('#sync-state').getAttribute('title');
          const n = (await indexIds(A)).length;
          const dlg = await A.page.locator('.dlg', { hasText: 'Im Daten-Repo gelöscht' }).count();
          return ok && /Repo/.test(titel) && n === 2 && dlg === 0 ? true : `Zustand ok=${ok}, title «${titel}», Projekte ${n}, Dialog ${dlg}`;
        });
        fake.repoWeg = false;

        // Datei von S1 verschwindet im Repo (anderes Gerät hat gelöscht).
        const dateiS1 = [...fake.dateien].find(([, e]) => JSON.parse(e.text).project.name === 'S1')[0];
        fake.dateien.delete(dateiS1);
        const putsVor = fake.puts;
        await ausloesen(A);
        await check('Datei gelöscht: Dialog erscheint, nichts ist lokal weg (Nicht-Treffer)', async () => {
          const da = await repoLoeschDialog(A, 'Behalten und neu hochladen');
          return da && (await indexIds(A)).length === 2 ? true : `Dialog ${da}`;
        });
        await check('«Behalten»: S1 wird erneut hochgeladen (puts+1, Datei wieder da)', async () => {
          const ok = await bis(async () => fake.puts === putsVor + 1 && fake.namen().includes('S1'), 6000);
          return ok ? true : `puts +${fake.puts - putsVor}, Fake ${fake.namen()}`;
        });

        // Offenes Projekt (S2) im Projektdialog löschen, S1 bleibt.
        await warteZustand(A, 'ok');
        const idS2 = await A.page.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('bzp_p_') && JSON.parse(localStorage.getItem(x)).project.name === 'S2'); return k.slice(6); });
        {
          const p = A.page;
          await projektMenue(p, 'proj-menu');
          await p.locator('#dlg .dlg-row', { hasText: 'S2' }).locator('.dlg-del').click();
          await p.locator('.dlg .dlg-act .btn-danger', { hasText: 'Löschen' }).click();
          await p.waitForTimeout(900);
          await dialogZu(A);
        }
        await ersteZeileTitel(A, 'Nach dem Löschen');
        await check('offenes Projekt gelöscht, zweites vorhanden: nach einer Änderung bleibt die alte id weg', async () => {
          const ids = await indexIds(A), keys = await planKeys(A);
          const name = await A.page.locator('#proj-name').textContent();
          return !ids.includes(idS2) && !keys.some((k) => k.endsWith(idS2)) && name === 'S1' && !fake.namen().includes('S2') ? true : `Index ${ids}, Name ${name}, Fake ${fake.namen()}`;
        });

        // Letztes Projekt (S1, offen) löschen: Erststart-Dialog, danach neu anlegen.
        const idS1 = (await indexIds(A))[0];
        {
          const p = A.page;
          await projektMenue(p, 'proj-menu');
          await p.locator('#dlg .dlg-row', { hasText: 'S1' }).locator('.dlg-del').click();
          await p.locator('.dlg .dlg-act .btn-danger', { hasText: 'Löschen' }).click();
          await p.waitForTimeout(900);
        }
        await check('letztes Projekt gelöscht: Erststart-Dialog steht, Index leer', async () => {
          const ids = await indexIds(A);
          const h = await A.page.locator('#dlg .dlg-h').first().textContent();
          return ids.length === 0 && h === 'Bauzeitenplan' ? true : `Index ${ids}, Titel ${h}`;
        });
        await legeAn(A, 'Neu');
        await A.page.waitForTimeout(1200);
        await check('nach «Projekt anlegen» ist die alte id weg, nur «Neu» steht im Index', async () => {
          const ids = await indexIds(A);
          return ids.length === 1 && !ids.includes(idS1) && !ids.includes(idS2) ? true : 'Index ' + ids;
        });
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A); }
    }

    // ─── 4d. Offenes Projekt löschen scheitert im Repo (offline) ────────────
    // Der Wechsel in open() kann nicht abbrechen (das zu löschende Projekt wird
    // nicht mehr gesichert); scheitern kann das Löschen im Daten-Repo. Dann darf
    // weder das Repo noch das lokale Projekt etwas verlieren, und der nächste
    // Abgleich darf keinen «Im Daten-Repo gelöscht»-Dialog zeigen.
    console.log('\nOFFENES PROJEKT: LÖSCHEN IM REPO SCHEITERT');
    {
      const fake = neuerFake();
      const A = await geraet(fake, BASE);
      try {
        await start(A); await legeAn(A, 'T1'); await legeAn(A, 'T2');
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        const vor = { puts: fake.puts, deletes: fake.deletes };
        await A.netz(false);
        {
          const p = A.page;
          await projektMenue(p, 'proj-menu');
          await p.locator('#dlg .dlg-row', { hasText: 'T2' }).locator('.dlg-del').click();
          await p.locator('.dlg .dlg-act .btn-danger', { hasText: 'Löschen' }).click();
          await p.waitForTimeout(900);
        }
        await check('offline: Repo unverändert (2 Dateien, keine DELETEs/PUTs), beide Projekte lokal da', async () => {
          const ids = await indexIds(A);
          return fake.dateien.size === 2 && fake.deletes === vor.deletes && fake.puts === vor.puts && ids.length === 2 ? true
            : `Fake ${fake.dateien.size}, deletes +${fake.deletes - vor.deletes}, puts +${fake.puts - vor.puts}, Index ${ids.length}`;
        });
        await dialogZu(A);
        await A.netz(true);
        await ausloesen(A);
        await check('danach online: kein Dialog «Im Daten-Repo gelöscht» (Nicht-Treffer), Zustand ok', async () => {
          const r = await warteZustand(A, 'ok');
          const dlg = await A.page.locator('.dlg', { hasText: 'Im Daten-Repo gelöscht' }).count();
          return r === true && dlg === 0 && (await indexIds(A)).length === 2 ? true : `${r}, Dialog ${dlg}`;
        });
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A); }
    }

    // ─── 4b. Versatz und Projektwechsel ─────────────────────────────────────
    console.log('\nVERSATZ UND PROJEKTWECHSEL');
    {
      const fake = neuerFake();
      const mk = () => geraet(fake, BASE);
      const A = await mk(), B = await mk();
      try {
        await start(A); await legeAn(A, 'Versatz-Probe');
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await start(B); await verbindenStill(B);
        await start(B); await warteZustand(B, 'ok');
        // Versatz setzen (der Knopf ist ausserhalb von Live ausgeblendet, daher per Skript klicken).
        await A.page.evaluate(() => { for (let i = 0; i < 5; i++) document.getElementById('vz-plus').click(); });
        const vzA = () => A.page.evaluate(() => document.getElementById('vz-n').value);
        await check('Ausgangslage: A hat Versatz 5', async () => (await vzA()) === '5' ? true : 'Versatz ' + await vzA());
        await ersteZeileTitel(B, 'Titel von B');
        await ausloesen(B);
        await check('B: Änderung liegt im Repo', async () => (await bis(async () => /Titel von B/.test([...fake.dateien.values()][0].text), 6000)) ? true : 'nicht hochgeladen');
        await ausloesen(A);
        await check('Sync-Update behält den Versatz', async () => {
          await A.page.locator('[data-view="tabelle"]').click();
          const ok = await bis(async () => (await A.page.locator('.tb-r .c-title input').first().inputValue()) === 'Titel von B', 6000);
          if (!ok) return 'A zeigt den neuen Inhalt nicht';
          return (await vzA()) === '5' ? true : 'Versatz ' + await vzA() + ' statt 5';
        });
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A, B); }
    }
    {
      const fake = neuerFake();
      const A = await geraet(fake, BASE);
      try {
        await start(A); await legeAn(A, 'Wechsel-Eins'); await legeAn(A, 'Wechsel-Zwei');
        await A.page.locator('[data-view="tabelle"]').click();
        const t = A.page.locator('.tb-r .c-title input').first();
        // Zeit festnageln: der 800-ms-Speichertimer feuert sonst während der
        // Klicks von selbst, und die Prüfung bliebe auch ohne Sicherung im
        // Projektwechsel grün. Mit dem festgesetzten Timer kann NUR open() den
        // Titel retten.
        await A.page.evaluate(() => {
          const echt = window.setTimeout.bind(window);
          window.setTimeout = (fn, ms, ...a) => echt(fn, ms === 800 ? 600000 : ms, ...a);
        });
        await t.fill('Frisch getippt');
        // blur löst change aus (Timer läuft jetzt praktisch nie ab), dann das andere Projekt öffnen.
        await A.page.evaluate(() => document.activeElement && document.activeElement.blur());
        const oeffne = async (name) => {
          await projektMenue(A.page, 'proj-menu');
          await A.page.locator('#dlg').waitFor({ state: 'visible' });
          await A.page.locator('#dlg .dlg-open', { hasText: name }).click();
          await A.page.waitForTimeout(500);
          await einZu(A);
        };
        await oeffne('Wechsel-Eins');
        await oeffne('Wechsel-Zwei');
        await check('Projektwechsel verliert keine Eingabe', async () => {
          await A.page.locator('[data-view="tabelle"]').click();
          const v = await A.page.locator('.tb-r .c-title input').first().inputValue();
          return v === 'Frisch getippt' ? true : 'Titel: ' + v;
        });
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A); }
    }

    // ─── 5. Kein Ping-Pong ──────────────────────────────────────────────────
    console.log('\nKEIN PING-PONG (R7, ~45 s Wartezeit)');
    {
      const fake = neuerFake();
      const mk = () => geraet(fake, BASE);
      const A = await mk(), B = await mk();
      try {
        await start(A); await legeAn(A, 'Ping');
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await start(B); await verbindenStill(B);
        await start(B); await warteZustand(B, 'ok'); await warteZustand(A, 'ok');
        await A.page.waitForTimeout(1500);
        const vor = fake.puts;
        await sleep(25000);
        await check('beide offen, keiner tippt: 25 s lang kein einziger PUT', async () => fake.puts === vor ? true : `${fake.puts - vor} PUTs`);
        const putVorEdit = fake.puts;
        await ersteZeileTitel(A, 'Edit auf A');
        await check('Gegenprobe: ein Edit auf A → nach dem Bündelfenster genau ein PUT', async () => {
          const ok = await bis(async () => fake.puts === putVorEdit + 1, 16000);
          return ok ? true : `PUTs seit Edit: ${fake.puts - putVorEdit}`;
        });
        await sleep(12000);
        await check('danach bleibt es bei einem (kein Nachklapp, B schickt nichts zurück)', async () => fake.puts === putVorEdit + 1 ? true : `${fake.puts - putVorEdit} PUTs`);
        await check('A: Zustand «ok» nach dem Upload', () => warteZustand(A, 'ok'));
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A, B); }
    }

    // ─── 6. Plan aus dem localStorage ─────────────────────────────────────────────
    console.log('\nPLAN AUS DEM LOCALSTORAGE (R1)');
    {
      const fake = neuerFake();
      const mk = () => geraet(fake, BASE);
      const A = await mk(), B = await mk();
      try {
        await planLaden(A.ctx);
        await start(A);
        await A.page.locator('.bz-bar').first().waitFor({ timeout: 8000 });
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await check('A: der geseedete Plan liegt im Repo', async () => fake.namen().includes('Klassentreffen Festival 2026') ? true : 'Fake: ' + fake.namen());
        await planLaden(B.ctx);
        await start(B);
        await B.page.locator('.bz-bar').first().waitFor({ timeout: 8000 });
        const putsVor = fake.puts;
        await verbinden(B); await einZu(B);
        await check('B (frisch, ebenfalls geseedet): Abgleich endet auf «ok»', () => warteZustand(B, 'ok'));
        await check('B: KEIN Konfliktdialog (Nicht-Treffer)', async () => (await B.page.locator('.dlg', { hasText: 'Zwei verschiedene Fassungen' }).count()) === 0 ? true : 'Dialog erschien');
        await check('B: schickt nichts hoch, Repo hat weiter genau eine Datei', async () => fake.puts === putsVor && fake.dateien.size === 1 ? true : `PUTs +${fake.puts - putsVor}, Dateien ${fake.dateien.size}`);
        await check('B: Projekt ist als abgeglichen vermerkt (sha des Repos steht im Index)', async () => {
          const sha = [...fake.dateien.values()][0].sha;
          const roh = await B.page.evaluate(() => localStorage.getItem('bzp_projects'));
          return roh && roh.includes(sha) ? true : 'sha fehlt im Index';
        });
        await check('Gegenprobe: ein anderer Plan (Einzelprojekt) wäre sehr wohl ein Unterschied', async () => {
          // Beweist, dass «kein Dialog» nicht an einem kaputten Vergleich liegt: ändert B den Plan, wird er dirty und lädt hoch.
          await ersteZeileTitel(B, 'Abweichung auf B');
          await ausloesen(B);
          const ok = await bis(async () => fake.puts === putsVor + 1, 6000);
          return ok ? true : `PUTs +${fake.puts - putsVor}`;
        });
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await schliesse(A, B); }
    }

    // ─── 6b. Zwei Tabs ──────────────────────────────────────────────────────
    // Zwei Seiten in EINEM Kontext teilen localStorage; `storage` feuert nur im
    // jeweils anderen Tab. Ohne Sync-Schlüssel: der Fehler hängt nicht am Daten-Repo.
    console.log('\nZWEI TABS (ein Browser, ohne Sync)');
    {
      const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, serviceWorkers: 'block' });
      const A = await ctx.newPage(), B = await ctx.newPage();
      for (const p of [A, B]) p.on('pageerror', (e) => jsErrors.push('JS: ' + e.message));
      try {
        await A.goto(BASE + '/index.html?plan=leer');
        await A.waitForTimeout(700);
        await festivalMitDaten(A, 'Zwei-Tabs');
        await A.locator('.bz-bar').first().waitFor({ timeout: 8000 });
        await A.waitForTimeout(1200);
        await B.goto(BASE + '/index.html?plan=leer');
        await B.locator('.bz-bar').first().waitFor({ timeout: 8000 });
        const dachId = await A.evaluate(() => {
          const k = localStorage.getItem('bzp_active');
          return JSON.parse(localStorage.getItem('bzp_p_' + k)).tasks.find((t) => /Dach/.test(t.title)).id;
        });
        const sel = `.bz-bar[data-task="${dachId}"]`;
        const von = (p) => p.locator(sel).getAttribute('data-from');
        const waehle = async (p) => { await p.locator(sel).focus(); await p.keyboard.press('Enter'); };
        const speicher = (p) => p.evaluate((id) => {
          const k = localStorage.getItem('bzp_active');
          const t = JSON.parse(localStorage.getItem('bzp_p_' + k)).tasks.find((x) => x.id === id);
          return { s: new Date(t.start).getTime() / 60000, e: new Date(t.end).getTime() / 60000 };
        }, dachId);
        const alt = await von(A);
        await check('beide Tabs zeigen am Anfang denselben Balken', async () => (await von(B)) === alt ? true : `A ${alt}, B ${await von(B)}`);

        await waehle(B);
        await B.keyboard.press('Alt+ArrowRight');
        await check('B verschiebt «Dach»: A zeigt es nach dem Autosave von B (ohne Rückfrage)', async () => {
          const ok = await bis(async () => (await von(A)) !== alt, 4000);
          return ok ? true : `data-from in A unverändert (${alt})`;
        });
        await check('A: Hinweis «anderen Tab» statt Dialog', async () => {
          const t = await A.locator('#toast').textContent();
          const dlg = await A.locator('.dlg', { hasText: 'anderen Tab' }).count();
          return /anderen Tab/.test(t) && dlg === 0 ? true : `Toast «${t}», Dialoge ${dlg}`;
        });
        await check('B zeigt den eigenen Stand weiter (kein Echo zurück)', async () => (await von(B)) === (await von(A)) ? true : `B ${await von(B)}, A ${await von(A)}`);

        // Konflikt herstellen: A wählt den Balken, B ändert zuerst (speichert nach 800 ms),
        // A ändert DAZWISCHEN und ist beim Eintreffen des Ereignisses noch ungesichert.
        // Start unterscheidet die Stände: B verschiebt, A verlängert nur das Ende.
        const dialogA = () => A.locator('.dlg', { hasText: 'in einem anderen Tab geändert' });
        const konflikt = async () => {
          await A.waitForTimeout(1300);   // vorige Übernahme setzt sich
          const vorher = await speicher(A);
          await waehle(A);
          await waehle(B);
          await B.keyboard.press('Alt+ArrowRight');
          await B.waitForTimeout(500);
          await A.keyboard.press('Alt+Shift+ArrowRight');
          const ok = await bis(async () => (await dialogA().count()) === 1, 4000);
          const imSpeicher = await speicher(A);       // jetzt: der Stand von B
          return { ok, vorher, fremd: imSpeicher };
        };
        const imAnderen = (k) => k.fremd.s !== k.vorher.s;   // Speicher trägt wirklich B (Gegenprobe)

        let k = await konflikt();
        await check('A (ungesichert) bekommt den Dialog statt still überschrieben zu werden', async () => k.ok && imAnderen(k) ? true : `Dialog ${k.ok}, Speicher ${JSON.stringify(k.fremd)}`);
        await shot(A, 'zwei-tabs');
        await A.locator('.dlg .btn', { hasText: 'Meine behalten' }).click();
        await check('«Meine behalten» (sofort): localStorage trägt den Stand von A (Ende länger, Start wie bei A)', async () => {
          const ok = await bis(async () => { const s = await speicher(A); return s.e > k.vorher.e; }, 3000);
          const s = await speicher(A);
          return ok && s.s === k.vorher.s ? true : `Stand ${JSON.stringify(s)}, vorher ${JSON.stringify(k.vorher)}`;
        });
        await check('nach dem Dialog bleibt kein zweiter offen', async () => { await A.waitForTimeout(600); return (await dialogA().count()) === 0 ? true : 'Dialog steht noch'; });

        // Die Frage dauert länger als der 800-ms-Autosave: der darf A's Stand nicht
        // vor der Wahl über den von B schreiben.
        k = await konflikt();
        await A.waitForTimeout(1500);
        await check('Dialog steht über den Autosave hinaus; der Speicher trägt weiter B (kein stilles Überschreiben)', async () => {
          const s = await speicher(A);
          return (await dialogA().count()) === 1 && s.s === k.fremd.s ? true : `Dialog ${await dialogA().count()}, Speicher ${JSON.stringify(s)}, B ${JSON.stringify(k.fremd)}`;
        });
        await A.locator('.dlg .btn', { hasText: 'Die aus dem anderen Tab nehmen' }).click();
        await check('«Die aus dem anderen Tab nehmen» (spät): A zeigt B\'s Stand', async () => {
          const ok = await bis(async () => (await von(A)) === String(k.fremd.s), 3000);
          const s = await speicher(A);
          return ok && s.s === k.fremd.s && s.e === k.fremd.e ? true : `A zeigt ${await von(A)}, Speicher ${JSON.stringify(s)}, B ${JSON.stringify(k.fremd)}`;
        });

        k = await konflikt();
        await A.waitForTimeout(1500);
        const vorKopien = await A.evaluate(() => JSON.parse(localStorage.getItem('bzp_projects')).map((x) => x.id));
        await A.locator('.dlg .btn', { hasText: 'Beide behalten' }).click();
        await check('«Beide behalten» (spät): Kopie «(anderer Tab)» trägt B\'s Inhalt, Original A\'s', async () => {
          const ok = await bis(async () => (await A.evaluate(() => JSON.parse(localStorage.getItem('bzp_projects')).length)) === vorKopien.length + 1, 3000);
          const r = await A.evaluate(([vor, id]) => {
            const x = JSON.parse(localStorage.getItem('bzp_projects')).find((q) => !vor.includes(q.id));
            if (!x) return null;
            const t = JSON.parse(localStorage.getItem('bzp_p_' + x.id)).tasks.find((q) => q.id === id);
            return { name: x.name, s: new Date(t.start).getTime() / 60000 };
          }, [vorKopien, dachId]);
          const mein = await speicher(A);
          return ok && r && /\(anderer Tab\)/.test(r.name) && r.s === k.fremd.s && mein.s === k.vorher.s && mein.e > k.vorher.e ? true
            : `Kopie ${JSON.stringify(r)}, B ${JSON.stringify(k.fremd)}, Original ${JSON.stringify(mein)}`;
        });

        // B speichert ein ZWEITES Mal, während der Dialog in A offen ist: «fremd»
        // muss den neuesten Stand nehmen, nicht den vom Öffnen des Dialogs.
        k = await konflikt();
        await waehle(B);
        await B.keyboard.press('Alt+ArrowRight');
        await B.waitForTimeout(1500);        // B2 ist gespeichert, der Dialog in A steht noch
        const b2 = await speicher(A);
        await A.locator('.dlg .btn', { hasText: 'Die aus dem anderen Tab nehmen' }).click();
        await check('«fremd» nach zweitem Speichern von B: A zeigt B\'s NEUESTEN Stand', async () => {
          if (b2.s === k.fremd.s) return 'Voraussetzung fehlt: B hat kein zweites Mal gespeichert';
          const ok = await bis(async () => (await von(A)) === String(b2.s), 3000);
          const s = await speicher(A);
          return ok && s.s === b2.s ? true : `A zeigt ${await von(A)}, Speicher ${JSON.stringify(s)}, B2 ${JSON.stringify(b2)}, B1 ${JSON.stringify(k.fremd)}`;
        });

        // Abbruch (Esc) ist «Meine behalten», nicht Schweigen.
        k = await konflikt();
        await A.keyboard.press('Escape');
        await check('Escape: A\'s Stand steht sofort im Speicher, B übernimmt ihn mit Hinweis', async () => {
          const ok = await bis(async () => { const s = await speicher(A); return s.e > k.vorher.e; }, 3000);
          const s = await speicher(A);
          const toastB = await bis(async () => (await von(B)) === (await von(A)) && /anderen Tab/.test(await B.locator('#toast').textContent()), 4000);
          return ok && s.s === k.vorher.s && toastB ? true : `Speicher ${JSON.stringify(s)}, vorher ${JSON.stringify(k.vorher)}, B übernimmt ${toastB}`;
        });

        // Ping-Pong: ein Plan im Altformat (ohne phases/abschnitt) wird beim Laden
        // migriert; die Tabs dürfen einander danach nicht endlos neu schreiben.
        const C = await ctx.newPage();
        await C.goto(BASE + '/sw.js');         // Seite OHNE App: B hielte sonst den Store
        await C.evaluate((id) => {
          const k = localStorage.getItem('bzp_active');
          const p = JSON.parse(localStorage.getItem('bzp_p_' + k));
          delete p.phases;
          for (const t of p.tasks) { delete t.abschnitt; if (t.id === id) t.title += ' alt'; }
          localStorage.setItem('bzp_p_' + k, JSON.stringify(p));
        }, dachId);
        await check('Altformat-Plan: beide Tabs übernehmen ihn und danach schreibt keiner mehr (kein Ping-Pong)', async () => {
          const zeigt = (p) => p.evaluate(() => /Traversentürme alt/.test(document.body.textContent));
          const ok = await bis(async () => (await zeigt(A)) && (await zeigt(B)), 4000);
          await A.waitForTimeout(1500);
          const m1 = await C.evaluate(() => localStorage.getItem('bzp_projects'));
          await A.waitForTimeout(2500);
          const m2 = await C.evaluate(() => localStorage.getItem('bzp_projects'));
          const offen = await B.locator('.dlg', { hasText: 'in einem anderen Tab geändert' }).count();
          return ok && m1 === m2 && offen === 0 ? true : `übernommen ${ok}, Index ändert sich: ${m1 === m2 ? 'nein' : 'ja'}, Dialog in B: ${offen}`;
        });

        // Gelöscht im anderen Tab: A darf es nicht wieder anlegen.
        // Von einer Seite OHNE App aus löschen: B selbst hielte das Projekt im Store
        // und legte es mit seinem nächsten Sichern wieder an.
        await B.close();
        const gone = await C.evaluate(() => {
          const k = localStorage.getItem('bzp_active');
          localStorage.removeItem('bzp_p_' + k);
          localStorage.setItem('bzp_projects', JSON.stringify(JSON.parse(localStorage.getItem('bzp_projects')).filter((x) => x.id !== k)));
          return k;
        });
        await check('im anderen Tab gelöscht: A zeigt den Projektdialog statt das Projekt wieder anzulegen', async () => {
          const ok = await bis(async () => (await A.locator('#dlg').isVisible()), 3000);
          await A.waitForTimeout(1200);
          const da = await A.evaluate(() => Object.keys(localStorage).filter((x) => x.startsWith('bzp_p_')));
          return ok && !da.includes('bzp_p_' + gone) ? true : `Dialog ${ok}, Pläne im Speicher ${da.join(',')}, gelöscht ${gone}`;
        });
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await ctx.close(); }
    }

    // ─── 7. Offline-Start ───────────────────────────────────────────────────
    console.log('\nOFFLINE-START (Service Worker)');
    {
      const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => jsErrors.push('JS: ' + e.message));
      try {
        await page.goto(BASE + '/index.html?plan=leer');
        await page.waitForTimeout(500);
        await festivalMitDaten(page, 'Offline-Probe');
        await page.locator('.bz-bar').first().waitFor({ timeout: 8000 });
        await check('Service Worker übernimmt die Seite (controller gesetzt)', async () => {
          try { await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }); return true; }
          catch { return 'controller nie gesetzt'; }
        });
        // Alle Cache-Einträge fertig? (Installation lädt ~45 Dateien.)
        await page.waitForTimeout(1500);
        await ctx.setOffline(true);
        await page.reload();
        await page.waitForTimeout(1200);
        await check('offen ohne Netz: der Gantt rendert (≥ 1 .bz-bar)', async () => {
          const n = await page.locator('.bz-bar').count();
          return n >= 1 ? true : 'keine Balken';
        });
        await check('offen ohne Netz: Projektname steht in der Kopfzeile', async () => {
          const t = await page.locator('#proj-name').textContent();
          return t === 'Offline-Probe' ? true : 'Name: ' + t;
        });
        await check('offen ohne Netz: Schrift Geist ist geladen', async () => {
          const r = await page.evaluate(async () => {
            await document.fonts.load('500 12px Geist');
            const faces = [...document.fonts].filter((f) => /Geist/.test(f.family));
            return { check: document.fonts.check('12px Geist'), geladen: faces.filter((f) => f.status === 'loaded').length, faces: faces.length };
          });
          return r.check && r.geladen >= 1 ? true : JSON.stringify(r);
        });
        await shot(page, 'offline');

        // Gegenprobe: frischer Kontext ohne Erstbesuch, offline → keine App.
        const kalt = await browser.newContext({ viewport: { width: 1500, height: 900 } });
        try {
          await kalt.setOffline(true);
          const p2 = await kalt.newPage();
          let fehler = null;
          try { await p2.goto(BASE + '/index.html?plan=leer', { timeout: 8000 }); } catch (e) { fehler = e.message.split('\n').slice(0, 4).join(' | '); }
          await check('Gegenprobe: ohne Erstbesuch offline → keine App (der Treffer kommt vom Cache)', async () => {
            const balken = await p2.locator('.bz-bar').count();
            const app = await p2.locator('#bz').count();
            return balken === 0 && app === 0 ? true : `Balken ${balken}, #bz ${app}, Fehler ${fehler}`;
          });
          await shot(p2, 'offline-kalt');
        } finally { await kalt.close(); }
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n').slice(0, 4).join(' | ')); problems++; }
      finally { await ctx.close(); }
    }
  }

  console.log('\nJS-FEHLER');
  await check('keine uncaught Ausnahmen im Lauf', async () => jsErrors.length === 0 ? true : jsErrors.slice(0, 5).join(' | '));
} finally {
  try { if (browser) await browser.close(); } catch { /* */ }
  server.close();
}

console.log(problems ? `\n${problems} Prüfung(en) FEHLGESCHLAGEN` : '\nverify-sync: alle Prüfungen bestanden');
process.exit(problems ? 1 : 0);
