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
    // Probe für „Verbinden“: sieht der Schlüssel das Repo überhaupt?
    async pruefe() {
      const r = await rufe(`${API}/repos/${repo}`, 'GET');
      if (r.status === 404) return { ok: false, grund: 'repo', status: 404 };
      if (r.fehler) return r.fehler;
      return { ok: true };
    },
    async list() {
      const r = await rufe(url(DIR), 'GET');
      // 404 und «kein Array» heißen nur dann «leeres Repo», wenn das Repo selbst
      // erreichbar ist. Sonst (Token ohne Zugriff, Repo fehlt) hielte abgleich()
      // alle synchronen Projekte für gelöscht.
      if (r.status === 404 || (!r.fehler && !Array.isArray(r.json))) {
        const p = await this.pruefe();
        return p.ok ? { ok: true, dateien: [] } : p;
      }
      if (r.fehler) return r.fehler;
      const dateien = r.json
        .filter((e) => e.type === 'file' && /\.json$/.test(e.name))
        .map((e) => ({ id: e.name.replace(/\.json$/, ''), sha: e.sha }));
      return { ok: true, dateien };
    },
    async pull(id) {
      const r = await rufe(url(`${DIR}/${encodeURIComponent(id)}.json`), 'GET');
      if (r.fehler) return r.fehler;
      if (!r.json || typeof r.json.content !== 'string' || !r.json.sha) return { ok: false, grund: 'fehler', status: r.status };
      try { return { ok: true, text: dekodiere(r.json.content), sha: r.json.sha }; }
      catch { return { ok: false, grund: 'fehler', status: r.status }; }
    },
    async push(id, text, sha) {
      const body = { message: 'Plan ' + id, content: kodiere(text), branch };
      if (sha) body.sha = sha;
      const r = await rufe(urlOhneRef(`${DIR}/${encodeURIComponent(id)}.json`), 'PUT', body);
      if (r.fehler) return r.fehler;
      const neu = r.json && r.json.content && r.json.content.sha;
      if (!neu) return { ok: false, grund: 'fehler', status: r.status };
      return { ok: true, sha: neu };
    },
    async remove(id, sha) {
      const r = await rufe(urlOhneRef(`${DIR}/${encodeURIComponent(id)}.json`), 'DELETE', { message: 'Plan ' + id + ' gelöscht', sha, branch });
      if (r.fehler) return r.fehler;
      return { ok: true };
    },
  };
}

// Entscheidung je Projekt: was tun, damit lokal und Daten-Repo übereinstimmen?
// Rein, ohne DOM und Netz. Lokale zuerst (Eingabereihenfolge), dann nur-remote.
export function abgleich(lokal, remote) {
  const rem = new Map(remote.map((r) => [r.id, r.sha]));
  const aus = [];
  for (const l of lokal) {
    if (!rem.has(l.id)) {
      if (l.remoteSha == null) aus.push({ art: 'hochladen', id: l.id, sha: null });
      else if (!l.dirty) aus.push({ art: 'lokal-loeschen', id: l.id });
      else aus.push({ art: 'hochladen', id: l.id, sha: null });
      continue;
    }
    const sha = rem.get(l.id);
    if (l.remoteSha == null) aus.push({ art: 'konflikt', id: l.id, sha });
    else if (l.remoteSha === sha) {
      if (l.dirty) aus.push({ art: 'hochladen', id: l.id, sha });
    } else aus.push({ art: l.dirty ? 'konflikt' : 'herunterladen', id: l.id, sha });
  }
  const lok = new Set(lokal.map((l) => l.id));
  for (const r of remote) if (!lok.has(r.id)) aus.push({ art: 'herunterladen', id: r.id, sha: r.sha });
  return aus;
}

// Inhaltlicher Vergleich zweier Pläne (Schlüsselreihenfolge egal); `quelle` und
// `exported` zählen nicht — sie sind Stempel, keine Planinhalte.
const kanon = (v) => {
  if (Array.isArray(v)) return v.map(kanon);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, kanon(v[k])]));
  }
  return v;
};
// Der Inhalt ohne Stempel, kanonisch — die eine Rechnung für Vergleich und Fingerabdruck.
const teil = (p) => {
  const { quelle, ...project } = (p && p.project) || {};
  return kanon({ project, gewerke: p && p.gewerke, tasks: p && p.tasks, deps: p && p.deps, phases: (p && p.phases) || [] });   // fehlend = leer: Altstand und migrierter Plan sind gleich
};
export function gleicherPlan(a, b) {
  return JSON.stringify(teil(a)) === JSON.stringify(teil(b));
}

// Kurzer Fingerabdruck des Planinhalts (FNV-1a, hex), ohne `quelle`. Er wird beim
// Laden einer mitgelieferten Datei in `quelle.hash` gemerkt: stimmt er später noch,
// hat niemand etwas geändert, und ein neuer Planstand darf ohne Rückfrage ersetzen.
export function planHash(plan) {
  const t = JSON.stringify(teil(plan));
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** Ist der Plan seit dem Laden der Datei unverändert? Ohne gemerkten Hash: unbekannt = nein. */
export function unveraendert(plan) {
  const h = plan && plan.project && plan.project.quelle && plan.project.quelle.hash;
  return !!h && planHash(plan) === h;
}
