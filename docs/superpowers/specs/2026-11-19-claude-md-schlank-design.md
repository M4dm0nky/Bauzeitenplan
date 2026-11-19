# CLAUDE.md verschlanken — Design (kurz)

Stand 2026-11-19. Marco: «mach die nächsten Schritte». Entscheidungen = Claudes Wahl.

**Warum:** CLAUDE.md hat 943 Zeilen und wird in jede Sitzung geladen. Regeln stehen
zwischen Vorfallgeschichten; eine neue Sitzung findet die Regel schwer, und jede
Zeile kostet bei jedem Aufruf Token.

**Ziel:** ≤ 300 Zeilen. Jede Regel bleibt — als Imperativ in 1–3 Zeilen. Begründung
und Vorgeschichte («bis v0.9.6 lag …», «im Screenshot gesehen …») wandern nach
`docs/entscheidungen.md` unter eine gleichnamige Überschrift; CLAUDE.md verweist
pro Abschnitt einmal dorthin.

**Nicht-Ziel:** Regeln ändern, abschwächen oder streichen. Code anfassen.

**Gliederung (Vorschlag des Umsetzers darf abweichen, wenn kürzer):** Start &
Prüfungen · Deploy & Version · Daten & Store · Zeit · Gantt & Darstellung ·
Showablauf & Live · Druck · Oberfläche & Bedienung · Personal & Maschinen ·
Sync & Offline · Aufbau (Tabelle) · Fahrplan = GitHub-Issues (keine eigene Liste;
globale Regel «Roadmap = Issues»).

**Ansätze:** (a) kürzen und Begründungen auslagern — gewählt; (b) in mehrere
CLAUDE.md-Dateien je Ordner aufteilen — verworfen: Regeln gelten modulübergreifend,
und verstreute Dateien liest niemand; (c) nur löschen — verworfen: die Begründungen
haben schon Rückfälle verhindert.

**Abnahme, messbar:**
1. Jede fett eingeleitete Regel der alten Datei (98 Stück, `^\*\*…\*\*`) ist in der
   neuen CLAUDE.md als Regel auffindbar; Liste alt→neu im Bericht.
2. Jede ausgelagerte Begründung steht in `docs/entscheidungen.md`.
3. Neue statische Prüfung in `tests/run.mjs`: CLAUDE.md ≤ 320 Zeilen — sonst wächst sie
   wieder (vorher rot mit der alten Datei).
4. Alle Befehle/Dateinamen in CLAUDE.md existieren (Prüfskript im Bericht, nicht im Repo).
