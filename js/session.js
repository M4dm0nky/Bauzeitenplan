// ── Aktive Session (für die UI-Sperre) ───────────────────────────────────────
// Hält die aufgelöste Rolle/Scopes des eingeloggten Nutzers im aktiven Projekt.
// null = kein Login (localStorage-Modus) → js/roles.js gibt alles frei, die App
// verhält sich exakt wie ohne Benutzerverwaltung.

let current = null;
export const getSession = () => current;
export const setSession = (s) => { current = s; };
