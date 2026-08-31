# Changelog

Neueste Version oben. Gepflegt beim Versionswechsel (`node tools/version.mjs`),
nicht in `CLAUDE.md` — dort stehen Anweisungen, hier steht Vergangenheit.

## 0.11.0 — 2026-08-31

**Ansicht und Einrichten.** Ganz oben im Kopf steht jetzt ein Umschalter mit
zwei gleichrangigen Bereichen. **Ansicht** ist die Arbeitsleiste von vorher —
unverändert. **Einrichten** ist eine eigene Seite für die administrativen
Knöpfe, die bisher zwischen Zoomleiste und Live-Anzeige standen: Projekt
anlegen/wechseln, Export/Import, Drucken, Gewerke & Bühnen anlegen, Personal &
Maschinen anlegen und verwalten, Eintragsarten & Abschnitte verwalten,
Hell/Dunkel. Dieselben Knöpfe, derselbe Weg dorthin (`store.apply`) — nur eine
zweite Oberfläche statt eines zweiten Speicherorts.

Die schnellen Wege bleiben daneben bestehen: eine Eintragsart, ein Abschnitt
oder eine Ressourcen-Bezeichnung legst du weiterhin mit „+ Neu…" im
Auswahlfeld an, mitten im Tippen. Einrichten ist der Weg zum Aufräumen danach
— umbenennen, sortieren, löschen — und jetzt auch der Ort, an dem sich Personal-
und Maschinen-Bezeichnungen anlegen lassen, ohne sie gleich einem Vorgang
zuzuweisen.

### Ein Fehler, den nur ein Testlauf gefunden hat

Ein Projektwechsel über Einrichten ließ den Gantt bei nur einem von 36 Balken
im Bild stehen, statt bei der Aufbauphase des neuen Projekts. Der Gantt passt
sich beim Projektwechsel sofort ein — aber während «Einrichten» offen ist, hat
sein Container die Breite 0, und jede Rechnung, die auf der Breite beruht,
bleibt dann für immer falsch. Die Einpassung wird jetzt aufgeschoben und beim
Wiederauftauchen sauber nachgeholt (`docs/entscheidungen.md`).

Acht Prüfläufe grün, Bild angesehen.

## 0.10.0 — 2026-08-31

**Personal & Maschinen.** Zu jedem Vorgang — im Bauzeitenplan wie im
Showablauf — lässt sich jetzt eintragen, wer und was gebraucht wird: eine
selbst angelegte Bezeichnung (Stagehand, Gabelstapler, Rigger …), eine Anzahl
und, wenn nötig, ein eigenes Zeitfenster innerhalb des Vorgangs. Bedient wird
es an zwei Stellen — im Panel eines angeklickten Balkens und in der Tabelle,
ganz hinten in der Spalte *Ressourcen* — beide öffnen denselben Kasten.

Eine Bezeichnung legt man mit **«+ Neu…»** mitten im Tippen an, wie schon bei
den Eintragsarten; sie bleibt danach dauerhaft im Plan und reist im
JSON-Export mit. Anders als Eintragsarten und Abschnitte gibt es dabei
**keine eingebauten Bezeichnungen** — «Stagehand» heißt bei der nächsten
Produktion vielleicht «Helfer», eine Vorgabe wäre nur eine weitere
Löschkandidatin.

### Bereitstellung: der Pool, aus dem ein Vorgang seine Zuweisung nimmt

Ein Häkchen im Panel macht aus einem Vorgang eine **Bereitstellung**: seine
Zuweisungen sind dann kein Bedarf mehr, sondern ein Angebot — «10 Stagehands,
08:00–22:00», ohne eigene Funktion im Ablauf. Sie ist ein ganz normaler
Vorgang (Balken, Zeitfenster, Notiz, Undo) mit zwei Ausnahmen: sie nimmt keine
Verknüpfung an, und sie steht nie im Konflikt oder auf dem kritischen Pfad.

Läuft der Bühnenbau 10–20 Uhr und sind die Helfer nur bis 18 Uhr eingeplant,
sagt der Balken jetzt «2 Std ohne Personal» — im Panel im Klartext, ohne
Alarmfarbe: unbesetzte Zeit ist oft gewollt (Trocknungszeit, Wartezeit), kein
Fehler.

### Zwei neue Reiter: Personalbedarf, Maschinenbedarf

Neben Gantt und Tabelle stehen jetzt **Personalbedarf** und
**Maschinenbedarf** — je Bezeichnung, je Zeitscheibe (Tage im Bauzeitenplan,
Stunden im Showablauf) bereitgestellt · belegt · frei. Stehen zehn Stagehands
den Nachmittag über bereit und braucht ein Act um 20 Uhr sechs davon, zeigt
der Reiter dort «+4» — der Rest des Pools, mit einem Blick.

### Was aus `crew` wurde

Das alte Feld `crew` (eine blanke Zahl je Vorgang) ist einer Ressourcen-
Zuweisung auf die Bezeichnung «Crew» gewichen. Bestehende Pläne werden beim
Laden automatisch umgestellt — die Zahl bleibt erhalten, nur die Form ändert
sich. Die vier Vorlagen (Festival, Tour, Corporate, Messe) tragen ihre
Crew-Zahlen jetzt ebenfalls als Ressourcen-Zuweisung.

_Noch offen: die Werkzeugzeile bleibt vorerst wie sie ist — eine eigene
«Einrichten»-Ansicht, die die administrativen Knöpfe (Export, Import, Gewerke,
Ressourcen verwalten) aus der Ansichtsleiste herauslöst, folgt in einer der
nächsten Versionen._

## 0.9.11 — 2026-08-30

**Sechs Befunde aus einem Code-Review, alle behoben.** Einer davon war für
Benutzer sichtbar, der Rest war die Ursache dahinter.

### Neu angelegte Werte landeten nach dem Sortieren mittendrin

Wer seine Arten einmal von Hand sortiert hatte und danach eine neue anlegte,
bekam sie an unvorhersehbarer Stelle:

```
zwei Arten anlegen → sortieren (Zweite, Erste) → dritte anlegen
erwartet:     Zweite · Erste · Neu angelegt
tatsächlich:  Zweite · Neu angelegt · Erste
```

`neuerEintrag` setzte kein `sort`, und die Anzeige las `(x.sort ?? 0)` — der neue
Wert bekam damit 0 und sprang vor alles mit `sort >= 1`. Bei Gleichstand
entschied sogar die Reihenfolge im Array. Jetzt vergibt der Store das nächste
`sort`, sobald die Liste überhaupt sortiert ist, und die Anzeige rechnet mit
`?? Infinity`: was keines hat, hängt hinten an.

### Und die Ursache: dieselbe Logik an drei Stellen

Der Einzeiler oben war dreimal zu reparieren — `punktTypen()`, `abschnitte()` und
die Verwaltungsliste trugen je eine eigene Kopie der Sortierung. Sie steht jetzt
als `nachSort()` an **einer** Stelle in `ebene.js`.

Dasselbe bei der Frage, welches Feld am Vorgang auf welche Liste zeigt: der Store
wusste es (`LISTEN`), die Verwaltung führte es noch einmal mit. Wären die beiden
auseinandergelaufen, hätte der Löschknopf «0 Einträge» gemeldet und offen
gestanden, während der Store gleich darauf ablehnt. Jetzt zählt `benutztVon()` im
Store, und die Oberfläche fragt.

### Zwei Handler, die liegen bleiben konnten

- Nach dem Verknüpfen-Ziehen fängt ein `click`-Handler den folgenden Klick ab.
  Endet der Zug im Leeren, folgt unter Umständen gar kein Klick — dann blieb er
  liegen und schluckte irgendwann einen echten Knopfdruck. (Gemessen: im
  Normalfall trat das nicht ein; abgeräumt wird er jetzt trotzdem.)
- Ein Auswahl-Kasten wurde beim Öffnen des nächsten per `.remove()` entfernt —
  seine Handler auf `window` und `document` blieben dabei zurück.

### Kleinigkeit

`neuerEintrag` verzweigte seine Fehlermeldungen über einen Vergleich auf das
Anzeigewort «Art». Die Meldungen kommen jetzt als Parameter.

## 0.9.10 — 2026-08-30

**Arten und Abschnitte verwalten: umbenennen, sortieren, löschen.**

Unter «Neu» steht jetzt **«Verwalten…»** — in beiden Spalten. Es öffnet denselben
Kasten, nur mit der Liste darin: je Zeile ein Namensfeld, ↑↓ und ×. Die
eingebauten (Act, Changeover, Doors, Show-Ende, Setup, Show) stehen nicht darin,
sie bleiben fest.

**Umbenennen ändert nur den Namen, nie die id.** Die id ist die Zuordnung —
änderte sie sich mit, verlöre jeder Zeiteintrag still seine Art, denn ein
unbekannter Wert wird einfach durchgereicht und stünde als Kennung im Bild.

**Gelöscht wird nur, was niemand benutzt.** Der Knopf ist vorher gesperrt und
sagt, wie viele Zeiteinträge daran hängen. Die Alternative — die betroffenen
Zeilen auf den Standard zurückzusetzen — ändert fünf Zeilen hinter dem Rücken;
lieber vorher sagen als hinterher melden.

**Handsortierung schlägt die Uhrzeit.** Die Abschnitte ordneten sich bisher nach
ihrem frühesten Eintrag. Sobald du einmal sortierst, gilt deine Reihenfolge — eine
Automatik, die den Betrachter überstimmt, wäre keine Hilfe. Sortiert wird immer
vollständig: halbes `sort` ergäbe eine Reihenfolge, die niemand gewählt hat.

Alles läuft über die üblichen drei Wege: Undo, Auto-Save, Export. ⌘Z nimmt jedes
Umbenennen, Löschen und Sortieren zurück.

### Ein Fehler, den nur das Bild gezeigt hat

Der Verwaltungskasten **sprang nach jedem Klick in die linke obere Ecke**. Nach
einem Befehl baut die Tabelle neu auf, das Auswahlfeld ist dann abgehängt, und
`getBoundingClientRect()` liefert lauter Nullen — die Neupositionierung rechnete
gegen ein Rechteck aus Nullen. Alle Zusicherungen waren grün, die Reihenfolge
stimmte ja. `platziere()` nimmt seither ein Rechteck, das beim Öffnen einmal
gemerkt wird, und eine Prüfung hält fest, dass der Kasten nicht in der Ecke
landet.

Dabei fiel ein zweiter auf: `reorderAuswahl` setzt nur `sort`, es dreht das Array
nicht um — die Verwaltungsliste las es aber unsortiert und zeigte nach einem Klick
auf ↑ sichtbar nichts. Man hätte weitergeklickt, bis die Reihenfolge irgendwo
landet.

## 0.9.9 — 2026-08-30

**Eigene Abschnitte — dieselbe Freiheit wie bei den Eintragsarten.**

In der Spalte *Abschnitt* steht jetzt unten **«Neu»**: Name eintippen, fertig,
und Load-in, Soundcheck oder Aftershow stehen zur Wahl. Setup und Show bleiben
eingebaut und lassen sich nicht nachbauen. Die eigenen stehen in
`project.abschnitte` und reisen im JSON-Export mit, aus demselben Grund wie die
Arten: ein Eintrag trägt nur `abschnitt: "loadin"`.

**Sortiert nach der Uhrzeit, nicht von Hand.** Die eigenen Abschnitte ordnen sich
nach ihrem frühesten Eintrag — ein Load-in um 07:00 steht vor einer Aftershow um
23:30, ohne dass jemand einen Sortierdialog öffnet. Noch leere hängen hinten an.

**Der Umschalter oben bleibt unverändert.** Ein eigener Abschnitt filtert die
Ansicht nicht; er ist ein Etikett am Eintrag und zählt zur Show. Je Abschnitt
einen Knopf in die Werkzeugzeile zu setzen wurde verworfen — sie bricht schon
heute um, und bei fünf Abschnitten schöbe sie Zoom und Live-Knöpfe eine Zeile
tiefer.

**Damit dabei nichts stumm verschwindet:** Wer im Setup steht und einen Eintrag
auf «Load-in» stellt, verliert die Zeile im selben Moment aus dem Bild — sie
zählt jetzt zur Show. Die App sagt das jetzt («Load-in» steht in der
Show-Ansicht), statt es geschehen zu lassen. Genau diese Fehlerart steht in
diesem Projekt schon einmal dokumentiert.

### Behoben, bevor es jemand gemerkt hätte

Eine Zeile in der Migration lautete `if (t.abschnitt !== 'setup') t.abschnitt =
'show'`. Vor eigenen Abschnitten war das richtig — danach hätte sie **jeden
selbst angelegten Abschnitt beim nächsten Laden gelöscht**, ohne Meldung und ohne
Rückweg. Jetzt wird nur normalisiert, was der Plan nicht kennt; `setTaskField`
und `addTask` lehnen unbekannte Abschnitte ab, damit gar keine Waise entsteht.
Gefunden hat das ein Export-Import-Test, nicht das Auge.

### Kleinigkeiten

- Der Eintrag im Auswahlfeld heißt in beiden Spalten schlicht **«Neu»** statt
  «+ Neue Art…» — man legt eine Zeile an und will wählen, was sie ist.
- `addPunktTyp` und `addAbschnitt` teilen sich im Store eine Prüfung, statt sie
  fast gleich zu verdoppeln.

## 0.9.8 — 2026-08-30

**Eine Uhrzeit im Showablauf ließ sich nicht eintippen** — und jetzt gibt es
eigene Arten für Zeiteinträge.

### Die Uhrzeit sprang nach jeder Ziffer

Wer im Setup einen neuen Zeiteintrag anlegte und die Startzeit tippen wollte,
bekam Unsinn: aus «0930» wurde **08:09**. Zwei Dinge trafen zusammen.

`<input type="time">` feuert `change`, sobald ein **vollständiger** Wert dasteht.
Das Feld ist beim neuen Eintrag mit 08:00 vorbelegt — also bereits nach der
getippten Stunde. Dieses `change` schickte einen Store-Befehl, und der baute die
Tabelle per `replaceChildren` neu auf. Das Eingabefeld war danach ein anderer
Knoten, der Fokus lag auf `body`, und die restlichen Ziffern landeten nirgends.

Im Bauzeitenplan fiel das nie auf: dort steht `datetime-local` und löst erst nach
dem vollständigen Datum aus. Textfelder ebenso wenig — ihr `change` kommt
ohnehin erst beim Verlassen.

**Die Tabelle baut sich jetzt nicht neu auf, solange in dem Feld getippt wird,
das die Änderung ausgelöst hat.** Der Aufbau wird nachgeholt, sobald der Fokus
das Feld verlässt; wandert er in ein anderes Feld derselben Tabelle, zieht er
mit. Die Einschränkung auf das *auslösende* Feld ist wesentlich — sonst
verschluckte die Tabelle auch ein ⌘Z, während der Cursor zufällig irgendwo steht,
und zeigte stumm Veraltetes. Beides ist als Prüfung festgehalten, die
Uhrzeit-Eingabe Ziffer für Ziffer über die Tastatur.

Zwei Umwege dabei, die nicht funktioniert haben und deshalb im Code stehen:
den Fokus nach dem Neuaufbau wiederherzustellen hilft bei `type="time"` nicht
(für das aktive Segment gibt es keine API, der Cursor stünde wieder auf der
Stunde), und Firefox meldet **während** des `change` kurzzeitig `body` als
aktives Element — eine Absicherung, die das sofort prüfte, hielt jedes Tippen für
ein Verlassen und baute doch neu auf.

### Eigene Arten für Zeiteinträge

Act, Changeover, Doors und Show-Ende reichten nicht. Im Auswahlfeld der Tabelle
steht jetzt unten **«+ Neue Art…»**: Name eintippen, fertig — die Art ist
angelegt und für diese Zeile gewählt. Angelegt wird dort, wo man ohnehin steht;
ein eigener Verwaltungsort wäre zwei Klicks weiter weg für etwas, das man mitten
im Tippen braucht.

**Je Art wählbar: «tritt auf dem Blatt zurück, wie ein Changeover».** Damit
bekommt eine eigene Umbaupause oder ein Line-Check auf dem A3-Blatt eine
niedrigere Zeile — auf dem Blatt zählt, wer spielt. Bisher entschied das ein fest
verdrahteter Vergleich auf `changeover`; jetzt trägt jede Art die Eigenschaft
selbst.

Die Arten stehen in **`project.punktTypen`** und reisen damit im JSON-Export mit:
ein Eintrag trägt nur `punktTyp: "linecheck"`, und ohne die Namensliste in
derselben Datei sähe der Empfänger genau das statt «Line-Check». Eingebaute und
eigene führt `punktTypen()` zu **einer** Liste zusammen — sonst kennte das
Auswahlfeld eine Art, die der Live-Kopfzeile fehlt.

Der Store lehnt leere und doppelte Namen ab, auch gegen die eingebauten und ohne
Rücksicht auf Groß- und Kleinschreibung; ⌘Z nimmt eine Art wieder zurück.

**Noch nicht dabei:** Umbenennen, Sortieren und Löschen von Arten. Dafür bräuchte
es einen Verwaltungsdialog; eine versehentlich angelegte Art bleibt vorerst im
Auswahlfeld stehen.

## 0.9.7 — 2026-08-29

**Zwei Dinge, die man im Gantt bisher nicht konnte: Pfeile ziehen und dem Plan
sagen, dass es später wird.**

### Verknüpfen per Ziehen

Der Gantt ist die Ansicht für Pfeile — jetzt werden sie dort auch gezogen. Am
Ende jedes Balkens sitzt ein Griff, der beim Hinsehen erscheint (dauerhaft wären
es bei 153 Zeilen 153 Punkte im Bild); von dort zieht man auf den Nachfolger.
Während der Geste zeigt ein Gummiband die Richtung, zulässige Ziele sind
hervorgehoben und **unzulässige gesperrt**: was einen Ring ergäbe, sagt schon
vor dem Loslassen nein, statt danach. Am Rand scrollt die Ansicht mit, Escape
bricht ab.

Es entsteht immer FS — den Typ stellt man danach im Panel um, wo die Auswahl
ohnehin schon steht. Deshalb genügt EIN Griff je Balken: eine FS-Verknüpfung
legt man beim Vorgänger an, ein zweiter Griff wäre ein zweites Ziel ohne zweite
Bedeutung.

**Pfeile sind jetzt anklickbar.** Ein 1,5 px breiter Pfad ist mit der Maus nicht
zu treffen und mit dem Finger gar nicht; darunter liegt ein unsichtbarer
Zwilling mit demselben Verlauf, nur dick. Ein Klick wählt die Verknüpfung aus,
das Panel nennt beide Vorgänge und lässt Typ und Versatz ändern, Entf entfernt
sie, ⌘Z holt sie zurück. Das Suchfeld im Panel bleibt daneben bestehen — Ziehen
setzt voraus, dass beide Balken gleichzeitig im Bild sind, und das ist über
vierzehn Tage der Ausnahmefall.

Nebenbei: Das Suchfeld bot bisher Kandidaten an, die der Store gleich darauf
ablehnte. `candidateGroups` filtert jetzt über `reachable` alles heraus, was
schon hinter dem Vorgang hängt — Suchfeld und Ziehen geben damit dieselbe
Antwort.

### Live-Versatz: die Ansage vom Pult

Der Verzug entstand bisher allein aus Status gegen Uhr — er setzt voraus, dass
jemand die Häkchen pflegt, und im Betrieb tut das niemand. Neben dem Live-Knopf
steht deshalb ein Stepper `− [ 5 ] +`: **plus ist Delay**, minus Vorlauf,
je ein Klick eine Minute, die Zahl selbst zum Eintippen. Daneben die Aussage im
Klartext — «5 Min Delay» in Rot, «3 Min vor Plan» in Grün.

**Der Ablauf rutscht, die Uhr bleibt stehen.** Balken, Beschriftungen und Pfeile
wandern; Achse, Ticks und JETZT-Linie stehen auf der echten Zeit. Nur so liest
man an der Achse ab, wann SIDO wirklich auf die Bühne geht, statt es im Kopf zu
addieren. Die Uhrzeiten in der Showablauf-Seitenspalte, im Tooltip und in der
Live-Kopfzeile wandern mit — stünde links «20:00 Uhr» neben einem Balken auf
20:05, widerspräche sich das Blatt selbst.

Die Verzugsrechnung bekommt die zurückgedrehte Uhr statt des Versatzes:
«was läuft im verschobenen Plan?» ist dieselbe Frage wie «was lief im Original
vor fünf Minuten?». `live.js` musste dafür nicht angefasst werden, und der
Verzug rechnet von selbst gegen den verschobenen Plan. Die Uhr in der
Show-Kopfzeile bleibt bewusst die echte — sie ist der feste Punkt, gegen den
der Versatz überhaupt eine Aussage ist.

Der Versatz gehört dem Abend, nicht dem Plan: er steht im `localStorage`, nicht
im Export, und **gilt nur für den Tag, an dem er gesetzt wurde**. Sonst stünde
der Plan am nächsten Morgen 45 Minuten daneben und niemand wüsste, warum. Beim
Projektwechsel fällt er auf 0, Vertipper werden auf ±180 Minuten geklemmt.

### Nebenbei repariert

- `verify-print.mjs` **stürzte auf Apple Silicon ab**, statt das PDF sauber zu
  überspringen: der Chromium-Pfad war auf `chrome-mac/Chromium.app` verdrahtet,
  dort heißt der Ordner `chrome-mac-arm64` und das Programm «Google Chrome for
  Testing.app». `verify-showablauf.mjs` übersprang aus demselben Grund still das
  Running-Order-PDF, obwohl Chromium installiert war. Beide ermitteln den Pfad
  jetzt, statt ihn zu raten.
- Die Uhr in der Show-Kopfzeile hieß intern `uhr` wie eine neue Hilfsfunktion —
  die Namenskollision hätte beim Start die ganze App lahmgelegt.

## 0.9.6 — 2026-08-28

**Vier Korrekturen aus einem Review — und drei Vorschläge, die geprüft und
abgelehnt wurden.** Die Ablehnungen stehen mit Begründung in
`docs/entscheidungen.md`, damit sie nicht beim nächsten Review wieder Arbeit machen.

**Die Jetzt-Linie fiel stumm auf die lokale Zeit zurück**

`nowInZone` formatiert «jetzt» in die Projekt-Zeitzone und liest das Ergebnis
wieder ein. Zwei Wege führten dabei in ein `Invalid Date`, und beide endeten
kommentarlos im `catch` — also in der Systemzeit des Betrachters:

- `hour12: false` wählt in manchen Engines den Stundenzyklus **h24**. Mitternacht
  heißt dort «24:00», und daraus macht `new Date()` nichts Gültiges. Der Rückfall
  wäre **jede Nacht** passiert. Jetzt steht dort `hourCycle: 'h23'`.
- `Intl` liefert je nach Engine ein geschütztes Leerzeichen; `replace(' ', 'T')`
  griff dann nicht. Jetzt `replace(/\s+/, 'T')`.

Das Ergebnis wird zusätzlich auf Gültigkeit geprüft, und der Rückfall schreibt
einmalig eine Warnung — eine falsche Jetzt-Linie ist schlimmer als keine, sie darf
nicht lautlos entstehen. Unentdeckt blieb das, weil ein Projekt seine Zone beim
Anlegen vom Browser erbt: für fast jeden sind beide gleich, und dann liefert der
Rückfall zufällig das Richtige. Die neue Prüfung stellt deshalb **zwei Betrachter
in verschiedenen Zonen** auf dasselbe Berlin-Projekt, zum Zeitpunkt Mitternacht in
Berlin, und verlangt die Linie an derselben Stelle.

**Balken und Rauten reagieren jetzt auf die Tastatur**

Sie trugen `tabIndex = 0`, waren also mit Tab erreichbar — aber es hing nur ein
`click`-Handler daran. Wer hinsprang, kam mit keiner Taste weiter: fokussierbar
ohne Auslöser ist eine Sackgasse. **Enter und Leertaste wählen aus** (Space mit
`preventDefault`, sonst scrollt es die Seite). Dabei kam heraus, dass die
**Meilenstein-Rauten gar keinen `tabIndex` hatten** — beide Renderpfade waren per
Tastatur unerreichbar, obwohl sie per Klick auswählbar sind. Behoben.

**Duplizieren sagt jetzt, was der Kopie fehlt**

Das Duplikat steht ohne Verknüpfungen da (`deps` liegen in `state.deps`, die Kopie
erbt sie gar nicht erst — und das ist richtig so, mit denselben Vorgängern stünde
sie sofort im Konflikt). Nur sah man das dem Balken nicht an: wer eine Kette
erwartete, wartete auf etwas, das nie kam. Ein Toast sagt es jetzt.

**Die Meldung zum Farbplatz behauptete einen falschen Bereich**

«Farbplatz muss zwischen 1 und 20 liegen», während intern 0…19 gültig ist. Der
Platz ist 0-basiert gespeichert und 1-basiert angezeigt («Platz 3 von 20»); die
Meldung nennt deshalb gar keinen Zahlenbereich mehr — gewählt wird über Knöpfe,
dort tippt niemand einen Wert ein.

## 0.9.5 — 2026-08-27

**Das Running-Order-Blatt kennt den Abschnitt**

Bisher druckte es alle Zeiteinträge einer Bühne — Setup und Show gemischt. Sobald
Soundchecks als Setup-Einträge existieren, stünden sie zwischen den Acts. Das
sind aber zwei Abläufe mit verschiedenen Lesern: wer der Crew den Vormittag in
die Hand gibt, will nicht die Running Order darunter.

- Die Steuerleiste hat jetzt dieselbe Wahl wie die App: **Setup · Show · beides**.
- **Kopf und Fuß nennen den Abschnitt**, damit ein abgelegtes Blatt sich selbst
  erklärt. Bei «beides» bleibt die Angabe weg — es sind ja beide.
- `?abschnitt=setup|show|alle` steuert das von außen; `?ansicht=setup` wählt ihn
  gleich mit.

**Der Bauzeitenplan bleibt unberührt.** Nachgemessen: seine Tagesblätter zeigen
20 Gewerk-Häkchen und keine Bühne, der Gantt 153 Zeilen aus 353 Vorgängen, die
Tabelle nur Gewerk-Gruppen. Bühnen und Zeiteinträge tauchen dort nirgends auf.

**Behoben: eine leere Auswahl zeigte eine weiße Seite**

`Element.append()` gibt `undefined` zurück — die Kette `wrap.append(el(…)).lastChild`
warf, statt die Meldung «Für die gewählte Auswahl ist nichts eingetragen»
anzuzeigen. Das stand zweimal in `print.js` und fiel nie auf, weil es bis jetzt
immer mindestens ein Blatt gab. Die zweite Stelle war der Lade-Fehlerzweig: dort
hätte er die Fehlermeldung verschluckt, die er anzeigen sollte.

## 0.9.4 — 2026-08-27

**Der Soundcheck bekommt einen Balken**

Als Feld am Zeiteintrag war er ein Startzeitpunkt ohne Dauer und ohne Ende. Damit
tauchte er in keiner Zeitachse auf: ob sich zwei Soundchecks überschneiden, sah
niemand, und der Nachmittag ließ sich damit nicht planen.

- Ein Soundcheck ist jetzt ein **eigener Zeiteintrag im Setup-Abschnitt**, dem
  Act zugeordnet (`fuer`, Text-id wie `parent`). Damit hat er Start, Ende, Dauer,
  Farbe, Notiz und Anforderungen — und einen Balken.
- **Bedient wird er im Panel des Acts:** ein Klick legt ihn an, zwei Felder
  ändern Beginn und Dauer, ein Knopf entfernt ihn. Alles über den Store, also mit
  ⌘Z. In der Setup-Liste steht er danach wie jeder andere Eintrag.
- **Vorgabe: an den letzten Setup-Eintrag des Tages anschließen**, sonst 08:00.
  Die erste Fassung setzte ihn eine Stunde vor den Act — im Bild stand dann
  «19:40 Soundcheck SIDO», und ein Soundcheck läuft nun mal nachmittags.
- **Den Act löschen nimmt den Soundcheck mit.** Sonst bliebe eine Waise mit toter
  Zuordnung zurück; ein ⌘Z holt beides zusammen zurück.
- **Migration:** eine alte Soundcheck-Zeit wird beim Laden zu einem
  Setup-Eintrag «Soundcheck <Name>» (60 min), danach verschwindet das Feld —
  damit der zweite Ladevorgang keinen zweiten Eintrag anlegt. Eine Migration, die
  Vorgänge *erzeugt*, muss besonders sauber einmalig sein.

**Start und Ende ohne Datum**

Im Showablauf zeigten sie «08 / 29 / 2026, 12:00 PM», obwohl der Tag längst oben
im Umschalter steht. Zwei Spalten à 205 px für eine Information, die schon
dasteht — die Tabelle war 2120 px breit, und zum Ausfüllen der Anforderungen
musste man seitwärts scrollen. Jetzt sind es reine Uhrzeitfelder; **die Tabelle
passt ohne Scrollen ins Bild**. Im Bauzeitenplan bleiben sie datiert, der läuft
über vierzehn Tage.

Zwei Fallen, die das Datum bisher verdeckt hat — beide als reine Funktionen in
`conflicts.js`, mit eigenen Tests:

- `mitUhrzeit` **behält den Datumsteil**. Ein Eintrag vom Vortag ist über den
  Tagesfilter auch am Folgetag sichtbar; schriebe das Feld den gezeigten Tag,
  spränge er beim ersten Antippen einen Tag weit.
- `endeNachStart`: **Ende vor Start meint den Folgetag.** «22:00 bis 03:00» ist
  die selbstverständliche Schreibweise; ohne die Regel lehnte der Store ab. Der
  Folgetag kommt über den Kalender, nicht über +1440 Minuten — der 25.10.2026 hat
  25 Stunden.

## 0.9.3 — 2026-08-27

**Ein Umschalter statt zwei: Bauzeitenplan · Setup · Show**

In der Werkzeugzeile standen zwei Segmentgruppen im selben Stil nebeneinander —
Ebene und Abschnitt — mit je einem dunkel hinterlegten Knopf:

```
BAUZEITENPLAN [SHOWABLAUF]  [SETUP] SHOW ALLE  [GANTT] TABELLE
```

Das las sich als **eine** Leiste, in der zwei Dinge gleichzeitig angewählt sind,
und niemand fand, wie man zwischen Setup und Show wechselt. Technisch stimmte der
Zustand, die Oberfläche behauptete etwas anderes.

Jetzt gibt es **einen** Umschalter mit drei gleichrangigen Ansichten, in der
Reihenfolge des Tages — Bauzeitenplan, dann Setup, dann Show. Genau eine ist
gedrückt, man klickt direkt hin und her.

- `?ansicht=bau|setup|show` steuert das von außen. Die alten `?ebene=` und
  `?abschnitt=` werden weiter verstanden und übersetzt; ein gemerkter Stand aus
  0.9.2 wird beim ersten Start übernommen.
- Das **Datenmodell bleibt unverändert**: zwei Ebenen plus Abschnitt am
  Zeiteintrag. `app.js` leitet beides aus einem Zustand ab.
- Neue Prüfungen, die genau diesen Fehler gefunden hätten: **immer genau eine**
  Ansicht ist gedrückt, die Reihenfolge stimmt, und der Wechsel greift wirklich
  statt nur die Markierung zu setzen.

**Was dabei wegfällt**

«Alle» gibt es nicht mehr. Der komplette Showtag — Load-in bis Show-Ende in einer
durchgehenden Achse — lässt sich damit nicht mehr in einem Bild sehen; der
Bauzeitenplan ist dafür kein Ersatz, er zeigt Gewerke statt Bühnen. Der
Durchlass-Fall lebt intern weiter (`imAbschnitt` lässt alles durch, was nicht
`setup` oder `show` ist), eine vierte Stufe wäre also ohne Umbau nachrüstbar.

**Nebenbei**
- `ABSCHNITTE` listet nur noch die beiden Werte, die ein Zeiteintrag tragen kann.
  Tabelle und Panel bauen ihre Auswahlfelder daraus und mussten «alle» bisher
  jedes Mal herausfiltern.
- Die Druckseite versteht `?ansicht=` ebenfalls.

## 0.9.2 — 2026-08-27

**Eine Bühne, zwei Abläufe — statt zwei Bühnen**

In 0.9.1 trug die **Bühne** den Abschnitt: «Hauptbühne Setup» und «Hauptbühne
Show» waren zwei Bänder. Das bildet die Wirklichkeit falsch ab. Es gibt eine
Bühne, sie hat nur zwei zeitliche Abläufe — und der Store verbietet doppelte
Bühnennamen, man hätte sie künstlich verschieden benennen müssen.

- **Der Abschnitt hängt jetzt am Zeiteintrag** (`abschnitt: 'setup' | 'show'`).
  Der Umschalter **Setup · Show · alle** filtert die Einträge; die Bühne steht in
  beiden Ansichten, heißt einmal und ist dieselbe.
- **Die Bühne bleibt sichtbar, auch wenn sie im gewählten Abschnitt leer ist** —
  genau dort legt man den ersten Setup-Eintrag an.
- **Migration:** ein Plan aus 0.9.1 gibt den Abschnitt seiner Setup-Bühne an
  deren Einträge weiter, das Feld verschwindet vom Band. Idempotent — `migrate()`
  läuft bei jedem Laden. Bänder werden **nicht** automatisch zusammengeführt: das
  hieße raten, welches das Ziel ist, und Daten zu verschieben, die niemand
  zurückholt. Eine Setup-Bühne bleibt stehen, ihre Einträge sind korrekt
  markiert; wer sie loswerden will, hängt sie über die Bühnen-Spalte um.

**Behoben: `addTask` ließ den Abschnitt fallen**

Der Handler baut das Vorgangsobjekt Feld für Feld auf, und `abschnitt` stand
nicht dabei. Ein im Setup angelegter Eintrag landete dadurch in der Show — und
war im gezeigten Abschnitt sofort unsichtbar. Genau dieselbe Sorte Fehler wie der
falsche Tag in 0.9.1: der Knopf tut etwas, nur woanders.

**«Zeiteintrag» statt «Programmpunkt»**

Ein Line-Check ist kein Programmpunkt. Im ganzen Showablauf heißt eine Zeile
jetzt **Zeiteintrag** — Spaltenüberschrift, Knopf, Zähler («17 Zeiteinträge»),
die Ecke der Seitenspalte, der Vorgabename und die Kennzahl oben. Das Datenfeld
`punktTyp` bleibt (eine Umbenennung wäre eine Migration ohne Gegenwert), und auf
dem A3-Blatt steht weiter «Programmpunkt»: dort ist die Liste dem PDF
nachempfunden.

**Der Anlege-Knopf sieht aus wie ein Knopf**

`+ Zeiteintrag` im Bühnenkopf der Tabelle ist ein Primärknopf mit Fläche. Vorher
war er randlos und ohne Hintergrund, in kleinen Versalien — er sah aus wie eine
Beschriftung. Im Bauzeitenplan bleibt er schlicht: dort stehen 20 Gewerke
untereinander, und 20 Primärknöpfe wären eine Wand.

**Nebenbei**
- Neue Spalte **Abschnitt** in der Tabelle, damit man beim Tippen einer Reihe
  nicht ins Panel wechseln muss. Im Panel steht sie beim Eintrag statt bei der
  Bühne.

## 0.9.1 — 2026-08-27

**Behoben: neue Programmpunkte landeten am falschen Tag**

Der Knopf «+ Programmpunkt» in der Tabelle gibt es längst — er legte den Punkt
aber am **letzten Tag des Plans** an statt am gezeigten. `defaultStart()` suchte
den letzten Programmpunkt über alle Bühnen und alle Tage; bei zwei Showtagen kam
der letzte des zweiten heraus. Wer am ersten Tag auf einer leeren Bühne etwas
anlegte, bekam es an den zweiten gehängt — und der Tagesfilter blendete es sofort
aus. Der Knopf tat also etwas, nur unsichtbar. Jetzt schließt ein neuer Punkt an
den letzten **des gezeigten Tages** an; ist der Tag leer, beginnt er um 08:00.

Zwei Folgefehler aus derselben Ecke:

- **Eine leere Bühne war im Gantt unsichtbar.** Bänder ohne Vorgänge wurden
  übersprungen — im Bauzeitenplan richtig (ein leeres Gewerk unter zwanzig wäre
  Rauschen), im Showablauf falsch: eine frisch angelegte Bühne hat noch nichts,
  und «+ Bühne» war damit ein Klick ins Nichts.
- **Zoomstufe und Datumsfeld zeigten etwas anderes als die Achse.** Der Gantt
  passt sich an zwei Stellen von selbst ein — beim ersten Programmpunkt eines
  leeren Showablaufs und beim Wiederauftauchen aus der Tabelle. Beides ist
  asynchron; die Kopfzeile lief hinterher und schrieb schon mal den 25.10. ins
  Datumsfeld. Der Gantt meldet das jetzt (`onView`), statt dass jemand den
  Zeitpunkt rät.

**Setup und Show als zwei Ansichten**

Am Showtag gibt es zwei Abläufe mit ganz verschiedenen Uhrzeiten: Load-in und
Setup bis zum Showstart, danach die Running Order. Sie in einer Achse von 08 bis
23 Uhr untereinander zu zeigen, wird beidem nicht gerecht.

- Jede **Bühne** gehört einem Abschnitt (`abschnitt: 'setup' | 'show'`), und ein
  Umschalter **Setup · Show · alle** zeigt jeweils nur die passenden Bänder.
  Bestehende Bühnen sind «Show» — die Running Order bleibt, wo sie ist.
- **Jede Ansicht rechnet ihr Zeitfenster selbst**: Setup zeigt den Morgen, Show
  den Abend. Das fällt ohne Zutun ab, weil `programmFenster` über die sichtbaren
  Punkte rechnet.
- Eine **neue Bühne erbt den gezeigten Abschnitt**: wer im Setup-View «+ Bühne»
  drückt, bekommt eine Setup-Bühne. Im Panel lässt sich der Abschnitt ändern.
- Der Bauzeitenplan kennt den Umschalter nicht — Gewerke haben keinen Abschnitt,
  und `migrate()` hängt ihnen auch keinen an.

## 0.9.0 — 2026-08-26

**Farbige Balken im Showablauf — mit wählbarer Farbe und Schraffur**

Bisher war der ganze Abend orange und die Balken sahen leer aus. Zwei Ursachen,
die sich überlagerten: eine Bühne ist EIN Gewerk mit EINEM Farbplatz, den jeder
Programmpunkt erbt — und `status: 'geplant'` wird als transparenter Balken mit
farbigem Rand dargestellt, während im Showablauf niemand den Status pflegt.

- **Jeder Programmpunkt darf eine eigene Farbe tragen.** Neues Feld `slot` am
  Vorgang; `null` heißt «erbt die Farbe seiner Bühne», und genau so verhalten
  sich alle bestehenden Pläne.
- **Die Auswahl steht im Panel rechts:** zehn Farbtöne, ein Schalter **Schraffur**
  und **«wie Bühne»** zum Zurücksetzen. Ein Farbplatz IST das Paar aus Ton und
  Schraffur — deshalb reichen zehn Punkte und ein Häkchen für alle zwanzig
  Kombinationen. Aus Rot wird so Rot-mit-Schraffur.
- **Die Balken sind gefüllt**, im Bauzeitenplan bleiben sie umrandet. Was gerade
  läuft, sagen dort die Jetzt-Linie und die Live-Kopfzeile.
- Gewählt wird **aus der Palette**, nie eine freie Farbe. Im Bauzeitenplan bleibt
  die Zuordnung gerechnet: dort stehen 20 Gewerke untereinander, und genau dafür
  ist die Farbsuche gemacht.

**Die Schrift auf der Farbe ist jetzt ebenfalls gerechnet**

Gefüllte Balken tragen ihre Beschriftung auf der Farbe, und die Beschriftung ist
die vorgeschriebene sekundäre Kodierung — sie muss lesbar sein. Weiß erreicht auf
Gelb nur **2,17:1**; auf drei der zehn Töne lag der Kontrast unter der Grenze.
Neben jedem Farbton steht deshalb eine Schriftfarbe (`--gw-t-*` in `base.css`),
gewählt als die Tinte, die in **hell UND dunkel** über 3:1 bleibt: dunkel auf
sieben Tönen, weiß auf Violett, Grün und Ocker.

Eine neue statische Prüfung **«Schrift auf Gewerkfarbe hält 3:1 — in hell UND
dunkel»** rechnet das bei jedem Testlauf nach. Wer künftig an `--gw-*` dreht,
ohne die Tinte mitzurechnen, erfährt es sofort.

**Nebenbei**
- `js/palette.js` bekommt die Gegenrichtung zur Farbwahl: `hueVon` und `slotAus`,
  DOM-frei und mit eigenem Test (`tests/palette.test.mjs`), inklusive der
  Randfälle — negative, zu große und gebrochene Werte landen wieder in der
  Palette, statt auf `var(--gw-NaN)` zu zeigen.
- `setTaskField` validiert `slot`: `null` oder ein ganzer Platz aus der Palette.
  Ohne die Prüfung wäre ein Vertipper still in den Export gewandert.
- `js/inspector.js` war von der ganzen Showablauf-Arbeit bisher unberührt — das
  ist die erste Änderung dort.

## 0.8.2 — 2026-08-26

**Die Show-Ansicht sagt jetzt auch, wie lange etwas dauert**

- **Jede Stunde ist beschriftet.** Die Achse zeigt 12, 13, 14 … statt alle drei
  Stunden eine Marke. Ein Ablauf wird nach Uhrzeiten gelesen; «zwischen 12 und
  15» hilft niemandem. `ticksFor` kannte `'hour'` längst — am Bildschirm wurde es
  nur nie gewählt, weil 24 Stunden im Bauzeitenplan zu dicht stehen. Über einem
  Abend von zehn Stunden ist es genau richtig. Wer im Showablauf weit
  herauszoomt, bekommt wieder die normale Staffel.
- **Die Dauer steht in Minuten neben der Uhrzeit:**
  `14:00 Uhr  (30 min)  CREUTZFELD & JAKOB`. Bei einem Ablauf zählt man in
  Minuten, nicht in «0,5 h». Ein Meilenstein hat keine Dauer und sagt das mit
  einem Strich, statt eine Null zu behaupten.
- **Die Seitenspalte ist im Showablauf breiter** (390 statt 296 px). Dort stehen
  drei Angaben nebeneinander und es sind 17 Zeilen statt 153 — der Zeitstrahl
  braucht die Breite weniger dringend als der Ablauf. Der Bauzeitenplan bleibt
  bei 296 px.
- **Auf dem Handy bricht die Dauer unter die Zeile**, statt den Actnamen
  wegzudrücken:

  ```
  14:00 Uhr  OLLI BANJO
  (30 min)
  ```

  Beide Textzeilen passen in die vorhandene Zeilenhöhe; an der Geometrie ändert
  sich nichts.

**Nebenbei**
- Die Breite der Seitenspalte wird jetzt am DOM gemessen statt aus der Option
  genommen. Auf Handybreite erzwingt `base.css` 168 px, und die Tagesansicht
  rechnete dort mit dem eingestellten Wert — also um über hundert Pixel daneben.
- Die Bausteine der Showablauf-Ebene fehlten in vier der fünf Themes; nur das
  aktive `callboard` kannte sie. Die Prüfung «jedes Theme gestaltet alle
  Bausteine» schwieg, weil ihre Liste die neuen Namen nicht kannte — genau der
  Fall, für den sie gebaut wurde. Alle Themes tragen sie jetzt, die Liste kennt
  sie, und `docs/themes.md` sagt es beim Anlegen eines Themes.
- `README.md` und `docs/entscheidungen.md` standen noch auf v0.7.1 und verwiesen
  auf `pocketbase/README.md`, die es seit v0.8.0 nicht mehr gibt. Beide sind auf
  Stand, inklusive der Begründungen zur Ebenen-Trennung.

## 0.8.1 — 2026-08-26

**Der Showablauf liest sich jetzt als Ablauf**

Die Ebene erbte die Zeilenbildung des Bauzeitenplans: `seriesRows` bündelt
Vorgänge gleichen Namens zu EINER Zeile mit mehreren Balken. Für einen
Bauzeitenplan ist das richtig — «Aufbau Bühne» an drei Tagen ist eine Tätigkeit.
Für einen Showablauf war es falsch: es entstand eine Zeile «Changeover» mit sechs
Balken, die zwischen den Acts hing, und die Zeilenfolge richtete sich nach dem
frühesten Termin jeder Serie statt nach dem Abend.

- **Jeder Programmpunkt trägt seine eigene Zeile**, sortiert nach Startzeit. Die
  Ansicht liest sich von oben nach unten wie der Ablaufplan auf Papier:
  Einlass · Band · Umbau · Band · Umbau. `lanes` ist immer 1 — zwei gleichzeitige
  Dinge auf einer Bühne sind zwei Zeilen, keine Spuren.
- **Die Startzeit steht links vor dem Namen** («12:00  DOORS»), tabellarisch
  untereinander. Damit ist die Seitenspalte allein schon der Ablaufplan.
- **Der Abend füllt die Breite**, nicht der Kalendertag. Die Achse spannt von
  Doors bis Show-Ende statt über 24 Stunden; vorher nahm der leere Vormittag die
  halbe Fläche ein und die Umbauten waren Striche. Rechts bleibt eine halbe
  Stunde Luft, damit die Beschriftung des letzten Punkts nicht über die Kante
  läuft.

**Der Bauzeitenplan bleibt unverändert** — er bündelt weiter (353 Vorgänge auf
153 Zeilen) und trägt keine Uhrzeit in der Spalte. Ein Test hält beides fest.

**Nebenbei**
- Die grobe Achsenzeile (Datum) beginnt eine Einheit früher als der Ausschnitt.
  Gesucht ist der Tag, in dem man sich befindet, und der beginnt links außerhalb,
  sobald man in ihn hineingescrollt ist — vorher fiel er heraus und die Achse
  stand ganz ohne Datum da. Betrifft beide Ebenen; im Bauzeitenplan war die Zeile
  bisher nur dann leer, wenn man in einen Tag hineingezoomt hatte.
- `zeitraumFuer` ist entfallen, `programmFenster` ersetzt es.

## 0.8.0 — 2026-08-25

**Showablauf — der Tagesablauf auf den Bühnen, als zweite Ebene**

Derselbe Plan, zwei Blickrichtungen. Oben im Kopf schaltet man zwischen
**Bauzeitenplan** (die ganze Veranstaltung: Vorbereitung, Aufbau, Show, Abbau)
und **Showablauf** (was auf welcher Bühne läuft). Beide Ebenen haben Gantt und
Tabelle, dieselbe Bedienung, denselben Store — nur sind die Zeilenbänder hier
Bühnen statt Gewerken.

- **Bühnen, Räume, Hallen** legt man an wie ein Gewerk (`+ Bühne`), benennt und
  sortiert sie genauso. Technisch ist eine Bühne ein Gewerk mit `art:'buehne'`;
  damit greifen Anlegen, Umbenennen, Drag & Drop, Undo, Auto-Save und der
  JSON-Export vom ersten Tag an. Altpläne ohne das Feld sind durchweg Gewerke —
  der Bauzeitenplan sieht aus wie immer.
- **Farbplätze werden je Ebene vergeben.** Der Klassentreffen-Plan hat schon 20
  Gewerke, also genau `MAX_SLOTS`. Zählte man beides zusammen, wäre die Palette
  mit der ersten Bühne erschöpft — dabei sind Gewerke und Bühnen nie zusammen
  zu sehen.
- **Der Showablauf ist tagesbezogen.** Ein Umschalter über dem Gantt wählt den
  Showtag; die Vorgabe ist der Tag, auf dem «jetzt» liegt, sonst der erste.
  Ohne ihn standen die Acts des zweiten Tages als zehn Zeilen ohne Balken im Bild.
- **Vier neue Spalten in der Tabelle**, genau dort, wo man den Zeitstrahl anlegt:
  Typ (Act · Changeover · Doors · Show-Ende), Soundcheck, Kontakt und die beiden
  Freitexte **Anforderungen** und **Benötigtes Material**. Sie gehen denselben
  Weg wie jedes andere Feld: über den Store, also mit ⌘Z, Auto-Save und Export.
- **Live-Kopfzeile** für den Monitor am FOH: was JETZT läuft, was ALS NÄCHSTES
  kommt, der Verzug und die Uhr. Ein Changeover wird als Umbau angesagt, nicht
  als Act. Der Verzug zählt nur, was noch aussteht oder gerade läuft — ein
  vergangener, nie abgehakter Punkt ist keine Verspätung, sondern eine fehlende
  Rückmeldung, und stand vorher als «+4 Std» über einem Abend, der pünktlich lief.
- **Running-Order-Blatt** auf der Druckseite: ein A3 quer je Tag und Bühne, als
  Liste im Stil des Ablaufplans — `Zeit · Programmpunkt · Anforderungen ·
  Material`. Leere Felder drucken als **Linien zum Ausfüllen mit dem Stift**.
  Umbauten treten zurück, verschwinden aber nicht.
- **Die Running Order des Klassentreffen-Plans ist eingebaut** (Stand 05.08.2026):
  beide Showtage, 32 Programmpunkte, quellentreu. Anforderungen und Material
  bleiben leer — die trägt Marco ein.

**PocketBase ist raus**

Die vorbereitete Login- und Rollenschicht lag seit v0.3.0 bewusst uncommittet im
Arbeitsbaum. Sie griff nur mit `?backend=pb` und tat auf der Seite nichts — lud
ihre Module aber bei jedem Aufruf mit und machte jeden Commit zur Prozedur. Die
Seite ist eine reine GitHub-Pages-Auslieferung ohne Nutzerverwaltung; damit ist
`js/app.js` wieder das, was es sein soll. Der komplette Stand ist im Branch
`pocketbase-vorbereitung` festgehalten und geht nicht verloren.

**Nebenbei**
- Achsen-Ticks und das Wochenendband werden auf das Planende geklemmt. Sie
  ragten darüber hinaus und machten den Scroller um 1400 px breiter, als der
  Inhalt war — im Bauzeitenplan unsichtbar, im Showablauf rutschte der ganze Tag
  aus dem Bild.
- Die Tagesansicht passt sich neu ein, wenn der Container seine Breite ändert.
  Vorher blieb sie auf der Breite stehen, die beim Setzen galt.
- `zeitraumFuer` rechnet den nächsten Tagesanfang über den Kalender, nicht mit
  `+1440` — der 25.10.2026 hat 25 Stunden.
- Neues Prüfwerkzeug `tools/verify-showablauf.mjs`: Ebenenwechsel, Bühnen- und
  Tagesfilter, die neuen Spalten samt ⌘Z, die Live-Kopfzeile bei gestellter Uhr,
  das A3-Blatt, Dunkelmodus und Handybreite.

## 0.7.1 — 2026-08-25

**Tagesblätter zum Drucken — ein A3 quer je Tag**
- Neuer Knopf **Drucken** im Kopf: `print.html` zeigt den Plan als Blätter für die
  Wand im Produktionsbüro, ein Blatt je Kalendertag. Am Bildschirm sehen sie aus
  wie im Druck, damit man vorher prüft statt danach.
- **Gewerke wegklicken** — der wichtigste Regler. Er räumt nicht nur auf, er
  bestimmt den **Maßstab**: an einem Aufbautag zwingt allein die Objektbewachung
  (00:01–23:59) das Blatt auf 24 Stunden. Ohne sie schrumpft das Zeitfenster auf
  08:00–18:00 und die Balken werden dreimal so breit.
- Das Zeitfenster wird **automatisch aus der Auswahl** gerechnet und gilt für alle
  Blätter gemeinsam, damit sie vergleichbar bleiben — von Hand übersteuerbar.
- Vorgänge über Mitternacht (Nachtschichten, Objektbewachung — 40 im Plan) stehen
  auf **beiden** Blättern, angeschnitten und als solche markiert.
- Die Zeilenhöhe füllt das Blatt: ein Tag mit 17 Zeilen sieht nicht aus wie einer
  mit 64. Was unten frei bleibt, ist Platz für Notizen von Hand.
- An der App selbst ändert sich nichts — sie bekommt einen Link.

**Nebenbei**
- `tools/version.mjs` und der Testlauf stempeln und prüfen jetzt **jede**
  ausgelieferte HTML-Seite. Vorher kannten beide nur `index.html`; eine zweite
  Seite mit eigenen `?v=` wäre still auseinandergelaufen.
- `ticksFor` kennt eine Stundenstufe (bisher nur 3- und 6-Stunden-Schritte).

## 0.7.0 — 2026-08-25

**Eine Zeile je Vorgang, ein Balken je Termin**
- Der Gantt zeigte bisher **eine Zeile je Eintrag** — und weil ein Bauzeitenplan
  tageweise gedruckt wird, stand dieselbe Tätigkeit mehrfach untereinander. Die
  Bühne hatte sechs Zeilen für drei Dinge, die Crew **113 Zeilen**. Jetzt gilt:
  die Zeile sagt **was**, die Balken sagen **wann**. Aus 353 Zeilen werden **153**.
- „Aufbau Bühne" ist eine Zeile mit drei Balken (24./25./26.08.), jeder Balken
  beschriftet. Die Zeilenbeschriftung nennt die Zahl der Termine («3×»).
- **Überlappende Termine bekommen eine zweite Spur** in derselben Zeile — am
  29.08. laufen zwei SITECREW-Trupps parallel, die dürfen nicht übereinanderliegen.
  Im ganzen Plan betrifft das genau zwei Zeilen.
- Konflikt- und KRIT-Marken gelten jetzt für die Zeile **als Ganzes**: eine Marke,
  sobald irgendein Termin betroffen ist. Eine Zeile umzubenennen benennt alle ihre
  Termine um — sonst risse einer aus der Zeile heraus.
- Ist ein Balken zu schmal für seinen Text, steht die Beschriftung rechts daneben.
  Folgt dort schon der nächste Balken, wird sie **ausgeblendet** statt quer
  darüberzulaufen; den Namen trägt dann die Zeile links, die immer stehen bleibt.
- Die **Tabelle bleibt flach** — eine Zeile je Vorgang. Sie ist der Editor: Start,
  Dauer, Crew und Notiz gehören zum einzelnen Termin, nicht zur Serie.

**Daten: „Tag 1/2/3" ist keine Vorgangsbezeichnung**
- `Aufbau Bühne Tag 1/2/3` und `Abbau Bühne Tag 1/2` heißen jetzt schlicht
  `Aufbau Bühne` bzw. `Abbau Bühne`. Der 24.08. **ist** Tag 1 — das sagt das
  Datum. Die Tagesnummer steht weiterhin in der Notiz («Tag 1 von 3»), es geht
  also nichts verloren.

## 0.6.0 — 2026-08-25

**Der Plan steht sofort da — Adresse weitergeben genügt**
- Beim Start lädt die App den Klassentreffen-Plan **automatisch** aus
  `klassentreffen-festival.json`. Wer die Adresse aufruft, sieht ihn ohne Import
  und ohne Datei im Anhang. Bisher landete jeder Besucher auf einer leeren App
  und musste erst eine JSON importieren, die man ihm mitschicken musste.
- **Die Datei im Repo ist die Wahrheit.** Kommt ein neuer Stand (V08, V09 …),
  wird nur die JSON ausgetauscht und gepusht — jeder Betrachter zieht sie beim
  nächsten Laden von selbst nach. Erkannt wird das am `exported`-Stempel, den
  der Export ohnehin mitschreibt: ist der in der Datei neuer als der zuletzt
  geladene, gewinnt die Datei.
- Ist der Stempel gleich, bleibt die **lokale Fassung** stehen — sonst verlöre
  man bei jedem Neuladen seine eigenen Änderungen. Ist die Datei nicht
  erreichbar (offline), wird ebenfalls lokal geöffnet.
- `?plan=amk` öffnet den AMK-Plan, `?plan=leer` überspringt den Autostart und
  zeigt den Projektdialog — für eigene Projekte. Beide Pläne stehen jetzt auch
  im Projektdialog unter **„Mitgelieferte Pläne"**.

## 0.5.0 — 2026-08-25

**Klassentreffen-Beispieldaten auf V07 (Stand 25.08.2026)**
- `klassentreffen-festival.json` stammt jetzt aus **Bauzeitenplan V07** statt V03.
  Das ist kein Nachtrag, sondern ein anderer Plan: der 23.08. ist nicht mehr
  baufrei (der Meilenstein „Baufrei" entfällt), es gibt **zwei Showtage**
  (29. + 30.08.), und der komplette **Personal-Block** (SITECREW, HELFER,
  STAPLERFAHRER, CLIMBER, STEELHANDS, SHOW CREW …) ist tagesgenau mit Kopfzahlen
  ausgewiesen. **361 V07-Zeilen → 353 Vorgänge**, davon 19 mit geschätzter
  Uhrzeit (in V07 ohne Zeitangabe gedruckt).
- Neues Gewerk **„Crew"** für den Personal-Block → 20 Gewerke. Das ist exakt
  `MAX_SLOTS`; ein 21. Gewerk verlangt eine neue Farbsuche. Ein Test hält das fest.
- Verschmolzen wird nur, was **ohne Unterbrechung weiterläuft** (23:00–00:00 +
  00:00–03:00). Eine Wiederholung am Folgetag bleibt eine eigene Zeile — sonst
  sähe die Nacht dazwischen nach Durcharbeiten aus.
- Neu gegenüber dem zwischenzeitlichen V06-Stand: **CCTV** (Aufbau 27.08.,
  Abbau 31.08.), **CATERING ASSISTANT** an beiden Showtagen, eine zusätzliche
  **Container-Anlieferung am 22.08.**, und die in V06 durchgestrichene Zeile
  **„SHOWCREW SIDO complete audio"** steht in V07 regulär drin. Die
  Wasserversorgung rückt auf den 21.08., „Einrichten Crew Catering Zelt" auf den
  24.08. Der Sanitätsdienst hat jetzt fast überall echte Zeiten (Pandemedics)
  statt Schätzungen.
- Container- und Kabinenzeilen drucken in V07 die komplette Stückliste in die
  Spalte „Aktion". Als Balkenbeschriftung wäre das unbrauchbar: der **Titel trägt
  die Kurzform, die Notiz die vollständige gedruckte Liste** — nichts geht verloren.
- Weiterhin **keine** erfundenen Verknüpfungen: V07 ist ein terminierter Kalender.

## 0.4.1 — 2026-07-18

**Verknüpfen: suchen statt scrollen**
- Beim Verknüpfen zweier Vorgänge gibt es jetzt ein **Suchfeld**: tippen filtert die
  Liste sofort, statt durch alle Vorgänge zu scrollen (bei 100+ Vorgängen der
  entscheidende Unterschied). Die Treffer sind **nach Gewerk gruppiert** und je
  Gewerk **nach Startzeit** sortiert, mit Kontext (Gewerk · Datum/Uhrzeit) — wichtig,
  wenn Namen sich ähneln.
- Bedienung per Tastatur (↑↓ + Enter) oder Klick. Der Vorgang selbst und bereits
  Verknüpfte tauchen nicht auf; Ringe lehnt die App weiter mit Namen ab.

## 0.4.0 — 2026-07-18

**Prüf-Liste: sehen, was kritisch bzw. im Konflikt ist — und entscheiden**
- Die **„kritisch"-Kachel** im Kopf und der **Konflikt-Knopf** öffnen jetzt eine
  Liste, die zeigt, WELCHE Vorgänge gemeint sind. Bisher waren es nur Zahlen; der
  Knopf verschob blind alle Konflikte auf einmal.
- Je Eintrag: **Zeigen** (springt zum Vorgang, wählt ihn aus — auch aus
  eingeklappten Gewerken/Untervorgängen heraus), bei Konflikten **Lösen** (nur
  diesen auf die früheste mögliche Lage) und **Ist ok** (abhaken). „Alle auflösen"
  bleibt als Abkürzung.
- Kritische Vorgänge lassen sich als **Gesehen** abhaken — sie fallen aus der
  „kritisch"-Zahl (im Gantt ein ruhiges ✓ statt des roten KRIT). „Doch prüfen"
  nimmt es zurück.
- Abhaken ist eine bewusste Aussage und bleibt gespeichert (kein Nörgeln nach
  jedem Neuladen), rückgängig per ⌘Z. Ein akzeptierter Konflikt **meldet sich
  wieder, wenn er größer wird** als beim Abhaken — er verschwindet nicht für immer.

## 0.3.0 — 2026-07-18

**Gleiche Reihenfolge in beiden Ansichten**
- Vorgänge eines Gewerks stehen jetzt in Gantt **und** Tabelle nach Startzeit
  (08:00 über 08:05), aus einer Quelle. Bisher zeigte der Gantt sie in
  Einfügereihenfolge — derselbe Plan sah in beiden Ansichten anders sortiert aus.
  Neu angelegte oder verschobene Vorgänge sortieren sich automatisch ein.

**Untervorgänge**
- Vorgänge können jetzt **Untervorgänge** haben (z. B. „PA hängen" mit Main PA SL/SR,
  Sidefill, Delay …). In der Tabelle legt „+↳" einen Untervorgang an; er wird
  eingerückt und ist über den Pfeil am Elternvorgang **einklappbar** — in Tabelle
  und Gantt.
- Der übergeordnete Vorgang ist die **Hülle** seiner Untervorgänge: Start und Ende
  ergeben sich automatisch (frühester Kindstart … spätestes Kindende) und sind nicht
  von Hand editierbar. Im Gantt erscheint er als Sammelbalken über seinen
  Untervorgängen. Elternvorgang löschen nimmt die Untervorgänge mit (⌘Z holt alles
  zurück). Eine Ebene tief.

**Handy & Tablet**
- Die Seite ist jetzt auf schmalen Bildschirmen bedienbar: der Kopf bricht um, die
  Detailseite öffnet als Overlay von rechts, Gantt und Tabelle scrollen für sich —
  die Seite selbst läuft nicht mehr über den Rand. Größere Tap-Ziele fürs Antippen.

## 0.2.1 — 2026-07-18

**Gewerke umsortieren**
- In der Tabellenansicht lässt sich die Reihenfolge der Gewerke jetzt per Drag &
  Drop ändern: den Griff (⠿) am Gruppenkopf greifen und an die gewünschte Stelle
  ziehen (Maus oder Touch). So steht „Produktion" bei dem einen Event ganz oben,
  beim nächsten weiter unten — in einer Geste statt vieler Einzelschritte.
- Die **Farbe bleibt am Gewerk**, nicht an der Position: Umsortieren färbt nichts
  um. Rückgängig per ⌘Z. Die bisherigen „Nach oben/unten" (Rechtsklick & Panel)
  bleiben als präziser Zusatzweg.

## 0.2.0 — 2026-07-18

**CallBoard — Logo & Marke**
- Logo im Kopf: Shield + Clipboard + Uhr (48 px), Wortmarke „CallBoard" mit
  Unterzeile „Bauzeitenplan · Event". Der gelbe Minutenzeiger (#f7c948) ist das
  einzige farbige Element und lebt ausschließlich im Logo.
- Favicon (SVG, passt sich hellem/dunklem Browser-Tab an).

**Neues Theme „callboard" (NYX-Navy-CI) — jetzt aktiv**
- Navy/Paper, ruhig und technisch; Gold nur im Logo, kein UI-Gold mehr.
- Schriften Geist + JetBrains Mono, selbst gehostet unter `assets/fonts/`
  (offline, keine externen Requests).
- **Hell/Dunkel im Kopf umschaltbar** (☾/☀): Hell = Paper, Dunkel = Navy. Die
  Wahl merkt sich der Browser (`bzp_mode`); ohne Wahl folgt die App dem System.

**Nebenbei**
- Kein überflüssiger Reload beim allerersten Besuch mehr — der Service Worker lädt
  nur bei einem echten Update neu, nicht schon beim ersten Übernehmen der Seite.

## 0.1.4 — 2026-07-17

**Import**
- Die Rückfrage bei Namensgleichheit ist jetzt ein Popup im App-Design statt
  des nativen Browser-Dialogs — gleiche Optik wie der Projektdialog, drei klare
  Knöpfe (Ersetzen · Zusätzlich behalten · Abbrechen) mit ausdrücklichem
  Abbrechen, das den Import ganz stoppt

## 0.1.3 — 2026-07-17

**Zeitachse**
- Tagesansicht zeigt das Datum mit Wochentag mittig über den Stunden („Do 27.08.")
- Feinere Stundenraster: 3-Stunden-Schritte (00 · 03 · 06 … 21) statt 6-Stunden

**Import**
- Beim Import fragt die App, ob ein bereits vorhandener Plan gleichen Namens
  ersetzt wird (nur diese Datei laden) oder zusätzlich importiert — keine
  stillen Duplikate mehr; erneuter Import derselben Datei überschreibt sich

**Klassentreffen-Vorlage**
- Neu aus dem Detail-Bauzeitenplan V03 gebaut: echte Uhrzeiten statt Halbtage,
  Dienstleister in der Notiz; mehrfach gelistete Dauer-/Mehrtagestätigkeiten
  (Objektbewachung, Schichten, mehrtägige Auf-/Abbauten) je zu einem Balken
  zusammengefasst
- Zehnter Palettenton (Türkis) für Pläne mit mehr als neun Gewerken

## 0.1.2 — 2026-07-16

**Optik**
- Deutlich heller: heller Modus jetzt auf Weiß (statt gedämpftem Creme),
  dunkler Modus von Fast-Schwarz auf ein angehobenes Schiefergrau — in beiden
  Systemeinstellungen spürbar heller

## 0.1.1 — 2026-07-16

**Bedienung**
- Datums-Navigation in der Toolbar: Feld zum direkten Springen zu einem Tag,
  plus ◀ / ▶ zum tageweisen Blättern (läuft mit dem Sichtfenster mit)
- Tagesansicht zeigt jetzt **einen Kalendertag über die volle Breite**,
  linksbündig auf 00:00 — der „Tage"-Knopf zieht den Tag im Blick auf
- Optik heller (warmes Creme eine Stufe aufgehellt) und Schrift 30 % größer;
  Zeilen, Balken und Achse wachsen proportional mit (`--fs` als ein Regler)

**Palette**
- Neunter Farbton (Ocker) für Pläne mit mehr als acht Gewerken; bis 18 Gewerke
  über Farbe + Schraffur eindeutig. Legende liest Farbe/Schraffur jetzt aus
  `palette.js` statt aus einer zweiten, fest verdrahteten Kopie

**Vorlagen**
- Klassentreffen Festival 2026 als importierbare JSON aus dem PDF-Grobplan
  (17 Gewerke, quellentreu, alle Dauern als geschätzt markiert), erzeugt und
  quellentreu geprüft über `tools/make-klassentreffen.mjs`

## 0.1.0 — 2026-07-16

Erste benannte Version. Der Stand, mit dem du arbeiten kannst.

**Darstellung**
- Gantt mit vier Zoomstufen (Monate/Wochen/Tage/Stunden), bemessen nach
  sichtbarer Zeitspanne statt nach Pixeln
- Abhängigkeiten aller vier Typen (FS/SS/FF/SF) mit Lag, Meilensteine,
  kritischer Pfad, Puffer
- Gewerk-Farben gerechnet statt ausgesucht: 720 Anordnungen durchgeprüft auf
  Unterscheidbarkeit benachbarter Zeilen bei Farbenblindheit. 8 Farbtöne ×
  2 Schraffuren = 16 Gewerke
- Vier Gestaltungsebenen, `console` ist aktiv

**Bearbeiten**
- Tabelle zum schnellen Befüllen, Dauer als Kurzform (`4h`, `1,5h`, `2t`, `1t 4h`)
- Seitenpanel für alle Felder inklusive Verknüpfungen
- Rechtsklick-Menü, Doppelklick benennt an Ort und Stelle um
- Undo/Redo über Schnappschüsse, Auto-Save, JSON-Export
- Konflikte werden benannt («startet 3 h zu früh für …») und auf Knopfdruck
  aufgelöst — nie hinter deinem Rücken

**Live-Modus**
- Zeitlinie läuft mit, Ansicht folgt, laufende Vorgänge leuchten
- Verzug im Klartext («sollte seit 20m laufen»). Der Status wird **nie**
  automatisch gesetzt — sonst sähe der Plan immer nach Plan aus

**Vorlagen**
- Festival (ausgearbeitet), Tour, Corporate, Messe (Gerüste), leer
- AnnenMayKantereit Outdoor Singleshow als importierbare JSON

**Grundlage**
- Kein Build-Step, ES-Module, GitHub Pages
- `sw.js` als Cache-Buster: erzwingt Revalidierung, cacht selbst nichts
- 276 Prüfungen: Unit-Tests plus Verhaltensprüfung im echten Browser
