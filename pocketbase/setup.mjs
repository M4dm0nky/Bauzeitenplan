// ── PocketBase einrichten (lokal) ─────────────────────────────────────────────
// Legt die Collections + API-Rules an und sät Testdaten. Idempotent: löscht die
// eigenen Collections und Test-Nutzer vorher und baut sie neu.
//
//   node pocketbase/setup.mjs            gegen http://127.0.0.1:8090
//   PB_URL=… PB_ADMIN=… PB_PW=… node pocketbase/setup.mjs
//
// Danach liegt in pocketbase/pb_schema.json ein Schnappschuss für den Import auf
// Coolify. Die API-Rules sind der Sicherheitskern — nach jedem Coolify-Redeploy
// neu prüfen (sie fallen sonst auf «auth != ""» zurück, siehe README).

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN = process.env.PB_ADMIN || 'admin@bzp.local';
const PW = process.env.PB_PW || 'devpass1234';

const norm = (s) => String(s ?? '').trim().toLowerCase();

// ── HTTP ──────────────────────────────────────────────────────────────────
let token = '';
async function api(method, path, body) {
  const res = await fetch(URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}\n${JSON.stringify(data, null, 2)}`);
  return data;
}

// ── Feld-Kurzformen ─────────────────────────────────────────────────────────
const txt = (name, required = false) => ({ name, type: 'text', required, max: 0, min: 0, pattern: '' });
const num = (name) => ({ name, type: 'number' });
const bool = (name) => ({ name, type: 'bool' });

// Mitgliedschaft & Scopes hängen an der E-Mail, nicht an der user-Id: so kann man
// jemanden einladen, BEVOR er ein Konto hat (Crewplaner-Muster, @request.auth.email).
// `P` = Feldname, unter dem die Projekt-Id im jeweiligen Record steht
// (bei projects selbst: «id»).
const readRule = (P) => `@request.auth.id != "" && ((@collection.projects.id ?= ${P} && @collection.projects.owner ?= @request.auth.id) || (@collection.memberships.project ?= ${P} && @collection.memberships.email ?= @request.auth.email))`;
// Strukturrechte: nur Owner oder Admin-Mitglied.
const adminRule = (P) => `@request.auth.id != "" && ((@collection.projects.id ?= ${P} && @collection.projects.owner ?= @request.auth.id) || (@collection.memberships.project ?= ${P} && @collection.memberships.email ?= @request.auth.email && @collection.memberships.role = "admin"))`;
// Task-Rechte: Admin/Owner überall, Lead nur in seinem Gewerk.
const taskRule = `${adminRule('project')} || (@collection.lead_scopes.project ?= project && @collection.lead_scopes.email ?= @request.auth.email && @collection.lead_scopes.gewerk ?= gewerk)`;
// Owner verwaltet Mitglieder/Scopes; jeder sieht seine eigenen (per E-Mail).
const ownerManage = (P) => `@request.auth.id != "" && @collection.projects.id ?= ${P} && @collection.projects.owner ?= @request.auth.id`;
const selfOrOwner = (P) => `@request.auth.id != "" && (email = @request.auth.email || (@collection.projects.id ?= ${P} && @collection.projects.owner ?= @request.auth.id))`;

// ── Collections ──────────────────────────────────────────────────────────────
const COLLECTIONS = [
  {
    name: 'projects', type: 'base',
    fields: [txt('name', true), txt('venue'), txt('start', true), txt('end'), txt('timezone'), txt('owner', true), num('schema')],
    listRule: readRule('id'), viewRule: readRule('id'),
    createRule: '@request.auth.id != "" && owner = @request.auth.id',
    updateRule: adminRule('id'), deleteRule: adminRule('id'),
  },
  {
    name: 'gewerke', type: 'base',
    fields: [txt('project', true), txt('gid', true), txt('name', true), num('sort'), num('slot')],
    listRule: readRule('project'), viewRule: readRule('project'),
    createRule: adminRule('project'), updateRule: adminRule('project'), deleteRule: adminRule('project'),
  },
  {
    name: 'tasks', type: 'base',
    fields: [txt('project', true), txt('tid', true), txt('gewerk', true), txt('title'), txt('start'), txt('end'),
      bool('milestone'), num('progress'), txt('status'), num('crew'), txt('notes'), bool('estimated')],
    listRule: readRule('project'), viewRule: readRule('project'),
    createRule: taskRule, updateRule: taskRule, deleteRule: taskRule,
  },
  {
    name: 'deps', type: 'base',
    fields: [txt('project', true), txt('did', true), txt('from', true), txt('to', true), txt('type'), num('lag')],
    listRule: readRule('project'), viewRule: readRule('project'),
    createRule: adminRule('project'), updateRule: adminRule('project'), deleteRule: adminRule('project'),
  },
  {
    name: 'memberships', type: 'base',
    fields: [txt('project', true), txt('email', true), txt('role', true), txt('user')],
    listRule: selfOrOwner('project'), viewRule: selfOrOwner('project'),
    createRule: ownerManage('project'), updateRule: ownerManage('project'), deleteRule: ownerManage('project'),
  },
  {
    name: 'lead_scopes', type: 'base',
    fields: [txt('project', true), txt('email', true), txt('gewerk', true)],
    listRule: selfOrOwner('project'), viewRule: selfOrOwner('project'),
    createRule: ownerManage('project'), updateRule: ownerManage('project'), deleteRule: ownerManage('project'),
  },
];

// ── Ablauf ────────────────────────────────────────────────────────────────
async function main() {
  console.log('  Anmelden als Superuser …');
  token = (await api('POST', '/api/collections/_superusers/auth-with-password', { identity: ADMIN, password: PW })).token;

  // users: Feld «name» ergänzen (falls noch nicht da)
  const users = await api('GET', '/api/collections/users');
  if (!users.fields.some((f) => f.name === 'name')) {
    users.fields.push(txt('name'));
    await api('PATCH', '/api/collections/users', { fields: users.fields });
    console.log('  ✓ users.name ergänzt');
  }

  // Eigene Collections neu bauen (in Reihenfolge löschen: erst Kinder)
  const all = await api('GET', '/api/collections?perPage=200');
  const mine = new Set(COLLECTIONS.map((c) => c.name));
  for (const c of all.items.filter((c) => mine.has(c.name))) {
    await api('DELETE', '/api/collections/' + c.id);
  }
  // Erst ohne Regeln anlegen — die Regeln verweisen kreuzweise aufeinander
  // (projects ↔ memberships), also müssen alle Collections zuerst existieren.
  for (const c of COLLECTIONS) {
    await api('POST', '/api/collections', { name: c.name, type: c.type, fields: c.fields });
  }
  // Dann die Regeln setzen.
  for (const c of COLLECTIONS) {
    await api('PATCH', '/api/collections/' + c.name, {
      listRule: c.listRule, viewRule: c.viewRule,
      createRule: c.createRule, updateRule: c.updateRule, deleteRule: c.deleteRule,
    });
    console.log('  ✓ Collection ' + c.name + ' (mit Regeln)');
  }

  // Test-Nutzer neu (löschen falls vorhanden)
  const seedUser = async (email, name, password) => {
    const existing = await api('GET', `/api/collections/users/records?filter=(email='${norm(email)}')`);
    for (const u of existing.items) await api('DELETE', '/api/collections/users/records/' + u.id);
    return api('POST', '/api/collections/users/records', {
      email: norm(email), password, passwordConfirm: password, name, verified: true, emailVisibility: true,
    });
  };
  const adminU = await seedUser('chef@bzp.local', 'Chef', 'chefpass1234');
  const leadU = await seedUser('rigging@bzp.local', 'Rigging-Leiter', 'leadpass1234');
  console.log('  ✓ Nutzer: chef@bzp.local (Owner/Admin), rigging@bzp.local (Lead)');

  // Beispielprojekt als Owner «chef» anlegen: dazu als chef einloggen
  const chefTok = (await api('POST', '/api/collections/users/auth-with-password', { identity: 'chef@bzp.local', password: 'chefpass1234' })).token;
  const asChef = (m, p, b) => { const t = token; token = chefTok; return api(m, p, b).finally(() => { token = t; }); };

  const proj = await asChef('POST', '/api/collections/projects/records', {
    name: 'Testfestival', venue: 'Testgelände', start: '2026-08-21T00:00', end: '2026-09-03T23:59',
    timezone: 'Europe/Berlin', owner: adminU.id, schema: 1,
  });
  const gRig = await asChef('POST', '/api/collections/gewerke/records', { project: proj.id, gid: 'g0', name: 'Rigging', sort: 0, slot: 0 });
  const gLic = await asChef('POST', '/api/collections/gewerke/records', { project: proj.id, gid: 'g1', name: 'Licht', sort: 1, slot: 1 });
  const tRig = await asChef('POST', '/api/collections/tasks/records', { project: proj.id, tid: 't0', gewerk: 'g0', title: 'Rigging Einbau', start: '2026-08-27T08:00', end: '2026-08-27T18:00', milestone: false, progress: 0, status: 'geplant', crew: null, notes: '', estimated: true });
  const tLic = await asChef('POST', '/api/collections/tasks/records', { project: proj.id, tid: 't1', gewerk: 'g1', title: 'Licht Einbau', start: '2026-08-27T08:00', end: '2026-08-28T18:00', milestone: false, progress: 0, status: 'geplant', crew: null, notes: '', estimated: true });

  // Mitgliedschaften + Lead-Scope
  await asChef('POST', '/api/collections/memberships/records', { project: proj.id, user: adminU.id, email: norm('chef@bzp.local'), role: 'admin' });
  await asChef('POST', '/api/collections/memberships/records', { project: proj.id, user: leadU.id, email: norm('rigging@bzp.local'), role: 'lead' });
  await asChef('POST', '/api/collections/lead_scopes/records', { project: proj.id, email: norm('rigging@bzp.local'), gewerk: 'g0' });
  console.log('  ✓ Projekt + Gewerke (Rigging/Licht) + Tasks + Mitgliedschaften + Lead-Scope (Rigging)');

  // Schema-Schnappschuss für Coolify-Import
  const snap = await api('GET', '/api/collections?perPage=200');
  const keep = snap.items.filter((c) => mine.has(c.name) || c.name === 'users');
  writeFileSync(join(here, 'pb_schema.json'), JSON.stringify(keep, null, 2));
  console.log('  ✓ pocketbase/pb_schema.json geschrieben (' + keep.length + ' Collections)');

  console.log('\n  Fertig. IDs:');
  console.log('    projekt = ' + proj.id);
  console.log('    tasks   = ' + tRig.id + ' (Rigging/g0), ' + tLic.id + ' (Licht/g1)');
  console.log('    gewerke = ' + gRig.id + ' (g0), ' + gLic.id + ' (g1)');
}

main().catch((e) => { console.error('\n  ✗ ' + e.message + '\n'); process.exit(1); });
