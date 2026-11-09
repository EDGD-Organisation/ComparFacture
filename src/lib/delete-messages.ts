const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

/**
 * Phrase de confirmation de la suppression d'un comparatif. `lineCount` null : comptage indisponible
 * (en cours ou en échec), la phrase reste exacte sans le nombre de lignes.
 */
export function deleteProspectMessage(invoiceCount: number, lineCount: number | null): string {
  if (invoiceCount === 0 && !lineCount) {
    return "Ce comparatif ne contient aucune facture. Cette action est définitive.";
  }
  const content =
    lineCount === null
      ? `${plural(invoiceCount, "facture", "factures")} et ${invoiceCount > 1 ? "leurs" : "ses"} lignes`
      : `${plural(invoiceCount, "facture", "factures")} et ${plural(lineCount, "ligne", "lignes")}`;
  return `${content} seront supprimées. Cette action est définitive.`;
}

/** Phrase de confirmation de la suppression d'une facture ; le fichier d'origine part aussi. */
export function deleteInvoiceMessage(name: string, lineCount: number | null): string {
  const lines = lineCount === null ? "" : ` (${plural(lineCount, "ligne", "lignes")})`;
  return `La facture « ${name} »${lines} sera supprimée, ainsi que son fichier d'origine. Cette action est définitive.`;
}
