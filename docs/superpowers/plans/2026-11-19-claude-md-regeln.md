# CLAUDE.md-Regeln nach Anthropic-Doku Implementation Plan

> Von Marco freigegeben (alle vier Punkte, 2026-11-19). Ausführung: Controller (Opus) für die privaten Dateien und Hooks, Subagent für die Projekt-Aufteilung.

**Goal:** Weniger Dauer-Kontext, harte Verbote technisch statt als Text, keine Widersprüche zwischen den drei CLAUDE.md-Dateien.
**Quellen:** code.claude.com/docs/en/memory (≤ 200 Zeilen je Datei, `.claude/rules/` mit `paths:`, Hooks für Verbote, `/doctor prompt-audit`), Anthropic-Hinweis zu CRITICAL/MUST bei neuen Modellen.

## Global Constraints
- Sicherung vor jeder Änderung: `scratchpad/claude-md-backup/` (global.md, ordner.md, settings.json).
- Keine Regel inhaltlich streichen, außer Doppelungen und echte Widersprüche (dann gilt die neuere/projektnähere Fassung) — jede Streichung im Bericht an Marco.
- Ordner-Datei liegt in Dropbox und gilt für Mac UND Windows.

### Task A: Hooks (global, `~/.claude/settings.json`, über `update-config`)
PreToolUse/Bash blockiert mit Meldung: (1) `git stash` ohne `push -u -m`, sowie `git stash pop`; (2) Warteschleifen der Form `until … pgrep -f` / `while … pgrep -f`. Abnahme: je ein Probe-Befehl wird blockiert, ein erlaubter (`git stash list`) läuft.

### Task B: Projekt-Regeln aufteilen (Bauzeitenplan, Subagent)
`CLAUDE.md` → Kern (Start, Prüfungen, Deploy/Version, Store/Zeit-Grundregeln, Aufbau). Themenregeln nach `.claude/rules/<thema>.md` mit `paths:`: druck (print.*), showablauf+live (js/live.js, js/ebene.js, js/gantt.js …), sync (js/sync.js, js/persistence.js, sw.js), themes (styles/**), tabelle (js/table.js), personal (js/resources.js, js/bedarf.js). Regeln, die überall gelten, bleiben im Kern. tests/run.mjs-Größenprüfung auf den Kern; neue Prüfung: jede Regeldatei hat gültiges `paths:`-Frontmatter, und jede `paths`-Angabe trifft mindestens eine existierende Datei. 98-Regel-Abgleich über Kern + rules.

### Task C: Windows-Teile (Ordner-Datei)
Abschnitte «Lokales LLM (Qwen)» und «🪟 Nur Windows» → `github/windows-hinweise.md`; in der Ordner-Datei eine Zeile: «Auf Windows zuerst `windows-hinweise.md` lesen.»

### Task D: Aufräumen & Ton (global + Ordner)
Doppeltes nur einmal (Rhythmus, Superpowers-Pflicht, Prozesse beenden, Model-Routing, LLM Council); Widerspruch Opus auflösen (gilt: Opus plant/orchestriert/prüft, Sonnet/Haiku setzen um). IMMER/NIEMALS/Pflicht-Großschrift nur bei echten Grenzen (Live/Push, Secrets, Browser-Dialoge).

### Task E: Superpowers lockern
Fragen, Statusabfragen und Einzeiler ohne Skill-Ritual; Planen/Bauen/Fixen weiter mit Superpowers. Unicode-/Spiegelmodul-Regeln bleiben global (betreffen die Werkzeuge, nicht ein Projekt) — gekürzt.

### Abnahme
Zeichen vorher/nachher je Datei; `/doctor prompt-audit`-artige Prüfung durch einen frischen Reviewer (Widersprüche, tote Verweise); `node tests/run.mjs` grün.
