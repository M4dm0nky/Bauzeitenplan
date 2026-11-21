---
paths:
  - "js/gantt.js"
  - "js/timeaxis.js"
  - "js/schedule.js"
  - "tools/verify-klassentreffen.mjs"
---

# Gantt und Darstellung

- **Zoomstufen in sichtbarer Zeitspanne**, nicht in Pixeln (eine «Tagesansicht» zeigt Tage; Tests).
- **Per Klick Auswählbares gehört in die Tab-Reihenfolge, und was `tabIndex` trägt, reagiert auf Enter UND Leertaste** (`bindMark` in gantt.js, EINE Stelle; Space mit `preventDefault()`; auch Meilenstein-Rauten; Prüfung in `verify-edit.mjs`).
- **Beschriftung läuft nie über den nächsten Balken** (`updateLabels()`, `data-next`; `verify-klassentreffen.mjs`).
- **Achsen-Ticks und Bänder auf `T1` klemmen;** ein Kalendertag füllt bei jeder Breite die Breite.
- **Tagesband und Tagesgrenzen über `naechsteMitternacht` (timeaxis.js), nie `+1440`;** der Tag hat bei der Zeitumstellung 23 oder 25 Stunden. `majBack` (1500 / 10140 / 44700) hält eine Stunde Reserve für den 25-Stunden-Tag.
- **`O.onView` meldet jedes Selbst-Einpassen;** kein `requestAnimationFrame` raten; der ResizeObserver merkt auch Breite **0**.
- **Ein leeres Band ist nur im Bauzeitenplan unsichtbar;** `Math.min(...[])` = `Infinity`, Hülle fällt auf `T0`.
- **Bauzeitenplan: eine Zeile je VORGANGSNAME, ein Balken je Termin** (`seriesRows`; 353 Vorgänge = **153 Zeilen**). Überlappung → **Spuren** (`--lane`, `rowH × lanes`). Marken gelten je Zeile, Umbenennen die Serie. **Die Tabelle bleibt flach.**
- **Showablauf: Balken GEFÜLLT** (`.bz[data-ebene="show"]` in den Themes; gantt.js setzt nur `data-ebene`, `--gw`, `--gw-t`).
- **Showablauf: NICHT bündeln** (`buendeln`): eine Zeile je Zeiteintrag, `lanes` immer 1; `seriesRows` unangetastet.
- **Uhrzeit und Dauer links vor dem Namen** (`bz-lab-zeit`/`bz-lab-dauer`, `tabular-nums`); **Dauer in MINUTEN**, Meilenstein = Strich.
- **Seitenspalte im Showablauf 390 px (sonst 296; Handy 168);** Breite am DOM messen (`sideWNow()`), nicht `O.sideW`.
- **Showablauf-Achse: JEDE Stunde beschriftet** (`ticksFor` `'hour'`), ab `px >= 0.5`.
- **Balken ziehen: Vorschau im DOM, EIN `moveTask` beim Loslassen** (ein ⌘Z); Escape verwirft; unter 4 px bleibt es ein Klick (Auswahl); unveränderte Zeit schreibt nichts.
- **Ziehen rechnet in Differenzen (`dx / px`) über `gezogen`** — der Versatz kürzt sich heraus, gespeichert wird Planzeit; der Hinweis zeigt `verschoben()`. Keine vierte `xp()`-Stelle.
- **Griffe (`.bz-grip`) nur an Blatt-Balken**; Sammelvorgang ohne, Meilenstein nur verschieben (an der Raute). Der Verknüpfen-Kreis (`.bz-link`) sitzt NEBEN dem Ziel (`bz-link-bar` rechts vom Ende, `bz-link-ms` rechts der Raute) und ist beim Ziehen aus (`data-dragging`).
- **Touch: erst 300 ms halten, dann ziehen**; vorher Bewegung > 8 px = Wischen; Halten ohne Bewegung öffnet das Balkenmenü (natives `contextmenu` ist im Zug unterdrückt). Alt+←/→ verschiebt, Alt+Shift+←/→ ändert das Ende (je ein Befehl).
- **Zeitraster rastert die VERSCHIEBUNG, nicht die Lage** (`gezogen`): Uhrzeit bleibt; ab 1440 ganze Kalendertage über `new Date(y,m,d+n,hh,mm)`.
- **Zug robust:** Capture auf `root`, Knoten bei Neuaufbau frisch holen; Maus ohne Taste beendet den Zug; fremde Pointer ignorieren; `touchmove`-Blocker einmal dauerhaft (`passive:false`).
