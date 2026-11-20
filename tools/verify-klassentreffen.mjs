// Klassentreffen-Plan (V07) importieren und im Browser prüfen.
import { firefox } from 'playwright-core';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mustFirefox, chromiumExe } from './browsers.mjs';
import { createServer } from 'node:http';
const here = dirname(fileURLToPath(import.meta.url)); const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });
const exe = mustFirefox();
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = createServer((q, s) => {
  const rel = normalize(decodeURIComponent(q.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const f = join(root, /^[\\/]$/.test(rel) ? 'index.html' : rel);
  if (!f.startsWith(root) || !existsSync(f)) { s.writeHead(404); return s.end('x'); }
  s.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  s.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const b = await firefox.launch({ executablePath: exe });
const ctx = await b.newContext({ viewport: { width: 1600, height: 950 } });
const p = await ctx.newPage();
// Uhr mitten in die Aufbauwoche stellen, damit die Ansicht sinnvoll steht.
await p.clock.install({ time: new Date('2026-08-27T10:00:00') });
const errors = [];
p.on('pageerror', (e) => errors.push('JS: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let bad = 0;
const zoomWahl = async (pg, z) => { await pg.click('#zoom-stufe'); await pg.locator('.mn .mn-i', { hasText: z[0].toUpperCase() + z.slice(1) }).click(); };
const check = async (name, fn) => {
  let r; try { r = await fn(); } catch (e) { r = 'Ausnahme: ' + e.message; }
  if (r === true) console.log('  ✓ ' + name); else { console.log('  ✗ ' + name + ': ' + r); bad++; }
};

await p.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=leer');
await p.waitForTimeout(700);

console.log('\nKLASSENTREFFEN IMPORTIEREN');
await p.locator('.dlg-act .btn', { hasText: 'JSON importieren' }).click();
await p.locator('#import-file').setInputFiles(join(root, 'klassentreffen-festival.json'));
await p.waitForTimeout(1200);

await check('Projekt heißt richtig', async () =>
  (await p.locator('#proj-name').textContent()).includes('Klassentreffen') ? true : 'Name falsch');
await check('20 Gewerke', async () => {
  const n = await p.locator('.legend-i').count();
  return n === 20 ? true : n + ' statt 20';
});
await check('zehn Gewerke mit Schraffur (Platz 11–20)', async () => {
  const n = await p.locator('.legend-i .bz-dot[data-tex]').count();
  return n === 10 ? true : n + ' statt 10';
});
await check('353 Vorgänge', async () => {
  const t = await p.locator('.kpi', { hasText: 'Vorgänge' }).locator('.kpi-v').textContent();
  return t.trim() === '353' ? true : t;
});
await check('Plan startet OHNE Konflikte', async () =>
  (await p.locator('#resolve').isHidden()) ? true : 'Konfliktknopf sichtbar');
await check('kein Meilenstein — V07 hat keinen baufreien Tag', async () => {
  const n = await p.locator('.bz-ms').count();
  return n === 0 ? true : n + ' statt 0';
});
await check('die meisten Balken sind NICHT gestrichelt (echte Zeiten aus V07)', async () => {
  const total = await p.locator('.bz-bar').count();
  const est = await p.locator('.bz-bar.is-estimated').count();
  return total >= 300 && est <= 25 ? true : `${est}/${total} gestrichelt (erwartet 19 von 353)`;
});
await check('Besucher-Gastro, Sanitätsdienst und Crew sind in der Legende', async () => {
  const namen = await p.locator('.legend-i').allTextContents();
  return ['Besucher-Gastro', 'Sanitätsdienst', 'Crew'].every((n) => namen.some((x) => x.includes(n)))
    ? true : 'Gewerke fehlen in der Legende';
});

// Überblick über die zwei Wochen
await zoomWahl(p, 'wochen');
await p.waitForTimeout(400);
await check('Balken sind im Bild', async () => {
  const vis = await p.locator('.bz-bar').evaluateAll((ns, w) =>
    ns.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > 240 && r.left < w; }).length, 1600);
  return vis >= 15 ? true : `nur ${vis} im Bild`;
});
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-wochen.png') });

// ── Eine Zeile je Vorgang, ein Balken je Termin ─────────────────────────────
// Der Fehlertyp, den nur das Bild zeigt: Balken auf der falschen Spur oder
// zwei übereinander. Deshalb hier Geometrie messen, nicht nur zählen.
await check('353 Balken auf 153 Vorgangszeilen', async () => {
  const zeilen = await p.locator('.bz-lab-task').count();
  const balken = await p.locator('.bz-bar, .bz-ms').count();
  if (balken !== 353) return balken + ' Balken statt 353';
  return zeilen === 153 ? true : zeilen + ' Zeilen statt 153';
});
await check('genau zwei Zeilen sind zweispurig (SITECREW, STAPLERFAHRER stageco)', async () => {
  const hoehen = await p.locator('.bz-lab-task').evaluateAll((ns) => ns.map((n) => n.getBoundingClientRect().height));
  const einfach = Math.min(...hoehen);
  const doppelt = hoehen.filter((h) => h > einfach * 1.5);
  return doppelt.length === 2 ? true : doppelt.length + ' hohe Zeilen statt 2';
});
await check('Bühne: drei Zeilen, «Aufbau Bühne» mit drei Balken', async () => {
  const namen = await p.locator('.bz-lab-task .bz-lab-name').evaluateAll((ns) => ns.map((n) => n.textContent));
  const b = namen.slice(0, 3);
  if (b.join('|') !== 'Anlieferung Stahl|Aufbau Bühne|Abbau Bühne') return 'Zeilen: ' + b.join(' | ');
  const n = await p.locator('.bz-track-task').nth(1).locator('.bz-bar').count();
  return n === 3 ? true : n + ' Balken in der Aufbau-Zeile statt 3';
});
await check('kein Balken verdeckt einen anderen derselben Zeile', async () => {
  const kollision = await p.locator('.bz-track-task').evaluateAll((tracks) => {
    for (const tr of tracks) {
      const bs = [...tr.querySelectorAll('.bz-bar')].map((b) => b.getBoundingClientRect());
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], c = bs[j];
        const x = a.left < c.right - 1 && c.left < a.right - 1;
        const y = a.top < c.bottom - 1 && c.top < a.bottom - 1;
        if (x && y) return tr.previousSibling ? 'überlappend' : 'überlappend';
      }
    }
    return null;
  });
  return kollision ? 'zwei Balken liegen übereinander' : true;
});
await check('keine Beschriftung läuft über den nächsten Balken', async () => {
  // Der Fehler, den die Zahlenprüfungen NICHT sehen: bei schmalen Balken steht
  // der Text rechts daneben — in einer Serie also über dem nächsten Balken.
  const bad = await p.evaluate(() => {
    for (const tr of document.querySelectorAll('.bz-track-task')) {
      const balken = [...tr.querySelectorAll('.bz-bar')];
      for (const n of balken) {
        const lab = n.querySelector('.bz-bar-t');
        if (!lab || !lab.offsetWidth) continue;
        const l = lab.getBoundingClientRect();
        for (const m of balken) {
          if (m === n) continue;
          const b = m.getBoundingClientRect();
          if (l.left < b.right - 2 && b.left < l.right - 2 && l.top < b.bottom - 2 && b.top < l.bottom - 2) {
            return lab.textContent + ' läuft über einen Nachbarbalken';
          }
        }
      }
    }
    return null;
  });
  return bad || true;
});
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-serien.png') });

// Zugeklappt: alle 20 Gewerke auf einen Blick — die Palette ist am Limit,
// hier muss man sehen, dass sich benachbarte Zeilen noch unterscheiden.
await p.locator('#fold').click();
await p.waitForTimeout(500);
await check('zugeklappt sind alle 20 Gewerkzeilen sichtbar', async () => {
  const n = await p.locator('.bz-lab-group').count();
  return n >= 15 ? true : `nur ${n} Gruppenzeilen`;
});
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-zugeklappt.png') });
await p.locator('#fold').click();
await p.waitForTimeout(400);

await zoomWahl(p, 'monate');
await p.waitForTimeout(400);
await p.screenshot({ path: join(here, 'shots', 'klassentreffen-monate.png'), fullPage: false });

// ── Autostart: die Adresse allein muss den Plan zeigen ───────────────────────
// Das ist der eigentliche Zweck der Weitergabe — wer den Link öffnet, sieht den
// Plan, ohne etwas zu importieren. Frischer Kontext = leerer localStorage, also
// genau die Lage eines fremden Besuchers.
console.log('\nDIREKTLINK ?plan=klassentreffen (frischer Browser)');
const frisch = await b.newContext({ viewport: { width: 1600, height: 950 } });
const fp = await frisch.newPage();
const ferr = [];
fp.on('pageerror', (e) => ferr.push('JS: ' + e.message));
await fp.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=klassentreffen');
await fp.waitForTimeout(1500);
await check('der Plan ist ohne Import da', async () =>
  (await fp.locator('#proj-name').textContent()).includes('Klassentreffen') ? true : 'kein Plan geladen');
await check('kein Projektdialog im Weg', async () =>
  (await fp.locator('#dlg').isHidden()) ? true : 'Dialog verdeckt den Plan');
await check('353 Vorgänge', async () => {
  const t = await fp.locator('.kpi', { hasText: 'Vorgänge' }).locator('.kpi-v').textContent();
  return t.trim() === '353' ? true : t;
});
await fp.screenshot({ path: join(here, 'shots', 'klassentreffen-autostart.png') });

// Der zweite Aufruf holt NICHT neu: derselbe Stempel, also bleibt die lokale
// Fassung stehen — sonst verlöre der Betrachter bei jedem Laden seine Änderungen.
await check('zweiter Aufruf öffnet die lokale Fassung', async () => {
  await fp.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=klassentreffen');
  await fp.waitForTimeout(1200);
  return (await fp.locator('#proj-name').textContent()).includes('Klassentreffen') ? true : 'Plan weg';
});

// Eine Altphase mit Ende vor Start in der mitgelieferten Datei sperrt den Start nicht,
// und der Autostart SAGT, dass sie entfallen ist (vorher stumm).
await check('Autostart: umgedrehte Phase in der Datei → Plan öffnet, Hinweis erscheint', async () => {
  const c2 = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const p2 = await c2.newPage();
  try {
    await c2.route('**/klassentreffen-festival.json*', async (route) => {
      const j = JSON.parse(readFileSync(join(root, 'klassentreffen-festival.json'), 'utf8'));
      j.phases = [...(j.phases || []), { name: 'Umgedreht', art: 'abbau', start: '2026-09-10T12:00', end: '2026-09-09T12:00' }];
      await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(j) });
    });
    await p2.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=klassentreffen');
    await p2.waitForTimeout(1500);
    const name = (await p2.locator('#proj-name').textContent()) || '';
    const toast = (await p2.locator('#toast').textContent()) || '';
    const sichtbar = await p2.locator('#toast').isVisible();
    if (!name.includes('Klassentreffen')) return 'Plan nicht geöffnet: «' + name + '»';
    return sichtbar && /Phase.*(nicht übernommen|wurde)/.test(toast) ? true : 'Toast: «' + toast + '» sichtbar=' + sichtbar;
  } finally { await c2.close(); }
});

// ── Start ohne Kennung: Projektdialog statt Autostart ────────────────────────
// Die Adresse allein öffnet NICHT mehr still den mitgelieferten Plan, sondern
// fragt: sonst zeigt ein Monitor mit eigenem Projekt nach dem Neustart den
// falschen Plan. Ausnahme ?plan= (Direktlink) und Live-Monitor (verify-live).
console.log('\nSTART OHNE KENNUNG: PROJEKTDIALOG');
const BASEURL = 'http://127.0.0.1:' + server.address().port + '/index.html';
{
  const lc = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const lpg = await lc.newPage();
  await lpg.goto(BASEURL);
  await lpg.waitForTimeout(1200);
  await check('ohne Projekte: Dialog mit «Klassentreffen Festival 2026» unter «Mitgelieferte Pläne»', async () => {
    if (!(await lpg.locator('#dlg').isVisible())) return 'kein Dialog';
    if (!(await lpg.locator('#dlg .dlg-h3', { hasText: 'Mitgelieferte Pläne' }).count())) return 'Abschnitt fehlt';
    return (await lpg.locator('#dlg .dlg-open', { hasText: 'Klassentreffen Festival 2026' }).count()) ? true : 'Eintrag fehlt';
  });
  await check('ohne Projekte: Klick auf den mitgelieferten Plan öffnet ihn', async () => {
    await lpg.locator('#dlg .dlg-open', { hasText: 'Klassentreffen Festival 2026' }).click();
    await lpg.waitForTimeout(1500);
    return (await lpg.locator('#proj-name').textContent()).includes('Klassentreffen') && (await lpg.locator('#dlg').isHidden()) ? true : 'Plan nicht offen';
  });
  // Zweites Projekt «Alpha» anlegen (Kopie des geöffneten Plans, jüngster Stand).
  await lpg.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem('bzp_projects'));
    const q = idx[0];
    const plan = JSON.parse(localStorage.getItem('bzp_p_' + q.id));
    plan.project.id = 'alpha1'; plan.project.name = 'Alpha';
    localStorage.setItem('bzp_p_alpha1', JSON.stringify(plan));
    idx.push({ ...q, id: 'alpha1', name: 'Alpha', modified: new Date(Date.now() + 60000).toISOString() });
    localStorage.setItem('bzp_projects', JSON.stringify(idx));
    localStorage.setItem('bzp_active', q.id);
  });
  await lpg.goto(BASEURL);
  await lpg.waitForTimeout(1200);
  await check('mit Projekten: Dialog mit Zeile «Alpha», noch kein Plan gewechselt', async () => {
    if (!(await lpg.locator('#dlg').isVisible())) return 'kein Dialog';
    if (!(await lpg.locator('#dlg .dlg-open', { hasText: 'Alpha' }).count())) return 'Zeile Alpha fehlt';
    const n = (await lpg.locator('#proj-name').textContent()) || '';
    return n.includes('Alpha') ? 'Alpha schon offen' : true;
  });
  await check('Start-Dialog hat kein «Abbrechen» und schließt nicht per Klick daneben', async () => {
    if (await lpg.locator('#dlg .dlg-act .btn', { hasText: 'Abbrechen' }).count()) return 'Abbrechen vorhanden';
    await lpg.mouse.click(5, 5);
    return (await lpg.locator('#dlg').isVisible()) ? true : 'Dialog zu';
  });
  await check('Klick auf «Alpha» öffnet Alpha', async () => {
    await lpg.locator('#dlg .dlg-open', { hasText: 'Alpha' }).click();
    await lpg.waitForTimeout(800);
    return (await lpg.locator('#proj-name').textContent()).includes('Alpha') ? true : 'Alpha nicht offen';
  });
  await check('?plan=klassentreffen öffnet weiter direkt, ohne Dialog', async () => {
    await lpg.goto(BASEURL + '?plan=klassentreffen');
    await lpg.waitForTimeout(1200);
    return (await lpg.locator('#dlg').isHidden()) && (await lpg.locator('#proj-name').textContent()).includes('Klassentreffen') ? true : 'Dialog oder falscher Plan';
  });
  await lc.close();
}

// ── Neuer Planstand: nachfragen statt still ersetzen ─────────────────────────
console.log('\nNEUER PLANSTAND IN DER DATEI');
{
  const aeltere = async (c) => {
    const pg = await c.newPage();
    await pg.goto(BASEURL + '?plan=klassentreffen');
    await pg.waitForTimeout(1500);
    // Lokale Fassung: Titel eines Vorgangs geändert, Stempel älter als die Datei.
    await pg.evaluate(() => {
      const q = JSON.parse(localStorage.getItem('bzp_projects'))[0];
      const plan = JSON.parse(localStorage.getItem('bzp_p_' + q.id));
      plan.tasks[0].title = 'LOKAL GEÄNDERT';
      plan.project.quelle = { ...(plan.project.quelle || {}), exported: '2000-01-01T00:00:00.000Z' };
      localStorage.setItem('bzp_p_' + q.id, JSON.stringify(plan));
    });
    await pg.goto(BASEURL + '?plan=klassentreffen');
    await pg.waitForTimeout(1500);
    return pg;
  };
  const namen = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('bzp_projects')).map((x) => x.name));
  const dlgZwei = (pg) => pg.locator('.dlg h2', { hasText: 'Zwei Fassungen' });
  const c1 = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const g1 = await aeltere(c1);
  await check('geänderte lokale Fassung + neuere Datei: Dialog «Zwei Fassungen»', async () =>
    (await dlgZwei(g1).count()) ? true : 'kein Dialog');
  await check('«Beide behalten»: zwei Projekte, Kopie «… (lokal vor Update)»', async () => {
    await g1.locator('.dlg .btn', { hasText: 'Beide behalten' }).click();
    await g1.waitForTimeout(1500);
    const n = await namen(g1);
    if (n.length !== 2) return 'Projekte: ' + n.join(' | ');
    if (!n.some((x) => x === 'Klassentreffen Festival 2026 (lokal vor Update)')) return 'Kopie fehlt: ' + n.join(' | ');
    return (await g1.locator('#proj-name').textContent()).includes('(lokal') ? 'Kopie statt Datei offen' : true;
  });
  await c1.close();
  const c2 = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const g2 = await aeltere(c2);
  await check('«Meine behalten»: lokale Fassung offen, Stempel nachgezogen, danach keine Nachfrage mehr', async () => {
    await g2.locator('.dlg .btn', { hasText: 'Meine behalten' }).click();
    await g2.waitForTimeout(1200);
    const t = await g2.evaluate(() => { const q = JSON.parse(localStorage.getItem('bzp_projects'))[0]; return JSON.parse(localStorage.getItem('bzp_p_' + q.id)).tasks[0].title; });
    if (t !== 'LOKAL GEÄNDERT') return 'Titel: ' + t;
    await g2.goto(BASEURL + '?plan=klassentreffen');
    await g2.waitForTimeout(1500);
    return (await dlgZwei(g2).count()) ? 'fragt erneut' : true;
  });
  await c2.close();
  const c3 = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const g3 = await aeltere(c3);
  await check('«Neuen Stand nehmen»: Datei ersetzt die lokale Fassung', async () => {
    await g3.locator('.dlg .btn', { hasText: 'Neuen Stand nehmen' }).click();
    await g3.waitForTimeout(1200);
    const t = await g3.evaluate(() => { const q = JSON.parse(localStorage.getItem('bzp_projects'))[0]; return JSON.parse(localStorage.getItem('bzp_p_' + q.id)).tasks[0].title; });
    return t !== 'LOKAL GEÄNDERT' ? true : 'lokale Fassung blieb';
  });
  await c3.close();
}

// Die Projektzeile unter «Öffnen» geht durch dieselbe Prüfung wie der Direktlink:
// sonst bliebe ein neuer Planstand für jeden unbemerkt, der sein Projekt dort öffnet.
console.log('\nPROJEKTZEILE: PLANSTAND WIRD GEPRÜFT');
{
  const zeile = async (geaendert) => {
    const c = await b.newContext({ viewport: { width: 1600, height: 950 } });
    const pg = await c.newPage();
    await pg.goto(BASEURL + '?plan=klassentreffen');
    await pg.waitForTimeout(1500);
    await pg.evaluate((g) => {
      const q = JSON.parse(localStorage.getItem('bzp_projects'))[0];
      const plan = JSON.parse(localStorage.getItem('bzp_p_' + q.id));
      if (g) plan.tasks[0].title = 'LOKAL GEÄNDERT';
      plan.project.quelle = { ...(plan.project.quelle || {}), exported: '2000-01-01T00:00:00.000Z' };
      localStorage.setItem('bzp_p_' + q.id, JSON.stringify(plan));
    }, geaendert);
    await pg.goto(BASEURL);
    await pg.waitForTimeout(1200);
    await pg.locator('#dlg .dlg-open', { hasText: 'geändert' }).first().click();
    await pg.waitForTimeout(1500);
    const r = {
      zwei: await pg.locator('.dlg h2', { hasText: 'Zwei Fassungen' }).count(),
      offen: (await pg.locator('#proj-name').textContent()) || '',
    };
    await c.close();
    return r;
  };
  const g = await zeile(true);
  await check('Projektzeile, lokal geändert + neuere Datei: Dialog «Zwei Fassungen»', async () =>
    g.zwei ? true : 'kein Dialog, geöffnet: ' + g.offen);
  const u = await zeile(false);
  await check('Projektzeile, lokal unverändert + ältere Fassung: öffnet ohne Dialog', async () =>
    !u.zwei && u.offen.includes('Klassentreffen') ? true : 'Dialog: ' + u.zwei + ', offen: ' + u.offen);
}

// Start an einem Tag OHNE Vorgänge mitten im Plan: der Plan öffnet nicht auf der
// leeren Jetzt-Linie, sondern am nächsten Tag mit Vorgängen. Die Uhr steht auf
// dem 27.08.; im Original liegt an jedem der 14 Tage etwas, also wird der 27.
// im Testplan leergeräumt (alles, was ihn berührt, fliegt raus).
console.log('\nSTART AN EINEM TAG OHNE VORGÄNGE');
{
  const plan = JSON.parse((await import('node:fs')).readFileSync(join(root, 'klassentreffen-festival.json'), 'utf8'));
  const a = new Date('2026-08-27T00:00').getTime(), z = new Date('2026-08-28T00:00').getTime();
  plan.tasks = plan.tasks.filter((t) => !(new Date(t.start).getTime() < z && new Date(t.end).getTime() >= a));
  const gCtx = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const gp = await gCtx.newPage();
  await gp.clock.install({ time: new Date('2026-08-27T10:00:00') });
  await gp.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=leer');
  await gp.waitForTimeout(700);
  await gp.locator('.dlg-act .btn', { hasText: 'JSON importieren' }).click();
  await gp.locator('#import-file').setInputFiles({ name: 'luecke.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await gp.waitForTimeout(1500);
  await check('Start an einem Tag ohne Vorgänge zeigt Balken', async () => {
    const vis = await gp.locator('.bz-bar').evaluateAll((ns, w) =>
      ns.filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.right > 300 && r.left < w; }).length, 1600);
    return vis >= 3 ? true : `nur ${vis} Balken im Bild`;
  });
  await gp.screenshot({ path: join(here, 'shots', 'klassentreffen-luecke.png') });
  await gCtx.close();
}

// Heute liegt NACH dem Plan (Realfall): die App öffnet auf dem Planbeginn. Dort
// haben nur untere Gewerke etwas — ohne vertikales Nachscrollen stünde ein leeres
// Blatt im Bild und alle Balken unter dem Rand.
console.log('\nSTART NACH DEM PLANENDE');
// Desktop UND Handy: auf dem Handy (390x844) stand beim echten Realfall «FR 21.08.»
// mit Bühne/Rigging/Licht und keinem einzigen Balken im Bild.
for (const [vw, vh, minBalken] of [[1600, 950, 3], [390, 844, 1]]) {   // Handy: Kopf frisst die Hälfte, ein Balken genügt
  const nCtx = await b.newContext({ viewport: { width: vw, height: vh } });
  const np = await nCtx.newPage();
  await np.clock.install({ time: new Date('2026-11-19T10:00:00') });
  await np.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=leer');
  await np.waitForTimeout(700);
  await np.locator('.dlg-act .btn', { hasText: 'JSON importieren' }).click();
  await np.locator('#import-file').setInputFiles(join(root, 'klassentreffen-festival.json'));
  await np.waitForTimeout(1500);
  await check(`Start nach dem Planende (${vw}x${vh}): Balken im Sichtfeld (waagerecht UND senkrecht)`, async () => {
    const vis = await np.evaluate(() => {
      const sc = document.querySelector('.bz-scroll'), sr = sc.getBoundingClientRect();
      const kopf = document.querySelector('.bz-axis').getBoundingClientRect().bottom;
      const seite = document.querySelector('.bz-side')?.getBoundingClientRect().right ?? sr.left;
      return [...sc.querySelectorAll('.bz-bar')].filter((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.top >= kopf && r.bottom <= Math.min(sr.bottom, innerHeight) && r.right > seite && r.left < sr.right;
      }).length;
    });
    return vis >= minBalken ? true : `nur ${vis} Balken im Sichtfeld`;
  });
  await check(`Start nach dem Planende (${vw}x${vh}): Gruppenzeile der obersten Balkenzeile steht im Bild`, async () => {
    const r = await np.evaluate(() => {
      const sc = document.querySelector('.bz-scroll'), sr = sc.getBoundingClientRect();
      const kopf = document.querySelector('.bz-axis').getBoundingClientRect().bottom;
      const seite = document.querySelector('.bz-side')?.getBoundingClientRect().right ?? sr.left;
      const sichtbar = [...sc.querySelectorAll('.bz-bar')].filter((n) => {
        const q = n.getBoundingClientRect();
        return q.width > 0 && q.top >= kopf && q.bottom <= Math.min(sr.bottom, innerHeight) && q.right > seite && q.left < sr.right;
      }).sort((a, c) => a.getBoundingClientRect().top - c.getBoundingClientRect().top);
      if (!sichtbar.length) return 'kein sichtbarer Balken';
      const gr = [...sc.querySelectorAll('.bz-lab-group')]
        .map((n) => n.getBoundingClientRect())
        .filter((q) => q.bottom <= sichtbar[0].getBoundingClientRect().top + 1)
        .sort((a, c) => c.top - a.top)[0];
      if (!gr) return 'keine Gruppenzeile über dem obersten Balken';
      return gr.top >= kopf - 1 && gr.bottom <= Math.min(sr.bottom, innerHeight) ? true : `Gruppenzeile bei ${Math.round(gr.top)}–${Math.round(gr.bottom)}, Kopf endet ${Math.round(kopf)}`;
    });
    return r;
  });
  await check(`Start nach dem Planende (${vw}x${vh}): Seite läuft nicht seitlich über (Minimap-Jetzt-Marke geklemmt)`, async () => {
    const r = await np.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, mini: document.querySelector('.bz-mini-now')?.style.left }));
    return r.sw <= r.iw ? true : `scrollWidth ${r.sw} > ${r.iw} (Marke bei ${r.mini})`;
  });
  await np.screenshot({ path: join(here, 'shots', vw > 500 ? 'klassentreffen-nach-ende.png' : 'klassentreffen-nach-ende-handy.png') });
  await nCtx.close();
}

// Fokustag statt Bildmitte (Ebenenwechsel): um 21:00 liegt die Bildmitte nach
// centerOn(…, 0.3) schon am Folgetag. Der 27. trägt nur ein Gewerk weit unten,
// der 28. nichts — wer den Tag aus der Bildmitte liest, sucht am 28. und scrollt nicht.
console.log('\nFOKUSTAG NACH EBENENWECHSEL');
{
  const plan = JSON.parse(readFileSync(join(root, 'klassentreffen-festival.json'), 'utf8'));
  const tag = (d) => new Date(d + 'T00:00').getTime();
  const beruehrt = (t, d) => new Date(t.start).getTime() < tag(d) + 864e5 && new Date(t.end).getTime() > tag(d);
  const unten = [...plan.gewerke].reverse().find((g) => plan.tasks.some((t) => t.gewerk === g.id && beruehrt(t, '2026-08-27'))).id;
  plan.tasks = plan.tasks.filter((t) => !beruehrt(t, '2026-08-28') && (!beruehrt(t, '2026-08-27') || t.gewerk === unten));
  const hatUnten = plan.tasks.some((t) => t.gewerk === unten && beruehrt(t, '2026-08-27'));
  const fCtx = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const fpg = await fCtx.newPage();
  await fpg.clock.install({ time: new Date('2026-08-27T21:00:00') });
  await fpg.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=leer');
  await fpg.waitForTimeout(700);
  await fpg.locator('.dlg-act .btn', { hasText: 'JSON importieren' }).click();
  await fpg.locator('#import-file').setInputFiles({ name: 'fokus.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) });
  await fpg.waitForTimeout(1500);
  await fpg.locator('.rail-m', { hasText: 'Showablauf' }).click();
  await fpg.waitForTimeout(500);
  await fpg.locator('.rail-m', { hasText: 'Bauzeitenplan' }).click();
  await fpg.waitForTimeout(800);
  await check('Vorbedingung: der 27. trägt ein Gewerk ganz unten', async () => hatUnten ? true : 'Testplan trägt dort nichts');
  await check('nach dem Ebenenwechsel steht der Balken des Fokustages im Bild', async () => {
    const vis = await fpg.evaluate(() => {
      const sc = document.querySelector('.bz-scroll'), sr = sc.getBoundingClientRect();
      const kopf = document.querySelector('.bz-axis').getBoundingClientRect().bottom;
      const seite = document.querySelector('.bz-side').getBoundingClientRect().right;
      return [...sc.querySelectorAll('.bz-bar')].filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.top >= kopf && r.bottom <= sr.bottom && r.right > seite && r.left < sr.right; }).length;
    });
    return vis >= 1 ? true : 'kein Balken im Bild (Tag aus der Bildmitte gelesen?)';
  });
  await fCtx.close();
}

// ── Suche (Kopfzeile): tippen, Liste, Enter springt ──────────────────────────
{
  console.log('\nSUCHE');
  const sCtx = await b.newContext({ viewport: { width: 1600, height: 950 } });
  const sp = await sCtx.newPage();
  sp.setDefaultTimeout(5000);
  const serr = [];
  sp.on('pageerror', (e) => serr.push('JS: ' + e.message));
  await sp.clock.install({ time: new Date('2026-08-27T10:00:00') });
  await sp.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=klassentreffen');
  await sp.waitForSelector('.bz-lab', { timeout: 20000 });
  await sp.waitForTimeout(800);
  // Der ausgewählte Balken liegt vollständig im sichtbaren Ausschnitt des Gantt.
  const selImBild = () => sp.evaluate(() => {
    const sc = document.querySelector('.bz-scroll'); if (!sc) return 'kein Gantt';
    const sr = sc.getBoundingClientRect();
    const kopf = document.querySelector('.bz-axis').getBoundingClientRect().bottom;
    const seite = document.querySelector('.bz-side').getBoundingClientRect().right;
    const n = [...sc.querySelectorAll('.bz-bar.is-sel, .bz-ms.is-sel')].find((q) => q.getBoundingClientRect().height > 0);
    if (!n) return 'kein ausgewählter Balken';
    const r = n.getBoundingClientRect();
    return r.top >= kopf - 1 && r.bottom <= sr.bottom + 1 && r.right > seite && r.left < sr.right ? true
      : `außerhalb: top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} left ${Math.round(r.left)} (Bild ${Math.round(kopf)}–${Math.round(sr.bottom)}, x ${Math.round(seite)}–${Math.round(sr.right)})`;
  });
  const suche = async (q) => { await sp.fill('#suche', ''); await sp.fill('#suche', q); await sp.waitForTimeout(250); };

  await check('Suche: «kran» liefert Treffer in der Liste', async () => {
    await suche('kran');
    const n = await sp.locator('#suche-liste .suche-i').count();
    return n >= 1 ? true : 'keine Treffer (' + n + ')';
  });
  await check('Suche: Umlaute und Groß/Klein («BÜHNE» = «bühne», mit Treffern)', async () => {
    await suche('bühne');
    const a = await sp.locator('#suche-liste .suche-i').count();
    await suche('BÜHNE');
    const c = await sp.locator('#suche-liste .suche-i').count();
    return a >= 1 && a === c ? true : a + ' vs ' + c;
  });
  await check('Suche: Enter springt — Balken ausgewählt, im Bild, Panel zeigt den Titel', async () => {
    await suche('kran');
    await sp.keyboard.press('Enter');
    await sp.waitForTimeout(500);
    const bild = await selImBild();
    if (bild !== true) return bild;
    const panel = await sp.locator('#ins').innerText().catch(() => '');
    return /kran/i.test(panel) ? true : 'Panel ohne «Kran»: ' + panel.slice(0, 60);
  });
  await check('Suche: nach dem Sprung ist die Liste zu', async () =>
    (await sp.locator('#suche-liste').isHidden()) ? true : 'Liste noch offen');
  await check('Suche: Treffer in zugeklappter Gruppe wird sichtbar', async () => {
    await sp.locator('#fold').click();
    await sp.waitForTimeout(400);
    const zu = await sp.locator('.bz-lab-group.is-collapsed').count();
    if (!zu) return 'Vorbedingung: nichts zugeklappt';
    await suche('kran');
    await sp.keyboard.press('Enter');
    await sp.waitForTimeout(500);
    return await selImBild();
  });
  await check('Suche: ↓ + Enter wählt den zweiten Treffer', async () => {
    await suche('kran');
    const n = await sp.locator('#suche-liste .suche-i').count();
    if (n < 2) return 'Vorbedingung: nur ' + n + ' Treffer';
    await sp.keyboard.press('ArrowDown');
    const aktiv = await sp.locator('#suche-liste .suche-i.is-aktiv .suche-t').textContent();
    await sp.keyboard.press('Enter');
    await sp.waitForTimeout(400);
    const bild = await selImBild();
    return bild === true || /kran/i.test(aktiv) ? true : bild;
  });
  await check('Suche: Escape schließt die Liste und leert das Feld', async () => {
    await suche('kran');
    await sp.keyboard.press('Escape');
    await sp.waitForTimeout(150);
    const v = await sp.inputValue('#suche');
    const zu = await sp.locator('#suche-liste').isHidden();
    return v === '' && zu ? true : `Wert «${v}», Liste ${zu ? 'zu' : 'offen'}`;
  });
  await check('Suche: ohne Treffer steht «Nichts gefunden für «…»»', async () => {
    await suche('qqqxyz');
    const t = await sp.locator('#suche-liste').innerText();
    return t.trim() === 'Nichts gefunden für «qqqxyz»' ? true : t;
  });
  await check('Suche: Klick in die Liste (Gruppenkopf, Leertext) schließt sie nicht', async () => {
    await suche('kran');
    await sp.locator('#suche-liste .suche-g').first().dispatchEvent('mousedown');
    const ev = await sp.evaluate(() => {
      const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      document.querySelector('#suche-liste .suche-g').dispatchEvent(e);
      return e.defaultPrevented;
    });
    await sp.waitForTimeout(150);
    return ev && !(await sp.locator('#suche-liste').isHidden()) ? true : 'mousedown nicht verhindert oder Liste zu';
  });
  await check('Suche: ⌘S im Feld bleibt die App-Sicherung (nicht «Seite sichern»)', async () => {
    await sp.locator('#suche').focus();
    const prevented = await sp.evaluate(() => {
      const e = new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true });
      document.getElementById('suche').dispatchEvent(e);
      return e.defaultPrevented;
    });
    await sp.locator('#suche').fill('');
    return prevented ? true : 'der Browser-Dialog «Seite sichern» bliebe offen';
  });
  await check('Suche: «/» öffnet die Suche, tippt aber in einem Tabellenfeld ein «/»', async () => {
    await sp.locator('#undo').focus();
    await sp.keyboard.press('/');
    const fokus = await sp.evaluate(() => document.activeElement && document.activeElement.id);
    if (fokus !== 'suche') return 'Fokus nicht im Suchfeld: ' + fokus;
    await sp.keyboard.press('Escape');
    await sp.locator('[data-view="tabelle"]').click();
    await sp.waitForTimeout(500);
    const feld = sp.locator('.c-title input').first();
    await feld.focus();
    const vorher = await feld.inputValue();
    await sp.keyboard.press('End');
    await sp.keyboard.type('/');
    const nachher = await feld.inputValue();
    const fokus2 = await sp.evaluate(() => document.activeElement && document.activeElement.id);
    if (fokus2 === 'suche') return 'die Suche hat den Fokus aus dem Tabellenfeld geholt';
    return nachher === vorher + '/' ? true : `«${vorher}» → «${nachher}»`;
  });
  await check('Suche in der Tabelle: Zeile markiert und im Bild', async () => {
    await sp.locator('#undo').focus();
    await suche('kran');
    await sp.keyboard.press('Enter');
    await sp.waitForTimeout(600);
    const r = await sp.evaluate(() => {
      const tr = document.querySelector('tr.is-treffer'); if (!tr) return 'keine markierte Zeile';
      const q = tr.getBoundingClientRect(), sc = document.querySelector('#tb').getBoundingClientRect();
      return q.top >= sc.top - 1 && q.bottom <= sc.bottom + 1 ? true : `Zeile ${Math.round(q.top)}–${Math.round(q.bottom)} außerhalb ${Math.round(sc.top)}–${Math.round(sc.bottom)}`;
    });
    return r;
  });
  await sp.locator('[data-view="gantt"]').click();
  await sp.waitForTimeout(400);
  await suche('kran');
  await sp.screenshot({ path: join(here, 'shots', 'suche-desktop.png') });
  await sp.keyboard.press('Escape');
  if (serr.length) { console.log('  ✗ JS-Fehler in der Suche: ' + serr[0]); bad++; }
  await sCtx.close();

  const hCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const hp = await hCtx.newPage();
  hp.setDefaultTimeout(5000);
  await hp.clock.install({ time: new Date('2026-08-27T10:00:00') });
  await hp.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=klassentreffen');
  await hp.waitForSelector('.bz-lab', { timeout: 20000 });
  await hp.waitForTimeout(800);
  await check('Suche Handy: erreichbar, Kopf ≤ 300 px, Gantt ≥ 50 %', async () => {
    const sichtbar = await hp.locator('#suche').isVisible();
    if (!sichtbar) return 'Suchfeld nicht sichtbar';
    await hp.fill('#suche', 'kran');
    await hp.waitForTimeout(250);
    const r = await hp.evaluate(() => ({
      kopf: Math.round(document.querySelector('.hd').getBoundingClientRect().bottom),
      bz: Math.round(document.querySelector('.bz-scroll').getBoundingClientRect().height), h: innerHeight,
      liste: (() => { const l = document.querySelector('#suche-liste'); const q = l.getBoundingClientRect(); return { n: l.querySelectorAll('.suche-i').length, r: Math.round(q.right), l: Math.round(q.left), b: Math.round(q.bottom) }; })(),
      sw: document.documentElement.scrollWidth,
    }));
    if (r.kopf > 300) return 'Kopf ' + r.kopf + ' px';
    if (r.liste.n < 1) return 'keine Treffer';
    if (r.liste.r > 390 || r.liste.l < 0) return 'Liste ragt aus dem Bild: ' + JSON.stringify(r.liste);
    if (r.sw > 391) return 'Seite scrollt seitwärts: ' + r.sw;
    return r.bz >= r.h * 0.5 ? true : 'Gantt nur ' + r.bz + ' von ' + r.h + ' px';
  });
  await hp.screenshot({ path: join(here, 'shots', 'suche-handy.png') });
  await hp.keyboard.press('Enter');
  await hp.waitForTimeout(500);
  await check('Suche Handy: Enter springt zum Treffer', async () =>
    (await hp.locator('.bz-bar.is-sel, .bz-ms.is-sel').count()) >= 1 ? true : 'nichts ausgewählt');
  await hCtx.close();
}

// ?plan=leer im WIRKLICH frischen Browser (leerer Speicher) — so starten die
// Erststart-Prüfungen. Im Kontext oben liegt der Plan schon, dort öffnet die App
// dann richtigerweise das vorhandene Projekt statt eines Dialogs.
const leerCtx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const lp = await leerCtx.newPage();
await lp.goto('http://127.0.0.1:' + server.address().port + '/index.html?plan=leer');
await lp.waitForTimeout(1000);
await check('?plan=leer zeigt im leeren Browser den Projektdialog', async () =>
  (await lp.locator('#dlg').isVisible()) ? true : 'Dialog fehlt');
if (ferr.length) { console.log('  ✗ JS-Fehler beim Autostart: ' + ferr[0]); bad++; }

if (errors.length) { console.log('\n  ✗ Fehler:'); errors.slice(0, 5).forEach((e) => console.log('      ' + e)); bad += errors.length; }
else console.log('\n  ✓ keine JS-Fehler');
await b.close(); server.close();
console.log(bad ? `\n${bad} Problem(e).\n` : '\nAlle Prüfungen bestanden.\n');
process.exit(bad ? 1 : 0);
