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
  const f = { dateien, puts: 0, deletes: 0, gets: 0, schluesselOk: true, netz: true, zaehler: 0 };
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
    await p.locator('#rail-ein').click();
    await p.locator('#new-proj').click();
    await p.evaluate(() => document.getElementById('ein-zu').click());
  }
  // Die Vorlage hat keine Termine mehr; der Abgleich soll einen Plan MIT Balken sehen.
  await festivalMitDaten(p, name);
  await p.waitForTimeout(700);
};

const verbinden = async (g, token = 'ghp_fake') => {
  const p = g.page;
  await p.locator('#rail-ein').click();
  await p.locator('[data-ein="sync"]').click();
  await p.fill('#sync-token', token);
  await p.locator('#sync-verbinden').click();
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
// Nur die EIGENEN Projekte (erste .dlg-list), nicht die mitgelieferten Pläne.
const eigeneProjekte = async (g) => {
  const p = g.page;
  await p.locator('#rail-ein').click();
  await p.locator('[data-ein="projekt"]').click();
  await p.locator('#proj-menu').click();
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
        if (ECHT) { await A.page.locator('#rail-ein').click(); await A.page.locator('[data-ein="sync"]').click(); }
        const ok = await bis(async () => /Verbunden mit/.test(await A.page.locator('#sync-info').textContent()), 5000);
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
          await B.page.locator('#rail-ein').click();
          await B.page.locator('[data-ein="projekt"]').click();
          await B.page.locator('#proj-menu').click();
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
    } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
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
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
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
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
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
        await A.page.locator('#sync-verbinden').click();
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
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
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
          if (await p.locator('#dlg').isHidden()) { await p.locator('#rail-ein').click(); await p.locator('[data-ein="projekt"]').click(); await p.locator('#proj-menu').click(); }
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
        await check('B: «Löschprobe» verschwindet nach dem Abgleich, «Bleibt» bleibt', async () => {
          let n = [];
          const ok = await bis(async () => { n = await eigeneProjekte(B); return !n.includes('Löschprobe'); }, 6000);
          return ok && n.includes('Bleibt') ? true : 'B: ' + n.join(',');
        });
        await check('A: «Bleibt» bleibt ebenfalls (Nicht-Treffer)', async () => (await eigeneProjekte(A)).includes('Bleibt') ? true : 'weg');
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
      finally { await schliesse(A, B); }
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
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
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
          await A.page.locator('#rail-ein').click();
          await A.page.locator('[data-ein="projekt"]').click();
          await A.page.locator('#proj-menu').click();
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
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
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
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
      finally { await schliesse(A, B); }
    }

    // ─── 6. Mitgelieferter Plan ─────────────────────────────────────────────
    console.log('\nMITGELIEFERTER PLAN (R1)');
    {
      const fake = neuerFake();
      const mk = () => geraet(fake, BASE);
      const A = await mk(), B = await mk();
      try {
        await start(A, '');
        await A.page.locator('.bz-bar').first().waitFor({ timeout: 8000 });
        await verbinden(A); await warteZustand(A, 'ok'); await einZu(A);
        await check('A: Autostart-Plan liegt im Repo', async () => fake.namen().includes('Klassentreffen Festival 2026') ? true : 'Fake: ' + fake.namen());
        await start(B, '');
        await B.page.locator('.bz-bar').first().waitFor({ timeout: 8000 });
        const putsVor = fake.puts;
        await verbinden(B); await einZu(B);
        await check('B (frisch, ebenfalls Autostart): Abgleich endet auf «ok»', () => warteZustand(B, 'ok'));
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
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
      finally { await schliesse(A, B); }
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
          try { await p2.goto(BASE + '/index.html?plan=leer', { timeout: 8000 }); } catch (e) { fehler = e.message.split('\n')[0]; }
          await check('Gegenprobe: ohne Erstbesuch offline → keine App (der Treffer kommt vom Cache)', async () => {
            const balken = await p2.locator('.bz-bar').count();
            const app = await p2.locator('#bz').count();
            return balken === 0 && app === 0 ? true : `Balken ${balken}, #bz ${app}, Fehler ${fehler}`;
          });
          await shot(p2, 'offline-kalt');
        } finally { await kalt.close(); }
      } catch (e) { console.log('  ✗ Schritt abgebrochen: ' + e.message.split('\n')[0]); problems++; }
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
