# Entscheidungen

Warum Dinge so sind, wie sie sind. Nur das, was sich aus dem Code nicht ablesen lässt.

## Grundsätzliches

| Frage | Entscheidung | Warum |
|---|---|---|
| Zeitachse | Vier Zoomstufen: Monate / Wochen / Tage / Stunden | Der Zeitraum spannt Monate, der Load-In läuft stundengenau. Ein Raster kann beides nicht. |
| Backend | **Keines.** Reine statische Auslieferung, localStorage + JSON-Export | Eine vorbereitete PocketBase-Schicht wurde in v0.8.0 aus `main` entfernt (siehe unten). Kommt der Bedarf zurück, wird es eine **eigene** Instanz, keine Kopplung an Crewplaner: übernommen werden Muster und Erfahrungen, nicht die Daten. |
| Gantt-Zeilen | Zwei Ebenen: Band (aufklappbar) → Vorgänge | Entspricht dem klassischen Bauzeitenplan. Das Band ist je nach Plan-Ebene ein Gewerk oder eine Bühne. |
| Abhängigkeiten | Von Anfang an, alle vier Typen + kritischer Pfad | — |
| Build-Step | Keiner. Native ES-Module. | Konsistent zu Crewplaner und Personalplan. |

## Zoomstufen sind nach Sichtbarkeit bemessen, nicht nach runden Zahlen

Der erste Entwurf setzte „Tage" auf 720 px/Tag. Das zeigt **1,8 Tage** — faktisch
eine Stundenansicht. Die Presets in `js/timeaxis.js` sind jetzt danach gewählt, was
auf einem ~1300 px breiten Zeitfeld tatsächlich sichtbar ist:

| Stufe | px/min | sichtbar |
|---|---|---|
| Monate | 0.02 | ~45 Tage — das ganze Projekt |
| Wochen | 0.08 | ~11 Tage — Aufbau + Show |
| Tage | 0.25 | ~3,6 Tage — die Aufbauwoche |
| Stunden | 1.5 | ~14 Stunden — der Load-In-Tag |

`tests/timeaxis.test.mjs` prüft das als **sichtbare Zeitspanne**, nicht als px-Wert.
Wer die Presets ändert, muss durch diese Tests.

Seit v0.1.1 zieht der **„Tage"-Knopf einen einzelnen Kalendertag über die volle
Breite auf** (`fitDay`, linksbündig auf 00:00) statt fixer px/min — die 0,25 oben ist
der historische Ausgangswert, nicht mehr das aktuelle Verhalten der Tagesstufe.

## Der kritische Pfad braucht einen echten Zielmeilenstein

Die naive Ankerregel — „Vorgänge ohne Nachfolger enden an ihrem geplanten Termin" —
macht **jede Kettenendstelle zwangsläufig kritisch**. Ergebnis war: 27 von 39
Vorgängen markiert, also nutzlos.

Lösung, zweiteilig:

1. Ein Zielmeilenstein (`doors`), auf den alle Gewerke münden. Der Abstand zum
   eigenen Ende ist der Puffer des Gewerks.
2. `critical = float <= minFloat`, wobei **verankerte Senken aus dem minFloat
   herausfallen**. Sonst zöge allein der Zielmeilenstein (Puffer 0 per Definition)
   den minFloat auf null und kein Vorgänger wäre je kritisch.

Ergebnis: eine saubere Kette Bühne → Rigging → Ton/Video/Pyro. Licht hat 22 h Puffer,
die Genehmigungen Wochen. Bei einem straff durchgeplanten Netz ist minFloat 0 und die
Regel entspricht der klassischen CPM.

Regressionstests dafür stehen in `tests/schedule.test.mjs`.

## Gewerk-Farben sind gerechnet

Acht Gewerke, acht Farben aus einer validierten Palette. Die **Zuordnung** stammt aus
einem Suchlauf über 720 Varianten (`docs/farbsuche.md`), der die Unterscheidbarkeit
**benachbarter Zeilen** bei Farbenblindheit maximiert — im Gantt stehen benachbarte
Gewerke direkt untereinander, deshalb zählen genau die Nachbarpaare.

Licht = Gelb und Pyro = Rot waren semantisch gesetzt. Der Rest fiel aus der Rechnung:
Bühne = Baustellen-Orange, Sanitär = Grün ergaben sich als bester Gleichstand und
tragen zusätzlich Bedeutung.

Erreicht wird das theoretische Maximum: worst-adjacent CVD ΔE 9,1 (hell) / 8,4 (dunkel),
Normalsicht ΔE 19,6 / 19,3. Alle harten Gates bestanden, in Hell und Dunkel.

**Nicht per Hand ändern.** Wer die Reihenfolge umstellt, macht die Prüfung wertlos.

Später kamen zwei weitere Töne dazu — **Ocker (`--gw-8`) und Türkis (`--gw-9`)** —
für Pläne mit mehr als acht Gewerken (Palette heute: 10 Töne × 2 Schraffuren = 20
Plätze, `HUES=10`/`MAX_SLOTS=20`). Die beiden stehen **bewusst außerhalb** der
Farbsuche (auf Ansage handgesetzt in `base.css`). Sauber wäre, die Suche für zehn Töne
neu zu rechnen, falls der Bedarf bleibt.

### Reliefregel — bitte nicht wegoptimieren

Rigging (`#1baf7a`), Licht (`#eda100`) und Ton (`#e87ba4`) liegen auf hellem Grund
**unter 3:1 Kontrast**. Das ist zulässig, aber nur mit sekundärer Kodierung. Deshalb:

- **jeder Balken trägt eine sichtbare Beschriftung** (`gantt.js` → `bz-bar-t`),
- die Legende trägt Namen, nicht nur Farbpunkte,
- der kritische Pfad ist zusätzlich durch das `KRIT`-Kürzel markiert, nicht nur rot.

Wer die Balkenbeschriftung entfernt, bricht die Barrierefreiheit.

## Erfahrungen aus Crewplaner, die hier als Regel gelten

Teuer gelernt, hier vorab eingebaut:

- **`project_id` & Co. als Text, niemals als Relation.** Der Coolify-Reimport kippt
  Relations und bricht sämtliche Filter.
- **E-Mails immer `.toLowerCase()`** speichern und filtern — PocketBase-Filter sind
  case-sensitive.
- **API-Rules nach jedem Coolify-Redeploy prüfen** — sie fallen auf `auth != ""`
  zurück. Gehört auf die Deploy-Checkliste.
- **Kein Bundle-File.** ES-Module mit `?v=`-Cache-Bust.
- **UI-Verstecken ist keine Sicherheit.** Rollen müssen serverseitig über
  API-Rules erzwungen werden, `rbac.js` blendet nur aus.

## Zeitzonen

Alle Zeiten intern als **Minuten seit Epoche** (`toMin()`), gerechnet aus echten
Zeitstempeln — nie aus Ziffernarithmetik auf Datumsstrings. Sonst ist die Dauer über
den Sommerzeit-Sprung falsch, und dieser Bug schlägt genau einmal im Jahr zu.
Ein Test deckt den DST-Übergang ab.

### `nowInZone` darf nicht stumm zurückfallen

Die Jetzt-Linie zeigt die Zeit in der **Projekt**-Zeitzone; `nowInZone` in
`gantt.js` formatiert dafür mit `Intl` und liest das Ergebnis wieder ein. Bis
v0.9.6 konnte dieses Einlesen auf zwei Wegen scheitern, und beide endeten im
`catch` — also in der lokalen Systemzeit, ohne ein Wort:

- `hour12: false` wählt in manchen Engines den Stundenzyklus **h24**. Mitternacht
  heißt dann «24:00», und `new Date('…T24:00')` ist ein Invalid Date. Der Rückfall
  wäre also **jede Nacht** passiert. Jetzt steht dort `hourCycle: 'h23'`.
- `Intl` liefert je nach Engine ein geschütztes Leerzeichen (U+00A0, U+202F).
  `replace(' ', 'T')` griff dann nicht. Jetzt `replace(/\s+/, 'T')`.

Zusätzlich prüft die Funktion das Ergebnis auf `Invalid Date` und schreibt beim
Rückfall einmalig eine Warnung. **Eine falsche Jetzt-Linie ist schlimmer als
keine** — sie darf nicht lautlos entstehen.

Warum das so lange unentdeckt blieb: ein Projekt erbt seine Zone beim Anlegen vom
Browser (`templates.js`, `persistence.js`). Für fast jeden ist Projekt-Zone ==
lokale Zone, und dann liefert der Rückfall zufällig das Richtige. Die Prüfung in
`tools/verify-live.mjs` stellt deshalb **zwei Betrachter in verschiedenen Zonen**
auf dasselbe Berlin-Projekt und verlangt die Linie an derselben Stelle — zum
Zeitpunkt Mitternacht in Berlin, also genau auf der «00:00»-Falle.

## Zwei Ebenen statt zweier Anwendungen

Ein Bauzeitenplan und ein Showablauf sehen verschieden aus, haben aber dieselbe
**Form**: eine benannte, sortierbare, eingefärbte Spur mit Vorgängen darin. Deshalb
ist eine **Bühne technisch ein Gewerk mit `art:'buehne'`** und ein Zeiteintrag ein
normaler Vorgang darin (`js/ebene.js`). Der Preis der Alternative wäre ein zweiter
Store, ein zweites Undo und eine zweite Persistenz gewesen — für dasselbe Verhalten.

Altpläne kennen das Feld nicht und sind deshalb durchweg Gewerke; der Bauzeitenplan
sieht aus wie immer. **Ein Gewerk wird nie nachträglich zur Bühne**: alle Vorgänge
darin sprängen die Ebene mit.

Die **Farbplätze werden je Ebene vergeben**. Der Klassentreffen-Plan hat 20 Gewerke,
also genau `MAX_SLOTS`. Zusammengezählt wäre die Palette mit der ersten Bühne
erschöpft — dabei sind Gewerke und Bühnen nie zusammen zu sehen.

**Gebündelt wird nur im Bauzeitenplan.** Dort ist «Aufbau Bühne» an drei Tagen EINE
Tätigkeit (`seriesRows`); ohne die Bündelung hätte die Crew 113 Zeilen für 28 Dinge.
Im Showablauf ist die Reihenfolge der Zeilen dagegen der **Ablauf selbst** — Einlass,
Band, Umbau, Band —, und den liest man von oben nach unten. Gebündelt entstand daraus
eine Zeile «Changeover» mit sechs Balken, die zwischen den Acts hing.

**Der Verzug in der Live-Kopfzeile zählt nur, was noch aussteht oder läuft.**
`delaysAt` meldet auch längst vergangene, nie abgehakte Punkte; bei Doors (12:00–14:00,
Status «geplant») stand um 15:30 groß und rot «+4 Std» — an einem Abend, der exakt
nach Plan lief. Das ist keine Verspätung, sondern eine fehlende Rückmeldung. Die Regel
«Status wird nie automatisch gesetzt» bleibt unberührt: gefiltert wird die Anzeige,
nicht die Rechnung.

## Der Abschnitt: Setup und Show sind zwei Abläufe DERSELBEN Bühne

Am Showtag laufen zwei Dinge mit ganz verschiedenen Uhrzeiten und verschiedenen
Lesern: Load-in und Setup bis zum Showstart, danach die Running Order. In beides
in eine Achse von 08 bis 23 Uhr zu quetschen, wird keinem gerecht.

Der Abschnitt hängt am **Zeiteintrag** (`abschnitt: 'setup'|'show'`), nicht am
Band. Der erste Versuch (v0.9.1) hängte ihn an die Bühne — das erzwang zwei
Bänder «Hauptbühne Setup» und «Hauptbühne Show», und der Store verbietet doppelte
Bühnennamen, man hätte sie künstlich verschieden benennen müssen. Es gibt aber
EINE Bühne mit zwei Abläufen.

Deshalb filtert `sichtGewerke` **nicht** nach Abschnitt, `imAbschnitt` filtert die
Einträge: die Bühne bleibt in beiden Ansichten stehen, auch wenn sie dort noch
nichts hat — genau da legt man den ersten Setup-Eintrag an. Jede Ansicht rechnet
ihr Zeitfenster selbst (`programmFenster`), Setup zeigt den Morgen, Show den Abend.

**Die Oberfläche kennt drei Ansichten, das Modell zwei Ebenen plus Abschnitt.**
Bauzeitenplan · Setup · Show stehen in EINER Leiste, genau eine ist gedrückt.
Vorher waren es zwei Umschalter im selben Stil nebeneinander, mit je einem
dunklen Knopf — das las sich als eine Leiste mit zwei gleichzeitig angewählten
Knöpfen, und niemand fand, wie man zwischen Setup und Show wechselt. **Zwei gleich
aussehende Segmentgruppen nebeneinander SIND eine Gruppe, egal was der Code
meint.** «Alle» gibt es dafür nicht mehr; der Durchlass lebt in `imAbschnitt`
weiter, eine vierte Stufe wäre ohne Umbau nachrüstbar.

## Ein Soundcheck ist ein Zeiteintrag, kein Feld

Als Feld am Act (`soundcheck`, bis v0.9.3) war er ein Startzeitpunkt ohne Dauer
und ohne Ende. Er tauchte damit in keiner Zeitachse auf — ob sich zwei
Soundchecks überschneiden, sah niemand, und genau das ist die Frage, die man am
Nachmittag beantworten muss.

Jetzt ist er ein normaler Eintrag im Setup-Abschnitt mit `fuer: <taskId>` — Text-id,
nie Relation, wie `parent`. Damit hat er Balken, Dauer, Farbe, Notiz und
Anforderungen geschenkt. Bedient wird er aus dem Panel des Acts; das ist der
bequeme Weg dorthin, kein zweiter Speicherort. `removeTask` kaskadiert über
`fuer`, sonst bliebe eine Waise mit toter Zuordnung zurück.

## Farbe: gewählt AUS der Palette, nie neu definiert

Ein Zeiteintrag darf eine eigene Farbe tragen (`slot` am Vorgang, `null` = erbt
von der Bühne); ein Gewerk nicht. Der Unterschied hat einen Grund: im
Bauzeitenplan stehen 20 Gewerke untereinander, und genau dafür ist die Farbsuche
gemacht. Auf einer Bühne stehen selten mehr als zwei, drei Bänder.

Gewählt wird immer aus der validierten Palette — zehn Töne × Schraffur, weil ein
Farbplatz genau dieses Paar IST (`slotAus`/`hueVon`). Deshalb reichen zehn Punkte
und ein Häkchen für zwanzig Kombinationen.

**Neben jedem Farbton steht seine Schriftfarbe (`--gw-t-*`), und die ist ebenfalls
gerechnet.** Gefüllte Balken tragen ihre Beschriftung auf der Farbe. Weiß erreicht
auf Gelb nur 2,17:1; gewählt ist je Ton die Tinte, die in hell UND dunkel über 3:1
bleibt — dunkel auf sieben Tönen, weiß auf Violett, Grün und Ocker. Eine statische
Prüfung rechnet das bei jedem Testlauf nach.

## Zeitfelder im Showablauf tragen kein Datum

Der Tag steht im Umschalter; zwei Spalten à 205 px für dieselbe Information
drängten die Anforderungen aus dem Bild. Zwei Fallen, die das Datum verdeckt hatte
— beide als reine Funktionen in `conflicts.js`:

- **`mitUhrzeit` behält den Datumsteil.** Ein Eintrag vom Vortag ist über den
  Tagesfilter auch am Folgetag sichtbar; schriebe das Feld den GEZEIGTEN Tag,
  spränge er beim ersten Antippen einen Tag weit.
- **`endeNachStart`: Ende vor Start meint den Folgetag.** «22:00 bis 03:00» ist
  die selbstverständliche Schreibweise. Der Folgetag kommt über den Kalender,
  nicht über +1440 Minuten — der 25.10.2026 hat 25 Stunden.

Im Bauzeitenplan bleiben die Felder datiert: er läuft über vierzehn Tage.

## Der Live-Versatz verschiebt den Ablauf, nicht die Uhr

Der gerechnete Verzug (`delaysAt`) entsteht aus dem Widerspruch zwischen Status und
Uhr — er setzt voraus, dass jemand Häkchen pflegt. Im Showablauf tut das niemand:
dort steht alles auf «geplant», und die Kopfzeile meldet für den laufenden Act
immer seine bisherige Laufzeit. Gebraucht wurde die direkte menschliche Aussage
daneben: «wir hängen fünf Minuten hinterher.» **Positiv ist Delay** — in der Regie
heißt «plus fünf», dass es später wird.

**Was sich bewegt, war die eigentliche Entscheidung.** Drei Wege standen zur Wahl:

1. **Die Balken wandern**, Achse und Jetzt-Linie bleiben echt. Gewählt.
2. Die Jetzt-Linie wandert um −5, der Plan bleibt stehen.
3. Ein Store-Befehl verschiebt die echten Daten (undo-fähig, im Export).

(2) wäre eine Lupe auf den Plan: man sähe, wo man im Ablauf steht, müsste die
wirkliche Uhrzeit aber im Kopf addieren — und genau die will man am Pult ablesen
(«wann geht SIDO auf die Bühne?»). (3) wirft den ursprünglichen Plan weg; ein
Versatz ist eine Beobachtung über den Abend, keine Umplanung, und morgen früh wäre
die Datei dauerhaft verschoben. Also (1): der **Ablauf** rutscht, die **Uhr** ist
der feste Punkt, gegen den er überhaupt eine Aussage ist.

**Zwei Abbildungen Zeit → Pixel.** `x()` bleibt die echte Zeit (Achse, Ticks,
Bänder, Jetzt-Linie), daneben tritt `xp(min) = x(min + versatz)` für alles, was zum
Ablauf gehört. Genau drei Stellen dürfen `xp()` rufen: `place()`, `updateLabels()`
und `depAnchors()`. Durch `place()` laufen ohnehin **alle** zeitpositionierten
Knoten — Balken, Meilensteine, Sammelbalken, Puffer, Ziehgriffe —, deshalb ist die
Liste kurz und vollständig.

**Kein `transform` auf die Balken-Ebene.** Das wäre die naheliegende Ein-Zeilen-
Lösung gewesen, verschöbe aber auch Zeilenhintergründe und Trennlinien und risse an
den Rändern Lücken auf. Und `updateLabels()` rechnet mit `scrollLeft` gegen die
Balkenposition — die Beschriftungen lägen um den Versatz daneben, im Stundenzoom
des Showablaufs deutlich sichtbar.

**Die Logik bekommt die zurückgedrehte Uhr, nicht den Versatz.** «Was läuft im um
`v` verschobenen Plan?» ist dieselbe Frage wie «was lief im Originalplan vor `v`
Minuten?». Also `nowPlan() = NOW − versatz` an `runningAt`/`delaysAt`/`nextUp` —
**`live.js` kennt den Versatz gar nicht.** Damit rechnet der Verzug von selbst
gegen den verschobenen Plan, und relative Angaben («in 12 Min») stimmen ohne
Zutun, weil beide Seiten gleich weit verschoben sind. Nur absolute Uhrzeiten
laufen durch `verschoben()`.

**Die Uhr in der Show-Kopfzeile ist die Ausnahme** und zeigt `now`, nicht
`planNow`. Wanderte sie mit, verschöbe sich alles gleichmäßig und der Versatz wäre
unsichtbar.

**Grenze, die eine Prüfung aufgedeckt hat:** «passender Versatz ⇒ im Plan» ist im
Showablauf *unerfüllbar*. Der laufende Act steht auf «geplant», also meldet die
Rechnung immer seine Laufzeit; sinkt sein Verzug unter die 5-Minuten-Schwelle,
übernimmt der vorige Punkt. Was der Versatz leistet, ist relativ — er zieht seinen
Betrag ab, Minute für Minute. `verify-showablauf.mjs` prüft genau das; die
naheliegende, aber falsche Zusicherung wurde ausgebaut statt festgeschrieben.

**Der Versatz gehört dem Abend, nicht dem Plan.** `localStorage` als `{min, tag}`,
nicht im Export, und er gilt nur am Tag seiner Eingabe. Der Live-Knopf überlebt den
Neustart bewusst (Stromausfall am Monitor) — ein Versatz von gestern wäre dagegen
ein Plan, der am nächsten Morgen 45 Minuten neben der Achse liegt, ohne dass jemand
den Grund fände. Geklemmt auf ±180 Minuten: darüber ist es kein Ablaufplan mehr.

## Verknüpfen per Ziehen: ein Griff, nicht zwei

Der Gantt ist die Ansicht für Pfeile, also werden sie dort gezogen. **Ein** Griff je
Balken, am Ende: es entsteht immer FS, und eine FS-Verknüpfung legt man beim
Vorgänger an — ein zweiter Griff wäre ein zweites Ziel ohne zweite Bedeutung. Den
Typ stellt man danach im Panel um, wo die Auswahl ohnehin schon steht.

**Gesperrt wird VOR der Geste, nicht danach.** `wouldCycle` im Store lehnt einen
Ring ohnehin ab — aber eine Bedienung, die erst nach dem Loslassen nein sagt, ist
eine schlechte Bedienung. `reachable(deps, id, 'vor')` liefert die verbotenen Ziele
vorab; sie werden während des Ziehens ausgegraut. Dieselbe Funktion räumt auch im
Suchfeld auf: `candidateGroups` bot vorher Kandidaten an, die der Store gleich
darauf zurückwies — Suchfeld und Ziehen geben jetzt dieselbe Antwort.

**Der Griff hängt in einer eigenen Ebene über den Pfeilen.** `.bz-rows` bildet mit
`z-index: 1` einen eigenen Stapelkontext; ein Griff darin käme nie über `.bz-deps`
(z-index 2), und dessen 12 px breite Trefferfläche beginnt genau dort, wo der Griff
sitzt — das Ziehen ließ sich gar nicht erst starten.

**Pfeile brauchen einen dicken Zwilling.** Ein 1,5 px breiter Pfad ist mit der Maus
kaum und mit dem Finger gar nicht zu treffen. Darunter liegt derselbe Verlauf,
unsichtbar und 12 px stark; nur er nimmt Zeigerereignisse an. Die Ebene bleibt
sonst `pointer-events: none`, sonst fingen die Pfeile Klicks auf die Balken darunter
ab.

## Die Tabelle wartet mit dem Neuaufbau, solange getippt wird

`render()` baut mit `replaceChildren` neu auf. Wer dabei in einem Feld steht,
verliert den Fokus — sein Knoten existiert nicht mehr. Bei Textfeldern fällt das
nicht auf, weil ihr `change` erst beim Verlassen kommt. Bei `<input type="time">`
schon: es feuert, sobald ein **vollständiger** Wert dasteht, und das Feld ist beim
neuen Eintrag mit 08:00 vorbelegt — also bereits nach der getippten Stunde. Aus
«0930» wurde **08:09**.

Drei Wege wurden probiert, zwei funktionieren nicht:

1. **Fokus nach dem Neuaufbau wiederherstellen.** Scheitert an `type="time"`: für
   das aktive Segment gibt es keine API (`selectionStart` greift dort nicht). Der
   Fokus käme zurück, der Cursor stünde wieder auf der Stunde, und die Minuten
   landeten erneut dort.
2. **Auf `blur` statt `change` umstellen.** Kleiner, behebt aber nur die
   Zeitfelder und läuft der Regel gegen Handler an abgehängten Knoten entgegen.
3. **Den Neuaufbau aufschieben.** Gewählt.

Aufgeschoben wird **nur, was das fokussierte Feld selbst ausgelöst hat**. Ohne
diese Einschränkung verschluckte die Tabelle auch ein ⌘Z oder eine Änderung aus
dem Panel, während der Cursor zufällig irgendwo steht — sie zeigte dann stumm
Veraltetes. Nachgeholt wird beim `focusout`; wandert der Fokus in ein anderes Feld
derselben Tabelle, zieht er mit (sonst stünde dort eine veraltete Dauer).

**Eine Falle beim Absichern:** Für den Fall «`change` feuert, aber der Fokus ist
schon weiter» (Verlassen per Tab) braucht es ein sofortiges Nachziehen — sonst
käme kein `focusout` mehr. Diese Absicherung darf `document.activeElement` aber
**nicht sofort** prüfen: Firefox meldet während des `change` eines `type="time"`
kurzzeitig `body`, obwohl der Cursor im Feld bleibt. Sofort geprüft hielt sie
jedes Tippen für ein Verlassen und baute doch neu auf — sie hat den Fehler, den
sie absichern sollte, selbst wieder eingeführt. Die Prüfung steht deshalb einen
Tick später.

In Kauf genommen: Dauer und Ende aktualisieren sich erst beim Verlassen des
Feldes. Beim Tippen ist das ohnehin das erwartete Verhalten.

## Verwalten: löschen nur, was niemand benutzt

Umbenennen, Sortieren und Löschen kamen nach, als die beiden Listen im Gebrauch
waren. Drei Entscheidungen, die nicht auf der Hand lagen:

**Umbenennen ändert nur das Label.** Die id bleibt — sie ist die Zuordnung. Ein
«sprechender» Neuaufbau der id wäre bequem zu lesen und ein stiller Datenverlust:
`punktLabel` reicht einen unbekannten Wert einfach durch, im Bild stünde plötzlich
die Kennung statt des Namens.

**Löschen nur bei Nichtgebrauch.** Die Alternative wäre, die betroffenen Einträge
auf den Standard zurückzusetzen. Das ändert aber fünf Zeilen auf einmal hinter dem
Rücken — und ⌘Z holt zwar alles zurück, nur merkt man es womöglich erst später.
Jetzt nennt der Store die Zahl, und der Knopf im Kasten ist schon vorher gesperrt:
lieber vorher sagen als hinterher melden.

**Handsortierung schlägt die Automatik.** Die Abschnitte ordnen sich sonst nach
ihrem frühesten Eintrag. Sobald jemand sortiert, gilt seine Reihenfolge — eine
Automatik, die den Betrachter überstimmt, wäre keine Hilfe. `reorderAuswahl`
verlangt deshalb ALLE ids: halbes `sort` ergäbe eine Reihenfolge, die niemand
gewählt hat.

**Zwei Fehler kamen erst im Code-Review heraus**, nachdem alle Prüfläufe grün
waren. Beide hatten dieselbe Wurzel: Kopien.

Die Sortierlogik stand dreimal (Arten, Abschnitte, Verwaltungsliste). Sie las
`(x.sort ?? 0)` — ein neu angelegter Wert ohne `sort` sprang damit vor alles
Sortierte, bei Gleichstand entschied die Array-Position. Wer einmal sortiert
hatte, bekam jede weitere Art an unvorhersehbarer Stelle. `nachSort()` in
ebene.js ist jetzt die eine Stelle, und der Store vergibt beim Anlegen das
nächste `sort`.

Die Zuordnung «welches Feld am Vorgang zeigt auf welche Liste» stand zweimal —
im Store und in der Verwaltung. Wären sie auseinandergelaufen, hätte der
Löschknopf «0 Einträge» versprochen und offen gestanden, während der Store gleich
darauf ablehnt. `benutztVon()` im Store ist jetzt die Quelle.

Die Lehre ist die des Projekts, nur eine Stufe weiter: doppelt geführt ist
erlaubt, **wenn ein Test es zusammenhält** (so wie bei den eingebauten Listen).
Ohne diesen Test ist eine Kopie nur ein Fehler, der noch nicht passiert ist.

**Und ein Fehler, den nur das Bild gezeigt hat:** Der Verwaltungskasten sprang
nach jedem Klick in die linke obere Ecke. Nach einem Befehl baut die Tabelle neu
auf, das Auswahlfeld ist abgehängt, und `getBoundingClientRect()` liefert dann
Nullen — die Neupositionierung rechnete gegen ein Rechteck aus lauter Nullen. Alle
Zusicherungen waren grün, die Reihenfolge stimmte ja. `platziere()` nimmt seither
ein Rechteck, das beim Öffnen einmal gemerkt wird, und eine Prüfung hält fest,
dass der Kasten nicht in der Ecke landet.

## Eigene Abschnitte sind Etiketten, keine neuen Ansichten

Nach den Eintragsarten kam derselbe Wunsch für die Spalte **Abschnitt**: nicht
nur Setup und Show. Der Mechanismus ist identisch (`project.abschnitte`,
`abschnitte(state)`, Anlegen im Auswahlfeld), die Wirkung aber bewusst nicht.

**Der Umschalter oben bleibt unverändert.** Ein eigener Abschnitt filtert die
Ansicht NICHT; über `abschnittOf` zählt er zur Show. Der Alternativentwurf — je
Abschnitt ein Knopf in der Werkzeugzeile — wurde verworfen: die Leiste bricht
schon heute um, und bei fünf Abschnitten schöbe sie Zoom und Live-Knöpfe eine
Zeile tiefer. Der Durchlass für eine spätere dynamische Leiste liegt in
`imAbschnitt` weiterhin bereit.

**Daraus folgt eine Falle, und die wird angesagt.** Wer im Setup steht und einen
Eintrag auf «Load-in» stellt, verliert die Zeile im selben Moment aus dem Bild —
sie zählt jetzt zur Show. Genau diese Fehlerart steht in diesem Projekt schon
einmal («ein im Setup angelegter Eintrag landete in der Show und war im gezeigten
Abschnitt sofort unsichtbar»); der Knopf tut etwas, nur unsichtbar, und das fühlt
sich an wie «geht nicht». `waehleAbschnitt` in table.js meldet es deshalb über
`onHinweis` als Toast.

**Sortiert wird nach der Uhrzeit, nicht von Hand.** Die eigenen Abschnitte ordnen
sich nach ihrem frühesten Eintrag: ein Load-in um 07:00 steht vor einer Aftershow
um 23:30, ohne Sortierdialog. Noch leere hängen hinten an — sie haben keine Zeit,
an der man sie einordnen könnte.

**Eine Migrationszeile hätte das Feature still zerstört.** In `persistence.js`
stand `if (t.abschnitt !== 'setup') t.abschnitt = 'show'` — eine Normalisierung,
die vor eigenen Abschnitten richtig war und danach jeden «Load-in» beim nächsten
Laden gelöscht hätte, ohne Meldung und ohne Rückweg. Jetzt wird nur
plattgemacht, was der Plan nicht kennt; `setTaskField` und `addTask` lehnen
unbekannte Abschnitte ab, damit gar keine Waise entsteht. Gefunden hat das ein
Export-Import-Test, nicht das Auge.

## Eigene Eintragsarten stehen im PLAN, nicht im Browser

Die vier eingebauten Arten reichten nicht. Beim Speicherort standen zwei
Möglichkeiten gegeneinander: browserweit für alle Projekte (bequem, wenn man
immer dieselben nutzt) oder am Projekt. Entschieden wurde **am Projekt**
(`project.punktTypen`), und der Grund ist der Export: ein Eintrag trägt nur
`punktTyp: "linecheck"`. Ohne die Namensliste in derselben Datei sähe der
Empfänger genau diese Kennung statt «Line-Check» — die JSON wäre nicht mehr aus
sich heraus lesbar. `project` wird in `deserialize` als Ganzes durchgereicht,
deshalb kostet das keinen zusätzlichen Zweig im Import.

**Angelegt wird im Auswahlfeld, nicht an einem zweiten Ort.** «+ Neue Art…» steht
unten im Dropdown; das braucht man mitten im Tippen, und ein Verwaltungsdialog
wäre zwei Klicks weiter weg. Preis dafür: Umbenennen, Sortieren und Löschen gibt
es (noch) nicht — eine versehentlich angelegte Art bleibt stehen.

**`kompakt` gehört der Art, nicht dem Code.** Dass ein Changeover auf dem A3-Blatt
eine niedrigere Zeile bekommt, entschied vorher ein fest verdrahteter Vergleich in
print.js. Jetzt trägt jede Art die Eigenschaft selbst — sonst nähme eine selbst
angelegte «Umbaupause» genauso viel Platz weg wie ein Act.

**store.js führt die eingebauten Arten doppelt.** Ein Import aus ebene.js liefe
verkehrt herum (Kern → Ansichtsschicht), dieselbe Begründung wie bei `clone` und
`artVon`. Gebraucht werden sie nur, damit `addPunktTyp` keine Dopplung zu einer
vorhandenen Art anlegt. Damit die Kopie nicht auseinanderläuft, vergleicht ein
Test sie gegen `PUNKT_TYPEN` — doppelt geführt ist erlaubt, ungeprüft doppelt
nicht. Dasselbe Muster wie bei den Versionsstellen.

## PocketBase liegt auf Eis

Eine fertige Login- und Rollenschicht lag von v0.3.0 bis v0.7.1 **bewusst uncommittet**
im Arbeitsbaum. Sie griff nur mit `?backend=pb` und tat auf der veröffentlichten Seite
nichts — lud ihre Module aber bei jedem Aufruf mit und machte jeden Feature-Commit zu
einer Isolationsprozedur (sichern, auf HEAD zurücksetzen, Feature neu auftragen,
zurückkopieren).

In v0.8.0 wurde sie aus `main` entfernt. Die Seite ist eine reine
GitHub-Pages-Auslieferung ohne Nutzerverwaltung; ein Backend, das niemand benutzt,
ist kein Vorsprung, sondern Ballast. Der vollständige Stand — `pb.js`, `auth.js`,
`session.js`, `roles.js`, `persistence-pb.js`, `login.html`, `admin.html`, das
PocketBase-Schema samt Hooks und `setup.mjs`, die zugehörigen Tests und die
Integrationspunkte — liegt im Branch **`pocketbase-vorbereitung`**. Er wird nicht
deployt und nicht gemergt. Wer Online + Rollen wieder aufnimmt, macht dort weiter;
die Crewplaner-Lehren weiter oben in dieser Datei gelten dann wieder.

## Vorschläge aus Reviews, die geprüft und abgelehnt wurden

Damit derselbe Vorschlag nicht beim nächsten Review erneut Arbeit macht — hier
steht, warum er nicht umgesetzt wurde. Aus dem Review zu v0.9.5:

**«Drag & Drop der Gewerke verrechnet sich bei ausgeblendeten Bändern.»** Kein
Fehler. `dropBeforeAt` (`table.js`) liefert die id eines **sichtbaren**
Gruppenkopfes, und `moveGewerk` (`store.js`) fügt in der Gesamtliste unmittelbar
vor genau dieser id ein. Ein ausgeblendetes Band dazwischen ändert daran nichts:
die sichtbare Reihenfolge stimmt in jedem durchgespielten Fall. Den einen echten
Grenzfall — Ziel «ans Ende» (`before = null`), während versteckte Bänder hinten
stehen — fängt der `curBefore`-Vergleich ab, der aus derselben gefilterten Liste
kommt; es geht dann gar kein Befehl raus.

**«`clone` in eine Util-Datei ziehen.»** Nein, und zwar aus einem Grund, der
schwerer wiegt als die eine doppelte Zeile: der Store dürfte für einen gemeinsamen
Helfer auf `persistence.js` zeigen — Kern → äußere Schicht, der falsche Pfeil. Ein
eigenes Util-Modul nur für einen Einzeiler wäre die dritte Datei für eine Zeile
Code. Es sind ohnehin **zwei** Stellen (`store.js`, `persistence.js`), nicht drei.

**«Row-Diffing in `table.js` statt `replaceChildren`.»** Verschoben, nicht
verworfen — aber nicht ohne Messung. Der Klassentreffen-Plan mit 353 Vorgängen ist
der Ernstfall; solange nicht gemessen ist, wie lange ein Neuaufbau dort wirklich
dauert, wäre der Umbau ein Tausch von belegter Einfachheit gegen vermutete
Geschwindigkeit. `computeSchedule` ist denselben Weg gegangen: erst messen (3,4 ms
bei 500 Vorgängen), dann die Zahl der Aufrufe senken statt einen Cache einzuziehen.

## Personal & Maschinen: Anzahlen statt Namen, Bereitstellung als Vorgang

Drei Entscheidungen, die nicht auf der Hand lagen.

**Anzahlen, keine Einzelpersonen.** Bei zehn austauschbaren Stagehands hilft
ein Name nicht — «Max K.» und «Tom B.» sind für die Disposition dieselbe
Einheit. Eine Namensebene wäre reiner Pflegeaufwand ohne Gegenwert, solange
niemand Dienstpläne pro Person braucht. Das Modell hält die Tür trotzdem offen:
eine Zuweisung ist ein Objekt (`{rid, n, von, bis}`), kein Skalar — eine
spätere `namen: []` daran wäre eine Erweiterung, kein Umbau.

**Die Bereitstellung ist ein Vorgang, kein zweites Konzept.** Die Alternative
— eine separate „Verfügbarkeitsliste" mit Zeitfenster und Menge, getrennt vom
Ablauf gepflegt — wäre ein zweiter Ort für dieselbe Art von Information
(Bezeichnung, Menge, Zeitfenster) und unsichtbar im Gantt: eine frisch
gebuchte Zusatzcrew stünde nirgends im Bild, bis jemand in ein separates Menü
wechselt. Als Vorgang mit `bereitstellung: true` bekommt sie Balken,
Verschieben, Undo, Export und Tagesfilter GESCHENKT — es ist dieselbe Maschine,
die schon jeden anderen Vorgang trägt. Der Preis: zwei Ausnahmen im Store
(keine Verknüpfung, kein Konfliktbeitrag), beide dort begründet, wo sie
greifen (`addDep`, `findConflicts`).

**Die Deckungslücke ist kein Konflikt.** Ein Konflikt in diesem Plan bedeutet
immer: eine Abhängigkeit ist verletzt, eine Zusage widerspricht sich selbst.
Zwei Stunden ohne zugewiesenes Personal am Ende eines Bühnenbaus ist keine
Widersprüchlichkeit — oft ist es Absicht (die Bühne trocknet, wartet auf
Abnahme). Sie in die Prüf-Liste zu heben hieße, sie wie einen Fehler zu
behandeln, den man beheben oder wegdrücken muss. Stattdessen steht sie da, wo
man ohnehin hinschaut, wenn man Personal plant: am Balken und im Panel des
betroffenen Vorgangs — ohne Alarmfarbe, denn eine Lücke ist eine Information,
kein Fehler.

## Ansicht und Einrichten: zwei Bereiche, kein zweiter Zustand

> **Stand v0.12.0 überholt.** `setReiter()` und die Reiterleiste gibt es nicht
> mehr — «Einrichten» ist ein Fenster, das über die Schiene links geöffnet wird
> (siehe weiter unten). Der Abschnitt bleibt stehen, weil der Breite-0-Fehler
> darin bis heute im Code abgesichert ist (`projektEinpassenAusstehend`) und
> seine Lehre für jeden versteckten Container gilt.

Die administrativen Knöpfe (Projekt, Gewerke, Ressourcen, Arten, Abschnitte,
Darstellung) standen zwischen Zoomleiste und Live-Anzeige — sieben Knöpfe, die
niemand während der eigentlichen Arbeit braucht, aber jederzeit im Bild
mitliefen. Eine eigene Seite `#einrichten` löst sie heraus, ohne sie ein
zweites Mal zu verdrahten: dieselben ids, dieselben Handler aus `mount()`,
nur woanders im Markup. `setReiter()` ist der einzige Schreiber, wie
`setAnsicht()` für die Ebene — dasselbe Muster, ein neuer Anwendungsfall.

**Der Fehler, den nur ein Playwright-Lauf gefunden hat.** Ein Projektwechsel
über «Einrichten → Projekte → auswählen» ließ den Gantt bei nur 1 von 36
Balken im Bild stehen, statt bei der Aufbauphase des neuen Projekts. Ursache:
`refresh()` in gantt.js passt beim Projektwechsel sofort ein (`goToInitial()`)
— aber während «Einrichten» offen ist, hat der Gantt-Container die Breite 0,
und jede Rechnung, die auf der Breite beruht (`fitDay`, `centerDayIso`), ist
dann für immer falsch: der `ResizeObserver` holt beim Wiederauftauchen zwar
nach, aber er zentrierte bisher nur den ohnehin schon falschen „aktuellen Tag"
nach, statt die Aufbauphase des NEUEN Projekts zu suchen. Die Lösung ist ein
eigenes Merkzeichen (`projektEinpassenAusstehend`): fand der Projektwechsel
bei Breite 0 statt, holt der ResizeObserver `goToInitial()` selbst nach, nicht
den generischen „Tag zentrieren"-Pfad. Wer künftig etwas hinter einem Reiter
versteckt, das beim Sichtbarwerden auf eine gemessene Breite angewiesen ist,
stößt auf dieselbe Falle.

**Warum Personal und Maschinen keine zwei getrennten Verwalten-Listen
bekommen haben:** `reorderAuswahl` (store.js) verlangt beim Sortieren ALLE
ids der Liste — eine gefilterte Teilansicht („nur Personal") ließe sich also
nicht sortieren, ohne den Store-Befehl selbst aufzubohren. Eine gemischte
Liste mit einem Kürzel je Zeile (👤/⚙) war der günstigere Kompromiss:
Umbenennen und Löschen funktionieren unverändert, nur das Sortieren gilt über
beide Arten hinweg.

**Warum die Schiene links und keine Startseite mit zwei Karten (v0.12.0):**
Nach dem Ressourcen-Ausbau standen in der Werkzeugzeile 22 Bedienelemente
gleichzeitig — drei Ansichten, vier Darstellungen, Bühnen-Häkchen, vier
Zoomstufen, ±, Heute, Datumsfeld, ◀▶, Zuklappen, ↺↻, Prüfen, Live, Versatz.
Die meisten gehören nur zu einer der beiden Welten: «Alle zuklappen» und
«Monate» sagen im Showablauf nichts, die Bühnen-Häkchen im Bauzeitenplan nichts.
Vorgeschlagen waren drei Wege — eine Startseite mit zwei Türen, eine Schiene
links, oder zwei Zeilen plus ein «⋯»-Menü. Gewählt ist die Schiene, weil sie
zwei Dinge auf einmal löst: sie zeigt PERMANENT, in welcher Welt man steht (die
Startseite zeigt es nur beim Betreten), und sie hat Platz für die Zeiteinheiten
des Modus. Die Startseite hätte bei jedem Öffnen einen Klick für eine
Entscheidung gekostet, die meist längst feststeht.

**Warum die Tage wieder aus der Schiene geflogen sind (v0.12.1):** Der erste
Wurf legte unter den aktiven Modus dessen Tage — im Showablauf die Showtage, im
Bauzeitenplan die Bautage. Der Gedanke war, dass die Schiene damit auch die
Zeitnavigation trägt und `◀▶` entfallen können. Für zwei Showtage ging das auf.
Für einen Bauzeitenplan nicht: der Klassentreffen-Plan läuft vierzehn Tage, das
Prüfprojekt achtundfünfzig, und beide ergaben eine Datumsliste, die die
108 px schmale Spalte füllte und «Showablauf» und «Einrichten» unter den
Fensterrand schob. Ich habe das mit einem Scroll-Container in der Liste
repariert — und damit den eigentlichen Fehler nur unsichtbar gemacht. Marcos
Befund war deutlicher als meine Reparatur: *«das mit den Tagen an der Seite is
doch Quatsch.»*

Die Lehre steht jetzt als Regel in CLAUDE.md: **eine Liste, deren Länge von der
Plangröße abhängt, gehört nicht in eine feste schmale Spalte.** Die Schiene hat
drei Einträge und wird nie mehr haben.

**Der Kalender-Knopf bietet nur Tage an, die es im Plan gibt** (`planTage` in
app.js). Vorher stand in der Leiste ein `<input type="date">` mit
`min`/`max` = Projektzeitraum. Das erlaubte den Sprung auf den 14.08., an dem
kein einziger Vorgang liegt — man landete vor einem leeren Blatt und hatte
keinen Anhaltspunkt, ob der Plan leer ist oder man falsch geklickt hat. Die
Liste kommt aus `programmTage()`, derselben Funktion, die schon die Showtage
zählt; über Mitternacht laufende Vorgänge stehen auf beiden Tagen.

Gewählt wird über `openMenu` aus [menu.js](js/menu.js) statt über einen neuen
schwebenden Kasten — Ankern, Umklappen am Bildrand, Klick daneben, Escape und
Fokus kann das Kontextmenü seit v0.7 schon. Dafür brauchte `.mn` einen
Höhendeckel mit Scroll: achtundfünfzig Einträge ragten unten aus dem Bild, und
der Playwright-Klick auf den letzten lief in einen Timeout. Ein Fehler, der
ohne die neue Verwendung nie aufgefallen wäre — das Kontextmenü der Gewerke hat
sieben Einträge.

**Warum «Einrichten» ein Fenster wurde**Warum «Einrichten» ein Fenster wurde und keine Seite blieb:** Als eigene
Seite ersetzte es den Arbeitsbereich, und jeder Blick in die Verwaltung kostete
den Ausschnitt, auf den man gerade schaute. Genau daraus entstand in v0.11.0 der
Breite-0-Fehler beim Projektwechsel (siehe oben). Als `.dlg` über dem Plan
bleibt der Gantt stehen, `setView()` muss beim Schließen nichts
wiederherstellen, und die Breite ist nie 0. Die Knöpfe sind DIESELBEN Elemente
mit denselben ids — ihre Handler in `app.js` haben den Umzug nicht bemerkt.

**Warum die Tabelle EIN Modul geblieben ist**, obwohl Bauzeitenplan und
Showablauf sonst überall getrennt wurden: `table.js` hält Tippsperre,
`commitOn`, `defaultStart` und die drei schwebenden Kästen (neue Art, neuer
Abschnitt, Ressourcen) an einer Stelle. Zwei Module wären zwei Orte für dieselben
Regeln — die Doppelung, die dieses Projekt bei den Versionsstempeln, bei
`nachSort` und bei `#ins.hidden` schon dreimal teuer bezahlt hat. Getrennt sind
die SPALTENSÄTZE (`SPALTEN.bau`/`SPALTEN.show`), und sichtbar getrennt ist die
Tabelle durch ihre Kopfzeile und die Schiene daneben. Eine zusätzliche
Überschrift «Zeiteinträge · Show · Sa 05.09.» war geplant und wurde beim Blick
auf den Screenshot gestrichen: sie wiederholt, was die Schiene und der
Spaltenkopf schon sagen — und mehr Chrome war genau das Gegenteil des Auftrags.

## Bekannte Grenze: Zeitzone des Betrachters

`toMin()` rechnet in der Zone des Browsers, nicht in der des Projekts. Folge:
die Dauer einer Nacht über den Zeitwechsel (25 Stunden am 25.10.2026) weicht
zwischen zwei Betrachtern in verschiedenen Zonen um eine Stunde ab. Die
Projekt-Zone wird nur für die Jetzt-Linie benutzt (`nowInZone`).

Beheben hieße, ALLE Zeitrechnung auf die Projekt-Zone umzustellen — jede Stelle,
die `toMin()` oder `Date` anfasst. Der Nutzen zeigt sich nur bei Betrachtern in
verschiedenen Zonen auf demselben Projekt, die Fläche ist groß. **Bewusst
zurückgestellt (2026-11-18).**

Folge für die Tests: `tests/run.mjs` startet jede Testdatei mit
`TZ=Europe/Berlin`, weil die Testdaten auf dem deutschen Zeitwechsel liegen.
Ohne feste Zone wäre derselbe Test auf einem Rechner in einer anderen Zone rot.

## Was bewusst noch fehlt

Das Ziehen der **Balken und Dauern** im Gantt sowie Ansichten & Export
(öffentlicher Link, PDF/ICS). Verknüpfungen lassen sich seit v0.9.7 ziehen — Griff,
Gummiband und Zielprüfung stehen dort als Muster für den Rest.

Darstellung, Bearbeiten, Live-Modus mit Versatz, Untervorgänge, Prüf-Liste,
Verknüpfungs-Suche, Tagesblätter und der Showablauf mit Setup, Farben,
Soundchecks und eigenen Eintragsarten stehen (Stand v0.9.8). Startdaten kommen aus den
Vorlagen (`js/templates.js`) bzw. importierten JSON-Plänen — einen
`js/data.js`-Demo-Datensatz gibt es nicht mehr.

## Begründungen zu den Regeln in CLAUDE.md

Zu jeder Regel in `CLAUDE.md` steht hier die ausführliche Fassung mit Begründung und Vorgeschichte, im alten Wortlaut. Die Überschrift ist die fett gesetzte Einleitung der Regel, damit man sie findet. Stand: die CLAUDE.md vor dem Verdichten (v0.16.0). Die Regel gilt in der Fassung von `CLAUDE.md`; hier steht, warum.

### Screenshots ansehen, nicht nur die Häkchen zählen.

 Ein Dutzend echter Fehler
hat in diesem Projekt die automatischen Prüfungen passiert und wurde erst im Bild
sichtbar: Pfeile quer über die Gewerk-Spalte, unsichtbare Phasennamen,
Beschriftungen ohne Balken, eine auf „J" zusammengeschnurrte JETZT-Fahne, zehn
Zeilen ohne Balken im Showablauf, «Changeover: Changeover», ein Platzhaltertext in
siebzehn Tabellenzeilen, der wie eingetragener Inhalt aussah, ein Showtag, der nur
zwei Drittel des Bildes füllte, eine links angeschnittene Datumszeile, ein
«12:00 Uhr», bei dem das «Uhr» in eine zweite Zeile rutschte, ein Zoom-Umschalter
auf «Monate» über einer Stundenachse, ein Soundcheck, den die Vorgabe auf
19:40 setzte — eine Stunde vor den Act statt an den Nachmittag —, vierzehn
Bautage in der Schiene, die «Showablauf» und «Einrichten» unter den Fensterrand
schoben, und ein leerer grauer Kasten rechts neben den Reitern im
Einrichten-Fenster. Für jeden gibt es jetzt eine Prüfung — der nächste Fehler
dieser Art hat aber noch keine.

### Neue Bausteine gehören in die `needed`-Liste in `tests/run.mjs`.

 Sonst kennt
sie nur das Theme, in dem sie entstanden sind, und in den vier anderen fehlen sie
unsichtbar. Genau das ist der Showablauf-Ebene passiert.

Zum Starten: `python3 -m http.server 8080`. Ohne Server blockiert der Browser die
ES-Module per CORS.

### Vor dem Deploy: `node tools/version.mjs <neu>`.

 Das setzt auch alle `?v=`.
Von Hand hochzählen ist nicht mehr nötig und wird vom Testlauf bestraft.
`sw.js` (Cache-Buster) fängt die Untermodule ab, greift aber erst ab dem
zweiten Aufruf — deshalb beides.
Warum er nötig ist: `app.js` importiert `./gantt.js` ohne Version, und Pages sendet
`max-age=600` — ohne ihn kämen Änderungen an Untermodulen zehn Minuten lang nicht an.
Der Worker ist network-first: online immer frisch (`cache:'no-cache'`), der Cache dient
nur bei Netzfehler — so läuft die App nach dem ersten Besuch auch offline, und er kann
keine alte Version einsperren, solange Netz da ist. Der Cache heißt je Version `bzp-<SW_VERSION>`,
`activate` löscht alle anderen; die Dateiliste `HUELLE` in `sw.js` prüft `tests/run.mjs`
in beide Richtungen. Kill-Switch steht in `sw.js`.

`gh` liegt unter `C:\Program Files\GitHub CLI\gh.exe` und ist im PATH der
PowerShell (in Git Bash ggf. mit vollem Pfad).
Angemeldet als **M4dm0nky**. Das Repo liegt bewusst dort und nicht unter `Aniflu`:
Aniflu ist ein fremdes persönliches Konto, dort kann M4dm0nky weder Repos anlegen
noch Pages einschalten (nur `push`, kein `admin`).

### Den aktuellen Stand sagt `node tools/version.mjs`

 (ohne Argument), nicht diese
Datei. Hier stand einmal eine feste Nummer — sie war vier Versionen veraltet, weil
`tools/version.mjs` alle sechs Stempelstellen kennt, aber CLAUDE.md nicht. Eine
Zahl, die kein Werkzeug pflegt, ist eine Zahl, die lügt. `CHANGELOG.md` hält die
Historie.

### Die Version wird NIE von Hand geändert.

 Ein Befehl stempelt sie in alle
sechs Stellen zugleich:

```bash
node tools/version.mjs          # zeigt die aktuelle
node tools/version.mjs 0.2.0    # setzt sie überall + Changelog-Abschnitt
```

Betroffen: `js/version.js` (Quelle) · `package.json` · `index.html` **und
`print.html`** (alle `?v=`) · `sw.js` (`SW_VERSION`) · `CHANGELOG.md`. Kommt eine
weitere HTML-Seite dazu, gehört sie in `tools/version.mjs` UND in die
Versionsprüfung in `tests/run.mjs`. **Die Nummer entscheidet Marco** — und zwar
VOR dem Stempeln gefragt, nicht danach mitgeteilt —, nicht
die Automatik. Rückschritte und Nicht-SemVer lehnt der Befehl ab — eine Version
zurückzudrehen bricht den Cache-Schutz.

Nach dem Push ein **annotierter** Tag (`-a`, nicht leichtgewichtig — ein Tag
ohne Autor und Datum ist ein Zettel ohne Absender):

```bash
git tag -a v0.2.0 -m "…" && git push origin v0.2.0
```

Tags sind schwer zurückzunehmen — **erst nach Rückfrage setzen.**

`node tests/run.mjs` prüft, dass alle Stellen übereinstimmen und dass der
Changelog einen Abschnitt für die aktuelle Version hat. Das ist der Unterschied
zu Crewplaner: dort verlangt CLAUDE.md, in fünf Dateien von Hand hochzuzählen
(drei unabhängige Zähler: `?v=23`, `?v=12`, `?v=38`) — geprüft wird nichts.
Vergisst man eine, sieht der Nutzer alten Code und niemand merkt es.

### Nebenwirkung jedes Versionswechsels:

 `sw.js` ändert sich → der Browser
installiert den neuen Worker → `controllerchange` in `index.html` **lädt offene
Tabs neu**. Daten sind sicher (Auto-Save nach 800 ms), aber der Live-Modus
springt kurz. Beim Aufbau mit dem Plan auf dem Monitor also nicht grundlos
deployen.

### Gewerk-Farben (`styles/base.css`, `--gw-*`) nicht per Hand ändern.

Reihenfolge und Zuordnung sind das Ergebnis eines Suchlaufs über 720 Varianten
(`tools/farbsuche.mjs`), der die CVD-Unterscheidbarkeit benachbarter Zeilen maximiert.
Handanlegen macht die Validierung wertlos. Neu rechnen statt raten.

### Neben jedem Farbton steht seine SCHRIFTFARBE (`--gw-t-*`), und die ist ebenfalls gerechnet.

 Gefüllte Balken tragen ihre Beschriftung auf der Farbe, und die
Beschriftung ist die vorgeschriebene sekundäre Kodierung — sie muss lesbar sein.
Weiß erreicht auf Gelb nur **2,17:1**, dunkle Tinte dagegen 8,23:1; auf Violett,
Grün und Ocker ist es umgekehrt. Gewählt ist je Ton die Tinte, die in **hell UND
dunkel** über 3:1 bleibt — deshalb feste Werte ohne Dunkel-Scope. Wer an `--gw-*`
dreht, muss hier mitrechnen; die statische Prüfung «Schrift auf Gewerkfarbe hält
3:1» in `tests/run.mjs` schlägt sonst an.

### Die Farbe eines PROGRAMMPUNKTS ist wählbar, die eines GEWERKS nicht.

 Im
Showablauf trägt ein Vorgang ein eigenes `slot` (null = erbt die Farbe seiner
Bühne); die Auswahl im Panel bietet zehn Töne und einen Schalter für Schraffur —
ein Farbplatz IST das Paar aus beidem (`slotAus`/`hueVon` in palette.js), deshalb
reichen zehn Punkte für zwanzig Kombinationen. Gewählt wird AUS der Palette, nie
eine freie Farbe. Im Bauzeitenplan bleibt die Zuordnung gerechnet: dort stehen 20
Gewerke untereinander, und genau dafür ist die Farbsuche gemacht.

### Balkenbeschriftung nicht entfernen.

 Rigging, Licht und Ton liegen auf hellem
Grund unter 3:1 Kontrast. Die Beschriftung ist die vorgeschriebene sekundäre
Kodierung — ohne sie hängt Identität an der Farbe allein.

### Was `tabIndex` trägt, muss auf Enter UND Leertaste reagieren.

 Ein Element, das
per Klick auswählbar ist, gehört in die Tab-Reihenfolge — und wer dort ankommt,
muss weiterkommen. Fokussierbar ohne Auslöser ist eine Sackgasse: der Fokusring
verspricht etwas, das keine Taste einlöst. Genau das lag bis v0.9.6 an drei
Stellen: die Balken hatten `tabIndex = 0`, aber nur einen `click`-Handler, und die
Meilenstein-Rauten hatten in BEIDEN Renderpfaden gar keinen `tabIndex` — anklickbar,
aber per Tastatur unerreichbar. Der Handler gehört an die EINE Stelle, durch die
alle Marken laufen (`bindMark` in gantt.js), nicht je Renderzweig. Space braucht
`preventDefault()`, sonst scrollt es die Seite statt auszuwählen. Eine Prüfung in
`verify-edit.mjs` hält beides fest — und sie hat die Rauten gefunden, nicht das Auge.

### Zeiten immer aus echten Zeitstempeln rechnen

 (`toMin()`), nie aus Ziffern auf
Datumsstrings. Sonst ist die Dauer über den Sommerzeit-Sprung falsch — ein Bug, der
genau einmal im Jahr zuschlägt.

### `nowInZone` darf nie stumm zurückfallen

 (`gantt.js`). Sie formatiert «jetzt»
per `Intl` in die Projekt-Zone und liest das Ergebnis wieder ein — beim Formatieren
gehört `hourCycle: 'h23'` hin (nicht `hour12: false`: das wählt in manchen Engines
h24, schreibt Mitternacht als «24:00» und ergibt ein Invalid Date) und beim Einlesen
`replace(/\s+/, 'T')` (Intl liefert je nach Engine ein geschütztes Leerzeichen).
Scheitert es doch, gilt lokale Zeit PLUS eine Warnung: eine falsche Jetzt-Linie ist
schlimmer als keine. Testen lässt sich das nur mit **zwei Betrachtern in
verschiedenen Zonen** auf demselben Projekt (`verify-live.mjs`) — ein Projekt erbt
seine Zone vom Browser, für fast jeden sind beide gleich, und dann trifft auch der
kaputte Rückfall zufällig das Richtige.

### Zoomstufen in sichtbarer Zeitspanne bemessen

, nicht in Pixeln. Eine
„Tages"-Ansicht muss Tage zeigen. Die Tests setzen das durch.

### Themes: Gestaltung gehört in `styles/themes/`, Geometrie in `base.css`.

Kein Theme definiert Gewerk-Farben neu. Jedes Theme braucht beide Dunkel-Scopes
(`@media prefers-color-scheme` **und** `:root[data-theme="dark"]`) — der Umschalter
des Betrachters muss die OS-Wahl in beide Richtungen schlagen. Details: `docs/themes.md`.

### Rechenlogik bleibt DOM-frei.

 `schedule.js`, `timeaxis.js`, `store.js`,
`conflicts.js` und `persistence.js` haben keinen DOM-Bezug und sind damit direkt
testbar. So halten. Neue Logik dort → Test dazu.

### Der Store ist der einzige Weg, den Plan zu ändern.

 Nie direkt an `state`
schreiben. Validierung läuft VOR der Änderung; ein abgelehnter Befehl darf
nichts hinterlassen — kein halber Zustand, kein Undo-Eintrag, keine
Ungesichert-Marke. Rückgängig läuft über Schnappschüsse, nicht über
Gegenbefehle: ein Plan wiegt wenige zehn kB, aber jeder handgeschriebene
Gegenbefehl wäre eine Fehlerquelle, die erst Stunden später beim ⌘Z auffällt.

### Schraffur gehört der Gewerk-Identität

 (Platz 9–16), nicht dem Status. Sie war
früher für `status: geplant` belegt — das ist jetzt ein umrandeter Balken. Nicht
zurückdrehen, sonst bedeutet dasselbe Muster zwei Dinge.

### Ein `render()` der Tabelle wartet, solange in dem Feld getippt wird, das ihn ausgelöst hat.

 `render()` baut mit `replaceChildren` neu auf — wer gerade tippt,
verliert dabei den Fokus, sein Knoten existiert nicht mehr. Bei Textfeldern fällt
das nicht auf (`change` kommt erst beim Verlassen), bei `<input type="time">` im
Showablauf schon: es feuert, sobald ein VOLLSTÄNDIGER Wert dasteht, und das Feld
ist vorbelegt — also bereits nach der getippten Stunde. Aus «0930» wurde «08:09».
Nachgeholt wird beim `focusout`; wandert der Fokus in ein anderes Feld derselben
Tabelle, zieht er mit. **Die Einschränkung auf das AUSLÖSENDE Feld ist
wesentlich** — sonst verschluckte die Tabelle auch ein ⌘Z, während der Cursor
zufällig irgendwo steht, und zeigte stumm Veraltetes. Zwei Umwege, die nicht
funktionieren: den Fokus danach wiederherzustellen greift bei `type="time"` nicht
(für das aktive Segment gibt es keine API), und `document.activeElement` ist
während des `change` in Firefox kurzzeitig `body` — sofort geprüft hält eine
Absicherung jedes Tippen für ein Verlassen.

### In der Tabelle nur an `change` hängen, nie zusätzlich an `blur`.

 Das erste
`change` baut die Tabelle neu, der alte Knoten wird abgehängt und feuert danach
trotzdem sein `blur` — mit dem veralteten Objekt aus der Closure. Jede Änderung
lag dadurch doppelt auf dem Undo-Stapel und ⌘Z wirkte kaputt. Handler lesen den
Stand immer frisch aus dem Store (`cur(id)`), nie aus der Closure.

### Die Jetzt-Linie tickt IMMER

, nicht nur im Live-Modus (`startTicking()` in
gantt.js, alle 15 s). Sie hing früher an `syncState()` und stand nach dem Laden
still — bei einem Plan, der beim Aufbau auf dem Monitor läuft, ist eine falsche
Linie schlimmer als keine. Der Tick ruft bewusst **kein** `layout()`: das baute
jede Minute den DOM neu und risse die Auswahl weg. Nur `paintNow()`/`paintLive()`.

### Status wird nie automatisch gesetzt.

 Der Verzug (`js/live.js`) entsteht genau
daraus, dass die menschliche Aussage «geplant» der Uhr widerspricht. Schaltete
etwas automatisch um, sähe der Plan immer nach Plan aus — und das Signal wäre weg.

### Der Versatz verschiebt den ABLAUF, nie die UHR

 (`versatz` in gantt.js). Die
Ansage vom Pult — «wir hängen fünf Minuten hinterher», positiv = Delay — rutscht
die Balken nach rechts; Achse, Ticks, Bänder und die JETZT-Linie bleiben auf der
echten Zeit stehen. Nur so liest man an der Achse ab, wann SIDO **wirklich** auf
die Bühne geht. Wanderte die Linie mit, wäre es eine Lupe auf den Plan statt
einer Aussage über die Wirklichkeit. Zwei Regeln halten das zusammen:

- **Zwei Abbildungen Zeit → Pixel.** `x()` ist die echte Zeit (Achse, Linie),
  `xp()` die des Ablaufs (Balken, Beschriftungen, Pfeile). Genau DREI Stellen
  dürfen `xp()` rufen: `place()`, `updateLabels()`, `depAnchors()`. Wer eine
  vierte braucht, verschiebt vermutlich gerade etwas, das zur Achse gehört.
- **Die Logik bekommt die zurückgedrehte Uhr, nicht den Versatz.** «Was läuft im
  verschobenen Plan?» ist dieselbe Frage wie «was lief im Original vor fünf
  Minuten?» — deshalb kennt `live.js` den Versatz gar nicht, es bekommt
  `nowPlan() = NOW − versatz`. Der Verzug rechnet damit von selbst gegen den
  verschobenen Plan. **Die Uhr in der Show-Kopfzeile ist die Ausnahme**: sie
  zeigt `now`, nicht `planNow` — sie ist der feste Punkt, gegen den der Versatz
  überhaupt eine Aussage ist.

Angezeigte Zeiten laufen durch `verschoben()` — Seitenspalte, Tooltip,
Kopfzeile. Stünde links «20:00 Uhr» neben einem Balken auf 20:05, widerspräche
sich das Blatt selbst. Relative Angaben («in 12 Min») brauchen **keine**
Korrektur: Plan und Uhr sind gleich weit verschoben.

Der Versatz gehört dem Abend, nicht dem Plan: `localStorage`, **nicht** im
Export, und er gilt nur für den Tag, an dem er gesetzt wurde (`{min, tag}`).
Sonst stünde der Plan am nächsten Morgen 45 Minuten daneben und niemand wüsste,
warum. Beim Projektwechsel fällt er auf 0.

### Im Showablauf wird das Verzugsfeld nie «im Plan» sagen, solange etwas läuft

 —
dort steht alles auf «geplant», weil im Betrieb niemand Häkchen pflegt, und für
den laufenden Punkt meldet die Rechnung deshalb immer seine bisherige Laufzeit.
Das war schon vor dem Versatz so. Was der Versatz leistet, ist relativ: er zieht
seinen Betrag ab, Minute für Minute. Eine Prüfung in `verify-showablauf.mjs`
hält genau das fest — die naheliegende Erwartung «passender Versatz ⇒ im Plan»
ist im Showablauf unerfüllbar und wäre eine falsche Zusicherung.

### `reorderGewerk` darf `slot` nicht anfassen.

 Farbe gehört dem Gewerk, nicht
seiner Position; sonst färbt sich beim Sortieren der halbe Plan um. Ein Test
prüft das.

### Der Autostart lädt die JSON, die JSON ist die Wahrheit.

 `boot()` holt beim
Start `klassentreffen-festival.json` (`BUNDLED`/`START` in app.js). Neuer Planstand
= Datei austauschen und pushen, sonst nichts. Ob nachgeladen wird, entscheidet der
`exported`-Stempel aus `serialize()`, mitgeführt in `project.quelle`: Datei neuer →
Datei gewinnt, gleich → lokale Fassung bleibt (sonst verlöre der Betrachter bei
jedem Laden seine Änderungen), nicht erreichbar → lokal. **`?plan=leer` schaltet
den Autostart ab** — ohne diesen Schalter hätten `verify-browser`, `verify-edit`,
`verify-live` und `verify-amk` keinen Erststart-Dialog mehr, an dem sie alle hängen.
Wer am Autostart dreht, muss die vier Werkzeuge mitdenken.

### Was der erste Start braucht, gehört auf Modulebene — nicht in `mount()`.

`mount()` läuft erst, wenn ein Projekt offen ist. Der Import hing dort und war
beim allerersten Start tot: der Dialog bot ihn an, der Knopf tat nichts, ohne
Fehlermeldung. Wer die App frisch öffnet, konnte nichts importieren.

### Der AMK-Plan ist quellentreu

 (`tools/make-amk.mjs`). Was im PDF steht, steht
dort; was geschätzt ist, trägt `estimated: true` und eine gestrichelte Kante; wo
das Gewerk im Original leer war, sagt es die Notiz. Nur DREI Verknüpfungen —
die eine, die wörtlich im PDF steht («Leitern runter → sobald Backline und Set
weg»), plus die Kopplung der aufgeteilten «Rigging/Set»-Zeile. **Keine
Abhängigkeiten dazuerfinden**: ein erfundenes Netz erzeugt rote Konflikte, die
mit der Wirklichkeit nichts zu tun haben. `tests/amk.test.mjs` hält das fest.

### `js/dom.js` ist der Ort für DOM-Kleinkram

 (`el`, `svgEl`, `$`, `escapeHtml`,
`toInput`, `STATUS`). Lag vorher fünfmal identisch herum. **Nicht** dort hin
gehört `clone` — der Store dürfte dafür nicht auf persistence.js zeigen (Kern →
äußere Schicht wäre der falsche Pfeil), und für eine Zeile ist die Wiederholung
billiger als eine schlechte Abhängigkeit.

### Ein Zustand, ein Besitzer.

 `#ins.hidden` hatte vier Schreiber (zwei in
app.js, zwei in inspector.js) — und inspector.js kannte die Ansicht nicht, also
holte jede Änderung das Panel in der Tabellen-Ansicht zurück. Der Inspector
entscheidet jetzt nur über seinen INHALT, `syncPanel()` in app.js allein über
die Sichtbarkeit.

### Kein Cache in `computeSchedule`.

 Er müsste auf Objekt-Identität schlüsseln,
und wer Vorgänge in dieselbe Array-Instanz schiebt (Tests, `tools/make-amk.mjs`),
bekäme still ein veraltetes Ergebnis. Stattdessen wurde die Zahl der AUFRUFE
gesenkt: `findConflicts(state, vorab)` nimmt eine fertige Rechnung an, `app.js`
holt die Liste über `gantt.conflicts()`. Von 5 Läufen pro Änderung auf 2.
Gemessen: 500 Vorgänge = 3,4 ms pro Lauf.

### Untervorgänge: der Elternvorgang ist die HÜLLE, nicht editierbar.

 Ein
Untervorgang ist ein Vorgang mit `parent` (Text-id, nie Relation) und demselben
Gewerk wie sein Elternvorgang. `reflowParents(state)` läuft nach JEDER Änderung in
`store.apply` und setzt Eltern-`start`/`end` auf frühesten Kindstart … spätestes
Kindende — damit `schedule.js`, `conflicts.js` und `persistence.js` konsistente
Werte sehen. Kein Cache. Eltern-Zeiten von Hand setzen, Sammelvorgänge verschieben
oder zum Meilenstein machen wird abgelehnt (Tabelle sperrt die Felder). **Nur EINE
Ebene** (in `addTask` erzwungen), sonst genügte ein reflow-Durchlauf nicht.
Elternvorgang löschen kaskadiert auf die Kinder; Gewerkwechsel zieht sie mit.
`findConflicts` nimmt Sammelvorgänge AUS — ihre Lage ist abgeleitet, nicht direkt
verschiebbar, und ein Konflikt an ihnen risse den Auflösen-Sammelbefehl.

### Die Tagesblätter sind eine eigene Seite, kein Druckmodus der App.

`print.html` + `js/print.js` + `styles/print.css` rendern ein A3 quer je Tag. Der
Gantt ist EIN Scroll-Container; ihn zu zerschneiden hieße, gantt.js umzubauen.
Reihenfolge der Entscheidungen: **Auswahl → Zeitfenster → Blatt.** Das Wegklicken
von Gewerken steuert auch den MASSSTAB — an einem Aufbautag zwingt allein die
Objektbewachung (00:01–23:59) das Blatt auf 24 h, ohne sie sind es 08:00–18:00.
Das Fenster gilt über alle gewählten Blätter gemeinsam, sonst sind sie nicht
vergleichbar. Der Zuschnitt (`tagesScheiben`) liegt DOM-frei in `schedule.js`;
über Mitternacht laufende Vorgänge stehen auf beiden Blättern, angeschnitten.

### Auf dem Blatt steht kein Text IM Balken.

 Er läge über der Schraffur, stünde
bei dunklen Gewerkfarben schwarz auf dunkel und würde bei schmalen Balken
abgeschnitten — alles drei auf dem ersten Probedruck gesehen. Name, Zeit und
Notiz stehen in der Namensspalte, die auf Papier ohnehin immer daneben liegt.
Schriftgrößen hängen an der Zeilenhöhe (`--pr-titel`/`--pr-notiz`); die Notizzeile
fällt weg, bevor sie unlesbar wird, statt die Zeile darüber anzuschneiden.

### Jede ausgelieferte HTML-Seite gehört in `tools/version.mjs` UND in die Versionsprüfung in `tests/run.mjs`.

 Beide kannten anfangs nur `index.html` —
eine zweite Seite mit eigenen `?v=` wäre still auseinandergelaufen. Genau der
Crewplaner-Fehler, der weiter unten als Gegenbeispiel steht.

### Im BAUZEITENPLAN zeigt der Gantt eine Zeile je VORGANGSNAME, einen Balken je Termin

 (`seriesRows` in schedule.js, DOM-frei und getestet). Ein Bauzeitenplan
wird tageweise gedruckt, deshalb steht dieselbe Tätigkeit mehrfach in der Quelle —
das sind keine verschiedenen Vorgänge. Ohne die Bündelung hatte die Bühne sechs
Zeilen für drei Dinge und die Crew 113 für 28; 353 Vorgänge ergeben **153 Zeilen**.
Überlappen sich zwei Termine einer Serie, bekommen sie **Spuren** (`--lane`,
Zeilenhöhe `rowH × lanes`) — sonst lägen sie übereinander. Marken (Konflikt, KRIT)
gelten für die Zeile als Ganzes, Umbenennen benennt die ganze Serie um. **Die
Tabelle bleibt flach**: sie ist der Editor, dort gehört jeder Termin einzeln
bearbeitbar. Beide Ansichten sortieren weiter über `byStart`.

### Im SHOWABLAUF sind die Balken GEFÜLLT

, im Bauzeitenplan umrandet. Der
Grundzustand `.bz-bar` ist ohnehin gefüllt; nur `bz-st-geplant` macht ihn
transparent, und im Showablauf steht alles auf «geplant», weil dort niemand den
Status pflegt — der ganze Abend sähe leer aus. Was gerade läuft, sagen die
Jetzt-Linie und die Live-Kopfzeile. Umgesetzt über `.bz[data-ebene="show"]` in
den Themes (Füllung ist Gestaltung, gehört nicht in base.css); `gantt.js` setzt
nur `data-ebene` und die beiden Variablen `--gw`/`--gw-t`.

### Im SHOWABLAUF wird NICHT gebündelt

 (`buendeln` in gantt.js). Dort ist die
Reihenfolge der Zeilen der ABLAUF selbst — Einlass, Band, Umbau, Band, Umbau —,
und den liest man von oben nach unten. Gebündelt entstand daraus eine Zeile
«Changeover» mit sechs Balken, die zwischen den Acts hing, und die Zeilenfolge
richtete sich nach dem frühesten Termin jeder Serie statt nach dem Abend. Jeder
Programmpunkt trägt seine eigene Zeile, `lanes` ist immer 1: zwei gleichzeitige
Dinge auf einer Bühne sind zwei Zeilen, keine Spuren. **Uhrzeit und Dauer stehen
links vor dem Namen** (`bz-lab-zeit`/`bz-lab-dauer`, beide mit fester Breite und
`tabular-nums`, damit die Namen auf einer Kante beginnen) — damit ist die
Seitenspalte allein schon der Ablaufplan: `14:00 Uhr (30 min) CREUTZFELD & JAKOB`.

### Die Dauer in MINUTEN

, nicht in «0,5 h»: bei einem Ablauf zählt man Minuten.
Ein Meilenstein bekommt einen Strich, keine Null. Im Bauzeitenplan wäre beides
falsch: dort stünde eine Uhrzeit stellvertretend für mehrere Termine.
`seriesRows` bleibt unangetastet — die Funktion ist richtig, der Showablauf ruft
sie nur nicht auf.

### Die Seitenspalte ist im Showablauf breiter

 (390 px statt 296). Drei Angaben
nebeneinander brauchen Platz, und 17 Zeilen brauchen weniger Zeitstrahl als 153.
Auf Handybreite erzwingt `base.css` 168 px und die Dauer bricht UNTER die Zeile
— beide Textzeilen passen in die vorhandene Zeilenhöhe, die Geometrie ändert
sich nicht. **Deshalb wird die Spaltenbreite am DOM gemessen** (`sideWNow()`),
nicht aus `O.sideW` genommen: sonst rechnet die Tagesansicht auf dem Handy um
über hundert Pixel daneben.

### Die Achse beschriftet im Showablauf JEDE Stunde.

 `ticksFor` kennt `'hour'`
längst; `tickScale` wählt es am Bildschirm nie, weil 24 Stunden im Bauzeitenplan
zu dicht stehen. Über zehn Showstunden ist es genau richtig — ein Ablauf wird
nach Uhrzeiten gelesen, nicht nach «zwischen 12 und 15». Erst ab `px >= 0.5`,
sonst kleben die Zahlen aneinander.

### „Tag 1/2/3" gehört nicht in den Titel.

 Der 24.08. IST Tag 1 — das sagt das
Datum. Im Namen erzwingt es eine Zeile je Tag und macht aus einer Tätigkeit drei.
Die Tagesnummer gehört in die Notiz. Ein Test hält fest, dass kein Titel auf
`Tag N` endet.

### Beschriftung neben einem Balken darf nie über den nächsten laufen.

 Ist ein
Balken zu schmal für seinen Text, steht dieser rechts daneben — in einer Serie
also dort, wo der nächste Balken beginnt. `updateLabels()` blendet ihn dann aus
(`data-next` trägt den Start des nächsten Balkens derselben Spur). Der Name steht
weiterhin links in der Zeile. Eine Prüfung in `verify-klassentreffen.mjs` fängt
Rückfälle — die Zahlenprüfungen sahen diesen Fehler nicht.

### Eine Reihenfolge für beide Ansichten: `byStart` (schedule.js).

 Gantt und
Tabelle sortieren Vorgänge eines Gewerks über DENSELBEN Vergleicher (Start, dann
Ende, dann Titel). Nie eine der beiden Ansichten separat sortieren — sonst sieht
derselbe Plan zweimal anders aus und wirkt „nicht gleich".

### Der Verknüpfungs-Picker sucht, statt zu scrollen

 (`candidateGroups` in
schedule.js, DOM-frei und getestet). Bei 100+ Vorgängen ist der native Dropdown
unbenutzbar. Die reine Funktion gruppiert nach Gewerk, sortiert je Gewerk über
`byStart` und filtert per Query (Titel/Gewerkname); der Inspector rendert nur ihr
Ergebnis. Neue lange Auswahllisten genauso lösen — nie einen 122-Zeilen-`<select>`.

### Die Oberfläche kennt DREI Ansichten, das Datenmodell zwei Ebenen plus Abschnitt.

 In der Werkzeugzeile steht EIN Umschalter — Bauzeitenplan · Setup ·
Show, in der Reihenfolge des Tages —, und genau einer ist gedrückt. `app.js` hält
dafür `ansicht` und leitet `ebene`/`abschnitt` daraus ab (`ebeneVon`,
`abschnittVon`); `setAnsicht()` ist der einzige Schreiber aller drei.

Vorher waren es zwei Umschalter (Ebene und Abschnitt) im selben Stil
nebeneinander, mit je einem dunklen Knopf. Das las sich als EINE Leiste, in der
zwei Dinge gleichzeitig angewählt sind — und niemand fand, wie man zwischen
Setup und Show wechselt. **Zwei gleich aussehende Segmentgruppen nebeneinander
sind eine Gruppe, egal was der Code meint.**

`?ansicht=bau|setup|show` steuert das von außen; die alten `?ebene=`/`?abschnitt=`
werden weiter übersetzt (Lesezeichen, Prüfwerkzeuge, print.html). **«alle» gibt es
in der Oberfläche nicht mehr** — der ganze Showtag in einer Achse ist damit nicht
mehr zu sehen. Der Durchlass lebt in `imAbschnitt` weiter, eine vierte Stufe wäre
also ohne Umbau nachrüstbar.

### Zwei Ebenen, ein Plan — und `js/ebene.js` ist die einzige Stelle, die das weiß.

Der Bauzeitenplan zeigt GEWERKE, der Showablauf BÜHNEN; eine Bühne ist ein Gewerk mit
`art:'buehne'`, ein Programmpunkt ein normaler Vorgang darin. Kein zweiter Store, kein
zweites Undo, keine zweite Persistenz. Gantt, Tabelle und Druckseite FRAGEN
(`sichtGewerke`/`sichtTasks`/`amTag`), sie entscheiden nicht selbst. Altdaten ohne
`art` sind Gewerke — der Bauzeitenplan sieht aus wie immer. **Ein Gewerk wird nie
nachträglich zur Bühne**: alle Vorgänge darin sprängen die Ebene.

### Farbplätze werden JE EBENE vergeben

 (`freeSlot(state, art)` in store.js). Gewerke
und Bühnen sind nie zusammen zu sehen, dürfen also dieselben Farben tragen. Zusammen
gezählt wäre die Palette im Klassentreffen-Plan (20 Gewerke = `MAX_SLOTS`) mit der
ersten Bühne erschöpft. `slotsExhausted` wird entsprechend gegen die Zahl der Bänder
der AKTIVEN Ebene geprüft, nie gegen `gewerke.length`.

### Der ZEITEINTRAG trägt den Abschnitt, nicht die Bühne.

 Es gibt EINE Bühne mit
zwei zeitlichen Abläufen — Load-in und Setup bis zum Showstart, die Running Order
danach —, nicht zwei Bühnen. In v0.9.1 hing das Feld am Band; das erzwang den
Namen zweimal, und der Store verbietet doppelte Bühnennamen. Seit v0.9.2 steht
`abschnitt: 'setup'|'show'` am Vorgang, `imAbschnitt` filtert die Einträge, und

### `sichtGewerke` filtert NICHT

: die Bühne bleibt in beiden Ansichten stehen,
auch wenn sie dort noch nichts hat — genau da legt man den ersten Setup-Eintrag
an. Jede Ansicht rechnet ihr Zeitfenster selbst (`programmFenster`): Setup zeigt
den Morgen, Show den Abend. Fehlt das Feld, gilt `show`.

### Ein Soundcheck ist ein ZEITEINTRAG, kein Feld.

 Als Feld am Act (`soundcheck`,
bis v0.9.3) war er ein Startzeitpunkt ohne Dauer und ohne Ende — er tauchte in
keiner Zeitachse auf, und zwei sich überschneidende Soundchecks sah niemand. Jetzt
ist er ein normaler Eintrag im Setup-Abschnitt mit `fuer: <taskId>` (Text-id, nie
Relation, wie `parent`). Damit hat er Balken, Dauer, Farbe, Notiz und
Anforderungen geschenkt. Bedient wird er aus dem Panel des Acts — das ist der
bequeme Weg, nicht ein zweiter Speicherort.

### `removeTask` kaskadiert auch über `fuer`.

 Wer den Act löscht, löscht seinen
Soundcheck mit; sonst bliebe eine Waise mit toter Zuordnung zurück, die niemand
mehr findet. Dieselbe Begründung wie bei den Untervorgängen, ein ⌘Z holt beides
zusammen zurück.

### Zeitfelder im Showablauf tragen KEIN Datum

 — der Tag steht oben im
Umschalter, und zwei Spalten à 205 px für eine Information, die schon dasteht,
drängten die Anforderungen aus dem Bild. Zwei Fallen, beide in reinen Funktionen
in `conflicts.js` gelöst und getestet:

- **`mitUhrzeit` behält den Datumsteil.** Ein Eintrag vom Vortag ist über den
  Tagesfilter auch am Folgetag sichtbar; schriebe das Feld den GEZEIGTEN Tag,
  spränge er beim ersten Antippen einen Tag weit.
- **`endeNachStart`: Ende vor Start meint den Folgetag.** «22:00 bis 03:00» ist
  die selbstverständliche Schreibweise; ohne die Regel lehnte der Store ab. Der
  Folgetag wird über den KALENDER gesucht, nicht mit +1440 — der 25.10.2026 hat
  25 Stunden.

Im **Bauzeitenplan bleiben die Felder datiert**: der läuft über vierzehn Tage.

### Neue Felder müssen durch `addTask` durch.

 Der Handler baut das Vorgangsobjekt
Feld für Feld auf; was dort fehlt, fällt beim Anlegen still weg. `abschnitt` hat
genau das erlebt: ein im Setup angelegter Eintrag landete in der Show und war im
gezeigten Abschnitt sofort unsichtbar. Wer ein Feld ergänzt, prüft `addTask` mit.

### Die Reihenfolge selbst angelegter Werte steht in `nachSort` (ebene.js) — an EINER Stelle.

 Sie lag dreimal herum (Arten, Abschnitte, Verwaltungsliste), und
ein Fehler darin war entsprechend dreimal zu beheben: `?? 0` setzte einen Wert
ohne `sort` auf Position 0, ein neu angelegter sprang damit vor alles Sortierte.
Richtig ist `?? Infinity` — was keines hat, hängt hinten an —, und der Store
vergibt beim Anlegen das nächste `sort`, sobald überhaupt sortiert wurde.

### Welches Feld am Vorgang auf welche Auswahlliste zeigt, weiß NUR der Store

(`LISTEN`, `benutztVon`). Die Verwaltung fragt danach, statt es selbst zu wissen:
liefen die beiden auseinander, meldete der Löschknopf «0 Einträge» und stünde
offen, während der Store gleich darauf ablehnt.

### Verwaltet werden beide Listen über DIESELBEN drei Befehle

 (`setAuswahlLabel`,
`removeAuswahl`, `reorderAuswahl` mit `liste: 'punktTypen'|'abschnitte'`), nicht
über sechs fast gleiche. Drei Regeln daran:

- **Umbenennen ändert nur das Label, nie die id.** Die id ist die Zuordnung;
  änderte sie sich mit, verlöre jeder Eintrag still seine Art — `punktLabel`
  reicht einen unbekannten Wert einfach durch, im Bild stünde die Kennung.
- **Gelöscht wird nur, was niemand benutzt.** Die Alternative (Einträge auf den
  Standard zurücksetzen) ändert fünf Zeilen hinter dem Rücken. Der Store nennt
  die Zahl, der Knopf ist vorher schon gesperrt und sagt warum.
- **Sortieren setzt `sort` bei ALLEN oder keinem.** Ab dem ersten Mal schlägt die
  Handreihenfolge die Uhrzeit-Automatik der Abschnitte — eine Automatik, die den
  Betrachter überstimmt, wäre keine Hilfe. Halbes `sort` ergäbe eine Reihenfolge,
  die niemand gewählt hat, deshalb lehnt `reorderAuswahl` unvollständige Listen ab.

### Ein Kasten, der über der Tabelle schwebt, merkt sich seine Position BEIM ÖFFNEN.

 Nach jedem Befehl baut die Tabelle neu auf; rechnet der Kasten seine
Lage dann am inzwischen abgehängten Auswahlfeld neu, liefert
`getBoundingClientRect()` lauter Nullen und er springt in die linke obere Ecke.
Genau das war so — im Screenshot gesehen, von keiner Zusicherung bemerkt.
`platziere()` nimmt deshalb ein Rechteck, keinen Knoten.

### Abschnitte gehen denselben Weg wie die Eintragsarten — aber sie FILTERN weiter nur nach Setup und Show.

 Eigene stehen in `project.abschnitte`,
`abschnitte(state)` führt sie mit den eingebauten zusammen, angelegt wird im
Auswahlfeld der Spalte («Neu»). Sortiert werden sie nach ihrem FRÜHESTEN
Eintrag: ein Load-in um 07:00 steht vor einer Aftershow um 23:30, ohne dass
jemand sortiert; noch leere hängen hinten an.

### Der Umschalter oben bleibt unverändert

 — er kennt Bauzeitenplan, Setup und
Show. Ein eigener Abschnitt ist ein Etikett am Eintrag und zählt über
`abschnittOf` zur SHOW-Ansicht. Daraus folgt eine Falle, die schon einmal in
diesem Projekt zugeschlagen hat: wer im Setup steht und «Load-in» wählt, verliert
die Zeile sofort aus dem Bild. Deshalb sagt die Tabelle es (`waehleAbschnitt` →
`onHinweis`), statt es geschehen zu lassen — «der Knopf tut etwas, nur
unsichtbar» ist genau das Gefühl von «geht nicht». Wer den Umschalter dynamisch
machen will, muss hier ansetzen.

### `migrate` darf einen eigenen Abschnitt nicht plattmachen.

 Die Zeile hieß
einmal `if (t.abschnitt !== 'setup') t.abschnitt = 'show'` — mit selbst
angelegten Abschnitten hätte sie jeden «Load-in» beim nächsten Laden gelöscht,
still und ohne Rückweg. Normalisiert wird nur noch, was der Plan NICHT kennt;
`setTaskField` und `addTask` lehnen unbekannte Abschnitte entsprechend ab, damit
gar keine Waise entsteht.

### Eintragsarten stehen an EINER Stelle — und eigene gehören in den PLAN.

Die vier eingebauten (`PUNKT_TYPEN` in ebene.js) tragen jetzt ein drittes Feld
`kompakt`: tritt die Art auf dem A3-Blatt zurück? Selbst angelegte liegen in
`project.punktTypen` und reisen damit im Export mit — ein Eintrag trägt nur
`punktTyp: "linecheck"`, und ohne die Namensliste in derselben Datei sähe der
Empfänger genau das. `punktTypen(state)` führt beide zusammen; Dropdown,
Live-Ansage (`typHinweis`) und Druckblatt fragen dort, nie an PUNKT_TYPEN vorbei.
Angelegt wird im Auswahlfeld der Tabelle («+ Neue Art…»), nicht an einem zweiten
Ort — das braucht man mitten im Tippen.

### `store.js` führt die eingebauten Arten bewusst DOPPELT.

 Ein Import aus
ebene.js liefe verkehrt herum (Kern → Ansichtsschicht), dieselbe Begründung wie
bei `clone` und `artVon`. Damit die Kopie nicht auseinanderläuft, vergleicht ein
Test in `tests/store.test.mjs` sie gegen `PUNKT_TYPEN` — doppelt geführt ist
erlaubt, ungeprüft doppelt nicht. Genau das Muster der Versionsstellen.

### Das Wort ist «Zeiteintrag», nicht «Programmpunkt».

 Im Showablauf heißt jede
Zeile so — Spalte, Knopf, Zähler, Ecke der Seitenspalte, Vorgabename, Kennzahl.
Ein Line-Check ist kein Programmpunkt. Das DATENFELD heißt weiter `punktTyp`
(eine Umbenennung wäre eine Migration ohne Gegenwert), und auf dem A3-Blatt
bleibt «Programmpunkt» stehen: dort ist die Liste dem PDF nachempfunden.

### Ein leeres Band ist nur im Bauzeitenplan unsichtbar.

 Dort stehen 20 Gewerke,
ein leeres wäre Rauschen. Im Showablauf muss es stehen: eine frisch angelegte
Bühne hat noch nichts, und wäre sie unsichtbar, wäre «+ Bühne» ein Klick ins
Nichts. Dasselbe gilt für eine Bühne, die im gewählten Abschnitt leer ist. `Math.min(...[])` ist dabei `Infinity` — die Hülle muss auf `T0` fallen,
sonst zieht sich der Sammelbalken über die ganze Achse.

### Neue Vorgänge landen dort, wo man HINSCHAUT.

 `defaultStart()` in table.js
schließt an den letzten Eintrag DES GEZEIGTEN TAGES UND ABSCHNITTS an, nicht an
den letzten des Plans; `addRow` gibt den aktiven Abschnitt mit. Vorher kam bei zwei Showtagen der letzte Punkt des zweiten heraus: wer am
ersten Tag anlegte, bekam es an den zweiten gehängt, und der Tagesfilter blendete
es sofort aus. Der Knopf tat etwas, nur unsichtbar — und das fühlt sich an wie
«geht nicht». Ist der Tag leer, wird 08:00 dieses Tages genommen.

### Der Gantt meldet, wenn er sich von SELBST einpasst

 (`O.onView`). Das passiert
an zwei Stellen asynchron: beim ersten Programmpunkt eines leeren Showablaufs und
beim Wiederauftauchen aus der Tabelle (ResizeObserver). Wer die Kopfzeile danach
aktualisieren will — Zoomstufe, Mitteldatum —, kann den Zeitpunkt nicht raten;
ein `requestAnimationFrame` lief zu früh und schrieb den 25.10. ins Datumsfeld.
Aus demselben Grund merkt sich der ResizeObserver eine Breite von **0**: sonst
gilt die Rückkehr aus der Tabelle als «keine Änderung», und ein Zoom, der
währenddessen mit Breite 0 gerechnet wurde, bleibt für immer falsch.

### Der Showablauf ist tagesbezogen.

 Ein Umschalter wählt den Showtag; ohne ihn standen
die Acts des zweiten Tages als zehn Zeilen ohne Balken im Bild — genau die Fehlerart,
die hier schon dreimal erst der Screenshot gefunden hat. Gantt und Tabelle bekommen
DENSELBEN Tag gereicht, sonst zeigt derselbe Plan zwei verschiedene Tage.

### Bestand zählt die Sicht, Warnungen zählen den Plan.

 `gantt.stats()` meldet Vorgänge,
Bänder, laufend und Crew aus der sichtbaren Ebene — sonst stünden 353 Vorgänge über
einem Blatt mit 17 Zeilen. Kritisch und Konflikte bleiben planweit: sie sind Aussagen
über den Plan, nicht über den Ausschnitt, und müssen zur Prüf-Liste passen, die über
`conflicts()`/`criticals()` ebenfalls alles zeigt. Zwei Zähler nebeneinander wären
genau der Fehler, den die Eine-Quelle-Regel verbietet.

### Verzug in der Live-Kopfzeile zählt nur, was noch aussteht oder läuft.

 `delaysAt`
meldet auch längst vergangene, nie abgehakte Punkte; bei DOORS (12:00–14:00, Status
«geplant») stand um 15:30 groß und rot «+4 Std» — an einem Abend, der exakt nach Plan
lief. Das ist keine Verspätung, sondern fehlende Rückmeldung, und es überdeckte den
Verzug, auf den es ankommt. Die Regel «Status wird nie automatisch gesetzt» bleibt
unberührt; gefiltert wird die ANZEIGE, nicht die Rechnung.

### Kein Typ steht doppelt

 (`typHinweis` in ebene.js). Ein Programmpunkt «Changeover»
mit `punktTyp:'changeover'` ergab «Changeover: Changeover» in der Kopfzeile und
«Changeover / Changeover» auf dem Blatt. Verglichen wird normalisiert und in beide
Richtungen, damit auch «SHOW END» / «Show-Ende» als dasselbe gilt.

### Achsen-Ticks und Bänder werden auf `T1` geklemmt.

 Sie ragten über das Planende
hinaus und machten den Scroller um 1400 px breiter als seinen Inhalt — im
Bauzeitenplan unsichtbar, im Showablauf rutschte der ganze Tag aus dem Bild. Und die
Tagesansicht passt sich neu ein, wenn der Container die Breite ändert: «ein Kalendertag
füllt die Breite» ist eine Zusage, die bei jeder Breite gilt.

### Keine Platzhaltertexte in Freitextspalten.

 Ein «z. B. 2× Wedge» in siebzehn Zeilen
sieht aus wie siebzehnmal eingetragener Inhalt; SIDOs echtes «1 Riser 2×1 m» war
darin nicht zu finden. Was die Spalte will, sagt ihre Überschrift.

### Das Running-Order-Blatt kennt den Abschnitt.

 Setup und Show sind zwei Abläufe
mit verschiedenen Lesern — wer der Crew den Vormittag in die Hand gibt, will
nicht die Running Order darunter. Die Steuerleiste hat deshalb dieselbe Wahl wie
die App (Setup · Show · beides), der Blattkopf und der Fuß nennen sie, und
`?abschnitt=` steuert sie von außen. Der Bauzeitenplan bleibt davon unberührt:
seine Tagesblätter zeigen Gewerke, nie Bühnen.

### `Element.append()` gibt `undefined` zurück.

 `wrap.append(el(…)).lastChild` warf
deshalb, und statt der Meldung «nichts eingetragen» sah man eine leere Seite. Das
stand zweimal in print.js und fiel jahrelang nicht auf, weil es immer mindestens
ein Blatt gab — erst die Abschnitts-Auswahl konnte eine leere Auswahl erzeugen.
Erst anlegen, füllen, dann anhängen.

### Das Running-Order-Blatt ist eine LISTE, kein Zeitstrahl

 (`roBlatt` in print.js).
So liest man einen Showablauf: von oben nach unten, Uhrzeit voran. Ein Gantt über zehn
Stunden mit siebzehn Zeilen wäre auf Papier ein Streifenmuster, und die Felder zum
Ausfüllen hätten keinen Platz. **Leere Felder drucken als Linie** — ein leerer Kasten
sieht aus wie ein Satzfehler, eine Linie sagt: hier wird geschrieben. Die Zeilenhöhe
wird GEWICHTET gerechnet (Umbauzeilen zählen 0,62), sonst bleibt ein Viertel leer.

### Abhaken ist eine menschliche Aussage über eine gerechnete Warnung — persistiert, signaturgebunden.

 `ackCrit` (bool) nimmt einen kritischen Vorgang aus der
kritisch-Zahl; `ackConflictMin` (Minuten) akzeptiert eine Konfliktgröße. `findConflicts`
überspringt den Konflikt nur, solange `shortBy <= ackConflictMin + EPS` — wird er
GRÖSSER, meldet er sich wieder (kein stilles Wegdrücken). Läuft über `setTaskField`
(Undo, Persistenz). **Eine Quelle:** Zählung, Prüf-Liste und `resolveConflictsCmd`
lesen alle `findConflicts` — nie einen zweiten Zähler danebenstellen. „Kritisch" bleibt
Information (kein automatisches Verschieben), nur die Sichtbarkeit wird abhakbar.

### Personal & Maschinen: eine Zuweisung ist `{Bezeichnung, Anzahl, Zeitfenster}`, keine blanke Zahl.

 `t.res = [{rid, n, von, bis}]` ersetzt das frühere `crew`
(eine Person je Vorgang, ohne Bezeichnung, ohne eigenes Fenster). `von`/`bis`
= `null` heißt „der ganze Vorgang" — der Normalfall, dabei tippt niemand ein
Datum; gesetzt sind es Zeitstempel wie `start`/`end` und MÜSSEN innerhalb der
Vorgangsdauer liegen (`setTaskRes` in store.js) — ein Helfer, der vor dem
Vorgang anfängt, ist ein Tippfehler, kein Fall. Bezeichnungen (Stagehand,
Gabelstapler …) stehen in `project.ressourcen` (`kind: 'personal'|'maschine'`)
und reisen im Export mit, genau wie Eintragsarten und Abschnitte — und gehen
denselben Verwaltungsweg: `addRessource` plus dieselben drei generischen
Befehle `setAuswahlLabel`/`removeAuswahl`/`reorderAuswahl` mit
`liste:'ressourcen'`. **Anders als bei Arten und Abschnitten gibt es keine
eingebauten** — «Stagehand» heißt bei der nächsten Produktion «Helfer», eine
Vorgabe wäre nur eine weitere Löschkandidatin. `res` MUSS durch `addTask` —
was der Handler nicht aufzählt, fällt beim Anlegen still weg, dieselbe Falle
wie bei `abschnitt`.

### Eine Bereitstellung ist ein ganz normaler Vorgang, kein zweites Datenmodell.

`t.bereitstellung: true` macht aus einem Vorgang einen POOL: seine `res` sind
nicht Bedarf, sondern Angebot — «10 Stagehands, 08:00–22:00», gegen das andere
Vorgänge ihre Zuweisung rechnen (`bedarfsRaster` in resources.js). Er hat
Balken, Zeitfenster, Notiz und Undo geschenkt, genau wie jeder Vorgang. Zwei
Ausnahmen: `addDep` lehnt ihn als Quelle UND Ziel ab (ein Pfeil auf einen
Vorrat ergibt keine Aussage), und `findConflicts`/der kritische Pfad nehmen ihn
aus — er ist isoliert (keine Verknüpfungen möglich) und stünde nie im
Konflikt. `setTaskField` verweigert `bereitstellung: true`, solange noch
Verknüpfungen bestehen — erst lösen, dann umschalten.

### Die Deckungslücke wird NUR gemeldet, wenn der Vorgang überhaupt eine Zuweisung dieser Art hat.

 `deckung(t, kind, state)` in resources.js liefert
`null`, solange `t.res` keine Zuweisung von `kind` enthält — ein Vorgang ganz
ohne Personal sagt nichts über Personal aus. Ohne diese Regel wären im
Klassentreffen-Plan alle 353 Vorgänge „ungedeckt" und die Anzeige wertlos.
Gerechnet wird je KIND (Personal ODER Maschine), nicht je Bezeichnung: „2 Std
ohne Personal" ist die Aussage, nicht „2 Std ohne Rigger". Die Lücke ist kein
Konflikt und steht nicht in der Prüf-Liste — unbesetzte Zeit ist oft gewollt
(Trocknungszeit, Wartezeit); sie steht am Balken (`bz-bereit`, Panel) und im
Panel im Klartext, ohne Alarmfarbe.

### `crew` ist keine Ressource — es ist die MIGRIERTE Ressource «Crew».

 Beim
Laden wandelt `persistence.js` jede blanke `crew: N` einmalig in
`res: [{rid:'crew', n:N, von:null, bis:null}]` und legt bei Bedarf die
Bezeichnung «Crew» im Plan an; danach ist `crew` gelöscht. Erzeugend wie die
Soundcheck-Migration (v0.9.3) — sie darf beim zweiten Durchlauf keine zweite
Zuweisung anlegen, geprüft in `tests/persistence.test.mjs`. Die vier Vorlagen
(`js/templates.js`) bauen ihre Pläne direkt und laufen NICHT durch `migrate()`
— `planFromTemplate` übersetzt ihr `crew`-Extra deshalb selbst in `res` und
trägt die Bezeichnung «Crew» ins neue Projekt.

### `bz-bereit` (die Kontur der Bereitstellung) braucht KEINE Theme-Anpassung.

Sie nutzt `outline: dashed currentColor` statt eines Farbtokens — der Balken
trägt keine eigene `color`, die Kontur erbt sie vom Umfeld. Deshalb steht sie
auch nicht in der `needed`-Liste in `tests/run.mjs`: die Prüfung verlangt den
Klassennamen in JEDEM Theme, und keines braucht ihn. Dasselbe Muster wie
`is-estimated` (die gestrichelte Kante bei geschätzter Dauer). Wer einen neuen
Baustein NICHT farbig machen muss, sollte diesen Weg zuerst prüfen, bevor er
fünf Theme-Dateien anfasst.

### Personalbedarf und Maschinenbedarf sind zwei DARSTELLUNGEN, keine zweite Ansicht.

 Sie stehen neben Gantt und Tabelle im selben Umschalter
(`data-view="personal"|"maschine"`) und bekommen dieselbe Ebene, denselben
Bühnen-Filter, denselben Showtag und Abschnitt gereicht wie Gantt und Tabelle
(`bedarf.setEbene(...)` läuft überall dort mit, wo auch `gantt.setEbene`/
`table.setEbene` laufen — sonst zeigt der Reiter einen anderen Ausschnitt als
der Rest der App gerade offen hat). Das Zeitraster ist ebenenabhängig: Tage im
Bauzeitenplan (vierzehn Tage in Stunden wären unlesbar), Stunden im Showablauf
(ein Tag ist dort ohnehin tagesbezogen). `js/bedarf.js` rendert nur — gerechnet
wird ausschließlich in `bedarfsRaster()` (resources.js).

### Die Schiene links trägt den MODUS — und sonst nichts

 (`js/rail.js`).
Drei Einträge: Bauzeitenplan, Showablauf, Einrichten. Genau einer der beiden
Modi ist aktiv.

Sie trug in einem Zwischenstand von v0.12.0 auch die TAGE des aktiven Modus.
Das war ein schlechter Tausch: zwei Showtage passten, aber ein Bauzeitenplan
über zwei Wochen ergab vierzehn Datumszeilen in einer 108 px schmalen Spalte,
und ein Plan über zwei Monate achtundfünfzig — also genau die Überladung,
gegen die der Umbau angetreten war. **Eine Liste, die mit der Plangröße
wächst, gehört nicht in eine feste schmale Spalte.**

Zwei Regeln bleiben:

- **Die Schiene rendert nur.** Sie schreibt nie an `ansicht` oder am Gantt,
  sondern meldet über Rückrufe (`on.modus`/`on.einrichten`) nach app.js —
  `setAnsicht()` bleibt der einzige Schreiber. Dieselbe Arbeitsteilung wie bei
  `js/bedarf.js`.
- **Nichts Wachsendes hinein.** Wer der Schiene einen vierten Eintrag geben
  will, prüft zuerst, ob deren Zahl vom Plan abhängt. Wenn ja: nicht hierhin.

### Der Tag wird über den Kalender-Knopf gewählt, und angeboten wird NUR, was im Plan steht

 (`tagWahl`/`planTage` in app.js). Vorher stand hier ein freies
`<input type="date">` — damit sprang man auf einen Tag, an dem kein einziger
Vorgang liegt, und stand vor einem leeren Blatt ohne zu wissen warum. Die Liste
kommt aus `programmTage(sichtTasks(state, ebene))`: die Kalendertage, die von
einem Vorgang berührt werden, über Mitternacht laufende auf beiden Tagen.

- **EIN Knopf für beide Modi.** «Welcher Tag» ist dieselbe Frage; nur die
  Antwort wirkt verschieden (im Bauzeitenplan springt die Achse, im Showablauf
  wechselt der Showtag). Zwei Bedienelemente für eine Frage wären zwei Orte,
  an denen dieselbe Auswahl auseinanderlaufen kann.
- **Gewählt wird über `openMenu` (js/menu.js)**, nicht über einen neuen
  schwebenden Kasten: Ankern, Umklappen am Rand, Klick daneben, Escape und
  Fokus kann das Kontextmenü längst. Dafür ist `.mn` seit v0.12.1 gedeckelt
  und scrollt (`max-height: 62vh`) — achtundfünfzig Tage ragten sonst unten
  aus dem Bild.
- **`syncTagKnopf()` ist der einzige Schreiber** von Beschriftung UND
  Sichtbarkeit des Knopfs. Er steht im Bauzeitenplan nur in der
  Plan-Darstellung (die Tabelle zeigt dort alle Tage zugleich), im Showablauf
  immer — dort filtert der Tag auch Tabelle und Bedarf.

### Was im aktiven Modus nichts bedeutet, steht nicht da.

 `setAnsicht()` blendet
`#seg-abschnitt` außerhalb des Showablaufs aus und `.hd-zoom` außerhalb von
Bauzeitenplan+Plan-Darstellung; `syncBuehnen()` zeigt die Bühnen-Häkchen nur im
Showablauf. So sind aus 22 gleichzeitig sichtbaren Bedienelementen 12 im
Bauzeitenplan und 10 im Showablauf geworden; mit dem Drucken-Knopf rechts
(`#drucken`, beide Modi, Ziel je Modus in `data-href`) sind es 13 und 11. Die
Zoomstufe ist ein App-Knopf mit `openMenu`, kein `<select>`. **Nachgezählt, nicht geschätzt** —
gezählt werden die sichtbaren `button`, `input` und `select` in `.hd-bar` beim
Klassentreffen-Plan mit einer Bühne, ohne Live und ohne offenen Konflikt. Wer
die Zahl anzweifelt, zählt mit demselben Maß nach.

Wer einen Knopf hinzufügt, sagt zuerst, in welchem Modus er etwas bedeutet —
und blendet ihn im anderen aus.

### Einrichten ist ein FENSTER über dem Plan, keine Seite

 (`#ein-dlg`, vier
Reiter über eine `.seg`). Als Seite ersetzte es den Arbeitsbereich, und der
Gantt-Container hatte dabei die Breite 0 — daraus entstand der
Projektwechsel-Fehler, den `projektEinpassenAusstehend` bis heute abfängt.
`openEinrichten`/`closeEinrichten` stehen auf **Modulebene**, nicht in `mount()`:
Import, Neu und Projekte müssen beim allerersten Start ohne offenes Projekt
funktionieren. Wer einen Knopf ins Fenster legt, legt ihn in EINEN Reiter — und
ein Prüfwerkzeug, das ihn anklickt, muss vorher dessen `[data-ein="…"]` klicken.

### Die Tabelle bleibt EIN Modul

, auch wenn sonst alles getrennt ist. Zwei
Module wären zwei Orte für Tippsperre, `commitOn`, `defaultStart` und die drei
schwebenden Kästen. Getrennt sind die SPALTENSÄTZE (`SPALTEN.bau`/`SPALTEN.show`
in table.js); sichtbar trennt die Schiene daneben. Im Showablauf sind
`c-start`/`c-end` schmaler (112 statt 175 px) — dort steht kein Datum im Feld,
und 175 px ist die Breite eines `datetime-local`.

### Zwei gleich aussehende Segmentgruppen nebeneinander sind EINE Gruppe, egal was der Code meint.

 Das kostete in v0.9.0 die Bedienbarkeit — Ebene und
Abschnitt standen im selben Stil nebeneinander, mit je einem dunklen Knopf, und
niemand fand den Weg von Setup zu Show. Wer eine weitere `.seg` neben eine
bestehende stellt, muss sie sichtbar absetzen oder sie gehört zusammengelegt.
Die Reiter im Einrichten-Fenster (`.ein-reiter`) stehen deshalb allein in ihrer
Zeile, nicht neben der Bedarfs-Unterwahl.

### Die Knöpfe sind dieselben Elemente, nur umgezogen — keine zweite Verdrahtung.

 `#export`, `#import`, `#new-proj`, `#proj-menu`, `#add-gewerk`,
`#theme-toggle` behalten ihre ids und ihre Handler aus `mount()`/Modulebene;
sie stehen seit v0.12.0 im Fenster `#ein-dlg`, je Reiter eine `.ei-sec` mit
`data-ein-tab`. Wer eine dieser ids programmatisch anklickt (Prüfwerkzeuge!),
muss vorher `#rail-ein` klicken UND den Reiter, in dem der Knopf liegt
(`[data-ein="baender"]` für `#add-gewerk`) — sonst ist er unsichtbar und der
Playwright-Klick schlägt fehl. `tools/verify-edit.mjs` macht das vor.

### Verwalten-Kästen lassen sich von außen öffnen.

 `table.openVerwalten(opt,
ankerEl)` und `table.openNeuFragen(opt, ankerEl, fertig)` rufen dieselben
privaten Funktionen wie das Auswahlfeld in der Tabelle — das Einrichten-Fenster
bekommt damit „Arten verwalten…", „Abschnitte verwalten…" und „Personal &
Maschinen verwalten…" GESCHENKT, ohne die Kasten-Logik (rename, sortieren,
löschen, Fokus, Escape, Klick daneben) ein zweites Mal zu schreiben.

### Personal und Maschinen stehen in DERSELBEN Verwalten-Liste, nicht in zwei getrennten.

 `reorderAuswahl` verlangt ALLE ids der Liste, nicht eine
gefilterte Teilmenge — zwei Listen zu trennen hieße, eine gemeinsame
Sortierung über beide Arten zu verlieren oder den Store-Befehl aufzubohren.
Ein Kürzel je Zeile (`tb-verw-kind`, 👤/⚙) sagt wenigstens, was man vor sich
hat. Anlegen geht trotzdem getrennt — zwei Knöpfe „+ Personal"/„+ Maschine"
in Einrichten, weil `addRessource` das `kind` beim Anlegen braucht.

### Niemals `window.prompt`/`confirm`/`alert` — immer die eigenen App-Dialoge.

Native Popups fallen optisch aus dem Rahmen, sind je Browser anders und lassen
sich nicht themen. Für jeden Fall gibt es einen Baustein: eine Bestätigung
läuft über `askDialog({title, message, buttons})` (app.js, liefert den `value`
des gewählten Knopfs, `null` bei Abbruch); eine Namenseingabe mitten im Tippen
läuft über den schwebenden Kasten `tb-neuart` (`neuFragen` in table.js,
exportiert als `table.openNeuFragen(opt, ankerEl, fertig)` für Aufrufer
außerhalb der Tabelle — Panel, Einrichten-Fenster). `neuFragen` akzeptiert neben
`cmd` (Name landet als `label` obenauf) auch `buildCmd(wert, kompakt)`, wenn
der Name woanders im Befehl gehört (`addGewerk` z. B. in `gewerk.name`).
`grep -rn "window\.prompt\|[^.]prompt(\|confirm(\|alert(" js/*.js` muss leer
bleiben (Kommentare ausgenommen).

### Local-first.

 Der Plan lebt weiter in `localStorage`; das private Daten-Repo
`M4dm0nky/Bauzeitenplan-Daten` (`main`, `projekte/<project.id>.json`, Inhalt =
`serialize(plan)`) ist der Abgleich zwischen Geräten, nicht die Wahrheit. **Ohne
eingetragenen Schlüssel verhält sich die App exakt wie vorher** — alle anderen
`verify-*` laufen ohne Schlüssel und dürfen davon nichts merken.

- **Der Schlüssel liegt nur in `localStorage` unter `bzp_sync`** (`{token, repo}`),
  nie im Plan, im Export oder im Repo. `tests/run.mjs` sperrt `bzp_sync` in
  `persistence.js` — die Plan-Schicht kennt ihn nicht.
- **Sync-Metadaten (`remoteSha`, `dirty`) stehen im Projekt-Index**
  (`bzp_projects`), nie im Plan. Sonst änderte jeder Abgleich den Plan, und der
  Plan änderte die sha — ein Kreis.
- **`js/sync.js` ist DOM-frei**, `fetch` wird hereingereicht (`createSync`).
  Die Entscheidung je Projekt trifft die reine Funktion `abgleich()`; die
  Verdrahtung in app.js führt nur aus.
- **Jeder GitHub-Abruf mit `cache:'no-store'`.** GETs sind 60 s cachebar; ohne
  den Schalter meldet die Liste kurz nach dem eigenen Upload die alte sha, und es
  entsteht ein Scheinkonflikt.
- **Base64 über `TextEncoder`**, nie `btoa` auf dem String — «Bühne» und «👤»
  werfen sonst.
- **Ein Konflikt wird nie still aufgelöst**: `askDialog` mit drei Knöpfen
  — einer davon «Beide behalten (Kopie)», die Kopie heißt «… (anderes Gerät)».
  Kommt das offene Projekt neuer von außen und ist lokal nicht `dirty`, wird es
  ersetzt — mit Toast, ohne Dialog. Auf einem Gerät gelöscht, auf dem anderen
  `dirty`: behalten und neu hochladen. Arbeit geht nie verloren.
- **Hochgeladen wird gebündelt**: frühestens 10 s nach dem letzten Speichern,
  sofort bei `visibilitychange → hidden` und beim Projektwechsel. Ein
  übersprungener Durchlauf löst höchstens EINEN sofortigen zweiten aus.
- **Kein Netz oder falscher Schlüssel bricht den Start nie.** Das Statussymbol
  (`#sync-state`) wird gelb bzw. rot, die App läuft mit lokalen Daten weiter.
- **Der Service Worker ist network-first** (siehe Deploy). Was ausgeliefert wird,
  steht in `HUELLE`; `tests/run.mjs` prüft das gegen das Dateisystem in BEIDE
  Richtungen. Wer eine Datei anlegt oder löscht, pflegt `HUELLE` mit.
- **Prüfen:** `tools/verify-sync.mjs` fälscht die GitHub-API per Route.
  `--echt` läuft gegen das echte Repo (`BZP_TOKEN` in der Umgebung, nur
  «Zwei Geräte» + Aufräumen). Der Token ist fine-grained, nur dieses Repo,
  *Contents: Read and write*.
