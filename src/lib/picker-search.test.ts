import { describe, expect, test } from "bun:test";

import { searchTokens, tokenFilter } from "./picker-search";

describe("searchTokens", () => {
  test("découpe une désignation de facture en mots", () => {
    expect(searchTokens("  ECHALOTE   GRISE 5KG ")).toEqual(["ECHALOTE", "GRISE", "5KG"]);
  });

  test("une recherche vide ou blanche ne donne aucun mot", () => {
    expect(searchTokens("")).toEqual([]);
    expect(searchTokens("   ")).toEqual([]);
  });

  test("retire les caractères qui casseraient la syntaxe du filtre or", () => {
    expect(searchTokens('POMME, GOLDEN (x6) "BIO" 50%')).toEqual([
      "POMME",
      "GOLDEN",
      "x6",
      "BIO",
      "50",
    ]);
    for (const token of searchTokens('a,b(c)d"e\\f%g*h')) {
      expect(/[,()"\\%*]/.test(token)).toBe(false);
    }
  });

  test("garde les points, tirets et chiffres des références", () => {
    expect(searchTokens("31.4.72.139 AB-12/C")).toEqual(["31.4.72.139", "AB-12/C"]);
  });

  test("limite le nombre de mots", () => {
    expect(searchTokens("a b c d e f g h i j k")).toHaveLength(8);
  });
});

describe("tokenFilter", () => {
  test("référence, libellé sans accent, EAN et fournisseur", () => {
    expect(tokenFilter("Échalote")).toBe(
      "reference.ilike.%Échalote%,label_unaccent.ilike.%Echalote%,ean.ilike.%Échalote%,supplier_name.ilike.%Échalote%",
    );
  });

  test("un code sans accent est inchangé", () => {
    expect(tokenFilter("31.4.72")).toBe(
      "reference.ilike.%31.4.72%,label_unaccent.ilike.%31.4.72%,ean.ilike.%31.4.72%,supplier_name.ilike.%31.4.72%",
    );
  });
});
