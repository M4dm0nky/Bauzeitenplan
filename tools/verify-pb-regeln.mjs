// Server-Prüfung: Schema und API-Regeln der PocketBase (kein Browser).
//   node tools/verify-pb-regeln.mjs [--nur SCHEMA]
// Jeder Abschnitt ist eine Funktion in ABSCHNITTE (Task 3 ergänzt weitere).
import { startePb, kontoAnlegen } from './pb-lokal.mjs';

const COLS = ['ressourcen', 'gewerke', 'vorgaenge', 'phasen', 'verknuepfungen'];
const PW = 'Test-Passwort-123';
let fehler = 0;
const ok = (b, text, extra = '') => { console.log(`${b ? '✓' : '✗'} ${text}${b ? '' : ' ' + extra}`); if (!b) fehler++; };

export async function api(pb, token, method, path, body) {
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = token;
  const r = await fetch(pb.url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const t = await r.text(); let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, ok: r.ok, body: json };
}
export const batch = (pb, token, requests) => api(pb, token, 'POST', '/api/batch', { requests });
export const post = (coll, body) => ({ method: 'POST', url: `/api/collections/${coll}/records`, body });
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
  for (const n of ['bearb', 'gwl', 'betr', 'fremd', 'bmitglied']) await mk(n);
  const planAnlegen = async (besitzer, plan_id) => {
    const reqs = [
      post('plaene', { plan_id, besitzer: besitzer.id, daten: { name: plan_id }, rev: 1 }),
      ...COLS.map((c) => post(c, { plan_id, eid: 'e1', daten: { x: 1 }, rev: 1, pos: 0, ...(c === 'vorgaenge' ? { gewerk: 'g1' } : {}), ...(c === 'verknuepfungen' ? { von: 'a', nach: 'b' } : {}) })),
    ];
    return batch(pb, besitzer.token, reqs);
  };
  const a = await planAnlegen(k.pl, 'planA');
  const b = await planAnlegen(k.pl2, 'planB');
  const mit = (plan_id, user, rolle, gewerke = []) => post('mitglieder', { plan_id, user_id: user.id, rolle, gewerke });
  const ma = await batch(pb, k.pl.token, [mit('planA', k.bearb, 'bearbeiter'), mit('planA', k.gwl, 'gewerkeleiter', ['g1']), mit('planA', k.betr, 'betrachter')]);
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
    ok(await anzahl(pb, null, c) <= 0, `ohne Anmeldung ${c} → 0/4xx`);
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
  for (const n of ['bearb', 'gwl', 'super']) {
    const r = await api(pb, k[n].token, 'PATCH', `/api/collections/vorgaenge/records/${vid}`, { daten: { x: 3 }, rev: 2 });
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
  ok(await anzahl(pb, k.bearb.token, 'einladungen') <= 0, 'bearb sieht Einladungen nicht (Token geheim)');
  ok((await api(pb, k.bearb.token, 'POST', '/api/collections/mitglieder/records', { plan_id: 'planA', user_id: k.fremd.id, rolle: 'bearbeiter', gewerke: [] })).status >= 400, 'bearb legt Mitglied an → 4xx');
  ok(await anzahl(pb, k.betr.token, 'mitglieder', 'plan_id = "planA"') === 3, 'Mitglied sieht Mitgliederliste seines Plans');
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
  ok(await anzahl(pb, null, 'users') <= 0, 'users ohne Anmeldung → 0/4xx');
  // Batch-Einstellungen
  const s = await pb.su('GET', '/api/settings');
  ok(s.body.batch.enabled === true && s.body.batch.maxRequests === 2000 && s.body.batch.timeout === 30 && s.body.batch.maxBodySize === 0, 'Batch-Einstellungen', JSON.stringify(s.body.batch));
}

const ABSCHNITTE = { SCHEMA };

const i = process.argv.indexOf('--nur');
const nur = i > 0 ? process.argv[i + 1].toUpperCase() : null;
if (nur && !ABSCHNITTE[nur]) { console.error('Unbekannter Abschnitt: ' + nur + ' (' + Object.keys(ABSCHNITTE).join(', ') + ')'); process.exit(2); }

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  let pb;
  try {
    pb = await startePb();
    for (const [n, f] of Object.entries(ABSCHNITTE)) if (!nur || nur === n) await f(pb);
  } catch (e) { console.log('✗ Abbruch: ' + e.message); fehler++; }
  finally { if (pb) await pb.stop(); }
  console.log(fehler ? `\n${fehler} Fehler` : '\nAlle Prüfungen grün');
  process.exit(fehler ? 1 : 0);
}
