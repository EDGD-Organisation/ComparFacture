import { describe, expect, test } from "bun:test";

import {
  buildExportRows,
  countByStatus,
  DEFAULT_FILTERS,
  filterLines,
  filtersActive,
  invoiceOptions,
  matchMethodNote,
  paginate,
  rematchSequentially,
  rowStatus,
  sortLines,
  supplierOptions,
  type MatchingFilters,
  type MatchingLine,
  type MatchingProduct,
} from "./matching-view";

const product = (over: Partial<MatchingProduct> = {}): MatchingProduct => ({
  id: "p1",
  reference: "REF-1",
  label: "Échalote grise",
  price: 2,
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
  over: Partial<Omit<MatchingLine, "id">> & { product?: MatchingProduct | null } = {},
): MatchingLine {
  const { product: catalog = product(), ...rest } = over;
  return {
    id,
    invoice_id: "inv-a",
    line_number: 1,
    supplier_reference: "ABC",
    label: "ECHALOTE GRISE 5KG",
    quantity: 2,
    unit: "kg",
    unit_price: 10,
    discount_percent: null,
    line_total: 20,
    match_status: "confirmed",
    match_score: 0.9,
    match_method: "référence",
    manual_override: false,
    pack_factor: 1,
    matched_product_id: catalog ? catalog.id : null,
    validated_stage: null,
    invoices: {
      id: "inv-a",
      supplier_name: "Transgourmet",
      file_name: "facture-a.pdf",
      invoice_number: "A-1",
      invoice_date: "2026-10-01",
      currency: "EUR",
    },
    catalog_products: catalog,
    ...rest,
  };
}

const filters = (patch: Partial<MatchingFilters>): MatchingFilters => ({
  ...DEFAULT_FILTERS,
  ...patch,
});

const ids = (lines: MatchingLine[]) => lines.map((l) => l.id);

describe("rowStatus", () => {
  test("confirmé, à vérifier et non rapproché", () => {
    expect(rowStatus(line("1"))).toBe("confirmed");
    expect(rowStatus(line("2", { match_status: "review" }))).toBe("review");
    expect(rowStatus(line("3", { product: null, match_status: "unmatched" }))).toBe("unmatched");
  });

  test("une ligne sans produit est non rapprochée même si son statut dit confirmé", () => {
    expect(rowStatus(line("1", { product: null, match_status: "confirmed" }))).toBe("unmatched");
  });
});

describe("filterLines", () => {
  const lines = [
    line("1"),
    line("2", {
      label: "Crème fraîche 35%",
      supplier_reference: "CRF-9",
      match_status: "review",
      product: product({
        id: "p2",
        label: "Crème liquide",
        reference: "CL-7",
        ozego_id: "18.2.5.1",
      }),
      validated_stage: "fournisseur",
    }),
    line("3", {
      invoice_id: "inv-b",
      label: "Farine T55",
      supplier_reference: null,
      product: null,
      match_status: "unmatched",
      invoices: {
        id: "inv-b",
        supplier_name: "Pomona",
        file_name: "b.pdf",
        invoice_number: null,
        invoice_date: "2026-10-05",
        currency: "EUR",
      },
    }),
  ];

  test("sans filtre, tout passe", () => {
    expect(ids(filterLines(lines, DEFAULT_FILTERS))).toEqual(["1", "2", "3"]);
  });

  test("recherche insensible aux accents et à la casse sur la désignation", () => {
    expect(ids(filterLines(lines, filters({ search: "CREME FRAICHE" })))).toEqual(["2"]);
    expect(ids(filterLines(lines, filters({ search: "échalote" })))).toEqual(["1"]);
    expect(ids(filterLines(lines, filters({ search: "echalote" })))).toEqual(["1"]);
  });

  test("recherche sur la référence fournisseur, le produit rapproché et son identifiant Ozego", () => {
    expect(ids(filterLines(lines, filters({ search: "crf-9" })))).toEqual(["2"]);
    expect(ids(filterLines(lines, filters({ search: "crème liquide" })))).toEqual(["2"]);
    expect(ids(filterLines(lines, filters({ search: "cl-7" })))).toEqual(["2"]);
    expect(ids(filterLines(lines, filters({ search: "18.2.5.1" })))).toEqual(["2"]);
  });

  test("une recherche blanche ne filtre pas, une recherche sans résultat renvoie vide", () => {
    expect(filterLines(lines, filters({ search: "   " }))).toHaveLength(3);
    expect(filterLines(lines, filters({ search: "introuvable" }))).toHaveLength(0);
  });

  test("filtre par statut", () => {
    expect(ids(filterLines(lines, filters({ status: "confirmed" })))).toEqual(["1"]);
    expect(ids(filterLines(lines, filters({ status: "review" })))).toEqual(["2"]);
    expect(ids(filterLines(lines, filters({ status: "unmatched" })))).toEqual(["3"]);
  });

  test("filtre par facture et par fournisseur de la facture", () => {
    expect(ids(filterLines(lines, filters({ invoiceId: "inv-b" })))).toEqual(["3"]);
    expect(ids(filterLines(lines, filters({ supplier: "Transgourmet" })))).toEqual(["1", "2"]);
    expect(ids(filterLines(lines, filters({ supplier: "Pomona" })))).toEqual(["3"]);
  });

  test("filtre validées / non validées : match_status confirmé comme la page facture, validated_stage ignoré", () => {
    expect(ids(filterLines(lines, filters({ validation: "validated" })))).toEqual(["1"]);
    expect(ids(filterLines(lines, filters({ validation: "unvalidated" })))).toEqual(["2", "3"]);
  });

  test("les filtres se cumulent", () => {
    expect(
      ids(
        filterLines(
          lines,
          filters({ supplier: "Transgourmet", status: "review", search: "crème" }),
        ),
      ),
    ).toEqual(["2"]);
    expect(filterLines(lines, filters({ supplier: "Pomona", status: "confirmed" }))).toHaveLength(
      0,
    );
  });

  test("filtersActive", () => {
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
    expect(filtersActive(filters({ search: "  " }))).toBe(false);
    expect(filtersActive(filters({ search: "a" }))).toBe(true);
    expect(filtersActive(filters({ validation: "validated" }))).toBe(true);
    expect(filtersActive(filters({ invoiceId: "inv-a" }))).toBe(true);
  });
});

describe("sortLines", () => {
  const mk = (id: string, supplier: string, date: string, invoiceId: string, n: number) =>
    line(id, {
      invoice_id: invoiceId,
      line_number: n,
      invoices: {
        id: invoiceId,
        supplier_name: supplier,
        file_name: null,
        invoice_number: null,
        invoice_date: date,
        currency: "EUR",
      },
    });
  const lines = [
    mk("a3", "Pomona", "2026-10-02", "i2", 1),
    mk("b2", "Metro", "2026-10-01", "i1", 2),
    mk("b1", "Metro", "2026-10-01", "i1", 1),
    mk("c1", "Metro", "2026-09-01", "i0", 5),
    mk("z", "Metro", "2026-10-01", "i1", 2),
  ];

  test("fournisseur, puis date, facture, n° de ligne, puis id", () => {
    expect(ids(sortLines(lines))).toEqual(["c1", "b1", "b2", "z", "a3"]);
  });

  test("stable : même résultat quel que soit l'ordre d'entrée, entrée non modifiée", () => {
    const reversed = [...lines].reverse();
    expect(ids(sortLines(reversed))).toEqual(ids(sortLines(lines)));
    expect(ids(lines)).toEqual(["a3", "b2", "b1", "c1", "z"]);
  });

  test("tri naturel des fournisseurs, sans tenir compte des accents ni de la casse", () => {
    const sorted = sortLines([
      mk("1", "zeta", "2026-01-01", "i", 1),
      mk("2", "Épicerie", "2026-01-01", "j", 1),
      mk("3", "alpha", "2026-01-01", "k", 1),
    ]);
    expect(ids(sorted)).toEqual(["3", "2", "1"]);
  });
});

describe("countByStatus", () => {
  test("compte par statut et au total", () => {
    const counts = countByStatus([
      line("1"),
      line("2"),
      line("3", { match_status: "review" }),
      line("4", { product: null, match_status: "unmatched" }),
    ]);
    expect(counts).toEqual({ all: 4, confirmed: 2, review: 1, unmatched: 1 });
  });

  test("liste vide", () => {
    expect(countByStatus([])).toEqual({ all: 0, confirmed: 0, review: 0, unmatched: 0 });
  });
});

describe("options de filtre", () => {
  const other = line("2", {
    invoice_id: "inv-b",
    invoices: {
      id: "inv-b",
      supplier_name: "Pomona",
      file_name: "b.pdf",
      invoice_number: null,
      invoice_date: null,
      currency: null,
    },
  });
  test("une option par facture et par fournisseur, sans doublon", () => {
    const lines = [line("1"), line("3"), other];
    expect(invoiceOptions(lines).map((o) => o.id)).toEqual(["inv-b", "inv-a"]);
    expect(supplierOptions(lines)).toEqual(["Pomona", "Transgourmet"]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 120 }, (_, i) => i + 1);

  test("première, dernière page partielle et bornes", () => {
    const first = paginate(items, 1, 50);
    expect(first.items).toHaveLength(50);
    expect([first.from, first.to, first.pageCount, first.total]).toEqual([1, 50, 3, 120]);
    const last = paginate(items, 3, 50);
    expect(last.items).toEqual(items.slice(100));
    expect([last.from, last.to]).toEqual([101, 120]);
  });

  test("page hors limites ramenée dans [1, pageCount]", () => {
    expect(paginate(items, 99, 50).page).toBe(3);
    expect(paginate(items, 0, 50).page).toBe(1);
    expect(paginate(items, -4, 50).page).toBe(1);
    expect(paginate(items, Number.NaN, 50).page).toBe(1);
    expect(paginate(items, 2.7, 50).page).toBe(2);
  });

  test("liste vide : une page, aucune ligne", () => {
    const empty = paginate([], 5, 50);
    expect(empty.items).toEqual([]);
    expect([empty.page, empty.pageCount, empty.from, empty.to, empty.total]).toEqual([
      1, 1, 0, 0, 0,
    ]);
  });

  test("taille exacte d'une page et taille invalide", () => {
    expect(paginate(items.slice(0, 50), 1, 50).pageCount).toBe(1);
    expect(paginate(items.slice(0, 51), 1, 50).pageCount).toBe(2);
    expect(paginate(items, 1, 0).items).toHaveLength(1);
  });
});

describe("buildExportRows", () => {
  test("colonnes en français, Désignation fournisseur et pas Libellé facture", () => {
    const [row] = buildExportRows([
      line("1", {
        pack_factor: 6,
        unit_price: 12,
        manual_override: true,
        match_method: "référence",
        validated_stage: "ozego",
      }),
    ]);
    expect(Object.keys(row!)).toContain("Désignation fournisseur");
    expect(Object.keys(row!)).not.toContain("Libellé facture");
    expect(row).toEqual({
      "Facture (fichier)": "facture-a.pdf",
      "N° facture": "A-1",
      "Date facture": "2026-10-01",
      "Fournisseur (facture)": "Transgourmet",
      "N° ligne": 1,
      "Référence fournisseur": "ABC",
      "Désignation fournisseur": "ECHALOTE GRISE 5KG",
      Quantité: 2,
      Unité: "kg",
      "PU facturé": 12,
      "Coef. conditionnement": 6,
      "PU comparable": 2,
      "Référence catalogue": "REF-1",
      "Libellé catalogue": "Échalote grise",
      "Fournisseur catalogue": "Metro",
      "Identifiant Ozego": "31.4.72.139",
      "Unité catalogue": "KG",
      "PU catalogue": 2,
      Méthode: "manuel",
      "Score de rapprochement": 0.9,
      Statut: "Confirmé",
      Validation: "Ozego · Autres fournisseurs",
    });
  });

  test("ligne non rapprochée : champs produit vides, coef 1 par défaut", () => {
    const [row] = buildExportRows([
      line("1", {
        product: null,
        match_status: "unmatched",
        match_score: null,
        pack_factor: null,
        unit_price: null,
        supplier_reference: null,
      }),
    ]);
    expect(row!["Référence catalogue"]).toBe("");
    expect(row!["Identifiant Ozego"]).toBe("");
    expect(row!["Coef. conditionnement"]).toBe(1);
    expect(row!["PU comparable"]).toBe("");
    expect(row!["Référence fournisseur"]).toBe("");
    expect(row!["Méthode"]).toBe("");
    expect(row!["Statut"]).toBe("Non rapproché");
    expect(row!["Validation"]).toBe("Non validée");
  });

  test("une ligne par entrée, dans l'ordre fourni", () => {
    const rows = buildExportRows([line("1", { line_number: 4 }), line("2", { line_number: 2 })]);
    expect(rows.map((r) => r["N° ligne"])).toEqual([4, 2]);
  });
});

describe("rematchSequentially", () => {
  const invoices = [
    { id: "a", label: "A" },
    { id: "b", label: "B" },
    { id: "c", label: "C" },
  ];

  test("traite les factures une par une, dans l'ordre, et cumule les lignes mises à jour", async () => {
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const progress: Array<[number, number, string | null]> = [];
    const summary = await rematchSequentially(
      invoices,
      async (id) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        order.push(id);
        running -= 1;
        return { updated: 3 };
      },
      (done, total, current) => progress.push([done, total, current]),
    );
    expect(order).toEqual(["a", "b", "c"]);
    expect(maxRunning).toBe(1);
    expect(summary).toEqual({ total: 3, succeeded: 3, updatedLines: 9, failed: [] });
    expect(progress).toEqual([
      [0, 3, "A"],
      [1, 3, "B"],
      [2, 3, "C"],
      [3, 3, null],
    ]);
  });

  test("une erreur est consignée et n'arrête pas les factures suivantes", async () => {
    const summary = await rematchSequentially(invoices, async (id) => {
      if (id === "b") throw new Error("Forbidden");
      return { updated: 1 };
    });
    expect(summary.succeeded).toBe(2);
    expect(summary.updatedLines).toBe(2);
    expect(summary.failed).toEqual([{ invoiceId: "b", label: "B", message: "Forbidden" }]);
  });

  test("aucune facture", async () => {
    const summary = await rematchSequentially([], async () => ({ updated: 1 }));
    expect(summary).toEqual({ total: 0, succeeded: 0, updatedLines: 0, failed: [] });
  });
});

describe("matchMethodNote", () => {
  test("rapprochement par libellé : mention courte, phrase complète en détail", () => {
    const note = matchMethodNote("libellé");
    expect(note?.text).toBe("Rapproché par libellé");
    expect(note?.detail).toBe("Pas rapproché par la référence fournisseur (libellé)");
    expect(note?.tone).toBe("warning");
    expect(note!.text.length < note!.detail.length).toBe(true);
  });

  test("rapprochement manuel : mention neutre", () => {
    expect(matchMethodNote("manuel")?.tone).toBe("muted");
  });

  test("référence exacte, EAN, mapping appris ou inconnu : aucune mention", () => {
    for (const method of ["reference", "ean", "mapping", null]) {
      expect(matchMethodNote(method)).toBeNull();
    }
  });
});
