# Einrichten als eigene Seite

Stand 2026-11-23 · Projekt · Teil 2 von 2 (Teil 1: `2026-11-23-kritisch-stoss-mouseover-design.md`)

## Warum

Marco: «Der Bereich ist dafür da, das Projekt richtig einzurichten, also soll er auch so
aussehen.» Heute ist Einrichten ein Fenster mit sechs Reitern, die fast nur Knöpfe
tragen; die Inhalte liegen in schwebenden Kästchen (`table.openVerwalten`) oder im
Rechtsklick auf den Plan. Der Reiter «Projekt» zeigt **keine einzige Projektangabe**,
und der Projektzeitraum lässt sich nach dem Anlegen **nirgends ändern**
(`setProjectField` existiert im Store, kein Knopf ruft ihn). Folge beim Plan
«Festwiese 2027»: Ende 12.08., Phasen bis 30.08., nicht änderbar.

**Erfolg:** Ein Projekt lässt sich beim ersten Mal geführt einrichten und später gezielt
nachziehen, alles auf einer Seite mit echtem, direkt bearbeitbarem Inhalt; Zeitraum
jederzeit änderbar; die App sagt, wo etwas nicht stimmt.

## Ziele

- **Eigene Seite** (Marco) mit Seitenleiste: fünf Bereiche in fester Reihenfolge, je mit
  Status ✓ eingerichtet · ⚠ stimmt etwas nicht · ○ noch leer:
  1. 📋 Projekt · 2. 📅 Zeitraum & Phasen · 3. 🏗 Gewerke & Bühnen ·
  4. 👷 Personal & Maschinen · 5. 🏷 Arten & Abschnitte
- **Erstes Einrichten** (neues Projekt) in **Optik C**: Schrittleiste 1–5 oben,
  «← Zurück» / «Weiter →» unten, «Fertig» im letzten Schritt führt in den Plan. Später
  (Projekt schon eingerichtet) erscheint die Seitenleiste (Optik A). Mockup:
  `.superpowers/brainstorm/…/einrichten-layout.html` (A und C, Marco wählte «A, in
  der Optik C zum erstmaligen Einrichten»).
- **Alles direkt bearbeitbar**, keine Unterfenster für das Einrichten.

## Nicht-Ziele

- Keine neue Logik für Phasen, Ressourcen, Arten, Abschnitte, Gewerke: es bleiben die
  vorhandenen Store-Befehle (`addPhase/setPhase/removePhase`, `addRessource`,
  `addPunktTyp`, `addAbschnitt`, `setAuswahlLabel`, `removeAuswahl`, `reorderAuswahl`,
  `addGewerk/removeGewerk/reorderGewerk/setGewerkField`, `shiftPlan`, `setProjectField`).
- Keine Handy-Bedienung (siehe Memory: keine Anforderung).
- Kein Backend.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es läuft)

- Wieder Knöpfe, die Kästchen öffnen, statt Inhalt.
- Zwei Kopien des Plans, die sich gegenseitig überschreiben.
- Beim Zurück in den Plan ist der Ausschnitt (Zoom, Scroll, Tag) weg.
- Die App ändert still den Zeitraum.

## Ansätze

1. Neues Einrichten aus vorhandenen Bausteinen, als Fenster über dem Plan.
2. Heutiges Fenster aufhübschen: verworfen, bleibt Flickwerk.
3. **Eigene Seite** — **Marco gewählt**.

**Umsetzungsweise der eigenen Seite (Claudes Entscheidung, Marco informiert):** ein
eigener **Modus derselben App** (wie die Bedarfsansicht), der das ganze Fenster füllt,
nicht eine zweite HTML-Datei. Gründe: ein Store, ein Undo, Sync läuft weiter, keine zwei
Tabs mit konkurrierenden Planständen, kein Eintrag in `version.mjs`/`HUELLE`, Plan-
Ausschnitt bleibt beim Zurückwechseln erhalten (der Gantt wird nur verborgen, nicht
abgebaut). Die alte Begründung in `index.html:216` («Fenster, damit der Ausschnitt
bleibt») ist damit weiter erfüllt und wird umformuliert.

## Was auf die Seite kommt

### Kopf der Seite
`⚙ Einrichten — <Projektname>` · rechts «Zum Plan» (bzw. «Fertig» im Schritt 5).
Die Schiene links bleibt sichtbar; «Einrichten» ist dort gedrückt, solange die Seite offen
ist (heute öffnet `rail-ein` den Dialog).

### 1 · 📋 Projekt
- Name (Pflicht), Veranstaltungsort, Zeitzone (Auswahl, Vorgabe wie heute aus
  `persistence.js`).
- **Neu:** Adresse (eine Zeile), Anfahrt / Zufahrt / Ladezone (Freitext, mehrzeilig),
  Kunde / Veranstalter (eine Zeile), **Ansprechpartner** als Liste mit je
  Name · Rolle · Telefon (+ Zeile, Zeile löschen).
- Neue Felder: `project.adresse`, `project.anfahrt`, `project.kunde`,
  `project.kontakte = [{ id, name, rolle, tel }]`. Laufen durch Export, Import, Sync;
  alte Pläne ohne sie öffnen normal (`migrate`: fehlend = leer). Schreiben über
  `setProjectField` (für `kontakte` ganze Liste; ein Befehl = ein Undo).
- Status ✓ wenn Name gesetzt; Rest freiwillig, blockiert nichts.

### 2 · 📅 Zeitraum & Phasen
- **Projektbeginn / Projektende** (Datum + Uhrzeit), jederzeit änderbar über
  `setProjectField` (Prüfung «Ende nach Start» gibt es schon).
- **Prüfung:** liegen Phasen oder terminierte Vorgänge außerhalb, gelbe Warnung mit
  Anzahl und einem Knopf «Zeitraum auf … setzen» (Hülle). Nie automatisch. Status ⚠.
- **Mini-Zeitleiste:** Phasen als farbige Balken (Farbe nach Art, Tokens `--ph-<art>`),
  Projektzeitraum gestrichelt.
- **Phasenliste:** der vorhandene Phasen-Editor (`createPhasenEditor`, `mountListe`)
  eingebettet, «+ Phase».
- **«Plan verschieben…»** zieht hierher (Dialog `showShiftDialog` bleibt).
- Status ✓ wenn Zeitraum gesetzt und mindestens eine Phase, ⚠ bei Teilen außerhalb,
  ○ ohne Phasen.

### 3 · 🏗 Gewerke & Bühnen
- Zwei Listen (Gewerke; Bühnen nur, wenn welche da sind oder man eine anlegt): je Zeile
  Farbfeld (Platz aus `palette.js`, Schraffur sichtbar), Name (direkt umbenennen),
  ↑ ↓, Löschen über `askDialog` (wie heute im Rechtsklick). «+ Gewerk», «+ Bühne».
- Rechtsklick im Plan bleibt zusätzlich.
- Status ✓ ab einem Gewerk.

### 4 · 👷 Personal & Maschinen
- Zwei Listen (Personal, Maschinen) direkt: umbenennen, sortieren, löschen, «+».
  Inhaltlich dieselbe Logik wie `verwalten` in `table.js`, aber eingebettet statt
  schwebend. Hinweis: zugewiesen wird am Vorgang.
- Status ✓ ab einem Eintrag, sonst ○ (freiwillig).

### 5 · 🏷 Arten & Abschnitte
- Zwei Listen (Zeiteintrag-Arten, Abschnitte), direkt bearbeitbar wie 4.
- Status ✓ ab einem Eintrag, sonst ○.

### Projektmenü in der Kopfzeile (raus aus Einrichten)
Neu · Projekte (wechseln) · Import · Export · Speicherort (GitHub-Sync, bisher Reiter).
Ein Knopf in der Kopfzeile öffnet ein Menü (`openMenu`), Speicherort als eigener kleiner
Dialog. Ids und Handler bleiben (`#new-proj`, `#proj-menu`, `#import`, `#export`,
`#sync-token`, `#sync-verbinden`, `#sync-trennen`).

### Erstes Einrichten
Nach «Neu» (Projektdialog mit Name, Ort, Von, Bis, Vorlage wie heute) öffnet sich die
Seite in Optik C bei Schritt 1. «Weiter» ist nie gesperrt außer Schritt 1 ohne Namen.
Wer abbricht («Zum Plan»), landet im Plan; das nächste Öffnen zeigt die Seitenleiste.
Woran «erstes Mal» erkannt wird: Merkmal `project.eingerichtet` (bool), gesetzt beim
«Fertig» in Schritt 5 oder beim ersten Verlassen.

### Druck
Kopf der A3-Tagesblätter und des Running-Order-Blatts (`print.js`): Ort, Adresse,
Ansprechpartner (Name · Rolle · Telefon). Kunde nicht (Crew-Blatt).

## Optik

Dunkel und farbig nach `CLAUDE.md`/UI-Grundsätzen, alle fünf Themes, Tokens auf
allen drei Scopes. Symbole statt Kürzel (📋 📅 🏗 👷 🏷, ✓ ⚠ ○). Statusfarben grün/gelb.
Kein `confirm/alert/prompt`, Löschen über `askDialog`.

## Entscheidungen beim Gegenlesen (Claudes Entscheidungen, zur Prüfung durch Marco)

1. **`project.eingerichtet`:** `migrate` setzt fehlend = `true` (Bestand: Festwiese, AMK,
   Klassentreffen öffnen mit Seitenleiste). Nur «Neu» setzt `false`, auch mit Vorlage
   (geführt durch alles einmal, die Vorlage hat dann schon Inhalt).
2. **Zeitraum ändern verschiebt nichts.** Es ändert nur `project.start/end`. Vorgänge und
   Phasen bleiben, wo sie sind; die Achse zeigt ohnehin alles (Teil 1, `planSpanne`).
   Zum Verschieben gibt es «Plan verschieben…».
3. **«außerhalb»** = Phasen und Vorgänge mit eigenem Termin (geplante `start/end`, nicht
   die CPM-Rechnung; terminlose zählen nicht). Der Knopf setzt den Zeitraum auf die
   Hülle aus Zeitraum, Phasen und Vorgängen, also `planSpanne` aus Teil 1.
4. **Undo:** wie die Tabelle: nur `change`, nie `blur`; ein `change` = ein
   `setProjectField` = ein ⌘Z. `kontakte`: bei jedem `change` eines Feldes die ganze
   Liste als ein Befehl. Sync gleicht ganze Pläne ab (`abgleich`), keine Sonderregel.
5. **Navigation:** Reload startet wie heute (`bootLokal`, Projektdialog; Live-Monitor
   direkt). Die Seite wird nicht wiederhergestellt. Projektwechsel oder «Neu» schließen
   die Seite.
6. **Alte Aufrufe `openEinrichten(tab)`:** `projekt` → 1, `phasen` → 2, `baender` → 3,
   `res` → 4, `arten` → 5, `sync` → Speicherort-Dialog im Projektmenü.
7. **Löschen** benutzter Einträge: genau wie heute (gleiche Store-Befehle, gleiche
   Rückfrage).
8. **Zeitzone:** Zeiten im Plan sind Ortszeit der Veranstaltung und bleiben unverändert;
   die Zeitzone legt nur fest, wo «jetzt» liegt (Jetzt-Linie, Live). Feld bleibt
   änderbar, darunter der Hinweis «Zeiten im Plan bleiben, nur die Jetzt-Linie richtet
   sich danach».

## Was beim Bauer liegt

- Modul-Schnitt (Vorschlag: `js/einrichten.js` Hülle + Status, DOM-freie Statusrechnung
  `einrichtStatus(state)` in einem DOM-freien Modul mit Test).
- Wie die eingebetteten Listen aus `table.js` herausgelöst werden, ohne die
  «+ Neu…»-Eingabe in der Tabelle zu brechen.
- Anpassen aller Prüfskripte, die `#rail-ein` + `[data-ein="…"]` klicken
  (`.claude/rules/tabelle-einrichten.md`), und die Knopfzahl der Kopfzeile (15/13 —
  ändert sich durch den Projektmenü-Knopf; neu zählen, Regel nachziehen).
- Doku: CLAUDE.md (Aufbau-Tabelle, Start/Einrichten-Regeln), `.claude/rules/*`,
  `docs/entscheidungen.md` (Fenster → eigene Seite, Begründung), README, CHANGELOG.
