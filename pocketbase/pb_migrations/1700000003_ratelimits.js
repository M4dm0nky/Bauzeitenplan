/// <reference path="../pb_data/types.d.ts" />
// Rate Limits (Task 10b): Die Standardregel `*:create` (20 je 5 s) zählt auch jede Unteranfrage eines Batches.
// Ein ganzer Plan geht als EIN Batch (bis MAX_BATCH = 2000 Anfragen) und scheiterte schon bei 21 Einträgen.
// Diese Migration hebt NUR die Regel `*:create` auf 2000 je 5 s (legt sie an, falls sie fehlt). Sie fasst weder
// `rateLimits.enabled` noch die anderen Regeln an (`*:auth`, `/api/batch`, `/api/`) und ist idempotent.
migrate((app) => {
  const settings = app.settings();
  const regeln = settings.rateLimits.rules || [];
  let gefunden = false;
  for (const r of regeln) {
    if (r.label === "*:create") {
      r.maxRequests = 2000;
      r.duration = 5;
      gefunden = true;
    }
  }
  if (!gefunden) {
    regeln.push({ label: "*:create", audience: "", duration: 5, maxRequests: 2000 });
    settings.rateLimits.rules = regeln;
  }
  app.save(settings);
}, (app) => {
  // Zurück auf die PocketBase-Vorgabe (20 je 5 s) nur, wenn die Regel noch auf dem angehobenen Wert steht.
  const settings = app.settings();
  for (const r of settings.rateLimits.rules || []) {
    if (r.label === "*:create" && r.maxRequests === 2000) r.maxRequests = 20;
  }
  app.save(settings);
});
