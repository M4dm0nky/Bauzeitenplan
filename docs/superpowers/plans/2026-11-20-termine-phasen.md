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

