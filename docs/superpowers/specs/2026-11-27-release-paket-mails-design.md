# Release-Paket: Mailvorlagen, nginx, Prüfskripte (Issues #12, #13, #14)

Freigegeben von Marco am 2026-11-27 («ja»).

## Ziel
Drei Punkte aus Robs' Rückmeldung zu Phase 2 als ein Paket für den nächsten Server-Release.

## Umfang
- **#14 Mailvorlagen** (neue Migration `pocketbase/pb_migrations/1700000005_mailvorlagen.js`):
  - `authAlert` bleibt eingeschaltet, Text wird deutsch. *Entscheidung:* übersetzen statt abschalten. Die Mail warnt bei fremden Anmeldungen und enthält keinen Link, der kaputtgehen kann.
  - `verificationTemplate`: deutscher Text, Link `{APP_URL}/login.html?verify={TOKEN}`. `login.html` nimmt `?verify=` an und ruft `confirm-verification` auf.
  - `confirmEmailChangeTemplate`: deutscher Text **ohne Link**. *Entscheidung:* Der Hook sperrt E-Mail-Änderungen (`onRecordRequestEmailChangeRequest`/`onRecordConfirmEmailChangeRequest`). Ein Bestätigungslink würde ins Leere führen, deshalb verweist die Mail auf die Verwaltung.
  - In keiner Vorlage der `users` steht mehr `/_/`.
- **#12** `Dockerfile`: `nginx:1.27-alpine` wird zu `nginx:stable-alpine`, gesperrt per Prüfung in `tests/run.mjs`.
- **#13** Feste Pausen durch Warten auf Zustand ersetzen: `verify-edit` «DAUERHAFTIGKEIT» (wartet auf `#sync-state[data-state=ok]`, danach auf Projektname und Balken) und `verify-mehrbenutzer` «Projektdialog sichtbar».

## Nicht im Umfang
Kein Push auf `live`, keine Versionsnummer, kein Tag: Das entscheidet Marco. Robs spielt die Migration per `docker cp` ein (Nachtrag in `docs/admin-auftrag-online-phase2.md`).

## Abnahme
Alle zehn Prüfskripte grün. Neue Prüfungen:
- `verify-pb-regeln`: Vorlagentexte deutsch, kein `/_/`, der Verifizierungslink zeigt auf `login.html?verify=`, Mail über den lokalen SMTP.
- `verify-mehrbenutzer`: Seite `?verify=` mit gültigem Token zeigt «fertig», mit ungültigem Token einen Fehler.
- Rot-Nachweis für die Vorlagenprüfung (ohne Migration rot).
