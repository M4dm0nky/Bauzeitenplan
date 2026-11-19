---
paths:
  - "js/live.js"
  - "js/gantt.js"
  - "js/app.js"
  - "tools/verify-live.mjs"
---

# Zeit und Live

- **`nowInZone` darf nie stumm zurückfallen** (`gantt.js`): `hourCycle: 'h23'` (nicht `hour12: false`), `replace(/\s+/, 'T')`; bei Fehler lokale Zeit PLUS Warnung. Test: **zwei Betrachter in verschiedenen Zonen** (`verify-live.mjs`).
- **Die Jetzt-Linie tickt IMMER** (`startTicking()`, 15 s), ohne `layout()`: nur `paintNow()`/`paintLive()`.
- **Status wird nie automatisch gesetzt** (Verzug in `js/live.js`).
- **Der Versatz verschiebt den ABLAUF, nie die UHR** (`versatz`, positiv = Delay): Balken wandern; Achse, Ticks, Bänder, JETZT-Linie bleiben echt.
- **Zwei Abbildungen Zeit → Pixel:** `x()` echt, `xp()` Ablauf; genau DREI Stellen rufen `xp()`: `place()`, `updateLabels()`, `depAnchors()`.
- **`live.js` kennt den Versatz nicht:** es bekommt `nowPlan() = NOW − versatz`. **Die Show-Kopfzeile zeigt `now`, nicht `planNow`.** Angezeigte Zeiten laufen durch `verschoben()`, relative nicht.
- **Der Versatz gehört dem Abend:** `localStorage`, NICHT im Export, nur am Setz-Tag (`{min, tag}`), beim Projektwechsel 0.
- **Im Showablauf sagt das Verzugsfeld nie «im Plan», solange etwas läuft** (`verify-showablauf.mjs`).
- **Verzug in der Live-Kopfzeile zählt nur, was aussteht oder läuft** — gefiltert wird die ANZEIGE, nicht die Rechnung (`delaysAt`).
