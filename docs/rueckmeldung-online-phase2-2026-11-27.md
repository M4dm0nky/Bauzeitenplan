# Rückmeldung: Bauzeitenplan online, Phase 2 – Teil A auf TEST und LIVE, Teil B

**An:** Marco · **Von:** Server-Admin (Robs) · **Stand:** 2026-11-27, 19:10 Uhr
**Bezug:** [`admin-auftrag-online-phase2.md`](admin-auftrag-online-phase2.md) (TEST nach Stand `22d18d6` auf
Branch `online`, LIVE nach Stand `main` `3e9f886`)

**Teil A läuft auf TEST und auf LIVE.** Auf beiden Instanzen sind Migrationen und Hooks eingespielt, alle
Messungen sind wie erwartet, und es gab keine Laufzeitfehler. Die statische Seite auf
`callboard.nyxlightwork.de` ist unverändert, ebenso der Crewplaner (beides nachgemessen). Teil B wartet auf
dein «`live` ist gepusht».

**Nachtrag 14:35 Uhr – Teil B ist umgestellt.** `callboard.nyxlightwork.de` liefert seit 14:27 Uhr Version 1.0.0
aus Branch `live` (`416400e`) aus. Alle Messungen aus dem Auftrag sind grün. Für das Auto-Deploy fehlt nur noch
der Webhook in deinem Repo, siehe [Teil B](#teil-b--coolify-app-umgestellt).

**Nachtrag 18:10 Uhr – Webhook läuft, für die Mailvorlagen brauche ich drei Dinge von dir.** Siehe
[den Nachtrag unten](#nachtrag-1810-uhr--webhook-läuft-mailvorlagen-warten-auf-dich).

**Nachtrag 19:10 Uhr – Mailvorlagen laufen auf TEST und LIVE.** Siehe
[den Nachtrag unten](#nachtrag-1910-uhr--mailvorlagen-auf-test-und-live-eingespielt).

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
| Teil B: App umgestellt (Branch `live`, Port 80, Auto-Deploy) | — | ☑ umgestellt, Port 80, Health `/healthz`. Auto-Deploy ist in Coolify an, **der Webhook in GitHub fehlt noch** (dein Schritt) |
| Teil B: Messungen (Cache-Header, `/healthz`, `/docs/` 404, CORS) | — | ☑ alle |

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

## Nachtrag 19:10 Uhr – Mailvorlagen auf TEST und LIVE eingespielt

Danke für die schnelle Antwort. Ich habe nach deinem Nachtrag im Auftrag eingespielt (Stand `595cf43`), erst
TEST um 19:02 Uhr, dann LIVE um 19:03 Uhr. Auf beiden Instanzen lief derselbe Ablauf:

1. Beide Dateien frisch von GitHub geladen, sha-Gate 2/2, einmal nach dem Download und einmal direkt vor dem
   Kopieren. `hilfen.js` habe ich nicht angefasst.
2. Gate vorher: `main.pb.js` muss die Phase-2-Fassung `969d7062…` sein, und `1700000005` darf noch nicht
   angewendet sein. Beides war so.
3. Backup beider Datenbanken plus der alten `main.pb.js`, `integrity_check` ok, eigener Ordner.
4. `docker cp 1700000005_mailvorlagen.js`, dann `cp main.pb.js` ins Hooks-Volume, dann `docker restart`.
   Nach 8 s healthy, `RestartCount` 0.

| Prüfung | TEST | LIVE |
|---|---|---|
| `main.pb.js` im Volume | `f485241b…` ☑ | `f485241b…` ☑ |
| `_migrations` | `1700000005` angewendet ☑ | `1700000005` angewendet ☑ |
| `/api/health`, `plaene`, Hook-Route | 200 / 200 / 400, wie vorher ☑ | 200 / 200 / 400, wie vorher ☑ |
| `verify-pb-regeln --gegen` **mit** Superuser-Token | **27/27** ☑ | **27/27** ☑ |
| Laufzeitfehler in `_logs` seit dem Start | keine ☑ | keine ☑ |
| Superuser / Konten | 1 / 1, unverändert | 1 / 2, unverändert |

Die beiden Einträge mit Level 8 in `_logs` sind meine eigenen Kontrollaufrufe an die Hook-Route, vorher und
nachher, jeweils mit «Einladung unbekannt oder schon verwendet.». Das ist das erwartete 400, kein Fehler.

**Vorlagen vorher und nachher** (aus der Datenbank gelesen, auf beiden Instanzen gleich):

| Vorlage | vorher | nachher |
|---|---|---|
| Anmeldewarnung | `Login from a new location` | «Anmeldung von einem neuen Gerät», bleibt eingeschaltet |
| E-Mail bestätigen | `Verify your {APP_NAME} email`, Link auf `/_/` | «E-Mail-Adresse für den Bauzeitenplan bestätigen», Link `{APP_URL}/login.html?verify={TOKEN}` |
| E-Mail ändern | `Confirm your {APP_NAME} new email address`, Link auf `/_/` | «E-Mail-Adresse im Bauzeitenplan ändern», ohne Link |
| Passwort zurücksetzen | deutsch (seit Phase 2) | unverändert |

**Echte Testmail auf LIVE:** Vorlage «E-Mail bestätigen» über Resend an ein eigenes Postfach geschickt.

- Betreff «E-Mail-Adresse für den Bauzeitenplan bestätigen», Absender `Bauzeitenplan <no-reply@callboard.nyxlightwork.de>`.
- Link: `https://callboard.nyxlightwork.de/login.html?verify=…`, mit einem Schrägstrich, ohne `/_/`.
- SPF, DKIM und DMARC bestanden, Spam-Wert −2,70, Posteingang.

Den Link habe ich nicht angeklickt: Die Testmail von PocketBase enthält ein Token für einen Platzhalter, kein
echtes Konto. Ob `login.html?verify=` die Adresse wirklich bestätigt, prüfst du am besten mit einem echten,
unbestätigten Konto.

Für die Prüfung mit Token habe ich mir je Instanz für etwa eine Minute einen **temporären Superuser** angelegt
und ihn danach wieder gelöscht. Übrig ist auf beiden nur dein Konto. In `_logs` siehst du die Anmeldung, die
zwei Lesezugriffe und auf LIVE den Mailversand. Das war ich. Auf TEST ging keine Mail raus, dort bleibt Mail aus.

**Backups:** TEST `/root/backups/bauzeitenplan-pb-mailvorlagen-test-2026-11-27-1902/`, LIVE
`/root/backups/bauzeitenplan-pb-mailvorlagen-live-2026-11-27-1903/`, mit beiden Datenbanken, der alten
`main.pb.js`, den Prüfsummen und den Messungen vorher und nachher.

**Rückweg:** alte `main.pb.js` aus dem Backup-Ordner ins Hooks-Volume kopieren, dann `docker restart`. Die
Vorlagen setzt das nicht zurück (die Migration hat absichtlich keinen Rückweg). Das ginge nur über die Vorlagen im
Admin oder durch Zurückspielen der Datenbanken. Auf LIVE liegen inzwischen zwei Konten, ein Zurückspielen würde
also alles verwerfen, was seit 19:03 Uhr geschrieben wurde.

## Nachtrag 18:10 Uhr – Webhook läuft, Mailvorlagen warten auf dich

### Webhook: funktioniert

Danke, dass du den Webhook angelegt hast. Dein Push `56ff17d` (Version 1.0.1) auf `live` wurde um 17:30 Uhr
automatisch gebaut und ausgerollt, ohne dass ich etwas tun musste. Coolify führt ihn als Webhook-Deploy. Danach
habe ich die Seite nachgemessen:

| Prüfung | Ergebnis |
|---|---|
| `/`, `/healthz`, `/login.html` | 200 ☑ |
| `/docs/`, `/tools/…`, `/pocketbase/`, `/.git/config`, `/Dockerfile` | 404 ☑ |
| Cache-Header (`/` `no-cache`, `sw.js` `no-store`) | unverändert ☑ |
| `js/version.js` | `1.0.1` ☑ |
| nginx | 1.30.8 aus `nginx:stable-alpine` ☑. Mein Hinweis zu 1.27 weiter unten ist damit erledigt. |

### Mailvorlagen (Nachtrag im Auftrag, Issue #14): noch nicht eingespielt

Den Nachtrag «Mailvorlagen» im Auftrag habe ich gelesen, die Migration und den geänderten Hook auch. Beide
Instanzen laufen noch mit der Phase-2-Fassung (`main.pb.js` `969d7062…`). Bevor ich einspiele, brauche ich drei
Dinge von dir:

1. **Die Prüfsummen.** Im Auftrag steht, dass sie im Release-Auftrag kommen, den gibt es aber noch nicht. Auf
   `main` (`56ff17d`) messe ich:

   ```
   2082cf5eee85c3e0c7ccd4b89f2246c7d82dd718d471e5f5d3a62f4a3d0717c4  1700000005_mailvorlagen.js
   f485241b518304edeb77b5d8b59ee30a12623163b0f7978aed0714a41a90c7c8  main.pb.js
   ```

   `hilfen.js` ist unverändert (`218fe878…`), die kopiere ich nicht neu. Wenn das deine Stände sind, reicht ein
   kurzes «passt», ein eigener Release-Auftrag ist dann nicht nötig. Wenn noch etwas nachkommt, schick mir bitte
   die endgültigen Summen.
2. **Dein Zeichen, wann und wo.** Mein Vorschlag: erst TEST, dann gleich danach LIVE. Der Teil im Frontend
   (`login.html?verify=`) ist mit 1.0.1 schon live, deshalb muss LIVE nicht warten. Wenn du TEST erst selbst
   ansehen willst, sag Bescheid, dann spiele ich LIVE erst nach deiner Freigabe ein.
3. **Kurz zur Reset-Testmail von heute Nachmittag:** Ist sie angekommen? Schau bitte auch im Spam nach.

**So spiele ich es ein**, wie bei Teil A:
- sha-Gate vor dem Kopieren und ein Backup beider Datenbanken in einen eigenen Ordner;
- Migration per `docker cp`, dann `main.pb.js` ins Volume, dann `docker restart`;
- Wirkung mit `verify-pb-regeln --gegen` prüfen;
- auf LIVE zusätzlich eine Test-Bestätigungsmail schicken und prüfen, dass der Link auf `login.html?verify=`
  zeigt und nicht mehr auf `/_/`.

Das Ergebnis schreibe ich wieder hier hinein.

## Nachtrag 15:15 Uhr – Mailversand LIVE läuft

Resend hat die Domain `callboard.nyxlightwork.de` bestätigt. LIVE verschickt jetzt Mails über Resend,
Absender `Bauzeitenplan <no-reply@callboard.nyxlightwork.de>`. **«Passwort vergessen» funktioniert damit auf LIVE.**
Auf TEST bleibt Mail wie vereinbart aus.

**Die Testmail an dich** (Vorlage «Passwort zurücksetzen») ging um 15:11 Uhr raus. Bitte schau einmal, ob sie
im Posteingang angekommen ist und nicht im Spam. Der Link darin gehört zu einem Testkonto, das es nicht gibt,
ein Klick setzt also nichts zurück.

Gemessen an zwei Testmails an ein eigenes Postfach:

| Prüfung | Ergebnis |
|---|---|
| Zustellung | nach etwa 5–15 s, über Amazon SES eu-west-1 |
| SPF / DKIM / DMARC | alle drei bestanden. DKIM ist mit `d=callboard.nyxlightwork.de` signiert, also zum Absender passend |
| Spam-Bewertung (Rspamd) | −2,70 und −2,90 von 11 → Posteingang |
| «Passwort zurücksetzen» | deutscher Betreff aus deiner Migration `1700000002`, Link `https://callboard.nyxlightwork.de/login.html?reset=…` ✓ |

**Ein Fund für dich, nicht dringend:** Die Vorlage **«E-Mail bestätigen»** (`users` → Verification) ist noch die
Vorgabe von PocketBase. Ihr Link zeigt auf `https://callboard.nyxlightwork.de//_/#/auth/confirm-verification/…`, also auf
die Admin-Oberfläche von PocketBase unter der Adresse der App. Dort gibt es `/_/` nicht (404). Wenn die App
Bestätigungsmails verschickt oder das künftig soll, braucht diese Vorlage eine eigene Migration wie die
Reset-Mail. Die Vorlagen «E-Mail ändern» (Email change) und «Anmeldung von neuem Gerät» (Login alert)
dürften genauso aussehen. Wenn die App keine dieser Mails nutzt, ist nichts zu tun.

**DNS, falls du bei Resend nachsiehst:** Resend hat beim Einrichten auf ein neues Verfahren umgestellt. Statt MX
und TXT direkt bei uns stehen jetzt zwei CNAMEs auf Resends Server (`send.callboard` und `rsend.callboard`).
DKIM-Eintrag und DMARC (`p=none`) sind gleich geblieben.

## Teil B – Coolify-App umgestellt

Ich habe die bestehende App `g5pyqw9w8ptwa9igthdbq8dj` umgestellt, also keine zweite App angelegt.
Damit liegt die Domain nicht doppelt.

| Einstellung | vorher (Rückweg) | jetzt |
|---|---|---|
| Quelle | `m4dm0nky/Bauzeitenplan`, Branch `main` | `m4dm0nky/Bauzeitenplan`, Branch **`live`** |
| Build-Pack | Static (`nginx:alpine`, Repo-Stamm) | **Dockerfile** `/Dockerfile` |
| Port | 80 | 80 |
| Health-Check | aus | **an**, `GET http://127.0.0.1:80/healthz` |
| Auto-Deploy | an, aber ohne Webhook wirkungslos | an, **Webhook fehlt noch** |
| Image | Build vom 18.07. (`821744fc`), bleibt als Rückweg auf dem Server | `416400e` |

Den Health-Check habe ich bewusst auf `127.0.0.1` statt `localhost` gestellt. Grund: `nginx.conf` lauscht nur
auf IPv4, `localhost` kann im Container zuerst `::1` ergeben und schlüge dann fehl. Dein eigener `HEALTHCHECK`
macht es genauso.

**Deploy:** 14:27 Uhr als Rolling Update. Coolify hat gewartet, bis der neue Container gesund war, und erst
dann den alten entfernt. Die alte Konfiguration ist auf dem Server gesichert.

**Messungen** (von außen):

| Prüfung | Ergebnis |
|---|---|
| `/` | 200, `cache-control: no-cache`, `nosniff`, `referrer-policy: same-origin`, Titel «CallBoard — Bauzeitenplan» |
| `/sw.js` | `no-cache, no-store, must-revalidate` |
| `/healthz` | 200 |
| `/login.html`, `/print.html` | 200 |
| `/docs/x.md`, `/docs/admin-auftrag-online-phase2.md`, `/tools/…`, `/pocketbase/…`, `/.git/config`, `/Dockerfile`, `/nginx.conf`, `/README.md` | alle 404 |
| Im Image | nur `index.html`, `login.html`, `print.html`, `sw.js`, `js/`, `styles/`, `assets/` (plus `50x.html` von nginx) |
| http → https | Weiterleitung auf `https://callboard.nyxlightwork.de/` |
| CORS-Vorabfrage an die LIVE-API mit Origin `https://callboard.nyxlightwork.de` | `Access-Control-Allow-Origin: https://callboard.nyxlightwork.de` |
| Zertifikat | Let's Encrypt, unverändert bis 13.02.2027 |
| `api.callboard…/api/health`, Crewplaner-Gegenprobe | 200 / 200 |

### Auto-Deploy: dein Schritt im Repo

Das Repo hängt als **öffentliches** Repo an Coolify, ohne GitHub-App. Ein Push meldet sich deshalb nur über
einen Webhook, und den kann nur jemand mit Admin-Rechten am Repo anlegen. Das bist du (mein Konto hat nur
`push`). In GitHub unter **Settings → Webhooks → Add webhook**:

| Feld | Wert |
|---|---|
| Payload URL | `https://coolify.nyxlightwork.de/webhooks/source/github/events/manual` |
| Content type | `application/json` |
| Secret | bekommst du von mir **direkt, nicht über GitHub** |
| SSL verification | an |
| Events | «Just the push event» |

Coolify baut nur bei einem Push auf **`live`** neu. Pushes auf `main` oder andere Branches lösen nichts aus.

Die Gegenseite habe ich selbst getestet, mit einem nachgebauten, signierten Push auf `live`. Eine falsche
Signatur wird abgewiesen, und es entsteht kein Deployment. Mit dem richtigen Secret wird ein Deployment
angestoßen (14:30 Uhr, als Webhook-Deploy erkannt). Beim Umschalten fiel dabei **eine** Anfrage aus, etwa
eine Sekunde lang. Nach dem Anlegen zeigt GitHub unter «Recent Deliveries» einen Ping. Ein Ping baut noch
nicht neu, das macht erst dein nächster Push auf `live`.

### Ein Hinweis zum Dockerfile (erledigt mit 1.0.1)

`FROM nginx:1.27-alpine` ist eine **abgeschlossene** nginx-Linie. Das Image ist 1.27.5 und bekommt keine
Sicherheitsupdates mehr. Hier werden nur statische Dateien ausgeliefert, deshalb ist das kein akutes Problem.
Ich würde es trotzdem beim nächsten Release umstellen, zum Beispiel auf `nginx:stable-alpine`. Dann bringt jeder
Neubau den aktuellen Stand mit. `nginx.conf` passt unverändert.

### Rückweg Teil B

In Coolify Branch `main`, Build-Pack Static und Health-Check aus setzen, dann neu deployen. Schneller geht es
mit dem alten Image `821744fc`, das noch auf dem Server liegt.
**Achtung:** Ein Static-Deploy von `main` würde heute den ganzen Repo-Stamm ausliefern, auch `docs/` und
`tools/`. Als Rückweg taugt also nur das alte Image oder ein älterer Commit.

## Wie ich es gemacht habe (Teil A)

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

**Zur Version 1.0.0 auf `main`:** Bis Teil B lief die Seite unverändert aus dem Container vom Juli. Die alte
App deployte nicht automatisch und hat deinen Merge also nicht mitgenommen.

## Gut zu wissen

- **Die Migrationsdateien liegen nur im Container,** nicht in einem Volume. Bei jedem Recreate durch
  Coolify, zum Beispiel bei einem Redeploy, sind sie weg. Das ist unschädlich, weil `_migrations` sie als
  angewendet führt. Jede **neue** Migration muss aber wieder per `docker cp` hinein.
- **Die Einstellungen habe ich nicht mit Superuser-Token geprüft** (`PB_SU_TOKEN` bleibt bei dir), sondern
  direkt aus der Datenbank gelesen (`_params`, nur lesend). Den Lesemodus mit Token kannst du jederzeit
  zusätzlich laufen lassen.
- **Token-Laufzeit:** Die Vorgabe von 7 Tagen bleibt laut deiner Entscheidung, ich habe nichts eingestellt.

## Offen

1. **Mailvorlagen:** eingespielt (siehe Nachtrag 19:10 Uhr). Offen ist nur deine Probe von `login.html?verify=`
   mit einem echten, unbestätigten Konto.
2. **Teil C** (erstes Superadmin-Konto mit `setup.mjs`): dein Teil, ab sofort auf TEST und LIVE möglich.
3. **Mailversand LIVE:** erledigt. Er läuft, deine Reset-Testmail ist angekommen, und die Vorlagen sind seit
   19:03 Uhr deutsch.
4. **Backup-Kopie außerhalb des Servers** fehlt weiterhin.

## Rückweg

`main.pb.js` und `hilfen.js` aus dem Hooks-Volume der jeweiligen Instanz löschen, dann `docker restart`.
Wenn auch die Collections weg sollen: Container stoppen, `data.db` und `auxiliary.db` aus dem passenden
Backup-Ordner oben zurückspielen, starten. Auf LIVE geht das ohne Verlust nur, solange dort noch keine echten
Daten liegen, also bis zu deinem ersten Konto.
