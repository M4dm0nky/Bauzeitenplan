// ── PocketBase-Ablage (hinter dem Schalter) ──────────────────────────────────
// Bietet dasselbe Interface wie createRepo (persistence.js): list/load/getActive/
// setActive/remove/save. Damit merken Store, gantt.js & Co. NICHTS von PocketBase.
//
// Brücke sync↔async: beim Start wird alles Lesbare in einen In-Memory-Cache
// geladen (async). Danach bedienen list/load/getActive synchron aus dem Cache;
// save() schreibt im Hintergrund per DIFF durch — nur geänderte Records. Der
// Diff respektiert die API-Rules von selbst: der Save eines Leads berührt nur
// seine Task-Records, alles andere weist der Server ab (→ Fehler-Toast).
//
// Bewusst NICHT in diesem Durchgang: Echtzeit-Sync mehrerer Bearbeiter.

import { pbList, pbPost, pbPatch, pbDelete, getUser } from './pb.js';

const K_ACTIVE = 'bzp_pb_active';
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── Records ↔ Plan-Form ──────────────────────────────────────────────────────
const gewerkP = (g, pid) => ({ project: pid, gid: g.id, name: g.name, sort: g.sort ?? 0, slot: g.slot ?? 0 });
const taskP = (t, pid) => ({
  project: pid, tid: t.id, gewerk: t.gewerk, title: t.title, start: t.start, end: t.end,
  milestone: !!t.milestone, progress: t.progress ?? 0, status: t.status || 'geplant',
  crew: t.crew ?? null, notes: t.notes || '', estimated: !!t.estimated,
});
const depP = (d, pid) => ({ project: pid, did: d.id, from: d.from, to: d.to, type: d.type || 'FS', lag: d.lag ?? 0 });

const gewerkFrom = (r) => ({ id: r.gid, name: r.name, sort: r.sort ?? 0, slot: r.slot ?? 0 });
const taskFrom = (r) => ({
  id: r.tid, gewerk: r.gewerk, title: r.title, start: r.start, end: r.end,
  milestone: !!r.milestone, progress: r.progress ?? 0, status: r.status || 'geplant',
  crew: r.crew === '' || r.crew == null ? null : r.crew, notes: r.notes || '', estimated: !!r.estimated,
});
const depFrom = (r) => ({ id: r.did, from: r.from, to: r.to, type: r.type || 'FS', lag: r.lag ?? 0 });

export async function createRepoPB() {
  const cache = new Map();   // pid → Plan (Plan-Form)
  const meta = new Map();    // pid → { rec:{gewerke,tasks,deps: {appId→recId}}, snap:Plan }
  const index = [];

  async function assemble(p) {
    const [gws, tks, dps] = await Promise.all([
      pbList('gewerke', `project='${p.id}'`, 'sort'),
      pbList('tasks', `project='${p.id}'`),
      pbList('deps', `project='${p.id}'`),
    ]);
    const plan = {
      project: { id: p.id, name: p.name, venue: p.venue || '', start: p.start, end: p.end, timezone: p.timezone || 'Europe/Berlin' },
      gewerke: gws.map(gewerkFrom),
      tasks: tks.map(taskFrom),
      deps: dps.map(depFrom),
    };
    const rec = {
      gewerke: Object.fromEntries(gws.map((r) => [r.gid, r.id])),
      tasks: Object.fromEntries(tks.map((r) => [r.tid, r.id])),
      deps: Object.fromEntries(dps.map((r) => [r.did, r.id])),
      project: p.id,
    };
    cache.set(p.id, plan);
    meta.set(p.id, { rec, snap: clone(plan) });
  }

  const projects = await pbList('projects', '', 'name');
  for (const p of projects) {
    await assemble(p);
    index.push({ id: p.id, name: p.name, venue: p.venue || '', modified: p.updated });
  }
  let activeId = localStorage.getItem(K_ACTIVE) || (index[0] && index[0].id) || null;

  // ── Diff-Durchschreiben einer Collection ──────────────────────────────────
  async function syncColl(coll, pid, cur, prev, recMap, payloadOf) {
    const prevById = new Map(prev.map((x) => [x.id, x]));
    const curIds = new Set(cur.map((x) => x.id));
    for (const c of cur) {
      const p = prevById.get(c.id);
      if (!p) {
        const r = await pbPost(`/api/collections/${coll}/records`, payloadOf(c, pid));
        recMap[c.id] = r.id;
      } else if (JSON.stringify(payloadOf(c, pid)) !== JSON.stringify(payloadOf(p, pid))) {
        await pbPatch(`/api/collections/${coll}/records/${recMap[c.id]}`, payloadOf(c, pid));
      }
    }
    for (const p of prev) {
      if (!curIds.has(p.id) && recMap[p.id]) { await pbDelete(`/api/collections/${coll}/records/${recMap[p.id]}`); delete recMap[p.id]; }
    }
  }

  async function createProject(plan) {
    const me = getUser();
    const pr = plan.project;
    const rec = await pbPost('/api/collections/projects/records', {
      name: pr.name, venue: pr.venue || '', start: pr.start, end: pr.end, timezone: pr.timezone || 'Europe/Berlin',
      owner: me.id, schema: 1,
    });
    const pid = rec.id;
    const m = { rec: { gewerke: {}, tasks: {}, deps: {}, project: pid }, snap: { project: { ...pr, id: pid }, gewerke: [], tasks: [], deps: [] } };
    meta.set(pid, m);
    return pid;
  }

  async function sync(plan) {
    let pid = plan.project.id;
    let m = meta.get(pid);
    if (!m) { pid = await createProject(plan); m = meta.get(pid); }

    const pr = plan.project, sp = m.snap.project;
    if (pr.name !== sp.name || pr.venue !== sp.venue || pr.start !== sp.start || pr.end !== sp.end || pr.timezone !== sp.timezone) {
      await pbPatch(`/api/collections/projects/records/${pid}`, { name: pr.name, venue: pr.venue || '', start: pr.start, end: pr.end, timezone: pr.timezone });
    }
    await syncColl('gewerke', pid, plan.gewerke, m.snap.gewerke, m.rec.gewerke, gewerkP);
    await syncColl('tasks', pid, plan.tasks, m.snap.tasks, m.rec.tasks, taskP);
    await syncColl('deps', pid, plan.deps, m.snap.deps, m.rec.deps, depP);

    const stored = { ...clone(plan), project: { ...clone(plan.project), id: pid } };
    m.snap = stored; cache.set(pid, stored);
    if (!index.some((x) => x.id === pid)) index.push({ id: pid, name: pr.name, venue: pr.venue || '', modified: new Date().toISOString() });
    return pid;
  }

  return {
    list() { return index.slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified))); },
    load(id) { return cache.has(id) ? clone(cache.get(id)) : null; },
    getActive() { return activeId; },
    setActive(id) { activeId = id; localStorage.setItem(K_ACTIVE, id); },
    async remove(id) {
      try {
        const m = meta.get(id);
        if (m) {
          for (const rid of Object.values(m.rec.tasks)) await pbDelete('/api/collections/tasks/records/' + rid).catch(() => {});
          for (const rid of Object.values(m.rec.deps)) await pbDelete('/api/collections/deps/records/' + rid).catch(() => {});
          for (const rid of Object.values(m.rec.gewerke)) await pbDelete('/api/collections/gewerke/records/' + rid).catch(() => {});
          await pbDelete('/api/collections/projects/records/' + id).catch(() => {});
        }
      } finally {
        cache.delete(id); meta.delete(id);
        const i = index.findIndex((x) => x.id === id); if (i >= 0) index.splice(i, 1);
        if (activeId === id) { activeId = index[0] ? index[0].id : null; localStorage.setItem(K_ACTIVE, activeId || ''); }
      }
    },
    // Optimistisch: der Aufrufer bekommt sofort ok; der Durchschrieb läuft und
    // meldet Fehler (z. B. 403 bei fremdem Gewerk) über das zurückgegebene Promise.
    async save(plan) {
      try { await sync(clone(plan)); return { ok: true }; }
      catch (e) { return { ok: false, error: 'Serverfehler beim Speichern: ' + (e.message || e) }; }
    },
  };
}
