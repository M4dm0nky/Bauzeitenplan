// Serverplan (js/server.js) gegen einen gefälschten pb mit Datenformen wie der echte Server
// (Mitschnitt: tests/pb.test.mjs): Datensätze mit id/plan_id/eid/daten/rev/pos, Batch-Fehler
// als {ok:false, status:409, code:'rev', eid, rev, index}.
import { createServerPlan, listePlaene } from '../js/server.js';
import { aenderungen, zerlegen } from '../js/aenderungen.js';
import { createStore } from '../js/store.js';
import { deserialize } from '../js/persistence.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const plan = (n) => deserialize(readFileSync(new URL('../tools/fixtures/' + n + '.json', import.meta.url), 'utf8')).plan;
const KT = plan('klassentreffen-festival');
const AMK = plan('amk-singleshow');
const kl = (x) => JSON.parse(JSON.stringify(x));
const ME = { id: 'u1', superadmin: false };

// Gefälschter Server: Records + Batch mit rev-Prüfung, Reihenfolge-Protokoll, Realtime-Hörer
function fakePb({ user = ME } = {}) {
  const recs = []; // {collectionName, id, plan_id, eid, daten, rev, pos}
  let n = 0;
  const f = {
    recs, aufrufe: [], hoerer: null, netz: false, auth: { token: 'T', record: user }, erneuert: 0, erneuernErgebnis: { ok: true },
    async erneuern() { f.erneuert++; return f.erneuernErgebnis; },
    async liste(coll, filter = '') {
      if (f.netz) return { ok: false, status: 0, code: 'netz', message: 'x' };
      const pid = /plan_id="([^"]*)"/.exec(filter)?.[1];
      const eid = /eid="([^"]*)"/.exec(filter)?.[1];
      const items = recs.filter((r) => r.collectionName === coll && (!pid || r.plan_id === pid) && (eid === undefined || r.eid === eid))
        .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
      return { ok: true, items: kl(items), total: items.length };
    },
    async batch(reqs) {
      f.aufrufe.push(kl(reqs));
      if (f.netz) return { ok: false, status: 0, code: 'netz', message: 'x' };
      const vorher = kl(recs); const out = [];
      for (let index = 0; index < reqs.length; index++) {
        const q = reqs[index];
        const [, coll, rid] = /collections\/(\w+)\/records\/?(\w*)/.exec(q.url);
        const fehler = (status, code, extra = {}) => { recs.splice(0, recs.length, ...vorher); return { ok: false, status, code, message: 'm', index, ...extra }; };
        if (q.method === 'POST') {
          if (recs.some((r) => r.collectionName === coll && r.plan_id === q.body.plan_id && r.eid === q.body.eid)) return fehler(400, 'fehler');
          const r = { collectionName: coll, id: 'id' + ++n, eid: q.body.plan_id, ...q.body, rev: 1 };
          if (coll === 'plaene') { r.besitzer = user.id; delete r.eid; }
          recs.push(r); out.push(kl(r));
        } else {
          const r = recs.find((x) => x.id === rid);
          const rev = q.method === 'DELETE' ? Number(/rev=(\d+)/.exec(q.url)?.[1]) : q.body.rev;
          if (!r) return fehler(404, 'fehler');
          if (r.rev !== rev) return fehler(409, 'rev', { eid: r.eid, rev: r.rev });
          if (q.method === 'DELETE') { recs.splice(recs.indexOf(r), 1); out.push(null); } else { Object.assign(r, q.body, { rev: r.rev + 1 }); out.push(kl(r)); }
        }
      }
      return { ok: true, antworten: out };
    },
    abo(themen, fn) { f.hoerer = fn; f.themen = themen; return () => { f.hoerer = null; }; },
  };
  return f;
}
const holen = async (state) => {
  const pb = fakePb();
  const sp = createServerPlan({ pb, planId: 'x' });
  const r = await sp.planAnlegen(state);
  assert.ok(r.ok);
  return { pb, sp: createServerPlan({ pb, planId: r.planId }), planId: r.planId, state: r.state };
};
const entfernen = (pb, coll, eid) => pb.recs.splice(pb.recs.findIndex((r) => r.collectionName === coll && r.eid === eid), 1);

test('planAnlegen + laden: Rundweg ist deepEqual (Klassentreffen), neue plan_id, Token vorher erneuert', async () => {
  const { pb, sp, planId, state } = await holen(KT);
  assert.notEqual(planId, KT.project.id);
  assert.equal(state.project.id, planId);
  const r = await sp.laden();
  assert.ok(r.ok);
  assert.deepEqual(r.state, state);
  assert.equal(pb.erneuert, 1);
});
test('planAnlegen + laden: Rundweg (AMK: Verknüpfungen, Phasen, Ressourcen)', async () => {
  const { sp, state } = await holen(AMK);
  assert.deepEqual((await sp.laden()).state, state);
});
test('planAnlegen: Batch-Reihenfolge plaene → gewerke → ressourcen → phasen → vorgaenge (Eltern zuerst) → verknuepfungen; Spalten gleich daten', async () => {
  const mit = kl(AMK);
  const kind = mit.tasks.find((t) => !t.parent);
  mit.tasks.unshift({ ...kl(kind), id: 'kind1', parent: kind.id, title: 'Kind' });
  const { pb } = await holen(mit);
  const reqs = pb.aufrufe[0];
  const colls = reqs.map((q) => /collections\/(\w+)/.exec(q.url)[1]);
  const rang = ['plaene', 'gewerke', 'ressourcen', 'phasen', 'vorgaenge', 'verknuepfungen'];
  assert.deepEqual(colls, [...colls].sort((a, b) => rang.indexOf(a) - rang.indexOf(b)));
  const vg = reqs.filter((q) => q.url.includes('/vorgaenge/'));
  assert.ok(vg.findIndex((q) => q.body.eid === 'kind1') > vg.findIndex((q) => q.body.eid === kind.id), 'Kind nach Elternvorgang');
  for (const q of vg) assert.deepEqual([q.body.gewerk, q.body.eid], [q.body.daten.gewerk, q.body.daten.id]);
  for (const q of reqs.filter((q) => q.url.includes('/verknuepfungen/'))) assert.deepEqual([q.body.von, q.body.nach], [q.body.daten.from, q.body.daten.to]);
  assert.ok(reqs.every((q) => q.body.rev === 1));
});
test('planAnlegen: mehr als 1000 Anfragen gehen in Stücken, laden gibt trotzdem alles zurück', async () => {
  const gross = kl(KT);
  for (let i = 0; i < 700; i++) gross.tasks.push({ ...kl(gross.tasks[0]), id: 'z' + i });
  const { pb, sp, state } = await holen(gross);
  assert.ok(pb.aufrufe.length >= 2 && pb.aufrufe.every((a) => a.length <= 1000));
  assert.deepEqual((await sp.laden()).state, state);
});
test('laden: Token-Fehler → abgemeldet, offline → offline, kein Plan → nichtGefunden', async () => {
  const { pb, sp } = await holen(KT);
  pb.erneuernErgebnis = { ok: false, status: 401, code: 'auth' };
  assert.deepEqual(await sp.laden(), { ok: false, abgemeldet: true });
  pb.erneuernErgebnis = { ok: false, status: 0, code: 'netz' };
  assert.deepEqual(await sp.laden(), { ok: false, offline: true });
  pb.erneuernErgebnis = { ok: true }; pb.netz = true;
  assert.deepEqual(await sp.laden(), { ok: false, offline: true });
  pb.netz = false; pb.recs.length = 0;
  assert.deepEqual(await sp.laden(), { ok: false, nichtGefunden: true });
});
test('laden: Rolle (besitzer, superadmin, mitglied mit Gewerken, keine) und Mitglieder', async () => {
  const { pb, sp, planId } = await holen(KT);
  assert.deepEqual((await sp.laden()).rolle, { rolle: 'besitzer', gewerke: [] });
  pb.recs.find((r) => r.collectionName === 'plaene').besitzer = 'anderer';
  assert.equal((await sp.laden()).rolle, null);
  pb.auth.record = { id: 'u1', superadmin: true };
  assert.equal((await sp.laden()).rolle.rolle, 'superadmin');
  pb.auth.record = ME;
  pb.recs.push({ collectionName: 'mitglieder', id: 'm1', plan_id: planId, user_id: 'u1', rolle: 'gewerkeleiter', gewerke: ['g1'] });
  const r = await sp.laden();
  assert.deepEqual(r.rolle, { rolle: 'gewerkeleiter', gewerke: ['g1'] });
  assert.deepEqual(r.mitglieder, [{ user_id: 'u1', rolle: 'gewerkeleiter', gewerke: ['g1'] }]);
});
test('senden: Änderung eines Vorgangs → ein PATCH mit rev, danach stimmt der Server', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  const nach = kl(state); nach.tasks[3].title = 'Neu';
  pb.aufrufe.length = 0;
  assert.deepEqual(await sp.senden(aenderungen(state, nach)), { ok: true });
  assert.equal(pb.aufrufe[0].length, 1);
  assert.equal(pb.aufrufe[0][0].method, 'PATCH');
  assert.equal(pb.aufrufe[0][0].body.rev, 1);
  assert.deepEqual((await sp.laden()).state, nach);
  // zweites Senden nutzt die neue rev (2) aus der Antwort
  const nach2 = kl(nach); nach2.tasks[3].title = 'Noch neuer';
  assert.deepEqual(await sp.senden(aenderungen(nach, nach2)), { ok: true });
  assert.equal(pb.aufrufe[1][0].body.rev, 2);
});
test('senden: Löschen mit ?rev, Reihenfolge Verknüpfung → Vorgang → Ressource → Gewerk; Anlegen vor Ändern vor Löschen', async () => {
  const { pb, sp, state } = await holen(AMK);
  await sp.laden();
  const g = state.gewerke.find((x) => state.tasks.some((t) => t.gewerk === x.id) && !state.tasks.every((t) => t.gewerk === x.id));
  const nach = kl(state);
  nach.tasks = nach.tasks.filter((t) => t.gewerk !== g.id);
  nach.deps = nach.deps.filter((d) => nach.tasks.some((t) => t.id === d.from) && nach.tasks.some((t) => t.id === d.to));
  nach.gewerke = nach.gewerke.filter((x) => x.id !== g.id);
  pb.aufrufe.length = 0;
  const r = await sp.senden(aenderungen(state, nach));
  assert.ok(r.ok, JSON.stringify(r));
  const reqs = pb.aufrufe[0];
  assert.ok(reqs.every((q) => q.method === 'DELETE' && /\?rev=1$/.test(q.url)));
  const colls = reqs.map((q) => /collections\/(\w+)/.exec(q.url)[1]);
  const rang = ['verknuepfungen', 'vorgaenge', 'phasen', 'ressourcen', 'gewerke', 'plaene'];
  assert.deepEqual(colls, [...colls].sort((a, b) => rang.indexOf(a) - rang.indexOf(b)));
  assert.equal(colls.at(-1), 'gewerke');
  assert.deepEqual((await sp.laden()).state, nach);
});
test('senden: neuer Vorgang in neuem Gewerk → Gewerk zuerst; Gewerkwechsel Elternvorgang vor Kind', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  const nach = kl(state);
  const e = nach.tasks.find((t) => t.gewerk === 'g8');
  nach.gewerke.push({ ...kl(nach.gewerke[0]), id: 'gneu', name: 'Neu' });
  nach.tasks.push({ ...kl(e), id: 'tneu', gewerk: 'gneu' });
  nach.tasks.push({ ...kl(e), id: 'kneu', gewerk: 'gneu', parent: 'tneu' });
  pb.aufrufe.length = 0;
  assert.ok((await sp.senden(aenderungen(state, nach))).ok);
  const urls = pb.aufrufe[0].map((q) => (q.body.eid || q.url));
  assert.ok(urls.indexOf('gneu') < urls.indexOf('tneu') && urls.indexOf('tneu') < urls.indexOf('kneu'));
  // Wechsel: Kind (kneu) steht in der Änderungsliste VOR dem Elternvorgang → Eltern trotzdem zuerst
  const wechsel = kl(nach);
  wechsel.tasks = [wechsel.tasks.at(-1), ...wechsel.tasks.slice(0, -1)];
  for (const t of wechsel.tasks) if (t.id === 'tneu' || t.id === 'kneu') t.gewerk = 'g8';
  pb.aufrufe.length = 0;
  assert.ok((await sp.senden(aenderungen(nach, wechsel))).ok);
  const pa = pb.aufrufe[0].map((q) => q.body.daten.id);
  assert.deepEqual(pa, ['tneu', 'kneu']);
});
test('Konflikt: fremde Änderung → {konflikt:[{coll,eid,art,fremd}]} mit dem fremden Stand, Server unverändert', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  const rec = pb.recs.find((r) => r.collectionName === 'vorgaenge' && r.eid === state.tasks[0].id);
  rec.daten = { ...rec.daten, title: 'Fremd' }; rec.rev = 2;
  const nach = kl(state); nach.tasks[0].title = 'Meins';
  const a = aenderungen(state, nach);
  const r = await sp.senden(a);
  assert.equal(r.ok, false);
  assert.deepEqual(r.konflikt, [{ coll: 'vorgaenge', eid: state.tasks[0].id, art: 'aendern', fremd: rec.daten, rev: 2 }]);
  assert.deepEqual(r.aend, a);
  assert.equal(rec.daten.title, 'Fremd');
  assert.equal(sp.offen.length, 0);
});
test('Konflikt: fremd gelöscht → fremd null; Löschen eines fremd geänderten → Konflikt', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  entfernen(pb, 'vorgaenge', state.tasks[1].id);
  const nach = kl(state); nach.tasks[1].title = 'x';
  const r = await sp.senden(aenderungen(state, nach));
  assert.equal(r.konflikt[0].fremd, null);
  pb.recs.find((x) => x.eid === state.tasks[2].id).rev = 5;
  const nach2 = kl(state); nach2.tasks.splice(2, 1);
  const r2 = await sp.senden(aenderungen(state, nach2));
  assert.equal(r2.konflikt[0].art, 'loeschen');
  assert.equal(r2.konflikt[0].fremd.id, state.tasks[2].id);
});
test('Konflikt: Anlegen eines inzwischen vorhandenen Datensatzes → art «existiert»', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  const nach = kl(state); nach.tasks.push({ ...kl(nach.tasks[0]), id: 'doppelt' });
  pb.recs.push({ collectionName: 'vorgaenge', id: 'fr', plan_id: state.project.id, eid: 'doppelt', daten: { id: 'doppelt', fremd: 1 }, rev: 1, pos: 9 });
  const r = await sp.senden(aenderungen(state, nach));
  assert.equal(r.konflikt[0].art, 'existiert');
  assert.deepEqual(r.konflikt[0].fremd, { id: 'doppelt', fremd: 1 });
});
test('Update eines unbekannten Datensatzes: wird nachgeschlagen; fehlt er → Konflikt «geloescht»', async () => {
  const { pb, sp, state } = await holen(KT); // laden() nie aufgerufen, stand leer (anderer sp) → planAnlegen-sp kennt ihn, neuer nicht
  const nach = kl(state); nach.tasks[0].title = 'a';
  assert.ok((await sp.senden(aenderungen(state, nach))).ok);
  const nach2 = kl(nach); nach2.tasks[0].title = 'b';
  entfernen(pb, 'vorgaenge', state.tasks[0].id);
  const r = await sp.senden(aenderungen(nach, nach2));
  assert.deepEqual(r.konflikt, [{ coll: 'vorgaenge', eid: state.tasks[0].id, art: 'geloescht', fremd: null }]);
});
test('Realtime: Fremdes kommt als {coll,eid,objekt}, Löschen als objekt null, andere Pläne und alte rev nicht', async () => {
  const { pb, sp, planId, state } = await holen(KT);
  await sp.laden();
  const got = [];
  sp.abonnieren((t) => got.push(t));
  assert.deepEqual(pb.themen, ['plaene', 'ressourcen', 'gewerke', 'vorgaenge', 'phasen', 'verknuepfungen']);
  const rec = { collectionName: 'vorgaenge', plan_id: planId, eid: state.tasks[0].id, id: 'r', rev: 2, daten: { id: state.tasks[0].id, title: 'F' } };
  pb.hoerer({ thema: 'vorgaenge', action: 'update', record: rec });
  pb.hoerer({ thema: 'vorgaenge', action: 'update', record: { ...rec, plan_id: 'anderer' } });
  pb.hoerer({ thema: 'vorgaenge', action: 'update', record: { ...rec, rev: 1 } }); // alt
  assert.deepEqual(got, [{ coll: 'vorgaenge', eid: state.tasks[0].id, objekt: rec.daten }]);
  pb.hoerer({ thema: 'vorgaenge', action: 'delete', record: rec });
  assert.deepEqual(got[1], { coll: 'vorgaenge', eid: state.tasks[0].id, objekt: null });
  pb.hoerer({ thema: 'plaene', action: 'update', record: { plan_id: planId, id: 'p', rev: 9, daten: { name: 'P' } } });
  assert.deepEqual(got[2], { coll: 'plaene', eid: planId, objekt: { name: 'P' } });
});
test('Realtime: eigenes Echo (coll+eid+rev) wird verschluckt, auch wenn es VOR der Antwort kommt', async () => {
  const { pb, sp, planId, state } = await holen(KT);
  await sp.laden();
  const got = [];
  sp.abonnieren((t) => got.push(t));
  const orig = pb.batch;
  pb.batch = async (reqs) => { // Ereignis trifft vor der Batch-Antwort ein
    const r = await orig(reqs);
    const rec = pb.recs.find((x) => x.eid === state.tasks[0].id);
    pb.hoerer({ thema: 'vorgaenge', action: 'update', record: kl(rec) });
    return r;
  };
  const nach = kl(state); nach.tasks[0].title = 'Eigen';
  assert.ok((await sp.senden(aenderungen(state, nach))).ok);
  assert.deepEqual(got, []);
  // ein FREMDES Update mit der nächsten rev wird gemeldet
  const rec = kl(pb.recs.find((x) => x.eid === state.tasks[0].id));
  pb.hoerer({ thema: 'vorgaenge', action: 'update', record: { ...rec, rev: rec.rev + 1 } });
  assert.equal(got.length, 1);
  // und die rev im Stand ist nachgezogen: nächstes Senden nutzt sie
  pb.batch = orig;
  pb.recs.find((x) => x.eid === state.tasks[0].id).rev = rec.rev + 1;
  const nach2 = kl(nach); nach2.tasks[0].title = 'Nochmal';
  assert.ok((await sp.senden(aenderungen(nach, nach2))).ok);
});
test('Realtime: stop beendet, neuAbonnieren baut neu auf, ohne Handler nichts', async () => {
  const { pb, sp } = await holen(KT);
  const stop = sp.abonnieren(() => {});
  assert.ok(pb.hoerer);
  stop();
  assert.equal(pb.hoerer, null);
  sp.neuAbonnieren();
  assert.equal(pb.hoerer, null);
  sp.abonnieren(() => {});
  pb.hoerer = null;
  sp.neuAbonnieren();
  assert.ok(pb.hoerer);
});
test('Offline: Änderung bleibt in offen, weitere hängen sich an, wiederVerbunden sendet der Reihe nach', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.netz = true;
  const a = kl(state); a.tasks[0].title = 'A';
  const b = kl(a); b.tasks[0].title = 'B';
  const a1 = aenderungen(state, a), a2 = aenderungen(a, b);
  assert.deepEqual(await sp.senden(a1), { ok: false, offline: true });
  assert.deepEqual(await sp.senden(a2), { ok: false, offline: true });
  assert.equal(sp.offen.length, 2);
  pb.netz = false;
  pb.aufrufe.length = 0;
  assert.deepEqual(await sp.wiederVerbunden(), { ok: true });
  assert.equal(sp.offen.length, 0);
  assert.deepEqual(pb.aufrufe.map((x) => x[0].body.rev), [1, 2]);
  assert.deepEqual((await sp.laden()).state, b);
});
test('Offline: Anlegen und danach Ändern desselben Eintrags in der Schlange', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.netz = true;
  const a = kl(state); a.gewerke.push({ ...kl(a.gewerke[0]), id: 'gx', name: 'X' });
  const b = kl(a); b.gewerke.at(-1).name = 'Y';
  await sp.senden(aenderungen(state, a)); await sp.senden(aenderungen(a, b));
  pb.netz = false;
  assert.ok((await sp.wiederVerbunden()).ok);
  assert.deepEqual((await sp.laden()).state, b);
});
test('Warteschlange bei Konflikt: der Eintrag kommt zurück, der Rest bleibt liegen', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.netz = true;
  const a = kl(state); a.tasks[0].title = 'A';
  const b = kl(a); b.tasks[5].title = 'B';
  const a1 = aenderungen(state, a), a2 = aenderungen(a, b);
  await sp.senden(a1); await sp.senden(a2);
  pb.netz = false;
  pb.recs.find((x) => x.eid === state.tasks[0].id).rev = 3; // fremd geändert
  const r = await sp.wiederVerbunden();
  assert.equal(r.ok, false);
  assert.equal(r.konflikt[0].eid, state.tasks[0].id);
  assert.deepEqual(r.aend, a1);
  assert.deepEqual(sp.offen, [a2]);
  assert.equal(r.offen, 1);
  sp.offenVerwerfen();
  assert.deepEqual(sp.offen, []);
});
test('Abgemeldet beim Senden (401): Änderung bleibt in offen', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.batch = async () => ({ ok: false, status: 401, code: 'auth', message: 'x' });
  const a = kl(state); a.tasks[0].title = 'A';
  assert.deepEqual(await sp.senden(aenderungen(state, a)), { ok: false, abgemeldet: true });
  assert.equal(sp.offen.length, 1);
});
test('Anderer Fehler (403): {fehler} samt aend, nicht in der Schlange', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.batch = async () => ({ ok: false, status: 403, code: 'verboten', message: 'Nein', index: 0 });
  const a = kl(state); a.tasks[0].title = 'A';
  const r = await sp.senden(aenderungen(state, a));
  assert.deepEqual(r.fehler, { status: 403, code: 'verboten', message: 'Nein' });
  assert.equal(sp.offen.length, 0);
});
test('Leere Änderung: ok ohne Aufruf; Store-Rundlauf (applyRemote-Daten aus dem Server)', async () => {
  const { pb, sp, state } = await holen(KT);
  pb.aufrufe.length = 0;
  assert.deepEqual(await sp.senden(aenderungen(state, kl(state))), { ok: true });
  assert.equal(pb.aufrufe.length, 0);
  const store = createStore(kl(state));
  assert.deepEqual(zerlegen(store.state).vorgaenge.size, state.tasks.length);
});
test('planLoeschen: löscht mit ?rev, danach laden → nichtGefunden', async () => {
  const { pb, sp } = await holen(KT);
  await sp.laden();
  pb.aufrufe.length = 0;
  const orig = pb.batch;
  pb.batch = async (reqs) => { const r = await orig(reqs); pb.recs.length = 0; return r; }; // Hook-Kaskade
  assert.deepEqual(await sp.planLoeschen(), { ok: true });
  assert.match(pb.aufrufe[0][0].url, /\/plaene\/records\/\w+\?rev=1$/);
  assert.deepEqual(await sp.laden(), { ok: false, nichtGefunden: true });
});
test('planAnlegen scheitert → Fehler zurück, alte plan_id bleibt (laden liefert den alten Plan)', async () => {
  const { pb, sp, state } = await holen(KT);
  const orig = pb.batch;
  pb.batch = async () => ({ ok: false, status: 403, code: 'verboten', message: 'x', index: 0 });
  const r = await sp.planAnlegen(AMK);
  assert.equal(r.ok, false);
  assert.equal(r.fehler.status, 403);
  pb.batch = orig;
  assert.deepEqual((await sp.laden()).state, state);
});
test('listePlaene: name, venue, Rolle aus besitzer/superadmin/mitglieder; Token zuerst erneuert; Fehler wirft', async () => {
  const pb = fakePb();
  pb.recs.push({ collectionName: 'plaene', plan_id: 'a', besitzer: 'u1', daten: { name: 'A', venue: 'V' }, rev: 1 },
    { collectionName: 'plaene', plan_id: 'b', besitzer: 'x', daten: { name: 'B' }, rev: 1 },
    { collectionName: 'plaene', plan_id: 'c', besitzer: 'x', daten: { name: 'C' }, rev: 1 },
    { collectionName: 'mitglieder', plan_id: 'b', user_id: 'u1', rolle: 'betrachter', gewerke: [] });
  assert.deepEqual(await listePlaene(pb), [
    { plan_id: 'a', name: 'A', venue: 'V', rolle: 'besitzer' },
    { plan_id: 'b', name: 'B', venue: '', rolle: 'betrachter' },
    { plan_id: 'c', name: 'C', venue: '', rolle: null },
  ]);
  assert.equal(pb.erneuert, 1);
  pb.erneuernErgebnis = { ok: false, status: 401, code: 'auth' };
  await assert.rejects(listePlaene(pb), (e) => e.abgemeldet === true);
  pb.erneuernErgebnis = { ok: false, status: 0, code: 'netz' };
  await assert.rejects(listePlaene(pb), (e) => e.offline === true);
});
test('server.js: DOM-frei, keine Browser-Dialoge, kein Token', () => {
  const s = readFileSync(new URL('../js/server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(s, /\b(window|document|localStorage)\b|\bprompt\(|\bconfirm\(|\balert\(|eyJ/);
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n      ')); }
}
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
