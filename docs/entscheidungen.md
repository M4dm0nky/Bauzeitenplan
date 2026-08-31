# Entscheidungen

Warum Dinge so sind, wie sie sind. Nur das, was sich aus dem Code nicht ablesen lässt.

## Grundsätzliches

| Frage | Entscheidung | Warum |
|---|---|---|
| Zeitachse | Vier Zoomstufen: Monate / Wochen / Tage / Stunden | Der Zeitraum spannt Monate, der Load-In läuft stundengenau. Ein Raster kann beides nicht. |
| Backend | **Keines.** Reine statische Auslieferung, localStorage + JSON-Export | Eine vorbereitete PocketBase-Schicht wurde in v0.8.0 aus `main` entfernt (siehe unten). Kommt der Bedarf zurück, wird es eine **eigene** Instanz, keine Kopplung an Crewplaner: übernommen werden Muster und Erfahrungen, nicht die Daten. |
| Gantt-Zeilen | Zwei Ebenen: Band (aufklappbar) → Vorgänge | Entspricht dem klassischen Bauzeitenplan. Das Band ist je nach Plan-Ebene ein Gewerk oder eine Bühne. |
| Abhängigkeiten | Von Anfang an, alle vier Typen + kritischer Pfad | — |
| Build-Step | Keiner. Native ES-Module. | Konsistent zu Crewplaner und Personalplan. `tools/build-prototypes.mjs` ist **nur** für die Design-Artifacts (CSP verlangt dort alles inline). |

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

## Was bewusst noch fehlt

Das Ziehen der **Balken und Dauern** im Gantt sowie Ansichten & Export
(öffentlicher Link, PDF/ICS). Verknüpfungen lassen sich seit v0.9.7 ziehen — Griff,
Gummiband und Zielprüfung stehen dort als Muster für den Rest.

Darstellung, Bearbeiten, Live-Modus mit Versatz, Untervorgänge, Prüf-Liste,
Verknüpfungs-Suche, Tagesblätter und der Showablauf mit Setup, Farben,
Soundchecks und eigenen Eintragsarten stehen (Stand v0.9.8). Startdaten kommen aus den
Vorlagen (`js/templates.js`) bzw. importierten JSON-Plänen — einen
`js/data.js`-Demo-Datensatz gibt es nicht mehr.
