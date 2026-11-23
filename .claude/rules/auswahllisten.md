---
paths:
  - "js/store.js"
  - "js/ebene.js"
  - "js/table.js"
  - "js/listen-editor.js"
  - "tests/store.test.mjs"
---

# Auswahllisten, Arten, Abschnitte

- **Auswahllisten (Arten, Abschnitte, Ressourcen): dieselben drei Befehle** `setAuswahlLabel`, `removeAuswahl`, `reorderAuswahl` (`liste: 'punktTypen'|'abschnitte'|'ressourcen'`).
- **Umbenennen ändert nur das Label, nie die id.** Gelöscht wird nur, was niemand benutzt (Knopf vorher gesperrt UND sagt warum). **Sortieren setzt `sort` bei ALLEN oder keinem** (`reorderAuswahl` lehnt Teillisten ab).
- **Welches Feld auf welche Liste zeigt, weiß NUR der Store** (`LISTEN`, `benutztVon`); Sortierung nur in `nachSort` (ebene.js): `?? Infinity`, nie `?? 0`.
- **Eintragsarten: eingebaute `PUNKT_TYPEN` (ebene.js, Feld `kompakt`), eigene im PLAN** (`project.punktTypen`, im Export). `punktTypen(state)` führt beide zusammen; Dropdown, `typHinweis`, Druckblatt fragen nur dort.
- Neue Art/Abschnitt entsteht im Auswahlfeld der Tabelle («+ Neue Art…»/«Neu»), an keinem zweiten Ort.
- **`store.js` führt die eingebauten Arten DOPPELT;** `tests/store.test.mjs` vergleicht gegen `PUNKT_TYPEN` (doppelt nur mit Test).
- **Eigene Abschnitte** (`project.abschnitte`, `abschnitte(state)`) FILTERN weiter nur nach Setup/Show; Sortierung nach frühestem Eintrag, leere hinten.
- **Verwalten-Liste = `mountAuswahlListe` (`js/listen-editor.js`)**, eine Stelle für das schwebende «Verwalten» der Tabelle UND die eingebetteten Listen der Einrichten-Seite (Option `kind` filtert Personal/Maschinen; Sortieren schickt trotzdem ALLE ids an `reorderAuswahl`). Keine zweite Listenlogik.
