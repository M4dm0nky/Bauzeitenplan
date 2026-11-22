// Plan aus tools/fixtures/ als Testdaten in den localStorage legen.
// Die App liefert keinen Plan mehr mit; die Prüfskripte seeden deshalb den Browser
// vor dem ersten goto (addInitScript) und öffnen die App mit ?plan=leer bzw. print.html.
// Warum localStorage statt Import-Knopf: ein Seed je Seite statt eines Imports je
// Theme/Seite. Die Import-Tür selbst prüfen weiter verify-klassentreffen und verify-amk.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, 'fixtures');

// Der Init-Script läuft bei JEDER Navigation: nur seeden, solange der Plan fehlt,
// sonst überschriebe er Änderungen, die ein Test zwischen zwei goto() gespeichert hat.
/** Liest die Fixture; `scripts` ist JS-Text, der Plan, Index und aktives Projekt setzt. */
export function planSeed(datei) {
  const text = readFileSync(join(FIXTURES, datei), 'utf8');
  const plan = JSON.parse(text);
  const id = plan.project.id;
  const eintrag = { id, name: plan.project.name, venue: plan.project.venue || '', modified: new Date().toISOString(), remoteSha: null, dirty: false };
  const scripts = `try {
  if (localStorage.getItem('bzp_p_' + ${JSON.stringify(id)}) === null) {
  localStorage.setItem('bzp_p_' + ${JSON.stringify(id)}, ${JSON.stringify(text)});
  localStorage.setItem('bzp_projects', ${JSON.stringify(JSON.stringify([eintrag]))});
  localStorage.setItem('bzp_active', ${JSON.stringify(id)});
  }
} catch (e) {}`;
  return { plan, id, scripts };
}

/** Seedet eine Page oder einen BrowserContext (vor dem ersten goto); gibt die Projekt-id zurück. */
export async function planLaden(ziel, datei = 'klassentreffen-festival.json') {
  const { id, scripts } = planSeed(datei);
  await ziel.addInitScript(scripts);
  return id;
}
