# Termine, ✓, Phasen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Spec:** docs/superpowers/specs/2026-11-20-termine-phasen-design.md

## Global Constraints
- Store einziger Weg; Validierung vor der Änderung; Kernmodule DOM-frei, neue Logik dort → Unit-Test (synchron, nicht hinter process.exit).
- Zeiten über toMin()/toDate()/local(); drei xp()-Stellen; Tick ruft nie layout().
- Nie window.prompt/confirm/alert (askDialog). Neue Theme-Klassen → needed-Liste + alle fünf Themes, beide Dunkel-Scopes. Neue Felder durch addTask. Neue js-Datei → HUELLE.
- Platzhaltertexte in Freitextspalten verboten. Symbole statt Textkürzel.
- Kein Stash (Hook), keine Warteschleifen, Vordergrund-Läufe, Prozesse beendet. Version nicht stempeln, nicht pushen.

## Review Focus
- Bestehende Pläne (Klassentreffen, AMK) sehen exakt aus wie vorher (Balken, Konflikte, kritischer Pfad).
- Terminlose Vorgänge brechen keine Rechnung (NaN, Infinity, leere Achse).
- ✓-Entwurf: Zeile verlassen verwirft wirklich; kein doppelter Undo-Eintrag; Showablauf-Zeitfelder ohne Datum.
- Phasen überleben Export→Import und Sync.
- Live/Versatz mit terminlosen Vorgängen und Phasen.

### T1 Datenmodell «ohne Termin» (DOM-frei)
- Regel: `start` und `end` **beide `null`** = ohne Termin; sonst wie bisher gültige Spanne. `spanFehler` (schedule.js)
  erlaubt das Paar `null/null` (nicht ein einzelnes); Store `addTask`/`setTaskField`/`moveTask`, persistence
  `inhaltFehler`/`migrate` entsprechend. Meilenstein ohne Termin erlaubt.
- Alle Rechner überspringen terminlose Vorgänge: `computeSchedule`/kritischer Pfad, `findConflicts` (Deps von/zu
  terminlos zählen nicht), `seriesRows`, `byStart` (terminlos ans Ende der Gruppe, dann Titel), `programmTage`,
  `tagesScheiben`, `delaysAt`/`offeneVerspaetungen`, `bedarfsRaster`/`deckung`, `reflowParents` (Hülle nur aus
  terminierten Kindern; alle terminlos → Hülle terminlos), `resNachziehen`, `suchTreffer` (Treffer «ohne Termin»).
- Tests je Modul (Unit), inkl. Rundlauf serialize→deserialize mit terminlosem Vorgang.

### T2 Vorlagen + Neu-Dialog
- `planFromTemplate` (templates.js:251): Vorgänge **ohne Termin**; Meilensteine ebenfalls; Deps bleiben (zählen erst,
  wenn beide terminiert). `project.start/end` = Event **Von/Bis** aus dem Neu-Dialog (app.js ~1473: statt «Aufbaubeginn»
  zwei Felder Von/Bis). Vorlagen-Phasen entfallen (Marco legt sie in T5 an). Klassentreffen/AMK unberührt.
- Gantt-Zeitfenster eines Plans ohne terminierte Vorgänge = Event Von/Bis.
- Bestehende Prüfungen, die auf Vorlagen-Daten bauen (verify-browser/edit/live nutzen Festival-Vorlage mit Daten!),
  bekommen einen **Test-Plan mit Daten** (eigene JSON-Fixture unter tools/), damit sie weiter Balken haben.

### T3 Darstellung terminloser Vorgänge
- Gantt: Zeile links wie gewohnt, **kein Balken**, kein Griff; dezente Kennzeichnung «ohne Termin» in der Seitenspalte.
- Tabelle: leere Datumsfelder (Platzhalter verboten → Spaltenkopf reicht); Panel: leere Felder.
- Druck (Tagesblätter, Running Order), Bedarf, Live, Suche (Sprung zur Tabellenzeile/Seitenspalte), Prüf-Liste: robust.

### T4 Zeilen-Entwurf mit ✓ / ✗
- Tabelle (Bauzeitenplan + Showablauf) und Panel: Start/Ende/Dauer ändern nur einen **Entwurf** der Zeile; Zeile
  gelb markiert, ✓ und ✗ erscheinen. **✓ oder Enter** → EIN Store-Befehl (`moveTask` start+end bzw. «ohne Termin»),
  dann einsortieren. **✗, Escape oder Zeile verlassen** → verwerfen. Ungültige Spanne → ✓ gesperrt + Grund sichtbar
  (kein stilles Verwerfen mehr). Andere Felder (Titel, Status …) bleiben sofort gespeichert.
- Vorhandene Mechanik nutzen/ersetzen: `commitOn`/`sendendesFeld`/`nachholen` (table.js ~936-1010) — Entwurf hält den
  Neuaufbau der Zeile bis ✓/✗. Muster für Knöpfe/Popover: `neuFragen`/`platziere` (table.js ~625).
- Prüfwerkzeuge, die `.c-start input` füllen (verify-edit ~138, ~804; verify-showablauf), auf ✓ umstellen.

### T5 Phasen
- Datenmodell: `state.phases = [{id, art:'planung'|'vorbereitung'|'aufbau'|'show'|'abbau', name?, start, end}]`;
  `migrate` übersetzt Altdaten (Name → Art per vorhandener Regex-Logik, sonst 'aufbau'); **`deserialize` behält
  Phasen** (Fix + Test). Store-Befehle `addPhase`/`setPhase`/`removePhase` (Undo, `spanFehler`, Überlappung erlaubt?
  → nein: Phasen derselben Art dürfen sich nicht überlappen).
- Show-Tage: jeder Kalendertag in Show-Phasen wird fortlaufend «Show-Tag 1, 2, 3 …» (DOM-freie Funktion, Test).
- Darstellung: Leiste über dem Zeitstrahl (vorhandenes `axisPhase`/`layoutBands`, gantt.js ~1292) mit Farbe je **Art**
  (Tokens in allen 5 Themes, beide Dunkel-Scopes, `needed`-Liste) + Tönung im Zeitstrahl; Show-Tage einzeln beschriftet.
  Kopfzeile: «heute: Aufbau» / «heute: Show-Tag 2» (nur wenn heute in einer Phase).
- Bearbeiten: Einrichten-Reiter «Phasen» (Liste: Art, Name, Von, Bis, ✓/✗, Löschen über `askDialog`); Klick auf die
  Leiste öffnet denselben Editor als Kasten (Muster `neuFragen`/`platziere`). «+ Phase» im Reiter.
- Regel-Datei `.claude/rules/` ergänzen (Phasen = Art, nicht Name).

### T6 Abschluss
CHANGELOG, alle neun Prüfungen, Screenshots (neuer Plan aus Vorlage ohne Balken, Entwurf-Zeile gelb mit ✓/✗, Phasen-
Leiste mit Show-Tag 1/2), Schlussreview, dann Versionsnummer bei Marco erfragen, live, Tag.


## Nachtrag T7 (Marco 2026-11-20) — Reihenfolge T3 → T4 → T7 → T5 → T6

### T7 Hell/Dunkel-Umschalter + warmes Hell (Nachtrag Marco 2026-11-20; läuft VOR T5, damit die Phasenfarben gleich
auf der neuen Palette entstehen — Reihenfolge: T3 → T4 → T7 → T5 → T6)
- **Ist:** Umschalter ☀/☾ existiert (`#theme-toggle`, index.html:241), steckt aber im Einrichten-Fenster; Handler
  app.js:1675-1695 (`currentMode`, `paintModeToggle`, `localStorage['bzp_mode']`, `data-theme` auf `<html>`, Kopf-Script
  index.html:8-16 gegen Aufblitzen; ohne Wahl gilt das OS). Hell in callboard.css:22-40/57-62: `--bg #F1EFE9` warm, aber
  `--panel`/`--panel2 #FFFFFF` grellweiß → alle Flächen (Panel, Tabelle, Dialoge, Menüs, Suchliste) sind reinweiß.
- **Umschalter sichtbar:** in die Kopfzeile rechts (`.hd-right`, neben 🖨 Drucken), Symbol ☀/☾ mit `aria-label`/`title`,
  in beiden Modi, auf dem Handy als reines Symbol. Bleibt derselbe Knopf/Handler (umziehen, keine zweite Verdrahtung);
  aus Einrichten entfernen. Schiene bleibt nur Modus (Regel). Knopfzahl 14/12 → 15/13 (CLAUDE.md + Zählprüfung in
  verify-browser); Handy-Kopf ≤ 300 px muss halten.
- **Warmes Hell (nur callboard, das ausgelieferte Theme):** alle hellen Flächen-Tokens auf warmes Weiß, kein #FFF mehr:
  `--panel` ≈ #FBF8F1, `--panel2` ≈ #F6F1E7, `--bg` etwas tiefer/wärmer ≈ #EDE7DB, `--rule`/`--rule-2` warm getönt,
  `--ink`/`--ink-2`/`--muted` leicht warm, Kontrast gehalten. Beide Scopes (`:root` und `[data-theme="light"]`) gleich.
  Prüfen, dass nichts anderes reinweiß bleibt (Toast, Tooltip, Suchliste, Leer-Hinweis, Fokusringe, Eingabefelder,
  Hinweis beim Ziehen, Einrichten-Fenster) — alles über Tokens; `color:#fff` auf Farbflächen bleibt.
- **Messbar:** neue statische Prüfung in tests/run.mjs: im hellen Callboard kein Flächen-Token `#fff`/`#ffffff`; Text-
  kontrast `--ink` auf `--panel`/`--bg` ≥ 7:1, `--muted` auf `--panel`/`--bg` ≥ 4.5:1 (für hell UND dunkel). Gewerk-
  farben nicht anfassen; `tools/farbsuche.mjs` einmal mit der neuen Fläche messen und Ergebnis berichten (nur Messung).
- Andere vier Themes unverändert (Entwürfe, nicht ausgeliefert). Druckblatt bleibt reinweiß (print.css, eigene Tokens).
- Browser: Umschalter in der Kopfzeile schaltet hell↔dunkel und übersteht Neuladen; Screenshots hell und dunkel von
  Bauzeitenplan, Showablauf, Tabelle, Panel, Einrichten, Suche angesehen.

