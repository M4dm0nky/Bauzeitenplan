// Serverplan: Plan laden, Änderungen mit rev-Prüfung senden, Realtime, Warteschlange — DOM-frei.
//
// Der Plan liegt auf dem Server als einzelne Datensätze je Sammlung (aenderungen.js, COLLS).
// Dieses Modul spricht über `pb` (pb.js) mit ihnen. Es kennt die Datensatz-id und die
// Version (`rev`) jedes Eintrags (`stand`) und sendet Änderungen als EIN Batch: alles oder nichts.
// Wer ändert, ohne die aktuelle rev zu kennen, bekommt einen Konflikt (409) statt zu überschreiben.
import { COLLS, zerlegen, zusammensetzen, istLeer } from './aenderungen.js';

const KLON = (x) => JSON.parse(JSON.stringify(x));
const MAX_BATCH = 2000; // PocketBase: batch.maxRequests (Migration). Größeres wird abgelehnt, nie gesplittet (Atomarität)
const MAX_ECHOS = 2000;
const ECHO_MS = 60000; // so lange wird ein eigenes Echo erwartet
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
const istLimit = (r) => r?.code === 'limit' || r?.status === 429; // Rate Limit: vorübergehend, nie ein Ablehnungsgrund
// EINE Klassifikation für «kommt später wieder in Ordnung»: Rate Limit, Serverfehler (5xx; ein 504 kann nach
// dem Commit kommen), Zeitüberschreitung (408) und eine 2xx-Antwort, die kein JSON des Servers ist (Captive
// Portal, code 'antwort'). Die Änderung bleibt in `offen` und wird mit Backoff wiederholt, nie zurückgenommen.
// Netz (status 0) ist davon getrennt: das ist «offline».
export const istVoruebergehend = (r) => !!r && !r.ok && !istNetz(r) && (istLimit(r) || r.code === 'antwort' || r.status === 408 || r.status >= 500);

// Rate Limits (PocketBase /api/batch 3 je Sekunde): höchstens ~2 Batch-Aufrufe je Sekunde, bei 429 Backoff
export const BATCH_ABSTAND_MS = 450;
export const BACKOFF_MS = [1000, 2000, 4000, 5000]; // danach bleibt es bei 5 s
export const PLAN_VERSUCHE = 3;
export const LIMIT_VERSUCHE = 4; // so oft versucht `leeren` bei 429, dann gibt es die Reihe frei (Änderung bleibt in `offen`)
/** Wartezeit des n-ten Wiederholens eines Ladens: 1 s, 2 s, 4 s … höchstens 30 s, mit Zufallsanteil (die Hälfte bis das Ganze),
 *  damit nicht alle Clients nach einem Serverausfall gleichzeitig anklopfen. `zufall` (0..1) ist für Tests austauschbar. */
export const ladeBackoff = (n, zufall = Math.random) => { const b = Math.min(1000 * 2 ** n, 30000); return Math.round(b / 2 + zufall() * b / 2); };
const backoff = (n) => BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)];
const standardWarte = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (istVoruebergehend(e)) return { ok: false, limit: true };
  return { ok: false, fehler: { status: e.status, code: e.code, message: e.message } };
}

/** Pläne, die der Nutzer sehen darf → [{plan_id, name, venue, rolle}]. Bei Fehler wirft sie einen
 *  Error mit `offline` bzw. `abgemeldet` (der Projektdialog fängt ihn). */
export async function listePlaene(pb) {
  const s = await sitzung(pb);
  const fail = (r) => Object.assign(new Error(r.message || (r.offline ? 'offline' : r.abgemeldet ? 'abgemeldet' : 'Fehler')), { offline: !!r.offline, abgemeldet: !!r.abgemeldet, limit: !!r.limit || istVoruebergehend(r), status: r.status, code: r.code });
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

export function createServerPlan({ pb, planId, jetzt = Date.now, warte = standardWarte, uhr = Date.now }) {
  let id = planId;
  let stand = new Map(COLLS.map((c) => [c, new Map()])); // coll → eid → {id, rev, gehoert}: rev = Fassung, die die App zeigt (Basis eigener Änderungen), gehoert = höchste per Realtime/Laden gehörte rev
  const erwartet = new Map(); // Echos der eigenen Schreibzugriffe: "coll|eid|rev|action" → Zeit
  let queue = []; // Einträge {aend, basis}: basis = rev je Datensatz zum Zeitpunkt der Änderung (null = ungültig)
  const vorhergesagt = new Map(); // coll|eid → rev, die der Datensatz nach den eingereihten Einträgen hat
  let kette = Promise.resolve();
  let handler = null;
  let stopAbo = null;

  let letzterBatch = -Infinity;   // Zeit des letzten Batch-Aufrufs (`uhr`, unabhängig von `jetzt`)
  let abbruch = 0;                // zählt beenden(): ein laufender Backoff erkennt daran, dass sein Server geschlossen wurde
  // Alle Batch-Aufrufe laufen hier durch (Mindestabstand BATCH_ABSTAND_MS). Immer unter `seriell`.
  async function batchDrosselt(reqs) {
    const warten = BATCH_ABSTAND_MS - (uhr() - letzterBatch);
    if (warten > 0) await warte(warten);
    letzterBatch = uhr();
    return pb.batch(reqs);
  }

  const seriell = (fn) => { const p = kette.then(fn, fn); kette = p.catch(() => {}); return p; };
  const merke = (coll, eid, rev, action) => {
    const t = jetzt();
    if (erwartet.size >= MAX_ECHOS) for (const [k, z] of erwartet) if (t - z > ECHO_MS) erwartet.delete(k);
    if (erwartet.size >= MAX_ECHOS) for (const k of [...erwartet.keys()].slice(0, MAX_ECHOS / 2)) erwartet.delete(k);
    erwartet.set(`${coll}|${eid}|${rev}|${action}`, t);
  };
  const eidVon = (coll, rec) => (coll === 'plaene' ? rec.plan_id : rec.eid);
  // Eigenes Echo? Nur innerhalb von ECHO_MS; ein späteres Ereignis gleicher Form ist fremd.
  const istEcho = (key) => { const z = erwartet.get(key); if (z === undefined) return false; erwartet.delete(key); return jetzt() - z <= ECHO_MS; };
  const schluessel = (c, eid) => `${c}|${c === 'plaene' ? id : eid}`;
  const zaehle = (aend) => COLLS.reduce((n, c) => n + (aend[c] ? aend[c].anlegen.length + aend[c].aendern.length + aend[c].loeschen.length : 0), 0);
  // Welche Datensätze eine Änderung voraussetzt (ändern/löschen) bzw. erzeugt (anlegen)
  const beruehrt = (aend) => COLLS.flatMap((c) => [
    ...(aend[c]?.aendern || []).map((e) => schluessel(c, e.vorher.id)),
    ...(aend[c]?.loeschen || []).map((o) => schluessel(c, o.id)),
    ...(aend[c]?.anlegen || []).map((o) => schluessel(c, o.id))]);
  // Beim Einreihen: auf welcher rev baut die Änderung auf? (Stand, oder Ergebnis der davor eingereihten)
  function basisFuer(aend) {
    const basis = new Map();
    for (const c of COLLS) {
      const x = aend[c]; if (!x) continue;
      for (const k of [...x.aendern.map((e) => e.vorher.id), ...x.loeschen.map((o) => o.id)]) {
        const sk = schluessel(c, k);
        const rev = vorhergesagt.get(sk) ?? stand.get(c).get(c === 'plaene' ? id : k)?.rev;
        if (rev !== undefined) basis.set(sk, rev);
      }
    }
    for (const c of COLLS) {
      const x = aend[c]; if (!x) continue;
      for (const o of x.anlegen) vorhergesagt.set(schluessel(c, o.id), 1);
      for (const e of x.aendern) { const sk = schluessel(c, e.vorher.id); if (basis.has(sk)) vorhergesagt.set(sk, basis.get(sk) + 1); }
      for (const o of x.loeschen) vorhergesagt.delete(schluessel(c, o.id));
    }
    return basis;
  }
  // Ein Eintrag ist gescheitert: spätere Einträge, die dieselben Datensätze berühren, bauen auf einem Stand
  // auf, den es so nicht gibt (Konflikt) → ihre Basis ungültig, sie werden zum Konflikt statt zu überschreiben.
  const entwerten = (aend) => {
    const ks = new Set(beruehrt(aend));
    for (const e of queue) {
      const mein = new Set(beruehrt(e.aend));
      for (const k of ks) if (mein.has(k)) e.basis.set(k, null);
    }
  };
  // Der Server-Stand wird bekannt UND übernommen (Nachschlagen für einen Konflikt, eigene Antwort).
  const setze = (coll, rec) => stand.get(coll).set(eidVon(coll, rec), { id: rec.id, rev: rec.rev, gehoert: rec.rev });
  // Realtime: gehört, aber noch NICHT übernommen. Die rev des angezeigten Inhalts (Basis einer eigenen Änderung)
  // bleibt, bis die App den Inhalt wirklich übernimmt (`uebernommen`); hält sie ihn zurück, bleibt die Basis alt
  // und die eigene Änderung wird zum Konflikt statt eine fremde zu überschreiben.
  const hoere = (coll, rec) => {
    const k = eidVon(coll, rec), b = stand.get(coll).get(k);
    if (b) { b.id = rec.id; b.gehoert = Math.max(b.gehoert ?? b.rev, rec.rev); } else stand.get(coll).set(k, { id: rec.id, rev: rec.rev, gehoert: rec.rev });
  };

  async function holeFremd(coll, eid) {
    const r = await pb.liste(coll, coll === 'plaene' ? planFilter(id) : eidFilter(id, eid));
    if (!r.ok) return { fremd: null, unbekannt: true };
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
  function anfragen(aend, basis) {
    const reqs = [], meta = [], ungueltig = [];
    const revVon = (c, eid, s) => { const k = schluessel(c, eid); const b = basis.has(k) ? basis.get(k) : s.rev; if (b === null) ungueltig.push({ coll: c, eid }); return b; };
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
        const rev = revVon(c, eid, s);
        const body = c === 'plaene' ? { daten: e.nachher, rev } : { daten: e.nachher, rev, ...(pos === undefined ? {} : { pos }), ...spalten(c, e.nachher) };
        reqs.push({ method: 'PATCH', url: pfad(c, s.id), body });
        meta.push({ coll: c, eid, art: 'aendern', rev: rev + 1 });
      }
    }
    for (const c of LOESCHEN) { // löschen
      const x = aend[c]; if (!x) continue;
      for (const o of kindZuerst(x.loeschen, (m) => m)) {
        const eid = c === 'plaene' ? id : o.id;
        const s = stand.get(c).get(eid);
        const rev = revVon(c, eid, s);
        reqs.push({ method: 'DELETE', url: pfad(c, s.id) + '?rev=' + rev });
        meta.push({ coll: c, eid, art: 'loeschen', rev });
      }
    }
    return { reqs, meta, ungueltig };
  }

  // Ein Batch (alles oder nichts) → ok | offline | abgemeldet | konflikt | fehler
  async function schicke({ aend, basis }) {
    const unb = await ergaenze(aend);
    if (unb.netz) return { ok: false, offline: true };
    if (unb.fehlt.length) return { ok: false, konflikt: unb.fehlt };
    const { reqs, meta, ungueltig } = anfragen(aend, basis);
    if (ungueltig.length) { // baut auf einer gescheiterten Änderung auf: nicht senden, fremden Stand melden
      const u = ungueltig[0];
      return { ok: false, konflikt: [{ coll: u.coll, eid: u.eid, art: 'aendern', ...(await holeFremd(u.coll, u.eid)) }] };
    }
    const art = (m) => (m.art === 'loeschen' ? 'delete' : m.art === 'anlegen' ? 'create' : 'update');
    for (const m of meta) merke(m.coll, m.eid, m.rev, art(m));
    const r = await batchDrosselt(reqs);
    if (r.ok) {
      r.antworten.forEach((rec, i) => {
        const m = meta[i];
        if (m.art === 'loeschen') stand.get(m.coll).delete(m.eid);
        else if (rec && rec.id) { const rv = rec.rev ?? m.rev; stand.get(m.coll).set(m.eid, { id: rec.id, rev: rv, gehoert: rv }); }
      });
      return { ok: true };
    }
    for (const m of meta) erwartet.delete(`${m.coll}|${m.eid}|${m.rev}|${art(m)}`);
    if (istNetz(r)) return { ok: false, offline: true };
    if (istAuth(r)) return { ok: false, abgemeldet: true };
    if (istVoruebergehend(r)) return { ok: false, limit: true };   // 429/5xx/408/Nicht-JSON, auch innen: nichts verwerfen, später wiederholen
    const m = meta[r.index ?? -1];
    if (r.code === 'rev' && m) return { ok: false, konflikt: [{ coll: m.coll, eid: m.eid, art: m.art, ...(await holeFremd(m.coll, m.eid)) }] };
    // Ändern/Löschen eines Datensatzes, den es nicht mehr gibt (404): fremd gelöscht. Eine Regelabsage
    // (kein Recht) antwortet am Server ebenfalls 404; darum gilt «gelöscht» nur, wenn er auch nicht lesbar ist.
    if (m && m.art !== 'anlegen' && r.status === 404) {
      const f = await holeFremd(m.coll, m.eid);
      if (f.fremd === null && !f.unbekannt) return { ok: false, konflikt: [{ coll: m.coll, eid: m.eid, art: 'geloescht', fremd: null }] };
    }
    // Anlegen scheitert, weil der Datensatz inzwischen existiert (eindeutiger Index) → Konflikt «existiert»
    if (m?.art === 'anlegen' && r.status === 400) {
      const f = await holeFremd(m.coll, m.eid);
      if (f.fremd) return { ok: false, konflikt: [{ coll: m.coll, eid: m.eid, art: 'existiert', ...f }] };
    }
    return { ok: false, fehler: { status: r.status, code: r.code, message: r.message } };
  }

  // Warteschlange der Reihe nach senden. Offline/abgemeldet: alles bleibt in `offen`. Konflikt oder
  // Fehler: genau dieser Eintrag verlässt die Schlange und kommt als `aend` zurück, der Rest bleibt
  // liegen (er baut womöglich darauf auf) und wartet auf die Entscheidung des Aufrufers.
  async function leeren() {
    let limits = 0;
    const meine = abbruch;
    while (queue.length) {
      const r = await schicke(queue[0]);
      if (r.ok) { queue.shift(); limits = 0; continue; }
      if (r.offline || r.abgemeldet) return r;
      if (r.limit) { // vorübergehend: Eintrag bleibt in `offen`, Wiederversuch mit Backoff, kein Zurücknehmen
        if (++limits >= LIMIT_VERSUCHE) return { ok: false, limit: true, offen: queue.length };
        await warte(backoff(limits - 1));
        if (abbruch !== meine) return { ok: false, offline: true }; // Server wurde geschlossen: nichts mehr senden
        continue;
      }
      const kopf = queue.shift();
      entwerten(kopf.aend);
      if (!queue.length) vorhergesagt.clear();
      return { ...r, aend: kopf.aend, offen: queue.length };
    }
    vorhergesagt.clear();
    return { ok: true };
  }

  // halten(): Schlüssel («coll|eid») der Datensätze, deren Inhalt die App NICHT übernimmt (offene eigene Änderung):
  // ihre Basis-rev bleibt, auch wenn der Server inzwischen weiter ist.
  async function laden(halten) {
    return seriell(async () => {
      const s = await sitzung(pb);
      if (s) return s;
      const gelesen = {};
      for (const c of COLLS) {
        const r = await pb.liste(c, planFilter(id), c === 'plaene' ? '' : 'pos,created');
        if (!r.ok) return istNetz(r) ? { ok: false, offline: true } : istAuth(r) ? { ok: false, abgemeldet: true } : istVoruebergehend(r) ? { ok: false, limit: true } : { ok: false, fehler: { status: r.status, code: r.code, message: r.message } };
        gelesen[c] = r.items;
      }
      if (!gelesen.plaene.length) return { ok: false, nichtGefunden: true };
      const mi = await pb.liste('mitglieder', planFilter(id));
      if (!mi.ok && istNetz(mi)) return { ok: false, offline: true };
      const neuerStand = new Map(COLLS.map((c) => [c, new Map()]));
      const gehalten = new Set([...queue.flatMap((e) => beruehrt(e.aend)), ...(halten ? halten() : [])]);
      const teile = {}, reihe = {};
      for (const c of COLLS) {
        teile[c] = new Map();
        reihe[c] = [];
        for (const rec of gelesen[c]) {
          const eid = eidVon(c, rec);
          teile[c].set(eid, KLON(rec.daten));
          reihe[c].push(eid);
          const alt = stand.get(c).get(eid);
          neuerStand.get(c).set(eid, { id: rec.id, rev: alt && gehalten.has(schluessel(c, eid)) ? alt.rev : rec.rev, gehoert: rec.rev });
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
      if (istEcho(`${thema}|${eid}|${record.rev}|${art}`)) return; // eigenes Echo
      const bekannt = stand.get(thema)?.get(eid);
      if (art !== 'delete' && bekannt && (bekannt.gehoert ?? bekannt.rev) >= record.rev) return; // schon gehört
      if (art === 'delete') stand.get(thema)?.delete(eid); else hoere(thema, record);
      handler({ coll: thema, eid, rev: art === 'delete' ? null : record.rev, objekt: art === 'delete' ? null : KLON(record.daten ?? null) });
    });
  }

  return {
    laden,
    /** → {ok:true} | {ok:false, konflikt:[{coll,eid,art,fremd,rev}], aend} | {ok:false, offline:true}
     *  | {ok:false, abgemeldet:true} | {ok:false, fehler:{status,code,message}, aend} */
    senden(aend) {
      if (!aend || istLeer(aend)) return Promise.resolve({ ok: true });
      // Zu groß: nichts wird gesendet oder eingereiht (ein Batch fasst höchstens MAX_BATCH Anfragen)
      if (zaehle(aend) > MAX_BATCH) return Promise.resolve({ ok: false, zuGross: true });
      // Die Basis (rev je Datensatz) gilt ab JETZT, nicht erst wenn die Reihe dran ist: bis dahin kann ein Batch
      // unterwegs sein, ein Backoff laufen oder ein Laden den Stand ersetzen. Darum auch das Einreihen sofort.
      queue.push({ aend, basis: basisFuer(aend) });
      return seriell(leeren);
    },
    /** Die App hat den Inhalt (coll, eid) in der rev übernommen (angezeigt): ab jetzt ist das die Basis eigener Änderungen. */
    uebernommen(coll, eid, rev) {
      const b = stand.get(coll)?.get(eid);
      if (b && Number.isFinite(rev) && rev > b.rev) b.rev = rev;
    },
    /** Nach dem Wiederverbinden die Warteschlange senden (Ergebnis wie senden). */
    wiederVerbunden() { return seriell(leeren); },
    /** Warteschlange verwerfen (z. B. nach neuem Laden, wenn der lokale Stand ersetzt wurde). */
    offenVerwerfen() { queue = []; vorhergesagt.clear(); },
    get offen() { return queue.map((e) => e.aend); },
    /** beiFremd({coll, eid, objekt|null}) für Änderungen anderer; eigene Echos werden verschluckt. Gibt stop() zurück. */
    abonnieren(beiFremd) {
      handler = beiFremd;
      aboStarten();
      return () => { stopAbo?.(); stopAbo = null; handler = null; };
    },
    /** Nach einer Token-Erneuerung: Verbindung neu aufbauen, damit sie das neue Token trägt. */
    neuAbonnieren() { if (handler) aboStarten(); },
    /** Neuen Plan (Import/Vorlage/Neu) anlegen: neue plan_id, EIN Batch. → {ok, planId, state} (state trägt die neue id)
     *  | {ok:false, zuGross:true} | {ok:false, offenVorhanden:true} (die Warteschlange des alten Plans ist nicht leer). */
    planAnlegen(state) {
      return seriell(async () => {
        if (queue.length) return { ok: false, offenVorhanden: true };
        const neu = KLON(state);
        const neu_id = neueId();
        neu.project = { ...neu.project, id: neu_id };
        const teile = zerlegen(neu);
        const aend = {};
        for (const c of COLLS) aend[c] = { anlegen: [...teile[c].values()], anlegenPos: [...teile[c].keys()].map((_, i) => i), aendern: [], loeschen: [] };
        if (zaehle(aend) > MAX_BATCH) return { ok: false, zuGross: true };
        const alt = { id, stand };
        id = neu_id;
        stand = new Map(COLLS.map((c) => [c, new Map()]));
        let r;
        for (let versuch = 0; versuch < PLAN_VERSUCHE; versuch++) {
          r = await schicke({ aend, basis: new Map() });
          if (!r.limit || versuch === PLAN_VERSUCHE - 1) break;
          await warte(backoff(versuch)); // 429: der Batch ist zurückgerollt, derselbe Plan nochmal
        }
        if (r.ok) { vorhergesagt.clear(); return { ok: true, planId: id, state: neu }; }
        id = alt.id; stand = alt.stand; // ein Batch: bei Fehler ist nichts angelegt
        return r;
      });
    },
    /** Plan samt allen Datensätzen löschen (der Hook kaskadiert). */
    planLoeschen() {
      return seriell(async () => {
        if (!stand.get('plaene').has(id)) { const f = await holeFremd('plaene', id); if (f.unbekannt) return { ok: false, offline: true }; }
        const p = stand.get('plaene').get(id);
        if (!p) return { ok: false, nichtGefunden: true };
        const r = await batchDrosselt([{ method: 'DELETE', url: `/api/collections/plaene/records/${p.id}?rev=${p.rev}` }]);
        if (r.ok) { stand = new Map(COLLS.map((c) => [c, new Map()])); queue = []; vorhergesagt.clear(); return { ok: true }; }
        if (istNetz(r)) return { ok: false, offline: true };
        if (istAuth(r)) return { ok: false, abgemeldet: true };
        if (istLimit(r)) return { ok: false, limit: true };
        return { ok: false, fehler: { status: r.status, code: r.code, message: r.message } };
      });
    },
    /** Schließen: Warteschlange verwerfen, ein laufender 429-Backoff sendet nichts mehr. */
    beenden() { abbruch++; queue = []; vorhergesagt.clear(); },
  };
}
