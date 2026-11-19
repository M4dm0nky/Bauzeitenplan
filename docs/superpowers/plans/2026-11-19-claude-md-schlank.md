# CLAUDE.md verschlanken Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** CLAUDE.md ≤ 300 Zeilen ohne Regelverlust, Begründungen in docs/entscheidungen.md.
**Spec:** docs/superpowers/specs/2026-11-19-claude-md-schlank-design.md

## Global Constraints
- Keine Regel ändern, abschwächen oder streichen. Kein Code außer der neuen Prüfung in tests/run.mjs.
- Deutsch, Imperativ, kurze Sätze. Eigennamen/Befehle/Dateinamen exakt übernehmen.
- Kein `git stash`, keine Warteschleifen; nur Vordergrund-Läufe.

## Review Focus
- Regeln, die nur in einem Nebensatz einer Vorgeschichte stehen (z. B. «Space braucht preventDefault()») — sie sind Regeln, nicht Geschichte.
- Zahlen, die Prüfungen erzwingen (13/11 Knöpfe, 300 px, 3:1 Kontrast, drei xp()-Stellen).
- Querverweise (`HUELLE`, `needed`-Liste, `tools/version.mjs`-Stellen).

### Task 1: Umbau
**Files:** Modify `CLAUDE.md`, `docs/entscheidungen.md`, `tests/run.mjs`.
- [ ] **Step 1:** Liste aller 98 fett eingeleiteten Regeln der alten Datei ziehen (Skript im Scratch, nicht im Repo) → Abgleichliste.
- [ ] **Step 2: Failing check** in tests/run.mjs: `CLAUDE.md hat höchstens 320 Zeilen` → mit alter Datei rot.
- [ ] **Step 3:** Neue CLAUDE.md schreiben (Gliederung laut Spec), Begründungen nach docs/entscheidungen.md (je Regel eine Überschrift, gleicher Wortlaut der fetten Einleitung, damit man sie findet).
- [ ] **Step 4:** Abgleich: jede der 98 Regeln in der neuen Datei auffindbar (Tabelle alt→neu im Bericht); alle genannten Pfade/Befehle existieren.
- [ ] **Step 5:** `node tests/run.mjs` grün.
- [ ] **Step 6: Commit** `docs: CLAUDE.md auf Regeln verdichtet, Begruendungen in docs/entscheidungen.md`
