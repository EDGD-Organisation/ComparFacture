import { countToReview, type ReviewLine } from "./review-navigation";

type CountedLine = Pick<ReviewLine, "match_status" | "catalog_products"> & {
  catalog_products: { ozego_id: string | null } | null;
};

/** Ligne dont le produit rapproché porte un identifiant Ozego : seule éligible aux onglets Ozego. */
export function hasOzegoId(line: Pick<CountedLine, "catalog_products">): boolean {
  return Boolean(line.catalog_products?.ozego_id);
}

export type MatchingTabCounts = {
  general: number;
  fournisseur: number;
  ozego: number;
  "ozego-preferes": number;
};

/** Compteurs des quatre onglets de la vue projet, à partir des lignes déjà chargées (et filtrées). */
export function matchingTabCounts(lines: readonly CountedLine[]): MatchingTabCounts {
  const eligible = lines.filter(hasOzegoId).length;
  return {
    general: lines.length,
    fournisseur: countToReview(lines),
    ozego: eligible,
    "ozego-preferes": eligible,
  };
}

export type InvoiceModeCounts = {
  achat: number;
  recap: number;
  fournisseur: number;
  ozego: number;
  "ozego-preferes": number;
};

/** Compteurs des cinq modes de la page facture : à vérifier pour le comparatif fournisseur, total sinon. */
export function invoiceModeCounts(lines: readonly CountedLine[]): InvoiceModeCounts {
  return {
    achat: lines.length,
    recap: lines.length,
    fournisseur: countToReview(lines),
    ozego: lines.length,
    "ozego-preferes": lines.length,
  };
}
