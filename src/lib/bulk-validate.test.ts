import { describe, expect, test } from "bun:test";

import {
  chunk,
  distinctCacheContexts,
  effectiveSelection,
  failureDetails,
  headerCheckState,
  isBulkValidatable,
  mergeSummaries,
  needsBulkConfirmation,
  parseThreshold,
  runBulkUndo,
  runBulkValidation,
  selectAtOrAboveScore,
  summaryMessage,
  togglePageSelection,
  type BulkLine,
} from "./bulk-validate";
import {
  confirmLineAction,
  restoreLineAction,
  restoreUpdate,
  type ActionResult,
  type LineSnapshot,
} from "./line-actions";

function line(id: string, overrides: Partial<BulkLine> = {}): BulkLine {
  return {
    id,
    label: `Ligne ${id}`,
    supplier_reference: `REF-${id}`,
    catalog_products: { id: `p-${id}` },
    matched_product_id: `p-${id}`,
    match_status: "auto",
    match_method: "référence",
    match_score: 0.92,
    manual_override: false,
    validated_stage: null,
    pack_factor: 1,
    ...overrides,
  };
}

const ok: ActionResult = { changed: true, error: null };

describe("isBulkValidatable", () => {
  test("une ligne rapprochée et non confirmée est validable", () => {
    expect(isBulkValidatable(line("a"), "fournisseur")).toBe(true);
  });

  test("sans produit rapproché : jamais", () => {
    expect(isBulkValidatable(line("a", { catalog_products: null }), "fournisseur")).toBe(false);
  });

  test("déjà confirmée : jamais", () => {
    expect(isBulkValidatable(line("a", { match_status: "confirmed" }), "fournisseur")).toBe(false);
  });

  test("verrouillée par une étape précédente : jamais", () => {
    expect(isBulkValidatable(line("a", { validated_stage: "fournisseur" }), "ozego")).toBe(false);
    expect(isBulkValidatable(line("a", { validated_stage: "ozego" }), "ozego-preferes")).toBe(
      false,
    );
  });

  test("validée à l'étape courante ou à une étape suivante : pas verrouillée", () => {
    expect(isBulkValidatable(line("a", { validated_stage: "ozego" }), "fournisseur")).toBe(true);
  });
});

describe("selectAtOrAboveScore", () => {
  const lines = [
    line("a", { match_score: 0.95 }),
    line("b", { match_score: 0.9 }),
    line("c", { match_score: 0.89 }),
    line("d", { match_score: null }),
    line("e", { match_score: 0.99, match_status: "confirmed" }),
    line("f", { match_score: 0.99, catalog_products: null }),
    line("g", { match_score: 0.99, validated_stage: "fournisseur" }),
  ];

  test("seuil inclus, scores absents et lignes non validables exclus", () => {
    const ids = selectAtOrAboveScore(lines, 0.9, "fournisseur").map((item) => item.id);
    expect(ids).toEqual(["a", "b", "g"]);
  });

  test("une ligne verrouillée à une étape ultérieure n'est jamais sélectionnée", () => {
    const ids = selectAtOrAboveScore(lines, 0.9, "ozego").map((item) => item.id);
    expect(ids).toEqual(["a", "b"]);
  });

  test("seuils 70, 80, 90 et 95 %", () => {
    const counts = [0.7, 0.8, 0.9, 0.95].map(
      (threshold) => selectAtOrAboveScore(lines, threshold, "fournisseur").length,
    );
    expect(counts).toEqual([4, 4, 3, 2]);
  });

  test("un score de 0,9 stocké en flottant atteint le seuil de 90 %", () => {
    const sums = line("x", { match_score: 0.9 - 1e-12 });
    expect(selectAtOrAboveScore([sums], 0.9, "fournisseur")).toHaveLength(1);
  });

  test("parseThreshold retombe sur 90 % pour une valeur inconnue", () => {
    expect(parseThreshold("0.95")).toBe(0.95);
    expect(parseThreshold("0.5")).toBe(0.9);
    expect(parseThreshold("abc")).toBe(0.9);
  });
});

describe("chunk et confirmation", () => {
  test("découpe en lots de N, le dernier plus court", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });

  test("la confirmation est demandée au-delà de 20 lignes", () => {
    expect(needsBulkConfirmation(20)).toBe(false);
    expect(needsBulkConfirmation(21)).toBe(true);
  });
});

describe("sélection", () => {
  test("case d'en-tête : vide, indéterminée, cochée", () => {
    const ids = ["a", "b", "c"];
    expect(headerCheckState(ids, new Set())).toBe(false);
    expect(headerCheckState(ids, new Set(["a"]))).toBe("indeterminate");
    expect(headerCheckState(ids, new Set(["a", "b", "c", "z"]))).toBe(true);
    expect(headerCheckState([], new Set(["a"]))).toBe(false);
  });

  test("tout cocher sur la page garde les autres pages, tout décocher aussi", () => {
    const selected = new Set(["other"]);
    const checked = togglePageSelection(selected, ["a", "b"], true);
    expect([...checked].sort()).toEqual(["a", "b", "other"]);
    const unchecked = togglePageSelection(checked, ["a", "b"], false);
    expect([...unchecked]).toEqual(["other"]);
    expect([...selected]).toEqual(["other"]);
  });

  test("une ligne cochée devenue confirmée ou verrouillée sort de la sélection effective", () => {
    const lines = [
      line("a"),
      line("b", { match_status: "confirmed" }),
      line("c", { validated_stage: "fournisseur" }),
    ];
    const selected = new Set(["a", "b", "c", "disparue"]);
    expect(effectiveSelection(lines, selected, "ozego").map((item) => item.id)).toEqual(["a"]);
    expect(effectiveSelection(lines, selected, "fournisseur").map((item) => item.id)).toEqual([
      "a",
      "c",
    ]);
  });
});

describe("runBulkValidation", () => {
  test("lots de taille N enchaînés, progression et lignes ignorées jamais envoyées", async () => {
    const lines = [
      ...Array.from({ length: 7 }, (_, index) => line(`l${index}`)),
      line("done", { match_status: "confirmed" }),
      line("locked", { validated_stage: "fournisseur" }),
      line("none", { catalog_products: null }),
    ];
    const sent: string[] = [];
    const progress: Array<[number, number]> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const run = await runBulkValidation(lines, {
      stage: "ozego",
      batchSize: 3,
      confirm: async (item) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        sent.push(item.id);
        inFlight -= 1;
        return ok;
      },
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(sent.sort()).toEqual(["l0", "l1", "l2", "l3", "l4", "l5", "l6"]);
    expect(maxInFlight).toBe(3);
    expect(progress).toEqual([
      [0, 7],
      [3, 7],
      [6, 7],
      [7, 7],
    ]);
    expect(run.validated).toHaveLength(7);
    expect(run.failed).toEqual([]);
  });

  test("erreurs partielles : consignées, la suite continue, pas de snapshot pour les échecs", async () => {
    const lines = ["a", "b", "c", "d"].map((id) => line(id));
    const run = await runBulkValidation(lines, {
      stage: "fournisseur",
      batchSize: 2,
      confirm: async (item) => {
        if (item.id === "b") return { changed: false, error: "RLS refuse" };
        if (item.id === "c") throw new Error("réseau coupé");
        return ok;
      },
    });
    expect(run.validated).toEqual(["a", "d"]);
    expect(run.failed).toEqual([
      { id: "b", message: "RLS refuse" },
      { id: "c", message: "réseau coupé" },
    ]);
    expect([...run.snapshots.keys()]).toEqual(["a", "d"]);
    expect(summaryMessage(run)).toBe("2 lignes validées, 2 en erreur");
  });

  test("le snapshot est celui d'avant l'écriture, même si la ligne change ensuite", async () => {
    const original = line("a", { match_score: 0.8, pack_factor: 6, manual_override: false });
    const run = await runBulkValidation([original], {
      stage: "fournisseur",
      confirm: async (item) => {
        item.match_status = "confirmed";
        item.manual_override = true;
        item.validated_stage = "fournisseur";
        return ok;
      },
    });
    expect(run.snapshots.get("a")).toEqual({
      matched_product_id: "p-a",
      match_status: "auto",
      match_method: "référence",
      match_score: 0.8,
      manual_override: false,
      validated_stage: null,
      pack_factor: 6,
    });
  });

  test("écrit la même mise à jour que le bouton Valider (confirmLineAction)", async () => {
    const writes: Array<{ payload: unknown; id: unknown }> = [];
    const client = {
      from: () => ({
        update: (payload: unknown) => ({
          eq: (_column: string, id: unknown) => {
            writes.push({ payload, id });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    await runBulkValidation([line("a"), line("b")], {
      stage: "fournisseur",
      confirm: (item) => confirmLineAction(client as never, item as never),
    });
    expect(writes).toEqual([
      {
        id: "a",
        payload: {
          match_status: "confirmed",
          manual_override: true,
          validated_stage: "fournisseur",
        },
      },
      {
        id: "b",
        payload: {
          match_status: "confirmed",
          manual_override: true,
          validated_stage: "fournisseur",
        },
      },
    ]);
  });
});

describe("runBulkUndo", () => {
  test("restaure exactement les snapshots pris avant, ligne par ligne", async () => {
    const lines = [
      line("a", { match_score: 0.91, pack_factor: 12 }),
      line("b", { match_score: 0.97, match_method: "libellé", manual_override: true }),
      line("c", { match_status: "confirmed" }),
    ];
    const run = await runBulkValidation(lines, { stage: "fournisseur", confirm: async () => ok });
    expect([...run.snapshots.keys()]).toEqual(["a", "b"]);

    const writes: Array<{ id: unknown; payload: unknown }> = [];
    const client = {
      from: () => ({
        update: (payload: unknown) => ({
          eq: (_column: string, id: unknown) => {
            writes.push({ id, payload });
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    const undo = await runBulkUndo(
      run.snapshots,
      (id, snapshot) => restoreLineAction(client as never, { id }, snapshot),
      1,
    );
    expect(undo.validated).toEqual(["a", "b"]);
    expect(undo.failed).toEqual([]);
    expect(writes).toEqual([
      { id: "a", payload: restoreUpdate(run.snapshots.get("a")!) },
      { id: "b", payload: restoreUpdate(run.snapshots.get("b")!) },
    ]);
    expect(writes[0]!.payload).toEqual({
      matched_product_id: "p-a",
      match_status: "auto",
      match_method: "référence",
      match_score: 0.91,
      manual_override: false,
      validated_stage: null,
      pack_factor: 12,
    });
  });

  test("une erreur de restauration est consignée sans arrêter les autres", async () => {
    const snapshots = new Map<string, LineSnapshot>([
      ["a", line("a")],
      ["b", line("b")],
      ["c", line("c")],
    ]);
    const undo = await runBulkUndo(
      snapshots,
      async (id) => (id === "b" ? { changed: false, error: "refusé" } : ok),
      2,
    );
    expect(undo.validated).toEqual(["a", "c"]);
    expect(undo.failed).toEqual([{ id: "b", message: "refusé" }]);
  });
});

describe("résumés", () => {
  test("message : singulier, pluriel, erreurs", () => {
    expect(summaryMessage({ validated: ["a"], failed: [] })).toBe("1 ligne validée");
    expect(summaryMessage({ validated: ["a", "b"], failed: [] })).toBe("2 lignes validées");
    expect(
      summaryMessage({ validated: ["a", "b", "c"], failed: [{ id: "d", message: "x" }] }),
    ).toBe("3 lignes validées, 1 en erreur");
  });

  test("fusion de résumés et détail des erreurs", () => {
    const merged = mergeSummaries(
      { validated: ["a"], failed: [{ id: "x", message: "m1" }] },
      { validated: ["b"], failed: [{ id: "y", message: "m2" }] },
    );
    expect(merged.validated).toEqual(["a", "b"]);
    expect(failureDetails(merged.failed, (id) => `ligne ${id}`)).toEqual([
      "ligne x : m1",
      "ligne y : m2",
    ]);
  });

  test("une seule entrée d'invalidation par facture", () => {
    const contexts = distinctCacheContexts([
      { invoiceId: "i1", prospectId: "p" },
      { invoiceId: "i2", prospectId: "p" },
      { invoiceId: "i1", prospectId: "p" },
    ]);
    expect(contexts.map((context) => context.invoiceId)).toEqual(["i1", "i2"]);
  });
});
