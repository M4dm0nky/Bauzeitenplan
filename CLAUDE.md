# Bauzeitenplan — Arbeitsanweisungen

Gantt-Ablaufplan für die Veranstaltungsbranche. Vanilla JS, ES-Module, **kein Build-Step**.
Backend (PocketBase) kommt in Phase 1 — Stand jetzt läuft alles aus `js/data.js`.

**Live:** https://m4dm0nky.github.io/Bauzeitenplan/ · **Repo:** M4dm0nky/Bauzeitenplan

## Vor jeder Änderung

```bash
node tests/run.mjs              # 45 Unit-Tests + statische Prüfungen
node tools/verify-browser.mjs   # App + 4 Prototypen im echten Browser
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

**Rechenlogik bleibt DOM-frei.** `schedule.js` und `timeaxis.js` haben keinen
DOM-Bezug und sind damit direkt testbar. So halten. Neue Logik dort → Test dazu.

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
| `js/data.js` | Demo-Daten (Phase 1: PocketBase) |
| `tools/build-prototypes.mjs` | **Nur** für die Design-Artifacts (CSP verlangt alles inline). Die App braucht keinen Build. |

Warum was so ist: `docs/entscheidungen.md`. Besonders der kritische Pfad hat eine
nicht offensichtliche Regel (verankerte Senken fallen aus dem minFloat) — die steht
dort begründet und ist durch Regressionstests abgesichert.

## Fahrplan

Phase 0 ✅ Darstellung · Phase 1 Backend + Login + Rollen · Phase 2 Bearbeiten ·
Phase 3 Ansichten + Export
