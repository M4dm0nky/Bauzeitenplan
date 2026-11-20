// Festival-Plan MIT Terminen für die Browserprüfungen.
// Die Vorlage legt seit v0.19 Vorgänge OHNE Termin an; verify-browser/-edit/-live
// brauchen aber Balken. Deshalb liegt der frühere Vorlagenstand als JSON unter
// tools/fixtures/ und wird über den Import-Knopf geladen — dieselbe Tür, die
// auch ein Nutzer nimmt.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATEI = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'festival-mit-daten.json');
const ANKER = '2026-09-14T06:00';   // Aufbaubeginn, mit dem die Fixture erzeugt wurde
let nr = 0;

const msVon = (s) => { const [d, t] = s.split('T'); const [y, m, tg] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return Date.UTC(y, m - 1, tg, h, mi); };
const z2 = (n) => String(n).padStart(2, '0');
const lokal = (d) => `${d.getFullYear()}-${z2(d.getMonth() + 1)}-${z2(d.getDate())}T${z2(d.getHours())}:${z2(d.getMinutes())}`;

// Wie das frühere Dialogfeld: Aufbaubeginn in 14 Tagen, 06:00 — so liegt der
// Plan «vor uns» und die Heute-/Jetzt-Prüfungen finden ihre Linie.
function vorgabe() {
  const d = new Date(); d.setDate(d.getDate() + 14); d.setHours(6, 0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T06:00`;
}

/**
 * Importiert den Festival-Plan über #import-file (der Projektdialog darf offen sein).
 * @param {import('playwright-core').Page} page
 * @param {string} name   Projektname (eindeutig wählen, sonst fragt der Import «ersetzen?»)
 * @param {{venue?:string, loadIn?:string, phasen?:object[]}} o  loadIn verschiebt alle Termine (wie früher das Dialogfeld)
 */
export async function festivalMitDaten(page, name, { venue = '', loadIn = vorgabe(), phasen = null } = {}) {
  const j = JSON.parse(readFileSync(DATEI, 'utf8'));
  // Abstand zum Anker in ECHTEN Minuten (die Fixture liegt im September, ohne
  // Zeitumstellung), aufgesetzt auf den lokalen Aufbaubeginn — genau so rechnete
  // die Vorlage; über die Zeitumstellung hinweg ergibt das z. B. 07:00 statt 06:00.
  const a = new Date(loadIn).getTime();
  const v = (s) => (s == null ? s : lokal(new Date(a + (msVon(s) - msVon(ANKER)))));
  j.project.name = name;
  j.project.venue = venue;
  j.project.id = 'fx' + Date.now().toString(36) + (nr++).toString(36);
  j.project.start = v(j.project.start);
  j.project.end = v(j.project.end);
  for (const t of j.tasks) { t.start = v(t.start); t.end = v(t.end); }
  for (const p of j.phases || []) { p.start = v(p.start); p.end = v(p.end); }
  if (phasen) j.phases = phasen;   // absolute Phasen (nicht verschoben), z. B. zwei einzelne Showabende
  j.exported = new Date().toISOString();
  await page.locator('#import-file').setInputFiles({ name: 'festival.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(j)) });
}
