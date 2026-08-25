// ── Auth & Session ────────────────────────────────────────────────────────────
// Login/Logout gegen PocketBase, plus das Auflösen der ROLLE im aktiven Projekt
// (memberships) und der GEWERK-SCOPES eines Leads (lead_scopes). Diese Session
// füttert js/roles.js für die UI-Sperre — die harte Durchsetzung bleibt beim
// Server.

import { pbPost, pbList, getToken, getUser, setAuth, clearAuth, normEmail } from './pb.js';

/** Ist überhaupt jemand eingeloggt? */
export const isLoggedIn = () => !!getToken();

/** E-Mail + Passwort → Token (wirft bei Fehlschlag). */
export async function login(email, password) {
  const data = await pbPost('/api/collections/users/auth-with-password', { identity: normEmail(email), password });
  setAuth(data.token, data.record);
  return data.record;
}

export function logout() {
  clearAuth();
}

/** Token auffrischen; bei Ungültigkeit ausloggen. Liefert den User oder null. */
export async function refresh() {
  if (!getToken()) return null;
  try {
    const data = await pbPost('/api/collections/users/auth-refresh', {});
    setAuth(data.token, data.record);
    return data.record;
  } catch {
    clearAuth();
    return null;
  }
}

/**
 * Session für ein Projekt: Rolle + Gewerk-Scopes des eingeloggten Nutzers.
 * Owner zählt als admin. Ohne Login → null (localStorage-Modus).
 */
export async function resolveSession(projectId) {
  const user = getUser();
  if (!user) return null;
  const base = { userId: user.id, email: user.email, name: user.name, role: null, scopes: [] };
  if (!projectId) return base;

  const email = normEmail(user.email);
  const mine = await pbList('memberships', `project='${projectId}' && email='${email}'`);
  let role = mine.length ? mine[0].role : null;

  // Owner des Projekts ist immer admin, auch ohne Mitgliedschaftszeile.
  try {
    const proj = await pbList('projects', `id='${projectId}'`);
    if (proj.length && proj[0].owner === user.id) role = 'admin';
  } catch { /* Leserecht evtl. eingeschränkt — Mitgliedschaft entscheidet */ }

  let scopes = [];
  if (role === 'lead') {
    const sc = await pbList('lead_scopes', `project='${projectId}' && email='${email}'`);
    scopes = sc.map((x) => x.gewerk);
  }
  return { ...base, role, scopes };
}
