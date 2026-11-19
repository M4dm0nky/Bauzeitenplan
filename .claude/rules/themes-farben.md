---
paths:
  - "styles/**"
  - "js/palette.js"
  - "tools/farbsuche.mjs"
---

# Themes und Farben

- **Gewerk-Farben (`styles/base.css`, `--gw-*`) nicht per Hand ändern** (Suchlauf `tools/farbsuche.mjs`, 720 Varianten): neu rechnen statt raten.
- **Jeder Farbton hat eine gerechnete SCHRIFTFARBE (`--gw-t-*`)**, in **hell UND dunkel** über **3:1**, feste Werte, NIE ein Dunkel-Override. Wer `--gw-*` ändert, rechnet mit (Prüfung «Schrift auf Gewerkfarbe hält 3:1»).
- **Farbe: Programmpunkt wählbar, Gewerk nicht:** `slot` am Vorgang (null = erbt Bühne), zehn Töne + Schraffur (`slotAus`/`hueVon`), nie eine freie Farbe.
- **Farbplätze je EBENE** (`freeSlot(state, art)`); `slotsExhausted` gegen die Bänder der AKTIVEN Ebene, nie `gewerke.length`.
- **Themes: Gestaltung in `styles/themes/`, Geometrie in `base.css`;** kein Theme definiert Gewerk-Farben neu; jedes braucht beide Dunkel-Scopes (`@media prefers-color-scheme` **und** `:root[data-theme="dark"]`). `docs/themes.md`.
- **`bz-bereit` braucht KEINE Theme-Anpassung** (`outline: dashed currentColor`), steht nicht in `needed`; wie `is-estimated`.
