import { describe, expect, test } from "bun:test";

import { hasOzegoId, invoiceModeCounts, matchingTabCounts } from "./tab-counts";

type L = {
  match_status: string | null;
  catalog_products: { ozego_id: string | null } | null;
};

const confirmed = (ozego: string | null): L => ({
  match_status: "confirmed",
  catalog_products: { ozego_id: ozego },
});
const review = (ozego: string | null): L => ({
  match_status: "review",
  catalog_products: { ozego_id: ozego },
});
const unmatched: L = { match_status: "unmatched", catalog_products: null };

describe("hasOzegoId", () => {
  test("produit avec identifiant : oui ; sans identifiant, vide ou sans produit : non", () => {
    expect(hasOzegoId(confirmed("31.4.72.139"))).toBe(true);
    expect(hasOzegoId(confirmed(null))).toBe(false);
    expect(hasOzegoId(confirmed(""))).toBe(false);
    expect(hasOzegoId(unmatched)).toBe(false);
  });
});

describe("matchingTabCounts", () => {
  test("aucune ligne : tout à zéro", () => {
    expect(matchingTabCounts([])).toEqual({
      general: 0,
      fournisseur: 0,
      ozego: 0,
      "ozego-preferes": 0,
    });
  });

  test("total, à vérifier (review + unmatched) et éligibles Ozego", () => {
    const lines = [
      confirmed("1.2.3"),
      confirmed(null),
      review("4.5.6"),
      review(null),
      unmatched,
      unmatched,
    ];
    expect(matchingTabCounts(lines)).toEqual({
      general: 6,
      fournisseur: 4,
      ozego: 2,
      "ozego-preferes": 2,
    });
  });

  test("les deux onglets Ozego comptent la même chose ; une ligne non rapprochée n'est jamais éligible", () => {
    const counts = matchingTabCounts([unmatched, review("1.2.3")]);
    expect(counts.ozego).toBe(1);
    expect(counts["ozego-preferes"]).toBe(counts.ozego);
  });

  test("compte la liste passée telle quelle (le filtrage est fait en amont)", () => {
    const all = [confirmed("1.2.3"), review("4.5.6"), unmatched];
    expect(matchingTabCounts(all.slice(0, 2)).general).toBe(2);
    expect(matchingTabCounts(all.slice(1)).fournisseur).toBe(2);
  });
});

describe("invoiceModeCounts", () => {
  test("à vérifier pour le comparatif fournisseur, total pour les autres modes", () => {
    const lines = [confirmed("1.2.3"), review("4.5.6"), unmatched];
    expect(invoiceModeCounts(lines)).toEqual({
      achat: 3,
      recap: 3,
      fournisseur: 2,
      ozego: 3,
      "ozego-preferes": 3,
    });
  });

  test("facture vide", () => {
    expect(invoiceModeCounts([])).toEqual({
      achat: 0,
      recap: 0,
      fournisseur: 0,
      ozego: 0,
      "ozego-preferes": 0,
    });
  });
});
