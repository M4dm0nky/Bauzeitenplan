// ── PocketBase-Client (schlanker Fetch-Wrapper) ──────────────────────────────
// Kein SDK — dieselbe Linie wie Crewplaner (js/pb.js): kleiner, keine
// Bundle-Abhängigkeit, `?v=`-Cache-Bust reicht. Token liegt in localStorage
// unter EIGENEN Schlüsseln (bzp_pb_*), stört die localStorage-Pläne (bzp_p_*)
// also nicht.
//
// Basis-URL: lokal 127.0.0.1:8090; produktiv über window.BZP_PB_URL oder
// localStorage['bzp_pb_url'] setzen (z. B. die Coolify-Domain).

const PB_URL = (typeof window !== 'undefined'
  && (window.BZP_PB_URL || window.localStorage?.getItem('bzp_pb_url')))
  || 'http://127.0.0.1:8090';

const K_TOKEN = 'bzp_pb_token';
const K_USER = 'bzp_pb_user';

export const getToken = () => localStorage.getItem(K_TOKEN);
export const getUser = () => { try { return JSON.parse(localStorage.getItem(K_USER) || 'null'); } catch { return null; } };
export const setAuth = (token, user) => { localStorage.setItem(K_TOKEN, token); localStorage.setItem(K_USER, JSON.stringify(user)); };
export const clearAuth = () => { localStorage.removeItem(K_TOKEN); localStorage.removeItem(K_USER); };

/** E-Mails immer klein — PB-Filter sind case-sensitive (Crewplaner-Lektion). */
export const normEmail = (s) => String(s ?? '').trim().toLowerCase();

async function req(method, path, body) {
  const token = getToken();
  const res = await fetch(PB_URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && data.message) || (method + ' ' + path + ' → ' + res.status));
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

const pbGet = (path) => req('GET', path);
export const pbPost = (path, body) => req('POST', path, body);
export const pbPatch = (path, body) => req('PATCH', path, body);
export const pbDelete = (path) => req('DELETE', path);

/** Alle Records einer Collection (folgt der Seitenzahl). */
export async function pbList(coll, filter = '', sort = '') {
  const out = [];
  let page = 1;
  for (;;) {
    const q = new URLSearchParams({ page: String(page), perPage: '200' });
    if (filter) q.set('filter', filter);
    if (sort) q.set('sort', sort);
    const r = await pbGet('/api/collections/' + coll + '/records?' + q.toString());
    out.push(...r.items);
    if (page >= r.totalPages || !r.items.length) break;
    page++;
  }
  return out;
}
