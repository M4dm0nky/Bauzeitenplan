# Rückmeldung: Bauzeitenplan online, Phase 2 – Teil A auf TEST und LIVE

**An:** Marco · **Von:** Server-Admin (Robs) · **Stand:** 2026-11-27, 14:15 Uhr
**Bezug:** [`admin-auftrag-online-phase2.md`](admin-auftrag-online-phase2.md) (TEST nach Stand `22d18d6` auf
Branch `online`, LIVE nach Stand `main` `3e9f886`)

**Teil A läuft auf TEST und auf LIVE.** Auf beiden Instanzen sind Migrationen und Hooks eingespielt, alle
Messungen sind wie erwartet, und es gab keine Laufzeitfehler. Die statische Seite auf
`callboard.nyxlightwork.de` ist unverändert, ebenso der Crewplaner (beides nachgemessen). Teil B wartet auf
dein «`live` ist gepusht».

## Ergebnis

| | TEST | LIVE |
|---|---|---|
| `sha256sum -c` alle sechs OK | ☑ (nach dem Download **und** direkt vor dem Kopieren noch einmal) | ☑ ebenso, Dateien frisch von `main` geladen |
| Backup vor dem Einspielen | ☑ `data.db` + `auxiliary.db`, `integrity_check` = ok | ☑ `data.db` + `auxiliary.db`, `integrity_check` = ok |
| Ordner der Migrationen im Container | `/app/pb_migrations` (Image startet ohne `--migrationsDir`) | `/app/pb_migrations` (ebenso) |
| Vorher: `plaene` 404, Hook 404 | ☑ 404 / 404 | ☑ 404 / 404 |
| Nachher: `plaene` 200 leer, Hook 400 «Einladung unbekannt…» | ☑ | ☑ |
| `verify-pb-regeln.mjs --gegen` = «alles wie erwartet» | ☑ 11 × ✓, Exit 0 | ☑ 11 × ✓, Exit 0 |
| `*:create` = 2000 / 5 s | ☑ (direkt in der Datenbank gelesen, siehe unten) | ☑ (ebenso) |
| `/api/health` = 200, Crewplaner-Gegenprobe = 200 | ☑ / ☑ | ☑ / ☑ |
| Teil B | — | wartet auf dein Zeichen |

**TEST** wurde am 27.11. um 08:13 Uhr eingespielt, **LIVE** am 27.11. um 14:14 Uhr. Auf beiden stehen alle
vier Migrationen in `_migrations`, die Container sind healthy und haben `RestartCount` 0. Auf LIVE gab es
vorher genau einen Superuser (dich) und null Konten in `users`. Danach ist es genauso.

## Was genau sich geändert hat (auf beiden Instanzen gleich)

**Collections:** neu `plaene`, `mitglieder`, `einladungen`, `ressourcen`, `gewerke`, `vorgaenge`,
`phasen`, `verknuepfungen`. An `users` sind `superadmin` und `produktionsleitung` dazugekommen.

**Einstellungen.** Ich habe sie vor und nach dem Einspielen verglichen
(`meta`, `rateLimits`, `trustedProxy`, `batch`, auf LIVE zusätzlich `smtp`). Es gibt genau diese
Unterschiede, auf TEST und LIVE identisch:

| Einstellung | vorher | nachher | aus |
|---|---|---|---|
| `rateLimits` `*:create` | 20 / 5 s | **2000 / 5 s** | `1700000003` |
| `batch.enabled` | aus | **an** | `1700000001` |
| `batch.maxRequests` | 50 | **2000** | `1700000001` |
| `batch.timeout` | 3 s | **30 s** | `1700000001` |

Unverändert sind Application name und URL, `rateLimits.enabled` (an), `*:auth`, `/api/batch`, `/api/` und
die Proxy-Header (`X-Forwarded-For`, rechter Eintrag). Auch die Mail-Einstellungen sind unverändert: auf TEST
aus, auf LIVE der SMTP-Eintrag für Resend, siehe «Offen».

**Hook-Laufzeit:** In `_logs` gibt es seit dem Einspielen keinen `ReferenceError`, `TypeError`,
`SyntaxError` und kein «Something went wrong». Die einzigen Einträge mit Level 8 sind meine
Kontrollaufrufe an `/api/bzp/einladung` (400, gewollt): zwei auf TEST, zwei auf LIVE.

**CORS** ist unverändert. Auf TEST wird `https://m4dm0nky.github.io` gespiegelt, auf LIVE
`https://callboard.nyxlightwork.de`. Eine fremde Origin bekommt keinen Header. Das gilt jetzt auch für die
neuen Collections, gemessen an `plaene`.

## Wie ich es gemacht habe

Auf LIVE genau nach dem überarbeiteten Auftrag, also mit derselben Kopierreihenfolge
(`hilfen.js` vor `main.pb.js`), Backup im eigenen Ordner mit `auxiliary.db`, Einstellungen vorher und
nachher sowie Collection-Liste daneben. Ein paar Kleinigkeiten zusätzlich bzw. anders als im Auftrag:

1. **Download von `main` statt `online`:** Der Branch ist gemergt, und die Prüfsummen haben es bestätigt.
   Es sind dieselben sechs Dateien wie auf TEST.
2. **Backup-Ordner** für LIVE `/root/backups/bauzeitenplan-pb-phase2-live-2026-11-27-1414/`, für TEST
   `/root/backups/bauzeitenplan-pb-phase2-2026-11-27-0813/`. Beide liegen außerhalb der 7-Tage-Rotation.
3. **Vorher-Zustand als Gate:** Hätte LIVE vor dem Kopieren nicht 404/404 geliefert, hätte das Skript
   abgebrochen.
4. **Prüfwerkzeug** aus `main` (`3e9f886`). Ich habe nachgesehen, dass `verify-pb-regeln.mjs` seit der
   TEST-Prüfung unverändert ist, also weiterhin nur liest.
5. `/tmp/bzp-phase2` ist nach LIVE gelöscht.

**Zur Version 1.0.0 auf `main`:** Die statische Seite deployt nicht automatisch. Sie läuft unverändert aus
dem Container vom Juli und hat deinen Merge also nicht mitgenommen. Erst Teil B stellt die Seite um.

## Gut zu wissen

- **Die Migrationsdateien liegen nur im Container,** nicht in einem Volume. Bei jedem Recreate durch
  Coolify, zum Beispiel bei einem Redeploy, sind sie weg. Das ist unschädlich, weil `_migrations` sie als
  angewendet führt. Jede **neue** Migration muss aber wieder per `docker cp` hinein.
- **Die Einstellungen habe ich nicht mit Superuser-Token geprüft** (`PB_SU_TOKEN` bleibt bei dir), sondern
  direkt aus der Datenbank gelesen (`_params`, nur lesend). Den Lesemodus mit Token kannst du jederzeit
  zusätzlich laufen lassen.
- **Token-Laufzeit:** Die Vorgabe von 7 Tagen bleibt laut deiner Entscheidung, ich habe nichts eingestellt.

## Offen

1. **Teil B** (Coolify-App aus Branch `live`): erst auf dein Zeichen «`live` ist gepusht». Bis dahin bleibt
   die statische Seite, wie sie ist.
2. **Teil C** (erstes Superadmin-Konto mit `setup.mjs`): dein Teil, ab sofort auf TEST und LIVE möglich.
3. **Mailversand LIVE:** Die DNS-Einträge für Resend stehen, und SMTP ist in der LIVE-Instanz eingetragen
   (Absender `no-reply@callboard.nyxlightwork.de`). Resend hat die Domain aber noch nicht als «Verified»
   bestätigt. Bis dahin lehnt Resend den Versand ab, «Passwort vergessen» funktioniert also noch nicht.
   Sobald die Domain verifiziert ist, schicke ich dir eine Testmail.
4. **Backup-Kopie außerhalb des Servers** fehlt weiterhin.

## Rückweg

`main.pb.js` und `hilfen.js` aus dem Hooks-Volume der jeweiligen Instanz löschen, dann `docker restart`.
Wenn auch die Collections weg sollen: Container stoppen, `data.db` und `auxiliary.db` aus dem passenden
Backup-Ordner oben zurückspielen, starten. Auf LIVE geht das ohne Verlust nur, solange dort noch keine echten
Daten liegen, also bis zu deinem ersten Konto.
