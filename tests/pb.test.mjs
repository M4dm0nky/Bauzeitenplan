import { createPb, apiBasis, AUTH_KEY, ERNEUERN_MS } from '../js/pb.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── Echte Antwortformen: Mitschnitt gegen PocketBase 0.40.6 (tools/pb-lokal.mjs, lokal, 2026-11-26).
// Token durch Platzhalter ersetzt, Passwörter kommen nicht vor.
const TOKEN = 'TOKEN-PLATZHALTER';
const TOKEN2 = 'TOKEN-PLATZHALTER-ERNEUERT';
const RECORD = { avatar: '', collectionId: '_pb_users_auth_', collectionName: 'users', created: '2026-11-26 09:19:32.062Z', email: 'sa@bzp.test', emailVisibility: true, id: 'n9li07qzmsa9tdr', name: 'Sa', produktionsleitung: false, superadmin: true, updated: '2026-11-26 09:19:32.062Z', verified: true };
const AUTH = { status: 200, body: { record: RECORD, token: TOKEN } };
const REFRESH = { status: 200, body: { record: RECORD, token: TOKEN2 } };
const FALSCHES_PW = { status: 400, body: { data: {}, message: 'Failed to authenticate.', status: 400 } };
const UNAUTH = { status: 401, body: { data: {}, message: 'The request requires valid record authorization token.', status: 401 } };
const gewerk = (n, id) => ({ collectionId: 'pbc_2981751933', collectionName: 'gewerke', created: '2026-11-26 09:19:32.270Z', daten: { id: 'g' + n, name: 'G' + n }, eid: 'g' + n, id, plan_id: 'planX', pos: n, rev: 1, updated: '2026-11-26 09:19:32.270Z' });
const SEITE1 = { status: 200, body: { items: [gewerk(1, 'k1f6zc9jvm4q9w6'), gewerk(2, 'lxeam1s03v1zzee')], page: 1, perPage: 2, totalItems: 3, totalPages: 2 } };
const SEITE2 = { status: 200, body: { items: [gewerk(3, 'tcxhceeqxaafu3u')], page: 2, perPage: 2, totalItems: 3, totalPages: 2 } };
const BATCH_OK = { status: 200, body: [{ body: { besitzer: 'n9li07qzmsa9tdr', collectionId: 'pbc_3658547507', collectionName: 'plaene', daten: {}, id: '5x5b7f122qsccyr', plan_id: 'planX', rev: 1 }, status: 200 }, { body: gewerk(1, 'k1f6zc9jvm4q9w6'), status: 200 }] };
// Unterrequest mit 409 → HTTP 400 «Batch transaction failed.», der Hook-Fehler steckt in data.requests.<Index>.response
const BATCH_409 = { status: 400, body: { data: { requests: { 0: { code: 'batch_request_failed', message: 'Batch request failed.', response: { data: { code: { code: 'rev', message: 'Konflikt.' }, eid: { code: 'g1', message: 'Eid.' }, rev: { code: '1', message: 'Rev.' } }, message: 'Der Eintrag wurde inzwischen geändert (rev 1).', status: 409 } } } }, message: 'Batch transaction failed.', status: 400 } };
// Anderer Batch-Fehler (Regel): Create ohne Recht → 400 in der Unterantwort
const BATCH_REGEL = { status: 400, body: { data: { requests: { 0: { code: 'batch_request_failed', message: 'Batch request failed.', response: { data: {}, message: 'Failed to create record.', status: 400 } } } }, message: 'Batch transaction failed.', status: 400 } };
const PB_CONNECT = 'id:yiZg6WTl8vm53mFGvWPfRxxkf0EgbPXyZxXuQDLY\nevent:PB_CONNECT\ndata:{"clientId":"yiZg6WTl8vm53mFGvWPfRxxkf0EgbPXyZxXuQDLY"}\n\n';
const PB_CONNECT_DATA = '{"clientId":"yiZg6WTl8vm53mFGvWPfRxxkf0EgbPXyZxXuQDLY"}';
const SSE_EREIGNIS_DATA = JSON.stringify({ record: { ...gewerk(1, 'k1f6zc9jvm4q9w6'), rev: 2, daten: { id: 'g1', name: 'zwei' } }, action: 'update' });

// ── Fälschungen
const antwort = ({ status, body, raw }) => ({ ok: status >= 200 && status < 300, status, text: async () => (raw !== undefined ? raw : body === null || body === undefined ? '' : JSON.stringify(body)) });
// Skript: Liste von Antworten (oder Funktionen) in Reihenfolge; Aufrufe werden protokolliert
const fakeFetch = (skript) => {
  const aufrufe = [];
  const f = async (url, opt = {}) => {
    aufrufe.push({ url, method: opt.method, headers: opt.headers || {}, body: opt.body ? JSON.parse(opt.body) : undefined });
    const n = skript.shift();
    if (!n) throw new Error('unerwarteter Aufruf ' + url);
    if (n instanceof Error) throw n;
    return antwort(typeof n === 'function' ? n(url) : n);
  };
  f.aufrufe = aufrufe;
  return f;
};
const fakeSpeicher = (start = {}) => {
  const m = new Map(Object.entries(start));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
};
class FakeES {
  static alle = [];
  constructor(url) { this.url = url; this.h = {}; this.zu = false; FakeES.alle.push(this); }
  addEventListener(n, f) { (this.h[n] ||= []).push(f); }
  close() { this.zu = true; }
  senden(name, data) { for (const f of this.h[name] || []) f({ data }); }
}
const neu = (skript, o = {}) => {
  const fetch = fakeFetch(skript);
  const speicher = o.speicher || fakeSpeicher();
  const pb = createPb({ basis: 'http://pb.test', fetch, speicher, EventSource: FakeES, autostart: false, ...o });
  return { pb, fetch, speicher };
};
const angemeldet = () => fakeSpeicher({ [AUTH_KEY]: JSON.stringify({ token: TOKEN, record: RECORD }) });

// ── apiBasis
const loc = (hostname, search = '') => ({ hostname, search });
test('apiBasis: drei Hosts', () => {
  assert.equal(apiBasis(loc('m4dm0nky.github.io')), 'https://api-test.callboard.nyxlightwork.de');
  assert.equal(apiBasis(loc('localhost')), 'https://api-test.callboard.nyxlightwork.de');
  assert.equal(apiBasis(loc('127.0.0.1')), 'https://api-test.callboard.nyxlightwork.de');
  assert.equal(apiBasis(loc('callboard.nyxlightwork.de')), 'https://api.callboard.nyxlightwork.de');
});
test('apiBasis: ?api= gilt nur auf localhost/127.0.0.1 (E-5)', () => {
  assert.equal(apiBasis(loc('localhost', '?api=http://127.0.0.1:8090')), 'http://127.0.0.1:8090');
  assert.equal(apiBasis(loc('127.0.0.1', '?x=1&api=http://127.0.0.1:5/pfad')), 'http://127.0.0.1:5');
  assert.equal(apiBasis(loc('m4dm0nky.github.io', '?api=https://boese.example')), 'https://api-test.callboard.nyxlightwork.de');
  assert.equal(apiBasis(loc('callboard.nyxlightwork.de', '?api=https://boese.example')), 'https://api.callboard.nyxlightwork.de');
  assert.equal(apiBasis(loc('fremd.example', '?api=http://127.0.0.1:8090')), 'https://api-test.callboard.nyxlightwork.de');
});
test('apiBasis: ungültiges ?api= auf localhost fällt auf Test zurück', () => {
  assert.equal(apiBasis(loc('localhost', '?api=javascript:alert(1)')), 'https://api-test.callboard.nyxlightwork.de');
  assert.equal(apiBasis(loc('localhost', '?api=quatsch')), 'https://api-test.callboard.nyxlightwork.de');
});

// ── Anmeldung
test('anmelden: speichert Token + Record unter bzp_auth, E-Mail klein, ohne Authorization', async () => {
  const { pb, fetch, speicher } = neu([AUTH]);
  const r = await pb.anmelden('  Sa@BZP.test ', 'pw');
  assert.equal(r.ok, true);
  assert.equal(r.record.id, RECORD.id);
  assert.equal(pb.istAngemeldet, true);
  assert.equal(pb.auth.token, TOKEN);
  assert.deepEqual(JSON.parse(speicher.getItem(AUTH_KEY)), { token: TOKEN, record: RECORD });
  const a = fetch.aufrufe[0];
  assert.equal(a.url, 'http://pb.test/api/collections/users/auth-with-password');
  assert.deepEqual(a.body, { identity: 'sa@bzp.test', password: 'pw' });
  assert.equal(a.headers.Authorization, undefined);
});
test('anmelden: falsches Passwort → Fehlerform, nichts gespeichert, kein «abgemeldet»', async () => {
  const { pb, speicher } = neu([FALSCHES_PW]);
  let ab = 0; pb.on('abgemeldet', () => ab++);
  const r = await pb.anmelden('sa@bzp.test', 'falsch');
  assert.deepEqual(r, { ok: false, status: 400, code: 'fehler', message: 'Failed to authenticate.' });
  assert.equal(pb.istAngemeldet, false);
  assert.equal(speicher.getItem(AUTH_KEY), null);
  assert.equal(ab, 0);
});
test('abmelden löscht Token aus Speicher und Zustand', async () => {
  const { pb, speicher } = neu([AUTH]);
  await pb.anmelden('sa@bzp.test', 'pw');
  pb.abmelden();
  assert.equal(pb.auth, null);
  assert.equal(speicher.getItem(AUTH_KEY), null);
});
test('Start: gespeicherte Anmeldung wird gelesen; kaputter Eintrag ignoriert', () => {
  assert.equal(neu([], { speicher: angemeldet() }).pb.auth.token, TOKEN);
  assert.equal(neu([], { speicher: fakeSpeicher({ [AUTH_KEY]: '{kaputt' }) }).pb.istAngemeldet, false);
  assert.equal(neu([], { speicher: fakeSpeicher({ [AUTH_KEY]: '{"record":{}}' }) }).pb.istAngemeldet, false);
});
test('gesperrter Speicher bricht nichts (nur im Speicher gehalten)', async () => {
  const kaputt = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  const { pb } = neu([AUTH], { speicher: kaputt });
  assert.equal((await pb.anmelden('a@b.c', 'pw')).ok, true);
  assert.equal(pb.istAngemeldet, true);
});

// ── 401 und Erneuerung
test('401 bei angemeldeter Anfrage → auth null, bzp_auth weg, Ereignis «abgemeldet» (einmal)', async () => {
  const { pb, speicher } = neu([UNAUTH, UNAUTH], { speicher: angemeldet() });
  let ab = 0; pb.on('abgemeldet', () => ab++);
  const r = await pb.eins('gewerke', 'x');
  assert.deepEqual(r, { ok: false, status: 401, code: 'auth', message: 'The request requires valid record authorization token.' });
  assert.equal(pb.auth, null);
  assert.equal(speicher.getItem(AUTH_KEY), null);
  assert.equal(ab, 1);
  await pb.eins('gewerke', 'x'); // ohne Anmeldung: 401 meldet nicht noch einmal ab
  assert.equal(ab, 1);
});
test('erneuern: neues Token wird gespeichert, Authorization trägt das alte', async () => {
  const { pb, fetch, speicher } = neu([REFRESH], { speicher: angemeldet() });
  const r = await pb.erneuern();
  assert.equal(r.ok, true);
  assert.equal(pb.auth.token, TOKEN2);
  assert.equal(JSON.parse(speicher.getItem(AUTH_KEY)).token, TOKEN2);
  assert.equal(fetch.aufrufe[0].url, 'http://pb.test/api/collections/users/auth-refresh');
  assert.equal(fetch.aufrufe[0].headers.Authorization, TOKEN);
});
test('erneuern: 401 meldet ab; Netzfehler und 5xx lassen die Anmeldung bestehen; ohne Anmeldung kein Aufruf', async () => {
  const a = neu([UNAUTH], { speicher: angemeldet() });
  let ab = 0; a.pb.on('abgemeldet', () => ab++);
  assert.equal((await a.pb.erneuern()).code, 'auth');
  assert.equal(ab, 1); assert.equal(a.pb.istAngemeldet, false);
  const b = neu([new Error('offline'), { status: 502, body: null }], { speicher: angemeldet() });
  assert.equal((await b.pb.erneuern()).code, 'netz');
  assert.equal((await b.pb.erneuern()).status, 502);
  assert.equal(b.pb.istAngemeldet, true);
  const c = neu([]);
  assert.equal((await c.pb.erneuern()).ok, false);
  assert.equal(c.fetch.aufrufe.length, 0);
});
test('Takt: autostart erneuert sofort und alle 6 h; autostart:false startet nichts', async () => {
  const takte = [];
  const si = (f, ms) => { takte.push({ f, ms }); return { unref() {} }; };
  const gestoppt = [];
  const { pb, fetch } = neu([REFRESH, REFRESH], { speicher: angemeldet(), autostart: true, setInterval: si, clearInterval: (t) => gestoppt.push(t) });
  assert.equal(takte.length, 1);
  assert.equal(takte[0].ms, 6 * 60 * 60 * 1000);
  assert.equal(ERNEUERN_MS, 6 * 60 * 60 * 1000);
  await new Promise((r) => setImmediate(r));
  assert.equal(fetch.aufrufe.length, 1); // Start-Erneuerung
  takte[0].f();
  await new Promise((r) => setImmediate(r));
  assert.equal(fetch.aufrufe.length, 2);
  pb.stopTakt();
  assert.equal(gestoppt.length, 1);
  const t2 = []; neu([], { autostart: false, setInterval: (f, ms) => t2.push(ms) });
  assert.equal(t2.length, 0);
  const t3 = []; const k = neu([], { autostart: true, setInterval: (f, ms) => { t3.push(ms); } });
  assert.equal(k.fetch.aufrufe.length, 0); // ohne Anmeldung nichts zu erneuern
});

// ── Listen, Einzel, Batch, post
test('liste folgt allen Seiten (perPage 500, Filter und Sortierung kodiert)', async () => {
  const { pb, fetch } = neu([SEITE1, SEITE2], { speicher: angemeldet() });
  const r = await pb.liste('gewerke', "plan_id='planX'", 'pos');
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map((x) => x.eid), ['g1', 'g2', 'g3']);
  assert.equal(r.total, 3);
  const u = new URL(fetch.aufrufe[0].url);
  assert.equal(u.pathname, '/api/collections/gewerke/records');
  assert.equal(u.searchParams.get('perPage'), '500');
  assert.equal(u.searchParams.get('page'), '1');
  assert.equal(u.searchParams.get('filter'), "plan_id='planX'");
  assert.equal(u.searchParams.get('sort'), 'pos');
  assert.equal(new URL(fetch.aufrufe[1].url).searchParams.get('page'), '2');
  assert.equal(fetch.aufrufe[0].headers.Authorization, TOKEN);
});
test('liste: leere Liste (totalPages 0) endet nach einem Aufruf; Fehler auf Seite 2 bricht ab', async () => {
  const leer = { status: 200, body: { items: [], page: 1, perPage: 500, totalItems: 0, totalPages: 0 } };
  const a = neu([leer], { speicher: angemeldet() });
  assert.deepEqual(await a.pb.liste('gewerke'), { ok: true, items: [], total: 0 });
  assert.equal(a.fetch.aufrufe.length, 1);
  const b = neu([SEITE1, { status: 403, body: { data: {}, message: 'nein', status: 403 } }], { speicher: angemeldet() });
  const r = await b.pb.liste('gewerke');
  assert.equal(r.ok, false); assert.equal(r.code, 'verboten');
});
test('eins', async () => {
  const { pb, fetch } = neu([{ status: 200, body: gewerk(1, 'k1f6zc9jvm4q9w6') }], { speicher: angemeldet() });
  const r = await pb.eins('gewerke', 'k1f6zc9jvm4q9w6');
  assert.equal(r.record.eid, 'g1');
  assert.equal(fetch.aufrufe[0].url, 'http://pb.test/api/collections/gewerke/records/k1f6zc9jvm4q9w6');
});
test('batch: Erfolg liefert die Antwortkörper in Reihenfolge; leer → kein Aufruf', async () => {
  const { pb, fetch } = neu([BATCH_OK], { speicher: angemeldet() });
  const anfragen = [{ method: 'POST', url: '/api/collections/plaene/records', body: { plan_id: 'planX' } }, { method: 'POST', url: '/api/collections/gewerke/records', body: { eid: 'g1' } }];
  const r = await pb.batch(anfragen);
  assert.equal(r.ok, true);
  assert.deepEqual(r.antworten.map((x) => x.rev), [1, 1]);
  assert.equal(r.antworten[1].eid, 'g1');
  assert.equal(fetch.aufrufe[0].url, 'http://pb.test/api/batch');
  assert.deepEqual(fetch.aufrufe[0].body, { requests: anfragen });
  assert.deepEqual(await pb.batch([]), { ok: true, antworten: [] });
  assert.equal(fetch.aufrufe.length, 1);
});
test('batch: rev-Konflikt (409 in der Unteranfrage) → {status:409, code:rev, eid, rev:Zahl, index}', async () => {
  const { pb } = neu([BATCH_409], { speicher: angemeldet() });
  const r = await pb.batch([{ method: 'PATCH', url: '/x', body: {} }]);
  assert.deepEqual(r, { ok: false, status: 409, code: 'rev', message: 'Der Eintrag wurde inzwischen geändert (rev 1).', eid: 'g1', rev: 1, index: 0 });
});
test('batch: anderer Unterfehler → eigener Status, code «fehler»; 401 im Batch meldet ab', async () => {
  const { pb } = neu([BATCH_REGEL, UNAUTH], { speicher: angemeldet() });
  const r = await pb.batch([{ method: 'POST', url: '/x', body: {} }]);
  assert.deepEqual(r, { ok: false, status: 400, code: 'fehler', message: 'Failed to create record.', index: 0 });
  let ab = 0; pb.on('abgemeldet', () => ab++);
  await pb.batch([{ method: 'POST', url: '/x', body: {} }]);
  assert.equal(ab, 1);
});
// Rate Limit (PocketBase 429): vorübergehend, eigener Code; auch als inneres 429 eines Batches (rollt alles zurück)
const LIMIT = { status: 429, body: { data: {}, message: 'Too Many Requests.', status: 429 } };
const BATCH_INNEN_429 = { status: 400, body: { data: { requests: { 20: { code: 'batch_request_failed', message: 'Batch request failed.', response: { data: {}, message: 'Too Many Requests.', status: 429 } } } }, message: 'Batch transaction failed.', status: 400 } };
test('429 → code «limit» (nie «fehler»), Anmeldung bleibt; auch das innere 429 eines Batches', async () => {
  const { pb } = neu([LIMIT, BATCH_INNEN_429, LIMIT], { speicher: angemeldet() });
  let ab = 0; pb.on('abgemeldet', () => ab++);
  assert.deepEqual(await pb.batch([{ method: 'POST', url: '/x', body: {} }]), { ok: false, status: 429, code: 'limit', message: 'Too Many Requests.' });
  assert.deepEqual(await pb.batch([{ method: 'POST', url: '/x', body: {} }]), { ok: false, status: 429, code: 'limit', message: 'Too Many Requests.', index: 20 });
  assert.equal((await pb.anmelden('a@b.c', 'x')).code, 'limit');
  assert.equal(pb.istAngemeldet, true);
  assert.equal(ab, 0);
});
test('Netzwerkfehler → {ok:false, status:0, code:netz}; Anmeldung bleibt', async () => {
  const { pb } = neu([new TypeError('fetch failed')], { speicher: angemeldet() });
  const r = await pb.post('/api/bzp/einladung', { token: 't' });
  assert.deepEqual(r, { ok: false, status: 0, code: 'netz', message: 'fetch failed' });
  assert.equal(pb.istAngemeldet, true);
});
test('post: Body und Authorization; 204 ohne Körper ist ok', async () => {
  const { pb, fetch } = neu([{ status: 200, body: { ok: true, plan_id: 'planX', rolle: 'bearbeiter' } }, { status: 204, body: null }], { speicher: angemeldet() });
  const r = await pb.post('/api/bzp/einladung', { token: 'abc' });
  assert.equal(r.daten.rolle, 'bearbeiter');
  assert.equal(fetch.aufrufe[0].headers.Authorization, TOKEN);
  assert.deepEqual(fetch.aufrufe[0].body, { token: 'abc' });
  assert.equal((await pb.post('/api/x', {})).ok, true);
});

// ── Ereignisse
test('on liefert off', async () => {
  const { pb } = neu([UNAUTH, UNAUTH], { speicher: angemeldet() });
  let n = 0; const off = pb.on('abgemeldet', () => n++);
  off();
  await pb.eins('a', 'b');
  assert.equal(n, 0);
});

// ── Realtime
const rt = async (o = {}) => {
  FakeES.alle.length = 0;
  const ctx = neu([{ status: 204, body: null }, { status: 204, body: null }, { status: 204, body: null }], { speicher: angemeldet(), ...o });
  const log = [], ereignisse = [];
  for (const n of ['verbunden', 'getrennt']) ctx.pb.on(n, () => log.push(n));
  const stop = ctx.pb.abo(['gewerke', 'vorgaenge'], (e) => ereignisse.push(e));
  return { ...ctx, log, ereignisse, stop, es: FakeES.alle[0] };
};
const warte = () => new Promise((r) => setImmediate(r));
test('abo: PB_CONNECT → POST /api/realtime mit clientId, subscriptions, Authorization → «verbunden»', async () => {
  const { es, fetch, log } = await rt();
  assert.equal(es.url, 'http://pb.test/api/realtime');
  assert.deepEqual(log, []);
  es.senden('PB_CONNECT', PB_CONNECT_DATA);
  await warte();
  const a = fetch.aufrufe[0];
  assert.equal(a.url, 'http://pb.test/api/realtime');
  assert.equal(a.method, 'POST');
  assert.equal(a.headers.Authorization, TOKEN);
  assert.deepEqual(a.body, { clientId: 'yiZg6WTl8vm53mFGvWPfRxxkf0EgbPXyZxXuQDLY', subscriptions: ['gewerke', 'vorgaenge'] });
  assert.deepEqual(log, ['verbunden']);
  assert.ok(PB_CONNECT.includes(PB_CONNECT_DATA)); // Konstante stammt aus dem Mitschnitt
});
test('abo: Ereignis wird als {thema, action, record} weitergereicht, kaputte Daten ignoriert', async () => {
  const { es, ereignisse } = await rt();
  es.senden('gewerke', SSE_EREIGNIS_DATA);
  es.senden('vorgaenge', 'kein json');
  es.senden('vorgaenge', '{"action":"delete"}');
  assert.equal(ereignisse.length, 1);
  assert.equal(ereignisse[0].thema, 'gewerke');
  assert.equal(ereignisse[0].action, 'update');
  assert.equal(ereignisse[0].record.rev, 2);
});
test('abo: Fehler → «getrennt» (einmal); neuer PB_CONNECT abonniert mit neuer clientId erneut → «verbunden»', async () => {
  const { es, fetch, log } = await rt();
  es.senden('PB_CONNECT', PB_CONNECT_DATA); await warte();
  es.onerror(); es.onerror();
  assert.deepEqual(log, ['verbunden', 'getrennt']);
  es.senden('PB_CONNECT', '{"clientId":"zweite"}'); await warte();
  assert.equal(fetch.aufrufe[1].body.clientId, 'zweite');
  assert.deepEqual(log, ['verbunden', 'getrennt', 'verbunden']);
});
test('abo: abgelehntes Abo → «getrennt», Verbindung zu, nach Wartezeit neu geöffnet; 401 meldet ab und öffnet nicht neu', async () => {
  const warten = [];
  const a = await rt({ setTimeout: (f, ms) => { warten.push({ f, ms }); return 1; }, clearTimeout() {}, wiederholenMs: 1234 });
  a.fetch.aufrufe.length = 0;
  const f1 = fakeFetch([{ status: 500, body: { message: 'boom', status: 500, data: {} } }]);
  // eigene Instanz mit scheiterndem Abo
  FakeES.alle.length = 0;
  const pb = createPb({ basis: 'http://pb.test', fetch: f1, speicher: angemeldet(), EventSource: FakeES, autostart: false, setTimeout: (f, ms) => { warten.push({ f, ms }); return 1; }, clearTimeout() {} });
  const log = []; pb.on('getrennt', () => log.push('getrennt'));
  pb.abo(['gewerke'], () => {});
  FakeES.alle[0].senden('PB_CONNECT', PB_CONNECT_DATA); await warte();
  assert.deepEqual(log, ['getrennt']);
  assert.equal(FakeES.alle[0].zu, true);
  const w = warten.at(-1);
  assert.equal(w.ms, 5000);
  w.f();
  assert.equal(FakeES.alle.length, 2);
  // 401
  FakeES.alle.length = 0; warten.length = 0;
  const pb2 = createPb({ basis: 'http://pb.test', fetch: fakeFetch([UNAUTH]), speicher: angemeldet(), EventSource: FakeES, autostart: false, setTimeout: (f, ms) => { warten.push(ms); return 1; }, clearTimeout() {} });
  let ab = 0; pb2.on('abgemeldet', () => ab++);
  pb2.abo(['gewerke'], () => {});
  FakeES.alle[0].senden('PB_CONNECT', PB_CONNECT_DATA); await warte();
  assert.equal(ab, 1); assert.equal(warten.length, 0); assert.equal(FakeES.alle.length, 1);
});
test('abo: stop schließt die Verbindung, danach kommt nichts mehr an', async () => {
  const { es, stop, log } = await rt();
  stop();
  assert.equal(es.zu, true);
  es.senden('PB_CONNECT', PB_CONNECT_DATA); await warte();
  assert.deepEqual(log, []);
});


// ── Fix-Runde 1: Rennen, abmelden, Antwortformen
// Anfrage, die erst auf Zuruf antwortet
const offen = () => { let los; const p = new Promise((r) => { los = r; }); return { p, los }; };
const gesteuert = (...hold) => {
  const aufrufe = [];
  const f = async (url, opt = {}) => { aufrufe.push({ url, headers: opt.headers || {} }); const h = hold.shift(); return antwort(await h.p); };
  f.aufrufe = aufrufe; return f;
};
const AUTH2 = { status: 200, body: { record: RECORD, token: 'TOKEN-PLATZHALTER-ZWEI' } };

test('Race: abmelden während laufender Erneuerung → danach weder Token noch Sitzung', async () => {
  const h = offen();
  const speicher = angemeldet();
  const pb = createPb({ basis: 'http://pb.test', fetch: gesteuert(h), speicher, EventSource: FakeES, autostart: false });
  const lauf = pb.erneuern();
  pb.abmelden();
  h.los(REFRESH);
  const r = await lauf;
  assert.equal(r.ok, false); assert.equal(r.code, 'abgebrochen');
  assert.equal(pb.auth, null); assert.equal(pb.istAngemeldet, false);
  assert.equal(speicher.getItem(AUTH_KEY), null);
});
test('Race: abmelden während laufender Anmeldung → die Sitzung lebt nicht wieder auf', async () => {
  const h = offen();
  const speicher = fakeSpeicher();
  const pb = createPb({ basis: 'http://pb.test', fetch: gesteuert(h), speicher, EventSource: FakeES, autostart: false });
  const lauf = pb.anmelden('sa@bzp.test', 'pw');
  pb.abmelden();
  h.los(AUTH);
  assert.equal((await lauf).code, 'abgebrochen');
  assert.equal(pb.auth, null); assert.equal(speicher.getItem(AUTH_KEY), null);
});
test('Anmeldung ersetzt bewusst eine bestehende Sitzung', async () => {
  const { pb } = neu([AUTH2], { speicher: angemeldet() });
  assert.equal((await pb.anmelden('sa@bzp.test', 'pw')).ok, true);
  assert.equal(pb.auth.token, 'TOKEN-PLATZHALTER-ZWEI');
});
test('Race: spätes 401 einer alten Anfrage beendet die neue Sitzung nicht', async () => {
  const h = offen(), h2 = offen();
  const pb = createPb({ basis: 'http://pb.test', fetch: gesteuert(h, h2), speicher: angemeldet(), EventSource: FakeES, autostart: false });
  const gründe = []; pb.on('abgemeldet', (e) => gründe.push(e.grund));
  const alt = pb.eins('gewerke', 'x');       // läuft mit TOKEN
  const anm = pb.anmelden('sa@bzp.test', 'pw'); // ersetzt die Sitzung
  h2.los(AUTH2); await anm;
  assert.equal(pb.auth.token, 'TOKEN-PLATZHALTER-ZWEI');
  h.los(UNAUTH);                                // 401 der alten Anfrage kommt jetzt
  assert.equal((await alt).code, 'auth');
  assert.equal(pb.auth.token, 'TOKEN-PLATZHALTER-ZWEI');
  assert.deepEqual(gründe, []);
});
test('Race: spätes 401 nach einer Token-Erneuerung (anderes Token) beendet nicht', async () => {
  const h = offen();
  const f = gesteuert(h, { p: Promise.resolve(REFRESH) });
  const pb = createPb({ basis: 'http://pb.test', fetch: f, speicher: angemeldet(), EventSource: FakeES, autostart: false });
  const alt = pb.eins('gewerke', 'x');
  await pb.erneuern();
  h.los(UNAUTH); await alt;
  assert.equal(pb.auth.token, TOKEN2);
});
test('abmelden: Ereignis {grund:manuell} und alle Abos werden geschlossen', async () => {
  FakeES.alle.length = 0;
  const { pb } = neu([], { speicher: angemeldet() });
  const gründe = []; pb.on('abgemeldet', (e) => gründe.push(e.grund));
  pb.abo(['gewerke'], () => {}); pb.abo(['vorgaenge'], () => {});
  assert.equal(FakeES.alle.length, 2);
  pb.abmelden();
  assert.deepEqual(gründe, ['manuell']);
  assert.ok(FakeES.alle.every((e) => e.zu));
});
test('401 beendet ebenfalls die Abos; Ereignis {grund:"401"}', async () => {
  FakeES.alle.length = 0;
  const { pb } = neu([UNAUTH], { speicher: angemeldet() });
  const gründe = []; pb.on('abgemeldet', (e) => gründe.push(e.grund));
  pb.abo(['gewerke'], () => {});
  await pb.eins('a', 'b');
  assert.deepEqual(gründe, ['401']);
  assert.ok(FakeES.alle[0].zu);
});
test('2xx mit Nicht-JSON oder falscher Form wirft nie → code «antwort»', async () => {
  const html = { status: 200, raw: '<html>Captive Portal</html>' };
  const { pb } = neu([html, html, html, html, html, html, { status: 200, body: {} }, { status: 200, body: { token: '' } }, { status: 200, body: { items: 'x' } }, { status: 200, body: { items: [] } }], { speicher: angemeldet() });
  for (const r of [await pb.liste('gewerke'), await pb.eins('g', 'x'), await pb.batch([{}]), await pb.post('/x', {}), await pb.anmelden('a@b.c', 'pw'), await pb.erneuern()]) {
    assert.equal(r.ok, false); assert.equal(r.code, 'antwort');
  }
  assert.equal(pb.istAngemeldet, true); // nichts überschrieben
  assert.equal((await pb.anmelden('a@b.c', 'pw')).code, 'antwort'); // Token fehlt
  assert.equal((await pb.erneuern()).code, 'antwort');              // leeres Token
  assert.equal((await pb.liste('g')).code, 'antwort');              // items kein Array
  assert.equal((await pb.batch([{}])).code, 'antwort');             // Batch-Antwort kein Array
  assert.equal(pb.auth.token, TOKEN);
});
test('liste: fehlendes totalPages → ein Aufruf, keine Endlosschleife', async () => {
  const ohne = { status: 200, body: { items: [gewerk(1, 'a'), gewerk(2, 'b')], page: 1, perPage: 2, totalItems: 5 } };
  const { pb, fetch } = neu([ohne], { speicher: angemeldet() });
  const r = await pb.liste('gewerke');
  assert.equal(r.ok, true); assert.equal(r.items.length, 2); assert.equal(fetch.aufrufe.length, 1);
});
test('liste: kurze Seite beendet, harte Obergrenze 1000 Seiten', async () => {
  const kurz = { status: 200, body: { items: [gewerk(1, 'a')], page: 1, perPage: 500, totalItems: 900, totalPages: 2 } };
  const a = neu([kurz], { speicher: angemeldet() });
  assert.equal((await a.pb.liste('gewerke')).ok, true); assert.equal(a.fetch.aufrufe.length, 1);
  let n = 0;
  const endlos = async () => { n++; return antwort({ status: 200, body: { items: [gewerk(1, 'a'), gewerk(2, 'b')], page: n, perPage: 2, totalItems: 1e9, totalPages: 1e9 } }); };
  const pb = createPb({ basis: 'http://pb.test', fetch: endlos, speicher: angemeldet(), EventSource: FakeES, autostart: false });
  const r = await pb.liste('gewerke');
  assert.equal(r.code, 'antwort'); assert.equal(n, 1000);
});
test('abo: EventSource CLOSED → selbst neu verbinden, Backoff verdoppelt bis 60 s', async () => {
  FakeES.alle.length = 0;
  const warten = [];
  const { pb } = neu([], { speicher: angemeldet(), setTimeout: (f, ms) => { warten.push({ f, ms }); return warten.length; }, clearTimeout() {} });
  const log = []; pb.on('getrennt', () => log.push('g'));
  pb.abo(['gewerke'], () => {});
  const ms = [];
  for (let i = 0; i < 6; i++) {
    const es = FakeES.alle.at(-1); es.readyState = 2; es.onerror();
    const w = warten.at(-1); ms.push(w.ms); w.f();
  }
  assert.deepEqual(ms, [5000, 10000, 20000, 40000, 60000, 60000]);
  assert.equal(FakeES.alle.length, 7);
  assert.deepEqual(log, ['g']);
  // CONNECTING (readyState 0): Browser verbindet selbst, wir tun nichts
  const n = warten.length; const es = FakeES.alle.at(-1); es.readyState = 0; es.onerror();
  assert.equal(warten.length, n);
});
test('abo: 403 beim Abonnieren → getrennt, Verbindung zu, KEIN Wiederholen', async () => {
  FakeES.alle.length = 0;
  const warten = [];
  const { pb } = neu([{ status: 403, body: { data: {}, message: 'nein', status: 403 } }], { speicher: angemeldet(), setTimeout: (f, ms) => { warten.push(ms); return 1; }, clearTimeout() {} });
  const log = []; pb.on('getrennt', () => log.push('g'));
  pb.abo(['gewerke'], () => {});
  FakeES.alle[0].senden('PB_CONNECT', PB_CONNECT_DATA); await warte();
  assert.deepEqual(log, ['g']); assert.ok(FakeES.alle[0].zu);
  assert.equal(warten.length, 0); assert.equal(FakeES.alle.length, 1);
});

// ── Struktursperre: DOM-frei, keine Browser-Dialoge, kein Token im Code
test('pb.js: keine DOM-/Dialog-Zugriffe, kein Direktzugriff auf localStorage/window/document', () => {
  const q = readFileSync(new URL('../js/pb.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const m of [/\bwindow\b/, /\bdocument\b/, /(?<!globalThis\.)\blocalStorage\b/, /\balert\s*\(/, /\bconfirm\s*\(/, /[^.\w]prompt\s*\(/, /eyJ[A-Za-z0-9_-]{20,}/]) assert.ok(!m.test(q), String(m));
  const t = readFileSync(new URL('./pb.test.mjs', import.meta.url), 'utf8');
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(t), 'echtes Token im Test');
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
