---
paths:
  - "print.html"
  - "js/print.js"
  - "styles/print.css"
  - "tools/verify-print.mjs"
---

# Druck

- **Die Tagesblätter sind eine eigene Seite** (`print.html` + `js/print.js` + `styles/print.css`, A3 quer je Tag): **Auswahl → Zeitfenster → Blatt**, Fenster gemeinsam; Zuschnitt `tagesScheiben`; über Mitternacht = beide Blätter.
- **Tagesgrenzen über den Kalender, nie `+ 1440` Minuten** (`naechsterTag` in schedule.js; Fenster-Stunden als Wanduhr, 24 = echte Mitternacht): der 25.10.2026 hat 25, der 29.03.2026 23 Stunden (`tests/schedule.test.mjs`, `verify-print.mjs`).
- **Auf dem Blatt steht kein Text IM Balken** (Namensspalte). Schriftgrößen an der Zeilenhöhe (`--pr-titel`/`--pr-notiz`); die Notizzeile fällt weg, bevor sie unlesbar wird, statt die Zeile darüber anzuschneiden.
- **Running-Order-Blatt kennt den Abschnitt** (Setup · Show · beides; `?abschnitt=`); Bauzeitenplan-Blätter zeigen nie Bühnen.
- **Running-Order-Blatt = LISTE** (`roBlatt`), leere Felder als Linie, Zeilenhöhe GEWICHTET (Umbau 0,62).
- **`Element.append()` gibt `undefined` zurück:** erst füllen, dann anhängen.
