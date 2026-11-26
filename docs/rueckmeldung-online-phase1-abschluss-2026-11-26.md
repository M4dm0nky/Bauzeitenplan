# Rückmeldung: Phase 1 abgeschlossen (Superuser und Einstellungen)

**An:** Marco · **Von:** Server-Admin (Robs) · **Stand:** 2026-11-26
**Bezug:** [`admin-auftrag-online-phase1.md`](admin-auftrag-online-phase1.md),
Fortsetzung von [`rueckmeldung-online-phase1-2026-11-23.md`](rueckmeldung-online-phase1-2026-11-23.md)

Beide PocketBase-Instanzen sind jetzt **vollständig eingerichtet und benutzbar**. Aus Phase 1 bleibt
nur noch der **Mailversand auf Live** offen. Kein anderer Dienst wurde angefasst.

## Stand

| | TEST | LIVE |
|---|---|---|
| Admin-Oberfläche | `https://api-test.callboard.nyxlightwork.de/_/` | `https://api.callboard.nyxlightwork.de/_/` |
| Superuser | ☑ dein Konto, angelegt 26.11. 16:37 | ☑ dein Konto, angelegt 26.11. 16:38 |
| Application name | `Bauzeitenplan TEST` | `Bauzeitenplan` |
| Application URL | `https://m4dm0nky.github.io/Bauzeitenplan/` | `https://callboard.nyxlightwork.de/` |
| Rate limiting | ☑ an, Standardregeln | ☑ an, Standardregeln |
| Echte Client-IP (Settings → Application → User IP proxy headers) | `X-Forwarded-For`, rechter Eintrag | `X-Forwarded-For`, rechter Eintrag |
| Mail (SMTP) | aus, bewusst, so bleibt es | **offen**, siehe unten |
| CORS | `https://m4dm0nky.github.io`, `http://localhost:8080` | `https://callboard.nyxlightwork.de` |
| Backup | keins | täglich 03:02, 7 Tage |
| `/api/health` | 200 ☑ | 200 ☑ |

PocketBase `0.40.6`, Port 8080, Daten unter `/app/pb_data`. Das hat sich seit dem 23.11. nicht
geändert, die Details stehen in der ersten Rückmeldung.

## Was heute passiert ist

1. **Superuser:** Du hast beide Konten selbst über den Installer-Link angelegt. Auf dem Server
   gibt es jetzt je genau **einen** Superuser, das temporäre Installer-Konto von PocketBase ist
   weg.
2. **Einstellungen:** Name, URL, Rate Limiting und die Proxy-Header (Punkt 4) habe ich gesetzt. Dafür habe ich mir je Instanz
   für etwa eine Minute einen **temporären Superuser** angelegt, die Einstellungen über die API
   gesetzt und das Konto danach sofort wieder gelöscht. Geprüft: Es ist nur dein Konto übrig. In
   den Logs von PocketBase (`_logs`) siehst du die Anmeldung und den Settings-Aufruf. Das war ich.
3. **Neustart:** Für frische Installer-Links habe ich beide Instanzen um 16:32 neu gestartet. Daten
   gab es zu dem Zeitpunkt noch keine.
4. **Echte Client-IP:** Ohne diese Einstellung hielt PocketBase jede Anfrage für eine Anfrage von
   Traefik (`10.0.10.3`). Mit eingeschaltetem Rate Limiting hätten sich damit **alle Nutzer einen
   Topf geteilt**: 2 Logins pro 3 Sekunden für alle zusammen, und ein einzelner Angreifer hätte
   alle anderen ausgesperrt. Jetzt liest PocketBase die IP aus `X-Forwarded-For`, und zwar den
   **rechten** Eintrag, den Traefik selbst anhängt. Gemessen: Normale Anfragen zeigen im Log die
   echte IP, und ein gefälschter Header (`X-Forwarded-For: 1.2.3.4`) wird ignoriert. Bitte stell
   das nicht auf „leftmost“ um.

> **Eine Bitte:** Beide Konten laufen auf dieselbe Mailadresse. Im Auftrag stand für Live „eigener
> Superuser, nicht derselbe wie auf Test“. Wenn die **Passwörter** verschieden sind, ist das aus
> meiner Sicht in Ordnung. Wenn nicht, ändere bitte eines davon (`/_/` → Collections → `_superusers` → deinen Datensatz
> bearbeiten).

## Rate Limiting – bitte für Phase 2 beachten

Die Standardregeln sind jetzt aktiv, auf beiden Instanzen gleich:

| Regel | Grenze | Was das für dich heißt |
|---|---|---|
| `*:auth` | **2 Anfragen / 3 s** | Logins. Ab dem dritten Versuch innerhalb von 3 s kommt `429` (gemessen). |
| `*:create` | **20 / 5 s** | Anlegen von Datensätzen |
| `/api/batch` | 3 / 1 s | Batch-Aufrufe |
| `/api/` | 300 / 10 s | alles andere |

Die Grenzen gelten pro Client-IP, siehe Punkt 4 oben. Mehrere Kollegen hinter demselben Büro-Router
teilen sich also einen Topf.

**`*:create` mit 20 / 5 s hat den Crewplaner schon einmal erwischt.** Dort wurden für einen
fachlichen Vorgang 26 Datensätze einzeln angelegt. Ab dem 21. kam `429`, und der Vorgang brach auf
halber Strecke ab, sodass Termine angelegt waren, aber die Mail fehlte. Die Lösung war dort ein
eigener Endpunkt im Hook, der alles in **einer** Transaktion anlegt. Wenn der Bauzeitenplan beim
Speichern oder Importieren viele Datensätze auf einmal schreibt, plane das bitte gleich so ein
(eigener Hook-Endpunkt oder `/api/batch`). Alternativ kannst du die Regel in
`/_/` → Settings → Application anheben. Das kannst du als Superuser selbst.

## Offen

1. **Mailversand Live** (Variante A, Resend-SMTP in PocketBase, Absender
   `no-reply@callboard.nyxlightwork.de`). Dafür lege ich die Domain bei Resend an und trage die
   DNS-Records ein. Danach kommt eine Testmail an dich. Bis dahin funktioniert auf Live **kein**
   „Passwort vergessen“ und keine Verifizierungsmail. Auf Test bleibt Mail dauerhaft aus.
2. **Kopie der Live-Backups außerhalb des Servers** fehlt weiterhin. Das ist dieselbe Lücke wie bei
   allen Diensten auf dem Server.
3. **Phase 2** (Schema, Hook, Frontend aus Branch `live`) ist dein Zug. Für den Hook gilt das
   Runbook vom Crewplaner: sha-Gate, Backup, Wirkung messen statt nur das Log zu lesen. Sag
   Bescheid, sobald es dafür einen Auftrag gibt.
