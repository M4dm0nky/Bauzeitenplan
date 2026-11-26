// Erstes Superadmin-Konto der App anlegen (einmalig je Instanz, macht Marco selbst mit SEINEM Superuser).
//   node pocketbase/setup.mjs            legt das Konto an bzw. stellt die Flags richtig
//   node pocketbase/setup.mjs --trocken  zeigt nur, was passieren würde, schreibt nichts
//
// Legt NUR ein Konto in `users` an (superadmin + produktionsleitung) und ist idempotent: gibt es die
// E-Mail schon, werden nur fehlende Flags nachgezogen; Passwort und Name bleiben unangetastet.
//
// Zugangsdaten aus `pocketbase/pb-admin.local.json` (gitignored, `pocketbase/*.local.json`) ODER aus
// Umgebungsvariablen — nie im Repo, nie auf der Kommandozeile:
//   { "url": "https://api-test.callboard.nyxlightwork.de",
//     "superuser": { "email": "…", "passwort": "…" },          // PocketBase-Superuser (/_/-Zugang)
//     "konto": { "email": "…", "name": "…", "passwort": "…" } } // das neue App-Konto (mind. 10 Zeichen)
// Umgebung: PB_URL, PB_SU_EMAIL, PB_SU_PASSWORT, BZP_KONTO_EMAIL, BZP_KONTO_NAME, BZP_KONTO_PASSWORT.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const FLAGS = { superadmin: true, produktionsleitung: true };

async function http(url, { method = 'GET', body, token } = {}) {
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = token;
  const r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const t = await r.text();
  let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, ok: r.ok, body: json };
}

export function zugangLesen(env = process.env, datei = join(dirname(fileURLToPath(import.meta.url)), 'pb-admin.local.json')) {
  const f = existsSync(datei) ? JSON.parse(readFileSync(datei, 'utf8')) : {};
  const z = {
    url: env.PB_URL || f.url,
    superuser: { email: env.PB_SU_EMAIL || f.superuser?.email, passwort: env.PB_SU_PASSWORT || f.superuser?.passwort },
    konto: { email: env.BZP_KONTO_EMAIL || f.konto?.email, name: env.BZP_KONTO_NAME || f.konto?.name, passwort: env.BZP_KONTO_PASSWORT || f.konto?.passwort },
  };
  const fehlt = [];
  if (!/^https?:\/\//.test(z.url || '')) fehlt.push('url');
  if (!z.superuser.email) fehlt.push('superuser.email');
  if (!z.superuser.passwort) fehlt.push('superuser.passwort');
  if (!z.konto.email) fehlt.push('konto.email');
  if (!z.konto.name) fehlt.push('konto.name');
  if (!z.konto.passwort || z.konto.passwort.length < 10) fehlt.push('konto.passwort (mind. 10 Zeichen)');
  if (fehlt.length) throw new Error('Zugangsdaten unvollständig: ' + fehlt.join(', ') + ' (pocketbase/pb-admin.local.json oder Umgebungsvariablen)');
  z.url = z.url.replace(/\/+$/, '');
  z.konto.email = z.konto.email.toLowerCase();
  return z;
}

// Gibt zurück: { aktion: 'angelegt' | 'flags' | 'vorhanden', id }
export async function richteEin(z, { trocken = false } = {}) {
  z = { ...z, konto: { ...z.konto, email: z.konto.email.toLowerCase() } }; // E-Mails immer lowercase (Projektregel)
  const a = await http(z.url + '/api/collections/_superusers/auth-with-password', { method: 'POST', body: { identity: z.superuser.email, password: z.superuser.passwort } });
  if (!a.ok) throw new Error('Superuser-Anmeldung fehlgeschlagen (Status ' + a.status + ')');
  const token = a.body.token;
  const filter = encodeURIComponent(`email = "${z.konto.email.replace(/["\\]/g, '')}"`);
  const l = await http(`${z.url}/api/collections/users/records?filter=${filter}&perPage=1`, { token });
  if (!l.ok) throw new Error('Konten lesen fehlgeschlagen (Status ' + l.status + '): ist die Migration eingespielt?');
  const vorhanden = l.body.items[0];
  if (vorhanden) {
    const fehlt = Object.keys(FLAGS).filter((k) => vorhanden[k] !== true);
    if (!fehlt.length) return { aktion: 'vorhanden', id: vorhanden.id };
    if (!trocken) {
      const p = await http(`${z.url}/api/collections/users/records/${vorhanden.id}`, { method: 'PATCH', token, body: FLAGS });
      if (!p.ok) throw new Error('Flags setzen fehlgeschlagen (Status ' + p.status + ')');
    }
    return { aktion: 'flags', id: vorhanden.id, flags: fehlt };
  }
  if (trocken) return { aktion: 'angelegt', id: null };
  const c = await http(z.url + '/api/collections/users/records', {
    method: 'POST', token,
    body: { email: z.konto.email, emailVisibility: true, name: z.konto.name, password: z.konto.passwort, passwordConfirm: z.konto.passwort, verified: true, ...FLAGS },
  });
  if (!c.ok) throw new Error('Konto anlegen fehlgeschlagen (Status ' + c.status + '): ' + JSON.stringify(c.body?.data || c.body?.message || ''));
  return { aktion: 'angelegt', id: c.body.id };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const trocken = process.argv.includes('--trocken');
    const z = zugangLesen();
    const r = await richteEin(z, { trocken });
    const was = { angelegt: 'wird angelegt', flags: 'Flags werden nachgezogen (' + (r.flags || []).join(', ') + ')', vorhanden: 'ist schon Superadmin, nichts zu tun' };
    console.log(`${z.konto.email} auf ${z.url}: ${trocken ? was[r.aktion] : { angelegt: 'angelegt', flags: 'Flags nachgezogen', vorhanden: 'war schon in Ordnung' }[r.aktion]}${trocken ? ' (trocken, nichts geschrieben)' : ''}`);
  } catch (e) { console.error('✗ ' + e.message); process.exit(1); }
}
