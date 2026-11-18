# Fehlerpaket aus dem Review (v0.13.0) — Design

Stand 2026-11-18, von Marco freigegeben («mach genauso»).

## Ziel

Fehler, die im Live-Betrieb oder beim Import still Daten verfälschen, sollen
nicht mehr möglich sein. Jede Korrektur bekommt einen Test, der vor der
Korrektur fehlschlägt (Rot-Nachweis) und danach grün ist.

**Nicht-Ziel:** UI-Verbesserungen, neue Funktionen, Umbau großer Module. Die
kommen als eigene Pakete (UI, CLAUDE.md, Funktionen).

## Ansätze

Für jede Korrektur gab es höchstens eine echte Wahl; die Entscheidung steht
in der Tabelle. Verworfen: (a) alles in einem großen Umbau von `open()` und
`setTaskField` — zu viel Fläche für eine Fehlerrunde; (b) Zeitzonen-Korrektur
(#7) jetzt mitnehmen — fasst jede Zeitrechnung an, Nutzen nur bei Betrachtern
in verschiedenen Zonen.

## Entscheidungen

| # | Fehler | Entscheidung |
|---|---|---|
| 1 | Sync-Update ersetzt den offenen Plan und setzt dabei den Live-Versatz auf 0 (`app.js` `open()`). | Versatz nur auf 0, wenn sich die Projekt-**id** ändert. Undo-Verlauf wird beim Sync-Update weiter geleert (ein ⌘Z hinter die fremde Änderung würde sie still zurückdrehen). |
| 2 | `res`-Zeitfenster (`von`/`bis`) bleiben stehen, wenn der Vorgang sich ändert (`moveTask`, `setTaskField` start/end). | **Verschieben** (`moveTask`, Dauer gleich): Fenster wandern um dieselbe Differenz mit. **Dauer ändern** (start ODER end einzeln, oder moveTask mit anderer Dauer): Fenster auf den Vorgang beschneiden; liegt ein Fenster danach ganz außerhalb oder hat Länge ≤ 0, wird es `von:null, bis:null` (ganzer Vorgang). |
| 3 | `save()` verschluckt einen Fehler beim Index-Schreiben → `dirty` veraltet, Sync kann überschreiben (`persistence.js`). | Index-Fehler liefert `{ok:false, error}` mit derselben Speicher-voll-Meldung wie der Plan-Fehler. |
| 4 | `deserialize` prüft Inhalte nicht (kaputte Zeiten → NaN-Gantt, doppelte ids). | Ungültige Zeiten (nicht parsebar, Ende vor Start bei Nicht-Meilenstein) und doppelte Task-ids **lehnen ab**, Meldung nennt den ersten betroffenen Vorgang mit Titel. Deps auf unbekannte Vorgänge werden entfernt (wie `removeTask`). Gilt für jeden Weg über `deserialize` (Import, Autostart, Sync). |
| 5 | `addTask` übernimmt `slot`, `punktTyp`, `estimated` u. a. nicht. | Alle Felder, die `migrate` kennt/auffüllt, laufen durch, mit denselben Prüfungen wie in `setTaskField`. Rundlauf-Test addTask → serialize → deserialize. |
| 6 | `setTaskField` schreibt jedes Feld ungeprüft. | Feste Liste schreibbarer Felder; `id`, unbekannte Felder abgelehnt; `status` gegen die Statusliste, `punktTyp` gegen eingebaute + `project.punktTypen`; `title` getrimmt. Statusliste im Store doppelt geführt (Kern darf `dom.js` nicht importieren) + Test, der beide vergleicht — Muster wie `PUNKT_TYPEN`. |
| 7 | Dauern rechnen in der Zone des Betrachters. | **Nicht beheben.** Als bekannte Grenze in `docs/entscheidungen.md` dokumentieren. |
| 8 | `removeTask` kaskadiert nur eine Ebene (Sammelvorgang → Kind-Act → Soundcheck bleibt Waise). | Kaskade bis zum Fixpunkt über `parent` und `fuer`. |
| 9 | Projektwechsel innerhalb von 800 ms nach einer Eingabe verwirft sie. | `open()` speichert eine ausstehende Änderung des bisherigen Projekts, bevor es ersetzt (nur bei Projektwechsel, nicht beim Sync-Update desselben Projekts). |
| 10 | Ungeschützte `localStorage`-Zugriffe in `app.js` (z. B. `setAnsicht`). | `try/catch` um jeden Zugriff, der noch keinen hat; App funktioniert mit gesperrtem Speicher. |

## Rahmen

- Branch `fix/review-fehler` ab `main`, eigener Worktree.
- Regeln aus `CLAUDE.md` gelten: Store als einziger Weg, Kern DOM-frei,
  Validierung VOR der Änderung, neue Felder durch `addTask`.
- Abnahme: alle neun Prüfungen grün, Screenshots angesehen.
- Halt vor: Versionsnummer (Marco nennt sie), Merge/Push `main`, Tag.

## Dem Umsetzer überlassen

Genaue Feldliste für #5/#6 (aus `migrate` und allen `setTaskField`-Aufrufern
ermitteln), Formatierung verschobener Zeitstempel (vorhandenes Format der
Felder beibehalten), Testaufteilung auf die bestehenden `tests/*.test.mjs`.
