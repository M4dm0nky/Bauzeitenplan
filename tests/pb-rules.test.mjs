// ── PocketBase: Sicherheits-Beweis der API-Rules ─────────────────────────────
// Läuft nur gegen eine lokale PB mit geseedeten Testdaten (pocketbase/setup.mjs).
// Ohne erreichbare PB überspringt er sich — der Haupt-Testlauf bleibt grün.
//
// Der Kern: ein Rigging-Lead darf NUR Rigging-Tasks ändern. Alles andere muss
// der Server (nicht die Oberfläche) mit 403 abweisen.

import assert from 'node:assert/strict';

const URL = process.env.PB_URL || 'http://127.0.0.1:8090';

let pass = 0, fail = 0;
const test = (name, fn) => fn().then(() => { pass++; console.log('  ✓ ' + name); })
  .catch((e) => { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); });

async function reachable() {
  try { const r = await fetch(URL + '/api/health'); return r.ok; } catch { return false; }
}
async function authToken(identity, password) {
  const r = await fetch(URL + '/api/collections/users/auth-with-password', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
  if (!r.ok) return null;
  return (await r.json()).token;
}
// Statuscode einer Schreiboperation mit gegebenem Token.
async function status(method, path, token, body) {
  const r = await fetch(URL + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status;
}
async function listAs(token, coll, filter) {
  const q = filter ? '?filter=' + encodeURIComponent(filter) : '';
  const r = await fetch(URL + '/api/collections/' + coll + '/records' + q, { headers: { Authorization: 'Bearer ' + token } });
  return r.ok ? (await r.json()).items : [];
}

console.log('\nPocketBase — API-Rules (Sicherheitskern)');

if (!(await reachable())) {
  console.log('  – übersprungen: keine PB unter ' + URL + ' (pocketbase serve + node pocketbase/setup.mjs)');
  process.exit(0);
}

const chef = await authToken('chef@bzp.local', 'chefpass1234');
const lead = await authToken('rigging@bzp.local', 'leadpass1234');
if (!chef || !lead) {
  console.log('  – übersprungen: Testnutzer fehlen. Erst «node pocketbase/setup.mjs» laufen lassen.');
  process.exit(0);
}

// IDs über den Owner (chef) ermitteln — Seed vergibt bei jedem Lauf neue.
const tasks = await listAs(chef, 'tasks');
const rigTask = tasks.find((t) => t.gewerk === 'g0');
const licTask = tasks.find((t) => t.gewerk === 'g1');
const projId = rigTask?.project;
assert.ok(rigTask && licTask, 'Seed-Tasks nicht gefunden');

console.log('\n  Als Lead (Scope: Rigging/g0)');
await test('darf die Zeit einer Rigging-Task ändern → 200', async () => {
  const s = await status('PATCH', '/api/collections/tasks/records/' + rigTask.id, lead, { end: '2026-08-27T19:00' });
  assert.equal(s, 200, 'Status ' + s);
});
await test('darf eine Licht-Task NICHT ändern → 403/404', async () => {
  const s = await status('PATCH', '/api/collections/tasks/records/' + licTask.id, lead, { end: '2026-08-28T19:00' });
  assert.ok(s === 403 || s === 404, 'Status ' + s + ' — Lead kam an fremdes Gewerk!');
});
await test('darf kein neues Gewerk anlegen → 403/400', async () => {
  const s = await status('POST', '/api/collections/gewerke/records', lead, { project: projId, gid: 'g9', name: 'Schmuggel', sort: 9, slot: 9 });
  assert.ok(s === 403 || s === 400, 'Status ' + s + ' — Lead durfte Struktur anlegen!');
});
await test('darf eine Rigging-Task NICHT in ein fremdes Gewerk schieben → abgewiesen', async () => {
  const s = await status('PATCH', '/api/collections/tasks/records/' + rigTask.id, lead, { gewerk: 'g1' });
  // Immer zurücksetzen (auch wenn durchgerutscht), damit der Seed konsistent bleibt.
  await status('PATCH', '/api/collections/tasks/records/' + rigTask.id, chef, { gewerk: 'g0' });
  assert.ok(s >= 400, 'Status ' + s + ' — Lead verschob die Task aus seinem Gewerk (Hook fehlt?)');
});

console.log('\n  Als Admin/Owner (chef)');
await test('darf jede Task ändern → 200', async () => {
  assert.equal(await status('PATCH', '/api/collections/tasks/records/' + rigTask.id, chef, { end: '2026-08-27T18:30' }), 200);
  assert.equal(await status('PATCH', '/api/collections/tasks/records/' + licTask.id, chef, { end: '2026-08-28T18:30' }), 200);
});
await test('darf ein Gewerk anlegen und wieder löschen → 200', async () => {
  const r = await fetch(URL + '/api/collections/gewerke/records', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chef },
    body: JSON.stringify({ project: projId, gid: 'g8', name: 'Temp', sort: 8, slot: 8 }),
  });
  assert.equal(r.status, 200, 'anlegen Status ' + r.status);
  const id = (await r.json()).id;
  assert.equal(await status('DELETE', '/api/collections/gewerke/records/' + id, chef), 204);
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
