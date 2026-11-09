import { describe, expect, test } from "bun:test";

import { euro } from "./format";
import { comparerHint, stepperState, summarizeLines, type Step } from "./stepper";

const base = {
  invoiceCount: 0,
  lineCount: 0,
  matchedCount: 0,
  toReviewCount: 0,
  isExpert: true,
};

const byId = (steps: Step[], id: Step["id"]) => steps.find((step) => step.id === id)!;
const statuses = (steps: Step[]) => steps.map((step) => `${step.id}:${step.status}`);

describe("stepperState : aucune facture", () => {
  const steps = stepperState(base);

  test("trois étapes, Importer est la courante et vide", () => {
    expect(statuses(steps)).toEqual([
      "importer:current",
      "rapprocher:upcoming",
      "comparer:upcoming",
    ]);
    expect(byId(steps, "importer").detail).toBe("Aucune facture");
  });

  test("seul Importer est activable", () => {
    expect(steps.map((step) => step.enabled)).toEqual([true, false, false]);
  });
});

describe("stepperState : factures sans lignes", () => {
  test("Importer terminée au singulier, Rapprocher courante mais sans ligne", () => {
    const steps = stepperState({ ...base, invoiceCount: 1 });
    expect(statuses(steps)).toEqual(["importer:done", "rapprocher:current", "comparer:upcoming"]);
    expect(byId(steps, "importer").detail).toBe("1 facture");
    expect(byId(steps, "rapprocher").detail).toBe("Aucune ligne extraite");
    expect(steps.map((step) => step.enabled)).toEqual([true, true, false]);
  });

  test("pluriel", () => {
    expect(byId(stepperState({ ...base, invoiceCount: 3 }), "importer").detail).toBe("3 factures");
  });
});

describe("stepperState : rapprochement en cours", () => {
  const steps = stepperState({
    ...base,
    invoiceCount: 2,
    lineCount: 10,
    matchedCount: 7,
    toReviewCount: 4,
  });

  test("compteurs et à vérifier", () => {
    expect(byId(steps, "rapprocher").detail).toBe("7/10 lignes rapprochées · 4 à vérifier");
  });

  test("Rapprocher courante, Comparer activable dès une ligne rapprochée mais pas courante", () => {
    expect(statuses(steps)).toEqual(["importer:done", "rapprocher:current", "comparer:upcoming"]);
    expect(byId(steps, "comparer").enabled).toBe(true);
  });

  test("une seule ligne rapprochée suffit à activer Comparer", () => {
    const one = stepperState({
      ...base,
      invoiceCount: 1,
      lineCount: 5,
      matchedCount: 1,
      toReviewCount: 4,
    });
    expect(byId(one, "comparer").enabled).toBe(true);
    const none = stepperState({
      ...base,
      invoiceCount: 1,
      lineCount: 5,
      matchedCount: 0,
      toReviewCount: 5,
    });
    expect(byId(none, "comparer").enabled).toBe(false);
  });
});

describe("stepperState : tout rapproché", () => {
  const steps = stepperState({
    ...base,
    invoiceCount: 2,
    lineCount: 10,
    matchedCount: 10,
    toReviewCount: 0,
    comparerGap: -123.4,
  });

  test("Importer et Rapprocher terminées, Comparer courante", () => {
    expect(statuses(steps)).toEqual(["importer:done", "rapprocher:done", "comparer:current"]);
    expect(byId(steps, "rapprocher").detail).toBe("10/10 lignes rapprochées");
  });

  test("Comparer affiche l'écart déjà calculé", () => {
    expect(byId(steps, "comparer").detail).toBe(`Surcoût potentiel ${euro(123.4)}`);
    expect(steps.every((step) => step.enabled)).toBe(true);
  });

  test("une seule ligne : singulier", () => {
    const one = stepperState({ ...base, invoiceCount: 1, lineCount: 1, matchedCount: 1 });
    expect(byId(one, "rapprocher").detail).toBe("1/1 ligne rapprochée");
  });
});

describe("stepperState : tout à vérifier", () => {
  test("lignes avec produit mais toutes à vérifier : Rapprocher n'est pas terminée", () => {
    const steps = stepperState({
      ...base,
      invoiceCount: 1,
      lineCount: 4,
      matchedCount: 4,
      toReviewCount: 4,
    });
    expect(byId(steps, "rapprocher").status).toBe("current");
    expect(byId(steps, "rapprocher").detail).toBe("4/4 lignes rapprochées · 4 à vérifier");
    expect(byId(steps, "comparer").status).toBe("upcoming");
  });

  test("aucune ligne rapprochée : 0/N et tout à vérifier, Comparer verrouillée", () => {
    const steps = stepperState({
      ...base,
      invoiceCount: 1,
      lineCount: 6,
      matchedCount: 0,
      toReviewCount: 6,
    });
    expect(byId(steps, "rapprocher").detail).toBe("0/6 lignes rapprochées · 6 à vérifier");
    expect(byId(steps, "comparer").enabled).toBe(false);
    expect(byId(steps, "comparer").detail).toBeNull();
  });
});

describe("stepperState : commercial", () => {
  test("seule l'étape Importer, jamais de détail sur les lignes", () => {
    const steps = stepperState({
      ...base,
      invoiceCount: 2,
      lineCount: 10,
      matchedCount: 10,
      isExpert: false,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      id: "importer",
      label: "Importer",
      status: "done",
      detail: "2 factures",
      enabled: true,
    });
  });

  test("commercial sans facture : Importer courante", () => {
    expect(stepperState({ ...base, isExpert: false })[0]!.status).toBe("current");
  });
});

describe("comparerHint", () => {
  test("écart négatif : surcoût ; positif ou nul : économie ; absent : rien", () => {
    expect(comparerHint(-50)).toBe(`Surcoût potentiel ${euro(50)}`);
    expect(comparerHint(50)).toBe(`Économie potentielle ${euro(50)}`);
    expect(comparerHint(0)).toBe(`Économie potentielle ${euro(0)}`);
    expect(comparerHint(null)).toBeNull();
    expect(comparerHint(undefined)).toBeNull();
    expect(comparerHint(Number.NaN)).toBeNull();
  });
});

describe("summarizeLines", () => {
  test("compte lignes, lignes avec produit et lignes à vérifier", () => {
    const lines = [
      { match_status: "confirmed", catalog_products: {} },
      { match_status: "review", catalog_products: {} },
      { match_status: "unmatched", catalog_products: null },
      { match_status: "confirmed", catalog_products: {} },
    ];
    expect(summarizeLines(lines)).toEqual({ lineCount: 4, matchedCount: 3, toReviewCount: 2 });
    expect(summarizeLines([])).toEqual({ lineCount: 0, matchedCount: 0, toReviewCount: 0 });
  });
});
