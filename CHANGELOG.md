# Changelog

Neueste Version oben. Gepflegt beim Versionswechsel (`node tools/version.mjs`),
nicht in `CLAUDE.md` — dort stehen Anweisungen, hier steht Vergangenheit.

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
