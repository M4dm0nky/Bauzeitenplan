---
paths:
  - "js/table.js"
  - "js/app.js"
  - "js/inspector.js"
  - "js/menu.js"
  - "js/rail.js"
  - "js/suche.js"
  - "index.html"
---

# Tabelle, Bedienung, Einrichten

- **Tabelle: `render()` wartet, solange in dem Feld getippt wird, das ihn auslöste** (NUR dieses Feld). Nachholen beim `focusout`; Fokus in ein anderes Feld derselben Tabelle zieht mit. Kein Fokus-Wiederherstellen, `document.activeElement` nicht sofort prüfen.
- **In der Tabelle nur `change`, nie zusätzlich `blur`.** Handler lesen frisch aus dem Store (`cur(id)`), nie aus der Closure.
- **Schwebende Kästen merken ihre Position BEIM ÖFFNEN** (`platziere()` nimmt ein Rechteck).
- **Die Tabelle bleibt EIN Modul** (Spaltensätze `SPALTEN.bau`/`SPALTEN.show`); Showablauf `c-start`/`c-end` 112 statt 175 px.
- **DREI Ansichten, zwei Ebenen plus Abschnitt:** EIN Umschalter (Bauzeitenplan · Setup · Show), genau einer gedrückt. `setAnsicht()` in app.js ist einziger Schreiber von `ansicht`/`ebene`/`abschnitt` (`ebeneVon`, `abschnittVon`).
- `?ansicht=bau|setup|show` steuert von außen; `?ebene=`/`?abschnitt=` werden übersetzt.
- **Zwei gleich aussehende `.seg`-Gruppen nebeneinander sind EINE Gruppe:** absetzen oder zusammenlegen; `.ein-reiter` steht allein in seiner Zeile.
- **Die Schiene (`js/rail.js`) trägt nur den MODUS** (Bauzeitenplan, Showablauf, Einrichten), rendert nur, meldet per `on.modus`/`on.einrichten`. **Nichts Wachsendes hinein** (keine Tage).
- **Tagwahl nur über den Kalender-Knopf, nur Tage aus dem Plan** (`tagWahl`/`planTage`, `programmTage(sichtTasks(state, ebene))`): EIN Knopf für beide Modi, via `openMenu` (`.mn` `max-height: 62vh`); `syncTagKnopf()` einziger Schreiber.
- **Was im Modus nichts bedeutet, steht nicht da:** `setAnsicht()` blendet `#seg-abschnitt` außerhalb Showablauf, `.hd-zoom` außerhalb Bauzeitenplan+Plan aus; `syncBuehnen()` nur im Showablauf.
- Sichtbare `button`/`input`/`select` in `.hd-bar` (Klassentreffen, eine Bühne, ohne Live/Konflikt): **14 Bauzeitenplan, 12 Showablauf** (inkl. `#drucken`, `#suche`). Zoom = `openMenu`.
- **Neuer Knopf:** erst den Modus nennen, in dem er etwas bedeutet, im anderen ausblenden.
- **Einrichten ist ein FENSTER** (`#ein-dlg`, vier Reiter). Ein Knopf liegt in EINEM Reiter; Prüfwerkzeuge klicken vorher `#rail-ein` UND `[data-ein="…"]`.
- **Umgezogene Knöpfe behalten ids und Handler** (`#export`, `#import`, `#new-proj`, `#proj-menu`, `#add-gewerk` in `[data-ein="baender"]`, `#theme-toggle`; je Reiter eine `.ei-sec` mit `data-ein-tab`).
- **Verwalten-Kästen von außen:** `table.openVerwalten(opt, ankerEl)`, `table.openNeuFragen(...)`.
