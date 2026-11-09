import { describe, expect, test } from "bun:test";

import { deleteInvoiceMessage, deleteProspectMessage } from "./delete-messages";

describe("deleteProspectMessage", () => {
  test("factures et lignes connues", () => {
    expect(deleteProspectMessage(3, 120)).toBe(
      "3 factures et 120 lignes seront supprimées. Cette action est définitive.",
    );
  });

  test("singulier", () => {
    expect(deleteProspectMessage(1, 1)).toBe(
      "1 facture et 1 ligne seront supprimées. Cette action est définitive.",
    );
  });

  test("comptage des lignes indisponible : phrase exacte sans le nombre", () => {
    expect(deleteProspectMessage(4, null)).toBe(
      "4 factures et leurs lignes seront supprimées. Cette action est définitive.",
    );
    expect(deleteProspectMessage(1, null)).toBe(
      "1 facture et ses lignes seront supprimées. Cette action est définitive.",
    );
  });

  test("comparatif vide", () => {
    expect(deleteProspectMessage(0, 0)).toBe(
      "Ce comparatif ne contient aucune facture. Cette action est définitive.",
    );
    expect(deleteProspectMessage(0, null)).toBe(
      "Ce comparatif ne contient aucune facture. Cette action est définitive.",
    );
  });

  test("factures sans ligne : 0 ligne annoncée honnêtement", () => {
    expect(deleteProspectMessage(2, 0)).toBe(
      "2 factures et 0 ligne seront supprimées. Cette action est définitive.",
    );
  });

  test("aucun tiret cadratin", () => {
    expect(deleteProspectMessage(3, 5)).not.toContain("—");
    expect(deleteInvoiceMessage("Metro", 5)).not.toContain("—");
  });
});

describe("deleteInvoiceMessage", () => {
  test("nomme la facture, ses lignes et le fichier d'origine", () => {
    expect(deleteInvoiceMessage("Metro", 12)).toBe(
      "La facture « Metro » (12 lignes) sera supprimée, ainsi que son fichier d'origine. Cette action est définitive.",
    );
  });

  test("une seule ligne", () => {
    expect(deleteInvoiceMessage("scan.pdf", 1)).toContain("(1 ligne)");
  });

  test("nombre de lignes inconnu : omis", () => {
    expect(deleteInvoiceMessage("Metro", null)).toBe(
      "La facture « Metro » sera supprimée, ainsi que son fichier d'origine. Cette action est définitive.",
    );
  });
});
