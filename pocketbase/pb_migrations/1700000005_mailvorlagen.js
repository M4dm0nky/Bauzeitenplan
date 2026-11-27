/// <reference path="../pb_data/types.d.ts" />
// Mailvorlagen der Konten auf Deutsch; kein Link führt mehr auf die PocketBase-Oberfläche (/_/).
// {APP_URL} ist die Adresse der App (Einstellung meta.appURL, dieselbe wie bei Einladungslinks).
//  - authAlert: Warnung bei Anmeldung von einem neuen Gerät (bleibt eingeschaltet).
//  - verificationTemplate: Link auf login.html?verify=… (die Anmeldeseite ruft confirm-verification auf).
//  - confirmEmailChangeTemplate: ohne Link, weil der Hook E-Mail-Änderungen sperrt.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.authAlert.enabled = true;
  users.authAlert.emailTemplate.subject = "Anmeldung von einem neuen Gerät";
  users.authAlert.emailTemplate.body = "<p>Hallo,</p><p>für dein Konto im Bauzeitenplan wurde eine Anmeldung von einem neuen Gerät festgestellt:</p><p><em>{ALERT_INFO}</em></p><p>Wenn du das nicht warst, ändere sofort dein Passwort: Öffne <a href=\"{APP_URL}/login.html\" target=\"_blank\" rel=\"noopener\">{APP_URL}/login.html</a> und wähle «Passwort vergessen».</p><p>Wenn du das warst, kannst du diese Mail ignorieren.</p>";
  users.verificationTemplate.subject = "E-Mail-Adresse für den Bauzeitenplan bestätigen";
  users.verificationTemplate.body = "<p>Hallo,</p><p>bitte bestätige deine E-Mail-Adresse mit einem Klick auf den folgenden Link:</p><p><a href=\"{APP_URL}/login.html?verify={TOKEN}\" target=\"_blank\" rel=\"noopener\">E-Mail-Adresse bestätigen</a></p><p>Wenn du dich nicht registriert hast, kannst du diese Mail ignorieren.</p>";
  users.confirmEmailChangeTemplate.subject = "E-Mail-Adresse im Bauzeitenplan ändern";
  users.confirmEmailChangeTemplate.body = "<p>Hallo,</p><p>die E-Mail-Adresse lässt sich im Bauzeitenplan nicht selbst ändern. Bitte wende dich an die Verwaltung.</p><p>Wenn du das nicht angefordert hast, kannst du diese Mail ignorieren.</p>";
  app.save(users);
}, (app) => {
  // Zurück auf die PocketBase-Vorgabe ist nicht nötig; die Vorlagen bleiben harmlos.
});
