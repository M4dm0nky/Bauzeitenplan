---
paths:
  - "js/store.js"
  - "js/conflicts.js"
  - "js/persistence.js"
  - "js/phasen.js"
  - "js/phasen-editor.js"
  - "js/schedule.js"
  - "tools/make-amk.mjs"
  - "tests/amk.test.mjs"
---

# Store, Untervorgänge, Warnungen, AMK

- **Kein Cache in `computeSchedule`;** `findConflicts(state, vorab)` nimmt eine fertige Rechnung, app.js holt sie über `gantt.conflicts()`.
- **Untervorgänge: der Elternvorgang ist die HÜLLE.** Untervorgang = Vorgang mit `parent` (Text-id, nie Relation), gleiches Gewerk, nur EINE Ebene (`addTask`). `reflowParents(state)` läuft nach JEDER Änderung in `store.apply` (Eltern-`start`/`end` = Kinderspanne).
- Eltern-Zeiten setzen, verschieben, zum Meilenstein machen: abgelehnt. Löschen kaskadiert, Gewerkwechsel zieht Kinder mit, `findConflicts` nimmt Sammelvorgänge AUS.
- **`removeTask` kaskadiert auch über `fuer`.** **`reorderGewerk` darf `slot` nicht anfassen** (Test).
- **`migrate` normalisiert nur, was der Plan NICHT kennt** (eigene Abschnitte bleiben); `setTaskField`/`addTask` lehnen unbekannte Abschnitte ab.
- **Der AMK-Plan ist quellentreu** (`tools/make-amk.mjs`): Geschätztes = `estimated: true` + gestrichelte Kante; wo das Gewerk im Original leer war, sagt es die Notiz.
- **AMK: nur DREI Verknüpfungen** («Leitern runter → sobald Backline und Set weg», Kopplung der «Rigging/Set»-Zeile), **keine dazuerfinden** (`tests/amk.test.mjs`).
- **Abhaken ist persistiert und signaturgebunden** (`ackCrit` bool, `ackConflictMin` Minuten, via `setTaskField`); `findConflicts` überspringt nur, solange `shortBy <= ackConflictMin + EPS`. «Kritisch» bleibt Information (kein automatisches Verschieben), Abhaken blendet nur aus.
- **Eine Quelle für Warnungen:** Zählung, Prüf-Liste, `resolveConflictsCmd` lesen alle `findConflicts`. `gantt.stats()` zählt die sichtbare Ebene, Kritisch/Konflikte den ganzen Plan.
- **Phasen = ART, nicht Name** (`js/phasen.js`, DOM-frei). `state.phases = [{id, art, name?, start, end}]`, `art` ∈ planung · vorbereitung · aufbau · show · abbau. Farbe (Leiste über dem Zeitstrahl, Tönung, Kopfzeilen-Marke «heute: …») und jede Logik («wo beginnt der Aufbau?» → `aufbauPhase`) hängen an der Art; der Name ist freie Beschriftung. **Nie wieder per Regex auf `ph.name` raten** außer in `artAusName` (nur die Migration) — `tests/run.mjs` sperrt Klassen aus dem Namen.
- Phasen derselben Art überlappen nicht; Prüfung `phaseFehler`/`phasenFehler` VOR der Änderung (Store: `addPhase`/`setPhase`/`removePhase`, Undo), und `deserialize` lehnt eine kaputte Phase samt Namen ab. `migrate` lehnt nie ab (Name → Art, sonst `aufbau`; fehlende ids aus der Reihenfolge, idempotent).
- **Show-Tage:** JEDE Show-Phase ist genau EIN Show-Tag (`showTage(phases)` → `{phase, n}`, nach Start durchnummeriert), auch wenn sie über Mitternacht in den Folgetag läuft (Marco: «Fr 18:00–Sa 02:00» ist Show-Tag 1). Nie pro Kalendertag zählen. **«heute»** rechnet gegen die echte Uhr (`liveInfo().now`), nie gegen den Versatz.
- **Import prüft nur id, Art und Spanne** — die Überlappungsregel gilt nur im Store (Altpläne mit geratener gleicher Art dürfen sich überlappen); Phasen ohne lesbare Zeiten entfallen in `migrate`, `deserialize` meldet das als `hinweis`.
- **Neue Phasen-Farben** = Tokens `--ph-<art>`/`--ph-t` in ALLEN fünf Themes, drei Scopes (hell, `prefers-color-scheme: dark`, `[data-theme=dark]`); Schrift >= 4,5:1 prüft `tests/run.mjs` aus den Tokens.
