// GitHub-Client für den Plan-Sync — DOM-frei. `fetch` wird hereingereicht
// (wie `storage` in persistence.js), damit Node-Tests ohne Netz laufen.
// Ein Plan = eine Datei `projekte/<id>.json` im privaten Daten-Repo.

export const SYNC_REPO = 'M4dm0nky/Bauzeitenplan-Daten';
const API = 'https://api.github.com';
const DIR = 'projekte';

// UTF-8 ↔ Base64. btoa wirft auf „Bühne“/„👤“, deshalb über Bytes; chunkweise,
// weil String.fromCharCode(...ganzeBytes) bei großen Plänen das Stack-Limit reißt.
export const kodiere = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

// GitHub liefert Base64 mit Zeilenumbrüchen alle 60 Zeichen — vorher raus.
export const dekodiere = (b64) => {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

export function createSync({ fetch, token, repo, branch = 'main' }) {
  const kopf = () => ({
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  });
  const url = (pfad) => `${API}/repos/${repo}/contents/${pfad}?ref=${encodeURIComponent(branch)}`;
  const urlOhneRef = (pfad) => `${API}/repos/${repo}/contents/${pfad}`;

  // Jeder Abruf: no-store (GitHub-GETs sind 60 s cachebar → sonst alte sha, Scheinkonflikt).
  // Wirft nie: Netzfehler → {offline}, sonst Status → Grund.
  const rufe = async (u, methode, body) => {
    const init = { method: methode, headers: kopf(), cache: 'no-store' };
    if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    let r;
    try { r = await fetch(u, init); } catch { return { fehler: { ok: false, grund: 'offline' } }; }
    const schreibend = methode !== 'GET';
    if (r.ok) {
      let json = null;
      try { json = await r.json(); } catch { /* leerer Körper */ }
      return { status: r.status, json };
    }
    const grund = (r.status === 401 || r.status === 403) ? 'schluessel'
      : (schreibend && (r.status === 409 || r.status === 422)) ? 'konflikt' : 'fehler';
    return { status: r.status, fehler: { ok: false, grund, status: r.status } };
  };

  return {
    async list() {
      const r = await rufe(url(DIR), 'GET');
      if (r.status === 404) return { ok: true, dateien: [] };
      if (r.fehler) return r.fehler;
      const dateien = (Array.isArray(r.json) ? r.json : [])
        .filter((e) => e.type === 'file' && /\.json$/.test(e.name))
        .map((e) => ({ id: e.name.replace(/\.json$/, ''), sha: e.sha }));
      return { ok: true, dateien };
    },
    async pull(id) {
      const r = await rufe(url(`${DIR}/${id}.json`), 'GET');
      if (r.fehler) return r.fehler;
      return { ok: true, text: dekodiere(r.json.content), sha: r.json.sha };
    },
    async push(id, text, sha) {
      const body = { message: 'Plan ' + id, content: kodiere(text), branch };
      if (sha) body.sha = sha;
      const r = await rufe(urlOhneRef(`${DIR}/${id}.json`), 'PUT', body);
      if (r.fehler) return r.fehler;
      return { ok: true, sha: r.json.content.sha };
    },
    async remove(id, sha) {
      const r = await rufe(urlOhneRef(`${DIR}/${id}.json`), 'DELETE', { message: 'Plan ' + id + ' gelöscht', sha, branch });
      if (r.fehler) return r.fehler;
      return { ok: true };
    },
  };
}
