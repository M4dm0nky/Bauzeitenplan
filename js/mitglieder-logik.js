// ── Mitglieder und Verwaltung: Logik ohne DOM ─────────────────────────────────
// Der Dialog (js/mitglieder.js) rendert nur; was zusammengeführt, geprüft oder in
// Text gefasst wird, steht hier und hat Tests (tests/mitglieder-logik.test.mjs).
// Die Server-Regeln (Hook/Migration) bleiben die Sicherheit; hier nur Vorabprüfung.

export const ROLLEN = ['produktionsleitung', 'bearbeiter', 'gewerkeleiter', 'betrachter'];
export const LIMIT_HINWEIS = 'Zu viele Anfragen – bitte kurz warten.';
const MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const klein = (s) => String(s ?? '').trim().toLowerCase();
const gewerkeListe = (g) => (Array.isArray(g) ? g.filter((x) => typeof x === 'string') : []);

/** Fehlertext aus einer pb-Antwort ({ok:false, code, message}). */
export function fehlerText(r) {
  if (!r) return 'Unbekannter Fehler.';
  if (r.code === 'limit') return LIMIT_HINWEIS;
  if (r.code === 'netz') return 'Keine Verbindung zum Server.';
  if (r.code === 'auth') return 'Die Anmeldung ist abgelaufen.';
  return r.message || 'Unbekannter Fehler.';
}

/**
 * Die Liste des Dialogs: Besitzer, Mitglieder (mit Name/E-Mail aus users) und offene Einladungen.
 * plan = {besitzer}; users = [{id,name,email}] (E-Mail kann fehlen: emailVisibility).
 * Der Besitzer ist KEIN Mitglied (Plan-Feld `besitzer`), steht aber an erster Stelle.
 */
export function mitgliederListe({ plan, mitglieder = [], users = [], einladungen = [], jetzt = Date.now() }) {
  const nach = new Map(users.map((u) => [u.id, u]));
  const name = (u, id) => (u?.name || '').trim() || (u?.email || '').trim() || 'Unbekanntes Konto (' + String(id).slice(0, 6) + ')';
  const bu = plan?.besitzer ? nach.get(plan.besitzer) : null;
  const besitzer = plan?.besitzer ? { user_id: plan.besitzer, name: name(bu, plan.besitzer), email: bu?.email || '' } : null;
  const zeilen = mitglieder.map((m) => {
    const u = nach.get(m.user_id);
    return { id: m.id, user_id: m.user_id, name: name(u, m.user_id), email: u?.email || '', rolle: m.rolle, gewerke: gewerkeListe(m.gewerke) };
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const offen = einladungen.map((e) => ({
    id: e.id, email: e.email, rolle: e.rolle, gewerke: gewerkeListe(e.gewerke), ablauf: e.ablauf,
    abgelaufen: !Number.isNaN(Date.parse(String(e.ablauf || '').replace(' ', 'T'))) && Date.parse(String(e.ablauf).replace(' ', 'T')) < jetzt,
  })).sort((a, b) => a.email.localeCompare(b.email, 'de'));
  return { besitzer, mitglieder: zeilen, einladungen: offen };
}

/**
 * Rolle + Gewerke prüfen (Einladen und Ändern): Gewerke gehören nur zur Gewerkeleiter und
 * müssen dort mindestens eines enthalten; unbekannte Gewerk-ids fallen weg.
 * → { fehler } | { rolle, gewerke }
 */
export function rolleGewerke(rolle, gewerke, bekannt = []) {
  if (!ROLLEN.includes(rolle)) return { fehler: 'Bitte eine Rolle wählen.' };
  if (rolle !== 'gewerkeleiter') return { rolle, gewerke: [] };
  const ids = gewerkeListe(gewerke).filter((g) => bekannt.includes(g));
  if (!ids.length) return { fehler: 'Wähle mindestens ein Gewerk für die Gewerkeleiter.' };
  return { rolle, gewerke: [...new Set(ids)] };
}

/** Einladung vorab prüfen. mitglieder = zusammengeführte Zeilen (E-Mail nur, wenn sichtbar). */
export function einladungPruefen({ email, rolle, gewerke, bekannt = [], zeilen = [], einladungen = [] }) {
  const m = klein(email);
  if (!m) return { fehler: 'Bitte eine E-Mail-Adresse eintragen.' };
  if (!MAIL.test(m)) return { fehler: 'Das ist keine gültige E-Mail-Adresse.' };
  if (zeilen.some((z) => klein(z.email) === m)) return { fehler: 'Diese Adresse ist schon Mitglied im Plan.' };
  if (einladungen.some((e) => klein(e.email) === m)) return { fehler: 'Diese Adresse ist schon eingeladen. Zieh die Einladung zurück, um sie neu zu schicken.' };
  const r = rolleGewerke(rolle, gewerke, bekannt);
  return r.fehler ? r : { email: m, rolle: r.rolle, gewerke: r.gewerke };
}

/**
 * Darf der Knopf «Entfernen» wirken? Der Hook kennt keine Sperre für Mitglieder (nur die
 * Collection-Regel: Verwalter). Der Besitzer ist kein Mitglied und hat keine Zeile zum Entfernen.
 * → { gesperrt: Text|null, warnung: Text|null }
 */
export function entfernenInfo({ zeile, ichId, ichRolle }) {
  const selbst = zeile.user_id === ichId;
  if (!selbst) return { gesperrt: null, warnung: null };
  const leitung = ichRolle === 'besitzer' || ichRolle === 'superadmin';
  return {
    gesperrt: null,
    warnung: leitung ? null : 'Das bist du selbst: danach hast du keinen Zugriff mehr auf diesen Plan und kannst dich nicht wieder einladen.',
  };
}

/** Verwaltung: Konten sortiert, Pläne mit Besitzername und Mitgliederzahl. */
export function verwaltungListe({ users = [], plaene = [], mitglieder = [] }) {
  const nach = new Map(users.map((u) => [u.id, u]));
  const anzeige = (u) => (u?.name || '').trim() || (u?.email || '').trim() || '—';
  const konten = users.map((u) => ({ id: u.id, name: anzeige(u), email: u.email || '', superadmin: !!u.superadmin, produktionsleitung: !!u.produktionsleitung }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const zahl = new Map();
  for (const m of mitglieder) zahl.set(m.plan_id, (zahl.get(m.plan_id) || 0) + 1);
  const liste = plaene.map((p) => ({
    plan_id: p.plan_id, name: p.daten?.name || '(ohne Namen)', venue: p.daten?.venue || '',
    besitzer: p.besitzer ? anzeige(nach.get(p.besitzer)) : 'kein Besitzer', mitglieder: zahl.get(p.plan_id) || 0,
  })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { konten, plaene: liste };
}

/** Eine Umschaltung des Flags `produktionsleitung`: nie am Superadmin (der darf ohnehin alles). */
export function leitungSchalterGesperrt(konto) {
  return konto.superadmin ? 'Der Superadmin darf ohnehin Pläne anlegen.' : null;
}
