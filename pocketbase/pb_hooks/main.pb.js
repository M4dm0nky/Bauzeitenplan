/// <reference path="../pb_data/types.d.ts" />
// Server-Logik der Online-Fassung (Plan Teil 2, Task 3). Regeln (Migration) sind die erste
// Schranke, der Hook prüft das Feine. Fehlerlogs stehen in `_logs` (auxiliary.db).
// Jeder Handler lädt seine Hilfen selbst (Handler sehen keine Top-Level-Funktionen).

const PLAN_COLLS = ["plaene", "gewerke", "vorgaenge", "phasen", "verknuepfungen", "ressourcen"];

// ── Plan-Collections: rev, Rollen, Gewerkeleiter, Bedarfsstatus, Konsistenz ──
onRecordCreateRequest((e) => {
  require(`${__hooks}/hilfen.js`).pruefe(e, e.collection.name, "create");
  e.next();
}, ...PLAN_COLLS);

onRecordUpdateRequest((e) => {
  require(`${__hooks}/hilfen.js`).pruefe(e, e.collection.name, "update");
  e.next();
}, ...PLAN_COLLS);

onRecordDeleteRequest((e) => {
  require(`${__hooks}/hilfen.js`).pruefe(e, e.collection.name, "delete");
  e.next();
}, ...PLAN_COLLS);

// ── users: Flags nur Superadmin, E-Mail nie über die API ────────────────────
onRecordUpdateRequest((e) => {
  if (!e.hasSuperuserAuth()) {
    const alt = e.record.original();
    const super_ = e.auth && e.auth.getBool("superadmin");
    for (const f of ["superadmin", "produktionsleitung"]) {
      if (e.record.getBool(f) !== alt.getBool(f) && !super_) throw new ForbiddenError("Nur der Superadmin darf diese Berechtigung ändern.");
    }
    if (e.record.getString("email") !== alt.getString("email")) throw new ForbiddenError("Die E-Mail-Adresse lässt sich nicht ändern.");
  }
  e.next();
}, "users");

// ── Einladung anlegen ───────────────────────────────────────────────────────
onRecordCreateRequest((e) => {
  const h = require(`${__hooks}/hilfen.js`);
  if (!e.hasSuperuserAuth()) {
    const r = h.rolle(e.app, e.record.getString("plan_id"), e.auth);
    if (!r || h.LEITUNG.indexOf(r.rolle) < 0) throw new ForbiddenError("Nur die Produktionsleitung darf einladen.");
  }
  const email = e.record.getString("email").trim().toLowerCase();
  e.record.set("email", email);
  const planId = e.record.getString("plan_id");
  let konto = null;
  try { konto = e.app.findAuthRecordByEmail("users", email); } catch (_) { konto = null; }
  if (!konto) { // Vergleich ohne Rücksicht auf Groß/Klein (ältere Konten)
    konto = h.finde(e.app, "users", "email = {:m}", { m: email });
  }
  if (konto) {
    if (h.finde(e.app, "mitglieder", "plan_id = {:p} && user_id = {:u}", { p: planId, u: konto.id }))
      throw new BadRequestError("Dieses Konto ist schon Mitglied im Plan.");
    const m = new Record(e.app.findCollectionByNameOrId("mitglieder"));
    m.set("plan_id", planId);
    m.set("user_id", konto.id);
    m.set("rolle", e.record.getString("rolle"));
    m.set("gewerke", e.record.get("gewerke"));
    e.app.save(m);
    return e.json(200, { direkt: true });
  }
  const token = $security.randomString(32);
  e.record.set("token", token);
  e.record.set("ablauf", new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().replace("T", " "));
  e.app.save(e.record);
  const s = e.app.settings();
  const link = (s.meta.appURL || "").replace(/\/$/, "") + "/login.html?einladung=" + token;
  let mail = false;
  if (s.smtp.enabled) {
    try {
      e.app.newMailClient().send(new MailerMessage({
        from: { address: s.meta.senderAddress, name: s.meta.senderName },
        to: [{ address: email }],
        subject: "Einladung zum Bauzeitenplan",
        html: "<p>Du wurdest zu einem Bauzeitenplan eingeladen.</p><p><a href=\"" + link + "\">Einladung annehmen</a> (14 Tage gültig)</p>",
      }));
      mail = true;
    } catch (err) { e.app.logger().error("Einladungsmail fehlgeschlagen", "error", String(err)); }
  }
  return e.json(200, { link: link, id: e.record.id, token: token, mail: mail });
}, "einladungen");

// ── Einladung annehmen ──────────────────────────────────────────────────────
routerAdd("POST", "/api/bzp/einladung", (e) => {
  const h = require(`${__hooks}/hilfen.js`);
  const body = e.requestInfo().body || {};
  const token = String(body.token || "");
  const inv = token.length === 32 ? h.finde($app, "einladungen", "token = {:t}", { t: token }) : null;
  if (!inv) throw new BadRequestError("Einladung unbekannt oder schon verwendet.");
  const ablauf = new Date(inv.getString("ablauf").replace(" ", "T"));
  if (isNaN(ablauf.getTime()) || ablauf.getTime() < Date.now()) throw new BadRequestError("Einladung abgelaufen.");
  const email = inv.getString("email").toLowerCase();
  const planId = inv.getString("plan_id");
  let userId = null;
  if (e.auth && e.auth.collection().name === "users") {
    if (e.auth.getString("email").toLowerCase() !== email) throw new ForbiddenError("Die Einladung gilt für eine andere E-Mail-Adresse.");
    userId = e.auth.id;
  } else {
    const name = String(body.name || "").trim();
    const pw = String(body.passwort || "");
    if (!name) throw new BadRequestError("Bitte einen Namen angeben.");
    if (pw.length < 10) throw new BadRequestError("Das Passwort braucht mindestens 10 Zeichen.");
    if (h.finde($app, "users", "email = {:m}", { m: email })) throw new BadRequestError("Für diese Adresse gibt es schon ein Konto, bitte erst anmelden.");
  }
  $app.runInTransaction((tx) => {
    if (!userId) {
      const u = new Record(tx.findCollectionByNameOrId("users"));
      u.set("email", email);
      u.set("name", String(body.name).trim());
      u.setPassword(String(body.passwort));
      u.set("verified", true);
      tx.save(u);
      userId = u.id;
    }
    if (h.finde(tx, "mitglieder", "plan_id = {:p} && user_id = {:u}", { p: planId, u: userId })) throw new BadRequestError("Schon Mitglied im Plan.");
    const m = new Record(tx.findCollectionByNameOrId("mitglieder"));
    m.set("plan_id", planId);
    m.set("user_id", userId);
    m.set("rolle", inv.getString("rolle"));
    m.set("gewerke", inv.get("gewerke"));
    tx.save(m);
    tx.delete(tx.findRecordById("einladungen", inv.id));
  });
  return e.json(200, { ok: true, plan_id: planId, rolle: inv.getString("rolle") });
});
