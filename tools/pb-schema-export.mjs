// Schema der App-Collections aus einer frischen lokalen PocketBase (nach ALLEN Migrationen) nach
// pocketbase/schema.json exportieren, oder mit --pruefen gegen die eingecheckte Datei vergleichen.
//   node tools/pb-schema-export.mjs [--pruefen]
// Die Migrationen sind maßgeblich; schema.json ist die lesbare Momentaufnahme (und Import-Datei für
// PocketBase → Settings → Import collections, falls eine Instanz ohne Migrationen aufgesetzt wird).
// Auth-Collections `_superusers` & Co. (Systemname mit «_») sind nicht enthalten.
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { startePb } from './pb-lokal.mjs';

const ZIEL = join(dirname(fileURLToPath(import.meta.url)), '..', 'pocketbase', 'schema.json');
const pruefen = process.argv.includes('--pruefen');

const pb = await startePb();
try {
  const r = await pb.su('GET', '/api/collections?perPage=200&sort=name');
  if (!r.ok) throw new Error('Collections lesen fehlgeschlagen: ' + JSON.stringify(r.body));
  const reihenfolge = ['users', 'plaene', 'mitglieder', 'einladungen', 'ressourcen', 'gewerke', 'vorgaenge', 'phasen', 'verknuepfungen'];
  const cols = r.body.items.filter((c) => !c.name.startsWith('_'))
    .sort((a, b) => reihenfolge.indexOf(a.name) - reihenfolge.indexOf(b.name))
    .map(({ created, updated, ...rest }) => rest); // Zeitstempel ändern sich je Lauf
  const text = JSON.stringify(cols, null, 2) + '\n';
  if (pruefen) {
    const alt = readFileSync(ZIEL, 'utf8');
    if (alt !== text) { console.log('✗ pocketbase/schema.json ist veraltet: node tools/pb-schema-export.mjs'); process.exitCode = 1; }
    else console.log('✓ pocketbase/schema.json entspricht den Migrationen (' + cols.length + ' Collections)');
  } else {
    writeFileSync(ZIEL, text);
    console.log('pocketbase/schema.json geschrieben: ' + cols.map((c) => c.name).join(', '));
  }
} finally { await pb.stop(); }
