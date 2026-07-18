# Themes

Fünf fertige Gestaltungsebenen liegen unter `styles/themes/`. **Aktiv ist `callboard`**
(das NYX-Navy-CI). Die anderen vier sind vollständig gepflegt und werden bei jedem
Testlauf mitgeprüft — sie sind keine Leichen, sondern einsatzbereite Alternativen.

| Theme | Charakter | Schrift |
|---|---|---|
| **callboard** ← aktiv | NYX-Navy-CI: Navy/Paper, ruhig, Gold **nur** im Logo. Hell = Paper, Dunkel = Navy | Geist + JetBrains Mono (selbst gehostet, `assets/fonts/`) |
| console | Crewplaner-DNA ins Helle gedreht: Mono, Gold `#d4a53a`, dichte Daten | SF Mono / Menlo, Avenir Next Condensed |
| blueprint | Millimeterpapier, technische Zeichnung, Balken als Tuschelinien | SF Mono / Menlo, Gill Sans |
| studio | Heller Salbeigrund, viel Luft, weiche Balken | Charter (Serife), Avenir Next |
| board | Kräftige Flächen auf Weiß, aus 5 m lesbar, A0-tauglich | Futura / Gill Sans |

Das aktive `callboard` bringt eigene Schriften mit: **Geist** (Wortmarke, Titel,
Zahlen) und **JetBrains Mono** (Labels, Eyebrows, Meta) liegen als `woff2` unter
`assets/fonts/` und werden per `@font-face` im Theme geladen — offline, ohne externe
Requests. Gold `#f7c948` lebt ausschließlich im Logo (Minutenzeiger).

## Wie die Trennung funktioniert

- `styles/base.css` — **nur Geometrie und Verhalten.** Sticky-Spalten, Balkenlage,
  Pfeilebene. Enthält zusätzlich die Gewerk-Farben `--gw-*`, weil Farbe hier
  Identität des Gewerks ist und über alle Themes gleich bleiben muss.
- `styles/themes/<name>.css` — **alles Gestalterische.** Jedes Theme ist in sich
  geschlossen und bringt seine eigenen Tokens mit (blueprint nutzt `--paper`/`--cyan`,
  console `--panel`/`--accent`). Deshalb genügt zum Wechseln ein Austausch der Datei.

Ein Testlauf (`node tests/run.mjs`) stellt sicher, dass
1. kein Theme die Gewerk-Farben überschreibt,
2. jedes Theme alle Bausteine der Engine gestaltet (sonst fehlt einer unsichtbar),
3. jedes Theme beide Dunkel-Scopes bedient.

## Hell/Dunkel umschalten (im Kopf, `bzp_mode`)

Der Knopf `#theme-toggle` im Kopf schaltet **Hell ↔ Dunkel** — nicht die Theme-
Familie. Er setzt `data-theme="light"|"dark"` am `<html>` und merkt sich die Wahl in
`localStorage['bzp_mode']`. Ein Inline-Script im `<head>` liest den Wert **vor** dem
CSS, damit nichts aufblitzt. Ohne gespeicherte Wahl folgt die App der OS-Einstellung
(`@media (prefers-color-scheme)`). Die Verdrahtung steht in `js/app.js` (`currentMode`,
`paintModeToggle`).

**Wichtig:** `bzp_mode` (Hell/Dunkel) ist ein **anderer** Schlüssel als `bzp_theme`
(Theme-Familie, siehe unten). Nicht vermischen — sonst schlägt das eine das andere.

## Theme-Familie umschalten (wenn er kommt)

Der Aufhänger steht schon in `index.html`:

```html
<link rel="stylesheet" href="styles/themes/console.css?v=1" id="theme-css" data-theme-name="console">
```

Eine Minimalfassung braucht nur:

```js
const THEMES = ['console', 'blueprint', 'studio', 'board'];
export function setTheme(name) {
  if (!THEMES.includes(name)) return;
  document.getElementById('theme-css').href = `styles/themes/${name}.css?v=1`;
  document.getElementById('theme-css').dataset.themeName = name;
  localStorage.setItem('bzp_theme', name);
}
setTheme(localStorage.getItem('bzp_theme') || 'console');
```

Zwei Dinge dabei beachten:

- **Zeilenmaße gehören zum Theme.** Board braucht Plakat-Maße, Console dichte
  Zeilen. Die Werte stehen aktuell in `js/app.js` (`rowH`/`groupH`/`barH`/`sideW`)
  bzw. in `tools/build-prototypes.mjs`. Beim Umschalten müssen sie mitwandern —
  am saubersten, indem `createGantt` sie neu gesetzt bekommt und `relayout()` läuft.
  Die Werte je Theme stehen in `tools/build-prototypes.mjs` unter `VARIANTS`.
- **Kurzes Aufblitzen vermeiden.** Der `<link>`-Tausch lädt asynchron. Entweder
  alle vier Themes vorab laden und per `data-theme-name` am `<html>` umschalten,
  oder das Aufblitzen in Kauf nehmen (bei lokalem CSS kaum sichtbar).

## Beim Anlegen eines neuen Themes

1. `styles/themes/<name>.css` anlegen — am besten von `console.css` abgeleitet.
2. Beide Dunkel-Scopes bedienen: `@media (prefers-color-scheme: dark)` **und**
   `:root[data-theme="dark"]`. Der Umschalter des Betrachters muss die
   OS-Einstellung in beide Richtungen schlagen.
3. Die Gewerk-Farben **nicht** anfassen.
4. In `tools/build-prototypes.mjs` unter `VARIANTS` eintragen.
5. `node tests/run.mjs` — die statischen Prüfungen fangen fehlende Bausteine.
6. `node tools/verify-browser.mjs` — fährt das Theme im Browser hoch.

## Farbpalette der Gewerke

Die acht Farben sind **gerechnet, nicht ausgesucht** (`docs/entscheidungen.md`).
Reihenfolge und Zuordnung stammen aus einem Suchlauf über 720 Varianten, der die
Unterscheidbarkeit benachbarter Zeilen bei Farbenblindheit maximiert. Sie sind in
Hell und Dunkel validiert. **Nicht per Hand ändern** — sonst ist die Prüfung wertlos.

Drei Farben (Rigging, Licht, Ton) liegen auf hellem Grund unter 3:1 Kontrast. Das
ist bekannt und zulässig, solange die Reliefregel greift: Identität hängt nie an
der Farbe allein. Deshalb hat **jeder Balken eine sichtbare Beschriftung** und die
Legende trägt Namen, nicht nur Punkte. Wer das entfernt, bricht die Barrierefreiheit.
