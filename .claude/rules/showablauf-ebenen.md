---
paths:
  - "js/ebene.js"
  - "js/conflicts.js"
  - "js/gantt.js"
  - "js/table.js"
  - "js/app.js"
  - "tools/verify-showablauf.mjs"
---

# Showablauf und Ebenen

- **`js/ebene.js` ist die einzige Stelle, die die zwei Ebenen kennt.** Bauzeitenplan = GEWERKE, Showablauf = BÜHNEN (Gewerk mit `art:'buehne'`). Gantt, Tabelle, Druck FRAGEN (`sichtGewerke`/`sichtTasks`/`amTag`). Ohne `art` = Gewerk.
- Kein zweiter Store, kein zweites Undo, keine zweite Persistenz. **Ein Gewerk wird nie nachträglich zur Bühne.**
- **Der ZEITEINTRAG trägt den Abschnitt** (`abschnitt: 'setup'|'show'`, fehlt = `show`; `imAbschnitt` filtert). **`sichtGewerke` filtert NICHT.** Zeitfenster je Ansicht: `programmFenster`.
- **Soundcheck = ZEITEINTRAG im Setup** mit `fuer: <taskId>` (Text-id).
- **Der Showablauf ist tagesbezogen;** Gantt und Tabelle bekommen DENSELBEN Tag.
- **Neue Vorgänge landen dort, wo man HINSCHAUT:** `defaultStart()` (table.js) schließt an den letzten Eintrag des gezeigten Tages UND Abschnitts an (`addRow` gibt ihn mit), leerer Tag = 08:00.
- **Kein Typ steht doppelt** (`typHinweis`, ebene.js: normalisiert, in beide Richtungen verglichen).
- **Der Umschalter bleibt** Bauzeitenplan · Setup · Show; eigene Abschnitte zählen über `abschnittOf` zu Show, die Tabelle meldet den Wechsel (`waehleAbschnitt` → `onHinweis`).
- **Zeitfelder im Showablauf tragen KEIN Datum** (im Bauzeitenplan datiert). `mitUhrzeit` behält den Datumsteil; `endeNachStart`: Ende vor Start = Folgetag über den KALENDER, nicht +1440 (`conflicts.js`).
