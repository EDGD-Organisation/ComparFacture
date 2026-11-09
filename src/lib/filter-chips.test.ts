import { describe, expect, test } from "bun:test";

import { activeFilterChips, visibleCountText } from "./filter-chips";
import { ALL, DEFAULT_FILTERS, filtersActive, type MatchingFilters } from "./matching-view";

const invoices = [
  { id: "i1", label: "Sysco · N° 12" },
  { id: "i2", label: "Metro" },
];

describe("activeFilterChips", () => {
  test("aucun filtre actif : aucune pastille", () => {
    expect(activeFilterChips(DEFAULT_FILTERS, invoices)).toEqual([]);
  });

  test("une pastille par filtre actif, retirable une à une", () => {
    const filters: MatchingFilters = {
      search: "  beurre ",
      status: "review",
      invoiceId: "i1",
      supplier: "Metro",
      validation: "unvalidated",
    };
    const chips = activeFilterChips(filters, invoices);
    expect(chips.map((chip) => chip.label)).toEqual([
      "Recherche : « beurre »",
      "Facture : Sysco · N° 12",
      "Fournisseur : Metro",
      "Statut : À vérifier",
      "Validation : Lignes non validées",
    ]);
    expect(chips.map((chip) => chip.patch)).toEqual([
      { search: "" },
      { invoiceId: ALL },
      { supplier: ALL },
      { status: ALL },
      { validation: "all" },
    ]);
  });

  test("retirer toutes les pastilles en suivant leurs patchs désactive les filtres", () => {
    let filters: MatchingFilters = {
      search: "x",
      status: "confirmed",
      invoiceId: "i2",
      supplier: "Metro",
      validation: "validated",
    };
    for (const chip of activeFilterChips(filters, invoices)) {
      filters = { ...filters, ...chip.patch };
    }
    expect(filtersActive(filters)).toBe(false);
  });

  test("une recherche faite d'espaces ne crée pas de pastille", () => {
    expect(activeFilterChips({ ...DEFAULT_FILTERS, search: "   " }, invoices)).toEqual([]);
  });

  test("une facture inconnue garde une pastille retirable", () => {
    const chips = activeFilterChips({ ...DEFAULT_FILTERS, invoiceId: "zzz" }, invoices);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.patch).toEqual({ invoiceId: ALL });
  });
});

describe("visibleCountText", () => {
  test("accorde le singulier et le pluriel", () => {
    expect(visibleCountText(0, 12)).toBe("0 ligne affichée sur 12");
    expect(visibleCountText(1, 12)).toBe("1 ligne affichée sur 12");
    expect(visibleCountText(12, 340)).toBe("12 lignes affichées sur 340");
  });
});
