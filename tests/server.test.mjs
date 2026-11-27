// Serverplan (js/server.js) gegen einen gefälschten pb mit Datenformen wie der echte Server
// (Mitschnitt: tests/pb.test.mjs): Datensätze mit id/plan_id/eid/daten/rev/pos, Batch-Fehler
// als {ok:false, status:409, code:'rev', eid, rev, index}.
import { createServerPlan as erzeuge, listePlaene, ladeBackoff, BATCH_ABSTAND_MS, BACKOFF_MS, PLAN_VERSUCHE, LIMIT_VERSUCHE } from '../js/server.js';
import { aenderungen, zerlegen } from '../js/aenderungen.js';
import { huellenKonflikte, fremdUebernehmen, ohne } from '../js/konflikt.js';
import { createStore } from '../js/store.js';
import { deserialize } from '../js/persistence.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Ohne eigenes `warte` wartet die Prüfung nie wirklich (Drossel und Backoff sonst echte Sekunden)
const createServerPlan = (o) => erzeuge({ warte: async () => {}, ...o });

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
    recs, aufrufe: [], hoerer: null, netz: false, limit: 0, limitInnen: false, auth: { token: 'T', record: user }, erneuert: 0, erneuernErgebnis: { ok: true },
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
      if (f.limit > 0) { f.limit--; return f.limitInnen ? { ok: false, status: 429, code: 'limit', message: 'Too Many Requests.', index: 20 } : { ok: false, status: 429, code: 'limit', message: 'Too Many Requests.' }; }
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
const mitVielen = (n) => { const g = kl(KT); for (let i = 0; i < n; i++) g.tasks.push({ ...kl(g.tasks[0]), id: 'z' + i }); return g; };
test('planAnlegen: ein großer Plan (unter 2000 Anfragen) geht in EINEM Batch und kommt vollständig zurück', async () => {
  const { pb, sp, state } = await holen(mitVielen(1500));
  assert.equal(pb.aufrufe.length, 1);
  assert.ok(pb.aufrufe[0].length > 1000 && pb.aufrufe[0].length <= 2000);
  assert.deepEqual((await sp.laden()).state, state);
});
test('Zu groß (> 2000 Anfragen): senden und planAnlegen lehnen ab, es wird nichts gesendet oder eingereiht', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.aufrufe.length = 0;
  const gross = mitVielen(2100); // gegenüber dem Plan 2100 neue Vorgänge
  const r = await sp.senden(aenderungen(state, { ...gross, project: state.project }));
  assert.deepEqual(r, { ok: false, zuGross: true });
  assert.equal(sp.offen.length, 0);
  assert.deepEqual(await createServerPlan({ pb, planId: 'x' }).planAnlegen(gross), { ok: false, zuGross: true });
  assert.equal(pb.aufrufe.length, 0);
  assert.equal(pb.recs.filter((x) => x.collectionName === 'plaene').length, 1);
});
test('planAnlegen mit nicht leerer Warteschlange wird abgelehnt (offenVorhanden), nichts gesendet', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.netz = true;
  const a = kl(state); a.tasks[0].title = 'A';
  await sp.senden(aenderungen(state, a));
  pb.netz = false; pb.aufrufe.length = 0;
  assert.deepEqual(await sp.planAnlegen(AMK), { ok: false, offenVorhanden: true });
  assert.equal(pb.aufrufe.length, 0);
  assert.equal(sp.offen.length, 1);
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
  assert.deepEqual(got, [{ coll: 'vorgaenge', eid: state.tasks[0].id, rev: 2, objekt: rec.daten }]);
  pb.hoerer({ thema: 'vorgaenge', action: 'delete', record: rec });
  assert.deepEqual(got[1], { coll: 'vorgaenge', eid: state.tasks[0].id, rev: null, objekt: null });
  pb.hoerer({ thema: 'plaene', action: 'update', record: { plan_id: planId, id: 'p', rev: 9, daten: { name: 'P' } } });
  assert.deepEqual(got[2], { coll: 'plaene', eid: planId, rev: 9, objekt: { name: 'P' } });
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
  // die App übernimmt den fremden Inhalt (uebernommen): erst jetzt ist die rev die Basis des nächsten Sendens
  sp.uebernommen('vorgaenge', state.tasks[0].id, rec.rev + 1);
  pb.batch = orig;
  pb.recs.find((x) => x.eid === state.tasks[0].id).rev = rec.rev + 1;
  const nach2 = kl(nach); nach2.tasks[0].title = 'Nochmal';
  assert.ok((await sp.senden(aenderungen(nach, nach2))).ok);
});
test('C1: Ereignis rev 5 gehört, aber nicht übernommen → senden auf dem Inhalt von rev 4 ist ein Konflikt (nie still überschreiben)', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  sp.abonnieren(() => {});
  const x = state.tasks[0].id;
  const rec = pb.recs.find((r) => r.eid === x);
  rec.daten = { ...rec.daten, title: 'Fremd' }; rec.rev = 5;
  pb.hoerer({ thema: 'vorgaenge', action: 'update', record: kl(rec) }); // die App hält den Inhalt zurück
  const nach = kl(state); nach.tasks[0].title = 'Eigen';
  const r = await sp.senden(aenderungen(state, nach)); // der Store zeigt noch den Inhalt von rev 1
  assert.equal(r.ok, false);
  assert.equal(r.konflikt[0].art, 'aendern');
  assert.equal(rec.daten.title, 'Fremd', 'Fremdes nicht überschrieben');
});
test('C1: die Basis steht beim Senden fest, auch wenn ein davor eingereihtes laden() den Stand ersetzt', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  const rec = pb.recs.find((r) => r.eid === state.tasks[0].id);
  rec.daten = { ...rec.daten, title: 'Fremd' }; rec.rev = 2;
  const laden = sp.laden();                      // das nachladen() der App ist schon eingereiht ...
  const nach = kl(state); nach.tasks[0].title = 'Eigen'; // ... der Nutzer ändert auf dem Inhalt von rev 1
  const senden = sp.senden(aenderungen(state, nach));
  await laden;                                   // laden() ersetzt den Stand (rev 2)
  const r = await senden;
  assert.equal(r.ok, false);
  assert.equal(r.konflikt[0].art, 'aendern');
  assert.equal(rec.daten.title, 'Fremd', 'Fremdes nicht überschrieben');
});
test('C1: laden(halten) behält die Basis-rev gehaltener Datensätze, andere werden übernommen', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  const [a, b] = [state.tasks[0].id, state.tasks[1].id];
  for (const id of [a, b]) { const r = pb.recs.find((x) => x.eid === id); r.daten = { ...r.daten, title: 'F' + id }; r.rev = 7; }
  await sp.laden(() => new Set(['vorgaenge|' + a]));
  const n1 = kl(state); n1.tasks[0].title = 'E1'; n1.tasks[1].title = 'E2';
  const r = await sp.senden(aenderungen(state, n1));
  assert.equal(r.ok, false);
  assert.deepEqual(r.konflikt.map((k) => k.eid), [a], 'nur der gehaltene (alte Basis) kollidiert; der übernommene geht durch');
});
test('C1: schon gehörte rev wird nicht doppelt gemeldet, uebernommen zieht die Basis nach', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  const got = []; sp.abonnieren((t) => got.push(t));
  const x = state.tasks[0].id;
  const rec = pb.recs.find((r) => r.eid === x);
  rec.daten = { ...rec.daten, title: 'Fremd' }; rec.rev = 2;
  pb.hoerer({ thema: 'vorgaenge', action: 'update', record: kl(rec) });
  pb.hoerer({ thema: 'vorgaenge', action: 'update', record: kl(rec) });
  assert.equal(got.length, 1);
  assert.equal(got[0].rev, 2);
  sp.uebernommen('vorgaenge', x, 2);
  const nach = kl(state); nach.tasks[0].title = 'Fremd'; nach.tasks[0].notes = 'n';
  const n2 = kl(nach); n2.tasks[0].title = 'Eigen';
  assert.ok((await sp.senden(aenderungen(nach, n2))).ok);
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
test('I1: Schlange [a1(X), a2(X)], a1 ergibt Konflikt (fremde rev = Basis+1) → a2 ebenfalls Konflikt, nichts überschrieben', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.netz = true;
  const a = kl(state); a.tasks[0].title = 'A1';
  const b = kl(a); b.tasks[0].title = 'A2';
  await sp.senden(aenderungen(state, a)); await sp.senden(aenderungen(a, b));
  pb.netz = false;
  const rec = pb.recs.find((x) => x.eid === state.tasks[0].id);
  rec.daten = { ...rec.daten, title: 'Fremd' }; rec.rev = 2; // genau die rev, die a2 aus a1 «vorhersagt»
  const r1 = await sp.wiederVerbunden();
  assert.equal(r1.konflikt[0].eid, state.tasks[0].id);
  assert.equal(sp.offen.length, 1);
  pb.aufrufe.length = 0;
  const r2 = await sp.wiederVerbunden();
  assert.equal(r2.ok, false);
  assert.equal(r2.konflikt[0].fremd.title, 'Fremd');
  assert.equal(pb.aufrufe.length, 0, 'a2 wurde gar nicht gesendet');
  assert.equal(rec.daten.title, 'Fremd');
});
test('I1: Offline-Änderung an X, dann Fremd-Echo für X, dann wiederVerbunden → Konflikt statt Überschreiben', async () => {
  const { pb, sp, planId, state } = await holen(KT);
  await sp.laden();
  const got = [];
  sp.abonnieren((t) => got.push(t));
  pb.netz = true;
  const a = kl(state); a.tasks[0].title = 'Offline';
  await sp.senden(aenderungen(state, a));
  const rec = pb.recs.find((x) => x.eid === state.tasks[0].id);
  rec.daten = { ...rec.daten, title: 'Fremd' }; rec.rev = 2;
  pb.hoerer({ thema: 'vorgaenge', action: 'update', record: kl(rec) });
  assert.equal(got.length, 1);
  pb.netz = false;
  const r = await sp.wiederVerbunden();
  assert.equal(r.ok, false);
  assert.equal(r.konflikt[0].art, 'aendern');
  assert.equal(rec.daten.title, 'Fremd');
  assert.ok(planId);
});
test('Konflikt, dessen fremder Stand nicht nachgeholt werden kann: fremd null UND unbekannt true', async () => {
  const { pb, sp, state } = await holen(KT);
  await sp.laden();
  pb.batch = async () => { pb.netz = true; return { ok: false, status: 409, code: 'rev', eid: state.tasks[0].id, rev: 2, index: 0 }; };
  const a = kl(state); a.tasks[0].title = 'A';
  const r = await sp.senden(aenderungen(state, a));
  assert.deepEqual(r.konflikt, [{ coll: 'vorgaenge', eid: state.tasks[0].id, art: 'aendern', fremd: null, unbekannt: true }]);
});
test('Echo-Erwartung läuft nach 60 s ab: ein späteres Lösch-Ereignis gleicher Form ist fremd', async () => {
  let t = 1000;
  const pb = fakePb();
  const r0 = await createServerPlan({ pb, planId: 'x' }).planAnlegen(KT);
  const sp = createServerPlan({ pb, planId: r0.planId, jetzt: () => t });
  await sp.laden();
  const got = [];
  sp.abonnieren((x) => got.push(x));
  const [x1, x2] = [r0.state.tasks[0], r0.state.tasks[1]];
  const ev = (task) => ({ thema: 'vorgaenge', action: 'delete', record: { plan_id: r0.planId, eid: task.id, id: 'r', rev: 1, daten: task } });
  const a = kl(r0.state); a.tasks.splice(0, 1);
  await sp.senden(aenderungen(r0.state, a));
  t += 59000;
  pb.hoerer(ev(x1));
  assert.equal(got.length, 0, 'innerhalb von 60 s: eigenes Echo');
  const b = kl(a); b.tasks.splice(0, 1);
  await sp.senden(aenderungen(a, b));
  t += 61000;
  pb.hoerer(ev(x2));
  assert.deepEqual(got, [{ coll: 'vorgaenge', eid: x2.id, rev: null, objekt: null }]);
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
// ── Rate Limits (Task 10b) ───────────────────────────────────────────────────
test('429 beim Senden: bleibt in offen, Wiederversuch mit Backoff 1/2/4 s, kein Fehler, am Ende gesendet', async () => {
  const { pb, planId, state } = await holen(KT);
  const waits = [];
  const sp = createServerPlan({ pb, planId, warte: async (ms) => { waits.push(ms); if (waits.length === 1) assert.equal(sp.offen.length, 1, 'während des Wartens noch in offen'); } });
  await sp.laden();
  const b = kl(state); b.tasks[0].title = 'LIMIT';
  pb.limit = 3; pb.limitInnen = true; // auch das innere 429 eines Batches ist «limit»
  pb.aufrufe.length = 0;
  assert.deepEqual(await sp.senden(aenderungen(state, b)), { ok: true });
  assert.equal(pb.aufrufe.length, 4);
  assert.deepEqual(waits.filter((w) => w >= 1000), [1000, 2000, 4000]);
  assert.deepEqual(BACKOFF_MS, [1000, 2000, 4000, 5000]);
  assert.equal(sp.offen.length, 0);
  assert.deepEqual((await sp.laden()).state, b);
});
test('429: spätere Änderungen reihen sich hinter die wartende ein, Reihenfolge bleibt', async () => {
  const { pb, planId, state } = await holen(KT);
  const sp = createServerPlan({ pb, planId });
  await sp.laden();
  const a = kl(state); a.tasks[0].title = 'A';
  const b = kl(a); b.tasks[0].title = 'B';
  pb.limit = 2; pb.aufrufe.length = 0;
  const [r1, r2] = await Promise.all([sp.senden(aenderungen(state, a)), sp.senden(aenderungen(a, b))]);
  assert.deepEqual([r1, r2], [{ ok: true }, { ok: true }]);
  assert.deepEqual(pb.aufrufe.slice(2).map((x) => x[0].body.rev), [1, 2]);
  assert.deepEqual((await sp.laden()).state, b);
});
test('Dauerhaftes 429: nach 4 Versuchen gibt senden die Reihe frei, Änderung bleibt in offen, nichts verworfen; später geht sie raus', async () => {
  const { pb, planId, state } = await holen(KT);
  const waits = [];
  const sp = createServerPlan({ pb, planId, warte: async (ms) => { waits.push(ms); } });
  await sp.laden();
  const b = kl(state); b.tasks[0].title = 'DAUER';
  pb.limit = 1000; pb.aufrufe.length = 0;
  const r = await sp.senden(aenderungen(state, b)); // kehrt zurück, statt endlos zu warten
  assert.equal(LIMIT_VERSUCHE, 4);
  assert.deepEqual(r, { ok: false, limit: true, offen: 1 });
  assert.equal(pb.aufrufe.length, 4);
  assert.deepEqual(waits.filter((w) => w >= 1000), [1000, 2000, 4000]);
  assert.equal(sp.offen.length, 1);
  // die Reihe ist frei: andere Aufrufe (laden) laufen sofort, eine weitere Änderung reiht sich hinten an
  assert.ok((await sp.laden()).ok);
  const c = kl(b); c.tasks[0].title = 'DAUER2';
  assert.equal((await sp.senden(aenderungen(b, c))).limit, true);
  assert.equal(sp.offen.length, 2);
  pb.limit = 0;
  assert.deepEqual(await sp.wiederVerbunden(), { ok: true });
  assert.equal(sp.offen.length, 0);
  assert.deepEqual((await sp.laden()).state, c);
});
test('beenden(): ein wartender 429-Wiederversuch sendet nichts mehr, die Schlange ist leer', async () => {
  const { pb, planId, state } = await holen(KT);
  let sp;
  sp = createServerPlan({ pb, planId, warte: async () => { sp.beenden(); } });
  await sp.laden();
  const b = kl(state); b.tasks[0].title = 'WEG';
  pb.limit = 1; pb.aufrufe.length = 0;
  await sp.senden(aenderungen(state, b));
  assert.equal(pb.aufrufe.length, 1);
  assert.equal(sp.offen.length, 0);
});
test('Drossel: zwischen zwei Batch-Aufrufen mindestens 450 ms (Rest wird gewartet), nach genug Abstand nicht', async () => {
  const pb = fakePb();
  let jetzt = 10000; const waits = [];
  const sp = createServerPlan({ pb, planId: 'x', uhr: () => jetzt, warte: async (ms) => { waits.push(ms); jetzt += ms; } });
  const r = await sp.planAnlegen(KT);
  assert.ok(r.ok);
  assert.equal(BATCH_ABSTAND_MS, 450);
  assert.deepEqual(waits, []);            // erster Aufruf: kein Warten
  const b = kl(r.state); b.tasks[0].title = 'D1';
  jetzt += 100;                           // nur 100 ms seit dem letzten Batch
  assert.ok((await sp.senden(aenderungen(r.state, b))).ok);
  assert.deepEqual(waits, [350]);
  const c = kl(b); c.tasks[0].title = 'D2';
  jetzt += 5000;                          // genug Abstand
  assert.ok((await sp.senden(aenderungen(b, c))).ok);
  assert.deepEqual(waits, [350]);
});
test('planAnlegen: 429 wird bis zu 3-mal versucht (derselbe Plan, nichts angelegt dazwischen), dann {limit:true}, alte id bleibt', async () => {
  const pb = fakePb();
  const waits = [];
  const sp = createServerPlan({ pb, planId: 'alt', warte: async (ms) => { waits.push(ms); } });
  pb.limit = 2; pb.limitInnen = true;
  const r = await sp.planAnlegen(AMK);
  assert.ok(r.ok, 'dritter Versuch gelingt');
  assert.equal(PLAN_VERSUCHE, 3);
  assert.equal(pb.aufrufe.length, 3);
  assert.equal(pb.aufrufe[0].length, pb.aufrufe[2].length);
  assert.equal(pb.recs.filter((x) => x.collectionName === 'plaene').length, 1);
  const pb2 = fakePb(); pb2.limit = 5;
  const sp2 = createServerPlan({ pb: pb2, planId: 'alt' });
  assert.deepEqual(await sp2.planAnlegen(AMK), { ok: false, limit: true });
  assert.equal(pb2.aufrufe.length, 3);
  assert.equal(pb2.recs.length, 0);
  assert.equal((await sp2.laden()).nichtGefunden, true, 'alte plan_id gilt weiter');
});
test('planLoeschen und laden: 429 → {limit:true}, nicht «fehler»', async () => {
  const { pb, sp } = await holen(KT);
  await sp.laden();
  pb.limit = 1;
  assert.deepEqual(await sp.planLoeschen(), { ok: false, limit: true });
  const orig = pb.liste; pb.liste = async () => ({ ok: false, status: 429, code: 'limit', message: 'x' });
  assert.deepEqual(await sp.laden(), { ok: false, limit: true });
  pb.liste = orig;
  pb.erneuernErgebnis = { ok: false, status: 429, code: 'limit' };
  await assert.rejects(listePlaene(pb), (e) => e.limit === true && e.offline === false);
});
for (const [name, fehler] of [['503', { status: 503, code: 'fehler' }], ['504 (nach dem Commit)', { status: 504, code: 'fehler' }], ['408', { status: 408, code: 'fehler' }], ['200-HTML eines Captive Portals (code antwort)', { status: 200, code: 'antwort' }]]) {
  test('I2: ' + name + ' beim Senden ist vorübergehend: die Änderung bleibt in offen (kein fehler), später kommt sie an', async () => {
    const { pb, sp, state } = await holen(KT);
    await sp.laden();
    const orig = pb.batch;
    pb.batch = async () => ({ ok: false, message: 'x', ...fehler });
    const nach = kl(state); nach.tasks[0].title = 'Eigen';
    const r = await sp.senden(aenderungen(state, nach));
    assert.equal(r.ok, false);
    assert.equal(r.limit, true);
    assert.equal(r.fehler, undefined);
    assert.equal(sp.offen.length, 1);
    pb.batch = orig;
    assert.ok((await sp.wiederVerbunden()).ok);
    assert.equal(pb.recs.find((x) => x.eid === state.tasks[0].id).daten.title, 'Eigen');
  });
}
test('I2: 5xx/antwort bei laden() und beim Token-Erneuern ist vorübergehend (limit), 403 bleibt ein Fehler', async () => {
  const { pb, sp } = await holen(KT);
  const orig = pb.liste;
  for (const f of [{ status: 502, code: 'fehler' }, { status: 200, code: 'antwort' }]) {
    pb.liste = async () => ({ ok: false, message: 'x', ...f });
    assert.deepEqual(await sp.laden(), { ok: false, limit: true });
  }
  pb.liste = async () => ({ ok: false, message: 'x', status: 403, code: 'verboten' });
  assert.equal((await sp.laden()).fehler.status, 403);
  pb.liste = orig;
  pb.erneuernErgebnis = { ok: false, status: 503, code: 'fehler' };
  assert.deepEqual(await sp.laden(), { ok: false, limit: true });
  await assert.rejects(listePlaene(pb), (e) => e.limit === true && e.offline === false);
  pb.erneuernErgebnis = { ok: false, status: 0, code: 'netz' };
  assert.equal((await sp.laden()).offline, true);
});
test('I2: istVoruebergehend: netz ist offline, nicht vorübergehend; 400/403/404/409 sind es nicht', async () => {
  const { istVoruebergehend: v } = await import('../js/server.js');
  for (const r of [{ status: 0, code: 'netz' }, { status: 400 }, { status: 403 }, { status: 404 }, { status: 409, code: 'rev' }, { ok: true }]) assert.equal(v({ ok: false, ...r }), false, JSON.stringify(r));
  for (const r of [{ status: 429, code: 'limit' }, { status: 500 }, { status: 599 }, { status: 408 }, { status: 200, code: 'antwort' }]) assert.equal(v({ ok: false, ...r }), true, JSON.stringify(r));
});
// I1: zwei Nutzer ändern verschiedene Kinder eines Sammelvorgangs; die Hülle (Eltern-Start/Ende) ändert sich bei beiden.
async function sammelPlan() {
  const st = createStore(kl(KT));
  const g = KT.gewerke[0].id;
  const eltern = st.apply({ type: 'addTask', task: { gewerk: g, title: 'Sammel', start: '2026-07-13T08:00', end: '2026-07-13T09:00' } }).id;
  const k1 = st.apply({ type: 'addTask', task: { gewerk: g, parent: eltern, title: 'K1', start: '2026-07-13T08:00', end: '2026-07-13T10:00' } }).id;
  const k2 = st.apply({ type: 'addTask', task: { gewerk: g, parent: eltern, title: 'K2', start: '2026-07-13T09:00', end: '2026-07-13T12:00' } }).id;
  const { pb, planId } = await holen(st.state);
  const mk = async () => { const sp = createServerPlan({ pb, planId }); const l = await sp.laden(); return { sp, st: createStore(l.state) }; };
  return { pb, eltern, k1, k2, A: await mk(), B: await mk() };
}
test('I1: verschiedene Kinder eines Sammelvorgangs: rev-Konflikt nur an der Hülle → ohne Dialog, beide Änderungen kommen an', async () => {
  const { pb, eltern, k1, k2, A, B } = await sammelPlan();
  let aA, aB; A.st.subscribe((_, i) => { if (i?.aend) aA = i.aend; }); B.st.subscribe((_, i) => { if (i?.aend) aB = i.aend; });
  assert.equal(A.st.apply({ type: 'moveTask', id: k1, start: '2026-07-13T06:00', end: '2026-07-13T10:00' }).ok, true);
  assert.ok((await A.sp.senden(aA)).ok);
  assert.equal(B.st.apply({ type: 'moveTask', id: k2, start: '2026-07-13T09:00', end: '2026-07-13T14:00' }).ok, true);
  const r = await B.sp.senden(aB); // B kennt A's Änderung nicht: die Hülle trägt die alte rev
  assert.equal(r.ok, false);
  assert.equal(r.konflikt[0].eid, eltern);
  const h = huellenKonflikte(r.aend, r.konflikt, B.st.state);
  assert.deepEqual([h.auto.length, h.rest.length], [1, 0], 'reine Hüllenänderung: kein Konflikt');
  B.st.applyRemote(fremdUebernehmen(B.st.state, h.auto));
  assert.ok((await B.sp.senden(ohne(r.aend, h.auto))).ok);
  const daten = (eid) => pb.recs.find((x) => x.eid === eid).daten;
  assert.equal(daten(k1).start, '2026-07-13T06:00');
  assert.equal(daten(k2).end, '2026-07-13T14:00');
  const l = await A.sp.laden(); // ein frischer Stand: die Hülle rechnet jeder Store aus den Kindern
  const frisch = createStore(l.state).state.tasks.find((t) => t.id === eltern);
  assert.deepEqual([frisch.start, frisch.end], ['2026-07-13T06:00', '2026-07-13T14:00']);
});
test('I1: ändert die eigene Änderung am Sammelvorgang MEHR als die Hülle (Titel), bleibt es ein Konflikt', async () => {
  const { eltern, k1, k2, A, B } = await sammelPlan();
  let aA, aB; A.st.subscribe((_, i) => { if (i?.aend) aA = i.aend; }); B.st.subscribe((_, i) => { if (i?.aend) aB = i.aend; });
  A.st.apply({ type: 'moveTask', id: k1, start: '2026-07-13T06:00', end: '2026-07-13T10:00' });
  await A.sp.senden(aA);
  B.st.apply({ type: 'moveTask', id: k2, start: '2026-07-13T09:00', end: '2026-07-13T14:00' });
  const alle = { ...aB, vorgaenge: { ...aB.vorgaenge, aendern: aB.vorgaenge.aendern.map((e) => (e.vorher.id === eltern ? { vorher: e.vorher, nachher: { ...e.nachher, title: 'Umbenannt' } } : e)) } };
  const r = await B.sp.senden(alle);
  assert.equal(r.konflikt[0].eid, eltern);
  const h = huellenKonflikte(r.aend, r.konflikt, B.st.state);
  assert.deepEqual([h.auto.length, h.rest.length], [0, 1]);
});
test('ladeBackoff: 1/2/4/… s, höchstens 30 s, Zufallsanteil von der Hälfte bis zum Ganzen (injizierte Zufallszahl)', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map((n) => ladeBackoff(n, () => 1)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  assert.deepEqual([0, 3, 6].map((n) => ladeBackoff(n, () => 0)), [500, 4000, 15000]);
  assert.equal(ladeBackoff(5, () => 0.5), 22500);
  for (let i = 0; i < 50; i++) { const v = ladeBackoff(2); assert.ok(v >= 2000 && v <= 4000, String(v)); }
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
