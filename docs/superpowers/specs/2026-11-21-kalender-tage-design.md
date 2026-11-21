# Kalendertage statt +1440 Minuten — Entwurf (2026-11-21)

**Anlass:** Final-Review des Prüfpakets (v0.20.0): dieselbe Rechnung «Tag = 1440 Minuten», die beim Druck schon korrigiert war, steckt noch an vier Stellen. Am 25.10.2026 hat der Tag 25 Stunden, am 29.03.2026 nur 23.

**Ziel:** Jede Tagesgrenze und jeder «ein Tag weiter» kommt aus dem lokalen Kalender (`new Date(y, m, d + 1, …)`), nie aus `+ 1440`. Durations (Dauer-Kurzform, Vorlagen, Pixel je Tag) bleiben Minuten — sie sind keine Kalendergrenzen.

**Nicht-Ziele:** Tick-Beschriftung der doppelten 02:00-Stunde (bekannte Modellgrenze), Zeitzonen-Umschaltung zur Laufzeit.

## Die vier Stellen

| # | Ort | Heute | Wirkung | Soll |
|---|---|---|---|---|
| 1 | `js/gantt.js` `zeigeBalkenDesTages` | `d1 = d0 + 1440` | 25.10.: letzte Stunde fehlt; 29.03.: Stunde des Folgetags zählt mit → Sprung zum falschen Gewerk | `d1 = naechsteMitternacht(d0)` |
| 2 | `js/gantt.js` `majSpan`/`majBack` | Tagesband 1440 min, Woche 10080 | 25.10.: Band eine Stunde zu kurz, Lücke, Datum nicht mittig; 29.03.: Überlappung | Band = nächste Mitternacht − Tickbeginn; Woche = 7 Kalendertage; Suchfenster 25 h / 169 h / 31 Tage + 1 h |
| 3 | `js/bedarf.js` + `js/resources.js` `bedarfsRaster` | Tagesscheiben `von + i·1440` ab Projektstart | nach der Umstellung liegen alle Grenzen eine Stunde neben der Tagesgrenze; 23:30 landet im falschen Tag | `schritt: 'tag'` → Grenzen über den Kalender (`rasterGrenzen`), Beschriftung aus denselben Grenzen |
| 4 | `js/phasen-editor.js` neue Phase | `end = start + 1440` | am Umstellungstag endet die Phase 23:00 bzw. 01:00 | `verschiebeZeit(start, 1, 0)` (store.js) |

## Ansätze

- **A (gewählt):** zwei kleine DOM-freie Helfer (`naechsteMitternacht` in timeaxis.js, `rasterGrenzen` in resources.js), Aufrufer umstellen, bestehenden Helfer `verschiebeZeit` wiederverwenden. Minimal, testbar.
- **B:** Zeitachse intern auf Kalendertage umbauen (Tag-Index statt Minuten). Zu groß, berührt Zoom und Pixelrechnung ohne Nutzen.
- **C:** nur die Gantt-Stellen. Lässt Bedarf und Phasen-Editor falsch.

## Prüfung

- Unit: `tests/timeaxis.test.mjs` (Mitternacht über 24./25.10. und 28./29.03.), `tests/resources.test.mjs` (Tagesraster über den 25.10.: Scheibengrenzen auf Mitternacht, Vorgang 23:30 im richtigen Tag, 25.10. hat 25 h).
- Browser: `tools/verify-edit.mjs`: Zoom «Tag» am 25.10. → Datumsband reicht bis zur echten Mitternacht (Breite 25 h); Tagessprung am 25.10. findet einen Vorgang 23:30; «+ Phase» am 24.10. endet um dieselbe Uhrzeit am 25.10.
- Rot-Nachweis je Check.
