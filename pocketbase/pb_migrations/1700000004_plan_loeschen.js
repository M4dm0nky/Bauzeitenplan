/// <reference path="../pb_data/types.d.ts" />
// Plan löschen: nur Besitzer oder Superadmin (Gesamtreview I4). Die Migration 1700000001 ließ es
// auch dem Mitglied «produktionsleitung» zu (deleteRule = VERWALTEN), obwohl UI und Doku es dem Besitzer
// vorbehalten: ein PL-Mitglied konnte so den ganzen Plan samt Kaskade löschen. Diese Migration setzt NUR
// `plaene.deleteRule` neu (Mitglieder verwalten bleibt bei VERWALTEN) und ist idempotent.
// Ausdrücke wie in 1700000001 (Korrelation: gleiche @collection ohne Alias = dieselbe Zeile).
const SUPER = "@request.auth.superadmin = true";
const BESITZER = "(@collection.plaene.plan_id ?= plan_id && @collection.plaene.besitzer ?= @request.auth.id)";
const NUR_BESITZER = `(@request.auth.id != '' && (${SUPER} || ${BESITZER}))`;
const VERWALTEN = `(@request.auth.id != '' && (${SUPER} || ${BESITZER} || ((@collection.mitglieder.plan_id ?= plan_id && @collection.mitglieder.user_id ?= @request.auth.id) && @collection.mitglieder.rolle ?= 'produktionsleitung')))`;

migrate((app) => {
  const plaene = app.findCollectionByNameOrId("plaene");
  plaene.deleteRule = NUR_BESITZER;
  app.save(plaene);
}, (app) => {
  const plaene = app.findCollectionByNameOrId("plaene");
  plaene.deleteRule = VERWALTEN;
  app.save(plaene);
});
