# Kalendertage statt +1440 Minuten — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vier Stellen, die einen Tag als 1440 Minuten rechnen, auf den lokalen Kalender umstellen, damit Tagessprung, Achsen-Kopfzeile, Bedarfsraster und neue Phasen an der Zeitumstellung stimmen.

**Architecture:** Zwei neue DOM-freie Helfer (`naechsteMitternacht` in timeaxis.js, `rasterGrenzen` in resources.js) plus Wiederverwendung von `verschiebeZeit` (store.js). Aufrufer in gantt.js, bedarf.js, phasen-editor.js umstellen. Kein neuer Baustein, keine neue Datei (sw.js `HUELLE` bleibt).

**Tech Stack:** Vanilla JS ES-Module, Node-Tests (`tests/*.test.mjs`), Playwright-Firefox (`tools/verify-edit.mjs`).

**Spec:** docs/superpowers/specs/2026-11-21-kalender-tage-design.md

## Global Constraints

- Worktree `.claude/worktrees/fix-kalender-tage`, Branch `fix/kalender-tage`. Nie im Dropbox-Hauptordner arbeiten.
- CLAUDE.md und `.claude/rules/*.md` gelten: Rechenlogik DOM-frei (timeaxis.js, resources.js), Zeiten über `toMin()`/`new Date(y,m,d+n,…)`, keine Browser-Dialoge, Kommentare Deutsch mit Begründung.
- Minuten-Konstanten, die DAUER oder PIXEL bedeuten (`dayPx`, `fitPx(…, 1440)`, `templates.js` `D`, `conflicts.js`, `rasterMin`), bleiben unverändert.
- Rot-Nachweis für jeden neuen Test/Check vor der Korrektur, Zeile im Bericht zitieren.
- Tests: `TZ=Europe/Berlin node tests/timeaxis.test.mjs`, `tests/resources.test.mjs`; `node tests/run.mjs | tail -2`; `node tools/verify-edit.mjs 2>&1 | grep -E '^  ✗|Problem|bestanden'`. Kein `npx playwright install`. Gestartete Browser beenden.
- Keine Version stempeln, nicht pushen, nicht mergen, kein Tag.
- Commit-Trailer `Co-Authored-By: Claude <Modell> <noreply@anthropic.com>`.

## Review Focus

1. 29.03.2026 (23-Stunden-Tag): `naechsteMitternacht` liefert 23 h später; Tagesband überlappt nicht den Folgetag.
2. 25.10.2026 (25-Stunden-Tag): Band 25 h breit; Vorgang 23:30–23:45 gehört zum 25.10.
3. Bedarfsraster mit Projektstart zur Uhrzeit (z. B. 08:00): Scheibengrenzen bleiben auf 08:00 jedes Kalendertags, auch nach der Umstellung.
4. Bedarfsraster Stundenmodus (`schritt: 60`) unverändert (bestehende Tests bleiben grün).
5. `majBack`: Tick des Tages, in dem der Ausschnitt beginnt, erscheint auch in der letzten Stunde des 25.10.

---

### Task 1 (Sonnet): Helfer und Gantt (Stellen 1 und 2)

**Files:**
- Modify: `js/timeaxis.js` (neuer Export neben `schnapp`), `js/gantt.js` (`zeigeBalkenDesTages` ~1709; `majSpan`/`majBack` ~1431–1442; Import ergänzen)
- Test: `tests/timeaxis.test.mjs`, Check in `tools/verify-edit.mjs`

**Interfaces:**
- Produces: `export function naechsteMitternacht(min)` — Epochenminute der nächsten lokalen Mitternacht NACH `min` (liegt `min` genau auf Mitternacht, die des Folgetags). Rechnung: `new Date(y, m, d + 1)` aus `new Date(min * 60000)`.

- [ ] **Step 1: Failing tests** in `tests/timeaxis.test.mjs`, Abschnitt «Kalendertage»:
  - `naechsteMitternacht(toMin('2026-10-25T00:00')) === toMin('2026-10-26T00:00')` und Differenz `=== 1500`
  - `naechsteMitternacht(toMin('2026-03-29T00:00'))` Differenz `=== 1380`
  - `naechsteMitternacht(toMin('2026-08-30T23:59')) === toMin('2026-08-31T00:00')`
  - `naechsteMitternacht(toMin('2026-08-31T00:00')) === toMin('2026-09-01T00:00')`
- [ ] **Step 2: Rot-Nachweis** (`TZ=Europe/Berlin node tests/timeaxis.test.mjs`).
- [ ] **Step 3: Umsetzen** `naechsteMitternacht` in timeaxis.js; in gantt.js `d1 = naechsteMitternacht(d0)`; `majSpan(u, d)`: `'day'` → `naechsteMitternacht(startMin) - startMin`, `'week'` → `new Date(y, m, d + 7) − d` in Minuten, Monat wie bisher; `majBack`: day 1500, week 10140, month 44700 (Kommentar: Umstellungsstunde).
- [ ] **Step 4: Browser-Check** in `tools/verify-edit.mjs` (eigener Abschnitt «ZEITUMSTELLUNG», Plan über `page.evaluate` mit einem Vorgang `2026-10-25T23:30`–`2026-10-25T23:45` ergänzen, wie der Druck-Check in verify-print es vormacht): Zoom «Tag», Sprung auf 2026-10-25 → (a) `.bz-t-major` des 25.10. hat Breite `1500 * px` (px aus `gantt`-Zoom lesen, Toleranz 1 px) und (b) der Tagessprung scrollt zur Gruppenzeile des Gewerks dieses Vorgangs. Rot-Nachweis: ohne Fix ist (a) 1440·px.
- [ ] **Step 5: Grün** (`tests/run.mjs`, `verify-edit.mjs`). **Step 6: Commit** `fix(gantt): Tagesgrenzen ueber den Kalender - Tagessprung und Datumsband an der Zeitumstellung`.

### Task 2 (Sonnet): Bedarfsraster (Stelle 3) und Phasen-Editor (Stelle 4)

**Files:**
- Modify: `js/resources.js` (`bedarfsRaster`, neuer Export `rasterGrenzen`), `js/bedarf.js` (~47, Beschriftung ~62), `js/phasen-editor.js` (~123)
- Test: `tests/resources.test.mjs`, Check in `tools/verify-edit.mjs`

**Interfaces:**
- Consumes: `verschiebeZeit(iso, tage, minuten)` aus `js/store.js` (Kalendertage, dann Minuten).
- Produces: `export function rasterGrenzen(von, bis, schritt)` → Array von Epochenminuten `[g0=von, g1, …, gn]` mit `gn >= bis`; `schritt` ist eine Zahl (Minuten, wie bisher) oder `'tag'` (nächster Kalendertag zur gleichen Uhrzeit: `new Date(y, m, d + 1, hh, mm)`). `bedarfsRaster(tasks, resList, { kind, von, bis, schritt })` akzeptiert `schritt: 'tag'` und rechnet die Scheiben über `rasterGrenzen` (Index per Suche in den Grenzen, nicht per Division).

- [ ] **Step 1: Failing tests** in `tests/resources.test.mjs`:
  - `rasterGrenzen(toMin('2026-10-24T08:00'), toMin('2026-10-27T08:00'), 'tag')` → vier Grenzen `08:00` am 24., 25., 26., 27.; Abstand 25.→26. `=== 1500`.
  - `bedarfsRaster` mit `schritt: 'tag'`, `von = 2026-10-24T00:00`, `bis = 2026-10-28T00:00`, Vorgang `2026-10-26T23:30`–`23:45` mit `res [{rid, n:2}]` → Bedarf 2 nur in Scheibe 2 (26.10.), nicht Scheibe 3.
  - Bestehende Stundentests unverändert grün.
- [ ] **Step 2: Rot-Nachweis.**
- [ ] **Step 3: Umsetzen** `rasterGrenzen`, `bedarfsRaster` (Zahl-`schritt` bleibt numerisch, `'tag'` über Grenzen), `bedarf.js`: `schritt = 'tag'` im Bauzeitenplan, Kopfzeile aus `rasterGrenzen(von, bis, schritt)` beschriften (statt `von + i * schritt`); `phasen-editor.js`: `end: verschiebeZeit(start, 1, 0)`.
- [ ] **Step 4: Browser-Check** in `tools/verify-edit.mjs` (Abschnitt «ZEITUMSTELLUNG»): Einrichten → Phasen → «+ Phase» mit letzter Phase endend `2026-10-24T18:00` → neue Phase endet `2026-10-25T18:00` (vorher `17:00`). Rot-Nachweis.
- [ ] **Step 5: Grün.** **Step 6: Commit** `fix(bedarf,phasen): Tagesraster und neue Phase ueber den Kalender`.

### Task 3 (Haiku): Doku

- Modify: `.claude/rules/gantt-darstellung.md` (Zeile zu Ticks/Bändern: Tagesband = nächste Mitternacht, `naechsteMitternacht`), `.claude/rules/personal-maschinen.md` (Bedarfsraster: Tage über `rasterGrenzen('tag')`), `docs/entscheidungen.md` (ein Absatz «Warum Kalendertage statt +1440»: die vier Stellen, Druck war der erste Fund), `CHANGELOG.md` (oben Abschnitt `## Unreleased — Kalendertage` mit einem Satz je Stelle, Nutzersprache).
- [ ] `grep -rn "1440" .claude/rules docs/entscheidungen.md README.md` — jede Stelle, die eine Tagesgrenze meint, nachziehen. `node tests/run.mjs | tail -2`. Commit `docs: Kalendertage statt +1440`.

### Task 4: Volllauf und Abnahme (Controller)

- `node tests/run.mjs`, alle acht `tools/verify-*.mjs`; Screenshots ansehen; Final-Review über den Branch; dann Versionsfrage an Marco.
