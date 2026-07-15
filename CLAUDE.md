# Bauzeitenplan — Arbeitsanweisungen

Gantt-Ablaufplan für die Veranstaltungsbranche. Vanilla JS, ES-Module, **kein Build-Step**.
Projekte leben im Browser (localStorage) + JSON-Export. PocketBase kommt danach.

**Live:** https://m4dm0nky.github.io/Bauzeitenplan/ · **Repo:** M4dm0nky/Bauzeitenplan

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

**Bei Änderungen an `js/*` oder `styles/*` das `?v=` in `index.html` hochzählen.**
`sw.js` (Cache-Buster) fängt den Rest ab, greift aber erst ab dem zweiten Aufruf.
Warum er nötig ist: `app.js` importiert `./gantt.js` ohne Version, und Pages sendet
`max-age=600` — ohne ihn kämen Änderungen an Untermodulen zehn Minuten lang nicht an.
Der Worker cacht selbst nichts und kann deshalb nie eine alte Version einsperren;
Kill-Switch steht in `sw.js`.

`~/.local/bin/gh` ist installiert (nicht im PATH — mit vollem Pfad aufrufen).
Angemeldet als **M4dm0nky**. Das Repo liegt bewusst dort und nicht unter `Aniflu`:
Aniflu ist ein fremdes persönliches Konto, dort kann M4dm0nky weder Repos anlegen
noch Pages einschalten (nur `push`, kein `admin`).

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

✅ Darstellung · ✅ Befüllen & Bearbeiten · ✅ Panel, Rechtsklick-Menü, Live-Modus
→ Als Nächstes: Drag & Drop im Gantt · danach PocketBase + Login + Rollen ·
zuletzt Ansichten & Export (Tagesplan, öffentlicher Link, PDF/ICS)

**Vorlagen:** «festival» ist abgenommener Praxisstand. Tour, Corporate und Messe
sind entworfene Gerüste — beim ersten echten Einsatz korrigieren.
