# Bauzeitenplan — Arbeitsanweisungen

Gantt-Ablaufplan für die Veranstaltungsbranche. Vanilla JS, ES-Module, **kein Build-Step**. Projekte leben im Browser (localStorage) + JSON-Export. Kein Backend, keine Anmeldung.

**Live:** https://m4dm0nky.github.io/Bauzeitenplan/ · **Repo:** M4dm0nky/Bauzeitenplan · **Version:** `node tools/version.mjs`

Starten: `python3 -m http.server 8080` (ohne Server blockiert der Browser die ES-Module per CORS).

Hier stehen nur die Regeln. Begründung und Vorgeschichte jeder Regel: `docs/entscheidungen.md` → «Begründungen zu den Regeln in CLAUDE.md» (je Regel eine Überschrift mit demselben Wortlaut).

## Vor jeder Änderung

```bash
node tests/run.mjs              # Unit-Tests + statische Prüfungen
node tools/verify-browser.mjs   # Darstellung: App in allen 5 Themes
node tools/verify-edit.mjs      # Bearbeiten: anlegen, tippen, Undo, Panel, Menü
node tools/verify-live.mjs      # Live-Modus mit gestellter Uhr
node tools/verify-amk.mjs       # AMK-Plan importieren
node tools/verify-klassentreffen.mjs   # V07-Plan + Autostart über die Adresse
node tools/verify-print.mjs     # Tagesblätter A3: Zuschnitt, Filter, Maßstab
node tools/verify-showablauf.mjs # Showablauf: Ebene, Bühnen, Live-Kopfzeile, Blatt
node tools/verify-sync.mjs        # Sync: zwei Geräte, Konflikt, Löschen, Offline-Start
```

- **Alle neun müssen grün sein**, bevor etwas als fertig gilt. Sie laufen unabhängig und lassen sich parallel starten. `verify-browser.mjs` braucht einmalig `npx playwright install firefox`.
- **Screenshots ansehen, nicht nur die Häkchen zählen.** Automatische Prüfungen haben schon ein Dutzend echter Fehler durchgelassen (Liste: `docs/entscheidungen.md`); der nächste Fehler dieser Art hat noch keine Prüfung. Zu jedem behobenen Fehler gehört eine Prüfung.
- **Neue Bausteine gehören in die `needed`-Liste in `tests/run.mjs`**, sonst fehlen sie unsichtbar in den Themes, in denen sie nicht entstanden sind.
- `grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` muss leer bleiben (Kommentare ausgenommen).

## Deploy und Version

`git push origin main` → GitHub Pages zieht ~1 Min. später nach (kein Build, kein Workflow, Quelle `main` / `root`). Danach **live gegenprüfen**: `node tools/verify-browser.mjs --base https://m4dm0nky.github.io/Bauzeitenplan/`

- **Vor dem Deploy: `node tools/version.mjs <neu>`.** Setzt auch alle `?v=`; von Hand hochzählen wird vom Testlauf bestraft. `sw.js` (Cache-Buster) greift erst ab dem zweiten Aufruf — deshalb beides.
- **Der Service Worker ist network-first** (`cache:'no-cache'`): online immer frisch, Cache nur bei Netzfehler. Cache `bzp-<SW_VERSION>`, `activate` löscht alle anderen. Dateiliste `HUELLE` in `sw.js`, von `tests/run.mjs` in beide Richtungen geprüft. Kill-Switch steht in `sw.js`.
- **Den aktuellen Stand sagt `node tools/version.mjs`** (ohne Argument), nie eine Zahl in dieser Datei. `CHANGELOG.md` hält die Historie.
- **Die Version wird NIE von Hand geändert.** `node tools/version.mjs 0.2.0` stempelt alle sechs Stellen und legt den Changelog-Abschnitt an: `js/version.js` (Quelle) · `package.json` · `index.html` **und `print.html`** (alle `?v=`) · `sw.js` (`SW_VERSION`) · `CHANGELOG.md`.
- **Die Nummer entscheidet Marco** — VOR dem Stempeln fragen, nicht danach mitteilen. Rückschritte und Nicht-SemVer lehnt der Befehl ab (Zurückdrehen bricht den Cache-Schutz).
- **Jede ausgelieferte HTML-Seite gehört in `tools/version.mjs` UND in die Versionsprüfung in `tests/run.mjs`.** `node tests/run.mjs` prüft, dass alle Stellen übereinstimmen und `CHANGELOG.md` einen Abschnitt für die aktuelle Version hat.
- **Nach dem Push ein annotierter Tag** (`-a`, nie leichtgewichtig): `git tag -a v0.2.0 -m "…" && git push origin v0.2.0`. Tags sind schwer zurückzunehmen — **erst nach Rückfrage setzen.**
- **Nebenwirkung jedes Versionswechsels:** neuer `sw.js` → `controllerchange` in `index.html` **lädt offene Tabs neu** (Daten sicher durch Auto-Save nach 800 ms, aber der Live-Modus springt). Beim Aufbau mit dem Plan auf dem Monitor nicht grundlos deployen.
- `gh` liegt unter `C:\Program Files\GitHub CLI\gh.exe` (PATH der PowerShell; in Git Bash mit vollem Pfad). Angemeldet als **M4dm0nky**. Das Repo liegt bewusst dort, nicht unter `Aniflu` (fremdes Konto: kein Repo anlegen, kein Pages, nur `push`).

Warum: `docs/entscheidungen.md` → «Vor dem Deploy», «Die Version wird NIE von Hand geändert».

## Harte Regeln — Daten und Store

- **Der Store ist der einzige Weg, den Plan zu ändern.** Nie direkt an `state` schreiben. Validierung VOR der Änderung; ein abgelehnter Befehl hinterlässt nichts (kein halber Zustand, kein Undo-Eintrag, keine Ungesichert-Marke). Undo über Schnappschüsse, nicht über Gegenbefehle.
- **Rechenlogik bleibt DOM-frei:** `schedule.js`, `timeaxis.js`, `store.js`, `conflicts.js`, `persistence.js`. Neue Logik dort → Test dazu.
- **Neue Felder müssen durch `addTask` durch** (der Handler baut das Vorgangsobjekt Feld für Feld auf; was fehlt, fällt still weg — Fall `abschnitt`, `res`). Wer ein Feld ergänzt, prüft `addTask` mit.
- **Kein Cache in `computeSchedule`.** Stattdessen Aufrufe senken: `findConflicts(state, vorab)` nimmt eine fertige Rechnung an, app.js holt die Liste über `gantt.conflicts()` (5 → 2 Läufe pro Änderung; 500 Vorgänge = 3,4 ms).
- **Untervorgänge: der Elternvorgang ist die HÜLLE, nicht editierbar.** Untervorgang = Vorgang mit `parent` (Text-id, nie Relation), gleiches Gewerk. `reflowParents(state)` läuft nach JEDER Änderung in `store.apply` und setzt Eltern-`start`/`end` auf frühesten Kindstart … spätestes Kindende. Eltern-Zeiten setzen, Sammelvorgänge verschieben oder zum Meilenstein machen wird abgelehnt (Tabelle sperrt die Felder). **Nur EINE Ebene** (in `addTask` erzwungen). Elternvorgang löschen kaskadiert auf die Kinder; Gewerkwechsel zieht sie mit. `findConflicts` nimmt Sammelvorgänge AUS.
- **`removeTask` kaskadiert auch über `fuer`** (Act löschen löscht seinen Soundcheck mit; ein ⌘Z holt beides zurück).
- **`reorderGewerk` darf `slot` nicht anfassen** (Farbe gehört dem Gewerk, nicht der Position). Ein Test prüft das.
- **`migrate` darf einen eigenen Abschnitt nicht plattmachen.** Normalisiert wird nur, was der Plan NICHT kennt; `setTaskField` und `addTask` lehnen unbekannte Abschnitte ab.
- **`js/dom.js` ist der Ort für DOM-Kleinkram** (`el`, `svgEl`, `$`, `escapeHtml`, `toInput`, `STATUS`). `clone` gehört NICHT dorthin (Store → persistence.js wäre der falsche Pfeil; die Wiederholung ist billiger).
- **Ein Zustand, ein Besitzer.** `#ins.hidden`: der Inspector entscheidet nur über seinen INHALT, `syncPanel()` in app.js allein über die Sichtbarkeit.
- **Der Autostart lädt die JSON, die JSON ist die Wahrheit.** `boot()` holt `klassentreffen-festival.json` (`BUNDLED`/`START` in app.js); neuer Planstand = Datei austauschen und pushen. Der `exported`-Stempel aus `serialize()` (in `project.quelle`) entscheidet: Datei neuer → Datei gewinnt; gleich → lokal bleibt; nicht erreichbar → lokal. **`?plan=leer` schaltet den Autostart ab** (`verify-browser`, `verify-edit`, `verify-live`, `verify-amk` hängen daran) — wer am Autostart dreht, denkt die vier mit.
- **Was der erste Start braucht, gehört auf Modulebene — nicht in `mount()`** (Import, Neu, Projekte, `openEinrichten`/`closeEinrichten`); `mount()` läuft erst mit offenem Projekt.
- **Der AMK-Plan ist quellentreu** (`tools/make-amk.mjs`). Geschätztes trägt `estimated: true` und eine gestrichelte Kante; leeres Gewerk im Original sagt die Notiz. Nur DREI Verknüpfungen («Leitern runter → sobald Backline und Set weg» plus die Kopplung der aufgeteilten «Rigging/Set»-Zeile). **Keine Abhängigkeiten dazuerfinden.** `tests/amk.test.mjs` hält das fest.
- **Abhaken ist eine menschliche Aussage über eine gerechnete Warnung — persistiert, signaturgebunden.** `ackCrit` (bool) nimmt einen kritischen Vorgang aus der kritisch-Zahl; `ackConflictMin` (Minuten) akzeptiert eine Konfliktgröße; `findConflicts` überspringt nur, solange `shortBy <= ackConflictMin + EPS` (wird er größer, meldet er sich wieder). Läuft über `setTaskField` (Undo, Persistenz). **Eine Quelle:** Zählung, Prüf-Liste und `resolveConflictsCmd` lesen alle `findConflicts`, nie einen zweiten Zähler. «Kritisch» bleibt Information (kein automatisches Verschieben).
- **Bestand zählt die Sicht, Warnungen zählen den Plan.** `gantt.stats()` meldet Vorgänge, Bänder, laufend, Crew aus der sichtbaren Ebene; Kritisch und Konflikte bleiben planweit (passend zur Prüf-Liste über `conflicts()`/`criticals()`).
- **Auswahllisten (Arten, Abschnitte, Ressourcen) gehen über DIESELBEN drei Befehle** (`setAuswahlLabel`, `removeAuswahl`, `reorderAuswahl` mit `liste: 'punktTypen'|'abschnitte'|'ressourcen'`), nicht über sechs fast gleiche.
- **Umbenennen ändert nur das Label, nie die id.** **Gelöscht wird nur, was niemand benutzt** (der Store nennt die Zahl, der Knopf ist vorher gesperrt und sagt warum). **Sortieren setzt `sort` bei ALLEN oder keinem** (`reorderAuswahl` lehnt unvollständige Listen ab; ab dem ersten Mal schlägt Handreihenfolge die Automatik).
- **Welches Feld am Vorgang auf welche Liste zeigt, weiß NUR der Store** (`LISTEN`, `benutztVon`); die Verwaltung fragt dort. **Die Reihenfolge selbst angelegter Werte steht in `nachSort` (ebene.js)** an EINER Stelle: `?? Infinity`, nie `?? 0`; der Store vergibt das nächste `sort`, sobald überhaupt sortiert wurde.
- **Eintragsarten stehen an EINER Stelle — eigene gehören in den PLAN.** Eingebaute: `PUNKT_TYPEN` in ebene.js (drittes Feld `kompakt`: tritt die Art auf dem A3-Blatt zurück?). Eigene liegen in `project.punktTypen` und reisen im Export mit. `punktTypen(state)` führt beide zusammen; Dropdown, Live-Ansage (`typHinweis`) und Druckblatt fragen dort, nie an `PUNKT_TYPEN` vorbei. Angelegt wird im Auswahlfeld der Tabelle («+ Neue Art…»), nicht an einem zweiten Ort.
- **`store.js` führt die eingebauten Arten bewusst DOPPELT** (Import aus ebene.js wäre Kern → Ansichtsschicht). Ein Test in `tests/store.test.mjs` vergleicht die Kopie gegen `PUNKT_TYPEN`: doppelt geführt ist erlaubt, ungeprüft doppelt nicht.
- **Abschnitte gehen denselben Weg wie Eintragsarten — FILTERN aber weiter nur nach Setup und Show.** Eigene stehen in `project.abschnitte`; `abschnitte(state)` führt sie mit den eingebauten zusammen, angelegt wird im Auswahlfeld der Spalte («Neu»). Sortiert nach ihrem FRÜHESTEN Eintrag, noch leere hängen hinten an.
- **`crew` ist keine Ressource, sondern die MIGRIERTE Ressource «Crew».** `persistence.js` wandelt beim Laden jede `crew: N` einmalig in `res: [{rid:'crew', n:N, von:null, bis:null}]` und legt «Crew» im Plan an; danach ist `crew` gelöscht. Das zweite Laden legt keine zweite Zuweisung an (`tests/persistence.test.mjs`). Die Vorlagen (`js/templates.js`) laufen NICHT durch `migrate()`: `planFromTemplate` übersetzt ihr `crew`-Extra selbst in `res`.
- **Keine Platzhaltertexte in Freitextspalten** (was die Spalte will, sagt ihre Überschrift). **„Tag 1/2/3" gehört nicht in den Titel**, sondern in die Notiz (ein Test prüft, dass kein Titel auf `Tag N` endet).
- **Das Wort ist «Zeiteintrag», nicht «Programmpunkt»** (Spalte, Knopf, Zähler, Seitenspalte, Vorgabename, Kennzahl). Das DATENFELD heißt weiter `punktTyp`; auf dem A3-Blatt bleibt «Programmpunkt» stehen.

## Harte Regeln — Zeit und Live

- **Zeiten immer aus echten Zeitstempeln rechnen** (`toMin()`), nie aus Ziffern auf Datumsstrings (Sommerzeit-Sprung).
- **`nowInZone` darf nie stumm zurückfallen** (`gantt.js`). Beim Formatieren `hourCycle: 'h23'` (nicht `hour12: false`), beim Einlesen `replace(/\s+/, 'T')` (geschütztes Leerzeichen). Scheitert es doch: lokale Zeit PLUS Warnung. Testbar nur mit **zwei Betrachtern in verschiedenen Zonen** auf demselben Projekt (`verify-live.mjs`).
- **Zoomstufen in sichtbarer Zeitspanne bemessen**, nicht in Pixeln («Tages»-Ansicht muss Tage zeigen). Die Tests setzen das durch.
- **Die Jetzt-Linie tickt IMMER**, nicht nur im Live-Modus (`startTicking()` in gantt.js, alle 15 s). Der Tick ruft **kein** `layout()`, nur `paintNow()`/`paintLive()`.
- **Status wird nie automatisch gesetzt.** Der Verzug (`js/live.js`) entsteht aus dem Widerspruch zwischen «geplant» und der Uhr.
- **Der Versatz verschiebt den ABLAUF, nie die UHR** (`versatz` in gantt.js). Positiv = Delay: Balken rutschen nach rechts; Achse, Ticks, Bänder und JETZT-Linie bleiben auf der echten Zeit.
- **Zwei Abbildungen Zeit → Pixel:** `x()` echte Zeit (Achse, Linie), `xp()` Ablauf (Balken, Beschriftungen, Pfeile). Genau DREI Stellen dürfen `xp()` rufen: `place()`, `updateLabels()`, `depAnchors()`.
- **Die Logik bekommt die zurückgedrehte Uhr, nicht den Versatz:** `live.js` kennt den Versatz nicht, es bekommt `nowPlan() = NOW − versatz`. **Die Uhr in der Show-Kopfzeile ist die Ausnahme:** sie zeigt `now`, nicht `planNow`.
- **Angezeigte Zeiten laufen durch `verschoben()`** (Seitenspalte, Tooltip, Kopfzeile); relative Angaben («in 12 Min») brauchen keine Korrektur.
- **Der Versatz gehört dem Abend, nicht dem Plan:** `localStorage`, **nicht** im Export, gilt nur für den Tag, an dem er gesetzt wurde (`{min, tag}`); beim Projektwechsel 0.
- **Im Showablauf sagt das Verzugsfeld nie «im Plan», solange etwas läuft** (alles steht auf «geplant»; der Versatz zieht seinen Betrag relativ ab). `verify-showablauf.mjs` hält das fest; die Erwartung «passender Versatz ⇒ im Plan» ist unerfüllbar.
- **Verzug in der Live-Kopfzeile zählt nur, was noch aussteht oder läuft.** Gefiltert wird die ANZEIGE (`delaysAt` meldet auch vergangene, nie abgehakte Punkte), nicht die Rechnung.
- **Zeitfelder im Showablauf tragen KEIN Datum** (der Tag steht im Umschalter); im **Bauzeitenplan bleiben sie datiert** (14 Tage). Zwei Fallen, gelöst in `conflicts.js`, getestet: **`mitUhrzeit` behält den Datumsteil** (Eintrag vom Vortag springt sonst beim Antippen); **`endeNachStart`: Ende vor Start meint den Folgetag** («22:00 bis 03:00»), gesucht über den KALENDER, nicht +1440 (25.10.2026 hat 25 Stunden).

Warum: `docs/entscheidungen.md` → «Zeitzonen», «Der Live-Versatz verschiebt den Ablauf, nicht die Uhr», «Zeitfelder im Showablauf tragen kein Datum».

## Harte Regeln — Gantt und Darstellung

- **Gewerk-Farben (`styles/base.css`, `--gw-*`) nicht per Hand ändern.** Sie sind das Ergebnis eines Suchlaufs über 720 Varianten (`tools/farbsuche.mjs`, CVD-Unterscheidbarkeit). Neu rechnen statt raten.
- **Neben jedem Farbton steht seine SCHRIFTFARBE (`--gw-t-*`), ebenfalls gerechnet:** je Ton die Tinte, die in **hell UND dunkel** über **3:1** bleibt (Weiß auf Gelb nur 2,17:1, dunkle Tinte 8,23:1) — feste Werte ohne Dunkel-Scope. Wer an `--gw-*` dreht, rechnet hier mit; die Prüfung «Schrift auf Gewerkfarbe hält 3:1» in `tests/run.mjs` schlägt sonst an.
- **Die Farbe eines PROGRAMMPUNKTS ist wählbar, die eines GEWERKS nicht.** Vorgang im Showablauf: eigenes `slot` (null = erbt die Bühnenfarbe); zehn Töne + Schalter für Schraffur; ein Farbplatz IST das Paar (`slotAus`/`hueVon` in palette.js), zehn Punkte für zwanzig Kombinationen. Gewählt wird AUS der Palette, nie frei. Im Bauzeitenplan bleibt die Zuordnung gerechnet.
- **Farbplätze werden JE EBENE vergeben** (`freeSlot(state, art)` in store.js); `slotsExhausted` gegen die Zahl der Bänder der AKTIVEN Ebene prüfen, nie gegen `gewerke.length`.
- **Balkenbeschriftung nicht entfernen** — sie ist die vorgeschriebene sekundäre Kodierung (Rigging, Licht, Ton liegen auf hellem Grund unter 3:1).
- **Schraffur gehört der Gewerk-Identität** (Platz 9–16), nicht dem Status; `status: geplant` ist ein umrandeter Balken. Nicht zurückdrehen.
- **Themes: Gestaltung gehört in `styles/themes/`, Geometrie in `base.css`.** Kein Theme definiert Gewerk-Farben neu. Jedes Theme braucht beide Dunkel-Scopes (`@media prefers-color-scheme` **und** `:root[data-theme="dark"]`). Details: `docs/themes.md`.
- **`bz-bereit` (Kontur der Bereitstellung) braucht KEINE Theme-Anpassung** (`outline: dashed currentColor`) und steht nicht in der `needed`-Liste; wie `is-estimated`. Neuer Baustein ohne Farbe: zuerst diesen Weg prüfen.
- **Was `tabIndex` trägt, muss auf Enter UND Leertaste reagieren.** Der Handler gehört an die EINE Stelle, durch die alle Marken laufen (`bindMark` in gantt.js), nicht je Renderzweig; Space braucht `preventDefault()`; auch Meilenstein-Rauten brauchen `tabIndex`. Prüfung in `verify-edit.mjs`.
- **Beschriftung neben einem Balken darf nie über den nächsten laufen:** `updateLabels()` blendet sie aus (`data-next` = Start des nächsten Balkens derselben Spur), der Name steht weiter links. Prüfung in `verify-klassentreffen.mjs`.
- **Eine Reihenfolge für beide Ansichten: `byStart` (schedule.js)** — Start, Ende, Titel. Nie eine Ansicht separat sortieren.
- **Der Verknüpfungs-Picker sucht, statt zu scrollen** (`candidateGroups` in schedule.js, DOM-frei, getestet: Gruppe je Gewerk, `byStart`, Query auf Titel/Gewerkname). Lange Auswahllisten genauso, nie einen 122-Zeilen-`<select>`.
- **Achsen-Ticks und Bänder werden auf `T1` geklemmt.** «Ein Kalendertag füllt die Breite» gilt bei jeder Breite (Tagesansicht passt sich bei Breitenänderung neu ein).
- **Der Gantt meldet, wenn er sich von SELBST einpasst** (`O.onView`: erster Eintrag im leeren Showablauf, Rückkehr aus der Tabelle per ResizeObserver). Kein `requestAnimationFrame` raten; der ResizeObserver merkt sich auch Breite **0**.
- **Ein leeres Band ist nur im Bauzeitenplan unsichtbar**, im Showablauf muss es stehen (auch eine im Abschnitt leere Bühne). `Math.min(...[])` ist `Infinity`: die Hülle fällt auf `T0`.
- **Im BAUZEITENPLAN: eine Zeile je VORGANGSNAME, ein Balken je Termin** (`seriesRows` in schedule.js, DOM-frei, getestet; 353 Vorgänge = **153 Zeilen**). Überlappende Termine bekommen **Spuren** (`--lane`, Zeilenhöhe `rowH × lanes`). Marken (Konflikt, KRIT) gelten für die Zeile, Umbenennen benennt die ganze Serie um. **Die Tabelle bleibt flach.**
- **Im SHOWABLAUF sind die Balken GEFÜLLT**, im Bauzeitenplan umrandet — über `.bz[data-ebene="show"]` in den Themes; `gantt.js` setzt nur `data-ebene` und `--gw`/`--gw-t`.
- **Im SHOWABLAUF wird NICHT gebündelt** (`buendeln` in gantt.js): die Zeilenfolge IST der Ablauf. Jeder Zeiteintrag eine eigene Zeile, `lanes` immer 1 (Gleichzeitiges = zwei Zeilen). `seriesRows` bleibt unangetastet.
- **Uhrzeit und Dauer stehen links vor dem Namen** (`bz-lab-zeit`/`bz-lab-dauer`, feste Breite, `tabular-nums`): `14:00 Uhr (30 min) CREUTZFELD & JAKOB`. **Die Dauer in MINUTEN**, nicht «0,5 h»; ein Meilenstein bekommt einen Strich, keine Null.
- **Die Seitenspalte ist im Showablauf breiter** (390 px statt 296; Handy 168 px per `base.css`, Dauer bricht UNTER die Zeile). **Spaltenbreite am DOM messen** (`sideWNow()`), nicht aus `O.sideW`.
- **Die Achse beschriftet im Showablauf JEDE Stunde** (`ticksFor` `'hour'`), erst ab `px >= 0.5`.
- **Personal- und Maschinenbedarf sind DARSTELLUNGEN, keine zweite Ansicht** (`data-view="personal"|"maschine"`). Sie bekommen dieselbe Ebene, Bühnen-Filter, Showtag und Abschnitt: `bedarf.setEbene(...)` läuft überall mit, wo `gantt.setEbene`/`table.setEbene` laufen. Raster: Tage im Bauzeitenplan, Stunden im Showablauf. `js/bedarf.js` rendert nur, gerechnet wird in `bedarfsRaster()` (resources.js).

Warum: `docs/entscheidungen.md` → «Gewerk-Farben sind gerechnet», «Farbe: gewählt AUS der Palette, nie neu definiert» und die gleichnamigen Überschriften.

## Harte Regeln — Showablauf und Ebenen

- **Zwei Ebenen, ein Plan — `js/ebene.js` ist die einzige Stelle, die das weiß.** Bauzeitenplan = GEWERKE, Showablauf = BÜHNEN (Gewerk mit `art:'buehne'`, Programmpunkt = normaler Vorgang darin). Kein zweiter Store, Undo, Persistenz. Gantt, Tabelle, Druck FRAGEN (`sichtGewerke`/`sichtTasks`/`amTag`). Altdaten ohne `art` sind Gewerke. **Ein Gewerk wird nie nachträglich zur Bühne.**
- **Der ZEITEINTRAG trägt den Abschnitt, nicht die Bühne:** `abschnitt: 'setup'|'show'` am Vorgang, `imAbschnitt` filtert Einträge, fehlt das Feld gilt `show`. Jede Ansicht rechnet ihr Zeitfenster selbst (`programmFenster`). **`sichtGewerke` filtert NICHT:** die Bühne bleibt in beiden Ansichten stehen.
- **Ein Soundcheck ist ein ZEITEINTRAG, kein Feld:** normaler Eintrag im Setup mit `fuer: <taskId>` (Text-id, nie Relation); bedient aus dem Panel des Acts.
- **Der Showablauf ist tagesbezogen.** Gantt und Tabelle bekommen DENSELBEN Tag gereicht.
- **Neue Vorgänge landen dort, wo man HINSCHAUT:** `defaultStart()` in table.js schließt an den letzten Eintrag DES GEZEIGTEN TAGES UND ABSCHNITTS an; `addRow` gibt den aktiven Abschnitt mit; leerer Tag: 08:00 dieses Tages.
- **Kein Typ steht doppelt** (`typHinweis` in ebene.js): normalisiert und in beide Richtungen verglichen («SHOW END» = «Show-Ende»).
- **Der Umschalter oben bleibt unverändert** (Bauzeitenplan · Setup · Show). Ein eigener Abschnitt zählt über `abschnittOf` zur SHOW-Ansicht; wer im Setup «Load-in» wählt, verliert die Zeile aus dem Bild — deshalb sagt es die Tabelle (`waehleAbschnitt` → `onHinweis`). Wer den Umschalter dynamisch macht, setzt hier an.

Warum: `docs/entscheidungen.md` → «Zwei Ebenen statt zweier Anwendungen», «Der Abschnitt: Setup und Show sind zwei Abläufe DERSELBEN Bühne», «Ein Soundcheck ist ein Zeiteintrag, kein Feld».

## Harte Regeln — Druck

- **Die Tagesblätter sind eine eigene Seite, kein Druckmodus der App:** `print.html` + `js/print.js` + `styles/print.css`, ein A3 quer je Tag. Reihenfolge der Entscheidungen: **Auswahl → Zeitfenster → Blatt.** Das Wegklicken von Gewerken steuert den MASSSTAB; das Fenster gilt über alle gewählten Blätter gemeinsam. Zuschnitt `tagesScheiben` DOM-frei in `schedule.js`; über Mitternacht laufende Vorgänge stehen auf beiden Blättern, angeschnitten.
- **Auf dem Blatt steht kein Text IM Balken.** Name, Zeit, Notiz stehen in der Namensspalte. Schriftgrößen hängen an der Zeilenhöhe (`--pr-titel`/`--pr-notiz`); die Notizzeile fällt weg, bevor sie unlesbar wird.
- **Das Running-Order-Blatt kennt den Abschnitt** (Setup · Show · beides, wie die App; Kopf und Fuß nennen ihn; `?abschnitt=` steuert von außen). Bauzeitenplan-Blätter zeigen Gewerke, nie Bühnen.
- **Das Running-Order-Blatt ist eine LISTE, kein Zeitstrahl** (`roBlatt` in print.js). **Leere Felder drucken als Linie.** Zeilenhöhe GEWICHTET (Umbauzeilen 0,62).
- **`Element.append()` gibt `undefined` zurück:** erst anlegen, füllen, dann anhängen (nie `wrap.append(el(…)).lastChild`).

Warum: `docs/entscheidungen.md` → «Die Tagesblätter sind eine eigene Seite, kein Druckmodus der App», «Auf dem Blatt steht kein Text IM Balken».

## Harte Regeln — Oberfläche und Bedienung

- **Tabelle: ein `render()` wartet, solange in dem Feld getippt wird, das ihn ausgelöst hat** (sonst Fokusverlust, «0930» → «08:09» bei `<input type="time">`). Nachgeholt beim `focusout`; wandert der Fokus in ein anderes Feld derselben Tabelle, zieht er mit. **Nur das AUSLÖSENDE Feld** (sonst verschluckt sie ein ⌘Z). Fokus wiederherstellen und `document.activeElement` sofort prüfen gehen nicht.
- **In der Tabelle nur an `change` hängen, nie zusätzlich an `blur`.** Handler lesen den Stand frisch aus dem Store (`cur(id)`), nie aus der Closure.
- **Ein Kasten, der über der Tabelle schwebt, merkt sich seine Position BEIM ÖFFNEN:** `platziere()` nimmt ein Rechteck, keinen Knoten.
- **Die Tabelle bleibt EIN Modul.** Getrennt sind die SPALTENSÄTZE (`SPALTEN.bau`/`SPALTEN.show`). Im Showablauf `c-start`/`c-end` 112 statt 175 px (`datetime-local`).
- **Die Oberfläche kennt DREI Ansichten, das Datenmodell zwei Ebenen plus Abschnitt.** EIN Umschalter — Bauzeitenplan · Setup · Show —, genau einer gedrückt. `app.js` hält `ansicht` und leitet `ebene`/`abschnitt` ab (`ebeneVon`, `abschnittVon`); `setAnsicht()` ist der einzige Schreiber aller drei. `?ansicht=bau|setup|show` steuert von außen; `?ebene=`/`?abschnitt=` werden weiter übersetzt. «alle» gibt es nicht mehr; der Durchlass lebt in `imAbschnitt`.
- **Zwei gleich aussehende Segmentgruppen nebeneinander sind EINE Gruppe.** Eine weitere `.seg` neben eine bestehende nur, wenn sichtbar abgesetzt, sonst zusammenlegen. Die Reiter im Einrichten-Fenster (`.ein-reiter`) stehen allein in ihrer Zeile.
- **Die Schiene links trägt den MODUS — und sonst nichts** (`js/rail.js`): Bauzeitenplan, Showablauf, Einrichten; genau einer der beiden Modi aktiv. **Sie rendert nur** und meldet über Rückrufe (`on.modus`/`on.einrichten`) nach app.js; `setAnsicht()` bleibt einziger Schreiber. **Nichts Wachsendes hinein** (keine Tage: eine Liste, die mit der Plangröße wächst, gehört nicht in eine feste schmale Spalte).
- **Der Tag wird über den Kalender-Knopf gewählt, angeboten wird NUR, was im Plan steht** (`tagWahl`/`planTage` in app.js; Quelle `programmTage(sichtTasks(state, ebene))`). **EIN Knopf für beide Modi** (Bauzeitenplan: Achse springt; Showablauf: Showtag). **Gewählt wird über `openMenu` (js/menu.js)**, kein neuer schwebender Kasten; `.mn` ist gedeckelt (`max-height: 62vh`). **`syncTagKnopf()` ist der einzige Schreiber** von Beschriftung UND Sichtbarkeit (Bauzeitenplan nur in der Plan-Darstellung, Showablauf immer).
- **Was im aktiven Modus nichts bedeutet, steht nicht da.** `setAnsicht()` blendet `#seg-abschnitt` außerhalb des Showablaufs und `.hd-zoom` außerhalb von Bauzeitenplan+Plan-Darstellung aus; `syncBuehnen()` zeigt Bühnen-Häkchen nur im Showablauf. Gezählt (sichtbare `button`, `input`, `select` in `.hd-bar`, Klassentreffen-Plan mit einer Bühne, ohne Live, ohne Konflikt): **13 im Bauzeitenplan, 11 im Showablauf** (inkl. `#drucken`, Ziel je Modus in `data-href`). Die Zoomstufe ist ein App-Knopf mit `openMenu`, kein `<select>`. Wer einen Knopf hinzufügt, sagt zuerst, in welchem Modus er etwas bedeutet, und blendet ihn im anderen aus; Zahl mit demselben Maß neu zählen.
- **Einrichten ist ein FENSTER über dem Plan, keine Seite** (`#ein-dlg`, vier Reiter über eine `.seg`; `projektEinpassenAusstehend` fängt Breite 0 ab). Ein Knopf im Fenster liegt in EINEM Reiter; ein Prüfwerkzeug klickt vorher dessen `[data-ein="…"]`.
- **Die Knöpfe sind dieselben Elemente, nur umgezogen — keine zweite Verdrahtung.** `#export`, `#import`, `#new-proj`, `#proj-menu`, `#add-gewerk`, `#theme-toggle` behalten ids und Handler (`mount()`/Modulebene); im Fenster je Reiter eine `.ei-sec` mit `data-ein-tab`. Prüfwerkzeuge klicken vorher `#rail-ein` UND den Reiter (`[data-ein="baender"]` für `#add-gewerk`); `tools/verify-edit.mjs` macht das vor.
- **Verwalten-Kästen lassen sich von außen öffnen:** `table.openVerwalten(opt, ankerEl)`, `table.openNeuFragen(opt, ankerEl, fertig)` — die Kasten-Logik nie ein zweites Mal schreiben.
- **Personal und Maschinen stehen in DERSELBEN Verwalten-Liste** (`reorderAuswahl` verlangt ALLE ids); Kürzel je Zeile (`tb-verw-kind`, 👤/⚙). Anlegen getrennt: «+ Personal»/«+ Maschine» in Einrichten (`addRessource` braucht `kind`).
- **Niemals `window.prompt`/`confirm`/`alert` — immer die eigenen App-Dialoge.** Bestätigung: `askDialog({title, message, buttons})` (app.js, liefert `value`, `null` bei Abbruch). Namenseingabe mitten im Tippen: Kasten `tb-neuart` (`neuFragen` in table.js, exportiert als `table.openNeuFragen(opt, ankerEl, fertig)`; neben `cmd` auch `buildCmd(wert, kompakt)`, z. B. `addGewerk` in `gewerk.name`).

Warum: `docs/entscheidungen.md` → «Ansicht und Einrichten: zwei Bereiche, kein zweiter Zustand», «Die Tabelle wartet mit dem Neuaufbau, solange getippt wird».

## Harte Regeln — Personal und Maschinen

- **Eine Zuweisung ist `{Bezeichnung, Anzahl, Zeitfenster}`:** `t.res = [{rid, n, von, bis}]`. `von`/`bis` = `null` heißt «der ganze Vorgang»; gesetzt MÜSSEN sie innerhalb der Vorgangsdauer liegen (`setTaskRes` in store.js). Bezeichnungen stehen in `project.ressourcen` (`kind: 'personal'|'maschine'`) und reisen im Export mit; Verwaltung über `addRessource` plus die drei Auswahlbefehle mit `liste:'ressourcen'`. **Keine eingebauten Bezeichnungen.** `res` MUSS durch `addTask`.
- **Eine Bereitstellung ist ein ganz normaler Vorgang:** `t.bereitstellung: true` = POOL, seine `res` sind Angebot (`bedarfsRaster` in resources.js). `addDep` lehnt ihn als Quelle UND Ziel ab; `findConflicts`/kritischer Pfad nehmen ihn aus; `setTaskField` verweigert `bereitstellung: true`, solange Verknüpfungen bestehen.
- **Die Deckungslücke wird NUR gemeldet, wenn der Vorgang überhaupt eine Zuweisung dieser Art hat:** `deckung(t, kind, state)` (resources.js) liefert sonst `null`. Gerechnet je KIND, nicht je Bezeichnung. Die Lücke ist kein Konflikt und steht nicht in der Prüf-Liste; sie steht am Balken (`bz-bereit`, Panel) im Klartext, ohne Alarmfarbe.

Warum: `docs/entscheidungen.md` → «Personal & Maschinen: Anzahlen statt Namen, Bereitstellung als Vorgang».

## Sync und Offline

**Local-first.** Der Plan lebt in `localStorage`; das private Daten-Repo `M4dm0nky/Bauzeitenplan-Daten` (`main`, `projekte/<project.id>.json`, Inhalt = `serialize(plan)`) gleicht Geräte ab, ist nicht die Wahrheit. **Ohne eingetragenen Schlüssel verhält sich die App exakt wie vorher** (alle anderen `verify-*` laufen ohne).

- **Der Schlüssel liegt nur in `localStorage` unter `bzp_sync`** (`{token, repo}`), nie im Plan, Export oder Repo. `tests/run.mjs` sperrt `bzp_sync` in `persistence.js`.
- **Sync-Metadaten (`remoteSha`, `dirty`) stehen im Projekt-Index** (`bzp_projects`), nie im Plan.
- **`js/sync.js` ist DOM-frei**, `fetch` wird hereingereicht (`createSync`). Die Entscheidung je Projekt trifft `abgleich()`; app.js führt nur aus.
- **Jeder GitHub-Abruf mit `cache:'no-store'`** (sonst Scheinkonflikt durch alte sha). **Base64 über `TextEncoder`**, nie `btoa` auf dem String («Bühne», «👤»).
- **Ein Konflikt wird nie still aufgelöst:** `askDialog` mit drei Knöpfen, einer «Beide behalten (Kopie)» (Kopie heißt «… (anderes Gerät)»). Offenes Projekt neuer von außen und lokal nicht `dirty` → ersetzt, mit Toast, ohne Dialog. Auf einem Gerät gelöscht, auf dem anderen `dirty`: behalten und neu hochladen. Arbeit geht nie verloren.
- **Hochgeladen wird gebündelt:** frühestens 10 s nach dem letzten Speichern, sofort bei `visibilitychange → hidden` und Projektwechsel. Ein übersprungener Durchlauf löst höchstens EINEN sofortigen zweiten aus.
- **Kein Netz oder falscher Schlüssel bricht den Start nie.** `#sync-state` wird gelb bzw. rot, die App läuft lokal weiter.
- **Der Service Worker ist network-first** (siehe Deploy). Wer eine Datei anlegt oder löscht, pflegt `HUELLE` mit.
- **Prüfen:** `tools/verify-sync.mjs` fälscht die GitHub-API per Route. `--echt` läuft gegen das echte Repo (`BZP_TOKEN` in der Umgebung, nur «Zwei Geräte» + Aufräumen); Token fine-grained, nur dieses Repo, *Contents: Read and write*.

## Aus Crewplaner gelernt — für den Tag, an dem ein Backend kommt

- `project_id` & Co. als **Text**, niemals als Relation (Coolify-Reimport kippt Relations). E-Mails immer `.toLowerCase()` speichern und filtern (PB-Filter sind case-sensitive).
- API-Rules nach jedem Coolify-Redeploy prüfen (fallen auf `auth != ""` zurück). Kein Bundle-File; ES-Module mit `?v=`-Cache-Bust.
- UI-Verstecken ist keine Sicherheit — Rollen serverseitig über API-Rules erzwingen.

## Aufbau

| | |
|---|---|
| `js/gantt.js` | Render-Engine: DOM, Zoom, Pfeile, Tooltip, Minimap |
| `js/schedule.js` | CPM, Topo-Sort, kritischer Pfad — **DOM-frei** |
| `js/timeaxis.js` | Zeit ↔ Pixel, Zoomstufen, Ticks, KW — **DOM-frei** |
| `js/app.js` | Verdrahtung; bewusst dünn |
| `js/store.js` | Zustand + Befehle + Undo — **DOM-frei** |
| `js/conflicts.js` | Konflikte + Dauer-Kurzform — **DOM-frei** |
| `js/persistence.js` | localStorage, Export/Import — **DOM-frei** |
| `js/table.js` | Tabellen-Editor |
| `js/templates.js` | Vier Vorlagen + leerer Plan (`TEMPLATES` hat fünf Einträge) |
| `js/palette.js` | 10 Farbtöne × 2 Schraffuren = 20 Gewerke (HUES=10, MAX_SLOTS=20) |
| `js/ebene.js` | Bauzeitenplan ↔ Showablauf: Bänder, Showtage, Typ-Hinweis — **DOM-frei** |
| `js/resources.js` | Personal & Maschinen: Bezeichnungen, Deckung, Bedarfsraster — **DOM-frei** |
| `js/live.js` | Verzug, laufende Vorgänge, Versatz (`verschoben`, `versatzText`) — **DOM-frei** |
| `js/inspector.js` | Seitenpanel |
| `js/menu.js` | Kontextmenü (Muster: Crewplaner dropdown.js) — trägt auch die Tageswahl |
| `js/bedarf.js` | Bedarfsansicht: Personal- oder Maschinenbedarf (Unterwahl in der Leiste) |
| `js/rail.js` | Die Schiene: der Modus, drei Einträge — rendert nur |
| `js/sync.js` | GitHub-Contents-Client + `abgleich()` — **DOM-frei** |

Warum was so ist: `docs/entscheidungen.md`. Der kritische Pfad hat eine nicht offensichtliche Regel (verankerte Senken fallen aus dem minFloat), dort begründet und durch Regressionstests abgesichert.

## Fahrplan

Offene Punkte stehen in den GitHub-Issues von M4dm0nky/Bauzeitenplan, nicht in dieser Datei.

**PocketBase liegt auf Eis:** Login-/Rollenschicht seit v0.8.0 nicht in `main`; Stand im Branch `pocketbase-vorbereitung`, wird nicht deployt und nicht gemergt.

**Vorlagen:** «festival» ist abgenommener Praxisstand; Tour, Corporate und Messe sind Gerüste — beim ersten echten Einsatz korrigieren.

## Gestartete Prozesse IMMER wieder beenden
Alles, was ich oder Subagenten starten (Hintergrundbefehle, Server, Mitschnitte, Watcher, Builds), beende ich, sobald es seine Aufgabe erfüllt hat. Nach Abbruch oder Timeout und am Sitzungsende prüfe ich auf verwaiste Prozesse und beende sie gezielt. Details: `C:\Dropbox\Incomming\github\CLAUDE.md`, Abschnitt „Gestartete Prozesse IMMER wieder beenden“.
