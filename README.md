# Bauzeitenplan

**Live: https://m4dm0nky.github.io/Bauzeitenplan/** · [Changelog](CHANGELOG.md)

Digitaler Gantt-Ablaufplan für die Veranstaltungsbranche. Jedes Gewerk — Licht, Ton,
Video, Pyro, Catering, Sanitär, Bühne, Rigging — pflegt seine eigenen Vorgänge, alle
sehen denselben Stand.

Der Zeitstrahl trägt beide Realitäten der Branche: die Vorbereitung spannt Monate,
der Load-In läuft stundengenau.

## Stand

**Benutzbar.** Projekte anlegen (Vorlagen), befüllen, bearbeiten — alles im
Browser, ohne Backend. Gantt mit vier Zoomstufen, Abhängigkeiten (FS/SS/FF/SF
mit Lag), Meilensteine, kritischer Pfad, Undo/Redo, Auto-Save, JSON-Export.

**Dazugekommen (bis v0.8.1):** Gewerke per Drag & Drop umsortieren · Gantt und
Tabelle in gleicher Reihenfolge (nach Startzeit) · **Untervorgänge** (einklappbar,
Elternvorgang als Hülle) · **Handy/Tablet-tauglich** · **Prüf-Liste** für kritische
Vorgänge und Konflikte (sehen, zeigen, lösen oder abhaken) · **Verknüpfungs-Suche**
statt endlosem Dropdown · Hell/Dunkel-Umschalter im Kopf · **Tagesblätter zum
Drucken** · **Showablauf-Ebene** (siehe unten) · CallBoard-Marke.

## Zwei Ebenen: Bauzeitenplan und Showablauf

Derselbe Plan, zwei Blickrichtungen. Oben im Kopf schaltest du um:

**Bauzeitenplan** — die ganze Veranstaltung über **Gewerke**: Vorbereitung,
Aufbau, Show, Abbau. Vorgänge gleichen Namens werden zu einer Zeile mit mehreren
Balken gebündelt; 353 Vorgänge ergeben 153 Zeilen.

**Showablauf** — der Tagesablauf auf den **Bühnen**: Bands, Redner, Umbauten.
Hier wird **nicht** gebündelt: jeder Programmpunkt trägt seine eigene Zeile,
chronologisch von oben nach unten, mit der Startzeit vor dem Namen. Die
Seitenspalte ist damit allein schon der Ablaufplan.

```
12:00  DOORS
14:00  CREUTZFELD & JAKOB
14:30  Changeover
14:40  OLLI BANJO
```

Bühnen legst du an wie ein Gewerk (`+ Bühne`), benennst und sortierst sie genauso.
Ein Umschalter über dem Gantt wählt den Showtag, Häkchen blenden einzelne Bühnen
aus. In der **Tabelle** kommen vier Spalten dazu, genau dort wo du den Zeitstrahl
anlegst: Typ (Act · Changeover · Doors · Show-Ende), Soundcheck, Kontakt und die
Freitexte **Anforderungen** und **Benötigtes Material**.

Für den Monitor am FOH gibt es eine **Live-Kopfzeile**: was JETZT läuft, was ALS
NÄCHSTES kommt, der Verzug und die Uhr. Ein Changeover wird als Umbau angesagt,
nicht als Act.

**Running-Order-Blatt:** Unter *Drucken → Running Order* kommt ein A3 quer je Tag
und Bühne — als Liste (`Zeit · Programmpunkt · Anforderungen · Material`). Leere
Felder drucken als **Linien zum Ausfüllen mit dem Stift**.

**Weitergeben: einfach die Adresse schicken.** Wer
[die Seite](https://m4dm0nky.github.io/Bauzeitenplan/) öffnet, sieht den
Klassentreffen-Plan **sofort** — kein Import, keine Datei im Anhang. Die App holt
ihn beim Start aus `klassentreffen-festival.json`.

**Neuer Planstand? Nur die JSON austauschen.** Kommt V08, V09 …, wird die Datei
neu gebaut und gepusht — jeder Betrachter zieht sie beim nächsten Laden von
selbst nach. Erkannt wird das am `exported`-Stempel: ist der in der Datei neuer
als der zuletzt geladene, gewinnt die Datei. Ist er gleich, bleibt die lokale
Fassung stehen, damit eigene Änderungen nicht verlorengehen.

```bash
node tools/make-klassentreffen.mjs   # JSON aus der Quelle neu bauen
git commit -am "Plan auf V08" && git push origin main
```

`?plan=amk` öffnet stattdessen den AMK-Plan, **`?plan=leer`** überspringt den
Autostart und zeigt den Projektdialog für eigene Projekte. Beide Pläne stehen
auch im Dialog unter „Mitgelieferte Pläne".

**Drucken: ein A3 quer je Tag.** Der Knopf **Drucken** im Kopf öffnet
`print.html` — die Tagesblätter für die Wand im Produktionsbüro. Dort wählst du
Zeitraum und **Gewerke** (Catering weg, Security weg …) und siehst die Blätter am
Bildschirm so, wie sie aus dem Drucker kommen.

Das Wegklicken ist mehr als Aufräumen: es bestimmt den **Maßstab**. An einem
normalen Aufbautag zwingt allein die Objektbewachung (00:01–23:59) das Blatt auf
24 Stunden; ohne sie schrumpft das Zeitfenster auf 08:00–18:00 und die Balken
werden dreimal so breit. Das Fenster gilt für alle Blätter gemeinsam, damit sie
vergleichbar bleiben — von Hand übersteuerbar.

Im Druckdialog **A3 · Querformat** wählen und **Hintergrundgrafiken einschalten**,
sonst drucken die Balken weiß.

**Deine Daten liegen im Browser.** Privater Modus, Verlauf löschen, anderer
Rechner — und sie sind weg. Es gibt kein Backend und keine Anmeldung: der
**JSON-Export ist die einzige Sicherung**. Nutze ihn.

**Live-Modus** für den Aufbau: Zeitlinie läuft mit, Ansicht folgt, laufende
Vorgänge leuchten, Verzug wird benannt («sollte seit 20m laufen»). Der Status
wird dabei **nie** automatisch gesetzt — sonst sähe der Plan immer nach Plan aus
und das Signal «wir hängen» wäre weg.

**Als Nächstes:** Drag & Drop der Balken im Gantt, danach Ansichten & Export
(öffentlicher Link, PDF/ICS).

**PocketBase liegt auf Eis.** Eine Login- und Rollenschicht war vorbereitet,
wurde aber in v0.8.0 aus `main` entfernt: die Seite ist eine reine
GitHub-Pages-Auslieferung ohne Nutzerverwaltung, und die Schicht kostete bei
jedem Commit eine Isolationsprozedur. Der vollständige Stand liegt im Branch
`pocketbase-vorbereitung` und wird weder deployt noch gemergt.

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

**Im Gantt:** Klick auf Balken oder Zeile → Panel rechts mit allen Feldern und
den Verknüpfungen. **Rechtsklick** öffnet das Menü (umbenennen, duplizieren,
sortieren, löschen). **Doppelklick** auf einen Namen benennt an Ort und Stelle um.

**Geschätzte Dauern** haben eine gestrichelte rechte Kante — das Ende steht
nicht fest. Im Panel gibt es dazu ein Häkchen «Dauer geschätzt» zum Abhaken,
sobald die echte Zahl da ist.

**Konflikte & kritischer Pfad:** Verletzt ein Vorgang eine Abhängigkeit, wird er
rot markiert und sagt im Klartext, woran es liegt. Die **„kritisch"-Kachel** im Kopf
und der **Konflikt-Knopf** öffnen eine **Prüf-Liste**: je Eintrag **Zeigen** (springt
hin), bei Konflikten **Lösen** (nur diesen auf den frühestmöglichen Termin) oder
**Ist ok** (abhaken), bei kritischen **Gesehen**. „Alle auflösen" bleibt als
Abkürzung. Nichts verschiebt sich hinter deinem Rücken; ein `⌘Z` nimmt jede
Auflösung komplett zurück.

**Untervorgänge:** In der Tabelle legt „+↳" einen einklappbaren Untervorgang an; der
Elternvorgang wird zur **Hülle** (Start/Ende ergeben sich aus den Kindern) und
erscheint im Gantt als Sammelbalken. **Verknüpfen** läuft über ein **Suchfeld** —
tippen filtert die (nach Gewerk gruppierte, chronologische) Trefferliste, statt durch
alle Vorgänge zu scrollen.

## Prüfen

```bash
node tests/run.mjs            # Unit-Tests + statische Prüfungen, ohne Browser
node tools/verify-browser.mjs # Darstellung: App + 4 Theme-Prototypen im Browser
node tools/verify-edit.mjs    # Bearbeiten: anlegen, tippen, Undo, Konflikte, Panel, Menü
node tools/verify-live.mjs    # Live-Modus mit gestellter Uhr (page.clock)
node tools/verify-amk.mjs     # AMK-Plan importieren und prüfen
node tools/verify-print.mjs   # Tagesblätter: Zuschnitt, Filter, Maßstab, PDF
node tools/verify-klassentreffen.mjs  # V07-Plan + Autostart über die Adresse
node tools/verify-showablauf.mjs      # Showablauf: Ebene, Bühnen, Live-Kopfzeile, Blatt
node tools/make-amk.mjs       # amk-singleshow.json aus den PDF-Daten neu bauen

# gegen die veröffentlichte Seite statt lokal:
node tools/verify-browser.mjs --base https://m4dm0nky.github.io/Bauzeitenplan/
```

`verify-browser.mjs` braucht einmalig einen Browser: `npx playwright install firefox`.
Er prüft Verhalten (Sticky-Spalten, Zoomstufen, Pfeilgeometrie, Beschriftungen,
Jetzt-Linie, Service Worker) und legt Screenshots unter `tools/shots/` ab.

**Screenshots ansehen, nicht nur Häkchen zählen.** Zehn echte Fehler haben in diesem
Projekt die automatischen Prüfungen passiert und wurden erst im Bild sichtbar —
zuletzt eine Datumszeile, die links angeschnitten war, und ein «SHOW END», das
über die Blattkante lief.

## Deploy

```bash
node tools/version.mjs 0.2.0   # eine Nummer, alle Stellen
# CHANGELOG.md füllen
node tests/run.mjs             # prüft, dass nichts auseinanderläuft
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
nichts** — er kann also nie eine alte Version einsperren. Fremde Origins fasst er
nicht an. Ein Kill-Switch steht in der Datei.

Das `?v=` in `index.html` setzt `tools/version.mjs` mit — von Hand hochzählen
ist nicht nötig. Beides zusammen, weil der Service Worker erst ab dem zweiten
Aufruf greift: `?v=` trägt den allerersten Aufruf nach einem Deploy, der Worker
alles danach.

## Aufbau

```
index.html              Die App
print.html              Tagesblätter zum Drucken
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
  palette.js            Gewerk-Farben: 10 Töne × 2 Schraffuren = 20 Plätze
  ebene.js              Bauzeitenplan ↔ Showablauf: Bänder, Showtage, Fenster — DOM-frei
  live.js               Verzug + laufende Vorgänge — DOM-frei
  inspector.js          Seitenpanel (mit Verknüpfungs-Suche)
  menu.js               Kontextmenü
  print.js              Tagesblätter (A3 quer) — eigene Seite, print.html
styles/
  base.css              Nur Geometrie + Verhalten. Dazu die Gewerk-Farben.
  print.css             Blattgeometrie in mm, @page A3 quer
  themes/*.css          Fünf Gestaltungsebenen; callboard ist aktiv
tests/                  Unit-Tests + statische Prüfungen
tools/
  build-prototypes.mjs  Baut die vier Design-Entwürfe als eigenständige Dateien
  verify-browser.mjs    Verhaltensprüfung im echten Browser
docs/                   Entscheidungen, Themes, Farbsuche
```

Alles Rechnende ist bewusst frei von DOM-Bezügen und damit direkt testbar —
Fehler im Backward-Pass oder im Undo-Stapel sind visuell unsichtbar und
produzieren trotzdem falsche Termine.

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

Fünf fertige Ebenen, aktiv ist `callboard` (NYX-Navy-CI: Navy/Paper, eigene
Schriften). **Hell/Dunkel** schaltet ein Knopf im Kopf (☾/☀, gemerkt in
`bzp_mode`). Der Wechsel der Theme-**Familie** ist verdrahtet, aber noch nicht als
Knopf gebaut — siehe **[docs/themes.md](docs/themes.md)**.

## Fahrplan

| | |
|---|---|
| ✅ | Darstellung: Gantt, vier Zoomstufen, Abhängigkeiten, kritischer Pfad |
| ✅ | Befüllen & Bearbeiten: Vorlagen, Tabelle, Konflikte, Undo, Speichern |
| ✅ | Live-Modus: Zeitlinie läuft, Verzug, laufende Vorgänge · Panel · Rechtsklick-Menü |
| ✅ | Gewerke per Drag & Drop · gleiche Reihenfolge Gantt = Tabelle (nach Start) |
| ✅ | Untervorgänge (Eltern = Hülle, einklappbar) · Handy/Tablet-tauglich |
| ✅ | Prüf-Liste (kritisch & Konflikte sehen/zeigen/abhaken) · Verknüpfungs-Suche |
| ✅ | Tagesblätter zum Drucken (ein A3 quer je Tag) |
| ✅ | Showablauf-Ebene: Bühnen, Anforderungen/Material, Live-Kopfzeile, Running-Order-Blatt |
| → | Drag & Drop der Balken im Gantt: Balken ziehen, Dauer ziehen, Verknüpfungen ziehen |
| | Ansichten & Export: öffentlicher Link, PDF/ICS |
| ❄️ | PocketBase, Login, Rollen — auf Eis, Stand im Branch `pocketbase-vorbereitung` |

**Zu den Vorlagen:** «Festival» ist abgenommener Praxisstand. Tour, Corporate und
Messe sind entworfene Gerüste — richtige Gewerke und Meilensteine, aber keine
erfundenen Detailvorgänge. Korrigier sie beim ersten echten Einsatz.

**Beispielplan Klassentreffen:** `klassentreffen-festival.json` bildet den
**Bauzeitenplan V07 (Stand 25.08.2026)** ab — 20 Gewerke, 353 Vorgänge über
14 Tage, quellentreu bis auf 19 Zeilen, die im Original ohne Uhrzeit gedruckt
sind (gestrichelte Kante, Grund in der Notiz). Neu gebaut wird er mit
`node tools/make-klassentreffen.mjs`; die Quelle steht Zeile für Zeile in
diesem Werkzeug. **Keine Verknüpfungen** — V07 ist ein terminierter Kalender,
und erfundene Abhängigkeiten erzeugten rote Konflikte ohne Wirklichkeitsbezug.

Dazu die **Running Order** beider Showtage (Stand 05.08.2026, 32 Programmpunkte
auf der Hauptbühne) für die Showablauf-Ebene. Anforderungen und Material bleiben
dort leer — die trägt man von Hand ein, dafür ist die Ansicht da.
