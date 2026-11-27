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
  // `datei` darf auch ein fertiges Planobjekt sein (Prüfungen, die die Fixture vorher verändern)
  const text = typeof datei === 'object' && datei ? JSON.stringify(datei) : readFileSync(join(FIXTURES, datei), 'utf8');
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
import { startePb, anmelden } from './pb-lokal.mjs';

export const PRUEFER = 'pruefer@bzp.test';
// Gegen eine PB mit Rate-Limits (Option rateLimits) drosselt schon die Anmeldung (429): warten und neu versuchen.
async function mit429(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= 10 || !/Too Many Requests|429/.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}
const gemeinsamMap = new Map();   // Schlüssel ('normal' | 'rate') → Promise<{ pb, pw, konto, zaehler }>

// Konto als Superuser anlegen, OHNE sich anzumelden (die Anmeldung zählt gegen die Rate-Limits; planLaden meldet selbst an)
async function kontoOhneLogin(pb, email, passwort) {
  const r = await pb.su('POST', '/api/collections/users/records', {
    email, emailVisibility: true, name: 'Prüfer', password: passwort, passwordConfirm: passwort,
    superadmin: false, produktionsleitung: true, verified: true,
  });
  if (!r.ok) throw new Error('Konto ' + email + ': ' + JSON.stringify(r.body));
  return { id: r.body.id };
}

async function gemeinsamePb(schluessel = 'normal') {
  const rateLimits = schluessel === 'rate';
  let gemeinsam = gemeinsamMap.get(schluessel);
  if (!gemeinsam) {
    gemeinsam = (async () => {
      const pb = await startePb({ rateLimits });
      try {
        const pw = 'Pw-' + randomBytes(9).toString('hex');
        const konto = await kontoOhneLogin(pb, PRUEFER, pw);
        return { pb, pw, konto, zaehler: 0, schluessel };
      } catch (e) { await pb.stop(); throw e; }
    })();
    gemeinsamMap.set(schluessel, gemeinsam);
    gemeinsam.catch(() => { gemeinsamMap.delete(schluessel); });
  }
  return gemeinsam;
}

/**
 * Legt den Plan aus tools/fixtures/<datei> auf dem Server an und richtet `ziel` (Page oder BrowserContext) ein.
 * `datei = null`: nur angemeldet, KEIN Plan (die App zeigt den Projektdialog; für Import-Prüfungen).
 * `frisch: true`: eigenes Konto (Produktionsleitung) statt des gemeinsamen «pruefer» — dann sieht der
 * Browser nur seine eigenen Pläne und teilt keinen Zustand mit anderen Kontexten derselben PB.
 */
export async function planLaden(ziel, datei = 'klassentreffen-festival.json', { frisch = false, rateLimits = false } = {}) {
  const g = await gemeinsamePb(rateLimits ? 'rate' : 'normal');
  g.zaehler++;
  let gestoppt = false;
  const stop = async () => {
    if (gestoppt) return;
    gestoppt = true;
    if (--g.zaehler > 0) return;
    gemeinsamMap.delete(g.schluessel);
    await g.pb.stop();
  };
  try {
    let email = PRUEFER, pw = g.pw;
    if (frisch) {
      email = 'p' + randomBytes(5).toString('hex') + '@bzp.test';
      pw = 'Pw-' + randomBytes(9).toString('hex');
      await kontoOhneLogin(g.pb, email, pw);
    }
    const a = await mit429(() => anmelden(g.pb.url, email, pw));
    const m = new Map([['bzp_auth', JSON.stringify({ token: a.token, record: a.record })]]);
    const sp = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
    // Legt einen (weiteren) Plan für dasselbe Konto an und gibt dessen plan_id zurück
    const planDazu = async (d) => {
      const { plan } = planSeed(d);
      const r = await createServerPlan({ pb: createPb({ basis: g.pb.url, fetch, speicher: sp, autostart: false }), planId: null }).planAnlegen(plan);
      if (!r.ok) throw new Error('Plan anlegen: ' + JSON.stringify(r).slice(0, 300));
      return r.planId;
    };
    const id = datei ? await planDazu(datei) : null;
    const skript = `try {
  if (!localStorage.getItem('bzp_seeded_auth')) {
    localStorage.setItem('bzp_seeded_auth', '1');
    localStorage.setItem('bzp_auth', ${JSON.stringify(JSON.stringify({ token: a.token, record: a.record }))});
    ${id ? `localStorage.setItem('bzp_active', ${JSON.stringify(id)});` : ''}
  }
  const q = new URLSearchParams(location.search);
  if (!q.get('api') && /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)) {
    q.set('api', ${JSON.stringify(g.pb.url)});
    history.replaceState(null, '', location.pathname + '?' + q + location.hash);
  }
} catch (e) {}`;
    await ziel.addInitScript(skript);
    return { id, pb: g.pb, stop, planDazu };
  } catch (e) { await stop(); throw e; }
}

/** Alter Weg (localStorage-Seed): gilt nicht mehr für die App, bis Task 12 die übrigen Skripte umstellt. */
export async function planLadenLokal(ziel, datei = 'klassentreffen-festival.json') {
  const { id, scripts } = planSeed(datei);
  await ziel.addInitScript(scripts);
  return id;
}
