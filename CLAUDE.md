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
node tools/verify-amk.mjs  # AMK-Plan importieren
node tools/verify-klassentreffen.mjs  # V07-Plan + Autostart über die Adresse
node tools/verify-print.mjs  # Tagesblätter A3: Zuschnitt, Filter, Maßstab
node tools/verify-showablauf.mjs  # Showablauf: Ebene, Bühnen, Kopfzeile, Blatt
node tools/verify-sync.mjs  # Sync: zwei Geräte, Konflikt, Offline-Start
```

- **Alle neun müssen grün sein**, bevor etwas fertig ist (parallel startbar). `verify-browser.mjs` braucht einmalig `npx playwright install firefox`.
- **Screenshots ansehen, nicht nur die Häkchen zählen;** zu jedem behobenen Fehler eine Prüfung schreiben.
- **Neue Bausteine gehören in die `needed`-Liste in `tests/run.mjs`.**
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

## Daten und Store

- **Der Store ist der einzige Weg, den Plan zu ändern;** nie direkt an `state`. Validierung VOR der Änderung; ein abgelehnter Befehl hinterlässt nichts (kein Undo-Eintrag, keine Ungesichert-Marke). Undo über Schnappschüsse.
- **Rechenlogik bleibt DOM-frei** (`schedule.js`, `timeaxis.js`, `store.js`, `conflicts.js`, `persistence.js`); neue Logik dort → Test.
- **Neue Felder müssen durch `addTask` durch** (sonst fallen sie beim Anlegen still weg).
- **Kein Cache in `computeSchedule`;** `findConflicts(state, vorab)` nimmt eine fertige Rechnung, app.js holt sie über `gantt.conflicts()`.
- **Untervorgänge: der Elternvorgang ist die HÜLLE.** Untervorgang = Vorgang mit `parent` (Text-id, nie Relation), gleiches Gewerk, nur EINE Ebene (`addTask`). `reflowParents(state)` läuft nach JEDER Änderung in `store.apply` (Eltern-`start`/`end` = Kinderspanne).
- Eltern-Zeiten setzen, verschieben, zum Meilenstein machen: abgelehnt. Löschen kaskadiert, Gewerkwechsel zieht Kinder mit, `findConflicts` nimmt Sammelvorgänge AUS.
- **`removeTask` kaskadiert auch über `fuer`.** **`reorderGewerk` darf `slot` nicht anfassen** (Test).
- **`migrate` normalisiert nur, was der Plan NICHT kennt** (eigene Abschnitte bleiben); `setTaskField`/`addTask` lehnen unbekannte Abschnitte ab.
- **`js/dom.js` = DOM-Kleinkram** (`el`, `svgEl`, `$`, `escapeHtml`, `toInput`, `STATUS`), nicht `clone`.
- **Ein Zustand, ein Besitzer:** Inspector = INHALT des Panels, `syncPanel()` (app.js) allein die Sichtbarkeit (`#ins.hidden`).
- **Die JSON ist die Wahrheit:** `boot()` holt `klassentreffen-festival.json` (`BUNDLED`/`START` in app.js); neuer Planstand = Datei tauschen + pushen. `exported`-Stempel (`project.quelle`): Datei neuer → Datei; gleich/unerreichbar → lokal.
- **`?plan=leer` schaltet den Autostart ab** (`verify-browser`, `verify-edit`, `verify-live`, `verify-amk` hängen daran).
- **Was der erste Start braucht, gehört auf Modulebene, nicht in `mount()`** (Import, Neu, Projekte, `openEinrichten`).
- **Der AMK-Plan ist quellentreu** (`tools/make-amk.mjs`): Geschätztes = `estimated: true` + gestrichelte Kante; wo das Gewerk im Original leer war, sagt es die Notiz.
- **AMK: nur DREI Verknüpfungen («Leitern runter → sobald Backline und Set weg», Kopplung der «Rigging/Set»-Zeile), **keine dazuerfinden** (`tests/amk.test.mjs`).
- **Abhaken ist persistiert und signaturgebunden** (`ackCrit` bool, `ackConflictMin` Minuten, via `setTaskField`); `findConflicts` überspringt nur, solange `shortBy <= ackConflictMin + EPS`. «Kritisch» bleibt Information (kein automatisches Verschieben), Abhaken blendet nur aus.
- **Eine Quelle für Warnungen:** Zählung, Prüf-Liste, `resolveConflictsCmd` lesen alle `findConflicts`. `gantt.stats()` zählt die sichtbare Ebene, Kritisch/Konflikte den ganzen Plan.
- **Auswahllisten (Arten, Abschnitte, Ressourcen): dieselben drei Befehle** `setAuswahlLabel`, `removeAuswahl`, `reorderAuswahl` (`liste: 'punktTypen'|'abschnitte'|'ressourcen'`).
- **Umbenennen ändert nur das Label, nie die id.** Gelöscht wird nur, was niemand benutzt (Knopf vorher gesperrt UND sagt warum). **Sortieren setzt `sort` bei ALLEN oder keinem** (`reorderAuswahl` lehnt Teillisten ab).
- **Welches Feld auf welche Liste zeigt, weiß NUR der Store** (`LISTEN`, `benutztVon`); Sortierung nur in `nachSort` (ebene.js): `?? Infinity`, nie `?? 0`.
- **Eintragsarten: eingebaute `PUNKT_TYPEN` (ebene.js, Feld `kompakt`), eigene im PLAN** (`project.punktTypen`, im Export). `punktTypen(state)` führt beide zusammen; Dropdown, `typHinweis`, Druckblatt fragen nur dort.
- Neue Art/Abschnitt entsteht im Auswahlfeld der Tabelle («+ Neue Art…»/«Neu»), an keinem zweiten Ort.
- **`store.js` führt die eingebauten Arten DOPPELT;** `tests/store.test.mjs` vergleicht gegen `PUNKT_TYPEN` (doppelt nur mit Test).
- **Eigene Abschnitte** (`project.abschnitte`, `abschnitte(state)`) FILTERN weiter nur nach Setup/Show; Sortierung nach frühestem Eintrag, leere hinten.
- **`crew` ist die MIGRIERTE Ressource «Crew»:** `persistence.js` wandelt `crew: N` einmalig in `res: [{rid:'crew', n:N, von:null, bis:null}]` (idempotent, `tests/persistence.test.mjs`). Vorlagen laufen NICHT durch `migrate()`; `planFromTemplate` übersetzt selbst.
- **Keine Platzhaltertexte in Freitextspalten.** **„Tag 1/2/3" gehört in die Notiz, nicht in den Titel** (Test). **Das Wort ist «Zeiteintrag»** in Spalte, Knopf, Zähler, Ecke der Seitenspalte, Vorgabename, Kennzahl (Datenfeld `punktTyp`; auf dem A3-Blatt bleibt «Programmpunkt»).

## Zeit und Live

- **Zeiten aus echten Zeitstempeln** (`toMin()`), nie aus Ziffern auf Datumsstrings.
- **`nowInZone` darf nie stumm zurückfallen** (`gantt.js`): `hourCycle: 'h23'` (nicht `hour12: false`), `replace(/\s+/, 'T')`; bei Fehler lokale Zeit PLUS Warnung. Test: **zwei Betrachter in verschiedenen Zonen** (`verify-live.mjs`).
- **Zoomstufen in sichtbarer Zeitspanne**, nicht in Pixeln (eine «Tagesansicht» zeigt Tage; Tests).
- **Die Jetzt-Linie tickt IMMER** (`startTicking()`, 15 s), ohne `layout()`: nur `paintNow()`/`paintLive()`.
- **Status wird nie automatisch gesetzt** (Verzug in `js/live.js`).
- **Der Versatz verschiebt den ABLAUF, nie die UHR** (`versatz`, positiv = Delay): Balken wandern; Achse, Ticks, Bänder, JETZT-Linie bleiben echt.
- **Zwei Abbildungen Zeit → Pixel:** `x()` echt, `xp()` Ablauf; genau DREI Stellen rufen `xp()`: `place()`, `updateLabels()`, `depAnchors()`.
- **`live.js` kennt den Versatz nicht:** es bekommt `nowPlan() = NOW − versatz`. **Die Show-Kopfzeile zeigt `now`, nicht `planNow`.** Angezeigte Zeiten laufen durch `verschoben()`, relative nicht.
- **Der Versatz gehört dem Abend:** `localStorage`, NICHT im Export, nur am Setz-Tag (`{min, tag}`), beim Projektwechsel 0.
- **Im Showablauf sagt das Verzugsfeld nie «im Plan», solange etwas läuft** (`verify-showablauf.mjs`).
- **Verzug in der Live-Kopfzeile zählt nur, was aussteht oder läuft** — gefiltert wird die ANZEIGE, nicht die Rechnung (`delaysAt`).
- **Zeitfelder im Showablauf tragen KEIN Datum** (im Bauzeitenplan datiert). `mitUhrzeit` behält den Datumsteil; `endeNachStart`: Ende vor Start = Folgetag über den KALENDER, nicht +1440 (`conflicts.js`).

## Gantt und Darstellung

- **Gewerk-Farben (`styles/base.css`, `--gw-*`) nicht per Hand ändern** (Suchlauf `tools/farbsuche.mjs`, 720 Varianten): neu rechnen statt raten.
- **Jeder Farbton hat eine gerechnete SCHRIFTFARBE (`--gw-t-*`)**, in **hell UND dunkel** über **3:1**, feste Werte, NIE ein Dunkel-Override. Wer `--gw-*` ändert, rechnet mit (Prüfung «Schrift auf Gewerkfarbe hält 3:1»).
- **Farbe: Programmpunkt wählbar, Gewerk nicht:** `slot` am Vorgang (null = erbt Bühne), zehn Töne + Schraffur (`slotAus`/`hueVon`), nie eine freie Farbe.
- **Farbplätze je EBENE** (`freeSlot(state, art)`); `slotsExhausted` gegen die Bänder der AKTIVEN Ebene, nie `gewerke.length`.
- **Balkenbeschriftung nicht entfernen** (sekundäre Kodierung). **Schraffur = Gewerk-Identität** (Platz 9–16), nicht Status.
- **Themes: Gestaltung in `styles/themes/`, Geometrie in `base.css`;** kein Theme definiert Gewerk-Farben neu; jedes braucht beide Dunkel-Scopes (`@media prefers-color-scheme` **und** `:root[data-theme="dark"]`). `docs/themes.md`.
- **`bz-bereit` braucht KEINE Theme-Anpassung** (`outline: dashed currentColor`), steht nicht in `needed`; wie `is-estimated`.
- **Per Klick Auswählbares gehört in die Tab-Reihenfolge, und was `tabIndex` trägt, reagiert auf Enter UND Leertaste** (`bindMark` in gantt.js, EINE Stelle; Space mit `preventDefault()`; auch Meilenstein-Rauten; Prüfung in `verify-edit.mjs`).
- **Beschriftung läuft nie über den nächsten Balken** (`updateLabels()`, `data-next`; `verify-klassentreffen.mjs`).
- **Eine Reihenfolge für beide Ansichten: `byStart`** (Start, Ende, Titel). **Verknüpfungs-Picker sucht** (`candidateGroups`, schedule.js); lange Listen nie als `<select>`.
- **Achsen-Ticks und Bänder auf `T1` klemmen;** ein Kalendertag füllt bei jeder Breite die Breite.
- **`O.onView` meldet jedes Selbst-Einpassen;** kein `requestAnimationFrame` raten; der ResizeObserver merkt auch Breite **0**.
- **Ein leeres Band ist nur im Bauzeitenplan unsichtbar;** `Math.min(...[])` = `Infinity`, Hülle fällt auf `T0`.
- **Bauzeitenplan: eine Zeile je VORGANGSNAME, ein Balken je Termin** (`seriesRows`; 353 Vorgänge = **153 Zeilen**). Überlappung → **Spuren** (`--lane`, `rowH × lanes`). Marken gelten je Zeile, Umbenennen die Serie. **Die Tabelle bleibt flach.**
- **Showablauf: Balken GEFÜLLT** (`.bz[data-ebene="show"]` in den Themes; gantt.js setzt nur `data-ebene`, `--gw`, `--gw-t`).
- **Showablauf: NICHT bündeln** (`buendeln`): eine Zeile je Zeiteintrag, `lanes` immer 1; `seriesRows` unangetastet.
- **Uhrzeit und Dauer links vor dem Namen** (`bz-lab-zeit`/`bz-lab-dauer`, `tabular-nums`); **Dauer in MINUTEN**, Meilenstein = Strich.
- **Seitenspalte im Showablauf 390 px (sonst 296; Handy 168);** Breite am DOM messen (`sideWNow()`), nicht `O.sideW`.
- **Showablauf-Achse: JEDE Stunde beschriftet** (`ticksFor` `'hour'`), ab `px >= 0.5`.
- **Personal-/Maschinenbedarf sind DARSTELLUNGEN** (`data-view="personal"|"maschine"`): `bedarf.setEbene(...)` läuft überall mit, wo `gantt.setEbene`/`table.setEbene` laufen. Raster: Tage (Bauzeitenplan), Stunden (Showablauf). Gerechnet nur in `bedarfsRaster()`.

## Showablauf und Ebenen

- **`js/ebene.js` ist die einzige Stelle, die die zwei Ebenen kennt.** Bauzeitenplan = GEWERKE, Showablauf = BÜHNEN (Gewerk mit `art:'buehne'`). Gantt, Tabelle, Druck FRAGEN (`sichtGewerke`/`sichtTasks`/`amTag`). Ohne `art` = Gewerk.
- Kein zweiter Store, kein zweites Undo, keine zweite Persistenz. **Ein Gewerk wird nie nachträglich zur Bühne.**
- **Der ZEITEINTRAG trägt den Abschnitt** (`abschnitt: 'setup'|'show'`, fehlt = `show`; `imAbschnitt` filtert). **`sichtGewerke` filtert NICHT.** Zeitfenster je Ansicht: `programmFenster`.
- **Soundcheck = ZEITEINTRAG im Setup** mit `fuer: <taskId>` (Text-id).
- **Der Showablauf ist tagesbezogen;** Gantt und Tabelle bekommen DENSELBEN Tag.
- **Neue Vorgänge landen dort, wo man HINSCHAUT:** `defaultStart()` (table.js) schließt an den letzten Eintrag des gezeigten Tages UND Abschnitts an (`addRow` gibt ihn mit), leerer Tag = 08:00.
- **Kein Typ steht doppelt** (`typHinweis`, ebene.js: normalisiert, in beide Richtungen verglichen).
- **Der Umschalter bleibt** Bauzeitenplan · Setup · Show; eigene Abschnitte zählen über `abschnittOf` zu Show, die Tabelle meldet den Wechsel (`waehleAbschnitt` → `onHinweis`).

## Druck

- **Die Tagesblätter sind eine eigene Seite** (`print.html` + `js/print.js` + `styles/print.css`, A3 quer je Tag): **Auswahl → Zeitfenster → Blatt**, Fenster gemeinsam; Zuschnitt `tagesScheiben`; über Mitternacht = beide Blätter.
- **Auf dem Blatt steht kein Text IM Balken** (Namensspalte). Schriftgrößen an der Zeilenhöhe (`--pr-titel`/`--pr-notiz`); die Notizzeile fällt weg, bevor sie unlesbar wird, statt die Zeile darüber anzuschneiden.
- **Running-Order-Blatt kennt den Abschnitt** (Setup · Show · beides; `?abschnitt=`); Bauzeitenplan-Blätter zeigen nie Bühnen.
- **Running-Order-Blatt = LISTE** (`roBlatt`), leere Felder als Linie, Zeilenhöhe GEWICHTET (Umbau 0,62).
- **`Element.append()` gibt `undefined` zurück:** erst füllen, dann anhängen.

## Oberfläche und Bedienung

- **Tabelle: `render()` wartet, solange in dem Feld getippt wird, das ihn auslöste** (NUR dieses Feld). Nachholen beim `focusout`; Fokus in ein anderes Feld derselben Tabelle zieht mit. Kein Fokus-Wiederherstellen, `document.activeElement` nicht sofort prüfen.
- **In der Tabelle nur `change`, nie zusätzlich `blur`.** Handler lesen frisch aus dem Store (`cur(id)`), nie aus der Closure.
- **Schwebende Kästen merken ihre Position BEIM ÖFFNEN** (`platziere()` nimmt ein Rechteck).
- **Die Tabelle bleibt EIN Modul** (Spaltensätze `SPALTEN.bau`/`SPALTEN.show`); Showablauf `c-start`/`c-end` 112 statt 175 px.
- **DREI Ansichten, zwei Ebenen plus Abschnitt:** EIN Umschalter (Bauzeitenplan · Setup · Show), genau einer gedrückt. `setAnsicht()` in app.js ist einziger Schreiber von `ansicht`/`ebene`/`abschnitt` (`ebeneVon`, `abschnittVon`).
- `?ansicht=bau|setup|show` steuert von außen; `?ebene=`/`?abschnitt=` werden übersetzt.
- **Zwei gleich aussehende `.seg`-Gruppen nebeneinander sind EINE Gruppe:** absetzen oder zusammenlegen; `.ein-reiter` steht allein in seiner Zeile.
- **Die Schiene (`js/rail.js`) trägt nur den MODUS** (Bauzeitenplan, Showablauf, Einrichten), rendert nur, meldet per `on.modus`/`on.einrichten`. **Nichts Wachsendes hinein** (keine Tage).
- **Tagwahl nur über den Kalender-Knopf, nur Tage aus dem Plan** (`tagWahl`/`planTage`, `programmTage(sichtTasks(state, ebene))`): EIN Knopf für beide Modi, via `openMenu` (`.mn` `max-height: 62vh`); `syncTagKnopf()` einziger Schreiber.
- **Was im Modus nichts bedeutet, steht nicht da:** `setAnsicht()` blendet `#seg-abschnitt` außerhalb Showablauf, `.hd-zoom` außerhalb Bauzeitenplan+Plan aus; `syncBuehnen()` nur im Showablauf.
- Sichtbare `button`/`input`/`select` in `.hd-bar` (Klassentreffen, eine Bühne, ohne Live/Konflikt): **13 Bauzeitenplan, 11 Showablauf** (inkl. `#drucken`). Zoom = `openMenu`.
- **Neuer Knopf:** erst den Modus nennen, in dem er etwas bedeutet, im anderen ausblenden.
- **Einrichten ist ein FENSTER** (`#ein-dlg`, vier Reiter). Ein Knopf liegt in EINEM Reiter; Prüfwerkzeuge klicken vorher `#rail-ein` UND `[data-ein="…"]`.
- **Umgezogene Knöpfe behalten ids und Handler** (`#export`, `#import`, `#new-proj`, `#proj-menu`, `#add-gewerk` in `[data-ein="baender"]`, `#theme-toggle`; je Reiter eine `.ei-sec` mit `data-ein-tab`).
- **Verwalten-Kästen von außen:** `table.openVerwalten(opt, ankerEl)`, `table.openNeuFragen(...)`.
- **Personal und Maschinen in DERSELBEN Verwalten-Liste** (`tb-verw-kind`, 👤/⚙); Anlegen getrennt («+ Personal»/«+ Maschine»).
- **Niemals `window.prompt`/`confirm`/`alert`.** Bestätigung: `askDialog({title, message, buttons})` (app.js; `null` bei Abbruch). Namenseingabe: `tb-neuart` (`neuFragen`, table.js; `cmd` setzt den Namen als `label`, `buildCmd(wert, kompakt)` wenn er anderswo im Befehl steht).

## Personal und Maschinen

- **Zuweisung = `{rid, n, von, bis}`** in `t.res`; `null` = ganzer Vorgang, gesetzt innerhalb der Vorgangsdauer (`setTaskRes`). Bezeichnungen in `project.ressourcen` (`kind: 'personal'|'maschine'`, im Export), Verwaltung über `addRessource` + die drei Auswahlbefehle.
- **Keine eingebauten Bezeichnungen;** `res` MUSS durch `addTask`.
- **Bereitstellung = normaler Vorgang** mit `bereitstellung: true` (POOL, `res` = Angebot). `addDep` lehnt ihn als Quelle UND Ziel ab; `findConflicts`/kritischer Pfad nehmen ihn aus; `setTaskField` verweigert `bereitstellung: true`, solange Verknüpfungen bestehen.
- **Deckungslücke nur, wenn der Vorgang eine Zuweisung dieser Art hat** (`deckung(t, kind, state)` sonst `null`), je KIND; kein Konflikt, nicht in der Prüf-Liste (Balken `bz-bereit`; im Panel als Klartext, keine Alarmfarbe).

## Sync und Offline

Local-first: Plan in `localStorage`; privates Repo `M4dm0nky/Bauzeitenplan-Daten` (`main`, `projekte/<project.id>.json` = `serialize(plan)`) gleicht nur ab. **Ohne Schlüssel verhält sich die App wie vorher.**

- **Schlüssel nur in `localStorage` `bzp_sync`** (`{token, repo}`), nie in Plan/Export/Repo (`tests/run.mjs` sperrt es). `remoteSha`/`dirty` im Index `bzp_projects`, nie im Plan.
- **`js/sync.js` DOM-frei**, `fetch` hereingereicht (`createSync`); `abgleich()` entscheidet, app.js führt aus. **GitHub-Abrufe mit `cache:'no-store'`; Base64 über `TextEncoder`**, nie `btoa`.
- **Ein Konflikt wird nie still aufgelöst:** `askDialog` mit drei Knöpfen, einer «Beide behalten (Kopie)» («… (anderes Gerät)»). Offenes Projekt neuer und lokal nicht `dirty` → ersetzen mit Toast. Gelöscht vs. `dirty` → behalten, neu hochladen.
- **Hochladen gebündelt:** frühestens 10 s nach dem Speichern, sofort bei `visibilitychange → hidden` und Projektwechsel; höchstens EIN Nachlauf.
- **Kein Netz/falscher Schlüssel bricht den Start nie** (`#sync-state` gelb/rot).
- **Prüfen:** `tools/verify-sync.mjs` (gefälschte API); `--echt` mit `BZP_TOKEN`.

## Aus Crewplaner gelernt (für ein späteres Backend)

- `project_id` & Co. als **Text**, nie Relation. E-Mails `.toLowerCase()`. API-Rules nach Coolify-Redeploy prüfen. Kein Bundle-File: ES-Module mit `?v=`-Cache-Bust. Rollen serverseitig über API-Rules (UI-Verstecken ist keine Sicherheit).

## Aufbau

| | |
|---|---|
| `js/gantt.js` | Render-Engine: DOM, Zoom, Pfeile |
| `js/schedule.js` | CPM, Topo-Sort, kritischer Pfad — **DOM-frei** |
| `js/timeaxis.js` | Zeit ↔ Pixel, Zoomstufen, Ticks, KW — **DOM-frei** |
| `js/app.js` | Verdrahtung; bewusst dünn |
| `js/store.js` | Zustand + Befehle + Undo — **DOM-frei** |
| `js/conflicts.js` | Konflikte + Dauer-Kurzform — **DOM-frei** |
| `js/persistence.js` | localStorage, Export/Import — **DOM-frei** |
| `js/table.js` | Tabellen-Editor |
| `js/templates.js` | Vorlagen (`TEMPLATES`: fünf Einträge) |
| `js/palette.js` | 10 Töne × 2 Schraffuren = 20 Plätze (HUES=10, MAX_SLOTS=20) |
| `js/ebene.js` | Bänder, Showtage, Typ-Hinweis — **DOM-frei** |
| `js/resources.js` | Bezeichnungen, Deckung, Bedarfsraster — **DOM-frei** |
| `js/live.js` | Verzug, Laufendes, Versatz (`verschoben`, `versatzText`) — **DOM-frei** |
| `js/inspector.js` | Seitenpanel |
| `js/menu.js` | Kontextmenü, Tageswahl |
| `js/bedarf.js` | Bedarfsansicht |
| `js/rail.js` | Die Schiene (Modus) |
| `js/sync.js` | GitHub-Contents-Client + `abgleich()` — **DOM-frei** |

Warum was so ist: `docs/entscheidungen.md` (auch kritischer Pfad: verankerte Senken fallen aus dem minFloat).

## Fahrplan

Offene Punkte: GitHub-Issues von M4dm0nky/Bauzeitenplan, keine Liste in dieser Datei.

**PocketBase liegt auf Eis:** Branch `pocketbase-vorbereitung`, nicht gemergt, nicht deployt. Nur die Vorlage «festival» ist abgenommen; Tour, Corporate, Messe sind Entwürfe und beim ersten echten Einsatz zu korrigieren.

## Gestartete Prozesse IMMER wieder beenden
Hintergrundbefehle, Server, Watcher, Builds (auch von Subagenten) beenden, sobald sie fertig sind; nach Abbruch/Timeout und am Sitzungsende auf verwaiste Prozesse prüfen. Details: `C:\Dropbox\Incomming\github\CLAUDE.md`.
