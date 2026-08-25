// ── Rollen: wer darf was? ─────────────────────────────────────────────────────
// DOM-frei und rein — deshalb direkt testbar. Das ist die UI-Sperre; die
// EIGENTLICHE Durchsetzung steht in PocketBase (API-Rules + Hook). Hier geht es
// nur darum, gesperrte Felder gar nicht erst editierbar zu zeigen.
//
// session = { userId, email, role: 'admin'|'lead', scopes: [gewerk-gid, …] }
//   oder null  → localStorage-Modus: keine Einschränkung, alles editierbar
//                (die App verhält sich exakt wie ohne Benutzerverwaltung).

/** Darf diese Task überhaupt bearbeitet werden? */
export function canEditTask(session, task) {
  if (!session) return true;                 // kein Login → volle Freiheit (wie heute)
  if (session.role === 'admin') return true;
  if (session.role === 'lead') {
    if (!task || task.gewerk === 'projekt') return false;
    return (session.scopes || []).includes(task.gewerk);
  }
  return false;
}

/** Darf dieses eine Feld der Task bearbeitet werden? */
export function canEditField(session, task, field) {
  if (!session) return true;
  if (session.role === 'admin') return true;
  if (!canEditTask(session, task)) return false;
  // Ein Lead darf Zeiten/Status/Fortschritt/Notiz pflegen, aber die Task nicht
  // in ein anderes Gewerk umhängen (das erzwingt auch der Server-Hook).
  if (session.role === 'lead' && field === 'gewerk') return false;
  return true;
}

/** Darf die Struktur geändert werden (Gewerke, Verknüpfungen, Projekt-Metadaten)? */
export function canEditStructure(session) {
  if (!session) return true;
  return session.role === 'admin';
}
