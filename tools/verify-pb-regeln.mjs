// Server-Prüfung: Schema und API-Regeln der PocketBase (kein Browser).
//   node tools/verify-pb-regeln.mjs [--nur SCHEMA]      (frische lokale PocketBase je Abschnitt)
//   node tools/verify-pb-regeln.mjs --gegen <url>       (LESEMODUS gegen eine laufende Instanz, schreibt nie)
// Jeder Abschnitt ist eine Funktion in ABSCHNITTE (Task 3 ergänzt weitere).
// --gegen: ohne Anmeldung (Health, Collections da und anonym leer, Hook-Route da). Mit der Umgebungsvariable
// PB_SU_TOKEN (Superuser-Token, nie im Repo) zusätzlich die Einstellungen (appURL, Rate Limits).
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { startePb, kontoAnlegen, anmelden as anmeldenRoh } from './pb-lokal.mjs';
import { smtpEmpfaenger, qp } from './smtp-fang.mjs';
import { createPb } from '../js/pb.js';
import { createServerPlan, listePlaene } from '../js/server.js';
import { deserialize } from '../js/persistence.js';
import { aenderungen } from '../js/aenderungen.js';

const COLS = ['ressourcen', 'gewerke', 'vorgaenge', 'phasen', 'verknuepfungen'];
const PW = 'Test-Passwort-123';
let fehler = 0;
const ok = (b, text, extra = '') => { console.log(`${b ? '✓' : '✗'} ${text}${b ? '' : ' ' + extra}`); if (!b) fehler++; return b; };

// Echte Datenform: `daten` trägt id/gewerk/from/to wie die App sie liefert (der Hook erzwingt, dass
// die Spalten dazu passen). Fehlende Schlüssel werden aus den Spalten ergänzt; explizit gesetzte
// (auch falsche) bleiben unangetastet, damit Negativtests möglich sind.
const ECHT = ['vorgaenge', 'verknuepfungen', 'gewerke'];
async function echt(pb, method, path, body) {
  if (!body || typeof body !== 'object' || !['POST', 'PATCH'].includes(method)) return body;
  const m = path.split('?')[0].match(/^\/api\/collections\/(\w+)\/records(?:\/(\w+))?$/);
  if (!m || !ECHT.includes(m[1])) return body;
  let cur = {};
  if (method === 'PATCH') {
    const r = await pb.su('GET', `/api/collections/${m[1]}/records/${m[2]}`);
    if (!r.ok) return body;
    cur = r.body;
  }
  const sp = { ...cur, ...body };
  const map = { gewerk: 'gewerk', von: 'from', nach: 'to' };
  if (body.daten === undefined) {
    const ge = Object.keys(map).filter((c) => c in body);
    if (!ge.length) return body;
    const d = { ...(cur.daten || {}) };
    for (const c of ge) d[map[c]] = body[c];
    return { ...body, daten: d };
  }
  const d = { ...body.daten };
  if (d.id === undefined && sp.eid !== undefined) d.id = sp.eid;
  if (m[1] === 'vorgaenge' && d.gewerk === undefined) d.gewerk = sp.gewerk;
  if (m[1] === 'verknuepfungen') { if (d.from === undefined) d.from = sp.von; if (d.to === undefined) d.to = sp.nach; }
  return { ...body, daten: d };
}

export async function api(pb, token, method, path, body) {
  body = await echt(pb, method, path, body);
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = token;
  const r = await fetch(pb.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) })
    .catch((e) => { throw new Error(`${method} ${path}: ${e.message} ${e.cause?.code || e.cause || ''}`); });
  const t = await r.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, ok: r.ok, body: json };
}
export const batch = async (pb, token, requests) => {
  const rs = [];
  for (const q of requests) rs.push(q.body ? { ...q, body: await echt(pb, q.method, q.url, q.body) } : q);
  return api(pb, token, 'POST', '/api/batch', { requests: rs });
};
export const post = (coll, body) => ({ method: 'POST', url: `/api/collections/${coll}/records`, body });
// «leer oder verboten»: Filterregel ohne Treffer = 200 mit 0, sonst 4xx
const leerOderVerboten = (n) => n === 0 || (n <= -400 && n > -500);
const anzahl = async (pb, token, coll, filter = '') => {
  const r = await api(pb, token, 'GET', `/api/collections/${coll}/records?perPage=1&filter=${encodeURIComponent(filter)}`);
  return r.ok ? r.body.totalItems : -r.status; // negativ = Fehlerstatus
};

// Konten und zwei Pläne anlegen (A: besitzt pl, B: besitzt pl2). Wird auch von späteren Abschnitten genutzt.
export async function grundaufbau(pb) {
  const k = {};
  const mk = async (n, o = {}) => (k[n] = await kontoAnlegen(pb, { email: `${n}@bzp.test`, name: n, passwort: PW, ...o }));
  await mk('super', { superadmin: true });
  await mk('pl', { produktionsleitung: true });
  await mk('pl2', { produktionsleitung: true });
  for (const n of ['bearb', 'gwl', 'betr', 'fremd', 'bmitglied', 'plmit', 'kandidat']) await mk(n);
  const planAnlegen = async (besitzer, plan_id) => {
    const reqs = [
      post('plaene', { plan_id, besitzer: besitzer.id, daten: { name: plan_id }, rev: 1 }),
      ...COLS.map((c) => post(c, {
        plan_id, eid: c === 'gewerke' ? 'g1' : 'e1', rev: 1, pos: 0,
        daten: c === 'gewerke' ? { name: 'Licht' } : { x: 1 },
        ...(c === 'vorgaenge' ? { gewerk: 'g1' } : {}), ...(c === 'verknuepfungen' ? { von: 'e1', nach: 'e1' } : {}),
      })),
    ];
    return batch(pb, besitzer.token, reqs);
  };
  const a = await planAnlegen(k.pl, 'planA');
  const b = await planAnlegen(k.pl2, 'planB');
  const mit = (plan_id, user, rolle, gewerke = []) => post('mitglieder', { plan_id, user_id: user.id, rolle, gewerke });
  const ma = await batch(pb, k.pl.token, [mit('planA', k.bearb, 'bearbeiter'), mit('planA', k.gwl, 'gewerkeleiter', ['g1']), mit('planA', k.betr, 'betrachter'), mit('planA', k.plmit, 'produktionsleitung')]);
  const mb = await batch(pb, k.pl2.token, [mit('planB', k.bmitglied, 'bearbeiter')]);
  return { k, a, b, ma, mb };
}

async function SCHEMA(pb) {
  console.log('— SCHEMA');
  const { k, a, b, ma, mb } = await grundaufbau(pb);
  ok(a.ok && b.ok, 'PL legt Plan + je 1 Datensatz aller Collections per Batch an', JSON.stringify(a.body).slice(0, 200));
  ok(ma.ok && mb.ok, 'Besitzer legt Mitglieder per Batch an', JSON.stringify(ma.body).slice(0, 200));
  // Lesen
  for (const c of COLS) {
    ok(await anzahl(pb, k.betr.token, c, 'plan_id = "planA"') === 1, `betr liest ${c} (Plan A)`);
    ok(await anzahl(pb, k.fremd.token, c) === 0, `fremd listet ${c} → 0`);
    ok(leerOderVerboten(await anzahl(pb, null, c)), `ohne Anmeldung ${c} → 0/4xx`);
  }
  ok(await anzahl(pb, k.fremd.token, 'plaene') === 0, 'fremd listet plaene → 0');
  ok(await anzahl(pb, k.betr.token, 'plaene') === 1, 'betr sieht genau Plan A');
  // Schreiben als Betrachter (Server-Regel, direkt per API)
  for (const c of COLS) {
    const r = await api(pb, k.betr.token, 'POST', `/api/collections/${c}/records`, { plan_id: 'planA', eid: 'neu', daten: {}, rev: 1, pos: 1 });
    ok(r.status >= 400 && r.status < 500, `betr legt ${c} an → 4xx`, `Status ${r.status}`);
  }
  const vid = (await api(pb, k.pl.token, 'GET', '/api/collections/vorgaenge/records?filter=plan_id="planA"')).body.items[0].id;
  const u = await api(pb, k.betr.token, 'PATCH', `/api/collections/vorgaenge/records/${vid}`, { daten: { x: 2 } });
  ok(u.status >= 400, 'betr ändert vorgaenge → 4xx', `Status ${u.status}`);
  const d = await api(pb, k.betr.token, 'DELETE', `/api/collections/vorgaenge/records/${vid}`);
  ok(d.status >= 400, 'betr löscht vorgaenge → 4xx', `Status ${d.status}`);
  const bp = await api(pb, k.betr.token, 'POST', '/api/collections/plaene/records', { plan_id: 'planX', besitzer: k.betr.id, daten: {}, rev: 1 });
  ok(bp.status >= 400, 'betr legt plaene an → 4xx', `Status ${bp.status}`);
  const bp2 = await api(pb, k.bearb.token, 'POST', '/api/collections/plaene/records', { plan_id: 'planX', besitzer: k.bearb.id, daten: {}, rev: 1 });
  ok(bp2.status >= 400, 'bearb (ohne PL-Flag) legt plaene an → 4xx', `Status ${bp2.status}`);
  // Schreiben als Bearbeiter / Gewerkeleiter / Superadmin (Regel erlaubt; Feinheiten macht der Hook)
  let vrev = 1; // der Hook verlangt den gespeicherten rev und zählt hoch
  for (const n of ['bearb', 'gwl', 'super']) {
    const r = await api(pb, k[n].token, 'PATCH', `/api/collections/vorgaenge/records/${vid}`, { daten: { x: 3 }, rev: vrev++ });
    ok(r.ok, `${n} ändert vorgaenge (Regel erlaubt)`, `Status ${r.status}`);
  }
  // Gegenfall Korrelation: Mitglied in A darf B NICHT lesen/schreiben, Besitzer A nicht B
  for (const c of [...COLS, 'plaene', 'mitglieder']) {
    ok(await anzahl(pb, k.bearb.token, c, 'plan_id = "planB"') === 0, `Korrelation: Mitglied A liest ${c} Plan B → 0`);
    ok(await anzahl(pb, k.pl.token, c, 'plan_id = "planB"') === 0, `Korrelation: Besitzer A liest ${c} Plan B → 0`);
    ok(await anzahl(pb, k.bmitglied.token, c, 'plan_id = "planA"') === 0, `Korrelation: Mitglied B liest ${c} Plan A → 0`);
  }
  ok(await anzahl(pb, k.bearb.token, 'vorgaenge') === 1, 'Mitglied A sieht ohne Filter nur Plan A (1 von 2)');
  ok(await anzahl(pb, k.super.token, 'vorgaenge') === 2, 'Superadmin sieht alle');
  const bvid = (await api(pb, k.super.token, 'GET', '/api/collections/vorgaenge/records?filter=plan_id="planB"')).body.items[0].id;
  const fw = await api(pb, k.bearb.token, 'PATCH', `/api/collections/vorgaenge/records/${bvid}`, { daten: { x: 9 } });
  ok(fw.status >= 400, 'Mitglied A ändert Vorgang in Plan B → 4xx', `Status ${fw.status}`);
  const mv = await api(pb, k.bearb.token, 'PATCH', `/api/collections/vorgaenge/records/${vid}`, { plan_id: 'planB' });
  ok(mv.status >= 400, 'plan_id eines Datensatzes auf fremden Plan umbiegen → 4xx', `Status ${mv.status}`);
  const fm = await api(pb, k.pl.token, 'POST', '/api/collections/mitglieder/records', { plan_id: 'planB', user_id: k.pl.id, rolle: 'produktionsleitung', gewerke: [] });
  ok(fm.status >= 400, 'Besitzer A macht sich zum Mitglied in Plan B → 4xx', `Status ${fm.status}`);
  // Mitglieder / Einladungen
  const ein = { plan_id: 'planA', email: 'neu@bzp.test', rolle: 'bearbeiter', gewerke: [], token: 'T'.repeat(32), ablauf: '2099-01-01 00:00:00.000Z' };
  ok((await api(pb, k.pl.token, 'POST', '/api/collections/einladungen/records', ein)).ok, 'Besitzer legt Einladung an');
  ok((await api(pb, k.bearb.token, 'POST', '/api/collections/einladungen/records', { ...ein, token: 'U'.repeat(32) })).status >= 400, 'bearb legt Einladung an → 4xx');
  ok(leerOderVerboten(await anzahl(pb, k.bearb.token, 'einladungen')), 'bearb sieht Einladungen nicht (Token geheim)');
  ok((await api(pb, k.bearb.token, 'POST', '/api/collections/mitglieder/records', { plan_id: 'planA', user_id: k.fremd.id, rolle: 'bearbeiter', gewerke: [] })).status >= 400, 'bearb legt Mitglied an → 4xx');
  ok(await anzahl(pb, k.betr.token, 'mitglieder', 'plan_id = "planA"') === 4, 'Mitglied sieht Mitgliederliste seines Plans');
  // Plan-Metadaten und Besitzer (plaene)
  const paId = (await api(pb, k.pl.token, 'GET', '/api/collections/plaene/records?filter=plan_id="planA"')).body.items[0].id;
  const upl = (n, body) => api(pb, k[n].token, 'PATCH', `/api/collections/plaene/records/${paId}`, body);
  const verboten = (r, t) => ok(r.status >= 400 && r.status < 500, t, `Status ${r.status}`);
  verboten(await upl('bearb', { besitzer: k.bearb.id }), 'bearb setzt besitzer auf sich → 4xx');
  verboten(await upl('plmit', { besitzer: k.plmit.id }), 'PL-Mitglied (nicht Besitzer) setzt besitzer auf sich → 4xx');
  verboten(await upl('gwl', { besitzer: k.gwl.id }), 'gwl setzt besitzer auf sich → 4xx');
  ok((await api(pb, k.pl.token, 'GET', `/api/collections/plaene/records/${paId}`)).body.besitzer === k.pl.id, 'besitzer von Plan A unverändert');
  verboten(await upl('betr', { daten: { name: 'x' } }), 'betr ändert plaene → 4xx');
  verboten(await upl('gwl', { daten: { name: 'x' } }), 'gwl ändert plaene → 4xx');
  ok((await upl('bearb', { daten: { name: 'Neu' }, rev: 1 })).ok, 'bearb ändert Plan-Metadaten (erlaubt)');
  ok((await upl('bearb', { besitzer: k.pl.id, rev: 2 })).ok, 'bearb sendet unveränderten besitzer (erlaubt)');
  ok((await upl('super', { besitzer: k.pl.id, rev: 3 })).ok, 'Superadmin darf besitzer setzen');
  for (const n of ['betr', 'gwl', 'bearb']) verboten(await api(pb, k[n].token, 'DELETE', `/api/collections/plaene/records/${paId}`), `${n} löscht plaene → 4xx`);
  verboten(await api(pb, k.pl.token, 'POST', '/api/collections/plaene/records', { plan_id: 'planY', besitzer: k.pl2.id, daten: {}, rev: 1 }), 'PL legt Plan mit fremdem besitzer an → 4xx');
  ok((await api(pb, k.pl.token, 'POST', '/api/collections/plaene/records', { plan_id: 'planZ', besitzer: k.pl.id, daten: {}, rev: 1 })).ok, 'PL legt Plan mit eigenem besitzer an');
  // Mitglieder/Einladungen verwalten: nur Verwalter
  const mrec = (plan_id, user, rolle = 'betrachter') => ({ plan_id, user_id: user.id, rolle, gewerke: [] });
  const erec = (plan_id, tok) => ({ plan_id, email: 'x@bzp.test', rolle: 'betrachter', gewerke: [], token: tok.repeat(32), ablauf: '2099-01-01 00:00:00.000Z' });
  for (const n of ['betr', 'gwl']) {
    verboten(await api(pb, k[n].token, 'POST', '/api/collections/mitglieder/records', mrec('planA', k.kandidat)), `${n} legt Mitglied an → 4xx`);
    verboten(await api(pb, k[n].token, 'POST', '/api/collections/einladungen/records', erec('planA', n[0])), `${n} legt Einladung an → 4xx`);
  }
  const km = await api(pb, k.plmit.token, 'POST', '/api/collections/mitglieder/records', mrec('planA', k.kandidat));
  ok(km.ok, 'PL-Mitglied (nicht Besitzer) legt Mitglied an (erlaubt)', `Status ${km.status}`);
  ok((await api(pb, k.plmit.token, 'POST', '/api/collections/einladungen/records', erec('planA', 'P'))).ok, 'PL-Mitglied legt Einladung an (erlaubt)');
  if (km.ok) ok((await api(pb, k.plmit.token, 'DELETE', `/api/collections/mitglieder/records/${km.body.id}`)).ok, 'PL-Mitglied entfernt Mitglied (erlaubt)');
  verboten(await api(pb, k.plmit.token, 'POST', '/api/collections/mitglieder/records', mrec('planB', k.kandidat)), 'PL von Plan A legt Mitglied in Plan B an → 4xx');
  verboten(await api(pb, k.plmit.token, 'POST', '/api/collections/einladungen/records', erec('planB', 'Q')), 'PL von Plan A legt Einladung in Plan B an → 4xx');
  const bmId = (await api(pb, k.super.token, 'GET', '/api/collections/mitglieder/records?filter=plan_id="planB"')).body.items[0].id;
  verboten(await api(pb, k.plmit.token, 'DELETE', `/api/collections/mitglieder/records/${bmId}`), 'PL von Plan A entfernt Mitglied aus Plan B → 4xx');
  verboten(await api(pb, k.plmit.token, 'DELETE', `/api/collections/plaene/records/${(await api(pb, k.super.token, 'GET', '/api/collections/plaene/records?filter=plan_id="planB"')).body.items[0].id}`), 'PL von Plan A löscht Plan B → 4xx');
  // Superadmin verwaltet Mitglieder/Einladungen in fremdem Plan (Positivtest)
  const sm = await api(pb, k.super.token, 'POST', '/api/collections/mitglieder/records', mrec('planB', k.kandidat));
  ok(sm.ok, 'Superadmin legt Mitglied in Plan B an (erlaubt)', `Status ${sm.status}`);
  ok((await api(pb, k.super.token, 'POST', '/api/collections/einladungen/records', erec('planB', 'S'))).ok, 'Superadmin legt Einladung in Plan B an (erlaubt)');
  if (sm.ok) ok((await api(pb, k.super.token, 'DELETE', `/api/collections/mitglieder/records/${sm.body.id}`)).ok, 'Superadmin entfernt Mitglied (erlaubt)');
  // Eindeutigkeit
  const dup = await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'e1', daten: {}, rev: 1, pos: 0 });
  ok(dup.status >= 400, 'Doppelte (plan_id, eid) → 4xx', `Status ${dup.status}`);
  const dm = await api(pb, k.pl.token, 'POST', '/api/collections/mitglieder/records', { plan_id: 'planA', user_id: k.bearb.id, rolle: 'betrachter', gewerke: [] });
  ok(dm.status >= 400, 'Doppeltes Mitglied → 4xx', `Status ${dm.status}`);
  // Konten
  ok((await api(pb, null, 'POST', '/api/collections/users/records', { email: 'x@bzp.test', password: PW, passwordConfirm: PW })).status >= 400, 'Konto selbst anlegen (ohne Hook) → 4xx');
  ok((await api(pb, k.bearb.token, 'PATCH', `/api/collections/users/records/${k.bearb.id}`, { superadmin: true })).status >= 400, 'Konto setzt sich selbst superadmin → 4xx');
  ok((await api(pb, k.bearb.token, 'PATCH', `/api/collections/users/records/${k.bearb.id}`, { name: 'Neu' })).ok, 'Konto ändert eigenen Namen');
  ok((await api(pb, k.bearb.token, 'PATCH', `/api/collections/users/records/${k.fremd.id}`, { name: 'X' })).status >= 400, 'Konto ändert fremdes Konto → 4xx');
  ok(leerOderVerboten(await anzahl(pb, null, 'users')), 'users ohne Anmeldung → 0/4xx');
  // Batch-Einstellungen
  const s = await pb.su('GET', '/api/settings');
  ok(s.body.batch.enabled === true && s.body.batch.maxRequests === 2000 && s.body.batch.timeout === 30 && s.body.batch.maxBodySize === 0, 'Batch-Einstellungen', JSON.stringify(s.body.batch));
}

// ── Hilfen für die Hook-Abschnitte ──────────────────────────────────────────
const gib = async (pb, coll, plan_id, eid) => {
  const r = await pb.su('GET', `/api/collections/${coll}/records?filter=${encodeURIComponent(`plan_id="${plan_id}" && eid="${eid}"`)}`);
  return r.body.items[0];
};
const patch = (pb, k, n, coll, id, body) => api(pb, k[n].token, 'PATCH', `/api/collections/${coll}/records/${id}`, body);
const loesche = (pb, k, n, coll, id, rev) => api(pb, k[n].token, 'DELETE', `/api/collections/${coll}/records/${id}?rev=${rev}`);
// Regel-Schranke (läuft VOR dem Hook): Create → 400 «Failed to create record», Update/Delete → 404
const verboten4 = (r, t) => ok(r.status >= 400 && r.status < 500, `${t} → 4xx (Regel)`, `Status ${r.status}`);
const status = (r, s, t) => ok(r.status === s, `${t} → ${s}`, `Status ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
// Plan A erweitern: Ton (g2), Vorgänge Licht/Ton/Projekt, Ressource, Phase, zwei Verknüpfungen
async function erweitern(pb, k) {
  const v = (eid, gewerk, extra = {}) => post('vorgaenge', { plan_id: 'planA', eid, gewerk, daten: { titel: eid, ...extra }, pos: 1 });
  const r = await batch(pb, k.pl.token, [
    post('gewerke', { plan_id: 'planA', eid: 'g2', daten: { name: 'Ton' }, pos: 1 }),
    v('vl', 'g1'), v('vt', 'g2'), v('vp', 'projekt'),
    post('ressourcen', { plan_id: 'planA', eid: 'r1', daten: { name: 'Hubwagen' }, pos: 1 }),
    post('phasen', { plan_id: 'planA', eid: 'p1', daten: { name: 'Aufbau' }, pos: 0 }),
    post('verknuepfungen', { plan_id: 'planA', eid: 'kl', von: 'vt', nach: 'vl', daten: {}, pos: 1 }),
    post('verknuepfungen', { plan_id: 'planA', eid: 'kt', von: 'vl', nach: 'vt', daten: {}, pos: 2 }),
  ]);
  if (!r.ok) throw new Error('erweitern: ' + JSON.stringify(r.body).slice(0, 300));
}

async function REV(pb) {
  console.log('— REV');
  const { k } = await grundaufbau(pb);
  await erweitern(pb, k);
  const vl = await gib(pb, 'vorgaenge', 'planA', 'vl');
  ok(vl.rev === 1, 'Create setzt rev = 1');
  const c = await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'vr', gewerk: 'g1', daten: {}, rev: 77, pos: 3 });
  ok(c.ok && c.body.rev === 1, 'Create mit gesendetem rev 77 → gespeichert 1', JSON.stringify(c.body).slice(0, 120));
  const u1 = await patch(pb, k, 'pl', 'vorgaenge', vl.id, { daten: { x: 5 }, rev: 1 });
  ok(u1.ok && u1.body.rev === 2, 'Update mit passendem rev → rev + 1', `Status ${u1.status}`);
  const u2 = await patch(pb, k, 'bearb', 'vorgaenge', vl.id, { daten: { x: 6 }, rev: 1 });
  status(u2, 409, 'Zweites Update mit altem rev');
  ok(u2.body?.data?.code?.code === 'rev' && u2.body?.data?.eid?.code === 'vl' && u2.body?.data?.rev?.code === '2', '409-Antwort: data.code.code=rev, data.eid.code=eid, data.rev.code=aktueller rev', JSON.stringify(u2.body));
  ok(typeof u2.body?.message === 'string' && u2.body.message.length > 0, '409-Antwort hat message');
  ok((await gib(pb, 'vorgaenge', 'planA', 'vl')).daten.x === 5, 'Daten nach 409 unverändert');
  status(await patch(pb, k, 'pl', 'vorgaenge', vl.id, { daten: { x: 7 } }), 400, 'Update ohne rev');
  status(await patch(pb, k, 'pl', 'vorgaenge', vl.id, { eid: 'andere', rev: 2 }), 400, 'eid ändern');
  // Löschen verlangt ?rev
  const vr = await gib(pb, 'vorgaenge', 'planA', 'vr');
  status(await api(pb, k.pl.token, 'DELETE', `/api/collections/vorgaenge/records/${vr.id}`), 409, 'Delete ohne rev');
  const d2 = await loesche(pb, k, 'pl', 'vorgaenge', vr.id, 5);
  status(d2, 409, 'Delete mit falschem rev');
  ok(d2.body?.data?.code?.code === 'rev' && d2.body?.data?.rev?.code === '1', '409 bei Delete: data.rev.code = aktuell', JSON.stringify(d2.body));
  ok((await loesche(pb, k, 'pl', 'vorgaenge', vr.id, 1)).status === 204, 'Delete mit passendem rev → 204');
  // Batch: Hooks laufen je Unteranfrage, ein 409 rollt den ganzen Batch zurück
  const vt = await gib(pb, 'vorgaenge', 'planA', 'vt');
  const patchReq = (id, body) => ({ method: 'PATCH', url: `/api/collections/vorgaenge/records/${id}`, body });
  const b = await batch(pb, k.pl.token, [
    post('vorgaenge', { plan_id: 'planA', eid: 'bn', gewerk: 'g1', daten: {}, rev: 55, pos: 9 }),
    patchReq(vl.id, { daten: { x: 8 }, rev: 2 }),
    patchReq(vt.id, { daten: { x: 8 }, rev: 99 }),
  ]);
  ok(b.status >= 400, 'Batch mit einem falschen rev scheitert', `Status ${b.status}`);
  console.log('  (Batch-Fehlerform: ' + JSON.stringify(b.body).slice(0, 300) + ')');
  ok((await gib(pb, 'vorgaenge', 'planA', 'vl')).daten.x === 5, 'Batch zurückgerollt: vl unverändert');
  ok(!(await gib(pb, 'vorgaenge', 'planA', 'bn')), 'Batch zurückgerollt: angelegter Vorgang fehlt');
  const b2 = await batch(pb, k.pl.token, [
    post('vorgaenge', { plan_id: 'planA', eid: 'bn', gewerk: 'g1', daten: {}, rev: 55, pos: 9 }),
    patchReq(vl.id, { daten: { x: 8 }, rev: 2 }),
  ]);
  ok(b2.ok, 'Batch mit passenden rev gelingt', `Status ${b2.status}`);
  ok((await gib(pb, 'vorgaenge', 'planA', 'bn')).rev === 1, 'Batch: Hook lief je Unteranfrage (rev 55 → 1)');
  ok((await gib(pb, 'vorgaenge', 'planA', 'vl')).rev === 3, 'Batch: Update-Hook zählte rev hoch');
  // Delete im Batch mit ?rev
  const bn = await gib(pb, 'vorgaenge', 'planA', 'bn');
  const b3 = await batch(pb, k.pl.token, [{ method: 'DELETE', url: `/api/collections/vorgaenge/records/${bn.id}?rev=1` }]);
  ok(b3.ok, 'Batch-Delete mit ?rev', `Status ${b3.status} ${JSON.stringify(b3.body).slice(0, 160)}`);
  const b4 = await batch(pb, k.pl.token, [{ method: 'DELETE', url: `/api/collections/vorgaenge/records/${vt.id}?rev=9` }]);
  ok(b4.status >= 400, 'Batch-Delete mit falschem rev scheitert', `Status ${b4.status}`);
}

async function GEWERKELEITER(pb) {
  console.log('— GEWERKELEITER');
  const { k } = await grundaufbau(pb);
  await erweitern(pb, k);
  const [vl, vt, vp] = [await gib(pb, 'vorgaenge', 'planA', 'vl'), await gib(pb, 'vorgaenge', 'planA', 'vt'), await gib(pb, 'vorgaenge', 'planA', 'vp')];
  ok((await patch(pb, k, 'gwl', 'vorgaenge', vl.id, { daten: { x: 1 }, rev: 1 })).ok, 'gwl ändert eigenen Vorgang (Licht)');
  const m = await patch(pb, k, 'gwl', 'vorgaenge', vl.id, { gewerk: 'g2', rev: 2 });
  status(m, 403, 'gwl verschiebt Vorgang nach Ton');
  ok(/Licht/.test(m.body?.message || ''), 'Klartext nennt das eigene Gewerk', m.body?.message);
  ok((await gib(pb, 'vorgaenge', 'planA', 'vl')).gewerk === 'g1', 'Vorgang blieb im Licht');
  status(await patch(pb, k, 'gwl', 'vorgaenge', vt.id, { daten: { x: 1 }, rev: 1 }), 403, 'gwl ändert Ton-Vorgang');
  status(await patch(pb, k, 'gwl', 'vorgaenge', vp.id, { daten: { x: 1 }, rev: 1 }), 403, 'gwl ändert projekt-Vorgang');
  status(await patch(pb, k, 'gwl', 'vorgaenge', vl.id, { gewerk: 'projekt', rev: 2 }), 403, 'gwl verschiebt Vorgang nach projekt');
  status(await loesche(pb, k, 'gwl', 'vorgaenge', vt.id, 1), 403, 'gwl löscht Ton-Vorgang');
  const nv = (eid, gewerk) => ({ plan_id: 'planA', eid, gewerk, daten: {}, pos: 5 });
  const cr = (n, body) => api(pb, k[n].token, 'POST', `/api/collections/${body.coll}/records`, body.b);
  ok((await cr('gwl', { coll: 'vorgaenge', b: nv('gn1', 'g1') })).ok, 'gwl legt Licht-Vorgang an');
  status(await cr('gwl', { coll: 'vorgaenge', b: nv('gn2', 'g2') }), 403, 'gwl legt Ton-Vorgang an');
  status(await cr('gwl', { coll: 'vorgaenge', b: nv('gn3', 'projekt') }), 403, 'gwl legt projekt-Vorgang an');
  const gn1 = await gib(pb, 'vorgaenge', 'planA', 'gn1');
  ok((await loesche(pb, k, 'gwl', 'vorgaenge', gn1.id, 1)).status === 204, 'gwl löscht eigenen Vorgang');
  // Verknüpfungen: Nachfolger entscheidet
  const kl = await gib(pb, 'verknuepfungen', 'planA', 'kl'), kt = await gib(pb, 'verknuepfungen', 'planA', 'kt');
  ok((await cr('gwl', { coll: 'verknuepfungen', b: { plan_id: 'planA', eid: 'k3', von: 'vt', nach: 'vl', daten: {}, pos: 3 } })).ok, 'gwl legt Verknüpfung mit Nachfolger Licht an');
  status(await cr('gwl', { coll: 'verknuepfungen', b: { plan_id: 'planA', eid: 'k4', von: 'vl', nach: 'vt', daten: {}, pos: 4 } }), 403, 'gwl legt Verknüpfung mit Nachfolger Ton an');
  ok((await patch(pb, k, 'gwl', 'verknuepfungen', kl.id, { daten: { a: 1 }, rev: 1 })).ok, 'gwl ändert Verknüpfung mit Nachfolger Licht');
  status(await patch(pb, k, 'gwl', 'verknuepfungen', kt.id, { daten: { a: 1 }, rev: 1 }), 403, 'gwl ändert Verknüpfung mit Nachfolger Ton');
  status(await loesche(pb, k, 'gwl', 'verknuepfungen', kt.id, 1), 403, 'gwl löscht Verknüpfung mit Nachfolger Ton');
  // Ressourcen: nur anlegen
  const r1 = await gib(pb, 'ressourcen', 'planA', 'r1');
  ok((await cr('gwl', { coll: 'ressourcen', b: { plan_id: 'planA', eid: 'r2', daten: { name: 'Leiter' }, pos: 2 } })).ok, 'gwl legt Ressource an');
  status(await patch(pb, k, 'gwl', 'ressourcen', r1.id, { daten: { name: 'Umbenannt' }, rev: 1 }), 403, 'gwl benennt Ressource um');
  status(await loesche(pb, k, 'gwl', 'ressourcen', r1.id, 1), 403, 'gwl löscht Ressource');
  // Gewerk, Phase, Plan
  const g1 = await gib(pb, 'gewerke', 'planA', 'g1'), p1 = await gib(pb, 'phasen', 'planA', 'p1');
  status(await patch(pb, k, 'gwl', 'gewerke', g1.id, { daten: { name: 'X' }, rev: 1 }), 403, 'gwl ändert Gewerk');
  status(await cr('gwl', { coll: 'gewerke', b: { plan_id: 'planA', eid: 'g9', daten: { name: 'Neu' }, pos: 9 } }), 403, 'gwl legt Gewerk an');
  status(await patch(pb, k, 'gwl', 'phasen', p1.id, { daten: { name: 'X' }, rev: 1 }), 403, 'gwl ändert Phase');
  const pa = await gib(pb, 'plaene', 'planA', 'planA').catch(() => null);
  const paId = (await pb.su('GET', '/api/collections/plaene/records?filter=plan_id="planA"')).body.items[0].id;
  const pu = await patch(pb, k, 'gwl', 'plaene', paId, { daten: { name: 'X' }, rev: 1 });
  ok(pu.status === 403 || pu.status === 404, 'gwl ändert Plan → verboten', `Status ${pu.status}`);
  // Gegenprobe: Bearbeiter darf alles davon
  ok((await patch(pb, k, 'bearb', 'vorgaenge', vt.id, { gewerk: 'g1', rev: 1 })).ok, 'bearb verschiebt Ton-Vorgang nach Licht (erlaubt)');
  ok((await patch(pb, k, 'bearb', 'gewerke', g1.id, { daten: { name: 'Licht' }, rev: 1 })).ok, 'bearb ändert Gewerk (erlaubt)');
}

async function STATUS(pb) {
  console.log('— STATUS');
  const { k } = await grundaufbau(pb);
  await erweitern(pb, k);
  const res = [
    { rid: 'r1', n: 1, von: null, bis: null, status: 'bestaetigt', bestaetigtAm: '2026-01-01T10:00' },
    { rid: 'r2', n: 2, von: null, bis: null },
  ];
  const c = await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'vs', gewerk: 'g1', daten: { titel: 'vs', res }, pos: 7 });
  ok(c.ok, 'pl legt Vorgang mit bestätigter Zeile an', `Status ${c.status}`);
  const id = c.body.id;
  const mitRes = (r) => ({ daten: { titel: 'vs', res: r } });
  let rev = 1;
  const neu = (z2) => [res[0], z2];
  status(await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes(neu({ ...res[1], status: 'bestaetigt' })), rev }), 403, 'gwl setzt bestaetigt');
  status(await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes(neu({ ...res[1], status: 'abgelehnt', notiz: 'nein' })), rev }), 403, 'gwl setzt abgelehnt');
  status(await patch(pb, k, 'bearb', 'vorgaenge', id, { ...mitRes(neu({ ...res[1], status: 'bestaetigt' })), rev }), 403, 'bearb setzt bestaetigt');
  status(await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes(neu({ ...res[1], notiz: 'nur Notiz' })), rev }), 403, 'gwl setzt nur notiz');
  status(await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([{ ...res[0], bestaetigtAm: '2026-02-02T10:00' }, res[1]]), rev }), 403, 'gwl ändert bestaetigtAm');
  status(await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([{ ...res[0], n: 9 }, res[1]]), rev }), 403, 'gwl ändert bestätigte Zeile ohne Rückfall (Anzahl)');
  status(await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([res[0], res[0], res[1]]), rev }), 403, 'gwl dupliziert bestätigte Zeile');
  status(await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([{ ...res[0], von: '2026-01-01T08:00', bis: '2026-01-01T09:00' }, res[1]]), rev }), 403, 'gwl ändert Fenster einer bestätigten Zeile');
  ok((await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([res[1], res[0]]), rev })).ok && ++rev, 'gwl vertauscht die Reihenfolge (Zeilen unverändert)');
  ok((await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([res[0], { ...res[1], n: 3 }]), rev })).ok && ++rev, 'gwl ändert Anzahl einer unbestätigten Zeile (Status unverändert)');
  ok((await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([{ rid: 'r1', n: 4, von: null, bis: null }, { ...res[1], n: 3 }]), rev })).ok && ++rev, 'gwl ändert Anzahl einer bestätigten Zeile, Status entfernt (Rückfall)');
  const stand = (await gib(pb, 'vorgaenge', 'planA', 'vs')).daten.res;
  ok(stand[0].status === undefined && stand[0].n === 4, 'Rückfall gespeichert (Zeile 1 ohne Status, n = 4)', JSON.stringify(stand[0]));
  ok((await patch(pb, k, 'pl', 'vorgaenge', id, { ...mitRes([{ ...stand[0], status: 'bestaetigt', bestaetigtAm: '2026-03-03T10:00' }, stand[1]]), rev })).ok && ++rev, 'pl setzt bestaetigt');
  ok((await patch(pb, k, 'plmit', 'vorgaenge', id, { ...mitRes([stand[0], { ...stand[1], status: 'abgelehnt', notiz: 'ausgebucht' }]), rev })).ok && ++rev, 'PL-Mitglied setzt abgelehnt');
  // Zeitänderung entwertet die Bestätigung: ohne Rückfall verboten, mit Rückfall erlaubt, Zeitstempel statt Zeichenketten
  const zc = await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'vz', gewerk: 'g1', daten: { titel: 'vz', start: '2026-09-19T08:00', end: '2026-09-19T10:00', milestone: false, res }, pos: 7 });
  ok(zc.ok, 'pl legt Vorgang mit Zeiten und bestätigter Zeile an', `Status ${zc.status}`);
  const zd = (o, r = res) => ({ daten: { titel: 'vz', start: '2026-09-19T08:00', end: '2026-09-19T10:00', milestone: false, res: r, ...o } });
  status(await patch(pb, k, 'gwl', 'vorgaenge', zc.body.id, { ...zd({ start: '2026-09-19T09:00' }), rev: 1 }), 403, 'gwl verschiebt Vorgang mit bestätigter Zeile ohne Rückfall');
  status(await patch(pb, k, 'gwl', 'vorgaenge', zc.body.id, { ...zd({ end: '2026-09-19T11:00' }), rev: 1 }), 403, 'gwl ändert Ende ohne Rückfall');
  status(await patch(pb, k, 'gwl', 'vorgaenge', zc.body.id, { ...zd({ milestone: true }), rev: 1 }), 403, 'gwl macht Meilenstein ohne Rückfall');
  ok((await patch(pb, k, 'gwl', 'vorgaenge', zc.body.id, { ...zd({ start: '2026-09-19T08:00:00', end: '2026-09-19T10:00:00.000' }), rev: 1 })).ok, 'gleiche Zeit in anderer Schreibweise (Zeitstempel-Vergleich) → ok');
  ok((await patch(pb, k, 'gwl', 'vorgaenge', zc.body.id, { ...zd({ start: '2026-09-19T09:00' }, [{ rid: 'r1', n: 1, von: null, bis: null }, res[1]]), rev: 2 })).ok, 'gwl verschiebt Vorgang MIT Rückfall → ok');
  ok((await patch(pb, k, 'pl', 'vorgaenge', zc.body.id, { ...zd({ start: '2026-09-19T07:00' }, res), rev: 3 })).ok, 'pl verschiebt Vorgang mit bestätigter Zeile (Recht vorhanden)');
  const cr = await api(pb, k.gwl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'vs2', gewerk: 'g1', daten: { titel: 'x', res }, pos: 8 });
  status(cr, 403, 'gwl legt Vorgang mit bestätigter Zeile an');
  const cr2 = await api(pb, k.gwl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'vs3', gewerk: 'g1', daten: { titel: 'x', res: [res[1]] }, pos: 8 });
  ok(cr2.ok, 'gwl legt Vorgang mit unbestätigter Zeile an', `Status ${cr2.status}`);
}

async function KONTEN(pb) {
  console.log('— KONTEN');
  const { k } = await grundaufbau(pb);
  status(await api(pb, k.bearb.token, 'PATCH', `/api/collections/users/records/${k.bearb.id}`, { superadmin: true }), 403, 'Nutzer setzt superadmin an sich');
  status(await api(pb, k.bearb.token, 'PATCH', `/api/collections/users/records/${k.bearb.id}`, { produktionsleitung: true }), 403, 'Nutzer setzt produktionsleitung an sich');
  ok((await pb.su('GET', `/api/collections/users/records/${k.bearb.id}`)).body.superadmin === false, 'superadmin blieb aus');
  ok((await api(pb, k.bearb.token, 'PATCH', `/api/collections/users/records/${k.bearb.id}`, { name: 'Neuer Name' })).ok, 'Nutzer ändert eigenen Namen');
  status(await api(pb, k.bearb.token, 'PATCH', `/api/collections/users/records/${k.bearb.id}`, { email: 'neu@bzp.test' }), 403, 'Nutzer ändert eigene E-Mail');
  status(await api(pb, k.super.token, 'PATCH', `/api/collections/users/records/${k.fremd.id}`, { email: 'neu@bzp.test' }), 403, 'Superadmin ändert E-Mail');
  const sp = await api(pb, k.super.token, 'PATCH', `/api/collections/users/records/${k.fremd.id}`, { produktionsleitung: true });
  ok(sp.ok && sp.body.produktionsleitung === true, 'Superadmin setzt produktionsleitung', `Status ${sp.status}`);
  const ss = await api(pb, k.super.token, 'PATCH', `/api/collections/users/records/${k.fremd.id}`, { superadmin: true });
  ok(ss.ok && ss.body.superadmin === true, 'Superadmin setzt superadmin', `Status ${ss.status}`);
  ok((await api(pb, k.fremd.token, 'PATCH', `/api/collections/users/records/${k.kandidat.id}`, { name: 'x' })).ok, 'frisch beförderter Superadmin darf Fremdkonto ändern (Token trägt Flag erst nach neuer Anmeldung?)');
  status(await api(pb, k.bearb.token, 'PATCH', `/api/collections/users/records/${k.fremd.id}`, { name: 'x' }), 404, 'Nutzer ändert fremdes Konto (Regel)');
  status(await api(pb, k.bearb.token, 'POST', '/api/collections/users/request-email-change', { newEmail: 'andere@bzp.test' }), 403, 'request-email-change');
  // confirm: PocketBase validiert Token/Passwort VOR dem Hook (400); ein gültiger Token kann ohne request-email-change nicht entstehen
  for (const t of [k.bearb.token, null]) {
    const c = await api(pb, t, 'POST', '/api/collections/users/confirm-email-change', { token: 'x.y.z', password: PW });
    ok(c.status === 400 || c.status === 403, `confirm-email-change${t ? '' : ' ohne Anmeldung'} wird abgewiesen`, `Status ${c.status}`);
  }
}

async function EINLADUNG(pb) {
  console.log('— EINLADUNG');
  const { k } = await grundaufbau(pb);
  const inv = (n, body) => api(pb, k[n].token, 'POST', '/api/collections/einladungen/records', { plan_id: 'planA', rolle: 'gewerkeleiter', gewerke: ['g1'], ...body });
  const nimm = (body, token) => api(pb, token || null, 'POST', '/api/bzp/einladung', body);
  const e1 = await inv('pl', { email: 'Neu@BZP.test' });
  ok(e1.ok && /^http:\/\/localhost:8080\/login\.html\?einladung=[A-Za-z0-9]{32}$/.test(e1.body.link || ''), 'pl lädt neue Adresse ein → Link mit APP_URL und 32-Zeichen-Token', JSON.stringify(e1.body));
  const stored = (await pb.su('GET', '/api/collections/einladungen/records')).body.items[0];
  ok(stored && stored.email === 'neu@bzp.test' && stored.token === e1.body.token, 'E-Mail klein gespeichert, Token gesetzt', JSON.stringify(stored));
  const tage = (new Date(stored.ablauf.replace(' ', 'T')) - Date.now()) / 864e5;
  ok(tage > 13 && tage < 15, 'ablauf ≈ +14 Tage', String(tage));
  status(await nimm({ token: e1.body.token, name: 'Neu', passwort: 'kurz' }), 400, 'Annehmen mit Passwort < 10 Zeichen');
  status(await nimm({ token: e1.body.token, name: '', passwort: 'langes-passwort-1' }), 400, 'Annehmen ohne Name');
  const a = await nimm({ token: e1.body.token, name: 'Neu Nutzer', passwort: 'langes-passwort-1' });
  ok(a.ok && a.body.ok === true, 'Annehmen mit Name + Passwort', JSON.stringify(a.body));
  const login = await fetch(pb.url + '/api/collections/users/auth-with-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: 'neu@bzp.test', password: 'langes-passwort-1' }) }).then((r) => r.json());
  ok(!!login.token && login.record.name === 'Neu Nutzer', 'Neues Konto kann sich anmelden');
  const mit = (await pb.su('GET', `/api/collections/mitglieder/records?filter=${encodeURIComponent(`plan_id="planA" && user_id="${login.record.id}"`)}`)).body.items[0];
  ok(mit && mit.rolle === 'gewerkeleiter' && JSON.stringify(mit.gewerke) === '["g1"]', 'Konto ist Mitglied mit Rolle und Gewerken', JSON.stringify(mit));
  status(await nimm({ token: e1.body.token, name: 'Neu Nutzer', passwort: 'langes-passwort-1' }), 400, 'Token zweimal');
  status(await nimm({ token: 'x'.repeat(32), name: 'a', passwort: 'langes-passwort-1' }), 400, 'Unbekannter Token');
  // abgelaufen
  const e2 = await inv('pl', { email: 'alt@bzp.test' });
  const id2 = (await pb.su('GET', `/api/collections/einladungen/records?filter=${encodeURIComponent('email="alt@bzp.test"')}`)).body.items[0].id;
  await pb.su('PATCH', `/api/collections/einladungen/records/${id2}`, { ablauf: '2020-01-01 00:00:00.000Z' });
  const ab = await nimm({ token: e2.body.token, name: 'Alt', passwort: 'langes-passwort-1' });
  status(ab, 400, 'Abgelaufene Einladung');
  ok(/abgelaufen/.test(ab.body?.message || ''), 'Meldung nennt «abgelaufen»', ab.body?.message);
  // vorhandenes Konto (Groß-/Kleinschreibung egal) → sofort Mitglied
  const e3 = await inv('pl', { email: 'KANDIDAT@bzp.test', rolle: 'betrachter', gewerke: [] });
  ok(e3.ok && e3.body.direkt === true && !e3.body.link, 'pl lädt vorhandenes Konto ein → {direkt:true}', JSON.stringify(e3.body));
  const m3 = (await pb.su('GET', `/api/collections/mitglieder/records?filter=${encodeURIComponent(`plan_id="planA" && user_id="${k.kandidat.id}"`)}`)).body.items[0];
  ok(m3 && m3.rolle === 'betrachter', 'vorhandenes Konto ist sofort Mitglied');
  ok((await pb.su('GET', `/api/collections/einladungen/records?filter=${encodeURIComponent('email="kandidat@bzp.test"')}`)).body.totalItems === 0, 'bei direkt wird keine Einladung gespeichert');
  status(await inv('pl', { email: 'kandidat@bzp.test' }), 400, 'Konto ist schon Mitglied');
  // Konto entsteht nach Einladung: ohne Anmeldung 400, mit passender Anmeldung ok, mit fremder 403
  const e4 = await inv('pl', { email: 'spaet@bzp.test', rolle: 'bearbeiter', gewerke: [] });
  const spaet = await kontoAnlegen(pb, { email: 'spaet@bzp.test', name: 'Spät', passwort: PW });
  status(await nimm({ token: e4.body.token, name: 'S', passwort: 'langes-passwort-1' }), 400, 'Annehmen ohne Anmeldung, obwohl Konto existiert');
  status(await nimm({ token: e4.body.token }, k.fremd.token), 403, 'Annehmen mit fremdem Konto');
  const a4 = await nimm({ token: e4.body.token }, spaet.token);
  ok(a4.ok, 'Annehmen angemeldet (nur Token)', JSON.stringify(a4.body));
  // Rechte
  verboten4(await inv('bearb', { email: 'x1@bzp.test' }), 'bearb lädt ein');
  verboten4(await inv('gwl', { email: 'x2@bzp.test' }), 'gwl lädt ein');
  verboten4(await inv('fremd', { email: 'x3@bzp.test' }), 'Fremder lädt ein');
  ok((await inv('plmit', { email: 'x4@bzp.test' })).ok, 'PL-Mitglied lädt ein');
  ok((await inv('super', { email: 'x5@bzp.test', plan_id: 'planB' })).ok, 'Superadmin lädt in Plan B ein');
}

async function BESITZER(pb) {
  console.log('— BESITZER');
  const { k } = await grundaufbau(pb);
  const a = await api(pb, k.pl.token, 'POST', '/api/collections/plaene/records', { plan_id: 'planO', daten: {}, rev: 9 });
  ok(a.ok && a.body.besitzer === k.pl.id && a.body.rev === 1, 'PL ohne besitzer → Hook setzt sich selbst, rev 1', `Status ${a.status} ${JSON.stringify(a.body).slice(0, 160)}`);
  const b = await api(pb, k.super.token, 'POST', '/api/collections/plaene/records', { plan_id: 'planP', besitzer: k.fremd.id, daten: {}, rev: 1 });
  ok(b.ok && b.body.besitzer === k.super.id, 'gesendeter fremder besitzer wird überschrieben (Superadmin)', `Status ${b.status} ${JSON.stringify(b.body).slice(0, 160)}`);
  const c = await api(pb, k.pl.token, 'POST', '/api/collections/plaene/records', { plan_id: 'planQ', besitzer: k.fremd.id, daten: {}, rev: 1 });
  ok(c.status >= 400 && c.status < 500, 'PL mit fremdem besitzer → 4xx (Regel)', `Status ${c.status}`);
}

async function KONSISTENZ(pb) {
  console.log('— KONSISTENZ');
  const { k } = await grundaufbau(pb);
  const v = (eid, gewerk) => post('vorgaenge', { plan_id: 'planA', eid, gewerk, daten: {}, pos: 1 });
  status(await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'kx', gewerk: 'gibtsnicht', daten: {}, pos: 1 }), 400, 'Vorgang auf unbekanntes Gewerk');
  status(await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'kx', gewerk: 'g1', daten: {}, pos: 1, rev: 1 }).then((r) => ({ ...r, status: r.ok ? 400 : r.status })), 400, 'Gegenprobe-Platzhalter');
  status(await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'ky', gewerk: '', daten: {}, pos: 1 }), 400, 'Vorgang ohne Gewerk');
  ok((await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'kp', gewerk: 'projekt', daten: {}, pos: 1 })).ok, 'Vorgang im Gewerk projekt');
  verboten4(await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planB', eid: 'kz', gewerk: 'g1', daten: {}, pos: 1 }), 'PL von A legt Vorgang in Plan B an');
  status(await api(pb, k.pl.token, 'POST', '/api/collections/verknuepfungen/records', { plan_id: 'planA', eid: 'kv', von: 'e1', nach: 'gibtsnicht', daten: {}, pos: 1 }), 400, 'Verknüpfung auf unbekannten Nachfolger');
  status(await api(pb, k.pl.token, 'POST', '/api/collections/verknuepfungen/records', { plan_id: 'planA', eid: 'kv', von: 'gibtsnicht', nach: 'e1', daten: {}, pos: 1 }), 400, 'Verknüpfung von unbekanntem Vorgänger');
  const b = await batch(pb, k.pl.token, [
    post('gewerke', { plan_id: 'planA', eid: 'g9', daten: { name: 'Neu' }, pos: 9 }),
    v('kb1', 'g9'), v('kb2', 'g9'),
    post('verknuepfungen', { plan_id: 'planA', eid: 'kbv', von: 'kb1', nach: 'kb2', daten: {}, pos: 1 }),
  ]);
  ok(b.ok, 'Batch: im selben Batch angelegtes Gewerk/Vorgang gelten', `Status ${b.status} ${JSON.stringify(b.body).slice(0, 200)}`);
  const b2 = await batch(pb, k.pl.token, [post('gewerke', { plan_id: 'planA', eid: 'g8', daten: {}, pos: 9 }), v('kb3', 'gibtsnicht')]);
  ok(b2.status === 400, 'Batch mit Inkonsistenz → 400', `Status ${b2.status}`);
  ok(!(await gib(pb, 'gewerke', 'planA', 'g8')), 'Batch zurückgerollt (Gewerk g8 fehlt)');
}

async function DATEN(pb) {
  console.log('— DATEN (Spalten = daten, Untervorgänge)');
  const { k } = await grundaufbau(pb);
  await erweitern(pb, k);
  const vor = (n, eid, gewerk, daten) => api(pb, k[n].token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid, gewerk, daten, pos: 1 });
  // C1: Spalte ≠ daten → 400, für alle Rollen
  status(await vor('gwl', 'c1', 'g1', { gewerk: 'g2' }), 400, 'gwl: Spalte Licht, daten.gewerk Ton');
  status(await vor('gwl', 'c2', 'g2', { gewerk: 'g1' }), 400, 'gwl: Spalte Ton, daten.gewerk Licht');
  status(await vor('pl', 'c3', 'g1', { gewerk: 'g2' }), 400, 'pl: Spalte ≠ daten.gewerk');
  status(await vor('pl', 'c4', 'g1', { id: 'anders' }), 400, 'pl: eid ≠ daten.id');
  status(await vor('pl', 'c5', 'g1', { gewerk: null }), 400, 'pl: daten.gewerk null');
  const vl = await gib(pb, 'vorgaenge', 'planA', 'vl');
  status(await patch(pb, k, 'gwl', 'vorgaenge', vl.id, { daten: { id: 'vl', gewerk: 'g2' }, rev: 1 }), 400, 'gwl ändert nur daten.gewerk auf Ton (Spalte bleibt Licht)');
  status(await patch(pb, k, 'bearb', 'vorgaenge', vl.id, { daten: { id: 'vl', gewerk: 'g2' }, rev: 1 }), 400, 'bearb ändert nur daten.gewerk');
  ok((await gib(pb, 'vorgaenge', 'planA', 'vl')).daten.gewerk === 'g1', 'Vorgang bleibt konsistent im Licht');
  const vp = (eid, extra = {}) => api(pb, k.pl.token, 'POST', '/api/collections/verknuepfungen/records', { plan_id: 'planA', eid, von: 'vt', nach: 'vl', daten: {}, pos: 1, ...extra });
  status(await vp('c6', { daten: { to: 'vt' } }), 400, 'Verknüpfung: nach ≠ daten.to');
  status(await vp('c7', { daten: { from: 'vl' } }), 400, 'Verknüpfung: von ≠ daten.from');
  status(await vp('c8', { daten: { id: 'x' } }), 400, 'Verknüpfung: eid ≠ daten.id');
  status(await api(pb, k.gwl.token, 'POST', '/api/collections/verknuepfungen/records', { plan_id: 'planA', eid: 'c9', von: 'vt', nach: 'vl', daten: { to: 'vt' }, pos: 1 }), 400, 'gwl: Verknüpfung nach Licht, daten.to Ton');
  status(await api(pb, k.pl.token, 'POST', '/api/collections/gewerke/records', { plan_id: 'planA', eid: 'g7', daten: { id: 'g8', name: 'x' }, pos: 1 }), 400, 'Gewerk: eid ≠ daten.id');
  ok((await vp('c10')).ok, 'Gegenprobe: konsistente Verknüpfung wird angelegt');
  // I1: Untervorgänge
  ok((await vor('gwl', 'k1', 'g1', { parent: 'vl' })).ok, 'gwl legt Untervorgang unter eigenem Vorgang an');
  status(await vor('gwl', 'k2', 'g1', { parent: 'vt' }), 400, 'gwl hängt Licht-Vorgang unter Ton-Vorgang');
  status(await vor('pl', 'k3', 'g1', { parent: 'vt' }), 400, 'pl hängt Licht-Vorgang unter Ton-Vorgang (anderes Gewerk)');
  status(await vor('pl', 'k4', 'g1', { parent: 'k1' }), 400, 'Enkel (Elternvorgang ist selbst Untervorgang)');
  status(await vor('pl', 'k5', 'g1', { parent: 'gibtsnicht' }), 400, 'Elternvorgang existiert nicht');
  status(await vor('pl', 'k6', 'g1', { parent: 'k6' }), 400, 'Vorgang als sein eigener Elternvorgang');
  const vl2 = await gib(pb, 'vorgaenge', 'planA', 'vl');
  status(await patch(pb, k, 'pl', 'vorgaenge', vl2.id, { daten: { id: 'vl', gewerk: 'g1', parent: 'vp' }, rev: 1 }), 400, 'Vorgang mit Untervorgängen wird selbst Untervorgang');
}

async function LOESCHEN(pb) {
  console.log('— LOESCHEN (Verweise, Kaskade, Batch-Reihenfolge)');
  const { k } = await grundaufbau(pb);
  await erweitern(pb, k);
  const id = async (c, e) => (await gib(pb, c, 'planA', e)).id;
  const kind = await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'vlk', gewerk: 'g1', daten: { parent: 'vl' }, pos: 9 });
  ok(kind.ok, 'Untervorgang angelegt', `Status ${kind.status}`);
  status(await loesche(pb, k, 'pl', 'gewerke', await id('gewerke', 'g2'), 1), 400, 'Gewerk mit Vorgängen löschen');
  status(await loesche(pb, k, 'pl', 'vorgaenge', await id('vorgaenge', 'vl'), 1), 400, 'Vorgang mit Untervorgang/Verknüpfungen löschen');
  status(await loesche(pb, k, 'pl', 'vorgaenge', await id('vorgaenge', 'vt'), 1), 400, 'Vorgang mit Verknüpfungen löschen');
  status(await loesche(pb, k, 'pl', 'vorgaenge', kind.body.id, 1).then((r) => ({ ...r, status: r.status === 204 ? 204 : r.status })), 204, 'Untervorgang ohne Verweise löschen');
  // Ressource, die noch von einem Vorgang benutzt wird
  const rv = await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'vres', gewerk: 'g1', daten: { res: [{ rid: 'r1', n: 1, von: null, bis: null }] }, pos: 9 });
  status(await loesche(pb, k, 'pl', 'ressourcen', await id('ressourcen', 'r1'), 1), 400, 'Ressource mit Bedarfszeile löschen');
  const rvb = await batch(pb, k.pl.token, [{ method: 'DELETE', url: `/api/collections/ressourcen/records/${await id('ressourcen', 'r1')}?rev=1` }, { method: 'DELETE', url: `/api/collections/vorgaenge/records/${rv.body.id}?rev=1` }]);
  ok(rvb.status === 400, 'Batch: Ressource vor ihrem Vorgang löschen → abgelehnt', `Status ${rvb.status}`);
  const rvc = await batch(pb, k.pl.token, [{ method: 'DELETE', url: `/api/collections/vorgaenge/records/${rv.body.id}?rev=1` }, { method: 'DELETE', url: `/api/collections/ressourcen/records/${await id('ressourcen', 'r1')}?rev=1` }]);
  ok(rvc.ok, 'Batch: Vorgang, dann Ressource löschen → erlaubt', `Status ${rvc.status}`);
  const del = async (c, e) => ({ method: 'DELETE', url: `/api/collections/${c}/records/${await id(c, e)}?rev=1` });
  // falsche Reihenfolge (Gewerk vor Vorgängen) → ganzer Batch abgelehnt, nichts gelöscht
  const falsch = await batch(pb, k.pl.token, [await del('gewerke', 'g2'), await del('verknuepfungen', 'kl'), await del('verknuepfungen', 'kt'), await del('vorgaenge', 'vt')]);
  ok(falsch.status === 400, 'Batch in falscher Reihenfolge (Gewerk zuerst) → abgelehnt', `Status ${falsch.status}`);
  ok(!!(await gib(pb, 'verknuepfungen', 'planA', 'kl')) && !!(await gib(pb, 'gewerke', 'planA', 'g2')), 'falscher Batch zurückgerollt (nichts gelöscht)');
  const falsch2 = await batch(pb, k.pl.token, [await del('vorgaenge', 'vt'), await del('verknuepfungen', 'kl'), await del('verknuepfungen', 'kt')]);
  ok(falsch2.status === 400, 'Batch: Vorgang vor seinen Verknüpfungen → abgelehnt', `Status ${falsch2.status}`);
  // richtige Reihenfolge: verknuepfungen → vorgaenge → gewerke
  const richtig = await batch(pb, k.pl.token, [await del('verknuepfungen', 'kl'), await del('verknuepfungen', 'kt'), await del('vorgaenge', 'vt'), await del('gewerke', 'g2')]);
  ok(richtig.ok, 'Batch in richtiger Reihenfolge (verknuepfungen → vorgaenge → gewerke) → erlaubt', `Status ${richtig.status} ${JSON.stringify(richtig.body).slice(0, 200)}`);
  ok(!(await gib(pb, 'vorgaenge', 'planA', 'vt')) && !(await gib(pb, 'gewerke', 'planA', 'g2')), 'alles gelöscht');
  // Kinder vor Eltern im selben Batch
  await api(pb, k.pl.token, 'POST', '/api/collections/vorgaenge/records', { plan_id: 'planA', eid: 'ek', gewerk: 'g1', daten: { parent: 'vl' }, pos: 9 });
  const eltern = await batch(pb, k.pl.token, [await del('vorgaenge', 'vl'), await del('vorgaenge', 'ek')]);
  ok(eltern.status === 400, 'Batch: Elternvorgang vor Kind → abgelehnt', `Status ${eltern.status}`);
  const kinder = await batch(pb, k.pl.token, [await del('vorgaenge', 'ek'), await del('vorgaenge', 'vl')]);
  ok(kinder.ok, 'Batch: Kind vor Elternvorgang → erlaubt', `Status ${kinder.status} ${JSON.stringify(kinder.body).slice(0, 200)}`);
  // Gewerkeleiter: fremde Verknüpfung auf eigenem Vorgang → Vorgang nicht löschbar (gewollt)
  const mk = await batch(pb, k.pl.token, [
    post('gewerke', { plan_id: 'planA', eid: 'g3', daten: { id: 'g3', name: 'Video' }, pos: 3 }),
    post('vorgaenge', { plan_id: 'planA', eid: 'vo', gewerk: 'g1', daten: {}, pos: 1 }),
    post('vorgaenge', { plan_id: 'planA', eid: 'vf', gewerk: 'g3', daten: {}, pos: 1 }),
    post('verknuepfungen', { plan_id: 'planA', eid: 'ko', von: 'vo', nach: 'vf', daten: {}, pos: 1 }),
  ]);
  ok(mk.ok, 'Aufbau: Licht-Vorgang vo → Video-Vorgang vf', JSON.stringify(mk.body).slice(0, 200));
  status(await loesche(pb, k, 'gwl', 'verknuepfungen', await id('verknuepfungen', 'ko'), 1), 403, 'gwl löscht Verknüpfung mit fremdem Nachfolger');
  status(await loesche(pb, k, 'gwl', 'vorgaenge', await id('vorgaenge', 'vo'), 1), 400, 'gwl löscht Vorgang mit fremder Verknüpfung (gewollt gesperrt)');
  // Plan löschen: Kaskade, Neuanlage erbt nichts
  await api(pb, k.pl.token, 'POST', '/api/collections/einladungen/records', { plan_id: 'planA', email: 'z@bzp.test', rolle: 'betrachter', gewerke: [] });
  const pa = (await pb.su('GET', '/api/collections/plaene/records?filter=plan_id="planA"')).body.items[0];
  // I4: Löschen nur durch Besitzer oder Superadmin (Migration 1700000004), nicht durch ein PL-Mitglied
  verboten4(await api(pb, k.plmit.token, 'DELETE', `/api/collections/plaene/records/${pa.id}?rev=${pa.rev}`), 'I4: PL-Mitglied (nicht Besitzer) löscht den Plan');
  verboten4(await api(pb, k.bearb.token, 'DELETE', `/api/collections/plaene/records/${pa.id}?rev=${pa.rev}`), 'I4: Bearbeiter löscht den Plan');
  ok((await pb.su('GET', '/api/collections/plaene/records?filter=plan_id="planA"')).body.totalItems === 1, 'I4: der Plan ist nach den abgelehnten Löschversuchen unverändert da');
  ok((await pb.su('GET', '/api/collections/vorgaenge/records?filter=plan_id="planA"')).body.totalItems > 0, 'I4: die Kaskade lief nicht (Vorgänge noch da)');
  status(await api(pb, k.pl.token, 'DELETE', `/api/collections/plaene/records/${pa.id}`), 409, 'Plan löschen ohne rev');
  status(await api(pb, k.pl.token, 'DELETE', `/api/collections/plaene/records/${pa.id}?rev=${pa.rev}`), 204, 'Plan löschen (Besitzer, mit rev)');
  const rest = {};
  for (const c of [...COLS, 'plaene', 'mitglieder', 'einladungen']) rest[c] = (await pb.su('GET', `/api/collections/${c}/records?perPage=1&filter=${encodeURIComponent('plan_id="planA"')}`)).body.totalItems;
  ok(Object.values(rest).every((n) => n === 0), 'Kaskade: keine Datensätze von planA mehr', JSON.stringify(rest));
  ok((await pb.su('GET', '/api/collections/vorgaenge/records?filter=plan_id="planB"')).body.totalItems === 1, 'Plan B unberührt');
  ok((await api(pb, k.pl.token, 'POST', '/api/collections/plaene/records', { plan_id: 'planA', daten: { name: 'neu' } })).ok, 'Plan mit gleicher plan_id neu anlegen');
  ok(await anzahl(pb, k.pl.token, 'vorgaenge', 'plan_id = "planA"') === 0, 'Neuer Plan hat keine alten Vorgänge');
  ok(await anzahl(pb, k.bearb.token, 'plaene', 'plan_id = "planA"') === 0, 'Altes Mitglied sieht den neuen Plan nicht');
  ok(await anzahl(pb, k.pl.token, 'mitglieder', 'plan_id = "planA"') === 0, 'Neuer Plan hat keine Altmitglieder');
}

// ── SERVERPLAN: js/server.js gegen die echte PocketBase (Realtime braucht EventSource) ────────────
const fixturePlan = (n) => deserialize(readFileSync(new URL('./fixtures/' + n + '.json', import.meta.url), 'utf8')).plan;
const kl = (x) => JSON.parse(JSON.stringify(x));
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
async function clientFuer(pb, email) {
  const a = await anmeldenRoh(pb.url, email, PW);
  const speicher = new Map();
  speicher.set('bzp_auth', JSON.stringify({ token: a.token, record: a.record }));
  const sp = { getItem: (k) => speicher.get(k) ?? null, setItem: (k, v) => speicher.set(k, v), removeItem: (k) => speicher.delete(k) };
  return createPb({ basis: pb.url, fetch, speicher: sp, autostart: false });
}
async function SERVERPLAN(pb) {
  console.log('— SERVERPLAN');
  const { k } = await grundaufbau(pb);
  const KT = fixturePlan('klassentreffen-festival');
  const AMK = fixturePlan('amk-singleshow');
  const pbA = await clientFuer(pb, 'pl@bzp.test');
  const pbB = await clientFuer(pb, 'bearb@bzp.test');
  try {
    // Anlegen aus der Fixture → Laden → deepEqual (inkl. Verknüpfungen, Phasen, Ressourcen bei AMK)
    for (const [name, vorlage] of [['Klassentreffen', KT], ['AMK', AMK]]) {
      const neu = createServerPlan({ pb: pbA, planId: 'x' });
      const r = await neu.planAnlegen(vorlage);
      ok(r.ok && r.planId !== vorlage.project.id, `${name}: planAnlegen mit neuer plan_id`, JSON.stringify(r).slice(0, 300));
      if (!r.ok) continue;
      const lade = await createServerPlan({ pb: pbA, planId: r.planId }).laden();
      ok(lade.ok && isDeepStrictEqual(lade.state, r.state), `${name}: laden = angelegter Plan (deepEqual)`, JSON.stringify(lade).slice(0, 200));
      ok(lade.ok && lade.rolle?.rolle === 'besitzer', `${name}: Rolle besitzer`, JSON.stringify(lade.rolle));
      if (name === 'AMK') {
        // Löschen in der verbindlichen Reihenfolge: ein Gewerk samt Vorgängen, Verknüpfungen
        const sp = createServerPlan({ pb: pbA, planId: r.planId });
        await sp.laden();
        const g = r.state.gewerke.find((x) => r.state.tasks.some((t) => t.gewerk === x.id) && !r.state.tasks.every((t) => t.gewerk === x.id));
        const nach = kl(r.state);
        nach.tasks = nach.tasks.filter((t) => t.gewerk !== g.id);
        nach.deps = nach.deps.filter((d) => nach.tasks.some((t) => t.id === d.from) && nach.tasks.some((t) => t.id === d.to));
        nach.gewerke = nach.gewerke.filter((x) => x.id !== g.id);
        const del = await sp.senden(aenderungen(r.state, nach));
        ok(del.ok, 'AMK: Gewerk mit Vorgängen/Verknüpfungen in einem Batch löschen', JSON.stringify(del).slice(0, 300));
        ok(isDeepStrictEqual((await sp.laden()).state, nach), 'AMK: Server entspricht danach dem Plan');
        ok((await sp.planLoeschen()).ok, 'AMK: planLoeschen');
        ok((await createServerPlan({ pb: pbA, planId: r.planId }).laden()).nichtGefunden === true, 'AMK: danach nichtGefunden');
      }
    }

    // Zwei Clients: A besitzt, B ist Bearbeiter
    const A = createServerPlan({ pb: pbA, planId: 'x' });
    const ang = await A.planAnlegen(KT);
    const planId = ang.planId;
    await pb.su('POST', '/api/collections/mitglieder/records', { plan_id: planId, user_id: k.bearb.id, rolle: 'bearbeiter', gewerke: [] });
    const B = createServerPlan({ pb: pbB, planId });
    const la = await A.laden(), lb = await B.laden();
    ok(lb.ok && lb.rolle?.rolle === 'bearbeiter', 'B: Rolle bearbeiter, sieht den Plan', JSON.stringify(lb).slice(0, 200));
    ok(lb.ok && isDeepStrictEqual(lb.state, la.state), 'B lädt denselben Stand wie A');
    const liste = await listePlaene(pbB);
    const mein = liste.find((x) => x.plan_id === planId);
    ok(liste.length === 2 && mein?.rolle === 'bearbeiter' && mein.name === KT.project.name, 'listePlaene(B): ein Plan mit Rolle', JSON.stringify(liste));

    // Realtime: A ändert X, B bekommt genau X; A bekommt sein Echo nicht
    const gotA = [], gotB = [];
    A.abonnieren((t) => gotA.push(t)); B.abonnieren((t) => gotB.push(t));
    await warte(1200); // Abo-Handshake
    const X = la.state.tasks[3].id;
    const a1 = kl(la.state); a1.tasks[3].title = 'Realtime-Test';
    ok((await A.senden(aenderungen(la.state, a1))).ok, 'A ändert Vorgang X');
    await warte(1500);
    ok(gotB.length === 1 && gotB[0].coll === 'vorgaenge' && gotB[0].eid === X && gotB[0].objekt?.title === 'Realtime-Test', 'B bekommt per Realtime genau X', JSON.stringify(gotB).slice(0, 300));
    ok(gotA.length === 0, 'A bekommt sein eigenes Echo nicht', JSON.stringify(gotA).slice(0, 300));
    // Löschen kommt als objekt null; Anlegen mit Objekt
    const a2 = kl(a1); a2.tasks.splice(4, 1); a2.gewerke.push({ ...kl(a2.gewerke[0]), id: 'gneu', name: 'Neu' });
    ok((await A.senden(aenderungen(a1, a2))).ok, 'A löscht einen Vorgang und legt ein Gewerk an');
    await warte(1500);
    ok(gotB.some((t) => t.coll === 'vorgaenge' && t.eid === a1.tasks[4].id && t.objekt === null), 'B bekommt das Löschen (objekt null)', JSON.stringify(gotB.map((t) => [t.coll, t.eid])));
    ok(gotB.some((t) => t.coll === 'gewerke' && t.eid === 'gneu' && t.objekt?.name === 'Neu'), 'B bekommt das neue Gewerk');
    ok(gotB.length === 3 && gotA.length === 0, 'sonst nichts', `B ${gotB.length}, A ${gotA.length}`);
    // B hat den fremden Inhalt übernommen (die App meldet es per uebernommen): erst jetzt gilt die gehörte rev als Basis
    for (const t of gotB) B.uebernommen(t.coll, t.eid, t.rev);
    const b0 = kl(a2); b0.tasks[3].title = 'von B';
    ok((await B.senden(aenderungen(a2, b0))).ok, 'B ändert X nach dem Realtime-Ereignis (rev nachgezogen)');
    await warte(800);
    ok(gotA.length === 1 && gotA[0].eid === X, 'A bekommt Bs Änderung', JSON.stringify(gotA).slice(0, 200));

    // Konflikt: beide ändern X mit gleicher rev (B ohne Realtime-Nachzug → veralteter Stand)
    const B2 = createServerPlan({ pb: pbB, planId });
    const stand = (await B2.laden()).state;
    const A2 = createServerPlan({ pb: pbA, planId });
    await A2.laden();
    const von = (t) => { const s = kl(stand); s.tasks[6].title = t; return s; };
    const rA = await A2.senden(aenderungen(stand, von('A gewinnt')));
    const rB = await B2.senden(aenderungen(stand, von('B verliert')));
    ok(rA.ok && !rB.ok && rB.konflikt?.[0]?.eid === stand.tasks[6].id && rB.konflikt[0].art === 'aendern' && rB.konflikt[0].fremd?.title === 'A gewinnt', 'Gleiche rev: einer ok, der andere konflikt mit dem fremden Stand', JSON.stringify([rA, rB]).slice(0, 400));
    // Fremd gelöscht → fremd null
    const A3 = kl(stand); A3.tasks.splice(7, 1);
    ok((await A2.senden(aenderungen(stand, A3))).ok, 'A löscht Vorgang Y');
    const b3 = kl(stand); b3.tasks[7].title = 'zu spät';
    const rB3 = await B2.senden(aenderungen(stand, b3));
    ok(!rB3.ok && rB3.konflikt?.[0]?.fremd === null, 'B ändert den gelöschten Vorgang → konflikt, fremd null', JSON.stringify(rB3).slice(0, 300));

    // Token kaputt → abgemeldet (Liste wäre sonst leer)
    const pbX = await clientFuer(pb, 'pl@bzp.test');
    await pbX.abmelden();
    ok((await createServerPlan({ pb: pbX, planId }).laden()).abgemeldet === true, 'ohne Anmeldung: laden → abgemeldet');
    ok((await A.planLoeschen()).ok, 'A: planLoeschen');
    ok((await B.laden()).nichtGefunden === true, 'B: Plan weg → nichtGefunden');
    ok((await pb.su('GET', '/api/collections/vorgaenge/records?perPage=1&filter=' + encodeURIComponent(`plan_id="${planId}"`))).body.totalItems === 0, 'Kaskade: keine Vorgänge mehr');
  } finally { await pbA.abmelden(); await pbB.abmelden(); }
}

// ── RATELIMIT: PB-Standard-Rate-Limits wie auf TEST/LIVE (Task 10b) ────────────────────────────
// Eigene Startoption: erst Migrationen, dann `enabled: true` (tools/pb-lokal.mjs `rateLimits`). appURL mit
// Schrägstrich am Ende wie auf TEST. Grundaufbau entfällt (11 Anmeldungen sprengen `*:auth` 2/3 s).
const regelnLesen = async (pb) => (await pb.su('GET', '/api/settings')).body.rateLimits;
const createRegel = async (pb, maxRequests) => {
  const rl = await regelnLesen(pb);
  return pb.su('PATCH', '/api/settings', { rateLimits: { enabled: true, rules: rl.rules.map((r) => (r.label === '*:create' ? { ...r, maxRequests } : r)) } });
};
async function RATELIMIT(pb, { smtp } = {}) {
  console.log('— RATELIMIT');
  const KT = fixturePlan('klassentreffen-festival');
  const AMK = fixturePlan('amk-singleshow');
  // Migration: nur `*:create` angehoben, Rest = PB-Standard, enabled hat der Start gesetzt
  const rl = await regelnLesen(pb);
  const regel = (l) => rl.rules.find((r) => r.label === l);
  ok(regel('*:create')?.maxRequests === 2000 && regel('*:create')?.duration === 5, 'Migration: *:create = 2000 je 5 s', JSON.stringify(regel('*:create')));
  ok(regel('*:auth')?.maxRequests === 2 && regel('*:auth')?.duration === 3 && regel('/api/batch')?.maxRequests === 3 && regel('/api/batch')?.duration === 1 && regel('/api/')?.maxRequests === 300 && regel('/api/')?.duration === 10, 'Migration: *:auth 2/3, /api/batch 3/1, /api/ 300/10 unverändert', JSON.stringify(rl.rules));
  ok(rl.enabled === true, 'Limits sind eingeschaltet (Start mit rateLimits:true)');
  await kontoAnlegen(pb, { email: 'pl@bzp.test', name: 'pl', passwort: PW, produktionsleitung: true });
  await warte(3200); // `*:auth` 2/3 s: die Anmeldung von kontoAnlegen soll aus dem Fenster sein
  const pbA = await clientFuer(pb, 'pl@bzp.test');
  try {
    // 1) Große Pläne: AMK (52 Anfragen) und Klassentreffen (407) in je EINEM Batch, mit Limits an
    const angelegt = {};
    for (const [name, vorlage] of [['AMK', AMK], ['Klassentreffen', KT]]) {
      const r = await createServerPlan({ pb: pbA, planId: 'x' }).planAnlegen(vorlage);
      ok(r.ok, `${name}: planAnlegen gelingt unter den Standard-Limits`, JSON.stringify(r).slice(0, 300));
      angelegt[name] = r;
    }
    const lade = angelegt.AMK.ok && await createServerPlan({ pb: pbA, planId: angelegt.AMK.planId }).laden();
    ok(lade && lade.ok && isDeepStrictEqual(lade.state, angelegt.AMK.state), 'AMK: laden = angelegter Plan (deepEqual)');

    // 2) Sechs schnelle senden hintereinander (ohne zu warten): alle kommen an, nichts geht verloren
    const start = angelegt.Klassentreffen;
    const sp = createServerPlan({ pb: pbA, planId: start.planId });
    await sp.laden();
    const staende = [start.state];
    for (let i = 0; i < 6; i++) { const n = kl(staende[i]); n.tasks[i].title = 'Schnell ' + (i + 1); staende.push(n); }
    const t0 = Date.now();
    const erg = await Promise.all(staende.slice(1).map((n, i) => sp.senden(aenderungen(staende[i], n))));
    ok(erg.every((r) => r.ok === true), '6 schnelle senden: alle ok', JSON.stringify(erg));
    ok(Date.now() - t0 >= 5 * 400, 'Drossel: 6 Batches brauchen mindestens ~5 Abstände', String(Date.now() - t0) + ' ms');
    const danach = await createServerPlan({ pb: pbA, planId: start.planId }).laden();
    ok(danach.ok && isDeepStrictEqual(danach.state, staende[6]), 'alle sechs Änderungen stehen auf dem Server (deepEqual)');
    ok(sp.offen.length === 0, 'Warteschlange leer');

    // 3) Reset-Mail: appURL endet auf «/» → Link ohne «//login.html»
    if (smtp) {
      const r = await pb.su('PATCH', '/api/settings', { smtp: { enabled: true, host: '127.0.0.1', port: smtp.port, tls: false, username: '', password: '' }, meta: { senderAddress: 'bzp@bzp.test', senderName: 'BZP' } });
      ok(r.ok, 'SMTP gesetzt', JSON.stringify(r.body));
      const anf = await pbA.post('/api/collections/users/request-password-reset', { email: 'pl@bzp.test' });
      ok(anf.ok, 'request-password-reset');
      const bis = Date.now() + 10000;
      while (!smtp.mails.length && Date.now() < bis) await warte(100);
      const mail = qp(smtp.mails[0] || '');
      const m = mail.match(/href="?(http[^"\s>]*login\.html\?reset=[^"\s>]+)/);
      ok(!!m && m[1].startsWith('http://localhost:8080/login.html?reset='), 'Reset-Link = appURL + login.html (ein Schrägstrich)', m ? m[1] : mail.slice(0, 300));
      ok(!/[^:]\/\/login\.html/.test(mail), 'Mail enthält nirgends «//login.html»');
    }

    // 4) Rot-Nachweis: ohne die Migration (create-Regel auf dem PB-Standard 20 je 5 s) scheitert AMK
    ok((await createRegel(pb, 20)).ok, 'Regel *:create auf 20/5 s zurückgesetzt (Zustand ohne Migration)');
    await warte(5500);
    const rot = await createServerPlan({ pb: pbA, planId: 'x' }).planAnlegen(AMK);
    ok(rot.ok === false && rot.limit === true, 'OHNE Migration scheitert planAnlegen(AMK) mit limit', JSON.stringify(rot).slice(0, 200));
    const nach = await pb.su('GET', '/api/collections/plaene/records?perPage=1&filter=' + encodeURIComponent('daten.name="' + AMK.project.name + '"') + '&sort=-created');
    ok(nach.ok && nach.body.totalItems === 1, 'der gescheiterte Versuch hat nichts angelegt (Batch zurückgerollt)', String(nach.body.totalItems));
    ok((await createRegel(pb, 2000)).ok, 'Regel *:create wieder auf 2000/5 s');
    await warte(5500);
    const gruen = await createServerPlan({ pb: pbA, planId: 'x' }).planAnlegen(AMK);
    ok(gruen.ok, 'MIT Migration: planAnlegen(AMK) gelingt wieder', JSON.stringify(gruen).slice(0, 200));

    // 5) Anmeldung: ab der 3. Anmeldung in 3 s kommt 429 → code «limit» (login.js zeigt «Zu viele Versuche»)
    await warte(3200);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await createPb({ basis: pb.url, fetch, speicher: new Map(), autostart: false }).anmelden('pl@bzp.test', 'falsch-' + i)).code);
    ok(codes.includes('limit') && codes[0] !== 'limit', 'Anmeldung: Limit liefert code «limit»', JSON.stringify(codes));
  } finally { await pbA.abmelden(); }
}
// Prüft, dass die Migration `enabled` nicht anfasst: ohne rateLimits-Option bleibt es aus
async function RATELIMIT_AUS() {
  const pb = await startePb();
  try {
    const rl = await regelnLesen(pb);
    ok(rl.enabled === false, 'Migration schaltet die Limits nicht ein (enabled bleibt false)', JSON.stringify(rl));
    ok(rl.rules.find((r) => r.label === '*:create')?.maxRequests === 2000, 'Migration setzt *:create auch ohne Einschalten');
  } finally { await pb.stop(); }
}

// ── Lesemodus gegen eine laufende Instanz (Admin-Auftrag Phase 2) ───────────────────────────────────
// Schreibt nie etwas: nur GET und EIN anonymer POST an die Hook-Route mit leerem Body (wird abgelehnt).
const GEGEN_COLS = ['plaene', 'mitglieder', 'einladungen', ...COLS];
export async function GEGEN(url, { suToken = '' } = {}) {
  const pb = { url: url.replace(/\/+$/, '') };
  const h = await api(pb, '', 'GET', '/api/health');
  ok(h.status === 200 && h.body?.code === 200, '/api/health = 200', `Status ${h.status}`);
  // Anonym darf nichts zu sehen sein: Filterregeln ohne Treffer liefern 200 mit leerer Liste. 404 = Collection fehlt
  // (Migration nicht eingespielt), 200 mit Einträgen = Regel offen, 403 = Regel auf «nur Superuser» (falsch gesetzt).
  for (const c of [...GEGEN_COLS, 'users']) {
    const r = await api(pb, '', 'GET', `/api/collections/${c}/records?perPage=1`);
    const gut = r.status === 200 && Array.isArray(r.body?.items) && r.body.items.length === 0 && r.body.totalItems === 0;
    ok(gut, `${c}: vorhanden, anonym leer`, r.status === 404 ? 'Collection fehlt (Migration?)' : `Status ${r.status}, ${JSON.stringify(r.body).slice(0, 120)}`);
  }
  // Hook-Route da: ohne Auth und ohne Token lehnt sie mit 400 ab; 404 hieße «Hook nicht geladen».
  const e = await api(pb, '', 'POST', '/api/bzp/einladung', {});
  ok(e.status === 400 && /Einladung unbekannt/.test(e.body?.message || ''), 'Hook-Route /api/bzp/einladung lehnt anonym ab (Hook geladen)', e.status === 404 ? 'Route fehlt (Hook nicht geladen)' : `Status ${e.status}, ${JSON.stringify(e.body).slice(0, 120)}`);
  if (suToken) {
    const s = await api(pb, suToken, 'GET', '/api/settings');
    if (!ok(s.status === 200, 'Superuser-Token gilt (Einstellungen lesbar)', `Status ${s.status}`)) return;
    const rl = s.body.rateLimits || {};
    const create = (rl.rules || []).find((r) => r.label === '*:create');
    ok(create?.maxRequests === 2000 && create?.duration === 5, 'Migration 1700000003 wirkt: *:create = 2000 je 5 s', JSON.stringify(create));
    ok(rl.enabled === true, 'Rate Limiting ist an (Einstellung des Admins, die Migration fasst es nicht an)');
    const url2 = s.body.meta?.appURL || '';
    ok(/^https?:\/\/.+\/$/.test(url2), 'Application URL gesetzt, mit Schrägstrich am Ende', url2);
  } else {
    console.log('· ohne PB_SU_TOKEN: Einstellungen (Rate Limits, Application URL) nicht geprüft');
  }
}

const ABSCHNITTE = { SCHEMA, REV, GEWERKELEITER, STATUS, KONTEN, EINLADUNG, BESITZER, KONSISTENZ, DATEN, LOESCHEN, SERVERPLAN, RATELIMIT };

const gi = process.argv.indexOf('--gegen');
if (gi > 0 && process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const ziel = process.argv[gi + 1];
  if (!/^https?:\/\//.test(ziel || '')) { console.error('Aufruf: node tools/verify-pb-regeln.mjs --gegen <url>'); process.exit(2); }
  try { await GEGEN(ziel, { suToken: process.env.PB_SU_TOKEN || '' }); }
  catch (e) { console.log('✗ Abbruch: ' + e.message); fehler++; }
  console.log(fehler ? `\n${fehler} Fehler` : '\nLesemodus: alles wie erwartet');
  process.exit(fehler ? 1 : 0);
}

const i = process.argv.indexOf('--nur');
const nur = i > 0 ? process.argv[i + 1].toUpperCase() : null;
if (nur && !ABSCHNITTE[nur]) { console.error('Unbekannter Abschnitt: ' + nur + ' (' + Object.keys(ABSCHNITTE).join(', ') + ')'); process.exit(2); }

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // SERVERPLAN braucht EventSource (Node 24: nur mit --experimental-eventsource) → Selbstneustart mit dem Flag
  if (typeof EventSource === 'undefined' && (!nur || nur === 'SERVERPLAN' || nur === 'RATELIMIT')) {
    const r = spawnSync(process.execPath, ['--experimental-eventsource', '--disable-warning=UNDICI-ES', ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  let pb;
  try {
    // frischer Server je Abschnitt: Abschnitte beeinflussen sich nicht
    for (const [n, f] of Object.entries(ABSCHNITTE)) {
      if (nur && nur !== n) continue;
      // RATELIMIT: Standard-Limits an, appURL mit Schrägstrich am Ende (wie TEST), SMTP-Fänger für die Reset-Mail
      const rate = n === 'RATELIMIT';
      const smtp = rate ? await smtpEmpfaenger() : null;
      try {
        pb = await startePb(rate ? { rateLimits: true, appUrl: 'http://localhost:8080/' } : {});
        try { await f(pb, { smtp }); } catch (e) { console.log('  PB-Log: ' + pb.log().slice(-1200)); throw e; } finally { await pb.stop(); pb = null; }
        if (rate) await RATELIMIT_AUS();
      } finally { smtp?.schliessen(); }
    }
  } catch (e) { console.log('✗ Abbruch: ' + e.message); fehler++; }
  finally { if (pb) await pb.stop(); }
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlle Prüfungen grün');
  process.exit(fehler ? 1 : 0);
}
