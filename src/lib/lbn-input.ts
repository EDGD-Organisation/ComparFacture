import type { LbnInput, LbnLine, LbnProduct } from "./lbn-export";
import type { MatchingLine } from "./matching-view";
import { ozegoSimilarKey } from "./ozego-key";
import { normalizePackFactor } from "./pack";
import { offerFor, type OzegoData } from "./stage-rows";

type ProductSource = {
  reference: string;
  label: string;
  price: number | null;
  unit: string | null;
  supplier_name: string | null;
  family?: string | null;
  ozego_id: string | null;
};

function toProduct(source: ProductSource): LbnProduct {
  return {
    reference: source.reference,
    name: source.label,
    price: source.price,
    unit: source.unit,
    supplier: source.supplier_name,
    family: source.family ?? null,
    ozegoId: source.ozego_id,
    genericId: ozegoSimilarKey(source.ozego_id),
  };
}

/**
 * Données de l'export final : une ligne par ligne de facture, avec le produit rapproché (par
 * référence fournisseur) et la meilleure offre du groupe Ozego (`data.bestByOzego`, étape
 * « Ozego · Autres fournisseurs »).
 */
export function buildLbnInput(
  lines: readonly MatchingLine[],
  data: OzegoData,
  title: string,
  exportDate = new Date(),
): LbnInput {
  const rows: LbnLine[] = lines.map((line) => {
    const offer = offerFor("ozego", line, data);
    return {
      date: line.invoices?.invoice_date ?? null,
      supplier: line.invoices?.supplier_name || line.invoices?.file_name || "Fournisseur inconnu",
      label: line.label,
      reference: line.supplier_reference?.trim() ?? "",
      unit: line.unit ?? "",
      unitPrice: line.unit_price,
      quantity: line.quantity,
      packFactor: normalizePackFactor(line.pack_factor),
      product: line.catalog_products ? toProduct(line.catalog_products) : null,
      best: offer ? toProduct(offer) : null,
    };
  });
  return { title, lines: rows, exportDate };
}
