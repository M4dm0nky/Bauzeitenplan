// Leichter Smoke-Test der Client-Auth-Bausteine: prüft die reine E-Mail-
// Normalisierung und dass die öffentlichen Funktionen existieren (fängt ein
// versehentliches Umbenennen/Entfernen, das login.html/admin.js bräuchte).

import { normEmail } from '../js/pb.js';
import { login, logout, refresh, resolveSession, isLoggedIn } from '../js/auth.js';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); } };

console.log('\nClient-Auth');
test('normEmail trimmt und schreibt klein (PB-Filter sind case-sensitive)', () => {
  assert.equal(normEmail('  Chef@BZP.Local '), 'chef@bzp.local');
  assert.equal(normEmail(null), '');
});
test('die Auth-Funktionen sind vorhanden', () => {
  for (const f of [login, logout, refresh, resolveSession, isLoggedIn]) assert.equal(typeof f, 'function');
});

console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen\n`);
process.exit(fail ? 1 : 0);
