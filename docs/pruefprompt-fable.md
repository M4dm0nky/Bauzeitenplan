# Prüf-Prompt: Bauzeitenplan auf Herz und Nieren (Claude Fable)

Gebrauch: neue Sitzung, Modell Fable (`/model`), den Block unten komplett einfügen.
Danach den Bericht in einer zweiten Sitzung (Sonnet) gegenprüfen lassen:
«Widerlege jeden Fund aus diesem Bericht gegen den Code, wenn möglich.» Erst dann beheben.
Bei Bedarf die Durchgänge 2–6 einzeln laufen lassen statt alle auf einmal.

---

```text
Du prüfst den Bauzeitenplan auf Herz und Nieren. ZUERST NUR LESEN UND AUSPROBIEREN –
ändere keine einzige Datei, bis ich den Bericht freigegeben habe.

## Worum es geht (damit du richtig gewichtest)
- Zweck: Gantt-Ablaufplan für die Veranstaltungsbranche (Aufbau, Showablauf, Abbau,
  Personal und Maschinen). Vanilla JS, ES-Module, kein Build-Step, kein Backend.
  Projekte leben in localStorage + JSON-Export, optional Sync über GitHub.
- Einsatz: Planung am Rechner, im Betrieb läuft der Plan im Live-Modus auf einem
  Monitor; Nutzer sind Techniker und Produktionsleiter unter Zeitdruck. Handy-Bedienung
  ist keine Anforderung (keine Touch-/iPhone-Befunde melden).
  Tagesblätter werden als A3 gedruckt.
- Was nie passieren darf: Plan geht verloren oder wird still überschrieben (localStorage,
  Import, Sync-Konflikt, Service-Worker-Update), falsche Uhrzeit/Jetzt-Linie/Verzug im
  Live-Modus, falscher Ausdruck, Änderungen am Store vorbei ohne Undo.
- Zuerst lesen: CLAUDE.md, .claude/rules/*.md, docs/entscheidungen.md. Was dort bewusst
  so entschieden ist, ist KEIN Fund – es sei denn, die Begründung trägt nachweislich nicht.
- Starten: python3 -m http.server 8080 (am Ende wieder beenden!)
- Prüfskripte (Ergebnis nur gefiltert auf Fehler und Summe einlesen):
    node tests/run.mjs
    node tools/verify-browser.mjs
    node tools/verify-edit.mjs
    node tools/verify-live.mjs
    node tools/verify-amk.mjs
    node tools/verify-klassentreffen.mjs
    node tools/verify-print.mjs
    node tools/verify-showablauf.mjs
    node tools/verify-pb-regeln.mjs
    node tools/verify-mehrbenutzer.mjs
  Ohne `?plan=` fragt der Projektdialog; `?plan=leer` öffnet das aktive (sonst erste) Projekt, sonst den Dialog. Die App holt keinen Plan von selbst.

## Vorgehen – in getrennten Durchgängen, nicht alles auf einmal
1. Überblick: Aufbau, Datenfluss (Store → Render), wo der Zustand lebt, welche
   Module DOM-frei sein sollen (schedule, timeaxis, store, conflicts, persistence,
   ebene, resources, live, sync) und ob sie es sind.
2. Code & Korrektheit: Logikfehler, Randfälle (leerer Plan, sehr großer Plan,
   Sonderzeichen, Mitternacht/Showtag vor 06:00, Sommer-/Winterzeit, Zyklen in
   Verknüpfungen, doppelte IDs), stiller Datenverlust, Fehlerbehandlung,
   toter Code, Sicherheit (escapeHtml überall? Import fremder JSON, Sync-Token).
   Verstößt etwas gegen die Regeln aus CLAUDE.md (Store als einziger Weg,
   Validierung vor Änderung, keine Browser-Dialoge, Zeiten nur über toMin())?
3. Funktionen real ausprobieren: App headless starten und jeden Hauptablauf einmal
   komplett durchspielen – Projekt anlegen, Vorlage wählen, Einträge anlegen/
   verknüpfen/verschieben, Inspector, Kontextmenü, Suche, Showablauf, Bedarf,
   Live-Modus mit gestellter Uhr, Druck, Export/Import, Sync.
   Dazu Fehlbedienung: Abbrechen, Undo/Redo-Ketten, Neuladen mitten im Vorgang,
   offline, zwei Tabs gleichzeitig, Versionswechsel des Service Workers.
   Screenshots ansehen, nicht nur Konsole.
4. Benutzbarkeit: Versteht ein neuer Nutzer ohne Anleitung, was zu tun ist?
   Leere Zustände, Fehlermeldungen, Bestätigungen, Tastatur,
   Kontrast in allen 5 Themes, Lesbarkeit des Live-Modus aus Entfernung,
   Symbole statt Textkürzel, einheitliche Begriffe («Zeiteintrag» usw.).
5. Features & Lücken: Was erwartet ein Produktionsleiter auf einer echten
   Veranstaltung sicher und findet es nicht? Was ist halbfertig, widersprüchlich
   oder überflüssig? Mit den offenen GitHub-Issues abgleichen (gh issue list),
   nichts doppelt melden.
6. Tests: Was prüfen die vorhandenen Tests und verify-Skripte wirklich?
   Wo würde ein absichtlich eingebauter Fehler NICHT auffallen? Nur benennen,
   nicht einbauen.

## Pro Fund
- Ort: Datei:Zeile (oder Ansicht + Klickweg)
- Was passiert, konkret: Eingabe/Zustand → falsches Ergebnis
- Schwere: kritisch / hoch / mittel / niedrig
- Sicherheit: hoch / mittel / niedrig – bei mittel: was müsste ich lesen/testen,
  um sicher zu sein
- Vorschlag zur Behebung (1–2 Sätze, noch nicht umsetzen)

## Regeln
- Keine Stilkritik und kein Auffüllen der Liste. Ist ein Bereich solide, sag das klar.
- Nichts behaupten, was du nicht gelesen oder ausprobiert hast.
- Priorität: Datenverlust > falsche Zeit/Anzeige im Live-Modus > falscher Druck >
  Abstürze > Bedienhürden > Komfort.
- Alle gestarteten Server, Browser und Hintergrundprozesse am Ende beenden.
- Bericht auf Deutsch, kurz und klar.
- Am Ende: Top 5 nach Wirkung, Gesamturteil je Bereich (Ampel grün/gelb/rot),
  und welche Prüfungen du NICHT machen konntest und warum.
```
