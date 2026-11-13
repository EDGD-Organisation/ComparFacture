import { describe, expect, mock, test } from "bun:test";

import type { MatchingLine } from "./matching-view";
import type { OzegoBest } from "./ozego";
import type { OzegoData } from "./stage-rows";

mock.module("@/integrations/supabase/client", () => ({ supabase: {} }));

const { buildLbnInput } = await import("./lbn-input");

const matched: MatchingLine = {
  id: "l1",
  invoice_id: "inv",
  line_number: 1,
  supplier_reference: " 152023 ",
  label: "BOULETTES BOEUF 30G",
  quantity: 14,
  unit: "KG",
  unit_price: 44.459,
  discount_percent: null,
  line_total: null,
  match_status: "confirmed",
  match_score: 1,
  match_method: "référence",
  manual_override: false,
  pack_factor: 5,
  matched_product_id: "p1",
  validated_stage: null,
  invoices: {
    id: "inv",
    supplier_name: "PRO A PRO",
    file_name: "a.pdf",
    invoice_number: "1",
    invoice_date: "2026-10-01",
    currency: "EUR",
  },
  catalog_products: {
    id: "p1",
    reference: "152023",
    label: "Boeuf Boulettes 30g",
    price: 8.93,
    unit: "KG",
    ean: null,
    family: "Boucherie",
    currency: "EUR",
    ozego_id: "5.6.74.1",
    supplier_name: "PRO A PRO",
  },
};

const best: OzegoBest = {
  ozego_id: "9.6.74.1",
  id: "v1",
  reference: "27897",
  label: "Boeuf Boulettes 30g",
  ean: null,
  family: null,
  unit: "KG",
  price: 7.5,
  supplier_name: "SYSCO",
  variants_count: 4,
};

const data: OzegoData = {
  bestByOzego: new Map([["5.6.74.1", best]]),
  variantsByOzego: new Map(),
  preferredSuppliers: [],
};

describe("buildLbnInput", () => {
  test("reprend la facture, le produit rapproché et la meilleure offre du groupe Ozego", () => {
    const { lines, title } = buildLbnInput([matched], data, "Client");
    expect(title).toBe("Client");
    const [line] = lines;
    expect(line!.date).toBe("2026-10-01");
    expect(line!.supplier).toBe("PRO A PRO");
    expect(line!.reference).toBe("152023");
    expect(line!.unitPrice).toBe(44.459);
    expect(line!.packFactor).toBe(5);
    expect(line!.product?.reference).toBe("152023");
    expect(line!.product?.price).toBe(8.93);
    expect(line!.product?.genericId).toBe("6.74.1");
    expect(line!.best?.reference).toBe("27897");
    expect(line!.best?.supplier).toBe("SYSCO");
    expect(line!.best?.price).toBe(7.5);
  });

  test("ligne non rapprochée : ni produit ni offre, coefficient ramené à 1", () => {
    const [line] = buildLbnInput(
      [{ ...matched, catalog_products: null, matched_product_id: null, pack_factor: null }],
      data,
      "Client",
    ).lines;
    expect(line!.product).toBeNull();
    expect(line!.best).toBeNull();
    expect(line!.packFactor).toBe(1);
  });
});
