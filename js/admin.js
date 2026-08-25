// ── Admin-Konsole ─────────────────────────────────────────────────────────────
// Owner eines Projekts lädt Personal ein und weist Rolle + Gewerk(e) zu.
// Alles per E-Mail (die Person braucht noch kein Konto). Die Durchsetzung steht
// serverseitig in PocketBase — diese Seite ist nur die Bedienung.

import { isLoggedIn, refresh, logout } from './auth.js';
import { pbList, pbPost, pbPatch, pbDelete, normEmail } from './pb.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
const msg = (text, kind) => { const m = $('msg'); m.textContent = text || ''; m.className = 'msg ' + (kind || ''); };

let me = null;         // eingeloggter User
let pid = null;        // aktives Projekt
let gewerke = [];      // Gewerke des Projekts

async function start() {
  if (!isLoggedIn()) return void location.replace('login.html');
  me = await refresh();
  if (!me) return void location.replace('login.html');
  $('whoami').textContent = me.email;
  $('logout').onclick = () => { logout(); location.href = 'login.html'; };

  // Nur EIGENE Projekte (Owner verwaltet Mitglieder — so sagen es die Rules).
  const projects = (await pbList('projects')).filter((p) => p.owner === me.id);
  const sel = $('project');
  sel.innerHTML = '';
  if (!projects.length) {
    $('noproj').hidden = false;
    $('membersCard').hidden = true; $('inviteCard').hidden = true;
    return;
  }
  for (const p of projects) sel.append(new Option(p.name, p.id));
  sel.onchange = () => loadProject(sel.value);
  await loadProject(projects[0].id);
}

async function loadProject(id) {
  pid = id;
  gewerke = (await pbList('gewerke', `project='${pid}'`, 'sort'));
  await renderMembers();
  renderScopeChoices();
}

async function renderMembers() {
  const [members, scopes] = await Promise.all([
    pbList('memberships', `project='${pid}'`),
    pbList('lead_scopes', `project='${pid}'`),
  ]);
  const scopeNames = (email) => scopes.filter((s) => s.email === email)
    .map((s) => (gewerke.find((g) => g.gid === s.gewerk) || {}).name || s.gewerk);

  const tb = $('members'); tb.innerHTML = '';
  if (!members.length) { const tr = el('tr'); const td = el('td', 'hint', 'Noch niemand eingeladen.'); td.colSpan = 4; tr.append(td); tb.append(tr); return; }

  for (const m of members) {
    const tr = el('tr');
    tr.append(el('td', null, m.email));

    const roleTd = el('td');
    const rs = el('select'); rs.append(new Option('Gewerkeleiter', 'lead'), new Option('Admin', 'admin')); rs.value = m.role;
    rs.onchange = async () => {
      await pbPatch('/api/collections/memberships/records/' + m.id, { role: rs.value });
      if (rs.value === 'admin') { for (const s of scopes.filter((s) => s.email === m.email)) await pbDelete('/api/collections/lead_scopes/records/' + s.id); }
      renderMembers();
    };
    roleTd.append(rs); tr.append(roleTd);

    tr.append(el('td', null, m.role === 'lead' ? (scopeNames(m.email).join(', ') || '—') : '(alle)'));

    const actTd = el('td');
    const del = el('button', 'btn btn-danger', 'Entfernen');
    del.onclick = async () => {
      if (!confirm(m.email + ' entfernen?')) return;
      await pbDelete('/api/collections/memberships/records/' + m.id);
      for (const s of scopes.filter((s) => s.email === m.email)) await pbDelete('/api/collections/lead_scopes/records/' + s.id);
      renderMembers();
    };
    actTd.append(del); tr.append(actTd);
    tb.append(tr);
  }
}

function renderScopeChoices() {
  const box = $('scopes'); box.innerHTML = '';
  for (const g of gewerke) {
    const lab = el('label');
    const cb = el('input'); cb.type = 'checkbox'; cb.value = g.gid;
    lab.append(cb, document.createTextNode(' ' + g.name));
    box.append(lab);
  }
  const roleSel = $('iRole');
  const sync = () => { $('scopeWrap').hidden = roleSel.value !== 'lead'; };
  roleSel.onchange = sync; sync();
}

$('invite').onclick = async () => {
  const email = normEmail($('iEmail').value);
  const role = $('iRole').value;
  if (!email) return msg('Bitte eine E-Mail eingeben.', 'bad');
  const chosen = [...document.querySelectorAll('#scopes input:checked')].map((c) => c.value);
  if (role === 'lead' && !chosen.length) return msg('Für einen Leiter mindestens ein Gewerk wählen.', 'bad');
  try {
    const existing = (await pbList('memberships', `project='${pid}' && email='${email}'`))[0];
    if (existing) await pbPatch('/api/collections/memberships/records/' + existing.id, { role });
    else await pbPost('/api/collections/memberships/records', { project: pid, email, role });

    // Scopes neu setzen
    for (const s of await pbList('lead_scopes', `project='${pid}' && email='${email}'`)) await pbDelete('/api/collections/lead_scopes/records/' + s.id);
    if (role === 'lead') for (const gid of chosen) await pbPost('/api/collections/lead_scopes/records', { project: pid, email, gewerk: gid });

    $('iEmail').value = '';
    document.querySelectorAll('#scopes input:checked').forEach((c) => { c.checked = false; });
    msg(email + ' eingeladen als ' + (role === 'lead' ? 'Gewerkeleiter' : 'Admin') + '.', 'ok');
    renderMembers();
  } catch (e) {
    msg('Fehler: ' + e.message, 'bad');
  }
};

start().catch((e) => msg('Fehler beim Laden: ' + e.message, 'bad'));
