import { createSync, kodiere, dekodiere, abgleich, gleicherPlan, SYNC_REPO } from '../js/sync.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// Fake-GitHub mit den echten Antwortformen der Contents-API. Kein Mock des
// Prüflings, sondern des Servers. Dateien: Pfad → { text, sha }.
// Cache-Verhalten: Ohne cache:'no-store' liefert der Fake die ALTE sha
// (GitHub-GETs sind 60 s cachebar) — genau der Scheinkonflikt, den es zu fangen gilt.
const fakeGithub = () => {
  const dateien = new Map();
  const alt = new Map(); // Pfad → vorherige sha (für gecachte Antworten)
  const aufrufe = [];
  let zaehler = 0;
  const neueSha = () => 'sha' + (++zaehler).toString(16).padStart(8, '0');
  const antwort = (status, json) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
  });
  const b64 = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
  const fetch = async (url, init = {}) => {
    aufrufe.push({ url, init });
    const u = new URL(url);
    const m = u.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    const pfad = m ? decodeURIComponent(m[1]) : '';
    const methode = init.method || 'GET';
    const gesehen = (e, p = pfad) => (init.cache === 'no-store' ? e.sha : (alt.get(p) ?? e.sha));
    if (methode === 'GET') {
      if (pfad === 'projekte') {
        const liste = [...dateien].filter(([p]) => p.startsWith('projekte/'))
          .map(([p, e]) => ({ name: p.slice(9), path: p, sha: gesehen(e, p), type: 'file' }));
        if (!liste.length) return antwort(404, { message: 'Not Found' });
        return antwort(200, liste);
      }
      const e = dateien.get(pfad);
      if (!e) return antwort(404, { message: 'Not Found' });
      return antwort(200, { name: pfad.split('/').pop(), path: pfad, content: b64(e.text), sha: gesehen(e), encoding: 'base64', type: 'file' });
    }
    const body = JSON.parse(init.body);
    const e = dateien.get(pfad);
    if (methode === 'PUT') {
      if (e && body.sha !== e.sha) return antwort(409, { message: 'does not match' });
      if (!e && body.sha) return antwort(422, { message: 'sha wasn\'t supplied' });
      if (e) alt.set(pfad, e.sha);
      const sha = neueSha();
      dateien.set(pfad, { text: Buffer.from(body.content, 'base64').toString('utf8'), sha });
      return antwort(e ? 200 : 201, { content: { name: pfad.split('/').pop(), path: pfad, sha }, commit: { sha: 'c' + sha } });
    }
    if (methode === 'DELETE') {
      if (!e) return antwort(404, { message: 'Not Found' });
      if (body.sha !== e.sha) return antwort(409, { message: 'does not match' });
      dateien.delete(pfad);
      return antwort(200, { content: null, commit: { sha: 'cdel' } });
    }
    return antwort(405, {});
  };
  return { fetch, dateien, aufrufe };
};

const mk = (fetch) => createSync({ fetch, token: 'ghp_test', repo: SYNC_REPO });

test('kodiere/dekodiere: Rundreise "Bühne 👤 Ölfass"', () => {
  const t = 'Bühne 👤 Ölfass';
  assert.equal(dekodiere(kodiere(t)), t);
  assert.equal(dekodiere(kodiere(t).replace(/(.{4})/g, '$1\n')), t);
});

test('kodiere: großer Text sprengt den Stack nicht', () => {
  const t = 'äöü👤'.repeat(200000);
  assert.equal(dekodiere(kodiere(t)), t);
});

test('list: leeres Repo (404) → dateien []', async () => {
  const g = fakeGithub();
  assert.deepEqual(await mk(g.fetch).list(), { ok: true, dateien: [] });
});

test('push neu ohne sha → ok, sha gesetzt; danach list enthält {id:"p1", sha}', async () => {
  const g = fakeGithub();
  const s = mk(g.fetch);
  const r = await s.push('p1', '{"a":1}', null);
  assert.equal(r.ok, true);
  assert.ok(r.sha);
  const l = await s.list();
  assert.deepEqual(l, { ok: true, dateien: [{ id: 'p1', sha: r.sha }] });
});

test('list nach zweitem Push liefert die NEUE sha (no-store)', async () => {
  const g = fakeGithub();
  const s = mk(g.fetch);
  const r1 = await s.push('p1', 'eins', null);
  const r2 = await s.push('p1', 'zwei', r1.sha);
  assert.equal(r2.ok, true);
  assert.equal((await s.list()).dateien[0].sha, r2.sha);
});

test('push mit veralteter sha → konflikt, Inhalt unverändert', async () => {
  const g = fakeGithub();
  const s = mk(g.fetch);
  const r1 = await s.push('p1', 'eins', null);
  await s.push('p1', 'zwei', r1.sha);
  const r = await s.push('p1', 'drei', r1.sha);
  assert.equal(r.ok, false);
  assert.equal(r.grund, 'konflikt');
  assert.equal((await s.pull('p1')).text, 'zwei');
});

test('pull → text identisch zum gepushten', async () => {
  const g = fakeGithub();
  const s = mk(g.fetch);
  const text = JSON.stringify({ n: 'Bühne 👤 Ölfass', x: 'y'.repeat(500) });
  const r = await s.push('p1', text, null);
  const p = await s.pull('p1');
  assert.equal(p.ok, true);
  assert.equal(p.text, text);
  assert.equal(p.sha, r.sha);
});

test('remove mit sha → danach list leer', async () => {
  const g = fakeGithub();
  const s = mk(g.fetch);
  const r = await s.push('p1', 'x', null);
  assert.deepEqual(await s.remove('p1', r.sha), { ok: true });
  assert.deepEqual(await s.list(), { ok: true, dateien: [] });
});

test('remove mit falscher sha → konflikt', async () => {
  const g = fakeGithub();
  const s = mk(g.fetch);
  await s.push('p1', 'x', null);
  const r = await s.remove('p1', 'falsch');
  assert.equal(r.ok, false);
  assert.equal(r.grund, 'konflikt');
});

test('fetch wirft TypeError → grund offline', async () => {
  const s = mk(async () => { throw new TypeError('Failed to fetch'); });
  for (const r of [await s.list(), await s.pull('p1'), await s.push('p1', 'x', null), await s.remove('p1', 's')]) {
    assert.equal(r.ok, false);
    assert.equal(r.grund, 'offline');
  }
});

test('401 → grund schluessel (auch 403); sonstiges → fehler mit status', async () => {
  const mit = (status) => mk(async () => ({ ok: false, status, json: async () => ({}) }));
  assert.deepEqual(await mit(401).list(), { ok: false, grund: 'schluessel', status: 401 });
  assert.equal((await mit(403).pull('p1')).grund, 'schluessel');
  assert.deepEqual(await mit(500).list(), { ok: false, grund: 'fehler', status: 500 });
});

test('jeder Aufruf sendet Bearer-Header und cache:"no-store"', async () => {
  const g = fakeGithub();
  const s = mk(g.fetch);
  const r = await s.push('p1', 'x', null);
  await s.list(); await s.pull('p1'); await s.remove('p1', r.sha);
  assert.equal(g.aufrufe.length, 4);
  for (const { init } of g.aufrufe) {
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Authorization, 'Bearer ghp_test');
    assert.equal(init.headers.Accept, 'application/vnd.github+json');
    assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
  }
});

const eins = (lokal, remote) => abgleich(lokal, remote);
test('abgleich: lokal fehlt, remote da -> herunterladen', () => {
  assert.deepStrictEqual(eins([], [{ id: 'a', sha: 's1' }]), [{ art: 'herunterladen', id: 'a', sha: 's1' }]);
});
test('abgleich: remoteSha null, remote fehlt -> hochladen (sha null)', () => {
  assert.deepStrictEqual(eins([{ id: 'a', remoteSha: null, dirty: true }], []), [{ art: 'hochladen', id: 'a', sha: null }]);
});
test('abgleich: remoteSha gesetzt, nicht dirty, remote fehlt -> lokal-loeschen', () => {
  assert.deepStrictEqual(eins([{ id: 'a', remoteSha: 's1', dirty: false }], []), [{ art: 'lokal-loeschen', id: 'a' }]);
});
test('abgleich: remoteSha gesetzt, dirty, remote fehlt -> hochladen (sha null)', () => {
  assert.deepStrictEqual(eins([{ id: 'a', remoteSha: 's1', dirty: true }], []), [{ art: 'hochladen', id: 'a', sha: null }]);
});
test('abgleich: sha gleich, nicht dirty -> keine Aktion', () => {
  assert.deepStrictEqual(eins([{ id: 'a', remoteSha: 's1', dirty: false }], [{ id: 'a', sha: 's1' }]), []);
});
test('abgleich: sha gleich, dirty -> hochladen (sha)', () => {
  assert.deepStrictEqual(eins([{ id: 'a', remoteSha: 's1', dirty: true }], [{ id: 'a', sha: 's1' }]), [{ art: 'hochladen', id: 'a', sha: 's1' }]);
});
test('abgleich: sha verschieden, nicht dirty -> herunterladen', () => {
  assert.deepStrictEqual(eins([{ id: 'a', remoteSha: 's1', dirty: false }], [{ id: 'a', sha: 's2' }]), [{ art: 'herunterladen', id: 'a', sha: 's2' }]);
});
test('abgleich: sha verschieden, dirty -> konflikt', () => {
  assert.deepStrictEqual(eins([{ id: 'a', remoteSha: 's1', dirty: true }], [{ id: 'a', sha: 's2' }]), [{ art: 'konflikt', id: 'a', sha: 's2' }]);
});
test('abgleich: remoteSha null, remote da -> konflikt (dirty und nicht)', () => {
  for (const dirty of [true, false])
    assert.deepStrictEqual(eins([{ id: 'a', remoteSha: null, dirty }], [{ id: 'a', sha: 's2' }]), [{ art: 'konflikt', id: 'a', sha: 's2' }]);
});
test('abgleich: Reihenfolge lokal zuerst, dann nur-remote, je in Eingabereihenfolge', () => {
  assert.deepStrictEqual(
    eins([{ id: 'b', remoteSha: null, dirty: true }, { id: 'a', remoteSha: null, dirty: true }],
         [{ id: 'z', sha: 'sz' }, { id: 'y', sha: 'sy' }]),
    [{ art: 'hochladen', id: 'b', sha: null }, { art: 'hochladen', id: 'a', sha: null },
     { art: 'herunterladen', id: 'z', sha: 'sz' }, { art: 'herunterladen', id: 'y', sha: 'sy' }]);
});

test('gleicherPlan: gleich trotz anderer Schlüsselreihenfolge und anderem quelle-Stempel → true', () => {
  const a = { project: { id: 'p1', name: 'X', quelle: { exported: '2026-01-01' } }, gewerke: [{ id: 'g', name: 'G' }], tasks: [{ id: 't', title: 'T', start: 's' }], deps: [] };
  const b = { deps: [], tasks: [{ start: 's', title: 'T', id: 't' }], gewerke: [{ name: 'G', id: 'g' }], project: { name: 'X', quelle: { exported: '2027-02-02' }, id: 'p1' }, exported: 'jetzt' };
  assert.equal(gleicherPlan(a, b), true);
});
test('gleicherPlan: ein Vorgangstitel anders → false', () => {
  const a = { project: { id: 'p1' }, gewerke: [], tasks: [{ id: 't', title: 'T' }], deps: [] };
  const b = { project: { id: 'p1' }, gewerke: [], tasks: [{ id: 't', title: 'U' }], deps: [] };
  assert.equal(gleicherPlan(a, b), false);
});

test('gleicherPlan: nur die Phasen verschieden → false; gleiche Phasen → true', () => {
  const ph = (ende) => [{ id: 'ph1', name: 'Aufbau', art: 'aufbau', start: '2026-07-01T06:00', end: ende }];
  const mk = (phases) => ({ project: { id: 'p1' }, gewerke: [], tasks: [], deps: [], phases });
  assert.equal(gleicherPlan(mk(ph('2026-07-02T06:00')), mk(ph('2026-07-03T06:00'))), false);
  assert.equal(gleicherPlan(mk(ph('2026-07-02T06:00')), mk(ph('2026-07-02T06:00'))), true);
  assert.equal(gleicherPlan(mk(ph('2026-07-02T06:00')), mk([])), false);
});

test('pruefe: 200 → ok; 404 → repo; 401/403 → schluessel; Netzfehler → offline', async () => {
  const mit = (status) => mk(async () => ({ ok: status < 300, status, json: async () => ({}) }));
  assert.deepEqual(await mit(200).pruefe(), { ok: true });
  assert.equal((await mit(404).pruefe()).grund, 'repo');
  assert.equal((await mit(401).pruefe()).grund, 'schluessel');
  assert.equal((await mit(403).pruefe()).grund, 'schluessel');
  assert.equal((await mk(async () => { throw new TypeError('x'); }).pruefe()).grund, 'offline');
});

test('pull: 2xx mit leerem Body → fehler; content null → fehler; kaputtes Base64 → fehler', async () => {
  const s1 = mk(async () => ({ ok: true, status: 200, json: async () => { throw new Error('leer'); } }));
  assert.equal((await s1.pull('p1')).grund, 'fehler');
  const s2 = mk(async () => ({ ok: true, status: 200, json: async () => ({ content: null, sha: 'x' }) }));
  assert.equal((await s2.pull('p1')).grund, 'fehler');
  const s3 = mk(async () => ({ ok: true, status: 200, json: async () => ({ content: '%%%', sha: 'x' }) }));
  assert.equal((await s3.pull('p1')).grund, 'fehler');
});
test('push: 2xx ohne content.sha → fehler; id wird URL-kodiert', async () => {
  const s = mk(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  assert.equal((await s.push('p1', 'x', null)).grund, 'fehler');
  const urls = [];
  const s2 = mk(async (u) => { urls.push(u); return { ok: true, status: 200, json: async () => ({ content: { sha: 'a' }, name: 'a', content2: 1 }) }; });
  await s2.pull('a/b c');
  assert.ok(urls[0].includes('a%2Fb%20c.json'), urls[0]);
});

for (const [name, fn] of tests) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
