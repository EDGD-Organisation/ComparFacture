import { gapTone, lineGap, type GapTone } from "./format";
import { isLineLocked, type Stage } from "./line-actions";
import { cheapestAmong, ozegoGap, type OzegoBest, type OzegoVariant } from "./ozego";
import { normalizePackFactor } from "./pack";

export type StageProduct = {
  reference: string;
  label: string;
  price: number | null;
  unit: string | null;
  supplier_name: string | null;
  ozego_id: string | null;
};

/** Le sous-ensemble d'une ligne de facture dont les trois comparatifs (page facture, vue projet) ont besoin. */
export type StageLine = {
  id: string;
  label: string;
  supplier_reference: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number | null;
  pack_factor: number | null;
  match_status: string;
  match_score: number | null;
  match_method: string | null;
  validated_stage: string | null;
  catalog_products: StageProduct | null;
};

export type OzegoStage = Exclude<Stage, "fournisseur">;

/** Offre de référence d'une étape Ozego : la moins chère du groupe, ou la moins chère des fournisseurs préférés. */
export type OzegoOffer = OzegoVariant & { variants_count?: number };

export type OzegoData = {
  bestByOzego: ReadonlyMap<string, OzegoBest>;
  variantsByOzego: ReadonlyMap<string, OzegoVariant[]>;
  preferredSuppliers: string[];
};

export type GapTotals = { total: number; anomalies: number; unmatched: number };

export function isOutOfTolerance(
  gap: { percentGap: number | null } | null | undefined,
  tolerance: number,
): boolean {
  return Boolean(gap) && Math.abs(gap!.percentGap ?? 0) > tolerance;
}

export type OutOfToleranceTone = GapTone;

/**
 * Teinte d'une ligne hors tolérance, selon la convention de `gapTone` : « gain » (vert) quand on
 * paie plus que la référence (économie possible), « loss » (rouge) quand on paie moins. `null`
 * dans la tolérance ou sans écart calculable.
 */
export function outOfToleranceTone(
  gap: { unitGap: number; percentGap: number | null } | null | undefined,
  tolerance: number,
): OutOfToleranceTone | null {
  if (!gap || !isOutOfTolerance(gap, tolerance)) return null;
  return gapTone(gap.unitGap);
}

export function ozegoIdsOf(lines: ReadonlyArray<Pick<StageLine, "catalog_products">>): string[] {
  return lines
    .map((line) => line.catalog_products?.ozego_id ?? null)
    .filter((value): value is string => Boolean(value));
}

export function bestRowFor(
  line: Pick<StageLine, "catalog_products">,
  bestByOzego: ReadonlyMap<string, OzegoBest>,
): OzegoOffer | undefined {
  const ozegoId = line.catalog_products?.ozego_id ?? null;
  return ozegoId ? bestByOzego.get(ozegoId) : undefined;
}

export function preferredRowFor(
  line: Pick<StageLine, "catalog_products">,
  variantsByOzego: ReadonlyMap<string, OzegoVariant[]>,
  preferredSuppliers: string[],
): OzegoOffer | undefined {
  const ozegoId = line.catalog_products?.ozego_id ?? null;
  const variants = ozegoId ? variantsByOzego.get(ozegoId) : undefined;
  return cheapestAmong(variants, preferredSuppliers);
}

export function offerFor(
  stage: OzegoStage,
  line: Pick<StageLine, "catalog_products">,
  data: OzegoData,
): OzegoOffer | undefined {
  return stage === "ozego"
    ? bestRowFor(line, data.bestByOzego)
    : preferredRowFor(line, data.variantsByOzego, data.preferredSuppliers);
}

export function fournisseurLineView(line: StageLine, tolerance: number) {
  const catalogPrice = line.catalog_products?.price ?? null;
  const gap = lineGap(line.unit_price, catalogPrice, line.quantity, line.pack_factor);
  return {
    catalogPrice,
    gap,
    out: isOutOfTolerance(gap, tolerance),
    tone: outOfToleranceTone(gap, tolerance),
    canConfirm: Boolean(line.catalog_products) && line.match_status !== "confirmed",
  };
}

export function ozegoLineView(
  line: StageLine,
  offer: OzegoOffer | undefined,
  tolerance: number,
  stage: Stage,
) {
  const gap = ozegoGap(line, offer);
  return {
    ozegoId: line.catalog_products?.ozego_id ?? null,
    gap,
    out: isOutOfTolerance(gap, tolerance),
    tone: outOfToleranceTone(gap, tolerance),
    locked: isLineLocked(line, stage),
  };
}

/** Écart total, lignes hors tolérance et lignes non rapprochées de l'étape « référence fournisseur ». */
export function sumFournisseurGaps(lines: readonly StageLine[], tolerance: number): GapTotals {
  return lines.reduce<GapTotals>(
    (acc, line) => {
      const gap = lineGap(
        line.unit_price,
        line.catalog_products?.price ?? null,
        line.quantity,
        line.pack_factor,
      );
      if (gap) {
        acc.total += gap.totalGap;
        if (Math.abs(gap.percentGap ?? 0) > tolerance) acc.anomalies += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { total: 0, anomalies: 0, unmatched: 0 },
  );
}

/**
 * Idem pour l'étape « Ozego · Autres fournisseurs » (meilleure offre du groupe).
 * `invoicedTotal` = total facturé des seules lignes comparées (celles que `total` additionne) :
 * `invoicedTotal - bestTotal` retombe ainsi sur `total`.
 */
export function sumOzegoGaps(
  lines: readonly StageLine[],
  bestByOzego: ReadonlyMap<string, OzegoBest>,
  tolerance: number,
): GapTotals & { invoicedTotal: number } {
  return lines.reduce<GapTotals & { invoicedTotal: number }>(
    (acc, line) => {
      const gap = ozegoGap(line, bestRowFor(line, bestByOzego));
      if (gap) {
        acc.total += gap.totalGap;
        acc.invoicedTotal += (line.unit_price ?? 0) * line.quantity;
        if (Math.abs(gap.percentGap ?? 0) > tolerance) acc.anomalies += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { total: 0, anomalies: 0, unmatched: 0, invoicedTotal: 0 },
  );
}

/** Idem pour l'étape « Ozego · Fournisseurs préférés », avec le total au prix de l'offre préférée. */
export function sumPreferredGaps(
  lines: readonly StageLine[],
  variantsByOzego: ReadonlyMap<string, OzegoVariant[]>,
  preferredSuppliers: string[],
  tolerance: number,
): GapTotals & { bestTotal: number; invoicedTotal: number } {
  return lines.reduce<GapTotals & { bestTotal: number; invoicedTotal: number }>(
    (acc, line) => {
      const row = preferredRowFor(line, variantsByOzego, preferredSuppliers);
      const gap = ozegoGap(line, row);
      if (gap) {
        acc.total += gap.totalGap;
        acc.invoicedTotal += (line.unit_price ?? 0) * line.quantity;
        acc.bestTotal += (row?.price ?? 0) * line.quantity * gap.packFactor;
        if (Math.abs(gap.percentGap ?? 0) > tolerance) acc.anomalies += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { total: 0, bestTotal: 0, invoicedTotal: 0, anomalies: 0, unmatched: 0 },
  );
}

/** Totaux facturé, au tarif catalogue et au meilleur prix Ozego, sur les lignes qui ont un écart. */
export function sumReferencePrices(
  lines: readonly StageLine[],
  bestByOzego: ReadonlyMap<string, OzegoBest>,
) {
  return lines.reduce(
    (acc, line) => {
      const catalogPrice = line.catalog_products?.price ?? null;
      const sup = lineGap(line.unit_price, catalogPrice, line.quantity, line.pack_factor);
      const k = sup?.packFactor ?? normalizePackFactor(line.pack_factor);
      if (sup) {
        acc.invoicedTotal += (line.unit_price ?? 0) * line.quantity;
        acc.catalogTotal += (catalogPrice ?? 0) * line.quantity * k;
      }
      const best = bestRowFor(line, bestByOzego);
      const oz = ozegoGap(line, best);
      if (oz) {
        acc.bestTotal += (best?.price ?? 0) * line.quantity * k;
      }
      return acc;
    },
    { invoicedTotal: 0, catalogTotal: 0, bestTotal: 0 },
  );
}

/** Libellés des tableaux des deux étapes Ozego, communs à la page facture et à la vue projet. */
export function ozegoTableLabels(stage: OzegoStage, preferredSuppliersCount: number) {
  return stage === "ozego"
    ? {
        cardTitle: "Meilleur prix par identifiant Ozego",
        referenceColumnLabel: "Référence la moins chère",
        unmatchedLabel: "Lignes sans identifiant Ozego",
        statLabel: "Écart vs meilleur prix Ozego",
      }
    : {
        cardTitle: "Meilleur prix chez vos fournisseurs préférés",
        referenceColumnLabel: "Référence fournisseur préféré",
        unmatchedLabel:
          preferredSuppliersCount === 0
            ? "Aucun fournisseur préféré défini"
            : "Lignes sans offre préférée",
        statLabel: "Écart vs Ozego fournisseurs préférés",
      };
}
