import { describe, expect, mock, test } from "bun:test";

import { gapPercentLabel, gapTextClass, gapTone, lineGap } from "./format";
import type { MatchingLine, MatchingProduct } from "./matching-view";
import { filterLines, countByStatus, DEFAULT_FILTERS, paginate } from "./matching-view";
import type { OzegoBest, OzegoVariant } from "./ozego";
import { normalizePackFactor } from "./pack";
import type { StageLine } from "./stage-rows";

mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));

const { ozegoGap } = await import("./ozego");
const {
  bestRowFor,
  fournisseurLineView,
  isOutOfTolerance,
  offerFor,
  ozegoIdsOf,
  ozegoLineView,
  ozegoTableLabels,
  outOfToleranceTone,
  preferredRowFor,
  sumFournisseurGaps,
  sumOzegoGaps,
  sumPreferredGaps,
  sumReferencePrices,
} = await import("./stage-rows");

const product = (over: Partial<MatchingProduct> = {}): MatchingProduct => ({
  id: "p1",
  reference: "REF-1",
  label: "Échalote grise",
  price: 1.5,
  unit: "KG",
  ean: null,
  family: null,
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
    line_number: 1,
    supplier_reference: "ABC",
    label: "ECHALOTE GRISE",
    quantity: 2,
    unit: "kg",
    unit_price: 12,
    discount_percent: null,
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

const offer = (over: Partial<OzegoVariant> = {}): OzegoVariant => ({
  ozego_id: "22.4.72.139",
  id: "v1",
  reference: "SYS-1",
  label: "Echalote",
  ean: null,
  family: null,
  unit: "KG",
  price: 1.8,
  supplier_name: "Sysco",
  ...over,
});

const best = (over: Partial<OzegoBest> = {}): OzegoBest => ({
  ...offer(),
  variants_count: 3,
  ...over,
});

const variants: OzegoVariant[] = [
  offer({ id: "v1", supplier_name: "Metro", price: 1.9, ozego_id: "18.4.72.139" }),
  offer({ id: "v2", supplier_name: "Sysco", price: 1.7, ozego_id: "22.4.72.139" }),
  offer({ id: "v3", supplier_name: "Brake", price: 2.5, ozego_id: "9.4.72.139" }),
];

describe("isOutOfTolerance", () => {
  test("compare la valeur absolue de l'écart en % à la tolérance, sans écart = jamais", () => {
    expect(isOutOfTolerance({ percentGap: 2.5 }, 2)).toBe(true);
    expect(isOutOfTolerance({ percentGap: -2.5 }, 2)).toBe(true);
    expect(isOutOfTolerance({ percentGap: 2 }, 2)).toBe(false);
    expect(isOutOfTolerance({ percentGap: null }, 2)).toBe(false);
    expect(isOutOfTolerance(null, 2)).toBe(false);
  });
});

describe("gapPercentLabel : économie en « − », perte en « + »", () => {
  test("inverse le signe de l'écart brut pour l'affichage", () => {
    expect(gapPercentLabel(50.1437)).toBe("-50,1 %");
    expect(gapPercentLabel(-3.2)).toBe("+3,2 %");
  });

  test("tiret si absent, zéro sans signe", () => {
    expect(gapPercentLabel(null)).toBe("—");
    expect(gapPercentLabel(undefined)).toBe("—");
    expect(gapPercentLabel(0)).toBe("0,0 %");
  });
});

describe("gapTone / gapTextClass : vert = économie possible, rouge = perte", () => {
  test("écart positif (on paie plus que la référence) : économie possible, vert", () => {
    expect(gapTone(167.48)).toBe("gain");
    expect(gapTextClass(167.48)).toBe("text-success");
  });

  test("écart négatif (on paie moins que la référence) : perte, rouge", () => {
    expect(gapTone(-0.01)).toBe("loss");
    expect(gapTextClass(-0.01)).toBe("text-destructive");
  });

  test("écart nul, absent ou non numérique : aucune couleur", () => {
    for (const value of [0, null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(gapTone(value)).toBeNull();
      expect(gapTextClass(value)).toBe("");
    }
  });
});

describe("outOfToleranceTone : même convention pour les lignes hors tolérance", () => {
  test("on paie plus que la référence : économie possible, ligne verte", () => {
    expect(outOfToleranceTone({ unitGap: 4.187, percentGap: 50.14 }, 2)).toBe("gain");
  });

  test("on paie moins que la référence : perte, ligne rouge", () => {
    expect(outOfToleranceTone({ unitGap: -0.5, percentGap: -30 }, 2)).toBe("loss");
  });

  test("dans la tolérance ou sans écart : aucune teinte", () => {
    expect(outOfToleranceTone({ unitGap: 0.01, percentGap: 1 }, 2)).toBeNull();
    expect(outOfToleranceTone({ unitGap: -0.01, percentGap: -1 }, 2)).toBeNull();
    expect(outOfToleranceTone(null, 2)).toBeNull();
  });

  test("les vues de ligne exposent la teinte : cond. ×6, 2 € contre 1,5 € = économie possible", () => {
    expect(fournisseurLineView(line("1"), 2).tone).toBe("gain");
    expect(fournisseurLineView(line("1", { unit_price: 3 }), 2).tone).toBe("loss");
    expect(fournisseurLineView(line("1", { unit_price: 9.1 }), 2).tone).toBeNull();
  });
});

describe("ligne saumon du comparatif : 12,537 € facturé contre 8,350 € au catalogue", () => {
  test("écart par kg, total sur 40 kg et pourcentage", () => {
    const gap = lineGap(12.537, 8.35, 40, 1);
    expect(gap?.unitGap).toBeCloseTo(4.187, 9);
    expect(gap?.totalGap).toBeCloseTo(167.48, 9);
    expect(gap?.percentGap).toBeCloseTo(50.1437, 3);
  });
});

describe("fournisseurLineView (mode fournisseur de la page facture)", () => {
  test("cond. ×6 : PU facturé 12 / 6 = 2 contre 1,5 au catalogue", () => {
    const view = fournisseurLineView(line("1"), 2);
    expect(view.catalogPrice).toBe(1.5);
    expect(view.gap?.comparablePrice).toBe(2);
    expect(view.gap?.unitGap).toBe(0.5);
    expect(view.gap?.percentGap).toBeCloseTo(33.3333, 3);
    expect(view.gap?.totalGap).toBe(6);
    expect(view.gap?.packFactor).toBe(6);
    expect(view.out).toBe(true);
  });

  test("écart dans la tolérance : pas de surbrillance", () => {
    expect(fournisseurLineView(line("1", { unit_price: 9.1 }), 2).out).toBe(false);
  });

  test("prix facturé nul : pas d'écart", () => {
    const view = fournisseurLineView(line("1", { unit_price: null }), 2);
    expect(view.gap).toBeNull();
    expect(view.out).toBe(false);
  });

  test("ligne sans produit : pas de prix, pas d'écart, rien à valider", () => {
    const view = fournisseurLineView(line("1", { product: null, match_status: "unmatched" }), 2);
    expect(view.catalogPrice).toBeNull();
    expect(view.gap).toBeNull();
    expect(view.canConfirm).toBe(false);
  });

  test("« Valider » seulement avec un produit rapproché non confirmé", () => {
    expect(fournisseurLineView(line("1", { match_status: "review" }), 2).canConfirm).toBe(true);
    expect(fournisseurLineView(line("1", { match_status: "confirmed" }), 2).canConfirm).toBe(false);
  });

  test("prix catalogue à 0 : écart en valeur mais pas de pourcentage", () => {
    const view = fournisseurLineView(line("1", { product: product({ price: 0 }) }), 2);
    expect(view.gap?.percentGap).toBeNull();
    expect(view.gap?.unitGap).toBe(2);
    expect(view.out).toBe(false);
  });
});

describe("ozegoLineView (modes ozego et ozego-preferes)", () => {
  test("cond. ×6 contre la meilleure offre à 1,8", () => {
    const view = ozegoLineView(line("1"), best(), 2, "ozego");
    expect(view.ozegoId).toBe("31.4.72.139");
    expect(view.gap?.comparablePrice).toBe(2);
    expect(view.gap?.unitGap).toBeCloseTo(0.2, 10);
    expect(view.gap?.percentGap).toBeCloseTo(11.1111, 3);
    expect(view.gap?.totalGap).toBeCloseTo(2.4, 10);
    expect(view.out).toBe(true);
  });

  test("offre sans prix, ou aucune offre : pas d'écart", () => {
    expect(ozegoLineView(line("1"), best({ price: null }), 2, "ozego").gap).toBeNull();
    expect(ozegoLineView(line("1"), undefined, 2, "ozego").gap).toBeNull();
  });

  test("ligne sans produit : pas d'identifiant Ozego", () => {
    const view = ozegoLineView(line("1", { product: null }), undefined, 2, "ozego");
    expect(view.ozegoId).toBeNull();
    expect(view.gap).toBeNull();
  });

  test("verrou en cascade : validée à « fournisseur » = verrouillée sur les 2 étapes Ozego", () => {
    const l = line("1", { validated_stage: "fournisseur" });
    expect(ozegoLineView(l, best(), 2, "ozego").locked).toBe(true);
    expect(ozegoLineView(l, best(), 2, "ozego-preferes").locked).toBe(true);
  });

  test("validée à « ozego » : verrouillée seulement sur « ozego-preferes »", () => {
    const l = line("1", { validated_stage: "ozego" });
    expect(ozegoLineView(l, best(), 2, "ozego").locked).toBe(false);
    expect(ozegoLineView(l, best(), 2, "ozego-preferes").locked).toBe(true);
  });

  test("non validée, ou validée à l'étape affichée : modifiable", () => {
    expect(ozegoLineView(line("1"), best(), 2, "ozego").locked).toBe(false);
    expect(
      ozegoLineView(line("1", { validated_stage: "ozego-preferes" }), best(), 2, "ozego-preferes")
        .locked,
    ).toBe(false);
  });
});

describe("offre de référence par étape", () => {
  const bestMap = new Map([["31.4.72.139", best()]]);
  const variantsMap = new Map([["31.4.72.139", variants]]);

  test("bestRowFor lit la meilleure offre du groupe, undefined sans identifiant ou sans produit", () => {
    expect(bestRowFor(line("1"), bestMap)?.price).toBe(1.8);
    expect(
      bestRowFor(line("1", { product: product({ ozego_id: null }) }), bestMap),
    ).toBeUndefined();
    expect(bestRowFor(line("1", { product: null }), bestMap)).toBeUndefined();
  });

  test("preferredRowFor : la moins chère des fournisseurs préférés, insensible à la casse", () => {
    expect(preferredRowFor(line("1"), variantsMap, ["metro"])?.price).toBe(1.9);
    expect(preferredRowFor(line("1"), variantsMap, ["METRO", "Sysco"])?.price).toBe(1.7);
  });

  test("preferredRowFor : aucun fournisseur préféré défini = moins cher de tous (comportement de la page)", () => {
    expect(preferredRowFor(line("1"), variantsMap, [])?.price).toBe(1.7);
  });

  test("preferredRowFor : aucun préféré ne propose le produit = undefined", () => {
    expect(preferredRowFor(line("1"), variantsMap, ["Inconnu"])).toBeUndefined();
  });

  test("offerFor aiguille vers la bonne étape", () => {
    const data = {
      bestByOzego: bestMap,
      variantsByOzego: variantsMap,
      preferredSuppliers: ["metro"],
    };
    expect(offerFor("ozego", line("1"), data)?.supplier_name).toBe("Sysco");
    expect(offerFor("ozego-preferes", line("1"), data)?.supplier_name).toBe("Metro");
  });
});

// Copies verbatim des calculs de la page facture avant leur extraction dans stage-rows.ts.
function legacyTotals(lines: StageLine[], tolerance: number) {
  return lines.reduce(
    (acc, l) => {
      const gap = lineGap(
        l.unit_price,
        l.catalog_products?.price ?? null,
        l.quantity,
        l.pack_factor,
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

function legacyOzegoTotals(
  lines: StageLine[],
  bestByOzego: Map<string, OzegoBest>,
  tolerance: number,
) {
  return lines.reduce(
    (acc, l) => {
      const b = l.catalog_products?.ozego_id
        ? bestByOzego.get(l.catalog_products.ozego_id)
        : undefined;
      const gap = ozegoGap(l, b);
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

function legacyPrices(lines: StageLine[], bestByOzego: Map<string, OzegoBest>) {
  return lines.reduce(
    (acc, l) => {
      const catalogPrice = l.catalog_products?.price ?? null;
      const sup = lineGap(l.unit_price, catalogPrice, l.quantity, l.pack_factor);
      const k = sup?.packFactor ?? normalizePackFactor(l.pack_factor);
      if (sup) {
        acc.invoicedTotal += (l.unit_price ?? 0) * l.quantity;
        acc.catalogTotal += (catalogPrice ?? 0) * l.quantity * k;
      }
      const ozegoId = l.catalog_products?.ozego_id ?? null;
      const b = ozegoId ? bestByOzego.get(ozegoId) : undefined;
      const oz = ozegoGap(l, b);
      if (oz) acc.bestTotal += (b?.price ?? 0) * l.quantity * k;
      return acc;
    },
    { invoicedTotal: 0, catalogTotal: 0, bestTotal: 0 },
  );
}

function legacyPreferred(
  lines: StageLine[],
  variantsByOzego: Map<string, OzegoVariant[]>,
  preferred: string[],
  tolerance: number,
  cheapestAmong: (v: OzegoVariant[] | undefined, s?: string[] | null) => OzegoVariant | undefined,
) {
  return lines.reduce(
    (acc, l) => {
      const ozegoId = l.catalog_products?.ozego_id ?? null;
      const v = ozegoId ? variantsByOzego.get(ozegoId) : undefined;
      const row = cheapestAmong(v, preferred);
      const gap = ozegoGap(l, row);
      if (gap) {
        acc.total += gap.totalGap;
        acc.bestTotal += (row?.price ?? 0) * l.quantity * gap.packFactor;
        if (Math.abs(gap.percentGap ?? 0) > tolerance) acc.anomalies += 1;
      } else {
        acc.unmatched += 1;
      }
      return acc;
    },
    { total: 0, bestTotal: 0, anomalies: 0, unmatched: 0 },
  );
}

const mixedLines = (): MatchingLine[] => [
  line("cond6"),
  line("plain", { pack_factor: 1, unit_price: 1.6, quantity: 10 }),
  line("null-price", { unit_price: null }),
  line("no-product", { product: null, match_status: "unmatched" }),
  line("no-ozego", { product: product({ ozego_id: null, price: 3 }), unit_price: 4 }),
  line("zero-catalog", { product: product({ price: 0 }), unit_price: 5, pack_factor: null }),
  line("cheaper", { unit_price: 6, pack_factor: 6 }),
  line("locked", { validated_stage: "fournisseur" }),
];

describe("totaux : mêmes nombres que les calculs d'origine de la page facture", () => {
  const bestByOzego = new Map([["31.4.72.139", best()]]);
  const variantsByOzego = new Map([["31.4.72.139", variants]]);

  test("sumFournisseurGaps", () => {
    const lines = mixedLines();
    for (const tolerance of [0, 2, 40]) {
      expect(sumFournisseurGaps(lines, tolerance)).toEqual(legacyTotals(lines, tolerance));
    }
    expect(sumFournisseurGaps(lines, 2).unmatched).toBe(2);
  });

  test("sumOzegoGaps", () => {
    const lines = mixedLines();
    for (const tolerance of [0, 2, 40]) {
      const { invoicedTotal: _invoiced, ...totals } = sumOzegoGaps(lines, bestByOzego, tolerance);
      expect(totals).toEqual(legacyOzegoTotals(lines, bestByOzego, tolerance));
    }
  });

  test("pied de tableau Ozego : facturé - meilleur prix = écart, sur les mêmes lignes", () => {
    const lines = mixedLines();
    const ozego = sumOzegoGaps(lines, bestByOzego, 2);
    const prices = sumReferencePrices(lines, bestByOzego);
    expect(ozego.invoicedTotal - prices.bestTotal).toBeCloseTo(ozego.total, 9);
    // Des lignes ont un prix catalogue mais pas d'offre Ozego : le facturé « catalogue » est plus grand.
    expect(prices.invoicedTotal > ozego.invoicedTotal).toBe(true);

    const preferred = sumPreferredGaps(lines, variantsByOzego, ["metro"], 2);
    expect(preferred.invoicedTotal - preferred.bestTotal).toBeCloseTo(preferred.total, 9);
  });

  test("sumReferencePrices", () => {
    const lines = mixedLines();
    expect(sumReferencePrices(lines, bestByOzego)).toEqual(legacyPrices(lines, bestByOzego));
  });

  test("sumPreferredGaps, avec et sans fournisseur préféré", async () => {
    const { cheapestAmong } = await import("./ozego");
    const lines = mixedLines();
    for (const preferred of [["metro"], [], ["Inconnu"]]) {
      const { invoicedTotal: _invoiced, ...totals } = sumPreferredGaps(
        lines,
        variantsByOzego,
        preferred,
        2,
      );
      expect(totals).toEqual(legacyPreferred(lines, variantsByOzego, preferred, 2, cheapestAmong));
    }
  });

  test("valeurs de référence : cond. ×6, une ligne comparée à 1,8", () => {
    const [first] = mixedLines();
    expect(sumFournisseurGaps([first!], 2)).toEqual({ total: 6, anomalies: 1, unmatched: 0 });
    const ozego = sumOzegoGaps([first!], bestByOzego, 2);
    expect(ozego.total).toBeCloseTo(2.4, 10);
    expect(ozego.anomalies).toBe(1);
    const prices = sumReferencePrices([first!], bestByOzego);
    expect(prices.invoicedTotal).toBe(24);
    expect(prices.catalogTotal).toBe(18);
    expect(prices.bestTotal).toBeCloseTo(21.6, 10);
    expect(sumPreferredGaps([first!], variantsByOzego, ["metro"], 2).bestTotal).toBeCloseTo(
      22.8,
      10,
    );
  });

  test("aucune ligne : tout à zéro", () => {
    expect(sumFournisseurGaps([], 2)).toEqual({ total: 0, anomalies: 0, unmatched: 0 });
    expect(sumReferencePrices([], bestByOzego)).toEqual({
      invoicedTotal: 0,
      catalogTotal: 0,
      bestTotal: 0,
    });
  });
});

describe("ozegoTableLabels", () => {
  test("libellés de l'étape Ozego et message adapté quand aucun fournisseur préféré n'est défini", () => {
    expect(ozegoTableLabels("ozego", 0).referenceColumnLabel).toBe("Référence la moins chère");
    expect(ozegoTableLabels("ozego", 3).unmatchedLabel).toBe("Lignes sans identifiant Ozego");
    expect(ozegoTableLabels("ozego-preferes", 0).unmatchedLabel).toBe(
      "Aucun fournisseur préféré défini",
    );
    expect(ozegoTableLabels("ozego-preferes", 2).unmatchedLabel).toBe("Lignes sans offre préférée");
    expect(ozegoTableLabels("ozego-preferes", 2).referenceColumnLabel).toBe(
      "Référence fournisseur préféré",
    );
  });
});

describe("vue projet : filtres et pagination pour les lignes des sous-onglets", () => {
  const many = (): MatchingLine[] =>
    Array.from({ length: 120 }, (_, i) => {
      const invoice = `inv-${i % 3}`;
      return line(`l${String(i).padStart(3, "0")}`, {
        invoice_id: invoice,
        line_number: i,
        match_status: i % 4 === 0 ? "review" : "confirmed",
        product: i % 10 === 0 ? null : product({ id: `p${i}`, ozego_id: `31.4.${i}.1` }),
        invoices: {
          id: invoice,
          supplier_name: `Fournisseur ${i % 3}`,
          file_name: `${invoice}.pdf`,
          invoice_number: null,
          invoice_date: "2026-10-01",
          currency: "EUR",
        },
      });
    });

  test("les filtres s'appliquent aux lignes avant les étapes", () => {
    const lines = many();
    const filtered = filterLines(lines, { ...DEFAULT_FILTERS, invoiceId: "inv-1" });
    expect(filtered).toHaveLength(40);
    const validated = filterLines(lines, { ...DEFAULT_FILTERS, validation: "validated" });
    expect(validated.every((l) => l.match_status === "confirmed")).toBe(true);
    expect(countByStatus(filterLines(lines, DEFAULT_FILTERS)).all).toBe(120);
  });

  test("pagination de 50 lignes : seuls les identifiants Ozego de la page sont demandés", () => {
    const filtered = filterLines(many(), DEFAULT_FILTERS);
    const first = paginate(filtered, 1, 50);
    const last = paginate(filtered, 3, 50);
    expect(first.items).toHaveLength(50);
    expect(last.items).toHaveLength(20);
    const firstIds = ozegoIdsOf(first.items);
    expect(firstIds).toHaveLength(45);
    expect(new Set(firstIds).size).toBe(45);
    expect(ozegoIdsOf(last.items).every((id) => !firstIds.includes(id))).toBe(true);
  });

  test("ozegoIdsOf ignore les lignes sans produit ou sans identifiant", () => {
    expect(
      ozegoIdsOf([
        line("1"),
        line("2", { product: null }),
        line("3", { product: product({ ozego_id: null }) }),
      ]),
    ).toEqual(["31.4.72.139"]);
  });
});
