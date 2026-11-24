// Hilfen für main.pb.js. Wird IM Handler per require(`${__hooks}/hilfen.js`) geladen
// (Handler sehen keine Top-Level-Funktionen). Immer `e.app` benutzen, nie `$app`:
// im Batch ist e.app die Transaktion (angelegte Datensätze sind sofort sichtbar).

const PLAN_COLLECTIONS = ["plaene", "gewerke", "vorgaenge", "phasen", "verknuepfungen", "ressourcen"];
const LEITUNG = ["superadmin", "besitzer", "produktionsleitung"];

function json(rec, feld) {
  try { const s = rec.getString(feld); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}

function finde(app, coll, filter, params) {
  try { return app.findFirstRecordByFilter(coll, filter, params); } catch (_) { return null; }
}

// → {rolle: 'superadmin'|'besitzer'|'produktionsleitung'|'bearbeiter'|'gewerkeleiter'|'betrachter', gewerke: []} oder null
function rolle(app, planId, auth) {
  if (!auth) return null;
  if (auth.collection().name === "_superusers" || auth.getBool("superadmin")) return { rolle: "superadmin", gewerke: [] };
  const plan = finde(app, "plaene", "plan_id = {:p}", { p: planId });
  if (plan && plan.getString("besitzer") === auth.id) return { rolle: "besitzer", gewerke: [] };
  const m = finde(app, "mitglieder", "plan_id = {:p} && user_id = {:u}", { p: planId, u: auth.id });
  if (!m) return null;
  const g = json(m, "gewerke");
  return { rolle: m.getString("rolle"), gewerke: Array.isArray(g) ? g : [] };
}

function gewerkName(app, planId, eid) {
  const g = finde(app, "gewerke", "plan_id = {:p} && eid = {:e}", { p: planId, e: eid });
  const d = g ? json(g, "daten") : null;
  return (d && d.name) || eid;
}

function nurText(app, planId, gewerke) {
  if (!gewerke.length) return "Dir ist kein Gewerk zugeordnet, du darfst keine Vorgänge ändern.";
  return "Nur " + gewerke.map((x) => gewerkName(app, planId, x)).join(", ") + " darfst du ändern.";
}

// 409 wird GEWORFEN (nur ein Fehler rollt einen Batch zurück; eine fertige e.json(409)-Antwort
// zählt im Batch als Erfolg). PocketBase verpackt die Werte von ApiError.data als
// Validierungsfehler {code, message} und verändert die message (Großbuchstabe, Punkt); die Daten
// stehen darum unverändert im `code`:
//   data.code.code === 'rev' · data.eid.code = eid · data.rev.code = aktueller rev (als Text)
function fehler409(eid, rev) {
  return new ApiError(409, "Der Eintrag wurde inzwischen geändert (rev " + rev + ").", {
    code: new ValidationError("rev", "Konflikt"),
    eid: new ValidationError(String(eid), "eid"),
    rev: new ValidationError(String(rev), "rev"),
  });
}

// ── Bedarfsstatus ──────────────────────────────────────────────────────────
// Echte Datenform: daten.res = [{rid, n, von, bis, status?, notiz?, bestaetigtAm?}], «status fehlt» = angefragt.
// Nur Leitung darf bestaetigt/abgelehnt setzen oder notiz/bestaetigtAm ändern.
// Rückfall (alle drei Felder weg) darf jeder Schreibberechtigte.
function statusFelder(z) {
  z = z || {};
  return { status: z.status && z.status !== "angefragt" ? z.status : "", notiz: z.notiz || "", am: z.bestaetigtAm || "" };
}
function statusGeaendert(altRes, neuRes) {
  altRes = Array.isArray(altRes) ? altRes : [];
  neuRes = Array.isArray(neuRes) ? neuRes : [];
  for (let i = 0; i < neuRes.length; i++) {
    const n = neuRes[i] || {};
    // Zuordnung: gleicher Index mit gleicher rid, sonst erste Zeile mit gleicher rid
    let a = altRes[i] && altRes[i].rid === n.rid ? altRes[i] : altRes.find((x) => x && x.rid === n.rid);
    const sa = statusFelder(a), sn = statusFelder(n);
    if (sa.status === sn.status && sa.notiz === sn.notiz && sa.am === sn.am) continue;
    if (!sn.status && !sn.notiz && !sn.am) continue; // Rückfall auf angefragt
    return true;
  }
  return false;
}

// ── Prüfungen je Aktion; werfen Fehler (403/400/409), verändern e.record (rev) ──────────────
function pruefe(e, coll, aktion) {
  const app = e.app;
  if (e.hasSuperuserAuth()) return; // Wartung per Superuser: Regeln und Hook ausgenommen
  const rec = e.record;
  const alt = aktion === "create" ? null : rec.original();
  const planId = (alt || rec).getString("plan_id");
  const eidVon = (r) => (coll === "plaene" ? r.getString("plan_id") : r.getString("eid"));

  // plaene anlegen: Besitzer immer der Anlegende; Rechte prüft die createRule
  if (coll === "plaene" && aktion === "create") {
    rec.set("besitzer", e.auth.id);
    rec.set("rev", 1);
    return;
  }

  const r = rolle(app, planId, e.auth);
  if (!r || r.rolle === "betrachter") throw new ForbiddenError("Keine Berechtigung für diesen Plan.");

  // rev
  if (aktion === "create") rec.set("rev", 1);
  else if (aktion === "update") {
    const body = e.requestInfo().body;
    if (body.rev === undefined || body.rev === null || body.rev === "") throw new BadRequestError("rev fehlt.");
    const aktuell = alt.getInt("rev");
    if (Number(body.rev) !== aktuell) throw fehler409(eidVon(alt), aktuell);
    if (coll !== "plaene" && rec.getString("eid") !== alt.getString("eid")) throw new BadRequestError("eid ist unveränderlich.");
    rec.set("rev", aktuell + 1);
  } else if (aktion === "delete") {
    const q = e.requestInfo().query.rev;
    const aktuell = rec.getInt("rev");
    if (q === undefined || Number(q) !== aktuell) throw fehler409(eidVon(rec), aktuell);
  }

  // Gewerkeleiter
  if (r.rolle === "gewerkeleiter") {
    const eigen = (g) => g !== "projekt" && r.gewerke.indexOf(g) >= 0;
    const verboten = () => new ForbiddenError(nurText(app, planId, r.gewerke));
    if (coll === "vorgaenge") {
      if (aktion !== "create" && !eigen(alt.getString("gewerk"))) throw verboten();
      if (aktion !== "delete" && !eigen(rec.getString("gewerk"))) throw verboten();
    } else if (coll === "verknuepfungen") {
      const eigenerNachfolger = (nach) => {
        const v = finde(app, "vorgaenge", "plan_id = {:p} && eid = {:e}", { p: planId, e: nach });
        return !!v && eigen(v.getString("gewerk"));
      };
      if (aktion !== "create" && !eigenerNachfolger(alt.getString("nach"))) throw verboten();
      if (aktion !== "delete" && !eigenerNachfolger(rec.getString("nach"))) throw verboten();
    } else if (coll === "ressourcen") {
      if (aktion !== "create") throw new ForbiddenError("Ressourcen darfst du nur anlegen, nicht ändern oder löschen.");
    } else {
      throw new ForbiddenError("Plan, Gewerke und Phasen darf nur die Produktion ändern.");
    }
  }

  // Bedarfsstatus
  if (coll === "vorgaenge" && aktion !== "delete" && LEITUNG.indexOf(r.rolle) < 0 && r.rolle !== "produktionsleitung") {
    const dNeu = json(rec, "daten") || {};
    const dAlt = alt ? json(alt, "daten") || {} : {};
    if (statusGeaendert(dAlt.res, dNeu.res)) throw new ForbiddenError("Bedarf bestätigen oder ablehnen darf nur die Produktionsleitung.");
  }

  // Konsistenz
  if (aktion !== "delete") {
    if (coll === "vorgaenge") {
      const g = rec.getString("gewerk");
      if (g !== "projekt" && !finde(app, "gewerke", "plan_id = {:p} && eid = {:e}", { p: planId, e: g }))
        throw new BadRequestError("Unbekanntes Gewerk: " + g);
    } else if (coll === "verknuepfungen") {
      for (const f of ["von", "nach"]) {
        if (!finde(app, "vorgaenge", "plan_id = {:p} && eid = {:e}", { p: planId, e: rec.getString(f) }))
          throw new BadRequestError("Vorgang für Verknüpfung (" + f + ") existiert nicht: " + rec.getString(f));
      }
    }
  }
}

module.exports = { PLAN_COLLECTIONS, LEITUNG, json, finde, rolle, pruefe, gewerkName };
