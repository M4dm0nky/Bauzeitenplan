# UI-Paket aus dem Review — Design

Stand 2026-11-19. Marco hat die Liste bestätigt und die Entscheidungen übergeben
(«ja mach weiter»). Alle Entscheidungen unten sind **Claudes Wahl**, mit Grund —
Marco kann jede einzeln zurückdrehen.

## Ziel

Die acht im Review per Screenshot belegten Bedienschwächen beheben. Jede bekommt
eine Prüfung in einem `tools/verify-*.mjs`, die vor der Änderung rot ist.

**Nicht-Ziel:** neue Funktionen (Suche, Balken ziehen, Export-Formate), neues
Bedienkonzept, Theme-Gestaltung. **Anti-Ziel:** mehr sichtbare Knöpfe als nötig —
die Regel «Was im aktiven Modus nichts bedeutet, steht nicht da» gilt weiter.

## Entscheidungen

| # | Schwäche | Entscheidung | Grund / verworfen |
|---|---|---|---|
| 1 | App öffnet auf «heute», auch wenn dort nichts liegt → leeres Blatt (z. B. Fr 21.08. im Klassentreffen-Plan, auf dem Handy ganz ohne Balken). | `initialFocus()` (gantt.js ~1335) nimmt «jetzt» nur, wenn an diesem Kalendertag ein Vorgang der sichtbaren Ebene liegt; sonst den nächsten Tag MIT Vorgängen ab heute, sonst den letzten. Gleiches beim Ebenenwechsel (~1433). Tage kommen aus `programmTage` (ebene.js) — keine zweite Tagesrechnung. Die Jetzt-Linie bleibt auf der echten Zeit. | Verworfen: immer auf Planbeginn springen — während des Aufbaus will man «heute» sehen. |
| 2 | Druckvorschau links abgeschnitten (`.pr-sheets` zentriert ein 400 mm breites Blatt per Flexbox; linker Überlauf unerreichbar). | Am Bildschirm wird das Blatt auf die Fensterbreite **eingepasst** (Maßstab ≤ 1, nur `@media screen`); der Druck bleibt 1:1. | Verworfen: nur links ausrichten — Blatt dann rechts abgeschnitten, man scrollt quer durch ein A3. |
| 3 | Handy (390×844): Kopf belegt ~470 px. | Auf schmalen Bildschirmen: Untertitel (Ort) ausblenden, Titel einzeilig mit «…», Kennzahlen in EINER Zeile kompakt (klein, kein Umbruch). Kein Bedienelement fällt weg; Touch-Höhe 40 px bleibt. **Messbar:** Kopf ≤ 300 px in Bauzeitenplan und Showablauf. | Verworfen: Kennzahlen ausblenden — «kritisch»/Konflikte sind Warnungen, die müssen sichtbar bleiben. |
| 4 | Leere Zustände ohne Knopf. | Leere Tabelle: Knopf «+ Vorgang» bzw. «+ Zeiteintrag» (derselbe Weg wie der vorhandene Anlegen-Knopf). Kein Gewerk/keine Bühne: «+ Gewerk»/«+ Bühne». Bedarf ohne Bezeichnungen: Knopf, der Einrichten → Personal & Maschinen öffnet. | — |
| 5 | Live-Modus: ⚠ an fast jeder Zeile (jeder vergangene, nie abgehakte Vorgang gilt als verspätet). | Das ⚠ an der Zeile folgt derselben Regel wie die Live-Kopfzeile seit v0.9: nur was **noch aussteht oder läuft**. Die Regel wandert als DOM-freie Funktion nach `live.js` und wird von Kopfzeile UND Zeilen benutzt (eine Quelle). `delaysAt` selbst bleibt unverändert (Regel «Status wird nie automatisch gesetzt» — gefiltert wird die Anzeige). | Verworfen: Zeitfenster (z. B. 12 h) — willkürlich, und wiche von der Kopfzeile ab. |
| 6 | Tooltip bleibt stehen, wenn das Panel aufgeht. | Tooltip verschwindet bei Klick/Auswahl (`hideTip()` aus gantt.js, gerufen beim Auswählen). | — |
| 7 | Zoomstufe ist ein graues Browser-Klappmenü. | Knopf im App-Stil mit der aktuellen Stufe und «▾», öffnet `openMenu` (js/menu.js) mit Monate/Wochen/Tage/Stunden. Gleiche Breite wie bisher. | Verworfen: Segmentgruppe — zu breit (Kommentar index.html ~125). |
| 8 | Export und Drucken nur im Einrichten-Fenster. | EIN Knopf «🖨 Drucken» rechts in der Kopfzeile, in beiden Modi (Drucken bedeutet in beiden etwas: Tagesblätter bzw. Running Order — der Knopf übergibt den Modus). Export bleibt in Einrichten (seltene Handlung, Sicherung). Knopfzählung in CLAUDE.md wird 13/11. | Verworfen: beide Knöpfe in die Kopfzeile — Export ist selten. |

## Rahmen

- Branch `ui/review-paket` ab `main` (v0.15.0), eigener Worktree.
- Regeln aus CLAUDE.md: keine Browser-Standarddialoge, Symbole statt Textkürzel,
  Themes bekommen neue Bausteine (`needed`-Liste in tests/run.mjs), beide
  Dunkel-Scopes, Kern DOM-frei, Screenshots ansehen.
- Abnahme: alle neun Prüfungen grün, Screenshots Desktop + Handy angesehen.
- Halt vor: Versionsnummer (Marco), Push `main`, Tag.

## Dem Umsetzer überlassen

Genaue CSS-Werte für den Handy-Kopf (solange ≤ 300 px und nichts überläuft);
wie der Druck-Knopf den Modus übergibt (`?ansicht=`/`?ebene=` gibt es schon);
Symbol im Zoom-Knopf.
