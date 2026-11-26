// ── PocketBase-Client ohne SDK ───────────────────────────────────────────────
// DOM-frei: fetch, speicher (Schnittstelle wie localStorage), EventSource und
// setInterval kommen von außen (Standard: globalThis), damit alles in Node testbar
// bleibt. Kein Aufruf wirft: jede Anfrage liefert { ok:true, … } oder
// { ok:false, status, code, message [, eid, rev, index] }.
//   code: 'rev' (Versionskonflikt, mit eid + rev = aktuelle Version), 'auth' (401),
//         'verboten' (403), 'netz' (kein Kontakt, status 0), sonst 'fehler'.
//         'antwort' (2xx, aber kein/falsches JSON, fehlendes Token, zu viele Seiten),
//         'abgebrochen' (Anmeldung/Erneuerung wurde von abmelden()/anderer Anmeldung überholt).
// Ereignisse über on(name, fn) → off: 'abgemeldet' mit { grund: 'manuell' | '401' }
// (abmelden() bzw. der Server lehnte das Token ab; beides schließt alle Realtime-Abos),
// 'verbunden', 'getrennt' (Realtime).

export const AUTH_KEY = 'bzp_auth';
export const ERNEUERN_MS = 6 * 60 * 60 * 1000;
const PRO_SEITE = 500;

const API_LIVE = 'https://api.callboard.nyxlightwork.de';
const API_TEST = 'https://api-test.callboard.nyxlightwork.de';
const LOKAL = ['localhost', '127.0.0.1'];

/** Welche PocketBase gehört zu dieser Seite? `?api=<url>` gilt nur auf localhost/127.0.0.1 (E-5). */
export function apiBasis(loc = globalThis.location) {
  const host = loc?.hostname || '';
  if (LOKAL.includes(host)) {
    const q = new URLSearchParams(loc.search || '').get('api');
    if (q) {
      try {
        const u = new URL(q);
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin;
      } catch { /* ungültig → Standard */ }
    }
    return API_TEST;
  }
  return host === 'callboard.nyxlightwork.de' ? API_LIVE : API_TEST;
}

// Zugriff auf localStorage kann werfen (gesperrte Website-Daten)
const standardSpeicher = () => { try { return globalThis.localStorage; } catch { return undefined; } };
const parse = (t) => { try { return t ? JSON.parse(t) : null; } catch { return t; } };
const MAX_SEITEN = 1000;
const MAX_WARTEN_MS = 60000;
const istObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const falscheAntwort = (status, was) => ({ ok: false, status, code: 'antwort', message: `Unerwartete Antwort des Servers (${was}).` });

/** Fehlerform aus Status + Antwortkörper; Batch-Fehler (400 «Batch transaction failed.») werden bis zur fehlgeschlagenen Unteranfrage aufgelöst. */
function fehlerForm(status, body) {
  let st = status, b = body, index;
  const reqs = body?.data?.requests;
  if (reqs && typeof reqs === 'object') {
    const i = Object.keys(reqs).sort((x, y) => x - y)[0];
    const r = reqs[i]?.response;
    if (r) { st = r.status ?? status; b = r; index = Number(i); }
  }
  const d = b?.data || {};
  const e = { ok: false, status: st, code: 'fehler', message: (b && b.message) || (typeof b === 'string' && b) || `HTTP ${st}` };
  if (d.code?.code === 'rev') {
    e.code = 'rev';
    if (d.eid?.code !== undefined) e.eid = d.eid.code;
    if (d.rev?.code !== undefined && Number.isFinite(Number(d.rev.code))) e.rev = Number(d.rev.code);
  } else if (st === 401) e.code = 'auth';
  else if (st === 403) e.code = 'verboten';
  if (index !== undefined) e.index = index;
  return e;
}

export function createPb({
  basis,
  fetch = globalThis.fetch?.bind(globalThis),
  speicher = standardSpeicher(),
  EventSource = globalThis.EventSource,
  setInterval = globalThis.setInterval?.bind(globalThis),
  setTimeout = globalThis.setTimeout?.bind(globalThis),
  clearInterval = globalThis.clearInterval?.bind(globalThis),
  clearTimeout = globalThis.clearTimeout?.bind(globalThis),
  autostart = true,
  erneuernMs = ERNEUERN_MS,
  wiederholenMs = 5000,
} = {}) {
  basis = String(basis || '').replace(/\/+$/, '');
  let auth = null;
  const hoerer = { abgemeldet: new Set(), verbunden: new Set(), getrennt: new Set() };
  const emit = (n, arg) => { for (const f of [...(hoerer[n] || [])]) { try { f(arg); } catch { /* Hörer darf nichts brechen */ } } };
  const on = (name, fn) => {
    (hoerer[name] ||= new Set()).add(fn);
    return () => hoerer[name].delete(fn);
  };

  const lesen = () => { try { return speicher?.getItem(AUTH_KEY) ?? null; } catch { return null; } };
  const schreiben = (a) => {
    try { if (a) speicher?.setItem(AUTH_KEY, JSON.stringify(a)); else speicher?.removeItem(AUTH_KEY); } catch { /* Speicher gesperrt: nur im Speicher halten */ }
  };
  const setAuth = (a) => { auth = a; schreiben(a); };
  // Sitzungsnummer: zählt jede Anmeldung, jedes Abmelden und jeden Token-Entzug. Antworten, die
  // eine ältere Sitzung angestoßen hat, dürfen weder Token setzen noch die neue Sitzung beenden.
  let sitzung = 0;
  const stops = new Set(); // laufende Abos (stop-Funktionen)
  const beenden = (grund) => {
    sitzung++;
    setAuth(null);
    for (const stop of [...stops]) stop();
    emit('abgemeldet', { grund });
  };
  {
    const j = parse(lesen());
    if (j && typeof j.token === 'string' && j.token) auth = { token: j.token, record: j.record ?? null };
  }

  /** Eine Anfrage. mitAuth=false: nie ein Token mitschicken (Anmeldung). */
  async function anfrage(method, pfad, body, mitAuth = true) {
    const h = {};
    if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
    const sendetToken = mitAuth && auth ? auth.token : null;
    const meineSitzung = sitzung;
    if (sendetToken) h.Authorization = sendetToken;
    let r, text, daten;
    try {
      r = await fetch(basis + pfad, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
      text = await r.text();
      daten = parse(text);
    } catch (e) {
      return { ok: false, status: 0, code: 'netz', message: String(e?.message || e) };
    }
    if (r.status >= 200 && r.status < 300) {
      if (typeof daten === 'string') return falscheAntwort(r.status, 'kein JSON'); // parse gibt bei Nicht-JSON den Text zurück
      return { ok: true, status: r.status, daten };
    }
    // Spätes 401 einer alten Anfrage: nur beenden, wenn Sitzung UND Token noch dieselben sind
    if (r.status === 401 && sendetToken && sitzung === meineSitzung && auth?.token === sendetToken) beenden('401');
    return fehlerForm(r.status, typeof daten === 'string' ? null : daten);
  }

  const anmelden = async (email, pw) => {
    const start = sitzung;
    const r = await anfrage('POST', '/api/collections/users/auth-with-password', { identity: String(email ?? '').trim().toLowerCase(), password: pw }, false);
    if (!r.ok) return r;
    if (!istObj(r.daten) || typeof r.daten.token !== 'string' || !r.daten.token) return falscheAntwort(r.status, 'Token fehlt');
    // Zwischendurch abgemeldet oder anderweitig angemeldet: die späte Antwort verfällt
    if (sitzung !== start) return { ok: false, status: 0, code: 'abgebrochen', message: 'Anmeldung wurde überholt.' };
    sitzung++;
    setAuth({ token: r.daten.token, record: r.daten.record ?? null });
    return { ok: true, record: r.daten.record };
  };
  const abmelden = () => { beenden('manuell'); };
  const erneuern = async () => {
    if (!auth) return { ok: false, status: 401, code: 'auth', message: 'Nicht angemeldet.' };
    const start = sitzung, altesToken = auth.token;
    const r = await anfrage('POST', '/api/collections/users/auth-refresh');
    if (!r.ok) return r; // 401 hat abgemeldet; Netz/5xx lassen die Anmeldung bestehen
    if (!istObj(r.daten) || typeof r.daten.token !== 'string' || !r.daten.token) return falscheAntwort(r.status, 'Token fehlt');
    if (sitzung !== start || auth?.token !== altesToken) return { ok: false, status: 0, code: 'abgebrochen', message: 'Erneuerung wurde überholt.' };
    setAuth({ token: r.daten.token, record: r.daten.record ?? null });
    return { ok: true, record: r.daten.record };
  };

  const liste = async (coll, filter = '', sort = '') => {
    const items = [];
    for (let seite = 1; ; seite++) {
      const q = new URLSearchParams({ page: String(seite), perPage: String(PRO_SEITE) });
      if (filter) q.set('filter', filter);
      if (sort) q.set('sort', sort);
      const r = await anfrage('GET', `/api/collections/${coll}/records?${q}`);
      if (!r.ok) return r;
      const d = r.daten;
      if (!istObj(d) || !Array.isArray(d.items)) return falscheAntwort(r.status, 'items fehlt');
      items.push(...d.items);
      const proSeite = Number.isFinite(d.perPage) ? d.perPage : PRO_SEITE;
      // Ende: leere/kurze Seite, letzte Seite oder kein (brauchbares) totalPages
      if (!d.items.length || d.items.length < proSeite || !Number.isFinite(d.totalPages) || seite >= d.totalPages) return { ok: true, items, total: d.totalItems ?? items.length };
      if (seite >= MAX_SEITEN) return falscheAntwort(r.status, 'mehr als ' + MAX_SEITEN + ' Seiten');
    }
  };
  const eins = async (coll, id) => {
    const r = await anfrage('GET', `/api/collections/${coll}/records/${encodeURIComponent(id)}`);
    if (!r.ok) return r;
    return istObj(r.daten) ? { ok: true, record: r.daten } : falscheAntwort(r.status, 'Datensatz fehlt');
  };
  /** anfragen: [{ method, url, body? }] → { ok:true, antworten:[Antwortkörper je Anfrage] }; ein Fehler rollt alles zurück. */
  const batch = async (anfragen) => {
    if (!anfragen?.length) return { ok: true, antworten: [] };
    const r = await anfrage('POST', '/api/batch', { requests: anfragen });
    if (!r.ok) return r;
    return Array.isArray(r.daten) ? { ok: true, antworten: r.daten.map((x) => x?.body ?? null) } : falscheAntwort(r.status, 'Batch-Antwort ist keine Liste');
  };
  const post = async (pfad, body) => {
    const r = await anfrage('POST', pfad, body ?? {});
    return r.ok ? { ok: true, daten: r.daten } : r;
  };

  /** Realtime: themen = z. B. ['gewerke','vorgaenge']; beiEreignis({ thema, action, record }). Gibt stop() zurück. */
  function abo(themen, beiEreignis) {
    let es = null, aus = false, getrennt = false, timer = null, versuche = 0;
    const verloren = () => { if (!getrennt) { getrennt = true; emit('getrennt'); } };
    // Neuaufbau mit Backoff (wiederholenMs, verdoppelt, höchstens 60 s)
    const spaeter = () => {
      if (aus || timer != null) return;
      const ms = Math.min(wiederholenMs * 2 ** versuche, MAX_WARTEN_MS);
      versuche++;
      timer = setTimeout?.(oeffnen, ms) ?? null;
    };
    const oeffnen = () => {
      timer = null;
      if (aus) return;
      const meins = es = new EventSource(basis + '/api/realtime');
      meins.addEventListener('PB_CONNECT', async (ev) => {
        const clientId = parse(ev.data)?.clientId;
        const r = await anfrage('POST', '/api/realtime', { clientId, subscriptions: themen });
        if (aus || es !== meins) return;
        if (r.ok) { getrennt = false; versuche = 0; emit('verbunden'); return; }
        // Abo abgelehnt: Verbindung schließen. 401/403 sind endgültig (kein Wiederholen in Endlosschleife),
        // alles andere wird mit Backoff neu versucht.
        verloren();
        try { meins.close(); } catch { /* schon zu */ }
        if (r.status !== 401 && r.status !== 403) spaeter();
      });
      for (const thema of themen) {
        es.addEventListener(thema, (ev) => {
          const d = parse(ev.data);
          if (istObj(d) && d.record) { try { beiEreignis({ thema, action: d.action, record: d.record }); } catch { /* Hörer darf den Strom nicht brechen */ } }
        });
      }
      // EventSource verbindet selbst neu (readyState CONNECTING); der nächste PB_CONNECT abonniert mit
      // der neuen clientId. Hat der Browser aufgegeben (CLOSED = 2), bauen wir selbst neu auf.
      meins.onerror = () => {
        verloren();
        if (meins.readyState === 2) { try { meins.close(); } catch { /* schon zu */ } spaeter(); }
      };
    };
    const stop = () => {
      aus = true; stops.delete(stop);
      if (timer != null) { clearTimeout?.(timer); timer = null; }
      try { es?.close(); } catch { /* schon zu */ }
    };
    stops.add(stop);
    oeffnen();
    return stop;
  }

  let taktgeber = null;
  if (autostart) {
    if (auth) erneuern();
    taktgeber = setInterval?.(() => { erneuern(); }, erneuernMs);
    taktgeber?.unref?.();
  }
  const stopTakt = () => { if (taktgeber != null) { clearInterval?.(taktgeber); taktgeber = null; } };

  return {
    get auth() { return auth; },
    get istAngemeldet() { return !!auth; },
    on, anmelden, abmelden, erneuern, liste, eins, batch, post, abo, stopTakt,
  };
}
