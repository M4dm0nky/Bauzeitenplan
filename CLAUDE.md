# Bauzeitenplan — Arbeitsanweisungen

Gantt-Ablaufplan für die Veranstaltungsbranche. Vanilla JS, ES-Module, **kein Build-Step**.
Projekte leben im Browser (localStorage) + JSON-Export. PocketBase kommt danach.

**Live:** https://m4dm0nky.github.io/Bauzeitenplan/ · **Repo:** M4dm0nky/Bauzeitenplan · **Version:** siehe unten

## Vor jeder Änderung

```bash
node tests/run.mjs              # 192 Unit-Tests + statische Prüfungen
node tools/verify-browser.mjs   # Darstellung: App + 4 Prototypen
node tools/verify-edit.mjs      # Bearbeiten: anlegen, tippen, Undo, Panel, Menü
node tools/verify-live.mjs      # Live-Modus mit gestellter Uhr
node tools/verify-amk.mjs       # AMK-Plan importieren
```

Beides muss grün sein, bevor etwas als fertig gilt. `verify-browser.mjs` braucht
einmalig `npx playwright install firefox`.

**Screenshots ansehen, nicht nur die Häkchen zählen.** Vier echte Fehler haben in
diesem Projekt die automatischen Prüfungen passiert und wurden erst im Bild sichtbar:
Pfeile quer über die Gewerk-Spalte, unsichtbare Phasennamen, Beschriftungen ohne
Balken, und eine auf „J" zusammengeschnurrte JETZT-Fahne. Für jeden gibt es jetzt
eine Prüfung — der nächste Fehler dieser Art hat aber noch keine.

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

**Aktuell: 0.1.0** · `CHANGELOG.md` hält die Historie, nicht diese Datei.

**Die Version wird NIE von Hand geändert.** Ein Befehl stempelt sie in alle
sechs Stellen zugleich:

```bash
node tools/version.mjs          # zeigt die aktuelle
node tools/version.mjs 0.2.0    # setzt sie überall + Changelog-Abschnitt
```

Betroffen: `js/version.js` (Quelle) · `package.json` · `index.html` (alle `?v=`)
· `sw.js` (`SW_VERSION`) · `CHANGELOG.md`. **Die Nummer entscheidet Marco**, nicht
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

**Eine Reihenfolge für beide Ansichten: `byStart` (schedule.js).** Gantt und
Tabelle sortieren Vorgänge eines Gewerks über DENSELBEN Vergleicher (Start, dann
Ende, dann Titel). Nie eine der beiden Ansichten separat sortieren — sonst sieht
derselbe Plan zweimal anders aus und wirkt „nicht gleich".

**Der Verknüpfungs-Picker sucht, statt zu scrollen** (`candidateGroups` in
schedule.js, DOM-frei und getestet). Bei 100+ Vorgängen ist der native Dropdown
unbenutzbar. Die reine Funktion gruppiert nach Gewerk, sortiert je Gewerk über
`byStart` und filtert per Query (Titel/Gewerkname); der Inspector rendert nur ihr
Ergebnis. Neue lange Auswahllisten genauso lösen — nie einen 122-Zeilen-`<select>`.

**Abhaken ist eine menschliche Aussage über eine gerechnete Warnung — persistiert,
signaturgebunden.** `ackCrit` (bool) nimmt einen kritischen Vorgang aus der
kritisch-Zahl; `ackConflictMin` (Minuten) akzeptiert eine Konfliktgröße. `findConflicts`
überspringt den Konflikt nur, solange `shortBy <= ackConflictMin + EPS` — wird er
GRÖSSER, meldet er sich wieder (kein stilles Wegdrücken). Läuft über `setTaskField`
(Undo, Persistenz). **Eine Quelle:** Zählung, Prüf-Liste und `resolveConflictsCmd`
lesen alle `findConflicts` — nie einen zweiten Zähler danebenstellen. „Kritisch" bleibt
Information (kein automatisches Verschieben), nur die Sichtbarkeit wird abhakbar.

## Aus Crewplaner gelernt — gilt ab Phase 1

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
| `js/palette.js` | 8 Farbtöne × 2 Schraffuren = 16 Gewerke |
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
✅ Prüf-Liste (kritisch & Konflikte sehen, zeigen, abhaken/lösen)
→ Als Nächstes: Drag & Drop der Balken im Gantt · danach PocketBase + Login +
Rollen · zuletzt Ansichten & Export (Tagesplan, öffentlicher Link, PDF/ICS)

**Vorlagen:** «festival» ist abgenommener Praxisstand. Tour, Corporate und Messe
sind entworfene Gerüste — beim ersten echten Einsatz korrigieren.
