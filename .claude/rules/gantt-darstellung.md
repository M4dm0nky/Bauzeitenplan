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
- **Griffe (`.bz-grip`) nur an Blatt-Balken**; Sammelvorgang ohne, Meilenstein nur verschieben (an der Beschriftung, die Raute deckt `.bz-link`). `.bz-link` hat Vorrang, deshalb ist der rechte Griff 20 px breit.
- **Touch: erst 300 ms halten, dann ziehen**; vorher Bewegung > 8 px = Wischen. Alt+←/→ verschiebt, Alt+Shift+←/→ ändert das Ende (je ein Befehl).
