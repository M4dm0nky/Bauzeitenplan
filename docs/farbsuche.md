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
