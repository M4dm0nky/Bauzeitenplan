# Changelog

Neueste Version oben. Gepflegt beim Versionswechsel (`node tools/version.mjs`),
nicht in `CLAUDE.md` — dort stehen Anweisungen, hier steht Vergangenheit.

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
