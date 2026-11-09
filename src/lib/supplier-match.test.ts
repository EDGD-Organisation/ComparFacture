import { describe, expect, test } from "bun:test";

import { resolveByReference, sameSupplier, supplierKey } from "./supplier-match";

describe("supplierKey", () => {
  test("retire accents, casse, ponctuation et mots génériques", () => {
    expect(supplierKey("SYSCO FRANCE SAS")).toBe("sysco");
    expect(supplierKey("POMONA PASSION FROID")).toBe("passionfroid");
    expect(supplierKey("SOCIÉTÉ INDUSTRIELLE RAISON FRÈRES")).toBe("raisonfreres");
  });

  test("renvoie une chaîne vide pour null, vide ou uniquement générique", () => {
    expect(supplierKey(null)).toBe("");
    expect(supplierKey(undefined)).toBe("");
    expect(supplierKey("   ")).toBe("");
    expect(supplierKey("France SAS")).toBe("");
  });
});

describe("sameSupplier", () => {
  test("accepte les écarts de nom réellement observés entre facture et catalogue ERP", () => {
    expect(sameSupplier("SYSCO FRANCE SAS", "SYSCO")).toBe(true);
    expect(sameSupplier("Sysco France", "SYSCO")).toBe(true);
    expect(sameSupplier("PassionFroid", "POMONA PASSION FROID")).toBe(true);
    expect(sameSupplier("EpiSaveurs", "POMONA EPISAVEURS")).toBe(true);
    expect(sameSupplier("EPISAVEURS CENTRE", "POMONA EPISAVEURS")).toBe(true);
    expect(sameSupplier("Transgourmet France", "TRANSGOURMET")).toBe(true);
  });

  test("reste vrai quand les noms sont déjà identiques", () => {
    expect(sameSupplier("PRO A PRO", "PRO A PRO")).toBe(true);
  });

  test("refuse des fournisseurs différents partageant des références", () => {
    expect(sameSupplier("SYSCO France", "FRANCE FRAIS")).toBe(false);
    expect(sameSupplier("PassionFroid", "POMONA TERRE AZUR")).toBe(false);
    expect(sameSupplier("POMONA EPISAVEURS", "POMONA PASSION FROID")).toBe(false);
  });

  test("le préfixe exige au moins 5 caractères", () => {
    expect(sameSupplier("Metro", "Metro Cash")).toBe(true);
    expect(sameSupplier("Brake", "Brakes")).toBe(true);
    expect(sameSupplier("Ets AB", "ABC Distribution")).toBe(false);
    expect(sameSupplier("Aldi", "Aldi Nord")).toBe(false);
  });

  test("refuse null, vide et nom uniquement générique", () => {
    expect(sameSupplier(null, "SYSCO")).toBe(false);
    expect(sameSupplier("SYSCO", undefined)).toBe(false);
    expect(sameSupplier("", "")).toBe(false);
    expect(sameSupplier("France SAS", "France SAS")).toBe(false);
  });
});

describe("resolveByReference", () => {
  const sysco = (id: string, label: string) => ({ id, supplier_name: "SYSCO", label });

  test("un seul candidat compatible dont le libellé recoupe : accepté", () => {
    const found = resolveByReference(
      [sysco("a", "Oignons cubes 2,5Kg")],
      "SYSCO FRANCE SAS",
      "Oignons cubes 2,5Kg",
    );
    expect(found?.id).toBe("a");
  });

  test("aucun candidat chez le même fournisseur : pas de repli sur un autre fournisseur", () => {
    const other = { id: "x", supplier_name: "FRANCE FRAIS", label: "Oignons cubes 2,5Kg" };
    expect(resolveByReference([other], "SYSCO", "Oignons cubes 2,5Kg")).toBeNull();
    expect(resolveByReference([], "SYSCO", "Oignons cubes 2,5Kg")).toBeNull();
  });

  test("plusieurs candidats : le meilleur libellé gagne seulement s'il est strictement meilleur", () => {
    const pair = [sysco("chaource", "Chaource AOP 250g"), sysco("epoisse", "Epoisse BIO 250g")];
    expect(resolveByReference(pair, "SYSCO", "Chaource AOP 250g")?.id).toBe("chaource");
    expect(resolveByReference(pair, "SYSCO", "Epoisse BIO 250g")?.id).toBe("epoisse");
    expect(resolveByReference(pair, "SYSCO", "Fromage 250g")).toBeNull();
  });

  test("libellé sans aucun mot commun : null (référence probablement mal lue)", () => {
    expect(
      resolveByReference([sysco("a", "Pâtes Farfalle 5Kg")], "SYSCO", "Polenta fine 1K"),
    ).toBeNull();
  });

  test("ignore les candidats d'un autre fournisseur pour départager", () => {
    const list = [
      { id: "ff", supplier_name: "FRANCE FRAIS", label: "Oignons cubes 2,5Kg" },
      sysco("sy", "Oignons rouges"),
    ];
    expect(resolveByReference(list, "SYSCO", "Oignons cubes 2,5Kg")?.id).toBe("sy");
  });
});
