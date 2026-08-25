/// <reference path="../pb_data/types.d.ts" />
// ── Bauzeitenplan · PocketBase-Hooks ─────────────────────────────────────────
// Was die API-Rules allein nicht können:
//
//  1. Ein Lead darf einen Vorgang nicht AUS seinem Gewerk herausschieben. Die
//     Update-Rule prüft nur den ALTEN gewerk-Wert; hier prüfen wir den NEUEN.
//  2. Neue Nutzer: automatisch verifizieren und anhand der (kleingeschriebenen)
//     E-Mail einer offenen Mitgliedschaft zuordnen (Einladungs-/Pool-Muster).
//
// Alles hartkodiert — der Goja-Sandbox sieht keine äußeren Variablen.

// ── 1. Task-Wächter: neues Gewerk muss zur Zuständigkeit passen ──────────────
function guardTask(e) {
  const auth = e.auth;
  if (!auth) { e.next(); return; }                       // Rule verlangt bereits Login
  if (auth.collection().name === '_superusers') { e.next(); return; }

  const projectId = e.record.get('project');
  const gewerk = e.record.get('gewerk');
  const uid = auth.id;
  const email = String(auth.get('email') || '').trim().toLowerCase();

  // Owner oder Admin-Mitglied → freie Fahrt
  let priv = false;
  try {
    const proj = e.app.findRecordById('projects', projectId);
    if (proj && proj.get('owner') === uid) priv = true;
  } catch (_) {}
  if (!priv) {
    try {
      e.app.findFirstRecordByFilter('memberships',
        "project = {:p} && email = {:e} && role = 'admin'", { p: projectId, e: email });
      priv = true;
    } catch (_) {}
  }
  if (priv) { e.next(); return; }

  // Lead: das Ziel-Gewerk muss in seinen lead_scopes stehen (per E-Mail)
  try {
    e.app.findFirstRecordByFilter('lead_scopes',
      'project = {:p} && email = {:e} && gewerk = {:g}', { p: projectId, e: email, g: gewerk });
    e.next();
    return;
  } catch (_) {}

  throw new ForbiddenError('Dieses Gewerk liegt außerhalb deiner Zuständigkeit.');
}

onRecordCreateRequest(guardTask, 'tasks');
onRecordUpdateRequest(guardTask, 'tasks');

// ── 2. Neue Nutzer: verifizieren + Mitgliedschaft verknüpfen ─────────────────
onRecordCreateRequest((e) => {
  e.record.set('verified', true);
  e.next();

  // Nach dem Anlegen: offene Mitgliedschaften mit dieser E-Mail auf die neue
  // user-Id ziehen (der Einladende trägt nur die E-Mail ein).
  const email = String(e.record.get('email') || '').trim().toLowerCase();
  if (!email) return;
  try {
    const open = e.app.findRecordsByFilter('memberships', 'email = {:e} && user = ""', '', 0, 0, { e: email });
    for (const m of open) { m.set('user', e.record.id); e.app.save(m); }
  } catch (_) {}
}, 'users');
