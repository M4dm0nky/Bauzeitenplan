// Plan aus tools/fixtures/ als Testdaten in den localStorage legen.
// Die App liefert keinen Plan mehr mit; die Prüfskripte seeden deshalb den Browser
// vor dem ersten goto (addInitScript) und öffnen die App mit ?plan=leer bzw. print.html.
// Warum localStorage statt Import-Knopf: ein Seed je Seite statt eines Imports je
// Theme/Seite. Die Import-Tür selbst prüfen weiter verify-klassentreffen und verify-amk.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deserialize } from '../js/persistence.js';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, 'fixtures');

// Der Init-Script läuft bei JEDER Navigation. Darum ein eigenes Flag `bzp_seeded_<id>`
// statt «Plan existiert»: so seedet er genau einmal je Context, ein Test darf den Plan
// danach löschen oder verändern, ohne dass die nächste Navigation ihn zurückholt.
/** Liest die Fixture; `scripts` ist JS-Text, der Plan, Index und aktives Projekt setzt. */
export function planSeed(datei) {
  const text = readFileSync(join(FIXTURES, datei), 'utf8');
  // Über `deserialize` (wie der Import-Knopf), nicht roher Dateitext: sonst fehlen Prüfung
  // und Normalisierung, und die Datei-Felder (schema, exported, app, version) lägen im
  // gespeicherten Plan, den die App selbst nie so ablegt.
  const r = deserialize(text);
  if (r.ok === false) throw new Error('Fixture ' + datei + ': ' + r.error);
  const plan = r.plan;
  const id = plan.project.id;
  const eintrag = { id, name: plan.project.name, venue: plan.project.venue || '', modified: new Date().toISOString(), remoteSha: null, dirty: false };
  // Der Index wird gemergt (andere Projekte bleiben). `bzp_active` zeigt auf diesen
  // Plan, weil die Prüfungen ihn offen erwarten (?plan=leer / print.html lesen das aktive Projekt).
  const scripts = `try {
  const id = ${JSON.stringify(id)};
  if (localStorage.getItem('bzp_seeded_' + id) !== '1') {
    localStorage.setItem('bzp_seeded_' + id, '1');
    localStorage.setItem('bzp_p_' + id, ${JSON.stringify(JSON.stringify(plan))});
    const idx = JSON.parse(localStorage.getItem('bzp_projects') || '[]').filter((e) => e.id !== id);
    idx.push(${JSON.stringify(eintrag)});
    localStorage.setItem('bzp_projects', JSON.stringify(idx));
    localStorage.setItem('bzp_active', id);
  }
} catch (e) {}`;
  return { plan, id, scripts };
}

// ── Server-Weg (seit Task 10) ───────────────────────────────────────────────────
// Die App liest den Plan von PocketBase. `planLaden` startet je Skript EINE lokale PB
// (tools/pb-lokal.mjs), legt das Konto «pruefer» (Produktionsleitung) und den Plan über den
// Server-Weg an (createServerPlan.planAnlegen, wie der Import-Knopf) und gibt der Seite per
// InitScript Anmeldung (`bzp_auth`), `?api=` und aktives Projekt mit. Das Token lebt nur im
// Browser des Skripts und im Speicher, nie im Repo.
//   const { id, pb, stop } = await planLaden(ctx, 'klassentreffen-festival.json');
//   try { … page.goto(BASE + '/index.html?plan=leer') … } finally { await stop(); }
// Mehrere Aufrufe im selben Skript teilen sich die PB; `stop()` zählt mit und beendet sie beim letzten.
import { randomBytes } from 'node:crypto';
import { createPb } from '../js/pb.js';
import { createServerPlan } from '../js/server.js';
import { startePb, kontoAnlegen, anmelden } from './pb-lokal.mjs';

export const PRUEFER = 'pruefer@bzp.test';
let gemeinsam = null;   // Promise<{ pb, pw, benutzer, zaehler }>

async function gemeinsamePb() {
  if (!gemeinsam) {
    gemeinsam = (async () => {
      const pb = await startePb();
      try {
        const pw = 'Pw-' + randomBytes(9).toString('hex');
        const konto = await kontoAnlegen(pb, { email: PRUEFER, name: 'Prüfer', passwort: pw, produktionsleitung: true });
        return { pb, pw, konto, zaehler: 0 };
      } catch (e) { await pb.stop(); throw e; }
    })();
    gemeinsam.catch(() => { gemeinsam = null; });
  }
  return gemeinsam;
}

/** Legt den Plan aus tools/fixtures/<datei> auf dem Server an und richtet `ziel` (Page oder BrowserContext) ein. */
export async function planLaden(ziel, datei = 'klassentreffen-festival.json') {
  const g = await gemeinsamePb();
  g.zaehler++;
  const stop = async () => {
    if (--g.zaehler > 0) return;
    gemeinsam = null;
    await g.pb.stop();
  };
  try {
    const { plan } = planSeed(datei);
    const a = await anmelden(g.pb.url, PRUEFER, g.pw);
    const m = new Map([['bzp_auth', JSON.stringify({ token: a.token, record: a.record })]]);
    const sp = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
    const r = await createServerPlan({ pb: createPb({ basis: g.pb.url, fetch, speicher: sp, autostart: false }), planId: null }).planAnlegen(plan);
    if (!r.ok) throw new Error('Plan anlegen: ' + JSON.stringify(r).slice(0, 300));
    const id = r.planId;
    const skript = `try {
  if (!localStorage.getItem('bzp_seeded_auth')) {
    localStorage.setItem('bzp_seeded_auth', '1');
    localStorage.setItem('bzp_auth', ${JSON.stringify(JSON.stringify({ token: a.token, record: a.record }))});
    localStorage.setItem('bzp_active', ${JSON.stringify(id)});
  }
  const q = new URLSearchParams(location.search);
  if (!q.get('api') && /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)) {
    q.set('api', ${JSON.stringify(g.pb.url)});
    history.replaceState(null, '', location.pathname + '?' + q + location.hash);
  }
} catch (e) {}`;
    await ziel.addInitScript(skript);
    return { id, pb: g.pb, stop };
  } catch (e) { await stop(); throw e; }
}

/** Alter Weg (localStorage-Seed): gilt nicht mehr für die App, bis Task 12 die übrigen Skripte umstellt. */
export async function planLadenLokal(ziel, datei = 'klassentreffen-festival.json') {
  const { id, scripts } = planSeed(datei);
  await ziel.addInitScript(scripts);
  return id;
}
