// ── Speichern, Laden, Export ──────────────────────────────────────────────────
// Bis PocketBase steht, lebt alles im Browser. Das ist bequem, aber fragil:
// privater Modus, Verlauf löschen, anderer Rechner — und die Daten sind weg.
// Deshalb ist der JSON-Export hier kein Beiwerk, sondern die einzige Sicherung.
//
// Der Speicher wird hereingereicht (statt global localStorage zu greifen), damit
// die Logik ohne Browser testbar bleibt.

export const SCHEMA_VERSION = 1;

const K_INDEX = 'bzp_projects';
const K_ACTIVE = 'bzp_active';
const K_PLAN = (id) => 'bzp_p_' + id;

const clone = (o) => JSON.parse(JSON.stringify(o));

const readJSON = (storage, key, fallback) => {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;   // beschädigte Daten dürfen die App nicht töten
  }
};

// ── Migration ───────────────────────────────────────────────────────────────
// Läuft bei jedem Laden. Muss mehrfach anwendbar sein, ohne etwas kaputtzumachen.

export function migrate(plan) {
  const p = clone(plan);
  p.tasks ??= [];
  p.deps ??= [];
  p.gewerke ??= [];
  p.project ??= {};
  p.project.timezone ??= Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Der Farbplatz ist Identität und muss stabil sein — beim Umsortieren darf
  // sich nichts umfärben. Bestandsdaten bekommen ihn aus der Reihenfolge.
  p.gewerke.forEach((g, i) => { g.slot ??= i; g.sort ??= i; });

  for (const t of p.tasks) {
    t.milestone = !!t.milestone;
    t.progress ??= 0;
    t.status ??= 'geplant';
    t.crew ??= null;
    t.notes ??= '';
    // Dauer geschätzt, nicht aus der Quelle. Muss sichtbar sein — sonst weiß in
    // drei Wochen niemand mehr, welcher Balken eine Zahl aus dem Plan ist und
    // welcher eine Annahme.
    t.estimated = !!t.estimated;
  }
  for (const d of p.deps) {
    d.type ??= 'FS';
    d.lag ??= 0;
  }
  return p;
}

// ── Ablage ──────────────────────────────────────────────────────────────────

export function createRepo(storage) {
  const readIndex = () => {
    const idx = readJSON(storage, K_INDEX, []);
    return Array.isArray(idx) ? idx : [];
  };

  const writeIndex = (idx) => storage.setItem(K_INDEX, JSON.stringify(idx));

  return {
    list() {
      return readIndex().slice().sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
    },

    load(id) {
      const raw = readJSON(storage, K_PLAN(id), null);
      if (!raw || !raw.project) return null;
      return migrate(raw);
    },

    save(plan) {
      const id = plan.project.id;
      try {
        storage.setItem(K_PLAN(id), JSON.stringify(plan));
      } catch (e) {
        // Verschluckt man das, glaubt man gesichert zu haben — und verliert alles.
        const voll = e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || ''));
        return { ok: false, error: voll
          ? 'Der Browser-Speicher ist voll. Exportiere den Plan als JSON und lösche alte Projekte.'
          : 'Speichern fehlgeschlagen: ' + (e.message || e) };
      }
      const idx = readIndex().filter((x) => x.id !== id);
      idx.push({ id, name: plan.project.name, venue: plan.project.venue || '', modified: new Date().toISOString() });
      try { writeIndex(idx); } catch { /* Index ist nachrangig, der Plan liegt */ }
      return { ok: true };
    },

    remove(id) {
      storage.removeItem(K_PLAN(id));
      writeIndex(readIndex().filter((x) => x.id !== id));
      if (this.getActive() === id) storage.removeItem(K_ACTIVE);
    },

    getActive() { return storage.getItem(K_ACTIVE); },
    setActive(id) { storage.setItem(K_ACTIVE, id); },
  };
}

// ── Export / Import ─────────────────────────────────────────────────────────

export function serialize(plan) {
  return JSON.stringify({
    schema: SCHEMA_VERSION,
    exported: new Date().toISOString(),
    app: 'Bauzeitenplan',
    ...clone(plan),
  }, null, 2);
}

export function deserialize(text, { newId = false } = {}) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Das ist keine gültige JSON-Datei.' };
  }
  if (!j || typeof j !== 'object' || !j.project) {
    return { ok: false, error: 'Die Datei enthält keinen Bauzeitenplan.' };
  }
  if (Number(j.schema) > SCHEMA_VERSION) {
    return { ok: false, error: `Die Datei stammt aus einer neueren Version (Schema ${j.schema}, hier ${SCHEMA_VERSION}). Bitte die App aktualisieren.` };
  }
  const plan = migrate({ project: j.project, gewerke: j.gewerke, tasks: j.tasks, deps: j.deps });
  if (newId) plan.project.id = 'p' + Date.now().toString(36);
  return { ok: true, plan };
}
