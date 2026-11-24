// Server-Prüfung: Schema und API-Regeln der PocketBase (kein Browser).
//   node tools/verify-pb-regeln.mjs [--nur SCHEMA]
// Jeder Abschnitt ist eine Funktion in ABSCHNITTE (Task 3 ergänzt weitere).
import { pathToFileURL } from 'node:url';
import { startePb, kontoAnlegen } from './pb-lokal.mjs';

const COLS = ['ressourcen', 'gewerke', 'vorgaenge', 'phasen', 'verknuepfungen'];
const PW = 'Test-Passwort-123';
let fehler = 0;
const ok = (b, text, extra = '') => { console.log(`${b ? '✓' : '✗'} ${text}${b ? '' : ' ' + extra}`); if (!b) fehler++; };

export async function api(pb, token, method, path, body) {
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = token;
  const r = await fetch(pb.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) })
    .catch((e) => { throw new Error(`${method} ${path}: ${e.message} ${e.cause?.code || e.cause || ''}`); });
  const t = await r.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, ok: r.ok, body: json };
}
export const batch = (pb, token, requests) => api(pb, token, 'POST', '/api/batch', { requests });
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
  ok((await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([res[0], { ...res[1], n: 3 }]), rev })).ok && ++rev, 'gwl ändert Anzahl einer unbestätigten Zeile (Status unverändert)');
  ok((await patch(pb, k, 'gwl', 'vorgaenge', id, { ...mitRes([{ rid: 'r1', n: 4, von: null, bis: null }, { ...res[1], n: 3 }]), rev })).ok && ++rev, 'gwl ändert Anzahl einer bestätigten Zeile, Status entfernt (Rückfall)');
  const stand = (await gib(pb, 'vorgaenge', 'planA', 'vs')).daten.res;
  ok(stand[0].status === undefined && stand[0].n === 4, 'Rückfall gespeichert (Zeile 1 ohne Status, n = 4)', JSON.stringify(stand[0]));
  ok((await patch(pb, k, 'pl', 'vorgaenge', id, { ...mitRes([{ ...stand[0], status: 'bestaetigt', bestaetigtAm: '2026-03-03T10:00' }, stand[1]]), rev })).ok && ++rev, 'pl setzt bestaetigt');
  ok((await patch(pb, k, 'plmit', 'vorgaenge', id, { ...mitRes([stand[0], { ...stand[1], status: 'abgelehnt', notiz: 'ausgebucht' }]), rev })).ok && ++rev, 'PL-Mitglied setzt abgelehnt');
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

const ABSCHNITTE = { SCHEMA, REV, GEWERKELEITER, STATUS, KONTEN, EINLADUNG, BESITZER, KONSISTENZ };

const i = process.argv.indexOf('--nur');
const nur = i > 0 ? process.argv[i + 1].toUpperCase() : null;
if (nur && !ABSCHNITTE[nur]) { console.error('Unbekannter Abschnitt: ' + nur + ' (' + Object.keys(ABSCHNITTE).join(', ') + ')'); process.exit(2); }

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  let pb;
  try {
    // frischer Server je Abschnitt: Abschnitte beeinflussen sich nicht
    for (const [n, f] of Object.entries(ABSCHNITTE)) {
      if (nur && nur !== n) continue;
      pb = await startePb();
      try { await f(pb); } catch (e) { console.log('  PB-Log: ' + pb.log().slice(-1200)); throw e; } finally { await pb.stop(); pb = null; }
    }
  } catch (e) { console.log('✗ Abbruch: ' + e.message); fehler++; }
  finally { if (pb) await pb.stop(); }
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlle Prüfungen grün');
  process.exit(fehler ? 1 : 0);
}
