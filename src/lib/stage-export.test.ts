import { describe, expect, mock, test } from "bun:test";

import type { MatchingLine, MatchingProduct } from "./matching-view";
import type { OzegoBest, OzegoVariant } from "./ozego";
import type { OzegoData } from "./stage-rows";

mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));

const { buildStageExportRows, buildStageExportSummary, STAGE_EXPORT_FILE, STAGE_EXPORT_SHEET } =
  await import("./stage-export");
const { sumFournisseurGaps, sumOzegoGaps, sumPreferredGaps, sumReferencePrices } =
  await import("./stage-rows");

const product = (over: Partial<MatchingProduct> = {}): MatchingProduct => ({
  id: "p1",
  reference: "REF-1",
  label: "Échalote grise",
  price: 1.5,
  unit: "KG",
  ean: "123",
  family: "Légumes",
  currency: "EUR",
  ozego_id: "31.4.72.139",
  supplier_name: "Metro",
  ...over,
});

function line(
  id: string,
  over: Partial<Omit<MatchingLine, "id" | "catalog_products">> & {
    product?: MatchingProduct | null;
  } = {},
): MatchingLine {
  const { product: catalog = product(), ...rest } = over;
  return {
    id,
    invoice_id: "inv-a",
    line_number: 3,
    supplier_reference: "ABC",
    label: "ECHALOTE GRISE",
    quantity: 2,
    unit: "kg",
    unit_price: 12,
    discount_percent: 5,
    line_total: 24,
    match_status: "confirmed",
    match_score: 0.9,
    match_method: "référence",
    manual_override: false,
    pack_factor: 6,
    matched_product_id: catalog ? catalog.id : null,
    validated_stage: null,
    invoices: {
      id: "inv-a",
      supplier_name: "Transgourmet",
      file_name: "a.pdf",
      invoice_number: "A-1",
      invoice_date: "2026-10-01",
      currency: "EUR",
    },
    catalog_products: catalog,
    ...rest,
  };
}

const variant = (over: Partial<OzegoVariant>): OzegoVariant => ({
  ozego_id: "22.4.72.139",
  id: "v1",
  reference: "SYS-1",
  label: "Echalote Sysco",
  ean: "999",
  family: "Légumes",
  unit: "KG",
  price: 1.8,
  supplier_name: "Sysco",
  ...over,
});

const bestOffer: OzegoBest = { ...variant({}), variants_count: 3 };
const variants = [
  variant({ id: "v1", supplier_name: "Metro", price: 1.9, ozego_id: "18.4.72.139" }),
  variant({ id: "v2", supplier_name: "Sysco", price: 1.7 }),
];

const data = (preferredSuppliers: string[] = ["metro"]): OzegoData => ({
  bestByOzego: new Map([["31.4.72.139", bestOffer]]),
  variantsByOzego: new Map([["31.4.72.139", variants]]),
  preferredSuppliers,
});

const lines = (): MatchingLine[] => [
  line("cond6"),
  line("null-price", { unit_price: null }),
  line("no-product", { product: null, match_status: "unmatched" }),
  line("locked", { validated_stage: "fournisseur" }),
];

describe("buildStageExportRows : colonnes communes", () => {
  test("Désignation fournisseur, jamais « Libellé facture », avec la facture d'origine", () => {
    for (const stage of ["fournisseur", "ozego", "ozego-preferes"] as const) {
      const [row] = buildStageExportRows(stage, lines(), data(), 2);
      expect(row!["Désignation fournisseur"]).toBe("ECHALOTE GRISE");
      expect("Libellé facture" in row!).toBe(false);
      expect(row!["Facture (fichier)"]).toBe("a.pdf");
      expect(row!["N° facture"]).toBe("A-1");
      expect(row!["Fournisseur (facture)"]).toBe("Transgourmet");
      expect(row!["Coef. conditionnement"]).toBe(6);
      expect(row!["Qté ramenée à l'unité"]).toBe(12);
      expect(row!["PU comparable"]).toBe(2);
    }
  });

  test("une ligne par ligne d'entrée, filtrées ou non", () => {
    expect(buildStageExportRows("ozego", lines(), data(), 2)).toHaveLength(4);
    expect(buildStageExportRows("ozego", [], data(), 2)).toHaveLength(0);
  });

  test("ligne sans produit : colonnes vides, « non rapproché », sans écart", () => {
    const row = buildStageExportRows("fournisseur", lines(), data(), 2)[2]!;
    expect(row["Référence catalogue"]).toBe("");
    expect(row["PU catalogue"]).toBe("");
    expect(row["Écart total"]).toBe("");
    expect(row["Hors tolérance"]).toBe("");
    expect(row["Rapprochement"]).toBe("non rapproché");
    expect(row["Validation"]).toBe("Non validée");
  });

  test("prix facturé absent : PU comparable et écarts vides", () => {
    for (const stage of ["fournisseur", "ozego"] as const) {
      const row = buildStageExportRows(stage, lines(), data(), 2)[1]!;
      expect(row["PU comparable"]).toBe("");
      expect(row["Écart total"]).toBe("");
    }
  });

  test("ligne verrouillée par une étape antérieure : l'étape de validation est exportée", () => {
    const row = buildStageExportRows("ozego", lines(), data(), 2)[3]!;
    expect(row["Validation"]).toBe("Référence fournisseur");
  });
});

describe("buildStageExportRows : étape fournisseur", () => {
  test("cond. ×6 : mêmes nombres que le tableau (écart 0,5 par unité, 6 au total)", () => {
    const row = buildStageExportRows("fournisseur", lines(), data(), 2)[0]!;
    expect(row["PU catalogue"]).toBe(1.5);
    expect(row["Total au tarif catalogue"]).toBe(18);
    expect(row["Écart unitaire"]).toBe(0.5);
    expect(row["Écart total"]).toBe(6);
    expect(row["Écart %"] as number).toBeCloseTo(33.3333, 3);
    expect(row["Hors tolérance"]).toBe("oui");
    expect(row["Fournisseur catalogue"]).toBe("Metro");
    expect(row["Identifiant Ozego"]).toBe("31.4.72.139");
  });
});

describe("buildStageExportRows : étapes Ozego", () => {
  test("« Autres fournisseurs » : meilleure offre du groupe, identifiant complet de l'offre", () => {
    const row = buildStageExportRows("ozego", lines(), data(), 2)[0]!;
    expect(row["Références du groupe"]).toBe(3);
    expect(row["Référence la moins chère"]).toBe("SYS-1");
    expect(row["Identifiant Ozego de l'offre"]).toBe("22.4.72.139");
    expect(row["Fournisseur le moins cher"]).toBe("Sysco");
    expect(row["Meilleur PU Ozego"]).toBe(1.8);
    expect(row["Total au meilleur prix"] as number).toBeCloseTo(21.6, 10);
    expect(row["Écart total"] as number).toBeCloseTo(2.4, 10);
    expect(row["Hors tolérance"]).toBe("oui");
  });

  test("« Fournisseurs préférés » : offre du fournisseur préféré, libellés adaptés, sans nombre de références", () => {
    const row = buildStageExportRows("ozego-preferes", lines(), data(["metro"]), 2)[0]!;
    expect("Références du groupe" in row).toBe(false);
    expect(row["Fournisseur préféré"]).toBe("Metro");
    expect(row["Référence fournisseur préféré"]).toBe("SYS-1");
    expect(row["Identifiant Ozego de l'offre"]).toBe("18.4.72.139");
    expect(row["PU fournisseur préféré"]).toBe(1.9);
    expect(row["Écart total"] as number).toBeCloseTo(1.2, 10);
  });

  test("aucun fournisseur préféré ne propose le produit : colonnes d'offre vides", () => {
    const row = buildStageExportRows("ozego-preferes", lines(), data(["Inconnu"]), 2)[0]!;
    expect(row["Fournisseur préféré"]).toBe("");
    expect(row["PU fournisseur préféré"]).toBe("");
    expect(row["Écart total"]).toBe("");
    expect(row["Hors tolérance"]).toBe("");
  });

  test("aucun fournisseur préféré défini : moins cher de tous, comme la page facture", () => {
    const row = buildStageExportRows("ozego-preferes", lines(), data([]), 2)[0]!;
    expect(row["Fournisseur préféré"]).toBe("Sysco");
    expect(row["PU fournisseur préféré"]).toBe(1.7);
  });

  test("ligne sans produit : pas d'identifiant ni d'offre", () => {
    const row = buildStageExportRows("ozego", lines(), data(), 2)[2]!;
    expect(row["Identifiant Ozego"]).toBe("");
    expect(row["Référence la moins chère"]).toBe("");
    expect(row["Écart total"]).toBe("");
  });
});

describe("buildStageExportSummary : totaux alignés sur les sommes de la page facture", () => {
  const value = (summary: Array<Array<string | number>>, label: string) =>
    summary.find((entry) => entry[0] === label)?.[1];

  test("fournisseur", () => {
    const summary = buildStageExportSummary("fournisseur", lines(), data(), 2);
    const totals = sumFournisseurGaps(lines(), 2);
    const prices = sumReferencePrices(lines(), data().bestByOzego);
    expect(value(summary, "Écart total")).toBe(totals.total);
    expect(value(summary, "Lignes hors tolérance")).toBe(totals.anomalies);
    expect(value(summary, "Lignes non rapprochées")).toBe(totals.unmatched);
    expect(value(summary, "Total facturé (lignes rapprochées)")).toBe(prices.invoicedTotal);
    expect(value(summary, "Total au tarif catalogue")).toBe(prices.catalogTotal);
    expect(value(summary, "Nombre de lignes")).toBe(4);
  });

  test("ozego", () => {
    const summary = buildStageExportSummary("ozego", lines(), data(), 2);
    const totals = sumOzegoGaps(lines(), data().bestByOzego, 2);
    const prices = sumReferencePrices(lines(), data().bestByOzego);
    expect(value(summary, "Écart total")).toBe(totals.total);
    expect(value(summary, "Lignes sans identifiant Ozego")).toBe(totals.unmatched);
    expect(value(summary, "Total au meilleur prix")).toBe(prices.bestTotal);
  });

  test("ozego-preferes", () => {
    const summary = buildStageExportSummary("ozego-preferes", lines(), data(), 2);
    const totals = sumPreferredGaps(lines(), data().variantsByOzego, ["metro"], 2);
    expect(value(summary, "Écart total")).toBe(totals.total);
    expect(value(summary, "Lignes sans offre préférée")).toBe(totals.unmatched);
    expect(value(summary, "Total au prix préféré")).toBe(totals.bestTotal);
  });
});

test("noms de feuille et de fichier par étape", () => {
  expect(STAGE_EXPORT_SHEET.ozego).toBe("Comparatif Ozego");
  expect(STAGE_EXPORT_FILE["ozego-preferes"]).toBe("comparatif-ozego-preferes");
});
