import { describe, expect, test } from "bun:test";

import { DEFAULT_FILTERS, filterLines, rowStatus, type MatchingLine } from "./matching-view";
import {
  countToReview,
  hasOpenOverlay,
  isNextShortcut,
  isTypingTarget,
  needsReview,
  nextToReview,
  type ShortcutEvent,
} from "./review-navigation";

type L = { id: string; match_status: string | null; catalog_products: unknown };

const ok = (id: string): L => ({ id, match_status: "confirmed", catalog_products: { id: "p" } });
const review = (id: string): L => ({ id, match_status: "review", catalog_products: { id: "p" } });
const unmatched = (id: string): L => ({ id, match_status: "unmatched", catalog_products: null });

describe("needsReview", () => {
  test("review et unmatched : à vérifier ; confirmed avec produit : non", () => {
    expect(needsReview(review("a"))).toBe(true);
    expect(needsReview(unmatched("a"))).toBe(true);
    expect(needsReview(ok("a"))).toBe(false);
  });

  test("statut confirmed mais sans produit (produit supprimé) : à vérifier", () => {
    expect(needsReview({ match_status: "confirmed", catalog_products: null })).toBe(true);
  });

  test("statut absent : à vérifier", () => {
    expect(needsReview({ match_status: null, catalog_products: { id: "p" } })).toBe(true);
  });

  test("même définition que rowStatus de la vue projet sur toutes les combinaisons", () => {
    for (const status of ["confirmed", "review", "unmatched"]) {
      for (const product of [null, { id: "p" }]) {
        const line = { match_status: status, catalog_products: product };
        expect(needsReview(line)).toBe(rowStatus(line as unknown as MatchingLine) !== "confirmed");
      }
    }
  });

  test("countToReview", () => {
    expect(countToReview([ok("1"), review("2"), unmatched("3"), ok("4")])).toBe(2);
    expect(countToReview([])).toBe(0);
  });
});

describe("nextToReview", () => {
  const lines = [ok("a"), review("b"), ok("c"), unmatched("d"), ok("e")];

  test("prend la première ligne à vérifier après la ligne courante", () => {
    expect(nextToReview(lines, "a")).toEqual({ id: "b", index: 1, page: 1 });
    expect(nextToReview(lines, "b")).toEqual({ id: "d", index: 3, page: 1 });
    expect(nextToReview(lines, "c")).toEqual({ id: "d", index: 3, page: 1 });
  });

  test("boucle au début après la dernière ligne à vérifier", () => {
    expect(nextToReview(lines, "d")).toEqual({ id: "b", index: 1, page: 1 });
    expect(nextToReview(lines, "e")).toEqual({ id: "b", index: 1, page: 1 });
  });

  test("seule ligne à vérifier = la ligne courante : elle est renvoyée (bouclage complet)", () => {
    const only = [ok("a"), review("b"), ok("c")];
    expect(nextToReview(only, "b")).toEqual({ id: "b", index: 1, page: 1 });
  });

  test("aucune ligne à vérifier ou liste vide : null", () => {
    expect(nextToReview([ok("a"), ok("b")], "a")).toBeNull();
    expect(nextToReview([ok("a"), ok("b")], null)).toBeNull();
    expect(nextToReview([], "a")).toBeNull();
    expect(nextToReview([], null)).toBeNull();
  });

  test("sans ligne courante : part du haut de la page affichée, inclus", () => {
    const many = Array.from({ length: 6 }, (_, i) => (i === 0 || i === 3 ? review : ok)(`l${i}`));
    expect(nextToReview(many, null, { page: 1, pageSize: 2 })).toEqual({
      id: "l0",
      index: 0,
      page: 1,
    });
    expect(nextToReview(many, null, { page: 2, pageSize: 2 })).toEqual({
      id: "l3",
      index: 3,
      page: 2,
    });
  });

  test("ligne courante absente de la liste filtrée : même départ que sans ligne courante", () => {
    const filtered = [ok("a"), review("b"), review("c")];
    expect(nextToReview(filtered, "disparue", { page: 1, pageSize: 10 })).toEqual({
      id: "b",
      index: 1,
      page: 1,
    });
    const paged = [review("a"), ok("b"), review("c"), ok("d")];
    expect(nextToReview(paged, "disparue", { page: 2, pageSize: 2 })).toEqual({
      id: "c",
      index: 2,
      page: 2,
    });
  });

  test("renvoie la page qui contient la ligne trouvée (changement de page)", () => {
    const paged = [ok("a"), ok("b"), ok("c"), ok("d"), review("e"), ok("f")];
    expect(nextToReview(paged, "a", { page: 1, pageSize: 2 })).toEqual({
      id: "e",
      index: 4,
      page: 3,
    });
    expect(nextToReview(paged, "f", { page: 3, pageSize: 2 })).toEqual({
      id: "e",
      index: 4,
      page: 3,
    });
    const back = [review("a"), ok("b"), ok("c"), ok("d")];
    expect(nextToReview(back, "d", { page: 2, pageSize: 2 })).toEqual({
      id: "a",
      index: 0,
      page: 1,
    });
  });

  test("page hors limite : ramenée dans les bornes (trop grande, nulle, négative, NaN)", () => {
    const paged = [review("a"), ok("b"), ok("c"), review("d")];
    expect(nextToReview(paged, null, { page: 99, pageSize: 2 })?.id).toBe("d");
    expect(nextToReview(paged, null, { page: 0, pageSize: 2 })?.id).toBe("a");
    expect(nextToReview(paged, null, { page: -3, pageSize: 2 })?.id).toBe("a");
    expect(nextToReview(paged, null, { page: Number.NaN, pageSize: 2 })?.id).toBe("a");
  });

  test("taille de page invalide : traitée comme une page d'une ligne ; absente : une seule page", () => {
    const paged = [ok("a"), review("b")];
    expect(nextToReview(paged, "a", { pageSize: 0 })).toEqual({ id: "b", index: 1, page: 2 });
    expect(nextToReview(paged, "a")).toEqual({ id: "b", index: 1, page: 1 });
  });

  test("respecte les filtres : seule la liste filtrée est parcourue", () => {
    const base = (id: string, supplier: string, over: Partial<MatchingLine> = {}) =>
      ({
        id,
        invoice_id: `inv-${supplier}`,
        match_status: "review",
        catalog_products: { id: "p", ozego_id: null },
        invoices: { supplier_name: supplier, file_name: null },
        label: id,
        supplier_reference: null,
        ...over,
      }) as unknown as MatchingLine;
    const all = [
      base("a1", "Metro"),
      base("b1", "Sysco"),
      base("a2", "Metro", { match_status: "confirmed" }),
      base("b2", "Sysco"),
    ];
    const metro = filterLines(all, { ...DEFAULT_FILTERS, supplier: "Metro" });
    expect(metro.map((l) => l.id)).toEqual(["a1", "a2"]);
    expect(nextToReview(metro, "a2")).toEqual({ id: "a1", index: 0, page: 1 });
    const validated = filterLines(all, { ...DEFAULT_FILTERS, validation: "validated" });
    expect(nextToReview(validated, null)).toBeNull();
  });
});

describe("raccourci n", () => {
  const nothingOpen = { querySelector: () => null };
  const event = (over: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
    key: "n",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    target: { tagName: "BODY", closest: () => null },
    ...over,
  });

  test("n seul, hors saisie : déclenché (majuscule comprise)", () => {
    expect(isNextShortcut(event(), nothingOpen)).toBe(true);
    expect(isNextShortcut(event({ key: "N" }), nothingOpen)).toBe(true);
    expect(isNextShortcut(event({ target: null }), nothingOpen)).toBe(true);
  });

  test("autre touche ou modificateur : ignoré", () => {
    expect(isNextShortcut(event({ key: "m" }), nothingOpen)).toBe(false);
    expect(isNextShortcut(event({ ctrlKey: true }), nothingOpen)).toBe(false);
    expect(isNextShortcut(event({ metaKey: true }), nothingOpen)).toBe(false);
    expect(isNextShortcut(event({ altKey: true }), nothingOpen)).toBe(false);
    expect(isNextShortcut(event({ repeat: true }), nothingOpen)).toBe(false);
    expect(isNextShortcut(event({ defaultPrevented: true }), nothingOpen)).toBe(false);
  });

  test("focus dans un champ de saisie, un select ou un contenteditable : ignoré", () => {
    for (const tagName of ["INPUT", "textarea", "SELECT"]) {
      expect(isTypingTarget({ tagName })).toBe(true);
      expect(isNextShortcut(event({ target: { tagName } }), nothingOpen)).toBe(false);
    }
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  test("focus dans un select Radix (combobox), un menu ou une boîte de dialogue : ignoré", () => {
    const inside = { tagName: "BUTTON", closest: () => ({}) };
    expect(isTypingTarget(inside)).toBe(true);
    expect(isNextShortcut(event({ target: inside }), nothingOpen)).toBe(false);
  });

  test("bouton ou lien ordinaire : pas une saisie", () => {
    expect(isTypingTarget({ tagName: "BUTTON", closest: () => null })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  test("dialogue, popover ou liste ouverts dans la page : ignoré même si le focus est ailleurs", () => {
    const open = { querySelector: () => ({}) };
    expect(hasOpenOverlay(open)).toBe(true);
    expect(hasOpenOverlay(nothingOpen)).toBe(false);
    expect(isNextShortcut(event(), open)).toBe(false);
  });
});
