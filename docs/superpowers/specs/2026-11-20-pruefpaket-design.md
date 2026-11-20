# Prüfpaket v0.19.1 — Design

Stand 2026-11-20. Grundlage: Komplettprüfung mit Claude Fable (19 Funde, alle
von Claude Sonnet gegen den Code bestätigt). Entscheidungen zu Autostart,
Planstand und «Plan verschieben» hat Marco getroffen (siehe unten).

## Ziel

Kein Plan geht mehr still verloren (Sync, zwei Tabs, Löschen, Planstand), der
Live-Monitor zeigt nach einem Neustart das richtige Projekt, Import und Druck
sind gegen Randfälle (Ring, kaputte Datei, Zeitumstellung) abgesichert, und
der ganze Plan lässt sich verschieben. Jede Korrektur bekommt eine Prüfung,
die vorher rot war.

**Nicht-Ziel:** Umbau der Sync-Architektur (Tombstones, Server), Zeitzonen der
Betrachter, Mehrfachauswahl im Gantt, neue Ansichten.

**Anti-Ziel:** Ein Dialog, der den Live-Monitor nach einem Stromausfall
blockiert; eine Korrektur, die den dokumentierten Weg «Store ist der einzige
Weg» umgeht.

## Ansätze

- **Sync-Löschung (Fund 1):** (a) 404/leere Liste als Repo-Fehler werten und
  gar nicht abgleichen — verfehlt den echten Fall «auf dem anderen Gerät
  gelöscht»; (b) Tombstone-Datei im Repo — zweite Datei je Projekt, zu viel
  Fläche; (c) **gewählt:** lokal löschen nur nach Rückfrage, und eine Liste,
  die kein Array ist oder 404 liefert, gilt nur dann als «leer», wenn
  `pruefe()` das Repo sieht; sonst Grund `repo`.
- **Zwei Tabs (Fund 2):** (a) Schreibsperre je Tab — ein verwaister Tab sperrt
  für immer; (b) **gewählt:** `storage`-Ereignis beobachten und den fremden
  Stand wie ein Sync-Update behandeln (`ueberschreibenSicher`), bei
  beidseitigen Änderungen derselbe Dialog wie beim Sync-Konflikt.
- **Autostart (Fund 4):** (a) aktives Projekt still öffnen; (b) **gewählt
  (Marco):** beim Start den Projektdialog zeigen (zuletzt geöffnete zuerst,
  mitgelieferte Pläne, Neu, Import). Ausnahmen (mein Vorschlag, damit der
  Monitor weiterläuft): `?plan=` öffnet direkt; war beim letzten Lauf Live
  eingeschaltet (`bzp_live`), öffnet das aktive Projekt direkt ohne Dialog.
- **Planstand (Fund 5):** **gewählt (Marco):** nachfragen. Weicht die lokale
  Fassung inhaltlich ab (`gleicherPlan` falsch), Dialog «Neuen Stand nehmen ·
  Meine behalten · Beide behalten (Kopie)». Gleicher Inhalt: still übernehmen
  (nur der Stempel ändert sich).
- **Plan verschieben (Fund 18):** (a) nur Tage; (b) **gewählt:** Tage plus
  Stunden/Minuten, Tage über den Kalender (Uhrzeit bleibt, Sommerzeit stimmt),
  Rest in echten Minuten. EIN Store-Befehl, ein ⌘Z.

## Entscheidungen

| # | Fund | Entscheidung |
|---|---|---|
| 1 | Sync löscht lokal bei 404 / Nicht-Array. | `list()`: 404 oder Antwort ohne Array → `pruefe()`; Repo unsichtbar → `{ok:false, grund:'repo'}`, sonst `dateien: []`. `lokal-loeschen` fragt per `askDialog` («‹Name› ist im Daten-Repo nicht mehr vorhanden. Lokal löschen · Behalten und neu hochladen», Behalten primär). Behalten = `remoteSha` auf `null` (neuer Repo-Helfer), danach lädt der nächste Durchlauf hoch. Dialog läuft nacheinander je Projekt, der Abgleich wartet. |
| 2 | Zwei Tabs überschreiben sich. | `window` `storage`-Listener auf `bzp_p_<offenes Projekt>`: fremder Stand ≠ Store → ohne eigene offene Änderung `open(plan)` + Toast «In einem anderen Tab geändert»; mit eigener offener Änderung derselbe Dreiknopf-Dialog wie beim Sync-Konflikt (Meine · Die aus dem anderen Tab · Beide). `bzp_projects` ohne das offene Projekt → wie `lokal-loeschen` ohne Rückfrage (es war der Nutzer selbst), Projektdialog. |
| 3 | Gelöschtes offenes Projekt kehrt zurück. | Löschen des offenen Projekts: gibt es ein anderes, zuerst `open(anderes)`, dann `entferne(alt)`. Gibt es keins: `entferne`, id in `verworfen` merken; `sichern()`/`beforeunload` schreiben eine verworfene id nie; Projektdialog `firstRun`. Derselbe Weg für `lokal-loeschen` im Sync. |
| 4 | Autostart ignoriert das aktive Projekt. | `bootLokal`: `?plan=` → direkt. Sonst: war Live an (`bzp_live === '1'`) und gibt es ein aktives Projekt → direkt öffnen. Sonst Projektdialog (bestehender `showProjectDialog`, Liste nach `modified`), ohne «Abbrechen», solange nichts offen ist. Beim allerersten Start ohne Projekte zeigt derselbe Dialog die mitgelieferten Pläne. CLAUDE.md und entscheidungen.md nachziehen («Die JSON ist die Wahrheit» gilt weiter für den Inhalt des Klassentreffens, nicht mehr für den Start). |
| 5 | Neuer Planstand überschreibt lokale Änderungen. | `openBundled`: Datei neuer UND `gleicherPlan(lokal, datei)` falsch → Dialog «Neuen Stand nehmen · Meine behalten · Beide behalten (Kopie)». Kopie heißt «… (lokal vor Update)» mit neuer id. «Meine behalten» übernimmt nur den Stempel, damit nicht bei jedem Start gefragt wird. |
| 6 | Ring in importierter JSON lähmt die App. | `inhaltFehler` lehnt Ringe ab, Meldung nennt die Vorgänge (`topoSort` → `cycle`). Zusätzlich `gantt.js` `buildDeps`: `SCHED.get(…)?.critical`, Pfeile ohne Rechnung bleiben unkritisch. |
| 7 | Unlesbare JSON wirft. | `deserialize`: vor `migrate` Form prüfen (`project` Objekt, `tasks`/`gewerke`/`deps`/`phases` fehlend oder Array, jeder Eintrag ein Objekt) → `{ok:false, error}` mit Klartext; `migrate` zusätzlich in try/catch. `doImport` fängt alles und zeigt den Toast. Sync: kaputte Datei → `{ok:false, grund:'fehler'}` für dieses Projekt, die anderen laufen weiter. |
| 8 | Unbekanntes Gewerk / toter parent im Import. | `inhaltFehler` lehnt ab: `gewerk` muss in `gewerke` stehen oder `'projekt'` sein; `parent` muss existieren und selbst kein `parent` haben; Meldung nennt den Vorgang. |
| 9 | Druck am Tag der Zeitumstellung. | `tagesScheiben`: Tagesende = Mitternacht des Folgetags über den Kalender. `print.js`: Fenstergrenzen über `toMin(tag + 'T' + hh + ':00')` bzw. Folgetag-Mitternacht für 24; `fensterFuer` liest Stunden über `getHours()` des lokalen Datums; Ticks und Balken bleiben zueinander konsistent (beide in Minuten). Prüfung: Nachtschicht 22:00–02:00 am 25.10.2026 steht vollständig auf beiden Blättern. |
| 10 | `project.now` friert die Uhr ein. | Übersteuerung in `gantt.js` entfernen; `migrate` löscht `project.now`. Kein Prüfwerkzeug braucht es (`page.clock`). |
| 11 | ⌘Z im Tabellenfeld. | Globaler keydown in app.js überspringt ⌘Z/⇧⌘Z, wenn `e.target` in `input, textarea, select, [contenteditable]` steht (⌘S bleibt global). |
| 12 | Touch-Griffe über der Beschriftung. | CSS-Regel `pointer: coarse → opacity 1` entfällt. Stattdessen setzt `paintSelection()` `is-sel` am Griff des ausgewählten Vorgangs (und nimmt es bei allen anderen weg): auf Touch tippt man den Balken an, dann erscheint der Griff. Maus-Verhalten (hover/focus) bleibt. |
| 13 | Panel kennt nur Setup/Show. | `inspector.js` baut das Abschnittsfeld aus `abschnitte(store.state)` wie `table.js`, gewählt ist `t.abschnitt || 'show'`. |
| 14 | Live-Leiste zählt Show-Einträge. | `refreshLive` rechnet über `gantt.sichtbareTasks()`. |
| 15 | Tooltip-Farbpunkt. | `gewerkVar(g.slot)` (+ Schraffur wie überall). |
| 16 | `setDepField`/`setGewerkField` ungeprüft. | `setDepField`: nur `type` (Liste) und `lag` (ganze Zahl, endlich); `setGewerkField`: nur `name`; alles andere «Dieses Feld lässt sich nicht ändern». |
| 17 | `removeGewerk` ohne `fuer`-Kaskade. | Fixpunkt-Kaskade aus `removeTask` als Helfer, von beiden benutzt. |
| 18 | Plan verschieben (neu). | Store-Befehl `shiftPlan {tage, minuten}` (beide ganze Zahlen, nicht beide 0): verschiebt `start`/`end` aller Vorgänge, `res[].von/bis`, Phasen und `project.start/end`; Tage über `new Date(y,m,d+n,hh,mm)`, dann Minuten. Ein Schnappschuss, ein ⌘Z. UI: Einrichten → Projekt, Knopf «Plan verschieben…», eigener `.dlg`-Kasten mit Feldern Tage und Stunden:Minuten (Vorzeichen erlaubt), Vorschau «Aufbaubeginn 24.08. → 31.08.», Knopf «Verschieben». Kein `prompt`. |
| 19 | Doku-Drift. | `.claude/rules/tabelle-einrichten.md` und `README.md`: sechs Reiter nennen. |

## Rahmen

- Branch `fix/pruefpaket` ab `main` in einem eigenen Worktree; ein Commit je
  Task.
- Modelle: Sonnet für Store/Persistenz/Sync/App-Logik, Druck-DST und das
  Verschieben; Haiku für mechanische Korrekturen nach exakter Anweisung (13,
  14, 15, 19, 11); Reviews mit Sonnet. Die Hauptsitzung (Fable) prüft jede
  Lieferung selbst: betroffene Tests und das betroffene verify-Skript laufen
  lassen, Diff lesen, Screenshot ansehen, wo Darstellung betroffen ist.
- Jede Korrektur mit Rot-Nachweis (neuer Test/Prüfung fällt vor der Korrektur).
- Abnahme: alle neun Prüfungen grün, Doku nachgezogen (README, CHANGELOG,
  CLAUDE.md, `.claude/rules/*.md`, `docs/entscheidungen.md`).
- Halt vor: Versionsnummer (Marco nennt sie), Push auf `main`, Tag.

## Dem Umsetzer überlassen

Wortlaut der Dialoge im Stil der vorhandenen (`askDialog`), Aufteilung neuer
Tests auf die bestehenden Testdateien, genaue Stelle der neuen Prüfungen in
`verify-sync.mjs`/`verify-edit.mjs`/`verify-print.mjs`, Umgang mit `fensterFuer`
bei 25-Stunden-Tagen (Fenster darf 25 Stunden breit sein).
