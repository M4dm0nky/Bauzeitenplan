# Bauzeitenplan

**Live: https://m4dm0nky.github.io/Bauzeitenplan/**

Digitaler Gantt-Ablaufplan für die Veranstaltungsbranche. Jedes Gewerk — Licht, Ton,
Video, Pyro, Catering, Sanitär, Bühne, Rigging — pflegt seine eigenen Vorgänge, alle
sehen denselben Stand.

Der Zeitstrahl trägt beide Realitäten der Branche: die Vorbereitung spannt Monate,
der Load-In läuft stundengenau.

## Stand

**Benutzbar.** Projekte anlegen (4 Vorlagen), befüllen, bearbeiten — alles im
Browser, ohne Backend. Gantt mit vier Zoomstufen, Abhängigkeiten (FS/SS/FF/SF
mit Lag), Meilensteine, kritischer Pfad, Konfliktanzeige mit Auflösen,
Undo/Redo, Auto-Save, JSON-Export.

**Deine Daten liegen im Browser.** Privater Modus, Verlauf löschen, anderer
Rechner — und sie sind weg. Bis PocketBase steht, ist der **JSON-Export die
einzige Sicherung**. Nutze ihn.

**Als Nächstes:** Drag & Drop im Gantt, danach PocketBase mit Login und Rollen.

## Starten

Ein Server ist nötig — ohne ihn blockiert der Browser die ES-Module per CORS.

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

Kein Build, keine Abhängigkeiten zur Laufzeit.

### Bedienung

| | |
|---|---|
| `⌘`/`Ctrl` + Mausrad | zoomt am Cursor — der Zeitpunkt unter der Maus bleibt stehen |
| `⇧` + Mausrad | scrollt seitwärts |
| `←` `→` | blättern · `H` springt zu heute |
| `⌘Z` / `⇧⌘Z` | rückgängig / wiederholen |
| Minimap unten | Fenster ziehen, um über Monate zu navigieren |

**Tabelle** (der schnelle Weg rein): `Enter` legt eine Zeile darunter an,
`Tab` springt weiter, `⌫` auf leerem Namen löscht. Dauer als Kurzform —
`4h`, `1,5h`, `90m`, `2t`, `1t 4h`. Das Ende rechnet sich; das Ende zu ändern
rechnet die Dauer zurück.

**Konflikte:** Verletzt ein Vorgang eine Abhängigkeit, wird er rot markiert und
sagt im Klartext, woran es liegt. «Konflikte auflösen» schiebt alles auf den
frühestmöglichen Termin — ein `⌘Z` nimmt das komplett zurück. Es verschiebt sich
nie etwas hinter deinem Rücken.

## Prüfen

```bash
node tests/run.mjs            # 192 Unit-Tests + statische Prüfungen, ohne Browser
node tools/verify-browser.mjs # Darstellung: App + 4 Theme-Prototypen im Browser
node tools/verify-edit.mjs    # Bearbeiten: anlegen, tippen, Undo, Konflikte, Neuladen

# gegen die veröffentlichte Seite statt lokal:
node tools/verify-browser.mjs --base https://m4dm0nky.github.io/Bauzeitenplan/
```

`verify-browser.mjs` braucht einmalig einen Browser: `npx playwright install firefox`.
Er prüft Verhalten (Sticky-Spalten, Zoomstufen, Pfeilgeometrie, Beschriftungen,
Jetzt-Linie, Service Worker) und legt Screenshots unter `tools/shots/` ab.

**Screenshots ansehen, nicht nur Häkchen zählen.** Vier echte Fehler haben in diesem
Projekt die automatischen Prüfungen passiert und wurden erst im Bild sichtbar.

## Deploy

```bash
git push origin main
```

GitHub Pages aktualisiert sich automatisch ~1 Minute nach dem Push — kein Build,
kein Workflow, Quelle ist `main` / `root`. Danach live prüfen:

```bash
node tools/verify-browser.mjs --base https://m4dm0nky.github.io/Bauzeitenplan/
```

### Warum es einen Service Worker gibt

`index.html` lädt `js/app.js?v=N`, aber `app.js` importiert `./gantt.js` **ohne**
Versionsangabe — und GitHub Pages sendet `cache-control: max-age=600`. Ohne
Gegenmaßnahme kämen Änderungen an den Untermodulen bis zu zehn Minuten lang nicht an,
beim Entwickeln erst nach manuellem Cache-Leeren.

`sw.js` erzwingt deshalb für eigene JS/CSS/HTML eine Revalidierung und **cacht selbst
nichts** — er kann also nie eine alte Version einsperren. Fremde Origins (ab Phase 1
die PocketBase-API) fasst er nicht an. Ein Kill-Switch steht in der Datei.

Bei Änderungen an `js/*` oder `styles/*` trotzdem das `?v=` in `index.html`
hochzählen — der Service Worker greift erst ab dem zweiten Aufruf.

## Aufbau

```
index.html              Die App
js/
  app.js                Einstieg: Projektverwaltung, Speichern, Ansichten
  store.js              Zustand + Befehle + Undo/Redo — DOM-frei
  gantt.js              Render-Engine (DOM, Zoom, Pfeile, Tooltip, Minimap)
  table.js              Tabellen-Editor
  schedule.js           Terminrechnung: CPM, Topo-Sort, kritischer Pfad — DOM-frei
  conflicts.js          Konflikte + Auflösen + Dauer-Kurzform — DOM-frei
  timeaxis.js           Zeit ↔ Pixel, Zoomstufen, Ticks, Kalenderwochen — DOM-frei
  templates.js          Vier Vorlagen (Festival, Tour, Corporate, Messe)
  persistence.js        localStorage, Export/Import, Migration — DOM-frei
  palette.js            Gewerk-Farben: 8 Töne × 2 Schraffuren = 16 Plätze
styles/
  base.css              Nur Geometrie + Verhalten. Dazu die Gewerk-Farben.
  themes/*.css          Vier Gestaltungsebenen; console ist aktiv
tests/                  Unit-Tests + statische Prüfungen
tools/
  build-prototypes.mjs  Baut die vier Design-Entwürfe als eigenständige Dateien
  verify-browser.mjs    Verhaltensprüfung im echten Browser
docs/                   Entscheidungen, Themes, Farbsuche
```

`schedule.js` und `timeaxis.js` sind bewusst frei von DOM-Bezügen — die ganze
Rechnung ist damit direkt testbar. Fehler im Backward-Pass sind visuell unsichtbar
und produzieren trotzdem falsche Termine.

## Bevor du etwas änderst

Lies **[docs/entscheidungen.md](docs/entscheidungen.md)**. Kurzfassung der Fallen:

- **Gewerk-Farben nicht per Hand ändern.** Reihenfolge und Zuordnung sind gerechnet
  (720 Varianten durchprobiert), nicht ausgesucht.
- **Balkenbeschriftung nicht entfernen.** Drei Farben liegen unter 3:1 Kontrast;
  die Beschriftung ist die vorgeschriebene sekundäre Kodierung.
- **Zoomstufen werden in sichtbarer Zeitspanne gemessen**, nicht in Pixeln. Die
  Tests setzen das durch.
- **Zeiten immer aus echten Zeitstempeln rechnen**, nie aus Datumsstrings — sonst
  ist die Dauer über den Sommerzeit-Sprung falsch.

## Themes

Vier fertige Ebenen, aktiv ist `console` (die Crewplaner-DNA ins Helle gedreht).
Ein Umschalter ist vorbereitet, aber noch nicht gebaut — siehe
**[docs/themes.md](docs/themes.md)**.

## Fahrplan

| | |
|---|---|
| ✅ Phase 0 | Darstellung: Gantt, Zoom, Abhängigkeiten, kritischer Pfad |
| Phase 1 | PocketBase, Login, Rollen (`superadmin` / `projektleiter` / `gewerk_lead` / `gewerk_member` / `viewer`) |
| Phase 2 | Bearbeiten: Vorgänge anlegen, verschieben, Auto-Verschieben mit Vorschau |
| Phase 3 | Ansichten & Export: Tagesplan, öffentlicher Link ohne Login, PDF/ICS |
