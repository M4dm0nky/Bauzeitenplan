# Balken ziehen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Vorgänge im Gantt per Maus, Touch und Tastatur verschieben und in der Dauer ändern.
**Spec:** docs/superpowers/specs/2026-11-19-balken-ziehen-design.md

## Global Constraints
- Store ist der einzige Weg (`moveTask`); ein Zug = ein Befehl beim Loslassen; ⌘Z einzeln.
- Kernmodule DOM-frei; Zeitrechnung über `toMin()`/`toDate()`/`local()`, nie über Ziffern.
- Genau drei Stellen rufen `xp()` (place, updateLabels, depAnchors) — Umkehrung als eigene Funktion.
- Der 15-s-Tick ruft nie `layout()`. Was `tabIndex` trägt, reagiert auf Enter und Leertaste (unverändert).
- Nie `window.prompt/confirm/alert`. Neue Theme-Klassen → `needed`-Liste + alle fünf Themes, oder Tokens/currentColor.
- Kein git stash, keine Warteschleifen, Vordergrund-Läufe; Prozesse am Ende beendet. Version nicht stempeln, nicht pushen.

## Review Focus
- Klick ohne Bewegung bleibt Auswahl (Panel öffnet) — Ziehen darf das Anklicken nicht kaputt machen.
- Verknüpfen-Griff (`.bz-link`) und Balken-Ziehen kommen sich nicht in die Quere.
- Versatz ≠ 0: gespeicherte Zeit = angezeigte Hinweiszeit minus Versatz-Darstellung (Planzeit).
- Handy: Wischen über Balken scrollt weiter (kein versehentliches Verschieben).
- Ziehen über Mitternacht / Sommerzeit-Nacht: Dauer bleibt in echten Minuten erhalten.

### Task 1: Rechnung (DOM-frei)
**Files:** `js/timeaxis.js` (oder schedule.js, Umsetzer wählt passend), Tests `tests/timeaxis.test.mjs`.
**Produces:** `rasterMin(zoomName) → 15|60|1440`; `schnapp(min, schritt) → min`; `gezogen({start, end, modus, deltaMin, schritt, milestone}) → {start, end}` (Minuten); Umkehrung Pixel→Planminute als reine Funktion `planMinute(xPx, {T0, px, versatz})`.
- [ ] Failing tests: Verschieben behält Dauer; Ende-Ziehen schnappt auf Raster; Mindestdauer = schritt; Start-Ziehen über das Ende hinaus wird begrenzt; Meilenstein: modus 'end'/'start' wirkt wie 'move' bzw. wird ignoriert (festlegen, testen); Sommerzeit-Nacht 25.10.2026 Verschieben um 60 min behält echte Dauer; planMinute mit versatz 5 → 5 min früher als ohne.
- [ ] Rot, umsetzen, grün, `node tests/run.mjs`. Commit `feat(gantt): Rechnung fuer das Ziehen von Balken`.

### Task 2: Ziehen im Gantt
**Files:** `js/gantt.js` (pointerdown-Logik neben dem Verknüpfen-Ziehen ~692, `bindMark`, Tooltip/Hinweis, Tastatur), `js/app.js` nur falls ein Rückruf nötig, `styles/base.css` (Griffe, Cursor; Tokens), Tests `tools/verify-edit.mjs`, `tools/verify-live.mjs`, `tools/verify-browser.mjs` (HANDY).
- [ ] Failing checks laut Spec «Abnahme» (Maus verschieben/Ende/Escape/Klick bleibt Auswahl/Sammel ohne Griffe/Meilenstein ohne Dauer-Griff/ein ⌘Z/Alt+→; Versatz; Handy wischen vs. halten+ziehen).
- [ ] Rot, umsetzen, grün: verify-edit, verify-live, verify-browser, verify-showablauf, verify-klassentreffen + `node tests/run.mjs`. Screenshot während eines Zugs (Hinweis sichtbar) ansehen.
- [ ] `.claude/rules/gantt-darstellung.md` um die Zieh-Regeln ergänzen (kurz, Imperativ). Commit `feat(gantt): Balken verschieben und Dauer ziehen`.

### Task 3: Abschluss
- [ ] CHANGELOG «Unveröffentlicht»; alle neun Prüfungen; Commit `docs: Changelog Balken ziehen`.
