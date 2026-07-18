// ── Version ───────────────────────────────────────────────────────────────────
// NICHT von Hand ändern. `node tools/version.mjs 0.2.0` stempelt die Nummer in
// alle Stellen zugleich: hierher, package.json, index.html (?v=), sw.js und
// CHANGELOG.md.
//
// Warum der Aufwand: Crewplaner pflegt drei unabhängige Zähler (?v=23, ?v=12,
// ?v=38) und verlangt in CLAUDE.md, sie in fünf Dateien von Hand hochzuzählen —
// geprüft wird nichts. Vergisst man eine, sieht der Nutzer alten Code und
// niemand merkt es. Hier schlägt `node tests/run.mjs` sofort an.

export const VERSION = '0.2.0';
