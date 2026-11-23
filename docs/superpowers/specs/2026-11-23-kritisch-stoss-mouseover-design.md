# «Kritisch» streichen, Mouseover zeigt Luft, Achse über alles

Stand 2026-11-23 · kleiner Umbau · Teil 1 von 2 (Teil 2: Einrichten-Seite)

## Anlass

Plan «Festwiese 2027»: Steelday 1 und 2 waren rot, obwohl zwischen ihnen 15 h Luft
liegen. Ursache: `critical = float <= minFloat` macht die *relativ* knappste Kette rot,
und das Kettenende bekommt per Ankerregel immer Puffer 0. Der Mouseover schrieb nur
«kritischer Pfad», das Panel sogar fälschlich «kein Puffer». Außerdem fehlten 6 von
7 Phasen und Steelday 3 in der Ansicht, weil die Achse nur über `project.start…end`
läuft (Ende 12.08., Phasen bis 30.08.).

## Entscheidungen (Marco, 2026-11-23)

- **Was nicht überlappt, ist nicht kritisch.** Rot wird nur eine Überlappung
  verknüpfter Vorgänge, und die meldet die App schon als **Konflikt**
  (`findConflicts`: «startet 2 h zu früh für …»).
- Damit ist «kritisch» doppelt: **der Begriff entfällt** (Kachel, KRIT-Marke,
  roter Pfeil, Fußzeilen-Legende, Abschnitt in der Prüf-Liste, «kritisch gesehen»).
- Mouseover und Seitenpanel zeigen stattdessen die **echte Pufferzahl** und die
  **knappste Verknüpfung** («15 h Luft bis Steelday 2»).

## Ansätze

1. **Kritisch streichen, Konflikt bleibt die eine Warnung** (gewählt).
2. Kritisch = Stoß auf Stoß (Luft <= 0): im Festival-Testplan 28 statt 19 rot.
   Von Marco verworfen.
3. Beides zeigen (Konflikt + KRIT bei Überlappung): doppelte Anzeige. Verworfen.

Nachgerechnet: mit Ansatz 1 sind Festwiese, Festival-Testplan, AMK und
`pmrm9dimw0` ohne Rot; echte Überlappungen bleiben als Konflikt sichtbar.

## Umsetzung

- **`schedule.js`** (DOM-frei): `computeSchedule` rechnet weiter ES/EF/LS/LF/`float`
  (die Konfliktprüfung braucht `es`). `critical`, `minFloat`, `anchored`-Kritischlogik
  entfallen. Neu je Vorgang `engpass` = Verknüpfung mit der kleinsten **Luft** aus den
  geplanten Zeiten: FS `b.start − (a.end + lag)`, SS `b.start − (a.start + lag)`,
  FF `b.end − (a.end + lag)`, SF `b.end − (a.start + lag)`; Form
  `{ depId, nachbarId, richtung: 'vor'|'nach', typ, luft }`. Terminlose und Ringe
  wie bisher ausgenommen; unverknüpft → `engpass: null`.
- **Mouseover** (gantt.js `bindTip`) und **Panel** (inspector.js «Puffer»):
  - `Puffer`: `fmtFloat(float)`; am Kettenende (kein Nachfolger) «— Kettenende».
  - `Engpass` (nur wenn verknüpft): «15 h Luft bis Steelday 2 (Ende → Start)» bzw.
    «0 min Luft — Steelday 2 schließt direkt an»; bei `luft < 0` steht der Konflikt
    schon in der Zeile darüber, `Engpass` sagt dann «überlappt Steelday 2 um 2 h».
- **Entfernen:** KRIT-Marke und `is-crit` in gantt.js (Zeile, Balken, Pfeil, Seitenspalte),
  Kachel «kritisch» und `openReview('kritisch')`-Abschnitt in app.js, Fußzeilen-Legende
  `ft-crit` (index.html), `gantt.criticals()`, `stats().crit`, zugehöriges CSS in
  `styles/`. Die Prüf-Liste behält nur Konflikte.
- **`ackCrit`:** aus `store.js` (Feldliste, addTask) entfernen; `persistence.js` liest
  alte Pläne ohne Fehler und **lässt das Feld beim Laden fallen** (kein Fehler, kein
  Hinweis). `ackConflictMin` bleibt.
- **Achse über alles** (Bauzeitenplan): `T0/T1` = Hülle aus `project.start/end`, allen
  terminierten Vorgängen und allen Phasen. DOM-freie Funktion `planSpanne(state)` in
  `timeaxis.js`, genutzt von gantt.js (Achse + Wochenendbänder), bedarf.js
  (Tagesraster) und print.js (Rückfall statt `project.end`).

## Doku und Tests

- `docs/entscheidungen.md` «Der kritische Pfad braucht einen echten Zielmeilenstein»
  ersetzen: warum «kritisch» entfiel (Marco, 2026-11-23, Festwiese-Fall).
- CLAUDE.md (`schedule.js`-Zeile «kritischer Pfad»), `.claude/rules/store-daten.md`
  (Abhaken `ackCrit`), `.claude/rules/gantt-darstellung.md`, README, CHANGELOG.
- `tests/schedule.test.mjs`: Kritisch-Fälle durch Engpass-Fälle ersetzen (Luft je Typ
  mit lag, kleinste gewinnt, terminlos ausgenommen, unverknüpft = null; Festwiese-Form
  4 Vorgänge/2 FS → Steelday 1 Engpass 15 h zu Steelday 2).
- Struktursperre in `tests/run.mjs`: kein `critical`/`ackCrit`/`KRIT` mehr in `js/`.
- `planSpanne`: Phase nach Projektende, Vorgang vor Projektbeginn, leerer Plan.
- `verify-edit`/`verify-browser`: Abschnitte zu Kritisch durch Prüfung ersetzen, dass der
  Mouseover «Luft bis» mit Nachbarnamen zeigt; eine Phase nach dem Projektende ist auf
  der Achse sichtbar.
