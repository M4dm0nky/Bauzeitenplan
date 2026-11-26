// Serverplan: Plan laden, Änderungen mit rev-Prüfung senden, Realtime, Warteschlange — DOM-frei.
//
// Der Plan liegt auf dem Server als einzelne Datensätze je Sammlung (aenderungen.js, COLLS).
// Dieses Modul spricht über `pb` (pb.js) mit ihnen. Es kennt die Datensatz-id und die
// Version (`rev`) jedes Eintrags (`stand`) und sendet Änderungen als EIN Batch: alles oder nichts.
// Wer ändert, ohne die aktuelle rev zu kennen, bekommt einen Konflikt (409) statt zu überschreiben.
import { COLLS, zerlegen, zusammensetzen, istLeer } from './aenderungen.js';

const KLON = (x) => JSON.parse(JSON.stringify(x));
const MAX_BATCH = 1000; // PocketBase erlaubt 2000 Unteranfragen je Batch
const MAX_ECHOS = 2000;
// Batch-Reihenfolge (vom Hook verlangt): Eltern vor Kindern beim Anlegen, umgekehrt beim Löschen
const ANLEGEN = ['plaene', 'gewerke', 'ressourcen', 'phasen', 'vorgaenge', 'verknuepfungen'];
const LOESCHEN = [...ANLEGEN].reverse();

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const planFilter = (id) => `plan_id="${q(id)}"`;
const eidFilter = (id, eid) => `${planFilter(id)} && eid="${q(eid)}"`;
const neueId = () => (globalThis.crypto?.randomUUID?.() ?? 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

// Indexspalten, die der Hook mit `daten` vergleicht
const spalten = (coll, o) => (coll === 'vorgaenge' ? { gewerk: o.gewerk } : coll === 'verknuepfungen' ? { von: o.from, nach: o.to } : {});

// Fehlerform von pb.js → Kategorie
const istNetz = (r) => r?.code === 'netz' || r?.status === 0;
const istAuth = (r) => r?.status === 401 || r?.code === 'auth';

function rolleVon(user, planRec, mitglieder) {
  if (!user) return null;
  if (planRec?.besitzer && planRec.besitzer === user.id) return { rolle: 'besitzer', gewerke: [] };
  if (user.superadmin) return { rolle: 'superadmin', gewerke: [] };
  const m = (mitglieder || []).find((x) => x.user_id === user.id);
  return m ? { rolle: m.rolle, gewerke: Array.isArray(m.gewerke) ? m.gewerke : [] } : null;
}

// Das Token prüfen/erneuern, BEVOR gelesen wird: eine Liste mit kaputtem Token ist am echten
// Server eine leere 200-Antwort und sähe aus wie «Plan leer».
async function sitzung(pb) {
  const e = await pb.erneuern();
  if (e.ok) return null;
  if (istNetz(e)) return { ok: false, offline: true };
  if (istAuth(e)) return { ok: false, abgemeldet: true };
  return { ok: false, fehler: { status: e.status, code: e.code, message: e.message } };
}

/** Pläne, die der Nutzer sehen darf → [{plan_id, name, venue, rolle}]. Bei Fehler wirft sie einen
 *  Error mit `offline` bzw. `abgemeldet` (der Projektdialog fängt ihn). */
export async function listePlaene(pb) {
  const s = await sitzung(pb);
  const fail = (r) => Object.assign(new Error(r.message || (r.offline ? 'offline' : r.abgemeldet ? 'abgemeldet' : 'Fehler')), { offline: !!r.offline, abgemeldet: !!r.abgemeldet, status: r.status, code: r.code });
  if (s) throw fail(s.fehler || s);
  const pl = await pb.liste('plaene', '', 'created');
  if (!pl.ok) throw fail(pl);
  const mi = await pb.liste('mitglieder', '');
  if (!mi.ok && istNetz(mi)) throw fail(mi);
  const user = pb.auth?.record;
  return pl.items.map((p) => ({
    plan_id: p.plan_id,
    name: p.daten?.name || '',
    venue: p.daten?.venue || '',
    rolle: rolleVon(user, p, (mi.items || []).filter((m) => m.plan_id === p.plan_id))?.rolle ?? null,
  }));
}

export function createServerPlan({ pb, planId }) {
  let id = planId;
  let stand = new Map(COLLS.map((c) => [c, new Map()])); // coll → eid → {id, rev}
  const erwartet = new Map(); // Echos der eigenen Schreibzugriffe: "coll|eid|rev|action" → Zeit
  let queue = [];
  let kette = Promise.resolve();
  let handler = null;
  let stopAbo = null;

  const seriell = (fn) => { const p = kette.then(fn, fn); kette = p.catch(() => {}); return p; };
  const merke = (coll, eid, rev, action) => {
    if (erwartet.size >= MAX_ECHOS) for (const k of [...erwartet.keys()].slice(0, MAX_ECHOS / 2)) erwartet.delete(k);
    erwartet.set(`${coll}|${eid}|${rev}|${action}`, Date.now());
  };
  const eidVon = (coll, rec) => (coll === 'plaene' ? rec.plan_id : rec.eid);
  const setze = (coll, rec) => stand.get(coll).set(eidVon(coll, rec), { id: rec.id, rev: rec.rev });

  async function holeFremd(coll, eid) {
    const r = await pb.liste(coll, coll === 'plaene' ? planFilter(id) : eidFilter(id, eid));
    if (!r.ok) return { unbekannt: true };
    const rec = r.items[0];
    if (!rec) { stand.get(coll).delete(eid); return { fremd: null }; }
    setze(coll, rec);
    return { fremd: KLON(rec.daten ?? null), rev: rec.rev };
  }

  // Unbekannte Datensätze (nicht geladen, nicht gehört) nachschlagen; fehlen sie → Konflikt «geloescht»
  async function ergaenze(aend) {
    const fehlt = [];
    for (const c of COLLS) {
      const x = aend[c];
      if (!x) continue;
      const ids = [...x.aendern.map((e) => e.vorher.id), ...x.loeschen.map((o) => o.id)];
      for (const eid of ids) {
        const key = c === 'plaene' ? id : eid;
        if (stand.get(c).has(key)) continue;
        const f = await holeFremd(c, key);
        if (f.unbekannt) return { netz: true };
        if (!stand.get(c).has(key)) fehlt.push({ coll: c, eid, art: 'geloescht', fremd: null });
      }
    }
    return { fehlt };
  }

  // Änderungsliste → Batch-Anfragen in der verbindlichen Reihenfolge (+ Beschreibung je Anfrage)
  function anfragen(aend) {
    const reqs = [], meta = [];
    const elternZuerst = (liste, f) => [...liste].sort((a, b) => (f(a)?.parent ? 1 : 0) - (f(b)?.parent ? 1 : 0));
    const kindZuerst = (liste, f) => [...liste].sort((a, b) => (f(b)?.parent ? 1 : 0) - (f(a)?.parent ? 1 : 0));
    const pfad = (c, rid) => `/api/collections/${c}/records${rid ? '/' + rid : ''}`;
    for (const c of ANLEGEN) { // anlegen
      const x = aend[c]; if (!x) continue;
      const mitPos = x.anlegen.map((o, i) => ({ o, pos: x.anlegenPos?.[i] ?? i }));
      for (const { o, pos } of elternZuerst(mitPos, (m) => m.o)) {
        const eid = c === 'plaene' ? id : o.id;
        reqs.push({ method: 'POST', url: pfad(c), body: c === 'plaene' ? { plan_id: id, daten: o, rev: 1 } : { plan_id: id, eid, daten: o, pos, rev: 1, ...spalten(c, o) } });
        meta.push({ coll: c, eid, art: 'anlegen', rev: 1 });
      }
    }
    for (const c of ANLEGEN) { // ändern
      const x = aend[c]; if (!x) continue;
      const mitPos = x.aendern.map((e, i) => ({ e, pos: x.aendernPosNeu?.[i] }));
      for (const { e, pos } of elternZuerst(mitPos, (m) => m.e.nachher)) {
        const eid = c === 'plaene' ? id : e.vorher.id;
        const s = stand.get(c).get(eid);
        const body = c === 'plaene' ? { daten: e.nachher, rev: s.rev } : { daten: e.nachher, rev: s.rev, ...(pos === undefined ? {} : { pos }), ...spalten(c, e.nachher) };
        reqs.push({ method: 'PATCH', url: pfad(c, s.id), body });
        meta.push({ coll: c, eid, art: 'aendern', rev: s.rev + 1 });
      }
    }
    for (const c of LOESCHEN) { // löschen
      const x = aend[c]; if (!x) continue;
      for (const o of kindZuerst(x.loeschen, (m) => m)) {
        const eid = c === 'plaene' ? id : o.id;
        const s = stand.get(c).get(eid);
        reqs.push({ method: 'DELETE', url: pfad(c, s.id) + '?rev=' + s.rev });
        meta.push({ coll: c, eid, art: 'loeschen', rev: s.rev });
      }
    }
    return { reqs, meta };
  }

  // Ein Batch (in Stücken ≤ MAX_BATCH) → ok | offline | abgemeldet | konflikt | fehler
  async function schicke(aend) {
    const unb = await ergaenze(aend);
    if (unb.netz) return { ok: false, offline: true };
    if (unb.fehlt.length) return { ok: false, konflikt: unb.fehlt };
    const { reqs, meta } = anfragen(aend);
    for (let von = 0; von < reqs.length; von += MAX_BATCH) {
      const rq = reqs.slice(von, von + MAX_BATCH), mt = meta.slice(von, von + MAX_BATCH);
      for (const m of mt) merke(m.coll, m.eid, m.rev, m.art === 'loeschen' ? 'delete' : m.art === 'anlegen' ? 'create' : 'update');
      const r = await pb.batch(rq);
      if (r.ok) {
        r.antworten.forEach((rec, i) => {
          const m = mt[i];
          if (m.art === 'loeschen') stand.get(m.coll).delete(m.eid);
          else if (rec && rec.id) stand.get(m.coll).set(m.eid, { id: rec.id, rev: rec.rev ?? m.rev });
        });
        continue;
      }
      for (const m of mt) erwartet.delete(`${m.coll}|${m.eid}|${m.rev}|${m.art === 'loeschen' ? 'delete' : m.art === 'anlegen' ? 'create' : 'update'}`);
      if (istNetz(r)) return { ok: false, offline: true };
      if (istAuth(r)) return { ok: false, abgemeldet: true };
      const m = mt[r.index ?? -1];
      if (r.code === 'rev' && m) return { ok: false, konflikt: [{ coll: m.coll, eid: m.eid, art: m.art, ...(await holeFremd(m.coll, m.eid)) }] };
      // Ändern/Löschen eines Datensatzes, den es nicht mehr gibt (404): fremd gelöscht. Eine Regelabsage
      // (kein Recht) antwortet am Server ebenfalls 404; darum gilt «gelöscht» nur, wenn er auch nicht lesbar ist.
      if (m && m.art !== 'anlegen' && r.status === 404) {
        const f = await holeFremd(m.coll, m.eid);
        if (f.fremd === null) return { ok: false, konflikt: [{ coll: m.coll, eid: m.eid, art: 'geloescht', fremd: null }] };
      }
      // Anlegen scheitert, weil der Datensatz inzwischen existiert (eindeutiger Index) → Konflikt «existiert»
      if (m?.art === 'anlegen' && r.status === 400) {
        const f = await holeFremd(m.coll, m.eid);
        if (f.fremd) return { ok: false, konflikt: [{ coll: m.coll, eid: m.eid, art: 'existiert', ...f }] };
      }
      return { ok: false, fehler: { status: r.status, code: r.code, message: r.message } };
    }
    return { ok: true };
  }

  // Warteschlange der Reihe nach senden. Offline/abgemeldet: alles bleibt in `offen`. Konflikt oder
  // Fehler: genau dieser Eintrag verlässt die Schlange und kommt als `aend` zurück, der Rest bleibt
  // liegen (er baut womöglich darauf auf) und wartet auf die Entscheidung des Aufrufers.
  async function leeren() {
    while (queue.length) {
      const r = await schicke(queue[0]);
      if (r.ok) { queue.shift(); continue; }
      if (r.offline || r.abgemeldet) return r;
      return { ...r, aend: queue.shift(), offen: queue.length };
    }
    return { ok: true };
  }

  async function laden() {
    return seriell(async () => {
      const s = await sitzung(pb);
      if (s) return s;
      const gelesen = {};
      for (const c of COLLS) {
        const r = await pb.liste(c, planFilter(id), c === 'plaene' ? '' : 'pos,created');
        if (!r.ok) return istNetz(r) ? { ok: false, offline: true } : istAuth(r) ? { ok: false, abgemeldet: true } : { ok: false, fehler: { status: r.status, code: r.code, message: r.message } };
        gelesen[c] = r.items;
      }
      if (!gelesen.plaene.length) return { ok: false, nichtGefunden: true };
      const mi = await pb.liste('mitglieder', planFilter(id));
      if (!mi.ok && istNetz(mi)) return { ok: false, offline: true };
      const neuerStand = new Map(COLLS.map((c) => [c, new Map()]));
      const teile = {}, reihe = {};
      for (const c of COLLS) {
        teile[c] = new Map();
        reihe[c] = [];
        for (const rec of gelesen[c]) {
          const eid = eidVon(c, rec);
          teile[c].set(eid, KLON(rec.daten));
          reihe[c].push(eid);
          neuerStand.get(c).set(eid, { id: rec.id, rev: rec.rev });
        }
      }
      stand = neuerStand;
      const mitglieder = mi.ok ? mi.items.map((m) => ({ user_id: m.user_id, rolle: m.rolle, gewerke: Array.isArray(m.gewerke) ? m.gewerke : [] })) : [];
      return { ok: true, state: zusammensetzen(teile, reihe), rolle: rolleVon(pb.auth?.record, gelesen.plaene[0], mi.ok ? mi.items : []), mitglieder };
    });
  }

  function aboStarten() {
    stopAbo?.();
    stopAbo = pb.abo(COLLS, ({ thema, action, record }) => {
      if (!handler || !record || record.plan_id !== id) return;
      const eid = eidVon(thema, record);
      const art = action === 'delete' ? 'delete' : action === 'create' ? 'create' : 'update';
      if (erwartet.delete(`${thema}|${eid}|${record.rev}|${art}`)) return; // eigenes Echo
      const bekannt = stand.get(thema)?.get(eid);
      if (art !== 'delete' && bekannt && bekannt.rev >= record.rev) return; // schon bekannt
      if (art === 'delete') stand.get(thema)?.delete(eid); else setze(thema, record);
      handler({ coll: thema, eid, objekt: art === 'delete' ? null : KLON(record.daten ?? null) });
    });
  }

  return {
    laden,
    /** → {ok:true} | {ok:false, konflikt:[{coll,eid,art,fremd,rev}], aend} | {ok:false, offline:true}
     *  | {ok:false, abgemeldet:true} | {ok:false, fehler:{status,code,message}, aend} */
    senden(aend) {
      if (!aend || istLeer(aend)) return Promise.resolve({ ok: true });
      return seriell(async () => { queue.push(aend); return leeren(); });
    },
    /** Nach dem Wiederverbinden die Warteschlange senden (Ergebnis wie senden). */
    wiederVerbunden() { return seriell(leeren); },
    /** Warteschlange verwerfen (z. B. nach neuem Laden, wenn der lokale Stand ersetzt wurde). */
    offenVerwerfen() { queue = []; },
    get offen() { return queue.slice(); },
    /** beiFremd({coll, eid, objekt|null}) für Änderungen anderer; eigene Echos werden verschluckt. Gibt stop() zurück. */
    abonnieren(beiFremd) {
      handler = beiFremd;
      aboStarten();
      return () => { stopAbo?.(); stopAbo = null; handler = null; };
    },
    /** Nach einer Token-Erneuerung: Verbindung neu aufbauen, damit sie das neue Token trägt. */
    neuAbonnieren() { if (handler) aboStarten(); },
    /** Neuen Plan (Import/Vorlage/Neu) anlegen: neue plan_id, ein Batch. → {ok, planId, state} (state trägt die neue id). */
    planAnlegen(state) {
      return seriell(async () => {
        const neu = KLON(state);
        const neu_id = neueId();
        neu.project = { ...neu.project, id: neu_id };
        const teile = zerlegen(neu);
        const aend = {};
        for (const c of COLLS) aend[c] = { anlegen: [...teile[c].values()], anlegenPos: [...teile[c].keys()].map((_, i) => i), aendern: [], loeschen: [] };
        const alt = { id, stand };
        id = neu_id;
        stand = new Map(COLLS.map((c) => [c, new Map()]));
        const r = await schicke(aend);
        if (r.ok) return { ok: true, planId: id, state: neu };
        // Teilweise angelegt (mehrere Stücke): Rest wegräumen
        const p = stand.get('plaene').get(id);
        if (p) await pb.batch([{ method: 'DELETE', url: `/api/collections/plaene/records/${p.id}?rev=${p.rev}` }]);
        id = alt.id; stand = alt.stand;
        return r;
      });
    },
    /** Plan samt allen Datensätzen löschen (der Hook kaskadiert). */
    planLoeschen() {
      return seriell(async () => {
        if (!stand.get('plaene').has(id)) { const f = await holeFremd('plaene', id); if (f.unbekannt) return { ok: false, offline: true }; }
        const p = stand.get('plaene').get(id);
        if (!p) return { ok: false, nichtGefunden: true };
        const r = await pb.batch([{ method: 'DELETE', url: `/api/collections/plaene/records/${p.id}?rev=${p.rev}` }]);
        if (r.ok) { stand = new Map(COLLS.map((c) => [c, new Map()])); queue = []; return { ok: true }; }
        if (istNetz(r)) return { ok: false, offline: true };
        if (istAuth(r)) return { ok: false, abgemeldet: true };
        return { ok: false, fehler: { status: r.status, code: r.code, message: r.message } };
      });
    },
  };
}
