---
paths:
  - "js/store.js"
  - "js/conflicts.js"
  - "js/persistence.js"
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
