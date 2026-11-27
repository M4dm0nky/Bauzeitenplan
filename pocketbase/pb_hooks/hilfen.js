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
// Ohne Bestätigungsrecht (nur superadmin/besitzer/produktionsleitung dürfen) gilt: jede Zeile in neu, die
// bestaetigt/abgelehnt ist oder notiz/bestaetigtAm trägt, muss als VOLLSTÄNDIG identische Zeile
// (alle Felder, kanonisch verglichen) in alt vorkommen (Multimenge, Duplikate zählen). Damit sind
// «bestätigte Zeile ändern», «Duplikat einer bestätigten Zeile» und «neu bestätigen» gesperrt;
// der Rückfall (alle drei Felder weg) betrifft nur Zeilen ohne Status und bleibt frei.
function kanon(v) {
  if (Array.isArray(v)) return "[" + v.map(kanon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + kanon(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
function hatStatus(z) {
  z = z || {};
  return (z.status && z.status !== "angefragt") || !!z.notiz || !!z.bestaetigtAm;
}
// Eine Bestätigung gilt für bestimmte Zeiten: ändern sich start/end/milestone des Vorgangs (Vergleich über
// Zeitstempel wie toMin im Store, nicht über Zeichenketten), darf KEINE Zeile mehr status/notiz/bestaetigtAm tragen.
function zeitMs(v) {
  if (v === null || v === undefined || v === "") return null;
  const t = Date.parse(v);
  return isNaN(t) ? String(v) : t;
}
function zeitGleich(dAlt, dNeu) {
  return zeitMs(dAlt.start) === zeitMs(dNeu.start) && zeitMs(dAlt.end) === zeitMs(dNeu.end) && !!dAlt.milestone === !!dNeu.milestone;
}
function statusGeaendert(altRes, neuRes, zeitUnveraendert) {
  altRes = Array.isArray(altRes) ? altRes : [];
  neuRes = Array.isArray(neuRes) ? neuRes : [];
  if (!zeitUnveraendert) return neuRes.some(hatStatus);
  const vorrat = {};
  for (const z of altRes) { const k = kanon(z); vorrat[k] = (vorrat[k] || 0) + 1; }
  for (const z of neuRes) {
    if (!hatStatus(z)) continue;
    const k = kanon(z);
    if (!vorrat[k]) return true;
    vorrat[k]--;
  }
  return false;
}

// Spalten sind nur Index-Kopien: sie müssen mit `daten` übereinstimmen (sonst kann ein Client, der
// aus `daten` rekonstruiert, etwas anderes sehen als Regeln und Hook geprüft haben)
function spaltenStimmen(coll, rec) {
  const d = json(rec, "daten");
  if (!d || typeof d !== "object") return coll === "ressourcen" || coll === "phasen" ? true : "daten fehlt";
  const eid = rec.getString("eid");
  if (coll === "vorgaenge") {
    if (d.id !== eid) return "id";
    if (d.gewerk !== rec.getString("gewerk")) return "gewerk";
  } else if (coll === "verknuepfungen") {
    if (d.id !== eid) return "id";
    if (d.from !== rec.getString("von")) return "von";
    if (d.to !== rec.getString("nach")) return "nach";
  } else if (coll === "gewerke") {
    if (d.id !== eid) return "id";
  }
  return true;
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

  // Spalten = daten (alle Rollen, neu UND alt)
  for (const [r2, n] of aktion === "update" ? [[rec, "neu"], [alt, "alt"]] : [[rec, "neu"]]) {
    if (aktion === "delete") break;
    const st = spaltenStimmen(coll, r2);
    if (st !== true) throw new BadRequestError("Die Spalte «" + st + "» passt nicht zu den Daten (" + n + ").");
  }

  // Gewerkeleiter
  if (r.rolle === "gewerkeleiter") {
    const eigen = (g) => g !== "projekt" && r.gewerke.indexOf(g) >= 0;
    const verboten = () => new ForbiddenError(nurText(app, planId, r.gewerke));
    const gewerkeVon = (x) => [x.getString("gewerk"), (json(x, "daten") || {}).gewerk];
    if (coll === "vorgaenge") {
      if (aktion !== "create" && !gewerkeVon(alt).every(eigen)) throw verboten();
      if (aktion !== "delete" && !gewerkeVon(rec).every(eigen)) throw verboten();
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
    if (statusGeaendert(dAlt.res, dNeu.res, !alt || zeitGleich(dAlt, dNeu))) throw new ForbiddenError("Bedarf bestätigen darf nur die Produktionsleitung.");
  }

  // Löschen: nichts löschen, worauf noch etwas zeigt (der Client schickt es im selben Batch mit:
  // verknuepfungen → vorgaenge (Kinder vor Eltern) → gewerke/phasen/ressourcen)
  if (aktion === "delete") {
    const eid = rec.getString("eid");
    if (coll === "gewerke" && finde(app, "vorgaenge", "plan_id = {:p} && gewerk = {:g}", { p: planId, g: eid }))
      throw new BadRequestError("Das Gewerk hat noch Vorgänge.");
    if (coll === "ressourcen") {
      const alle = app.findRecordsByFilter("vorgaenge", "plan_id = {:p}", "", 0, 0, { p: planId });
      for (const v of alle) {
        const res = (json(v, "daten") || {}).res;
        if (Array.isArray(res) && res.some((z) => z && z.rid === eid)) throw new BadRequestError("Die Ressource wird noch von Vorgängen benutzt.");
      }
    }
    if (coll === "vorgaenge") {
      if (finde(app, "vorgaenge", "plan_id = {:p} && daten.parent = {:e}", { p: planId, e: eid }))
        throw new BadRequestError("Der Vorgang hat noch Untervorgänge.");
      if (finde(app, "verknuepfungen", "plan_id = {:p} && (von = {:e} || nach = {:e})", { p: planId, e: eid }))
        throw new BadRequestError("Auf den Vorgang zeigen noch Verknüpfungen.");
    }
  }

  // Konsistenz
  if (aktion !== "delete") {
    if (coll === "vorgaenge") {
      const g = rec.getString("gewerk");
      if (g !== "projekt" && !finde(app, "gewerke", "plan_id = {:p} && eid = {:e}", { p: planId, e: g }))
        throw new BadRequestError("Unbekanntes Gewerk: " + g);
      // Untervorgang: eine Ebene, gleiches Gewerk, Elternvorgang desselben Plans
      const d = json(rec, "daten") || {};
      if (d.parent !== undefined && d.parent !== null && d.parent !== "") {
        const eid = rec.getString("eid");
        const el = d.parent === eid ? null : finde(app, "vorgaenge", "plan_id = {:p} && eid = {:e}", { p: planId, e: String(d.parent) });
        if (!el) throw new BadRequestError("Der Elternvorgang existiert nicht.");
        const ed = json(el, "daten") || {};
        if (ed.parent !== undefined && ed.parent !== null && ed.parent !== "") throw new BadRequestError("Untervorgänge haben nur eine Ebene.");
        if (el.getString("gewerk") !== g) throw new BadRequestError("Ein Untervorgang liegt im Gewerk seines Elternvorgangs.");
        if (finde(app, "vorgaenge", "plan_id = {:p} && daten.parent = {:e}", { p: planId, e: eid }))
          throw new BadRequestError("Ein Vorgang mit Untervorgängen kann kein Untervorgang sein.");
      }
    } else if (coll === "verknuepfungen") {
      for (const f of ["von", "nach"]) {
        if (!finde(app, "vorgaenge", "plan_id = {:p} && eid = {:e}", { p: planId, e: rec.getString(f) }))
          throw new BadRequestError("Vorgang für Verknüpfung (" + f + ") existiert nicht: " + rec.getString(f));
      }
    }
  }
}

module.exports = { PLAN_COLLECTIONS, LEITUNG, json, finde, rolle, pruefe, gewerkName };
