# Farbsuche

Beleg für die Gewerk-Palette. `node tools/farbsuche.mjs` rechnet die Zuordnung neu.

Das Skript hält Licht = Gelb und Pyro = Rot fest (starke Semantik) und probiert die
übrigen 720 Anordnungen durch. Bewertet wird die Unterscheidbarkeit **benachbarter
Zeilen** unter simulierter Farbenblindheit — im Gantt stehen benachbarte Gewerke
direkt untereinander, deshalb zählen genau die Nachbarpaare. Geprüft wird gegen alle
vier Theme-Oberflächen plus den Dunkelmodus.

80 von 720 Anordnungen bestehen alle harten Gates. Vier liegen gleichauf am
theoretischen Maximum (CVD ΔE 8,4 / Normalsicht 19,3). Unter diesen wurde nach
Semantik entschieden: Bühne = Baustellen-Orange, Sanitär = Grün.

Das Skript braucht den `dataviz`-Skill-Validator. Liegt der woanders, den Importpfad
oben in der Datei anpassen.

## Ergebnis

| Gewerk | Hell | Dunkel |
|---|---|---|
| Bühne | `#eb6834` | `#d95926` |
| Rigging | `#1baf7a` | `#199e70` |
| Licht | `#eda100` | `#c98500` |
| Ton | `#e87ba4` | `#d55181` |
| Video | `#2a78d6` | `#3987e5` |
| Pyro | `#e34948` | `#e66767` |
| Catering | `#4a3aa7` | `#9085e9` |
| Sanitär | `#008300` | `#008300` |

Steht in `styles/base.css`. **Nicht per Hand ändern** — siehe docs/entscheidungen.md.

Für Pläne mit mehr als acht Gewerken kamen später zwei Töne **außerhalb** dieser
Suche dazu (handgesetzt, auf Ansage): Ocker `--gw-8` (`#8a5a2b`/`#a06a33`) und Türkis
`--gw-9` (`#0e9aa7`/`#1fb0bd`). Palette heute: 10 Töne × 2 Schraffuren = 20 Plätze.
Sauber wäre, die Suche für zehn Töne neu zu rechnen, falls der Bedarf bleibt.

## Was die Suche NICHT abdeckt

Drei Lücken, damit niemand mehr Sicherheit annimmt, als die Zahlen hergeben:

- **Das aktive Theme ist nicht unter den geprüften Oberflächen.** `SURFACES` in
  `tools/farbsuche.mjs` kennt blueprint, studio, console und board — `callboard`
  kam später dazu und fehlt. Sein Paper (`#F1EFE9`) ist dabei nicht etwa von den
  vier eingerahmt, sondern eine Spur **dunkler als die dunkelste** geprüfte
  Fläche (console, `#f6f3ec`). Der Unterschied ist klein, aber die Aussage «in
  allen Themes validiert» stimmt für callboard streng genommen nicht.
- **Nur die ersten acht Töne.** Ocker und Türkis sind handgesetzt, siehe oben.
- **Nur der Balken gegen den Grund**, nicht die Schrift AUF dem Balken. Die
  `--gw-t-*` sind separat gerechnet und stehen in `docs/themes.md`; die
  statische Prüfung «Schrift auf Gewerkfarbe hält 3:1» in `tests/run.mjs`
  bewacht sie.

Die erste Lücke zu schließen heißt, die Suche neu laufen zu lassen — und das
kann eine **andere Zuordnung** ergeben. Das ist eine Entscheidung, keine
Wartung: die Reihenfolge steckt in jedem gespeicherten Plan (`slot` je Gewerk),
und ein Neulauf färbt bestehende Pläne um.
