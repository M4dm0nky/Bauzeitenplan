# Rückmeldung: Bauzeitenplan online, Phase 2 – Teil A auf TEST

**An:** Marco · **Von:** Server-Admin (Robs) · **Stand:** 2026-11-27
**Bezug:** [`admin-auftrag-online-phase2.md`](https://github.com/M4dm0nky/Bauzeitenplan/blob/online/docs/admin-auftrag-online-phase2.md) (Branch `online`, Stand `22d18d6`)

**TEST läuft.** Migrationen und Hooks sind eingespielt, alle Messungen sind wie erwartet, und es gab
keine Laufzeitfehler. Auf deinen Wunsch ist das **nur TEST**. LIVE, die statische Seite auf
`callboard.nyxlightwork.de` und der Crewplaner sind unverändert (nachgemessen).

## Ergebnis

| | TEST | LIVE |
|---|---|---|
| `sha256sum -c` alle sechs OK | ☑ (nach dem Download **und** direkt vor dem Kopieren noch einmal) | — |
| Backup vor dem Einspielen | ☑ `data.db` + `auxiliary.db`, `integrity_check` = ok (Pfad unten) | — |
| Ordner der Migrationen im Container | `/app/pb_migrations` (Image startet ohne `--migrationsDir`) | — |
| Vorher: `plaene` 404, Hook 404 | ☑ 404 / 404 | ☑ (heute noch so) |
| Nachher: `plaene` 200 leer, Hook 400 «Einladung unbekannt…» | ☑ | — |
| `verify-pb-regeln.mjs --gegen` = «alles wie erwartet» | ☑ 11 × ✓, Exit 0 | — |
| `*:create` = 2000 / 5 s | ☑ (direkt in der Datenbank gelesen, siehe unten) | — |
| `/api/health` = 200, Crewplaner-Gegenprobe = 200 | ☑ / ☑ | ☑ / ☑ |
| Teil B | — | wartet auf dein Zeichen |

Eingespielt am 27.11. um 08:13 Uhr. Alle vier Migrationen stehen in `_migrations`, angewendet um
08:13:51. Der Container ist healthy, `RestartCount` 0.

## Was genau sich geändert hat

**Collections:** neu `plaene`, `mitglieder`, `einladungen`, `ressourcen`, `gewerke`, `vorgaenge`,
`phasen`, `verknuepfungen`. An `users` sind `superadmin` und `produktionsleitung` dazugekommen.

**Einstellungen.** Ich habe sie vor und nach dem Einspielen verglichen
(`meta`, `rateLimits`, `trustedProxy`, `batch`). Es gibt genau diese Unterschiede:

| Einstellung | vorher | nachher | aus |
|---|---|---|---|
| `rateLimits` `*:create` | 20 / 5 s | **2000 / 5 s** | `1700000003` |
| `batch.enabled` | aus | **an** | `1700000001` |
| `batch.maxRequests` | 50 | **2000** | `1700000001` |
| `batch.timeout` | 3 s | **30 s** | `1700000001` |

Unverändert sind Application name und URL, `rateLimits.enabled` (an), `*:auth`, `/api/batch`,
`/api/`, die Proxy-Header (`X-Forwarded-For`, rechter Eintrag) und Mail (aus).

> **Kleine Abweichung vom Auftrag, nur zur Info:** Dort steht, `1700000003` sei die *einzige* Änderung
> an den Einstellungen. Die Schema-Migration `1700000001` schaltet aber zusätzlich die **Batch-API**
> ein (Zeilen 108–113). Das ist für die App nötig und in Ordnung, gehört aber in den Auftrag für LIVE,
> damit dort niemand über den Diff stolpert.

**Hook-Laufzeit:** In `_logs` gibt es seit dem Einspielen keinen `ReferenceError`, `TypeError`,
`SyntaxError` und kein «Something went wrong». Die einzigen zwei Einträge mit Level 8 sind meine
Kontrollaufrufe an `/api/bzp/einladung` (400, gewollt).

**CORS** ist unverändert: `https://m4dm0nky.github.io` wird gespiegelt, eine fremde Origin bekommt keinen
Header. Das gilt jetzt auch für die neuen Collections, gemessen an `plaene`.

## Wie ich es gemacht habe (Abweichungen vom Ablauf)

1. **Reihenfolge beim Kopieren:** erst die vier Migrationen, dann `hilfen.js`, **dann** `main.pb.js`,
   danach `docker restart`. PocketBase überwacht das Hooks-Verzeichnis und startet sich schon beim
   Kopieren von `main.pb.js` selbst neu (`File … changed, restarting…`). Läge `hilfen.js` in dem Moment
   noch nicht da, liefe für ein paar Sekunden ein Hook ohne seine Hilfen. Im Auftrag steht
   `cp main.pb.js hilfen.js`, also umgekehrt.
2. **Backup nicht in `/root/backups/bauzeitenplan-pb/`,** sondern in einem eigenen Ordner
   `/root/backups/bauzeitenplan-pb-phase2-2026-11-27-0813/`, zusammen mit beiden Datenbanken, den
   Einstellungen vorher und nachher und der Collection-Liste. Grund: Im Live-Ordner räumt die tägliche
   Sicherung nach 7 Tagen auf, und der Rückweg soll nicht von dieser Rotation abhängen.
3. **Auch `auxiliary.db` gesichert,** nicht nur `data.db`.
4. **Die Dateien habe ich vorher gelesen,** nicht nur die Prüfsummen verglichen. Darin gibt es keine
   Shell- oder Netzaufrufe, gelöscht wird nur in der Rückweg-Migration von `1700000001`. Auch beim
   Prüfwerkzeug habe ich vorher nachgesehen, dass `--gegen` nur liest.
5. `/tmp/bzp-phase2` ist schon gelöscht. Für LIVE lade ich die Dateien neu und prüfe sie wieder gegen die
   Prüfsummen.

## Gut zu wissen

- **Die Migrationsdateien liegen nur im Container,** nicht in einem Volume. Bei jedem Recreate durch
  Coolify, zum Beispiel einem Redeploy, sind sie weg. Das ist, wie du schreibst, unschädlich, weil
  `_migrations` sie schon als angewendet führt. **Folge für künftige Migrationen:** Jede neue Datei
  muss wieder per `docker cp` hinein. Ein Redeploy bringt sie nicht mit, und ein `ls
  /app/pb_migrations` nach einem Recreate ist leer, auch wenn alles in Ordnung ist.
- **Die Einstellungen habe ich nicht mit Superuser-Token geprüft** (`PB_SU_TOKEN` bleibt bei dir), sondern
  direkt aus der Datenbank gelesen (`_params`, nur lesend): `*:create` 2000/5 s, Rate Limiting an,
  Application URL `https://m4dm0nky.github.io/Bauzeitenplan/` mit Schrägstrich am Ende. Den
  Lesemodus mit Token kannst du jederzeit selbst zusätzlich laufen lassen.

## Offen

1. **Teil A auf LIVE:** auf dein Zeichen. Vorher bitte die Batch-Notiz oben in den Auftrag übernehmen.
   Am Ablauf ändert sich nichts.
2. **Teil B** (Coolify-App aus Branch `live`): erst auf dein Zeichen «`live` ist gepusht». Bis dahin bleibt
   die heutige statische Seite, wie sie ist.
3. **Teil C** (erstes Superadmin-Konto mit `setup.mjs`): dein Teil, auf TEST ab sofort möglich.
4. **Token-Laufzeit für den Wandmonitor** (`users` → «Auth token duration»): Ich warte auf deinen Wert und
   stelle es dann auf TEST und LIVE ein. Oder du machst es selbst in `/_/`.
5. Aus Phase 1 unverändert: **Mailversand LIVE** und eine **Backup-Kopie außerhalb des Servers**.

## Rückweg TEST

`main.pb.js` und `hilfen.js` aus dem Hooks-Volume löschen, dann `docker restart`. Wenn die
Collections auch weg sollen: Container stoppen, `data.db` und `auxiliary.db` aus dem Backup-Ordner oben
zurückspielen, starten. Auf TEST gibt es noch keine Daten.
