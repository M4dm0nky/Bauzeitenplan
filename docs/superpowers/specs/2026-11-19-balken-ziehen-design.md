# Balken im Gantt ziehen — Design

Stand 2026-11-19. Marco: «mach alles fertig» + Entscheidung «Nur der Balken». Übrige
Entscheidungen = Claudes Wahl (unten markiert), Marco kann sie zurückdrehen.

## Warum
Zeiten ändern geht heute nur über Tabelle oder Panel. Beim Aufbau am Monitor will man
einen Vorgang greifen und an die neue Stelle ziehen bzw. länger machen.

## Verhalten
- **Verschieben:** Balken in der Mitte greifen → Start und Ende wandern um denselben Betrag
  (Store `moveTask`; Zuweisungsfenster wandern dort schon mit).
- **Dauer:** Griff am rechten Rand → Ende; am linken Rand → Start (Store `moveTask` mit neuem
  start/end). Griffbreite 8 px Maus, 16 px Touch. Mindestdauer = ein Rasterschritt.
- **Nur der Balken** (Marco): Nachfolger bleiben stehen; entsteht ein Konflikt, zeigt ihn die
  vorhandene Konfliktmarke, «Konflikte auflösen» bleibt der Weg zum Nachschieben.
- **Raster (Claudes Wahl):** nach Zoom — Stunden/Tage 15 min, Wochen 1 h, Monate 1 Tag. Beim
  Ziehen zeigt ein Hinweis neue Startzeit, Ende und Dauer (Dauer-Kurzform wie in der Tabelle).
- **Ein Zug = ein Store-Befehl beim Loslassen** → ein ⌘Z. Während des Ziehens nur Vorschau
  (Balken verschoben gezeichnet), kein Store-Schreiben. Escape bricht ab (Balken springt zurück).
  Lehnt der Store ab (z. B. Ende vor Start), springt der Balken zurück und der Grund steht im
  vorhandenen Hinweis/Toast.
- **Nicht ziehbar:** Sammelvorgänge (Hülle, Store lehnt ohnehin ab — Griffe gar nicht anbieten),
  Meilensteine nur verschieben (keine Dauer-Griffe).
- **Klick bleibt Klick:** Erst ab 4 px Bewegung wird gezogen; darunter bleibt es Auswahl. Das
  Verknüpfen-Ziehen (`.bz-link`-Griff) hat Vorrang und bleibt unverändert.
- **Touch (Claudes Wahl):** Ziehen beginnt nach 300 ms Halten ohne Bewegung; vorher scrollt
  Wischen wie bisher.
- **Tastatur (Claudes Wahl):** ausgewählter Balken: Alt+←/→ verschiebt um einen Rasterschritt,
  Alt+Shift+←/→ ändert die Dauer (Ende). Jeder Tastendruck ein Store-Befehl (⌘Z einzeln).
  ←/→ ohne Alt bleibt Blättern.
- **Versatz (Live):** Balken stehen um den Versatz verschoben (`xp`). Die Umrechnung Pixel →
  Planzeit beim Ziehen ist die Umkehrung von `xp`; dafür eine eigene DOM-freie Funktion, KEINE
  vierte `xp()`-Aufrufstelle (Regel in `.claude/rules/live.md`). Gespeichert wird Planzeit.
- **Live-Folgen:** Während des Ziehens folgt die Ansicht nicht der Uhr (die vorhandene
  Folge-Pause nutzen bzw. für die Dauer des Zugs setzen).
- **Showablauf:** Ziehen genauso; gespeichert wird über `moveTask`, das Datumsteile korrekt
  behält (Zeitfelder ohne Datum betreffen nur die Tabelle).
- **Serien-Zeilen** (mehrere Balken in einer Zeile): jeder Balken zieht nur seinen Termin.

## Rechnung DOM-frei
`timeaxis.js` (oder schedule.js): `rasterMin(zoomName)` → 15/60/1440; `schnapp(min, schritt)`;
`gezogen({start, end, modus:'move'|'start'|'end', deltaMin, schritt, milestone})` → `{start, end}`
in Minuten, Mindestdauer und Milestone-Regel eingebaut. Unit-Tests inkl. Sommerzeit-Nacht
(Minuten über `toMin`, Ausgabe über `local(toDate(..))`).

## Abnahme
Neue Prüfungen in `verify-edit.mjs` (Maus: verschieben, Ende ziehen, Escape, Klick bleibt
Auswahl, Sammelvorgang ohne Griffe, Meilenstein ohne Dauer-Griff, ein ⌘Z macht einen Zug
rückgängig, Tastatur Alt+→), in `verify-live.mjs` (mit Versatz: gezogener Balken landet auf der
Planzeit, die der Hinweis zeigte), Touch in `verify-browser.mjs` (Handy: Wischen scrollt, Halten
+ Ziehen verschiebt). Alle neun grün, Screenshots ansehen.
