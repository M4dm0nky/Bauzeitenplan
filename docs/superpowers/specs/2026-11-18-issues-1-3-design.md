# Issues #1–#3 — Design

Stand 2026-11-18, von Marco entschieden («löse alle 3 issues», «b», «In der App mitprüfen»).

## Ziel

Die drei aus v0.14.0 aufgeschobenen Punkte schließen: keine verlorene Eingabe bei
vollem Speicher (#1), App startet bei ganz gesperrtem Speicher (#2), alle neun
Prüfungen grün — und die vier Nicht-Callboard-Themes werden weiter im Browser
gesehen (#3).

**Nicht-Ziel:** Themes in der App umschaltbar machen; UI-Paket; Gestaltung der
Themes ändern, außer wo die neue Prüfung echte Darstellungsfehler zeigt.

## Ansätze und Entscheidungen

| # | Entscheidung | Verworfen |
|---|---|---|
| 1 | Scheitert beim Projektwechsel das Sichern der ausstehenden Eingabe, fragt `askDialog` («Nicht gespeichert»): **Exportieren** (JSON herunterladen, dann wechseln) · **Trotzdem wechseln** · **Abbrechen** (bleibt im Projekt, Eingabe bleibt im Store). Die Fehlerbehandlung von `save()` und dem Sichern in `open()` liegt danach an EINER Stelle. | Still wechseln mit Toast (Stand v0.14.0, Datenverlust); immer abbrechen (sperrt den Nutzer ein, wenn der Speicher dauerhaft voll ist). |
| 2 | Jeder `localStorage`-Zugriff in `persistence.js` ist abgesichert: Lesen liefert die Vorgabe (leer), Schreiben/Löschen liefert `{ok:false, error}` statt zu werfen. Die App startet im gesperrten Privatmodus mit dem Erststart-Dialog und arbeitet sitzungsweise. | Eine Speicher-Attrappe im Arbeitsspeicher als Ersatz — verschleiert, dass nichts gesichert wird. |
| 3 | **Prototypen abschaffen** (Marco: «b»): `tools/build-prototypes.mjs`, `tools/prototype-shell.html`, npm-Skript, `tools/out/`-Eintrag, alle Doku-Verweise. Stattdessen startet `verify-browser.mjs` die ECHTE App zusätzlich mit console, blueprint, studio, board (Stylesheet `#theme-css` im Test tauschen, nur Prüfwerkzeug, keine App-Änderung) und fährt dieselben App-Prüfungen. Die Zeilenmaße aus `VARIANTS` wandern als Referenztabelle nach `docs/themes.md`. Zeigt die neue Prüfung echte Fehler eines Themes, werden sie im Theme-CSS behoben (Gewerk-Farben tabu). | Prototyp-Hülle nachziehen (Pflege bei jedem Umbau); nur statisch prüfen (Fehler in vier Themes sähe niemand); vier Themes löschen. |

## Rahmen

- Branch `fix/issues-1-3` ab `main` (v0.14.0), eigener Worktree.
- Regeln aus CLAUDE.md: Kern DOM-frei, nie `window.prompt/confirm/alert` (nur `askDialog`), Store einziger Weg, Screenshots ansehen.
- Abnahme: alle neun Prüfungen grün, Screenshots der vier Themes angesehen.
- Halt vor: Versionsnummer (Marco), Push `main`, Tag.

## Dem Umsetzer überlassen

Ob `open()` dafür asynchron wird und wie die Aufrufer den Abbruch beachten
(jeder Aufrufer muss nach «Abbrechen» stehen bleiben); Name des gemeinsamen
Sicher-Helfers; wie der Test einen vollen Speicher nur für den Plan-Schlüssel erzeugt.
