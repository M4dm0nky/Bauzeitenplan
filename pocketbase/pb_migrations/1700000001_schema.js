/// <reference path="../pb_data/types.d.ts" />
// Schema und API-Regeln der Online-Fassung (Plan Teil 2, Task 2).
// Alle ids sind Text (nie Relation). Feinheiten (Gewerk, Status, Ressourcen-Ändern, rev) macht der Hook.

// --- Regelausdrücke (zentral, damit sie sich prüfen lassen) ---------------------------------
// Korrelation: Mehrere Bedingungen auf dieselbe @collection OHNE Alias meint in PocketBase
// dieselbe Zeile (gemessen in tools/verify-pb-regeln.mjs, Abschnitt SCHEMA, «Korrelation»).
const SUPER = "@request.auth.superadmin = true";
const BESITZER = "(@collection.plaene.plan_id ?= plan_id && @collection.plaene.besitzer ?= @request.auth.id)";
const MITGL = "(@collection.mitglieder.plan_id ?= plan_id && @collection.mitglieder.user_id ?= @request.auth.id)";
// lesen: Superadmin, Besitzer oder irgendein Mitglied des Plans
const MITGLIED = `(${SUPER} || ${BESITZER} || ${MITGL})`;
// schreiben: angemeldet + Superadmin/Besitzer/Mitglied mit Rolle ≠ betrachter
const SCHREIBEN = `(@request.auth.id != '' && (${SUPER} || ${BESITZER} || (${MITGL} && @collection.mitglieder.rolle ?!= 'betrachter')))`;
// ein Datensatz darf nie in einen anderen Plan umgehängt werden
const PLAN_FEST = "(@request.body.plan_id:isset = false || @request.body.plan_id = plan_id)";
// Plan-Metadaten (plaene): Gewerkeleiter und Betrachter dürfen sie nicht ändern; der Besitzer ist
// nur durch Superadmin änderbar (sonst könnte sich ein Bearbeiter zum Besitzer machen)
const PLAN_AENDERN = `(@request.auth.id != '' && (${SUPER} || ${BESITZER} || (${MITGL} && (@collection.mitglieder.rolle ?= 'produktionsleitung' || @collection.mitglieder.rolle ?= 'bearbeiter'))))`;
const BESITZER_FEST = `(${SUPER} || @request.body.besitzer:isset = false || @request.body.besitzer = besitzer)`;
// Mitglieder/Einladungen verwalten: Superadmin, Besitzer, Mitglied «produktionsleitung» des Plans
const VERWALTEN = `(@request.auth.id != '' && (${SUPER} || ${BESITZER} || (${MITGL} && @collection.mitglieder.rolle ?= 'produktionsleitung')))`;

const text = (name, extra = {}) => ({ type: "text", name, ...extra });
const zahl = (name) => ({ type: "number", name });
const json = (name) => ({ type: "json", name, maxSize: 5000000 });
const zeit = [
  { type: "autodate", name: "created", onCreate: true, onUpdate: false },
  { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
];

// Regeln verweisen auf andere Collections (@collection.mitglieder/plaene): erst ALLE Collections
// ohne Regeln anlegen, dann die Regeln setzen (sonst «failed to load collection»).
const REGELN = {
  plaene: { listRule: MITGLIED, viewRule: MITGLIED, createRule: `${SUPER} || (@request.auth.produktionsleitung = true && (@request.body.besitzer:isset = false || @request.body.besitzer = @request.auth.id))`, updateRule: `${PLAN_AENDERN} && ${PLAN_FEST} && ${BESITZER_FEST}`, deleteRule: VERWALTEN },
  mitglieder: { listRule: MITGLIED, viewRule: MITGLIED, createRule: VERWALTEN, updateRule: `${VERWALTEN} && ${PLAN_FEST}`, deleteRule: VERWALTEN },
  einladungen: { listRule: VERWALTEN, viewRule: VERWALTEN, createRule: VERWALTEN, updateRule: `${VERWALTEN} && ${PLAN_FEST}`, deleteRule: VERWALTEN },
};
for (const name of ["ressourcen", "gewerke", "vorgaenge", "phasen", "verknuepfungen"]) {
  REGELN[name] = { listRule: MITGLIED, viewRule: MITGLIED, createRule: SCHREIBEN, updateRule: `${SCHREIBEN} && ${PLAN_FEST}`, deleteRule: SCHREIBEN };
}

migrate((app) => {
  // --- users erweitern ---
  const users = app.findCollectionByNameOrId("users");
  if (!users.fields.getByName("name")) users.fields.add(new TextField({ name: "name" }));
  users.fields.add(new BoolField({ name: "superadmin" }));
  users.fields.add(new BoolField({ name: "produktionsleitung" }));
  users.createRule = null; // Konten nur über die Hook-Route
  users.listRule = "@request.auth.id != ''";
  users.viewRule = "@request.auth.id != ''";
  // Eigenes Konto oder Superadmin; die Flags (superadmin/produktionsleitung: nur Superadmin) und
  // die E-Mail (niemand) schützt der Hook (main.pb.js) mit 403 und Klartext
  users.updateRule = "id = @request.auth.id || @request.auth.superadmin = true";
  users.deleteRule = null;
  app.save(users);

  // --- plaene ---
  const plaene = new Collection({
    type: "base", name: "plaene",
    fields: [text("plan_id", { required: true }), text("besitzer"), json("daten"), zahl("rev"), ...zeit],
    indexes: ["CREATE UNIQUE INDEX idx_plaene_plan_id ON plaene (plan_id)"],
  });
  app.save(plaene);

  // --- mitglieder ---
  const mitglieder = new Collection({
    type: "base", name: "mitglieder",
    fields: [
      text("plan_id", { required: true }), text("user_id", { required: true }),
      { type: "select", name: "rolle", required: true, maxSelect: 1, values: ["produktionsleitung", "bearbeiter", "gewerkeleiter", "betrachter"] },
      json("gewerke"), ...zeit,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_mitglieder_plan_user ON mitglieder (plan_id, user_id)"],
  });
  app.save(mitglieder);

  // --- einladungen (Token geheim: nur Verwalter sehen sie; Annehmen läuft über den Hook) ---
  const einladungen = new Collection({
    type: "base", name: "einladungen",
    fields: [
      text("plan_id", { required: true }), text("email", { required: true }),
      { type: "select", name: "rolle", required: true, maxSelect: 1, values: ["produktionsleitung", "bearbeiter", "gewerkeleiter", "betrachter"] },
      json("gewerke"), text("token", { required: true }), { type: "date", name: "ablauf" }, ...zeit,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_einladungen_token ON einladungen (token)"],
  });
  app.save(einladungen);

  // --- Plan-Collections mit einheitlicher Datensatzform ---
  const extra = { vorgaenge: [text("gewerk")], verknuepfungen: [text("von"), text("nach")] };
  for (const name of ["ressourcen", "gewerke", "vorgaenge", "phasen", "verknuepfungen"]) {
    const c = new Collection({
      type: "base", name,
      fields: [text("plan_id", { required: true }), text("eid", { required: true }), json("daten"), zahl("rev"), zahl("pos"), ...(extra[name] || []), ...zeit],
      indexes: [`CREATE UNIQUE INDEX idx_${name}_plan_eid ON ${name} (plan_id, eid)`],
    });
    app.save(c);
  }

  // --- Regeln zuletzt (alle Collections existieren jetzt) ---
  for (const name of Object.keys(REGELN)) {
    const c = app.findCollectionByNameOrId(name);
    Object.assign(c, REGELN[name]);
    app.save(c);
  }

  // --- Batch (ein Befehl = eine Transaktion, Task 7) ---
  const s = app.settings();
  s.batch.enabled = true;
  s.batch.maxRequests = 2000;
  s.batch.timeout = 30;
  s.batch.maxBodySize = 0;
  app.save(s);
}, (app) => {
  for (const name of ["verknuepfungen", "phasen", "vorgaenge", "gewerke", "ressourcen", "einladungen", "mitglieder", "plaene"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) { /* schon weg */ }
  }
  const users = app.findCollectionByNameOrId("users");
  // «name» bleibt (kann PocketBase-Standardfeld sein)
  for (const f of ["superadmin", "produktionsleitung"]) users.fields.removeByName(f);
  app.save(users);
});
