// Rechte-Vorabprüfung im Client — DOM-frei.
//
// Der Server-Hook (pocketbase/pb_hooks/hilfen.js, `pruefe`) erzwingt die Rechte.
// Dieses Modul rechnet dieselben Regeln vorab, damit die App einen verständlichen
// Text zeigt, bevor sie sendet. Maßgeblich bleibt der Hook; bei Abweichung gilt er.
// Eingang ist die Änderungsliste aus aenderungen.js (aenderungen(vorher, nachher)).

const LEITUNG = ['superadmin', 'besitzer', 'produktionsleitung'];
const ROLLEN = [...LEITUNG, 'bearbeiter', 'gewerkeleiter', 'betrachter'];

export const darfBearbeiten = (r) => !!r && ROLLEN.includes(r.rolle) && r.rolle !== 'betrachter';
export const darfMitglieder = (r) => !!r && LEITUNG.includes(r.rolle);
/** Bedarfsstatus setzen (bestätigen/ablehnen) darf nur die Leitung. */
export const darfBedarfStatus = (r) => !!r && LEITUNG.includes(r.rolle);
export const darfPlanAnlegen = (user) => !!user && (!!user.superadmin || !!user.produktionsleitung);

// ── Bedarfsstatus (wie hilfen.js: Multimenge identischer Zeilen) ───────────
function kanon(v) {
  if (Array.isArray(v)) return '[' + v.map(kanon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + kanon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const hatStatus = (z) => {
  z = z || {};
  return !!((z.status && z.status !== 'angefragt') || z.notiz || z.bestaetigtAm);
};
const zeitMs = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const t = Date.parse(v);
  return isNaN(t) ? String(v) : t;
};
const zeitGleich = (a, n) => zeitMs(a.start) === zeitMs(n.start) && zeitMs(a.end) === zeitMs(n.end) && !!a.milestone === !!n.milestone;
function statusGeaendert(altRes, neuRes, zeitUnveraendert) {
  altRes = Array.isArray(altRes) ? altRes : [];
  neuRes = Array.isArray(neuRes) ? neuRes : [];
  if (!zeitUnveraendert) return neuRes.some(hatStatus);
  const vorrat = {};
  for (const z of altRes) { const k = kanon(z); vorrat[k] = (vorrat[k] || 0) + 1; }
  for (const z of neuRes) {
    if (!hatStatus(z)) continue;
    const k = kanon(z);
    if (!vorrat[k]) return true;
    vorrat[k]--;
  }
  return false;
}

const TXT = {
  betrachter: 'Nur ansehen: du bist Betrachter.',
  keinZugang: 'Keine Berechtigung für diesen Plan.',
  bedarf: 'Bedarf bestätigen darf nur die Produktionsleitung.',
  produktion: 'Zeitraum, Phasen und Gewerke ändert die Produktionsleitung oder ein Bearbeiter.',
  bezeichnung: 'Bezeichnungen umbenennen oder löschen darf nur die Produktionsleitung oder ein Bearbeiter; neue anlegen darfst du.',
  verknuepfung: 'Verknüpfungen darfst du nur ändern, wenn der Nachfolger in deinem Gewerk liegt.',
};
const nurText = (gewerke, gewerkName) => (gewerke.length
  ? 'Nur ' + gewerke.map((g) => gewerkName(g)).join(', ') + ' darfst du ändern.'
  : 'Dir ist kein Gewerk zugeordnet, du darfst keine Vorgänge ändern.');

// → null (erlaubt) oder der Text des ERSTEN Fehlers.
// rolle: {rolle, gewerke}; aend: aenderungen(vorher, nachher); vorher: Plan-Zustand
// vor der Änderung (für den Nachfolger einer Verknüpfung); gewerkName: id → Name.
export function rechteFehler(rolle, aend, vorher, gewerkName = (id) => id) {
  if (!rolle || !ROLLEN.includes(rolle.rolle)) return TXT.keinZugang;
  const rl = rolle.rolle;
  const A = (c) => (aend && aend[c]) || { anlegen: [], aendern: [], loeschen: [] };
  const alle = {};
  for (const c of ['plaene', 'ressourcen', 'gewerke', 'vorgaenge', 'phasen', 'verknuepfungen']) {
    const a = A(c);
    alle[c] = a.anlegen.length + a.aendern.length + a.loeschen.length;
  }
  if (!Object.values(alle).some(Boolean)) return null;
  if (rl === 'betrachter') return TXT.betrachter;
  const gl = rl === 'gewerkeleiter';
  const eigene = rolle.gewerke || [];
  const eigen = (g) => g !== 'projekt' && eigene.includes(g);

  if (gl) {
    // Gewerk eines Vorgangs vor/nach der Änderung (Nachfolger einer Verknüpfung)
    const alt = new Map((vorher?.tasks || []).map((t) => [t.id, t]));
    const neu = new Map(alt);
    for (const t of A('vorgaenge').anlegen) neu.set(t.id, t);
    for (const e of A('vorgaenge').aendern) neu.set(e.nachher.id, e.nachher);
    for (const t of A('vorgaenge').loeschen) neu.delete(t.id);
    const nachfolgerEigen = (m, id) => !!m.get(id) && eigen(m.get(id).gewerk);

    for (const t of A('vorgaenge').loeschen) if (!eigen(t.gewerk)) return nurText(eigene, gewerkName);
    for (const e of A('vorgaenge').aendern) if (!eigen(e.vorher.gewerk) || !eigen(e.nachher.gewerk)) return nurText(eigene, gewerkName);
    for (const t of A('vorgaenge').anlegen) if (!eigen(t.gewerk)) return nurText(eigene, gewerkName);
    for (const v of A('verknuepfungen').loeschen) if (!nachfolgerEigen(alt, v.to)) return TXT.verknuepfung;
    for (const e of A('verknuepfungen').aendern) {
      if (!nachfolgerEigen(alt, e.vorher.to) || !nachfolgerEigen(neu, e.nachher.to)) return TXT.verknuepfung;
    }
    for (const v of A('verknuepfungen').anlegen) if (!nachfolgerEigen(neu, v.to)) return TXT.verknuepfung;
    const res = A('ressourcen');
    if (res.aendern.length || res.loeschen.length) return TXT.bezeichnung;
    if (alle.plaene || alle.gewerke || alle.phasen) return TXT.produktion;
  }

  // Bedarf bestätigen: nur Leitung (Bearbeiter und Gewerkeleiter nicht)
  if (!LEITUNG.includes(rl)) {
    for (const t of A('vorgaenge').anlegen) if (statusGeaendert([], t.res, true)) return TXT.bedarf;
    for (const e of A('vorgaenge').aendern) {
      if (statusGeaendert(e.vorher.res, e.nachher.res, zeitGleich(e.vorher, e.nachher))) return TXT.bedarf;
    }
  }
  return null;
}
