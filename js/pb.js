// ── PocketBase-Client ohne SDK ───────────────────────────────────────────────
// DOM-frei: fetch, speicher (Schnittstelle wie localStorage), EventSource und
// setInterval kommen von außen (Standard: globalThis), damit alles in Node testbar
// bleibt. Kein Aufruf wirft: jede Anfrage liefert { ok:true, … } oder
// { ok:false, status, code, message [, eid, rev, index] }.
//   code: 'rev' (Versionskonflikt, mit eid + rev = aktuelle Version), 'auth' (401),
//         'verboten' (403), 'netz' (kein Kontakt, status 0), sonst 'fehler'.
// Ereignisse über on(name, fn) → off: 'abgemeldet' (Server lehnte das Token ab),
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
  const emit = (n) => { for (const f of [...(hoerer[n] || [])]) { try { f(); } catch { /* Hörer darf nichts brechen */ } } };
  const on = (name, fn) => {
    (hoerer[name] ||= new Set()).add(fn);
    return () => hoerer[name].delete(fn);
  };

  const lesen = () => { try { return speicher?.getItem(AUTH_KEY) ?? null; } catch { return null; } };
  const schreiben = (a) => {
    try { if (a) speicher?.setItem(AUTH_KEY, JSON.stringify(a)); else speicher?.removeItem(AUTH_KEY); } catch { /* Speicher gesperrt: nur im Speicher halten */ }
  };
  const setAuth = (a) => { auth = a; schreiben(a); };
  const abgemeldet = () => { if (auth) { setAuth(null); emit('abgemeldet'); } };
  {
    const j = parse(lesen());
    if (j && typeof j.token === 'string' && j.token) auth = { token: j.token, record: j.record ?? null };
  }

  /** Eine Anfrage. mitAuth=false: nie ein Token mitschicken (Anmeldung). */
  async function anfrage(method, pfad, body, mitAuth = true) {
    const h = {};
    if (body !== undefined && body !== null) h['Content-Type'] = 'application/json';
    const sendetToken = mitAuth && auth;
    if (sendetToken) h.Authorization = auth.token;
    let r, text;
    try {
      r = await fetch(basis + pfad, { method, headers: h, body: body == null ? undefined : JSON.stringify(body) });
      text = await r.text();
    } catch (e) {
      return { ok: false, status: 0, code: 'netz', message: String(e?.message || e) };
    }
    const daten = parse(text);
    if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status, daten };
    if (r.status === 401 && sendetToken) abgemeldet();
    return fehlerForm(r.status, daten);
  }

  const anmelden = async (email, pw) => {
    const r = await anfrage('POST', '/api/collections/users/auth-with-password', { identity: String(email ?? '').trim().toLowerCase(), password: pw }, false);
    if (!r.ok) return r;
    setAuth({ token: r.daten.token, record: r.daten.record });
    return { ok: true, record: r.daten.record };
  };
  const abmelden = () => { setAuth(null); };
  const erneuern = async () => {
    if (!auth) return { ok: false, status: 401, code: 'auth', message: 'Nicht angemeldet.' };
    const r = await anfrage('POST', '/api/collections/users/auth-refresh');
    if (!r.ok) return r; // 401 hat abgemeldet; Netz/5xx lassen die Anmeldung bestehen
    setAuth({ token: r.daten.token, record: r.daten.record });
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
      const d = r.daten || {};
      items.push(...(d.items || []));
      if (!d.items?.length || seite >= (d.totalPages || 0)) return { ok: true, items, total: d.totalItems ?? items.length };
    }
  };
  const eins = async (coll, id) => {
    const r = await anfrage('GET', `/api/collections/${coll}/records/${encodeURIComponent(id)}`);
    return r.ok ? { ok: true, record: r.daten } : r;
  };
  /** anfragen: [{ method, url, body? }] → { ok:true, antworten:[Antwortkörper je Anfrage] }; ein Fehler rollt alles zurück. */
  const batch = async (anfragen) => {
    if (!anfragen?.length) return { ok: true, antworten: [] };
    const r = await anfrage('POST', '/api/batch', { requests: anfragen });
    return r.ok ? { ok: true, antworten: (r.daten || []).map((x) => x?.body ?? null) } : r;
  };
  const post = async (pfad, body) => {
    const r = await anfrage('POST', pfad, body ?? {});
    return r.ok ? { ok: true, daten: r.daten } : r;
  };

  /** Realtime: themen = z. B. ['gewerke','vorgaenge']; beiEreignis({ thema, action, record }). Gibt stop() zurück. */
  function abo(themen, beiEreignis) {
    let es = null, aus = false, getrennt = false, timer = null;
    const verloren = () => { if (!getrennt) { getrennt = true; emit('getrennt'); } };
    const oeffnen = () => {
      timer = null;
      if (aus) return;
      es = new EventSource(basis + '/api/realtime');
      es.addEventListener('PB_CONNECT', async (ev) => {
        const clientId = parse(ev.data)?.clientId;
        const r = await anfrage('POST', '/api/realtime', { clientId, subscriptions: themen });
        if (aus) return;
        if (r.ok) { getrennt = false; emit('verbunden'); return; }
        // Abo abgelehnt (z. B. Token weg): Verbindung neu aufbauen statt tot weiterzulaufen
        verloren();
        try { es.close(); } catch { /* schon zu */ }
        if (r.status !== 401) timer = setTimeout?.(oeffnen, wiederholenMs);
      });
      for (const thema of themen) {
        es.addEventListener(thema, (ev) => {
          const d = parse(ev.data);
          if (d && d.record) { try { beiEreignis({ thema, action: d.action, record: d.record }); } catch { /* Hörer darf den Strom nicht brechen */ } }
        });
      }
      // EventSource verbindet selbst neu; der nächste PB_CONNECT abonniert mit der neuen clientId
      es.onerror = () => verloren();
    };
    oeffnen();
    return () => { aus = true; if (timer != null) clearTimeout?.(timer); try { es?.close(); } catch { /* schon zu */ } };
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
