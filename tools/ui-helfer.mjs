// Gemeinsame Klickwege der Prüfskripte: EIN Ort, wenn sich die Bedienung ändert.
// Einrichten ist eine Seite (Bereiche 1–5), das Projektmenü hängt in der
// Kopfzeile.

/** Öffnet die Einrichten-Seite beim Bereich: projekt · phasen · baender · res · arten. */
export async function einrichten(page, bereich = 'projekt') {
  if (!(await page.locator('#ein-seite').isVisible())) {
    await page.locator('#rail-ein').click();
    await page.waitForTimeout(200);
  }
  await page.locator(`[data-ein="${bereich}"]`).click();
  await page.waitForTimeout(150);
}

/** «Zum Plan»: schließt die Einrichten-Seite (wenn offen). */
export async function zumPlan(page) {
  if (await page.locator('#ein-seite').isVisible()) {
    await page.locator('#ein-zu').click();
    await page.waitForTimeout(200);
  }
}

/**
 * Wählt einen Eintrag im Projektmenü der Kopfzeile:
 * `new-proj` · `proj-menu` · `import` · `export` · `abmelden`.
 * Die Kopfzeile ist hinter der Einrichten-Seite verborgen — also erst zum Plan.
 */
export async function projektMenue(page, id) {
  await zumPlan(page);
  await page.locator('#proj-knopf').click();
  await page.locator('.mn #' + id).click();
}
