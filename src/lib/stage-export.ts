import { lineGap } from "./format";
import { stageLabel, type Stage } from "./line-actions";
import { methodLabel, supplierLabel, type MatchingLine } from "./matching-view";
import { ozegoGap } from "./ozego";
import { comparableUnitPrice, normalizePackFactor } from "./pack";
import {
  isOutOfTolerance,
  offerFor,
  sumFournisseurGaps,
  sumOzegoGaps,
  sumPreferredGaps,
  type OzegoData,
  type OzegoStage,
} from "./stage-rows";

type ExportRow = Record<string, string | number>;

export const STAGE_EXPORT_SHEET: Record<Stage, string> = {
  fournisseur: "Comparatif fournisseur",
  ozego: "Comparatif Ozego",
  "ozego-preferes": "Ozego préférés",
};

export const STAGE_EXPORT_FILE: Record<Stage, string> = {
  fournisseur: "comparatif-fournisseur",
  ozego: "comparatif-ozego",
  "ozego-preferes": "comparatif-ozego-preferes",
};

const OFFER_LABELS: Record<
  OzegoStage,
  { reference: string; supplier: string; price: string; total: string }
> = {
  ozego: {
    reference: "Référence la moins chère",
    supplier: "Fournisseur le moins cher",
    price: "Meilleur PU Ozego",
    total: "Total au meilleur prix",
  },
  "ozego-preferes": {
    reference: "Référence fournisseur préféré",
    supplier: "Fournisseur préféré",
    price: "PU fournisseur préféré",
    total: "Total au prix préféré",
  },
};

function invoiceColumns(line: MatchingLine): ExportRow {
  return {
    "Facture (fichier)": line.invoices?.file_name ?? "",
    "N° facture": line.invoices?.invoice_number ?? "",
    "Date facture": line.invoices?.invoice_date ?? "",
    "Fournisseur (facture)": supplierLabel(line),
    "N° ligne": line.line_number,
    "Référence fournisseur": line.supplier_reference ?? "",
    "Désignation fournisseur": line.label,
    Quantité: line.quantity,
    Unité: line.unit ?? "",
    "PU facturé": line.unit_price ?? "",
    "Remise %": line.discount_percent ?? "",
    "Total ligne facturé": line.line_total ?? (line.unit_price ?? 0) * line.quantity,
    "Coef. conditionnement": normalizePackFactor(line.pack_factor),
    "Qté ramenée à l'unité": line.quantity * normalizePackFactor(line.pack_factor),
    "PU comparable": comparableUnitPrice(line.unit_price, line.pack_factor) ?? "",
  };
}

function gapColumns(
  gap: { unitGap: number; totalGap: number; percentGap: number | null } | null,
  tolerance: number,
): ExportRow {
  return {
    "Écart unitaire": gap ? gap.unitGap : "",
    "Écart total": gap ? gap.totalGap : "",
    "Écart %": gap?.percentGap ?? "",
    "Hors tolérance": gap ? (isOutOfTolerance(gap, tolerance) ? "oui" : "non") : "",
  };
}

function matchColumns(line: MatchingLine): ExportRow {
  return {
    Rapprochement: line.catalog_products ? (line.match_status ?? "") : "non rapproché",
    Méthode: methodLabel(line),
    "Score de rapprochement": line.catalog_products ? (line.match_score ?? "") : "",
    Validation: stageLabel(line.validated_stage) ?? "Non validée",
    Devise: line.catalog_products?.currency ?? line.invoices?.currency ?? "EUR",
  };
}

function fournisseurRow(line: MatchingLine, tolerance: number): ExportRow {
  const product = line.catalog_products;
  const catalogPrice = product?.price ?? null;
  const gap = lineGap(line.unit_price, catalogPrice, line.quantity, line.pack_factor);
  return {
    ...invoiceColumns(line),
    "Référence catalogue": product?.reference ?? "",
    "Libellé catalogue": product?.label ?? "",
    "Fournisseur catalogue": product?.supplier_name ?? "",
    "Identifiant Ozego": product?.ozego_id ?? "",
    "EAN catalogue": product?.ean ?? "",
    "Famille catalogue": product?.family ?? "",
    "Unité catalogue": product?.unit ?? "",
    "PU catalogue": catalogPrice ?? "",
    "Total au tarif catalogue": gap ? (catalogPrice ?? 0) * line.quantity * gap.packFactor : "",
    ...gapColumns(gap, tolerance),
    ...matchColumns(line),
  };
}

function ozegoRow(
  stage: OzegoStage,
  line: MatchingLine,
  data: OzegoData,
  tolerance: number,
): ExportRow {
  const offer = offerFor(stage, line, data);
  const gap = ozegoGap(line, offer);
  const labels = OFFER_LABELS[stage];
  return {
    ...invoiceColumns(line),
    "Identifiant Ozego": line.catalog_products?.ozego_id ?? "",
    ...(stage === "ozego" ? { "Références du groupe": offer?.variants_count ?? "" } : {}),
    [labels.reference]: offer?.reference ?? "",
    "Identifiant Ozego de l'offre": offer?.ozego_id ?? "",
    "Libellé Ozego": offer?.label ?? "",
    [labels.supplier]: offer?.supplier_name ?? "",
    EAN: offer?.ean ?? "",
    Famille: offer?.family ?? "",
    "Unité Ozego": offer?.unit ?? "",
    [labels.price]: offer?.price ?? "",
    [labels.total]: gap ? (offer?.price ?? 0) * line.quantity * gap.packFactor : "",
    ...gapColumns(gap, tolerance),
    ...matchColumns(line),
  };
}

/** Lignes de l'export Excel de l'étape active : mêmes calculs que les tableaux de la page facture. */
export function buildStageExportRows(
  stage: Stage,
  lines: readonly MatchingLine[],
  data: OzegoData,
  tolerance: number,
): ExportRow[] {
  return lines.map((line) =>
    stage === "fournisseur"
      ? fournisseurRow(line, tolerance)
      : ozegoRow(stage, line, data, tolerance),
  );
}

function offerTotals(stage: OzegoStage, lines: readonly MatchingLine[], data: OzegoData) {
  let invoiced = 0;
  let reference = 0;
  for (const line of lines) {
    const offer = offerFor(stage, line, data);
    const gap = ozegoGap(line, offer);
    if (!gap) continue;
    invoiced += (line.unit_price ?? 0) * line.quantity;
    reference += (offer?.price ?? 0) * line.quantity * gap.packFactor;
  }
  return { invoiced, reference };
}

/** Bloc de totaux sous le tableau exporté (même contenu que les exports de la page facture). */
export function buildStageExportSummary(
  stage: Stage,
  lines: readonly MatchingLine[],
  data: OzegoData,
  tolerance: number,
): Array<Array<string | number>> {
  if (stage === "fournisseur") {
    const totals = sumFournisseurGaps(lines, tolerance);
    let invoiced = 0;
    let catalog = 0;
    for (const line of lines) {
      const price = line.catalog_products?.price ?? null;
      const gap = lineGap(line.unit_price, price, line.quantity, line.pack_factor);
      if (!gap) continue;
      invoiced += (line.unit_price ?? 0) * line.quantity;
      catalog += (price ?? 0) * line.quantity * gap.packFactor;
    }
    return [
      [],
      ["Total facturé (lignes rapprochées)", invoiced],
      ["Total au tarif catalogue", catalog],
      ["Écart total", totals.total],
      ["Lignes hors tolérance", totals.anomalies],
      ["Lignes non rapprochées", totals.unmatched],
      ["Nombre de lignes", lines.length],
    ];
  }
  const { invoiced, reference } = offerTotals(stage, lines, data);
  const totals =
    stage === "ozego"
      ? sumOzegoGaps(lines, data.bestByOzego, tolerance)
      : sumPreferredGaps(lines, data.variantsByOzego, data.preferredSuppliers, tolerance);
  return [
    [],
    ["Total facturé (lignes comparées)", invoiced],
    [OFFER_LABELS[stage].total, reference],
    ["Écart total", totals.total],
    ["Lignes hors tolérance", totals.anomalies],
    [
      stage === "ozego" ? "Lignes sans identifiant Ozego" : "Lignes sans offre préférée",
      totals.unmatched,
    ],
    ["Nombre de lignes", lines.length],
  ];
}
