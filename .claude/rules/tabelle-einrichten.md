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
- Sichtbare `button`/`input`/`select` in `.hd-bar` (Klassentreffen, eine Bühne, ohne Live/Konflikt): **16 Bauzeitenplan, 14 Showablauf** (inkl. `#proj-knopf`, `#drucken`, `#suche`, `#theme-toggle`). Zoom = `openMenu`.
- **Neuer Knopf:** erst den Modus nennen, in dem er etwas bedeutet, im anderen ausblenden.
- **Einrichten ist eine SEITE derselben App** (`#ein-seite`, `js/einrichten.js`; `app.js` `openEinrichten`/`closeEinrichten`): `.col.ist-ein` verbirgt Kopfzeile, Fuß und `.work` (nur unsichtbar und aus dem Fluss, NIE `display:none` — sonst verliert der Gantt Scrollstand und Einpassung); `#rail-ein` ist gedrückt, solange sie offen ist (`rail.setEinrichten`). Fünf Bereiche mit Status (`einrichtStatus`); Speicherort ist KEIN Bereich, sondern der Dialog `#sync-dlg` (`openEinrichten('sync')` öffnet ihn). Escape schließt nur einen Dialog darüber, nie die Seite. Neuaufbau nur über `refresh()` (Werte an Ort und Stelle, das Feld mit dem Cursor bleibt unberührt). Prüfwerkzeuge gehen über `tools/ui-helfer.mjs` (`einrichten`, `zumPlan`, `projektMenue`), nie über rohe Klickfolgen.
- **Erstes Einrichten:** nur «Neu» setzt `eingerichtet=false` und ruft `openEinrichten('projekt', {erst:true})`; `.ein-erst` macht `.ein-nav` zur Schrittleiste, `.ein-schritt` hat `#ein-zurueck`/`#ein-weiter`, `#ein-zu` heißt in Schritt 5 «Fertig». `closeEinrichten` sendet bei `false` EIN `setProjectField eingerichtet true`; ein anderes Projekt schließt die Seite.
- **Projektmenü in der Kopfzeile** (`#proj-knopf` in `.hd-right` vor `#drucken`, `openMenu`; `app.js` `projektMenue`): Einträge `#new-proj`, `#proj-menu`, `#import`, `#export`, `#sync-oeffnen` (`id` am `openMenu`-Item). Nichts davon steht dauerhaft im DOM; die Handler sind benannte Funktionen (`neuesProjekt`, `projekteWaehlen`, `importieren`, `exportieren`, `oeffneSpeicherort`). `#import-file` hängt auf Modulebene (Erststart ohne Projekt). Speicherort-Dialog `#sync-dlg` (Escape, Klick daneben, «Schließen»).
- **Bereiche 3–5 sind direkt bearbeitbar** (`einrichten.js`): Gewerke/Bühnen als eigene Zeilen (`.ein-gw-z`, Farbfeld `.ein-gw-farbe`, ↑↓ über `moveGewerk` wegen der gemeinsamen Reihenfolge, × über `loescheGewerk(id)` in app.js = dieselbe Rückfrage wie der Rechtsklick), Personal/Maschinen/Arten/Abschnitte über `mountAuswahlListe` (`listen-editor.js`). Es gibt keine «Verwalten…»-Knöpfe auf der Seite mehr; `#add-gewerk`/`#add-buehne` sind Knöpfe der Seite. `theme-toggle` zog später in die Kopfzeile rechts um (Hell/Dunkel ist ein Dauerschalter, kein Einrichten); je Reiter eine `.ei-sec` mit `data-ein-tab`.
- **«Plan verschieben…» (`#plan-verschieben`, Reiter Projekt)** öffnet `showShiftDialog` (app.js): Tage und Stunden:Minuten (`h:mm`, `-h:mm` oder reine Minuten, Textfeld `inputmode=numeric`, Store bleibt `{tage, minuten}`), Vorschau «Aufbaubeginn alt → neu», ein `shiftPlan` = ein ⌘Z. Die Vorschau rechnet über den Kalender wie der Store, nie auf Ziffern.
- **Verwalten-Kästen von außen:** `table.openVerwalten(opt, ankerEl)`, `table.openNeuFragen(...)`.
- **Start · Ende · Dauer sind ein ENTWURF** (`js/entwurf.js`, Rechnung DOM-frei in `conflicts.js`: `entwurfAendern`/`entwurfFehler`). Tabelle (beide Ebenen), Panel und Soundcheck im Panel (`.ins-sc-zeile`, Beginn · Dauer · Ende) ändern erst nur die Felder; Zeile/Gruppe gelb (`is-entwurf`), ✓ ✗ erscheinen. ✓ oder Enter = EIN `moveTask` (zwei leere Felder = «ohne Termin»); ✗, Escape oder Fokus aus Start/Dauer/Ende verwirft. Ungültig → ✓ gesperrt, Grund daneben. Der Entwurf berührt den Store nicht, also kein Neuaufbau beim Tippen (die `commitOn`-Aufschiebung gilt hier nicht mehr); ✓/✗ halten per `mousedown`-preventDefault den Fokus, die Dauer (Textfeld) öffnet den Entwurf schon bei `input`, nicht erst bei `change`. Prüfwerkzeuge klicken ✓, sie verlassen das Feld nicht per `blur()`/Tab.
