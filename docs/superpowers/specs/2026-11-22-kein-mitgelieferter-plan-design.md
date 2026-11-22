# Kein mitgelieferter Plan, Griffe auf Hybridgeräten, Scheibensuche

Datum: 2026-11-22 · Stand: freigegeben (Marco: «Im Repo lassen, nur als Testdaten»)

## Absicht

Marco: «Es wird kein Projekt mitgeliefert. Das Projekt bleibt lokal bei mir, aber wird
niemals irgendwo von allein aufgerufen, auch nicht bei mir.» Dazu die zwei im
Final-Review 0.20.0/0.21.0 zurückgestellten Kleinigkeiten.

## Ziele

1. Die App kennt keine mitgelieferten Pläne mehr: kein Abschnitt «Mitgelieferte Pläne»
   im Projektdialog, kein `?plan=klassentreffen` / `?plan=amk`, kein Nachladen aus
   einer Datei beim Öffnen einer Projektzeile oder am Live-Monitor, kein Abholen durch
   `print.html`. Beim Start erscheinen nur eigene Projekte, Neu und Import.
2. Der Klassentreffen-Plan bleibt lokal in Marcos Browser (localStorage) und wird nur
   geöffnet, wenn er ihn anklickt.
3. Die JSON-Dateien bleiben im Repo, aber nur als Testdaten unter `tools/fixtures/`.
4. Verknüpfen-Griffe sind auf Geräten mit grobem Zeiger (Touch) per Tastatur erreichbar.
5. Scheibensuche in `bedarfsRaster` (resources.js) sucht binär statt linear.

## Nicht-Ziele

- Keine Umschreibung der Git-Historie, kein Löschen der Dateien.
- `?plan=leer` bleibt als Schalter der Prüfwerkzeuge (aktives/erstes Projekt ohne Dialog).
- `project.quelle` in alten Plänen wird nicht entfernt (unschädliches Datenfeld).

## Anti-Ziele

- Die App darf nie wieder eine Plan-JSON von sich aus per `fetch` holen.
  Struktursperre: `tests/run.mjs` prüft, dass `js/*.js` weder `BUNDLED` noch
  `openBundled` noch `.json` im Fetch-Pfad enthält.

## Ansätze

A) **Mechanismus entfernen, Testdaten verschieben (gewählt).** `BUNDLED`, `openBundled`,
`bundledKey`, `neuer` aus app.js; `BUNDLED`-Zweig aus print.js; `planHash`/`unveraendert`
aus sync.js (nur dort benutzt); JSONs nach `tools/fixtures/`; HUELLE und run.mjs-Sollliste
ohne sie. Prüfskripte laden den Plan über eine gemeinsame Hilfe in den localStorage.
B) Mechanismus behalten, nur den Dialogabschnitt verstecken. Verworfen: `?plan=`
öffnete den Plan weiterhin von allein.
C) Dateien aus dem Repo entfernen plus neutraler Beispielplan. Verworfen durch Marco
(Umfang, Historie bleibt ohnehin).

## Entscheidungen

- **Prüfdaten laden:** `tools/plan-fixture.mjs` exportiert `planSeed(datei)` (liest
  `tools/fixtures/<datei>` und baut den localStorage-Inhalt) und `planLaden(ziel, datei)`
  (`addInitScript` auf Page oder Context: schreibt `bzp_p_<id>`, Index `bzp_projects`
  mit `{id, name, venue, modified, remoteSha: null, dirty: false}`, `bzp_active`). Danach
  öffnet `?plan=leer` den Plan; `repo.load` lässt `migrate` laufen wie bisher.
  Wo ein Skript den Import-Knopf prüft (verify-klassentreffen, verify-amk), bleibt
  `#import-file` mit dem neuen Pfad.
- **Negativprüfung** in `verify-klassentreffen.mjs`: frischer Browser mit
  `?plan=klassentreffen` → Projektdialog offen, keine Überschrift «Mitgelieferte Pläne»,
  kein Netzabruf einer `.json` (Route-Zähler) beim Start, mit Live-Marke und aktivem
  Projekt kein Abruf. Diese Prüfung muss rot werden, wenn `openBundled` zurückkäme.
- **Griffe:** `@media (pointer: coarse) { .bz-link:not(.is-sel):not(.is-on) { visibility:hidden } }`.
  `is-on` kommt auf Touch nur über Tastaturfokus (`:focus-visible`) oder Zeiger auf dem
  Griff selbst; ein Fingertipp setzt es nicht (gantt.js `bindLink`). Prüfung in
  `verify-edit.mjs` im Chromium-Touch-Kontext: nach Tipp auf Balken A ist der Griff von
  B `visibility: hidden`; nach Tab-Fokus auf B ist sein Griff sichtbar; nach Blur wieder
  versteckt.
- **Scheibensuche:** `scheibe`/`scheibeBis` als binäre Suche über `grenzen`
  (gleiche Semantik: `scheibe` letztes i mit `grenzen[i] <= m`, `scheibeBis` letztes i
  mit `grenzen[i] < m`, beide auf `[0, n-1]` geklemmt). Test: zufällige Grenzen gegen die
  lineare Referenz, plus die bestehenden Grenzfälle.

## Betroffene Doku

README (Abschnitt Weitergeben/Direktlink, `?plan=amk`, `make-klassentreffen` als
Testdaten), CLAUDE.md (Zeilen «Die JSON ist die Wahrheit», «Start = Projektdialog»,
verify-Liste), `.claude/rules/sync-offline.md` (Absatz «Mitgelieferter Plan»),
`.claude/rules/gantt-darstellung.md` (unverändert gültig), `docs/entscheidungen.md`
(Abschnitt «Der Start fragt, die JSON bleibt die Wahrheit» ersetzen), CHANGELOG
«## Unreleased».
