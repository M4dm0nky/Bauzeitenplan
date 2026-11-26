/// <reference path="../pb_data/types.d.ts" />
// Passwort-zurücksetzen-Mail: der Link führt auf die Anmeldeseite (login.html?reset=…) statt auf die PocketBase-Oberfläche.
// {APP_URL} ist die Adresse der App (Einstellung meta.appURL, dieselbe wie bei Einladungslinks).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.resetPasswordTemplate.subject = "Passwort für den Bauzeitenplan zurücksetzen";
  users.resetPasswordTemplate.body = "<p>Hallo,</p><p>zum Zurücksetzen deines Passworts klicke auf den folgenden Link:</p><p><a href=\"{APP_URL}/login.html?reset={TOKEN}\" target=\"_blank\" rel=\"noopener\">Neues Passwort festlegen</a></p><p>Wenn du das nicht angefordert hast, kannst du diese Mail ignorieren.</p>";
  app.save(users);
}, (app) => {
  // Zurück auf die PocketBase-Vorgabe ist nicht nötig; die Vorlage bleibt harmlos.
});
