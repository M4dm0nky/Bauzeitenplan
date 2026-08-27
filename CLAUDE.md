# Bauzeitenplan — Arbeitsanweisungen

Gantt-Ablaufplan für die Veranstaltungsbranche. Vanilla JS, ES-Module, **kein Build-Step**.
Projekte leben im Browser (localStorage) + JSON-Export. Kein Backend, keine Anmeldung.

**Live:** https://m4dm0nky.github.io/Bauzeitenplan/ · **Repo:** M4dm0nky/Bauzeitenplan · **Version:** siehe unten

## Vor jeder Änderung

```bash
node tests/run.mjs              # Unit-Tests + statische Prüfungen
node tools/verify-browser.mjs   # Darstellung: App + 4 Prototypen
node tools/verify-edit.mjs      # Bearbeiten: anlegen, tippen, Undo, Panel, Menü
node tools/verify-live.mjs      # Live-Modus mit gestellter Uhr
node tools/verify-amk.mjs       # AMK-Plan importieren
node tools/verify-klassentreffen.mjs   # V07-Plan + Autostart über die Adresse
node tools/verify-print.mjs     # Tagesblätter A3: Zuschnitt, Filter, Maßstab
node tools/verify-showablauf.mjs # Showablauf: Ebene, Bühnen, Live-Kopfzeile, Blatt
```

Beides muss grün sein, bevor etwas als fertig gilt. `verify-browser.mjs` braucht
einmalig `npx playwright install firefox`.

**Screenshots ansehen, nicht nur die Häkchen zählen.** Ein Dutzend echter Fehler
hat in diesem Projekt die automatischen Prüfungen passiert und wurde erst im Bild
sichtbar: Pfeile quer über die Gewerk-Spalte, unsichtbare Phasennamen,
Beschriftungen ohne Balken, eine auf „J" zusammengeschnurrte JETZT-Fahne, zehn
Zeilen ohne Balken im Showablauf, «Changeover: Changeover», ein Platzhaltertext in
siebzehn Tabellenzeilen, der wie eingetragener Inhalt aussah, ein Showtag, der nur
zwei Drittel des Bildes füllte, eine links angeschnittene Datumszeile, ein
«12:00 Uhr», bei dem das «Uhr» in eine zweite Zeile rutschte, ein Zoom-Umschalter
auf «Monate» über einer Stundenachse, und ein Soundcheck, den die Vorgabe auf
19:40 setzte — eine Stunde vor den Act statt an den Nachmittag. Für jeden gibt es
jetzt eine Prüfung — der nächste Fehler dieser Art hat aber noch keine.

**Neue Bausteine gehören in die `needed`-Liste in `tests/run.mjs`.** Sonst kennt
sie nur das Theme, in dem sie entstanden sind, und in den vier anderen fehlen sie
unsichtbar. Genau das ist der Showablauf-Ebene passiert.

Zum Starten: `python3 -m http.server 8080`. Ohne Server blockiert der Browser die
ES-Module per CORS.

## Deploy

`git push origin main` → GitHub Pages zieht ~1 Minute später nach. Kein Build, kein
Workflow, Quelle `main` / `root`. Danach **live gegenprüfen**, nicht nur lokal:

```bash
node tools/verify-browser.mjs --base https://m4dm0nky.github.io/Bauzeitenplan/
```

**Vor dem Deploy: `node tools/version.mjs <neu>`.** Das setzt auch alle `?v=`.
Von Hand hochzählen ist nicht mehr nötig und wird vom Testlauf bestraft.
`sw.js` (Cache-Buster) fängt die Untermodule ab, greift aber erst ab dem
zweiten Aufruf — deshalb beides.
Warum er nötig ist: `app.js` importiert `./gantt.js` ohne Version, und Pages sendet
`max-age=600` — ohne ihn kämen Änderungen an Untermodulen zehn Minuten lang nicht an.
Der Worker cacht selbst nichts und kann deshalb nie eine alte Version einsperren;
Kill-Switch steht in `sw.js`.

`~/.local/bin/gh` ist installiert (nicht im PATH — mit vollem Pfad aufrufen).
Angemeldet als **M4dm0nky**. Das Repo liegt bewusst dort und nicht unter `Aniflu`:
Aniflu ist ein fremdes persönliches Konto, dort kann M4dm0nky weder Repos anlegen
noch Pages einschalten (nur `push`, kein `admin`).

## Version

**Aktuell: 0.7.1** · `CHANGELOG.md` hält die Historie, nicht diese Datei.

**Die Version wird NIE von Hand geändert.** Ein Befehl stempelt sie in alle
sechs Stellen zugleich:

```bash
node tools/version.mjs          # zeigt die aktuelle
node tools/version.mjs 0.2.0    # setzt sie überall + Changelog-Abschnitt
```

Betroffen: `js/version.js` (Quelle) · `package.json` · `index.html` **und
`print.html`** (alle `?v=`) · `sw.js` (`SW_VERSION`) · `CHANGELOG.md`. Kommt eine
weitere HTML-Seite dazu, gehört sie in `tools/version.mjs` UND in die
Versionsprüfung in `tests/run.mjs`. **Die Nummer entscheidet Marco** — und zwar
VOR dem Stempeln gefragt, nicht danach mitgeteilt —, nicht
die Automatik. Rückschritte und Nicht-SemVer lehnt der Befehl ab — eine Version
zurückzudrehen bricht den Cache-Schutz.

Nach dem Push ein **annotierter** Tag (`-a`, nicht leichtgewichtig — ein Tag
ohne Autor und Datum ist ein Zettel ohne Absender):

```bash
git tag -a v0.2.0 -m "…" && git push origin v0.2.0
```

Tags sind schwer zurückzunehmen — **erst nach Rückfrage setzen.**

`node tests/run.mjs` prüft, dass alle Stellen übereinstimmen und dass der
Changelog einen Abschnitt für die aktuelle Version hat. Das ist der Unterschied
zu Crewplaner: dort verlangt CLAUDE.md, in fünf Dateien von Hand hochzuzählen
(drei unabhängige Zähler: `?v=23`, `?v=12`, `?v=38`) — geprüft wird nichts.
Vergisst man eine, sieht der Nutzer alten Code und niemand merkt es.

**Nebenwirkung jedes Versionswechsels:** `sw.js` ändert sich → der Browser
installiert den neuen Worker → `controllerchange` in `index.html` **lädt offene
Tabs neu**. Daten sind sicher (Auto-Save nach 800 ms), aber der Live-Modus
springt kurz. Beim Aufbau mit dem Plan auf dem Monitor also nicht grundlos
deployen.

## Harte Regeln

**Gewerk-Farben (`styles/base.css`, `--gw-*`) nicht per Hand ändern.**
Reihenfolge und Zuordnung sind das Ergebnis eines Suchlaufs über 720 Varianten
(`tools/farbsuche.mjs`), der die CVD-Unterscheidbarkeit benachbarter Zeilen maximiert.
Handanlegen macht die Validierung wertlos. Neu rechnen statt raten.

**Neben jedem Farbton steht seine SCHRIFTFARBE (`--gw-t-*`), und die ist ebenfalls
gerechnet.** Gefüllte Balken tragen ihre Beschriftung auf der Farbe, und die
Beschriftung ist die vorgeschriebene sekundäre Kodierung — sie muss lesbar sein.
Weiß erreicht auf Gelb nur **2,17:1**, dunkle Tinte dagegen 8,23:1; auf Violett,
Grün und Ocker ist es umgekehrt. Gewählt ist je Ton die Tinte, die in **hell UND
dunkel** über 3:1 bleibt — deshalb feste Werte ohne Dunkel-Scope. Wer an `--gw-*`
dreht, muss hier mitrechnen; die statische Prüfung «Schrift auf Gewerkfarbe hält
3:1» in `tests/run.mjs` schlägt sonst an.

**Die Farbe eines PROGRAMMPUNKTS ist wählbar, die eines GEWERKS nicht.** Im
Showablauf trägt ein Vorgang ein eigenes `slot` (null = erbt die Farbe seiner
Bühne); die Auswahl im Panel bietet zehn Töne und einen Schalter für Schraffur —
ein Farbplatz IST das Paar aus beidem (`slotAus`/`hueVon` in palette.js), deshalb
reichen zehn Punkte für zwanzig Kombinationen. Gewählt wird AUS der Palette, nie
eine freie Farbe. Im Bauzeitenplan bleibt die Zuordnung gerechnet: dort stehen 20
Gewerke untereinander, und genau dafür ist die Farbsuche gemacht.

**Balkenbeschriftung nicht entfernen.** Rigging, Licht und Ton liegen auf hellem
Grund unter 3:1 Kontrast. Die Beschriftung ist die vorgeschriebene sekundäre
Kodierung — ohne sie hängt Identität an der Farbe allein.

**Zeiten immer aus echten Zeitstempeln rechnen** (`toMin()`), nie aus Ziffern auf
Datumsstrings. Sonst ist die Dauer über den Sommerzeit-Sprung falsch — ein Bug, der
genau einmal im Jahr zuschlägt.

**Zoomstufen in sichtbarer Zeitspanne bemessen**, nicht in Pixeln. Eine
„Tages"-Ansicht muss Tage zeigen. Die Tests setzen das durch.

**Themes: Gestaltung gehört in `styles/themes/`, Geometrie in `base.css`.**
Kein Theme definiert Gewerk-Farben neu. Jedes Theme braucht beide Dunkel-Scopes
(`@media prefers-color-scheme` **und** `:root[data-theme="dark"]`) — der Umschalter
des Betrachters muss die OS-Wahl in beide Richtungen schlagen. Details: `docs/themes.md`.

**Rechenlogik bleibt DOM-frei.** `schedule.js`, `timeaxis.js`, `store.js`,
`conflicts.js` und `persistence.js` haben keinen DOM-Bezug und sind damit direkt
testbar. So halten. Neue Logik dort → Test dazu.

**Der Store ist der einzige Weg, den Plan zu ändern.** Nie direkt an `state`
schreiben. Validierung läuft VOR der Änderung; ein abgelehnter Befehl darf
nichts hinterlassen — kein halber Zustand, kein Undo-Eintrag, keine
Ungesichert-Marke. Rückgängig läuft über Schnappschüsse, nicht über
Gegenbefehle: ein Plan wiegt wenige zehn kB, aber jeder handgeschriebene
Gegenbefehl wäre eine Fehlerquelle, die erst Stunden später beim ⌘Z auffällt.

**Schraffur gehört der Gewerk-Identität** (Platz 9–16), nicht dem Status. Sie war
früher für `status: geplant` belegt — das ist jetzt ein umrandeter Balken. Nicht
zurückdrehen, sonst bedeutet dasselbe Muster zwei Dinge.

**In der Tabelle nur an `change` hängen, nie zusätzlich an `blur`.** Das erste
`change` baut die Tabelle neu, der alte Knoten wird abgehängt und feuert danach
trotzdem sein `blur` — mit dem veralteten Objekt aus der Closure. Jede Änderung
lag dadurch doppelt auf dem Undo-Stapel und ⌘Z wirkte kaputt. Handler lesen den
Stand immer frisch aus dem Store (`cur(id)`), nie aus der Closure.

**Die Jetzt-Linie tickt IMMER**, nicht nur im Live-Modus (`startTicking()` in
gantt.js, alle 15 s). Sie hing früher an `syncState()` und stand nach dem Laden
still — bei einem Plan, der beim Aufbau auf dem Monitor läuft, ist eine falsche
Linie schlimmer als keine. Der Tick ruft bewusst **kein** `layout()`: das baute
jede Minute den DOM neu und risse die Auswahl weg. Nur `paintNow()`/`paintLive()`.

**Status wird nie automatisch gesetzt.** Der Verzug (`js/live.js`) entsteht genau
daraus, dass die menschliche Aussage «geplant» der Uhr widerspricht. Schaltete
etwas automatisch um, sähe der Plan immer nach Plan aus — und das Signal wäre weg.

**`reorderGewerk` darf `slot` nicht anfassen.** Farbe gehört dem Gewerk, nicht
seiner Position; sonst färbt sich beim Sortieren der halbe Plan um. Ein Test
prüft das.

**Der Autostart lädt die JSON, die JSON ist die Wahrheit.** `boot()` holt beim
Start `klassentreffen-festival.json` (`BUNDLED`/`START` in app.js). Neuer Planstand
= Datei austauschen und pushen, sonst nichts. Ob nachgeladen wird, entscheidet der
`exported`-Stempel aus `serialize()`, mitgeführt in `project.quelle`: Datei neuer →
Datei gewinnt, gleich → lokale Fassung bleibt (sonst verlöre der Betrachter bei
jedem Laden seine Änderungen), nicht erreichbar → lokal. **`?plan=leer` schaltet
den Autostart ab** — ohne diesen Schalter hätten `verify-browser`, `verify-edit`,
`verify-live` und `verify-amk` keinen Erststart-Dialog mehr, an dem sie alle hängen.
Wer am Autostart dreht, muss die vier Werkzeuge mitdenken.

**Was der erste Start braucht, gehört auf Modulebene — nicht in `mount()`.**
`mount()` läuft erst, wenn ein Projekt offen ist. Der Import hing dort und war
beim allerersten Start tot: der Dialog bot ihn an, der Knopf tat nichts, ohne
Fehlermeldung. Wer die App frisch öffnet, konnte nichts importieren.

**Der AMK-Plan ist quellentreu** (`tools/make-amk.mjs`). Was im PDF steht, steht
dort; was geschätzt ist, trägt `estimated: true` und eine gestrichelte Kante; wo
das Gewerk im Original leer war, sagt es die Notiz. Nur DREI Verknüpfungen —
die eine, die wörtlich im PDF steht («Leitern runter → sobald Backline und Set
weg»), plus die Kopplung der aufgeteilten «Rigging/Set»-Zeile. **Keine
Abhängigkeiten dazuerfinden**: ein erfundenes Netz erzeugt rote Konflikte, die
mit der Wirklichkeit nichts zu tun haben. `tests/amk.test.mjs` hält das fest.

**`js/dom.js` ist der Ort für DOM-Kleinkram** (`el`, `svgEl`, `$`, `escapeHtml`,
`toInput`, `STATUS`). Lag vorher fünfmal identisch herum. **Nicht** dort hin
gehört `clone` — der Store dürfte dafür nicht auf persistence.js zeigen (Kern →
äußere Schicht wäre der falsche Pfeil), und für eine Zeile ist die Wiederholung
billiger als eine schlechte Abhängigkeit.

**Wer `js/` um einen Import erweitert, muss `tools/build-prototypes.mjs`
mitpflegen.** Die Modulliste dort steht an EINER Stelle (`FILES`) und ist zugleich
die Bauanleitung: Abhängigkeit vor Verwender. Der Build prüft seit dem
`el`-Vorfall auf **fehlende** und auf **doppelte** Namen — vorher nur auf doppelte,
weshalb `live.js` monatelang ungebündelt blieb und die Prototypen nur deshalb
liefen, weil `runningAt` ausschließlich im Live-Modus gerufen wird.

**Ein Zustand, ein Besitzer.** `#ins.hidden` hatte vier Schreiber (zwei in
app.js, zwei in inspector.js) — und inspector.js kannte die Ansicht nicht, also
holte jede Änderung das Panel in der Tabellen-Ansicht zurück. Der Inspector
entscheidet jetzt nur über seinen INHALT, `syncPanel()` in app.js allein über
die Sichtbarkeit.

**Kein Cache in `computeSchedule`.** Er müsste auf Objekt-Identität schlüsseln,
und wer Vorgänge in dieselbe Array-Instanz schiebt (Tests, `tools/make-amk.mjs`),
bekäme still ein veraltetes Ergebnis. Stattdessen wurde die Zahl der AUFRUFE
gesenkt: `findConflicts(state, vorab)` nimmt eine fertige Rechnung an, `app.js`
holt die Liste über `gantt.conflicts()`. Von 5 Läufen pro Änderung auf 2.
Gemessen: 500 Vorgänge = 3,4 ms pro Lauf.

**Untervorgänge: der Elternvorgang ist die HÜLLE, nicht editierbar.** Ein
Untervorgang ist ein Vorgang mit `parent` (Text-id, nie Relation) und demselben
Gewerk wie sein Elternvorgang. `reflowParents(state)` läuft nach JEDER Änderung in
`store.apply` und setzt Eltern-`start`/`end` auf frühesten Kindstart … spätestes
Kindende — damit `schedule.js`, `conflicts.js` und `persistence.js` konsistente
Werte sehen. Kein Cache. Eltern-Zeiten von Hand setzen, Sammelvorgänge verschieben
oder zum Meilenstein machen wird abgelehnt (Tabelle sperrt die Felder). **Nur EINE
Ebene** (in `addTask` erzwungen), sonst genügte ein reflow-Durchlauf nicht.
Elternvorgang löschen kaskadiert auf die Kinder; Gewerkwechsel zieht sie mit.
`findConflicts` nimmt Sammelvorgänge AUS — ihre Lage ist abgeleitet, nicht direkt
verschiebbar, und ein Konflikt an ihnen risse den Auflösen-Sammelbefehl.

**Die Tagesblätter sind eine eigene Seite, kein Druckmodus der App.**
`print.html` + `js/print.js` + `styles/print.css` rendern ein A3 quer je Tag. Der
Gantt ist EIN Scroll-Container; ihn zu zerschneiden hieße, gantt.js umzubauen.
Reihenfolge der Entscheidungen: **Auswahl → Zeitfenster → Blatt.** Das Wegklicken
von Gewerken steuert auch den MASSSTAB — an einem Aufbautag zwingt allein die
Objektbewachung (00:01–23:59) das Blatt auf 24 h, ohne sie sind es 08:00–18:00.
Das Fenster gilt über alle gewählten Blätter gemeinsam, sonst sind sie nicht
vergleichbar. Der Zuschnitt (`tagesScheiben`) liegt DOM-frei in `schedule.js`;
über Mitternacht laufende Vorgänge stehen auf beiden Blättern, angeschnitten.

**Auf dem Blatt steht kein Text IM Balken.** Er läge über der Schraffur, stünde
bei dunklen Gewerkfarben schwarz auf dunkel und würde bei schmalen Balken
abgeschnitten — alles drei auf dem ersten Probedruck gesehen. Name, Zeit und
Notiz stehen in der Namensspalte, die auf Papier ohnehin immer daneben liegt.
Schriftgrößen hängen an der Zeilenhöhe (`--pr-titel`/`--pr-notiz`); die Notizzeile
fällt weg, bevor sie unlesbar wird, statt die Zeile darüber anzuschneiden.

**Jede ausgelieferte HTML-Seite gehört in `tools/version.mjs` UND in die
Versionsprüfung in `tests/run.mjs`.** Beide kannten anfangs nur `index.html` —
eine zweite Seite mit eigenen `?v=` wäre still auseinandergelaufen. Genau der
Crewplaner-Fehler, der weiter unten als Gegenbeispiel steht.

**Im BAUZEITENPLAN zeigt der Gantt eine Zeile je VORGANGSNAME, einen Balken je
Termin** (`seriesRows` in schedule.js, DOM-frei und getestet). Ein Bauzeitenplan
wird tageweise gedruckt, deshalb steht dieselbe Tätigkeit mehrfach in der Quelle —
das sind keine verschiedenen Vorgänge. Ohne die Bündelung hatte die Bühne sechs
Zeilen für drei Dinge und die Crew 113 für 28; 353 Vorgänge ergeben **153 Zeilen**.
Überlappen sich zwei Termine einer Serie, bekommen sie **Spuren** (`--lane`,
Zeilenhöhe `rowH × lanes`) — sonst lägen sie übereinander. Marken (Konflikt, KRIT)
gelten für die Zeile als Ganzes, Umbenennen benennt die ganze Serie um. **Die
Tabelle bleibt flach**: sie ist der Editor, dort gehört jeder Termin einzeln
bearbeitbar. Beide Ansichten sortieren weiter über `byStart`.

**Im SHOWABLAUF sind die Balken GEFÜLLT**, im Bauzeitenplan umrandet. Der
Grundzustand `.bz-bar` ist ohnehin gefüllt; nur `bz-st-geplant` macht ihn
transparent, und im Showablauf steht alles auf «geplant», weil dort niemand den
Status pflegt — der ganze Abend sähe leer aus. Was gerade läuft, sagen die
Jetzt-Linie und die Live-Kopfzeile. Umgesetzt über `.bz[data-ebene="show"]` in
den Themes (Füllung ist Gestaltung, gehört nicht in base.css); `gantt.js` setzt
nur `data-ebene` und die beiden Variablen `--gw`/`--gw-t`.

**Im SHOWABLAUF wird NICHT gebündelt** (`buendeln` in gantt.js). Dort ist die
Reihenfolge der Zeilen der ABLAUF selbst — Einlass, Band, Umbau, Band, Umbau —,
und den liest man von oben nach unten. Gebündelt entstand daraus eine Zeile
«Changeover» mit sechs Balken, die zwischen den Acts hing, und die Zeilenfolge
richtete sich nach dem frühesten Termin jeder Serie statt nach dem Abend. Jeder
Programmpunkt trägt seine eigene Zeile, `lanes` ist immer 1: zwei gleichzeitige
Dinge auf einer Bühne sind zwei Zeilen, keine Spuren. **Uhrzeit und Dauer stehen
links vor dem Namen** (`bz-lab-zeit`/`bz-lab-dauer`, beide mit fester Breite und
`tabular-nums`, damit die Namen auf einer Kante beginnen) — damit ist die
Seitenspalte allein schon der Ablaufplan: `14:00 Uhr (30 min) CREUTZFELD & JAKOB`.
**Die Dauer in MINUTEN**, nicht in «0,5 h»: bei einem Ablauf zählt man Minuten.
Ein Meilenstein bekommt einen Strich, keine Null. Im Bauzeitenplan wäre beides
falsch: dort stünde eine Uhrzeit stellvertretend für mehrere Termine.
`seriesRows` bleibt unangetastet — die Funktion ist richtig, der Showablauf ruft
sie nur nicht auf.

**Die Seitenspalte ist im Showablauf breiter** (390 px statt 296). Drei Angaben
nebeneinander brauchen Platz, und 17 Zeilen brauchen weniger Zeitstrahl als 153.
Auf Handybreite erzwingt `base.css` 168 px und die Dauer bricht UNTER die Zeile
— beide Textzeilen passen in die vorhandene Zeilenhöhe, die Geometrie ändert
sich nicht. **Deshalb wird die Spaltenbreite am DOM gemessen** (`sideWNow()`),
nicht aus `O.sideW` genommen: sonst rechnet die Tagesansicht auf dem Handy um
über hundert Pixel daneben.

**Die Achse beschriftet im Showablauf JEDE Stunde.** `ticksFor` kennt `'hour'`
längst; `tickScale` wählt es am Bildschirm nie, weil 24 Stunden im Bauzeitenplan
zu dicht stehen. Über zehn Showstunden ist es genau richtig — ein Ablauf wird
nach Uhrzeiten gelesen, nicht nach «zwischen 12 und 15». Erst ab `px >= 0.5`,
sonst kleben die Zahlen aneinander.

**„Tag 1/2/3" gehört nicht in den Titel.** Der 24.08. IST Tag 1 — das sagt das
Datum. Im Namen erzwingt es eine Zeile je Tag und macht aus einer Tätigkeit drei.
Die Tagesnummer gehört in die Notiz. Ein Test hält fest, dass kein Titel auf
`Tag N` endet.

**Beschriftung neben einem Balken darf nie über den nächsten laufen.** Ist ein
Balken zu schmal für seinen Text, steht dieser rechts daneben — in einer Serie
also dort, wo der nächste Balken beginnt. `updateLabels()` blendet ihn dann aus
(`data-next` trägt den Start des nächsten Balkens derselben Spur). Der Name steht
weiterhin links in der Zeile. Eine Prüfung in `verify-klassentreffen.mjs` fängt
Rückfälle — die Zahlenprüfungen sahen diesen Fehler nicht.

**Eine Reihenfolge für beide Ansichten: `byStart` (schedule.js).** Gantt und
Tabelle sortieren Vorgänge eines Gewerks über DENSELBEN Vergleicher (Start, dann
Ende, dann Titel). Nie eine der beiden Ansichten separat sortieren — sonst sieht
derselbe Plan zweimal anders aus und wirkt „nicht gleich".

**Der Verknüpfungs-Picker sucht, statt zu scrollen** (`candidateGroups` in
schedule.js, DOM-frei und getestet). Bei 100+ Vorgängen ist der native Dropdown
unbenutzbar. Die reine Funktion gruppiert nach Gewerk, sortiert je Gewerk über
`byStart` und filtert per Query (Titel/Gewerkname); der Inspector rendert nur ihr
Ergebnis. Neue lange Auswahllisten genauso lösen — nie einen 122-Zeilen-`<select>`.

**Die Oberfläche kennt DREI Ansichten, das Datenmodell zwei Ebenen plus
Abschnitt.** In der Werkzeugzeile steht EIN Umschalter — Bauzeitenplan · Setup ·
Show, in der Reihenfolge des Tages —, und genau einer ist gedrückt. `app.js` hält
dafür `ansicht` und leitet `ebene`/`abschnitt` daraus ab (`ebeneVon`,
`abschnittVon`); `setAnsicht()` ist der einzige Schreiber aller drei.

Vorher waren es zwei Umschalter (Ebene und Abschnitt) im selben Stil
nebeneinander, mit je einem dunklen Knopf. Das las sich als EINE Leiste, in der
zwei Dinge gleichzeitig angewählt sind — und niemand fand, wie man zwischen
Setup und Show wechselt. **Zwei gleich aussehende Segmentgruppen nebeneinander
sind eine Gruppe, egal was der Code meint.**

`?ansicht=bau|setup|show` steuert das von außen; die alten `?ebene=`/`?abschnitt=`
werden weiter übersetzt (Lesezeichen, Prüfwerkzeuge, print.html). **«alle» gibt es
in der Oberfläche nicht mehr** — der ganze Showtag in einer Achse ist damit nicht
mehr zu sehen. Der Durchlass lebt in `imAbschnitt` weiter, eine vierte Stufe wäre
also ohne Umbau nachrüstbar.

**Zwei Ebenen, ein Plan — und `js/ebene.js` ist die einzige Stelle, die das weiß.**
Der Bauzeitenplan zeigt GEWERKE, der Showablauf BÜHNEN; eine Bühne ist ein Gewerk mit
`art:'buehne'`, ein Programmpunkt ein normaler Vorgang darin. Kein zweiter Store, kein
zweites Undo, keine zweite Persistenz. Gantt, Tabelle und Druckseite FRAGEN
(`sichtGewerke`/`sichtTasks`/`amTag`), sie entscheiden nicht selbst. Altdaten ohne
`art` sind Gewerke — der Bauzeitenplan sieht aus wie immer. **Ein Gewerk wird nie
nachträglich zur Bühne**: alle Vorgänge darin sprängen die Ebene.

**Farbplätze werden JE EBENE vergeben** (`freeSlot(state, art)` in store.js). Gewerke
und Bühnen sind nie zusammen zu sehen, dürfen also dieselben Farben tragen. Zusammen
gezählt wäre die Palette im Klassentreffen-Plan (20 Gewerke = `MAX_SLOTS`) mit der
ersten Bühne erschöpft. `slotsExhausted` wird entsprechend gegen die Zahl der Bänder
der AKTIVEN Ebene geprüft, nie gegen `gewerke.length`.

**Der ZEITEINTRAG trägt den Abschnitt, nicht die Bühne.** Es gibt EINE Bühne mit
zwei zeitlichen Abläufen — Load-in und Setup bis zum Showstart, die Running Order
danach —, nicht zwei Bühnen. In v0.9.1 hing das Feld am Band; das erzwang den
Namen zweimal, und der Store verbietet doppelte Bühnennamen. Seit v0.9.2 steht
`abschnitt: 'setup'|'show'` am Vorgang, `imAbschnitt` filtert die Einträge, und
**`sichtGewerke` filtert NICHT**: die Bühne bleibt in beiden Ansichten stehen,
auch wenn sie dort noch nichts hat — genau da legt man den ersten Setup-Eintrag
an. Jede Ansicht rechnet ihr Zeitfenster selbst (`programmFenster`): Setup zeigt
den Morgen, Show den Abend. Fehlt das Feld, gilt `show`.

**Ein Soundcheck ist ein ZEITEINTRAG, kein Feld.** Als Feld am Act (`soundcheck`,
bis v0.9.3) war er ein Startzeitpunkt ohne Dauer und ohne Ende — er tauchte in
keiner Zeitachse auf, und zwei sich überschneidende Soundchecks sah niemand. Jetzt
ist er ein normaler Eintrag im Setup-Abschnitt mit `fuer: <taskId>` (Text-id, nie
Relation, wie `parent`). Damit hat er Balken, Dauer, Farbe, Notiz und
Anforderungen geschenkt. Bedient wird er aus dem Panel des Acts — das ist der
bequeme Weg, nicht ein zweiter Speicherort.

**`removeTask` kaskadiert auch über `fuer`.** Wer den Act löscht, löscht seinen
Soundcheck mit; sonst bliebe eine Waise mit toter Zuordnung zurück, die niemand
mehr findet. Dieselbe Begründung wie bei den Untervorgängen, ein ⌘Z holt beides
zusammen zurück.

**Zeitfelder im Showablauf tragen KEIN Datum** — der Tag steht oben im
Umschalter, und zwei Spalten à 205 px für eine Information, die schon dasteht,
drängten die Anforderungen aus dem Bild. Zwei Fallen, beide in reinen Funktionen
in `conflicts.js` gelöst und getestet:

- **`mitUhrzeit` behält den Datumsteil.** Ein Eintrag vom Vortag ist über den
  Tagesfilter auch am Folgetag sichtbar; schriebe das Feld den GEZEIGTEN Tag,
  spränge er beim ersten Antippen einen Tag weit.
- **`endeNachStart`: Ende vor Start meint den Folgetag.** «22:00 bis 03:00» ist
  die selbstverständliche Schreibweise; ohne die Regel lehnte der Store ab. Der
  Folgetag wird über den KALENDER gesucht, nicht mit +1440 — der 25.10.2026 hat
  25 Stunden.

Im **Bauzeitenplan bleiben die Felder datiert**: der läuft über vierzehn Tage.

**Neue Felder müssen durch `addTask` durch.** Der Handler baut das Vorgangsobjekt
Feld für Feld auf; was dort fehlt, fällt beim Anlegen still weg. `abschnitt` hat
genau das erlebt: ein im Setup angelegter Eintrag landete in der Show und war im
gezeigten Abschnitt sofort unsichtbar. Wer ein Feld ergänzt, prüft `addTask` mit.

**Das Wort ist «Zeiteintrag», nicht «Programmpunkt».** Im Showablauf heißt jede
Zeile so — Spalte, Knopf, Zähler, Ecke der Seitenspalte, Vorgabename, Kennzahl.
Ein Line-Check ist kein Programmpunkt. Das DATENFELD heißt weiter `punktTyp`
(eine Umbenennung wäre eine Migration ohne Gegenwert), und auf dem A3-Blatt
bleibt «Programmpunkt» stehen: dort ist die Liste dem PDF nachempfunden.

**Ein leeres Band ist nur im Bauzeitenplan unsichtbar.** Dort stehen 20 Gewerke,
ein leeres wäre Rauschen. Im Showablauf muss es stehen: eine frisch angelegte
Bühne hat noch nichts, und wäre sie unsichtbar, wäre «+ Bühne» ein Klick ins
Nichts. Dasselbe gilt für eine Bühne, die im gewählten Abschnitt leer ist. `Math.min(...[])` ist dabei `Infinity` — die Hülle muss auf `T0` fallen,
sonst zieht sich der Sammelbalken über die ganze Achse.

**Neue Vorgänge landen dort, wo man HINSCHAUT.** `defaultStart()` in table.js
schließt an den letzten Eintrag DES GEZEIGTEN TAGES UND ABSCHNITTS an, nicht an
den letzten des Plans; `addRow` gibt den aktiven Abschnitt mit. Vorher kam bei zwei Showtagen der letzte Punkt des zweiten heraus: wer am
ersten Tag anlegte, bekam es an den zweiten gehängt, und der Tagesfilter blendete
es sofort aus. Der Knopf tat etwas, nur unsichtbar — und das fühlt sich an wie
«geht nicht». Ist der Tag leer, wird 08:00 dieses Tages genommen.

**Der Gantt meldet, wenn er sich von SELBST einpasst** (`O.onView`). Das passiert
an zwei Stellen asynchron: beim ersten Programmpunkt eines leeren Showablaufs und
beim Wiederauftauchen aus der Tabelle (ResizeObserver). Wer die Kopfzeile danach
aktualisieren will — Zoomstufe, Mitteldatum —, kann den Zeitpunkt nicht raten;
ein `requestAnimationFrame` lief zu früh und schrieb den 25.10. ins Datumsfeld.
Aus demselben Grund merkt sich der ResizeObserver eine Breite von **0**: sonst
gilt die Rückkehr aus der Tabelle als «keine Änderung», und ein Zoom, der
währenddessen mit Breite 0 gerechnet wurde, bleibt für immer falsch.

**Der Showablauf ist tagesbezogen.** Ein Umschalter wählt den Showtag; ohne ihn standen
die Acts des zweiten Tages als zehn Zeilen ohne Balken im Bild — genau die Fehlerart,
die hier schon dreimal erst der Screenshot gefunden hat. Gantt und Tabelle bekommen
DENSELBEN Tag gereicht, sonst zeigt derselbe Plan zwei verschiedene Tage.

**Bestand zählt die Sicht, Warnungen zählen den Plan.** `gantt.stats()` meldet Vorgänge,
Bänder, laufend und Crew aus der sichtbaren Ebene — sonst stünden 353 Vorgänge über
einem Blatt mit 17 Zeilen. Kritisch und Konflikte bleiben planweit: sie sind Aussagen
über den Plan, nicht über den Ausschnitt, und müssen zur Prüf-Liste passen, die über
`conflicts()`/`criticals()` ebenfalls alles zeigt. Zwei Zähler nebeneinander wären
genau der Fehler, den die Eine-Quelle-Regel verbietet.

**Verzug in der Live-Kopfzeile zählt nur, was noch aussteht oder läuft.** `delaysAt`
meldet auch längst vergangene, nie abgehakte Punkte; bei DOORS (12:00–14:00, Status
«geplant») stand um 15:30 groß und rot «+4 Std» — an einem Abend, der exakt nach Plan
lief. Das ist keine Verspätung, sondern fehlende Rückmeldung, und es überdeckte den
Verzug, auf den es ankommt. Die Regel «Status wird nie automatisch gesetzt» bleibt
unberührt; gefiltert wird die ANZEIGE, nicht die Rechnung.

**Kein Typ steht doppelt** (`typHinweis` in ebene.js). Ein Programmpunkt «Changeover»
mit `punktTyp:'changeover'` ergab «Changeover: Changeover» in der Kopfzeile und
«Changeover / Changeover» auf dem Blatt. Verglichen wird normalisiert und in beide
Richtungen, damit auch «SHOW END» / «Show-Ende» als dasselbe gilt.

**Achsen-Ticks und Bänder werden auf `T1` geklemmt.** Sie ragten über das Planende
hinaus und machten den Scroller um 1400 px breiter als seinen Inhalt — im
Bauzeitenplan unsichtbar, im Showablauf rutschte der ganze Tag aus dem Bild. Und die
Tagesansicht passt sich neu ein, wenn der Container die Breite ändert: «ein Kalendertag
füllt die Breite» ist eine Zusage, die bei jeder Breite gilt.

**Keine Platzhaltertexte in Freitextspalten.** Ein «z. B. 2× Wedge» in siebzehn Zeilen
sieht aus wie siebzehnmal eingetragener Inhalt; SIDOs echtes «1 Riser 2×1 m» war
darin nicht zu finden. Was die Spalte will, sagt ihre Überschrift.

**Das Running-Order-Blatt kennt den Abschnitt.** Setup und Show sind zwei Abläufe
mit verschiedenen Lesern — wer der Crew den Vormittag in die Hand gibt, will
nicht die Running Order darunter. Die Steuerleiste hat deshalb dieselbe Wahl wie
die App (Setup · Show · beides), der Blattkopf und der Fuß nennen sie, und
`?abschnitt=` steuert sie von außen. Der Bauzeitenplan bleibt davon unberührt:
seine Tagesblätter zeigen Gewerke, nie Bühnen.

**`Element.append()` gibt `undefined` zurück.** `wrap.append(el(…)).lastChild` warf
deshalb, und statt der Meldung «nichts eingetragen» sah man eine leere Seite. Das
stand zweimal in print.js und fiel jahrelang nicht auf, weil es immer mindestens
ein Blatt gab — erst die Abschnitts-Auswahl konnte eine leere Auswahl erzeugen.
Erst anlegen, füllen, dann anhängen.

**Das Running-Order-Blatt ist eine LISTE, kein Zeitstrahl** (`roBlatt` in print.js).
So liest man einen Showablauf: von oben nach unten, Uhrzeit voran. Ein Gantt über zehn
Stunden mit siebzehn Zeilen wäre auf Papier ein Streifenmuster, und die Felder zum
Ausfüllen hätten keinen Platz. **Leere Felder drucken als Linie** — ein leerer Kasten
sieht aus wie ein Satzfehler, eine Linie sagt: hier wird geschrieben. Die Zeilenhöhe
wird GEWICHTET gerechnet (Umbauzeilen zählen 0,62), sonst bleibt ein Viertel leer.

**Abhaken ist eine menschliche Aussage über eine gerechnete Warnung — persistiert,
signaturgebunden.** `ackCrit` (bool) nimmt einen kritischen Vorgang aus der
kritisch-Zahl; `ackConflictMin` (Minuten) akzeptiert eine Konfliktgröße. `findConflicts`
überspringt den Konflikt nur, solange `shortBy <= ackConflictMin + EPS` — wird er
GRÖSSER, meldet er sich wieder (kein stilles Wegdrücken). Läuft über `setTaskField`
(Undo, Persistenz). **Eine Quelle:** Zählung, Prüf-Liste und `resolveConflictsCmd`
lesen alle `findConflicts` — nie einen zweiten Zähler danebenstellen. „Kritisch" bleibt
Information (kein automatisches Verschieben), nur die Sichtbarkeit wird abhakbar.

## Aus Crewplaner gelernt — aufgehoben für den Tag, an dem ein Backend kommt

- `project_id` & Co. als **Text**, niemals als Relation. Coolify-Reimport kippt
  Relations und bricht alle Filter.
- E-Mails immer `.toLowerCase()` speichern und filtern — PB-Filter sind case-sensitive.
- API-Rules nach jedem Coolify-Redeploy prüfen: sie fallen auf `auth != ""` zurück.
- Kein Bundle-File. ES-Module mit `?v=`-Cache-Bust.
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
| `js/templates.js` | Vier Vorlagen |
| `js/palette.js` | 10 Farbtöne × 2 Schraffuren = 20 Gewerke (HUES=10, MAX_SLOTS=20) |
| `js/ebene.js` | Bauzeitenplan ↔ Showablauf: Bänder, Showtage, Typ-Hinweis — **DOM-frei** |
| `js/live.js` | Verzug + laufende Vorgänge — **DOM-frei** |
| `js/inspector.js` | Seitenpanel |
| `js/menu.js` | Kontextmenü (Muster: Crewplaner dropdown.js) |
| `tools/build-prototypes.mjs` | **Nur** für die Design-Artifacts (CSP verlangt alles inline). Die App braucht keinen Build. |

Warum was so ist: `docs/entscheidungen.md`. Besonders der kritische Pfad hat eine
nicht offensichtliche Regel (verankerte Senken fallen aus dem minFloat) — die steht
dort begründet und ist durch Regressionstests abgesichert.

## Fahrplan

✅ Darstellung · ✅ Befüllen & Bearbeiten · ✅ Panel, Rechtsklick-Menü, Live-Modus ·
✅ Gewerke per Drag & Drop · ✅ Gleiche Reihenfolge (Gantt = Tabelle, nach Start) ·
✅ Untervorgänge (Eltern = Hülle, einklappbar) · ✅ Handy/Tablet-tauglich ·
✅ Prüf-Liste (kritisch & Konflikte sehen, zeigen, abhaken/lösen) ·
✅ Tagesblätter A3 · ✅ Showablauf-Ebene (Bühnen, Anforderungen/Material, Live-Kopfzeile,
Running-Order-Blatt)
→ Als Nächstes: Drag & Drop der Balken im Gantt · danach Ansichten & Export
(öffentlicher Link, PDF/ICS)

**PocketBase liegt auf Eis.** Die vorbereitete Login-/Rollenschicht wurde in v0.8.0 aus
`main` entfernt — die Seite ist eine reine GitHub-Pages-Auslieferung ohne
Nutzerverwaltung, und die Schicht kostete bei jedem Commit eine Isolationsprozedur.
Der vollständige Stand liegt im Branch `pocketbase-vorbereitung`; er wird nicht
deployt und nicht gemergt. Wenn Online + Rollen kommen, wird dort weitergemacht.

**Vorlagen:** «festival» ist abgenommener Praxisstand. Tour, Corporate und Messe
sind entworfene Gerüste — beim ersten echten Einsatz korrigieren.
