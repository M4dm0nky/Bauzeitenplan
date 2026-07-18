# Changelog

Neueste Version oben. Gepflegt beim Versionswechsel (`node tools/version.mjs`),
nicht in `CLAUDE.md` — dort stehen Anweisungen, hier steht Vergangenheit.

## 0.2.1 — 2026-07-18

**Gewerke umsortieren**
- In der Tabellenansicht lässt sich die Reihenfolge der Gewerke jetzt per Drag &
  Drop ändern: den Griff (⠿) am Gruppenkopf greifen und an die gewünschte Stelle
  ziehen (Maus oder Touch). So steht „Produktion" bei dem einen Event ganz oben,
  beim nächsten weiter unten — in einer Geste statt vieler Einzelschritte.
- Die **Farbe bleibt am Gewerk**, nicht an der Position: Umsortieren färbt nichts
  um. Rückgängig per ⌘Z. Die bisherigen „Nach oben/unten" (Rechtsklick & Panel)
  bleiben als präziser Zusatzweg.

## 0.2.0 — 2026-07-18

**CallBoard — Logo & Marke**
- Logo im Kopf: Shield + Clipboard + Uhr (48 px), Wortmarke „CallBoard" mit
  Unterzeile „Bauzeitenplan · Event". Der gelbe Minutenzeiger (#f7c948) ist das
  einzige farbige Element und lebt ausschließlich im Logo.
- Favicon (SVG, passt sich hellem/dunklem Browser-Tab an).

**Neues Theme „callboard" (NYX-Navy-CI) — jetzt aktiv**
- Navy/Paper, ruhig und technisch; Gold nur im Logo, kein UI-Gold mehr.
- Schriften Geist + JetBrains Mono, selbst gehostet unter `assets/fonts/`
  (offline, keine externen Requests).
- **Hell/Dunkel im Kopf umschaltbar** (☾/☀): Hell = Paper, Dunkel = Navy. Die
  Wahl merkt sich der Browser (`bzp_mode`); ohne Wahl folgt die App dem System.

**Nebenbei**
- Kein überflüssiger Reload beim allerersten Besuch mehr — der Service Worker lädt
  nur bei einem echten Update neu, nicht schon beim ersten Übernehmen der Seite.

## 0.1.4 — 2026-07-17

**Import**
- Die Rückfrage bei Namensgleichheit ist jetzt ein Popup im App-Design statt
  des nativen Browser-Dialogs — gleiche Optik wie der Projektdialog, drei klare
  Knöpfe (Ersetzen · Zusätzlich behalten · Abbrechen) mit ausdrücklichem
  Abbrechen, das den Import ganz stoppt

## 0.1.3 — 2026-07-17

**Zeitachse**
- Tagesansicht zeigt das Datum mit Wochentag mittig über den Stunden („Do 27.08.")
- Feinere Stundenraster: 3-Stunden-Schritte (00 · 03 · 06 … 21) statt 6-Stunden

**Import**
- Beim Import fragt die App, ob ein bereits vorhandener Plan gleichen Namens
  ersetzt wird (nur diese Datei laden) oder zusätzlich importiert — keine
  stillen Duplikate mehr; erneuter Import derselben Datei überschreibt sich

**Klassentreffen-Vorlage**
- Neu aus dem Detail-Bauzeitenplan V03 gebaut: echte Uhrzeiten statt Halbtage,
  Dienstleister in der Notiz; mehrfach gelistete Dauer-/Mehrtagestätigkeiten
  (Objektbewachung, Schichten, mehrtägige Auf-/Abbauten) je zu einem Balken
  zusammengefasst
- Zehnter Palettenton (Türkis) für Pläne mit mehr als neun Gewerken

## 0.1.2 — 2026-07-16

**Optik**
- Deutlich heller: heller Modus jetzt auf Weiß (statt gedämpftem Creme),
  dunkler Modus von Fast-Schwarz auf ein angehobenes Schiefergrau — in beiden
  Systemeinstellungen spürbar heller

## 0.1.1 — 2026-07-16

**Bedienung**
- Datums-Navigation in der Toolbar: Feld zum direkten Springen zu einem Tag,
  plus ◀ / ▶ zum tageweisen Blättern (läuft mit dem Sichtfenster mit)
- Tagesansicht zeigt jetzt **einen Kalendertag über die volle Breite**,
  linksbündig auf 00:00 — der „Tage"-Knopf zieht den Tag im Blick auf
- Optik heller (warmes Creme eine Stufe aufgehellt) und Schrift 30 % größer;
  Zeilen, Balken und Achse wachsen proportional mit (`--fs` als ein Regler)

**Palette**
- Neunter Farbton (Ocker) für Pläne mit mehr als acht Gewerken; bis 18 Gewerke
  über Farbe + Schraffur eindeutig. Legende liest Farbe/Schraffur jetzt aus
  `palette.js` statt aus einer zweiten, fest verdrahteten Kopie

**Vorlagen**
- Klassentreffen Festival 2026 als importierbare JSON aus dem PDF-Grobplan
  (17 Gewerke, quellentreu, alle Dauern als geschätzt markiert), erzeugt und
  quellentreu geprüft über `tools/make-klassentreffen.mjs`

## 0.1.0 — 2026-07-16

Erste benannte Version. Der Stand, mit dem du arbeiten kannst.

**Darstellung**
- Gantt mit vier Zoomstufen (Monate/Wochen/Tage/Stunden), bemessen nach
  sichtbarer Zeitspanne statt nach Pixeln
- Abhängigkeiten aller vier Typen (FS/SS/FF/SF) mit Lag, Meilensteine,
  kritischer Pfad, Puffer
- Gewerk-Farben gerechnet statt ausgesucht: 720 Anordnungen durchgeprüft auf
  Unterscheidbarkeit benachbarter Zeilen bei Farbenblindheit. 8 Farbtöne ×
  2 Schraffuren = 16 Gewerke
- Vier Gestaltungsebenen, `console` ist aktiv

**Bearbeiten**
- Tabelle zum schnellen Befüllen, Dauer als Kurzform (`4h`, `1,5h`, `2t`, `1t 4h`)
- Seitenpanel für alle Felder inklusive Verknüpfungen
- Rechtsklick-Menü, Doppelklick benennt an Ort und Stelle um
- Undo/Redo über Schnappschüsse, Auto-Save, JSON-Export
- Konflikte werden benannt («startet 3 h zu früh für …») und auf Knopfdruck
  aufgelöst — nie hinter deinem Rücken

**Live-Modus**
- Zeitlinie läuft mit, Ansicht folgt, laufende Vorgänge leuchten
- Verzug im Klartext («sollte seit 20m laufen»). Der Status wird **nie**
  automatisch gesetzt — sonst sähe der Plan immer nach Plan aus

**Vorlagen**
- Festival (ausgearbeitet), Tour, Corporate, Messe (Gerüste), leer
- AnnenMayKantereit Outdoor Singleshow als importierbare JSON

**Grundlage**
- Kein Build-Step, ES-Module, GitHub Pages
- `sw.js` als Cache-Buster: erzwingt Revalidierung, cacht selbst nichts
- 276 Prüfungen: Unit-Tests plus Verhaltensprüfung im echten Browser
