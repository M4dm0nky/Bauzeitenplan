// Lokale PocketBase 0.40.6 für Prüfungen: Binary laden (einmalig), headless auf freiem Port
// mit leerem Datenordner starten, Superuser mit Zufallspasswort anlegen, am Ende aufräumen.
// Zugangsdaten leben nur im Speicher/tmp, nie im Repo.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PB_VERSION = '0.40.6';
const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = join(WURZEL, 'tools', '.pb');
const WIN = process.platform === 'win32';

function plattform() {
  const os = { darwin: 'darwin', linux: 'linux', win32: 'windows' }[process.platform];
  const arch = { arm64: 'arm64', x64: 'amd64' }[process.arch];
  if (!os || !arch) throw new Error(`Plattform nicht unterstützt: ${process.platform}/${process.arch}`);
  return `${os}_${arch}`;
}

export async function ensureBinary() {
  const exe = join(BIN_DIR, WIN ? 'pocketbase.exe' : 'pocketbase');
  const stempel = join(BIN_DIR, 'VERSION');
  if (existsSync(exe) && existsSync(stempel) && (await import('node:fs')).readFileSync(stempel, 'utf8').trim() === PB_VERSION) return exe;
  mkdirSync(BIN_DIR, { recursive: true });
  const zip = join(BIN_DIR, 'pb.zip');
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_${plattform()}.zip`;
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Download ${url} → HTTP ${r.status}`);
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  if (WIN) execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${zip}' -DestinationPath '${BIN_DIR}'`]);
  else { execFileSync('unzip', ['-o', '-q', zip, '-d', BIN_DIR]); chmodSync(exe, 0o755); }
  rmSync(zip, { force: true });
  writeFileSync(stempel, PB_VERSION);
  return exe;
}

function freierPort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

async function http(url, { method = 'GET', body, token, timeout = 15000 } = {}) {
  const h = {};
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = token;
  const r = await fetch(url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const t = await r.text();
  let json = null; try { json = t ? JSON.parse(t) : null; } catch { json = t; }
  return { status: r.status, ok: r.ok, body: json };
}

export async function startePb({ port, origins = '' } = {}) {
  const exe = await ensureBinary();
  port = port || await freierPort();
  const dir = mkdtempSync(join(tmpdir(), 'bzp-pb-'));
  const admin = { email: 'admin@bzp.test', passwort: randomBytes(12).toString('hex') };
  const gemeinsam = ['--dir', dir, '--hooksDir', join(WURZEL, 'pocketbase', 'pb_hooks'), '--migrationsDir', join(WURZEL, 'pocketbase', 'pb_migrations')];
  // Migrationen laufen schon beim ersten Start/Superuser-Befehl; Fehler sofort sichtbar machen
  try {
    execFileSync(exe, ['superuser', 'upsert', admin.email, admin.passwort, ...gemeinsam], { stdio: 'pipe', timeout: 30000 });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('superuser upsert fehlgeschlagen: ' + String(e.stderr || e.stdout || e.message).slice(-800));
  }
  const args = ['serve', '--http', `127.0.0.1:${port}`, ...gemeinsam];
  if (origins) args.push('--origins', origins);
  const proc = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; log = log.slice(-6000); });
  proc.stderr.on('data', (d) => { log += d; log = log.slice(-6000); });
  const url = `http://127.0.0.1:${port}`;
  let beendet = false;
  // Auch bei Absturz/Abbruch des Skripts (z. B. geschlossene Pipe) keinen Server zurücklassen
  const aufraeumen = () => { try { proc.kill('SIGKILL'); } catch { /* weg */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* weg */ } };
  process.once('exit', aufraeumen);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { aufraeumen(); process.exit(130); });
  const stop = async () => {
    if (!beendet) {
      beendet = true;
      if (proc.exitCode === null) {
        const ende = new Promise((r) => proc.once('exit', r));
        proc.kill('SIGTERM');
        const t = setTimeout(() => proc.kill('SIGKILL'), 5000);
        await ende; clearTimeout(t);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
  try {
    const bis = Date.now() + 20000;
    let ok = false;
    while (Date.now() < bis) {
      if (proc.exitCode !== null) throw new Error('PocketBase beendet: ' + log.slice(-800));
      try { if ((await http(url + '/api/health', { timeout: 1000 })).status === 200) { ok = true; break; } } catch { /* noch nicht da */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!ok) throw new Error('PocketBase /api/health nach 20 s nicht erreichbar: ' + log.slice(-800));
    const auth = await http(url + '/api/collections/_superusers/auth-with-password', { method: 'POST', body: { identity: admin.email, password: admin.passwort } });
    if (!auth.ok) throw new Error('Superuser-Anmeldung fehlgeschlagen: ' + JSON.stringify(auth.body));
    const suToken = auth.body.token;
    const su = (method, path, body) => http(url + path, { method, body, token: suToken });
    return { url, stop, admin, su, log: () => log };
  } catch (e) { await stop(); throw e; }
}

export async function anmelden(url, email, passwort) {
  const r = await http(url + '/api/collections/users/auth-with-password', { method: 'POST', body: { identity: email.toLowerCase(), password: passwort } });
  if (!r.ok) throw new Error('Anmeldung ' + email + ': ' + JSON.stringify(r.body));
  return { token: r.body.token, record: r.body.record };
}

export async function kontoAnlegen(pb, { email, name, passwort, superadmin = false, produktionsleitung = false }) {
  // Konten entstehen nur als Superuser (createRule = null), später über die Hook-Route
  const r = await pb.su('POST', '/api/collections/users/records', {
    email: email.toLowerCase(), emailVisibility: true, name, password: passwort, passwordConfirm: passwort,
    superadmin, produktionsleitung, verified: true,
  });
  if (!r.ok) throw new Error('Konto ' + email + ': ' + JSON.stringify(r.body));
  const a = await anmelden(pb.url, email, passwort);
  return { id: r.body.id, token: a.token };
}

// Selbsttest bei direktem Aufruf
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pb = await startePb();
  try {
    const r = await fetch(pb.url + '/api/health');
    if (r.status !== 200) throw new Error('health ' + r.status);
    console.log('PB OK');
  } finally { await pb.stop(); }
}
