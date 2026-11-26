# Bauzeitenplan — Arbeitsanweisungen

Gantt-Ablaufplan für die Veranstaltungsbranche. Vanilla JS, ES-Module, **kein Build-Step**. Projekte leben im Browser (localStorage) + JSON-Export. Kein Backend, keine Anmeldung.

**Live:** https://m4dm0nky.github.io/Bauzeitenplan/ · **Repo:** M4dm0nky/Bauzeitenplan · **Version:** `node tools/version.mjs`

Starten: `python3 -m http.server 8080`. Nur Regeln hier; Begründungen: `docs/entscheidungen.md` → «Begründungen zu den Regeln in CLAUDE.md».

## Vor jeder Änderung

```bash
node tests/run.mjs  # Unit-Tests + statische Prüfungen
node tools/verify-browser.mjs  # Darstellung: App in allen 5 Themes
node tools/verify-edit.mjs  # Bearbeiten: anlegen, tippen, Undo, Panel, Menü
node tools/verify-live.mjs  # Live-Modus mit gestellter Uhr
node tools/verify-amk.mjs  # AMK-Plan importieren (tools/fixtures)
node tools/verify-klassentreffen.mjs  # V07-Plan importieren + Negativprüfung «kein mitgelieferter Plan»
node tools/verify-print.mjs  # Tagesblätter A3: Zuschnitt, Filter, Maßstab
node tools/verify-showablauf.mjs  # Showablauf: Ebene, Bühnen, Kopfzeile, Blatt
```

- **Alle neun müssen grün sein**, bevor etwas fertig ist (parallel startbar). `verify-browser.mjs` braucht einmalig `npx playwright install firefox`.
- **Screenshots ansehen, nicht nur die Häkchen zählen;** zu jedem behobenen Fehler eine Prüfung schreiben.
- **Neue Bausteine gehören in die `needed`-Liste in `tests/run.mjs`.**
- **Fertig erst mit nachgezogener Doku:** README, CHANGELOG, diese Datei, `.claude/rules/*.md`, `docs/*.md` per grep auf geänderte Funktionen/Dateien/Zahlen prüfen.
- `grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` muss leer bleiben (Kommentare ausgenommen).

## Deploy und Version

`git push origin main` → GitHub Pages (~1 Min., Quelle `main` / `root`). Danach **live gegenprüfen**: `node tools/verify-browser.mjs --base https://m4dm0nky.github.io/Bauzeitenplan/`

- **Vor dem Deploy: `node tools/version.mjs <neu>`** (setzt auch alle `?v=`).
- **Service Worker network-first**, Cache `bzp-<SW_VERSION>`, Kill-Switch in `sw.js`. Wer eine Datei anlegt/löscht, pflegt `HUELLE` in `sw.js` (`tests/run.mjs` prüft beide Richtungen).
- **Die Version wird NIE von Hand geändert** (keine Zahl in dieser Datei): `node tools/version.mjs 0.2.0` stempelt `js/version.js` · `package.json` · `index.html` **und `print.html`** (`?v=`) · `sw.js` (`SW_VERSION`) · `CHANGELOG.md`.
- **Die Nummer entscheidet Marco** — VOR dem Stempeln fragen. Rückschritte und Nicht-SemVer lehnt der Befehl ab.
- **Jede ausgelieferte HTML-Seite gehört in `tools/version.mjs` UND in die Versionsprüfung in `tests/run.mjs`.**
- **Annotierter Tag nach dem Push** (`git tag -a v0.2.0 -m "…" && git push origin v0.2.0`), **erst nach Rückfrage.**
- **Ein Versionswechsel lädt offene Tabs neu** (`controllerchange`): nicht grundlos deployen, solange der Plan auf dem Monitor läuft.
- `gh`: `C:\Program Files\GitHub CLI\gh.exe`, angemeldet als **M4dm0nky**; das Repo liegt NICHT unter `Aniflu`.


## Daten und Store (immer)

- **Der Store ist der einzige Weg, den Plan zu ändern;** nie direkt an `state`. Validierung VOR der Änderung; ein abgelehnter Befehl hinterlässt nichts (kein Undo-Eintrag, keine Ungesichert-Marke). Undo über Schnappschüsse.
- **Rechenlogik bleibt DOM-frei** (`schedule.js`, `timeaxis.js`, `store.js`, `conflicts.js`, `persistence.js`); neue Logik dort → Test.
- **Neue Felder müssen durch `addTask` durch** (sonst fallen sie beim Anlegen still weg).
- **`js/dom.js` = DOM-Kleinkram** (`el`, `svgEl`, `$`, `escapeHtml`, `toInput`, `STATUS`), nicht `clone`.
- **Ein Zustand, ein Besitzer:** Inspector = INHALT des Panels, `syncPanel()` (app.js) allein die Sichtbarkeit (`#ins.hidden`).
- **Die App holt nie eine Plan-JSON:** kein `BUNDLED`/`openBundled`, kein `fetch` einer `.json` in `js/` (`tests/run.mjs` sperrt es). Testdaten liegen in `tools/fixtures/`, Prüfskripte seeden sie per `tools/plan-fixture.mjs`.
- **Start = Projektdialog** (`bootLokal`), kein Autostart. Direkt nur der Live-Monitor (`bzp_live=1` + aktives Projekt). `?plan=leer` = ohne Plan: aktives/erstes Projekt, sonst Dialog (alle verify-Skripte hängen daran).
- **Was der erste Start braucht, gehört auf Modulebene, nicht in `mount()`** (Import, Neu, Projekte, `openEinrichten`; Einrichten ist eine Seite, kein Fenster).
- **Keine Platzhaltertexte in Freitextspalten.** **„Tag 1/2/3" gehört in die Notiz, nicht in den Titel** (Test). **Das Wort ist «Zeiteintrag»** in Spalte, Knopf, Zähler, Ecke der Seitenspalte, Vorgabename, Kennzahl (Datenfeld `punktTyp`; auf dem A3-Blatt bleibt «Programmpunkt»).
- **Zeiten aus echten Zeitstempeln** (`toMin()`), nie aus Ziffern auf Datumsstrings.
- **Balkenbeschriftung nicht entfernen** (sekundäre Kodierung). **Schraffur = Gewerk-Identität** (Platz 9–16), nicht Status.
- **Eine Reihenfolge für beide Ansichten: `byStart`** (Start, Ende, Titel). **Verknüpfungs-Picker sucht** (`candidateGroups`), ebenso die **Suche** (`suchTreffer`, beide schedule.js, DOM-frei); lange Listen nie als `<select>`.
- **Niemals `window.prompt`/`confirm`/`alert`.** Bestätigung: `askDialog({title, message, buttons})` (app.js; `null` bei Abbruch). Namenseingabe: `tb-neuart` (`neuFragen`, table.js; `cmd` setzt den Namen als `label`, `buildCmd(wert, kompakt)` wenn er anderswo im Befehl steht).

## Themenregeln (laden nur bei passenden Dateien)

Details je Thema in `.claude/rules/` (Frontmatter `paths:`); dort stehen die Regeln, die nur bei diesen Dateien gelten:

- Druck / Tagesblätter / Running-Order-Blatt: `.claude/rules/druck.md`
- Zeit, Jetzt-Linie, Versatz, Verzug: `.claude/rules/live.md`
- Showablauf, Ebenen, Abschnitte, Soundcheck: `.claude/rules/showablauf-ebenen.md`
- Gantt-Darstellung, Achse, Zeilen, Beschriftung: `.claude/rules/gantt-darstellung.md`
- Themes, Gewerk-Farben, Farbplätze: `.claude/rules/themes-farben.md`
- Tabelle, Schiene, Einrichten, Knopfzahl: `.claude/rules/tabelle-einrichten.md`
- Sync, Service Worker, Offline: `.claude/rules/sync-offline.md`
- Personal, Maschinen, Bereitstellung, Bedarf, `crew`: `.claude/rules/personal-maschinen.md`
- Auswahllisten, Eintragsarten, Abschnitte verwalten: `.claude/rules/auswahllisten.md`
- Untervorgänge, Warnungen/Abhaken, `migrate`, AMK-Plan: `.claude/rules/store-daten.md`

## Aus Crewplaner gelernt (für ein späteres Backend)

- `project_id` & Co. als **Text**, nie Relation. E-Mails `.toLowerCase()`. API-Rules nach Coolify-Redeploy prüfen. Kein Bundle-File: ES-Module mit `?v=`-Cache-Bust. Rollen serverseitig über API-Rules (UI-Verstecken ist keine Sicherheit).

## Aufbau

| | |
|---|---|
| `js/gantt.js` | Render-Engine: DOM, Zoom, Pfeile |
| `js/schedule.js` | CPM, Topo-Sort, Puffer + Engpass (`engpass`, `luftDerVerknuepfung`) — **DOM-frei** |
| `js/timeaxis.js` | Zeit ↔ Pixel, Zoomstufen, Ticks, KW, `planSpanne` — **DOM-frei** |
| `js/app.js` | Verdrahtung; bewusst dünn |
| `js/store.js` | Zustand + Befehle + Undo — **DOM-frei** |
| `js/conflicts.js` | Konflikte + Dauer-Kurzform — **DOM-frei** |
| `js/persistence.js` | localStorage, Export/Import — **DOM-frei** |
| `js/table.js` | Tabellen-Editor |
| `js/suche.js` | Suchfeld + Trefferliste (rendert nur; `suchTreffer` in schedule.js, Sprung in app.js) |
| `js/templates.js` | Vorlagen (`TEMPLATES`: fünf Einträge) |
| `js/palette.js` | 10 Töne × 2 Schraffuren = 20 Plätze (HUES=10, MAX_SLOTS=20) |
| `js/ebene.js` | Bänder, Showtage, Typ-Hinweis — **DOM-frei** |
| `js/resources.js` | Bezeichnungen, Deckung, Bedarfsraster — **DOM-frei** |
| `js/live.js` | Verzug, Laufendes, Versatz (`verschoben`, `versatzText`) — **DOM-frei** |
| `js/inspector.js` | Seitenpanel |
| `js/menu.js` | Kontextmenü, Tageswahl |
| `js/mitglieder.js` | Dialoge «Mitglieder…» (Plan) und «Verwaltung…» (Superadmin); rendert nur, Daten über `pb` |
| `js/mitglieder-logik.js` | Liste zusammenführen, Einladung/Rolle prüfen, Fehlertexte — **DOM-frei** |
| `js/bedarf.js` | Bedarfsansicht |
| `js/rail.js` | Die Schiene (Modus) |
| `js/einrichten.js` | Einrichten-Seite (`#ein-seite`, fünf Bereiche, geführtes Erstes Einrichten) |
| `js/einrichten-status.js` | Status ✓ ⚠ ○, Zeitraum-Hülle (`einrichtStatus`) — **DOM-frei** |
| `js/res-katalog.js` | Eingebaute Helfer/Maschinen in Kategorien — **DOM-frei** |
| `js/res-picker.js` | Such-Auswahl Helfer/Maschinen |
| `js/listen-editor.js` | Verwalten-Liste `mountAuswahlListe` (Tabelle + Einrichten-Seite) |
| `js/konflikt.js` | Konfliktauflösung beim Senden — **DOM-frei** |
| `js/pb.js`, `server.js` | PocketBase-Client · Serverplan (rev, Realtime) — **DOM-frei** |
| `login.html`, `login.js` | Anmelden, Passwort, Einladung |

Warum was so ist: `docs/entscheidungen.md` (auch «Kritisch entfiel»: Puffer + Engpass statt kritischer Pfad).

## Fahrplan

Offene Punkte: GitHub-Issues von M4dm0nky/Bauzeitenplan, keine Liste in dieser Datei.

**PocketBase liegt auf Eis:** Branch `pocketbase-vorbereitung`, nicht gemergt, nicht deployt. Nur die Vorlage «festival» ist abgenommen; Tour, Corporate, Messe sind Entwürfe und beim ersten echten Einsatz zu korrigieren.

## Gestartete Prozesse IMMER wieder beenden
Hintergrundbefehle, Server, Watcher, Builds (auch von Subagenten) beenden, sobald sie fertig sind; nach Abbruch/Timeout und am Sitzungsende auf verwaiste Prozesse prüfen. Details: `C:\Dropbox\Incomming\github\CLAUDE.md`.
