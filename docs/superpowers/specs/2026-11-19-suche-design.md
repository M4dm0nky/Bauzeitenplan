# Suche «Schnell finden» — Design

Stand 2026-11-19, von Marco freigegeben («ja» auf den Entwurf).

## Warum

Im Bauzeitenplan stehen 353 Vorgänge in 153 Zeilen über 14 Tage. Ruft jemand an
(«wann kommt der Kran?»), findet man den Vorgang heute nur durch Scrollen.

## Ziel

Tippen → Trefferliste → Enter/Klick → die Achse springt auf den Tag, die Zeile
steht im Bild, der Vorgang ist ausgewählt (Panel offen). Der Rest des Plans
bleibt sichtbar (kein Filter).

**Nicht-Ziel:** Filtern/Ausblenden, Gewerke-Filter, Suche über beide Modi.
**Anti-Ziel:** ⌘F überschreiben; ein zweiter Such-Algorithmus neben dem des
Verknüpfungs-Pickers.

## Entscheidungen

- **Ort:** Kopfzeile, Feld «🔍 Suchen…» vor «🖨 Drucken». Handy: nur 🔍-Knopf,
  Antippen öffnet das Feld über der Kopfzeile. Knopfzahl steigt auf 14/12
  (CLAUDE.md nachziehen, Zählprüfung in verify-browser anpassen).
- **Was gefunden wird:** Titel, Gewerk-/Bühnenname, Notiz, Kontakt — ohne
  Groß-/Kleinschreibung, Teilwort. Nur der aktive Modus (Bauzeitenplan: Gewerke;
  Showablauf: Zeiteinträge aller Showtage und Abschnitte).
- **Liste:** gruppiert nach Gewerk/Bühne, je Gruppe nach `byStart`; Zeile =
  Titel + Datum/Uhrzeit. Wiederkehrende Vorgänge = je Termin ein Treffer.
  Höchstens 50 Treffer, danach «… N weitere – genauer suchen».
- **Rechnung DOM-frei:** neue Funktion in `schedule.js` (`suchTreffer`), die die
  Gruppierung mit `candidateGroups` TEILT (eine Hilfsfunktion, kein Duplikat).
  Unit-Tests.
- **Sprung:** Bauzeitenplan → `goToDay(tag)` + Zeile ins Bild (inkl. Gruppenzeile,
  wie beim Start) + `select`. Zugeklappte Gruppe / zugeklappter Sammelvorgang wird
  dafür aufgeklappt. Showablauf → Showtag und Abschnitt der Ansicht wechseln über
  die vorhandenen Schreiber (`setAnsicht`, Tageswahl), dann wie oben. In der
  Tabellen-Ansicht: Zeile ins Bild und markieren.
- **Bedienung:** `/` fokussiert das Feld (nicht in Eingabefeldern), ↑/↓ wählt,
  Enter springt, Escape schließt und leert. Liste über `openMenu`-Muster oder ein
  eigener schwebender Kasten im Stil der App — Umsetzer wählt, Tastatur und
  Klick-daneben müssen gehen. Keine Browser-Dialoge.
- **Leer/kein Treffer:** «Nichts gefunden für «xyz»».

## Rahmen

Branch `feat/suche` ab `main` (nach dem CLAUDE.md-Branch rebasen). Regeln aus
CLAUDE.md. Abnahme: alle neun Prüfungen grün, Screenshots Desktop + Handy.
Halt vor Versionsnummer, Push, Tag.
