import { describe, expect, test } from "bun:test";

import {
  applyMatchAction,
  confirmLineAction,
  confirmUpdate,
  deleteLineAction,
  isLineLocked,
  lineCacheKeys,
  matchUpdate,
  restoreLineAction,
  restoreUpdate,
  savePackFactorAction,
  shouldLearnMapping,
  snapshotForUndo,
  STAGE_ORDER,
  stageLabel,
  undeleteLineAction,
  type ActionLine,
  type LineContext,
  type LineSnapshot,
} from "./line-actions";

type Call = {
  table: string;
  op: "update" | "insert" | "select";
  payload: unknown;
  filters: Array<[string, string, unknown]>;
};

function fakeClient(
  options: { found?: { id: string } | null; errors?: Record<string, string> } = {},
) {
  const calls: Call[] = [];
  const failure = (table: string, op: string) => {
    const message = options.errors?.[`${table}.${op}`];
    return message ? { message } : null;
  };
  const client = {
    from(table: string) {
      return {
        update(payload: unknown) {
          const call: Call = { table, op: "update", payload, filters: [] };
          calls.push(call);
          return {
            eq(column: string, value: unknown) {
              call.filters.push(["eq", column, value]);
              return Promise.resolve({ error: failure(table, "update") });
            },
          };
        },
        insert(payload: unknown) {
          calls.push({ table, op: "insert", payload, filters: [] });
          return Promise.resolve({ error: failure(table, "insert") });
        },
        select(columns: string) {
          const call: Call = { table, op: "select", payload: columns, filters: [] };
          calls.push(call);
          const builder = {
            ilike(column: string, value: string) {
              call.filters.push(["ilike", column, value]);
              return builder;
            },
            is(column: string, value: unknown) {
              call.filters.push(["is", column, value]);
              return builder;
            },
            maybeSingle() {
              return Promise.resolve({
                data: options.found ?? null,
                error: failure(table, "select"),
              });
            },
          };
          return builder;
        },
      };
    },
  };
  return { client: client as unknown as Parameters<typeof applyMatchAction>[0], calls };
}

const line = (over: Partial<ActionLine> = {}): ActionLine => ({
  id: "line-1",
  supplier_reference: "REF-9",
  label: "ECHALOTE 5KG",
  pack_factor: 6,
  matched_product_id: "prod-old",
  ...over,
});

const context: LineContext = { invoiceId: "inv-1", prospectId: "pro-1", supplierName: "Metro" };

describe("STAGE_ORDER / isLineLocked", () => {
  test("ordre fixe fournisseur, ozego, ozego-preferes", () => {
    expect([...STAGE_ORDER]).toEqual(["fournisseur", "ozego", "ozego-preferes"]);
  });

  test("validée à fournisseur : verrouillée sur ozego et ozego-preferes, pas sur fournisseur", () => {
    const validated = { validated_stage: "fournisseur" };
    expect(isLineLocked(validated, "fournisseur")).toBe(false);
    expect(isLineLocked(validated, "ozego")).toBe(true);
    expect(isLineLocked(validated, "ozego-preferes")).toBe(true);
  });

  test("validée à ozego : verrouillée sur ozego-preferes seulement", () => {
    const validated = { validated_stage: "ozego" };
    expect(isLineLocked(validated, "fournisseur")).toBe(false);
    expect(isLineLocked(validated, "ozego")).toBe(false);
    expect(isLineLocked(validated, "ozego-preferes")).toBe(true);
  });

  test("validée à ozego-preferes : jamais verrouillée", () => {
    for (const stage of STAGE_ORDER) {
      expect(isLineLocked({ validated_stage: "ozego-preferes" }, stage)).toBe(false);
    }
  });

  test("non validée ou étape inconnue (ex. ancienne étape supprimée) : jamais verrouillée", () => {
    for (const stage of STAGE_ORDER) {
      expect(isLineLocked({ validated_stage: null }, stage)).toBe(false);
      expect(isLineLocked({ validated_stage: "ozego-meme" }, stage)).toBe(false);
    }
  });

  test("à l'étape fournisseur (celle de la vue prospect), aucune ligne n'est jamais verrouillée", () => {
    for (const stage of [null, ...STAGE_ORDER]) {
      expect(isLineLocked({ validated_stage: stage }, "fournisseur")).toBe(false);
    }
  });

  test("stageLabel", () => {
    expect(stageLabel(null)).toBeNull();
    expect(stageLabel("fournisseur")).toBe("Référence fournisseur");
    expect(stageLabel("ozego-preferes")).toBe("Ozego · Fournisseurs préférés");
    expect(stageLabel("autre")).toBe("autre");
  });
});

describe("décisions d'écriture", () => {
  test("rapprochement manuel : confirmé, méthode manuel, score 1, étape courante", () => {
    expect(matchUpdate({ id: "p1" }, "ozego")).toEqual({
      matched_product_id: "p1",
      match_status: "confirmed",
      match_method: "manuel",
      match_score: 1,
      manual_override: true,
      validated_stage: "ozego",
    });
  });

  test("retrait : non rapproché, méthode/score/étape effacés, manual_override conservé à true", () => {
    expect(matchUpdate(null, "fournisseur")).toEqual({
      matched_product_id: null,
      match_status: "unmatched",
      match_method: null,
      match_score: null,
      manual_override: true,
      validated_stage: null,
    });
  });

  test("validation : confirmé à l'étape fournisseur sans toucher au produit", () => {
    expect(confirmUpdate()).toEqual({
      match_status: "confirmed",
      manual_override: true,
      validated_stage: "fournisseur",
    });
  });

  test("apprentissage uniquement avec un produit et une référence ou un libellé", () => {
    expect(shouldLearnMapping(line(), { id: "p" })).toBe(true);
    expect(shouldLearnMapping(line(), null)).toBe(false);
    expect(shouldLearnMapping(line({ supplier_reference: null, label: "" }), { id: "p" })).toBe(
      false,
    );
    expect(shouldLearnMapping(line({ supplier_reference: null }), { id: "p" })).toBe(true);
  });
});

describe("applyMatchAction", () => {
  test("retrait : une seule écriture invoice_lines, aucun accès à product_mappings", async () => {
    const { client, calls } = fakeClient();
    const result = await applyMatchAction(client, line(), context, null, "fournisseur");
    expect(result).toEqual({ changed: true, error: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      table: "invoice_lines",
      op: "update",
      payload: matchUpdate(null, "fournisseur"),
      filters: [["eq", "id", "line-1"]],
    });
  });

  test("nouveau produit sans mapping existant : met à jour la ligne puis insère le mapping", async () => {
    const { client, calls } = fakeClient({ found: null });
    const result = await applyMatchAction(
      client,
      line(),
      context,
      { id: "prod-new" },
      "fournisseur",
    );
    expect(result).toEqual({ changed: true, error: null });
    expect(calls[0]!.payload).toEqual(matchUpdate({ id: "prod-new" }, "fournisseur"));
    const select = calls[1]!;
    expect(select.table).toBe("product_mappings");
    expect(select.filters).toEqual([
      ["ilike", "supplier_name", "Metro"],
      ["ilike", "supplier_reference", "REF-9"],
    ]);
    expect(calls[2]).toEqual({
      table: "product_mappings",
      op: "insert",
      payload: {
        supplier_name: "Metro",
        supplier_reference: "REF-9",
        supplier_label: "ECHALOTE 5KG",
        product_id: "prod-new",
        pack_factor: 6,
      },
      filters: [],
    });
  });

  test("mapping existant : mise à jour du produit et du facteur, pas d'insertion", async () => {
    const { client, calls } = fakeClient({ found: { id: "map-1" } });
    await applyMatchAction(client, line({ pack_factor: 0 }), context, { id: "prod-new" }, "ozego");
    expect(calls.map((c) => c.op)).toEqual(["update", "select", "update"]);
    expect(calls[2]).toEqual({
      table: "product_mappings",
      op: "update",
      payload: { product_id: "prod-new", pack_factor: 1 },
      filters: [["eq", "id", "map-1"]],
    });
  });

  test("sans fournisseur de facture ni référence : clé = supplier_name null + libellé", async () => {
    const { client, calls } = fakeClient({ found: null });
    await applyMatchAction(
      client,
      line({ supplier_reference: null }),
      { ...context, supplierName: null },
      { id: "p" },
      "fournisseur",
    );
    expect(calls[1]!.filters).toEqual([
      ["is", "supplier_name", null],
      ["ilike", "supplier_label", "ECHALOTE 5KG"],
    ]);
  });

  test("erreur sur la ligne : remontée, rien d'autre n'est écrit, pas de rafraîchissement", async () => {
    const { client, calls } = fakeClient({ errors: { "invoice_lines.update": "RLS denied" } });
    const result = await applyMatchAction(client, line(), context, { id: "p" }, "fournisseur");
    expect(result).toEqual({ changed: false, error: "RLS denied" });
    expect(calls).toHaveLength(1);
  });

  test("erreur d'apprentissage : remontée (jamais avalée) et la ligne reste à rafraîchir", async () => {
    const { client } = fakeClient({ found: null, errors: { "product_mappings.insert": "boom" } });
    const result = await applyMatchAction(client, line(), context, { id: "p" }, "fournisseur");
    expect(result.changed).toBe(true);
    expect(result.error).toContain("boom");
    expect(result.error).toContain("apprentissage");
  });

  test("erreur de recherche du mapping : remontée", async () => {
    const { client, calls } = fakeClient({
      errors: { "product_mappings.select": "multiple rows" },
    });
    const result = await applyMatchAction(client, line(), context, { id: "p" }, "fournisseur");
    expect(result.changed).toBe(true);
    expect(result.error).toContain("multiple rows");
    expect(calls.map((c) => c.op)).toEqual(["update", "select"]);
  });
});

describe("confirmLineAction / deleteLineAction", () => {
  test("validation : écrit exactement confirmUpdate sur la ligne", async () => {
    const { client, calls } = fakeClient();
    expect(await confirmLineAction(client, line())).toEqual({ changed: true, error: null });
    expect(calls).toEqual([
      {
        table: "invoice_lines",
        op: "update",
        payload: confirmUpdate(),
        filters: [["eq", "id", "line-1"]],
      },
    ]);
  });

  test("suppression : soft delete excluded = true", async () => {
    const { client, calls } = fakeClient();
    expect(await deleteLineAction(client, line())).toEqual({ changed: true, error: null });
    expect(calls[0]!.payload).toEqual({ excluded: true });
  });

  test("les erreurs sont remontées", async () => {
    const { client } = fakeClient({ errors: { "invoice_lines.update": "nope" } });
    expect(await confirmLineAction(client, line())).toEqual({ changed: false, error: "nope" });
    expect(await deleteLineAction(client, line())).toEqual({ changed: false, error: "nope" });
  });
});

describe("savePackFactorAction", () => {
  test("normalise la valeur, met à jour la ligne puis le facteur du mapping existant", async () => {
    const { client, calls } = fakeClient({ found: { id: "map-1" } });
    const result = await savePackFactorAction(client, line(), context, "12,5" as unknown as number);
    expect(result).toEqual({ changed: true, error: null });
    expect(calls[0]!.payload).toEqual({ pack_factor: 12.5 });
    expect(calls[2]).toEqual({
      table: "product_mappings",
      op: "update",
      payload: { pack_factor: 12.5 },
      filters: [["eq", "id", "map-1"]],
    });
  });

  test("valeur invalide ou nulle : retombe sur 1", async () => {
    const { client, calls } = fakeClient({ found: { id: "m" } });
    await savePackFactorAction(client, line(), context, 0);
    expect(calls[0]!.payload).toEqual({ pack_factor: 1 });
  });

  test("sans mapping existant : insère avec le produit rapproché de la ligne", async () => {
    const { client, calls } = fakeClient({ found: null });
    await savePackFactorAction(client, line(), context, 3);
    expect(calls[2]).toEqual({
      table: "product_mappings",
      op: "insert",
      payload: {
        supplier_name: "Metro",
        supplier_reference: "REF-9",
        supplier_label: "ECHALOTE 5KG",
        product_id: "prod-old",
        pack_factor: 3,
      },
      filters: [],
    });
  });

  test("ligne non rapprochée : seul le facteur de la ligne est écrit", async () => {
    const { client, calls } = fakeClient();
    await savePackFactorAction(client, line({ matched_product_id: null }), context, 3);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("invoice_lines");
  });

  test("erreurs remontées : ligne puis apprentissage", async () => {
    const first = fakeClient({ errors: { "invoice_lines.update": "locked" } });
    expect(await savePackFactorAction(first.client, line(), context, 3)).toEqual({
      changed: false,
      error: "locked",
    });
    expect(first.calls).toHaveLength(1);

    const second = fakeClient({
      found: { id: "m" },
      errors: { "product_mappings.update": "denied" },
    });
    const result = await savePackFactorAction(second.client, line(), context, 3);
    expect(result.changed).toBe(true);
    expect(result.error).toContain("denied");
  });
});

describe("lineCacheKeys", () => {
  test("rafraîchit la facture, le comparatif, la vue des rapprochements et la liste des factures", () => {
    expect(lineCacheKeys({ invoiceId: "inv", prospectId: "pro" }, { ozego: false })).toEqual([
      ["invoice-lines", "inv"],
      ["prospect-lines", "pro"],
      ["prospect-matching-lines", "pro"],
      ["invoices", "pro"],
    ]);
  });

  test("ozego ajoute le seul cache Ozego qui existe encore (les variantes)", () => {
    expect(lineCacheKeys({ invoiceId: "inv", prospectId: "pro" }, { ozego: true })).toEqual([
      ["invoice-lines", "inv"],
      ["prospect-lines", "pro"],
      ["prospect-matching-lines", "pro"],
      ["invoices", "pro"],
      ["ozego-variants"],
    ]);
  });

  test("sans prospect connu, invalide par préfixe tous les comparatifs", () => {
    expect(lineCacheKeys({ invoiceId: "inv", prospectId: null }, { ozego: false })).toEqual([
      ["invoice-lines", "inv"],
      ["prospect-lines"],
      ["prospect-matching-lines"],
      ["invoices"],
    ]);
  });
});

const matchedState: LineSnapshot = {
  matched_product_id: "prod-old",
  match_status: "review",
  match_method: "libellé",
  match_score: 0.72,
  manual_override: false,
  validated_stage: "ozego",
  pack_factor: 6,
};

const emptyState: LineSnapshot = {
  matched_product_id: null,
  match_status: "unmatched",
  match_method: null,
  match_score: null,
  manual_override: false,
  validated_stage: null,
  pack_factor: 3,
};

describe("annulation : snapshotForUndo / restoreUpdate", () => {
  test("snapshotForUndo ne garde que les 7 champs de rapprochement", () => {
    const full = { ...matchedState, id: "line-1", label: "ECHALOTE", quantity: 3 };
    expect(snapshotForUndo(full)).toEqual(matchedState);
    expect(Object.keys(snapshotForUndo(full)).sort()).toEqual(Object.keys(matchedState).sort());
  });

  test("snapshotForUndo copie les valeurs : la ligne modifiée ensuite ne change pas le snapshot", () => {
    const source = { ...matchedState };
    const snapshot = snapshotForUndo(source);
    source.matched_product_id = null;
    source.match_status = "unmatched";
    expect(snapshot.matched_product_id).toBe("prod-old");
    expect(snapshot.match_status).toBe("review");
  });

  test("restoreUpdate : payload exact, un champ par colonne", () => {
    expect(restoreUpdate(matchedState)).toEqual({
      matched_product_id: "prod-old",
      match_status: "review",
      match_method: "libellé",
      match_score: 0.72,
      manual_override: false,
      validated_stage: "ozego",
      pack_factor: 6,
    });
  });

  test("restoreUpdate : les valeurs nulles sont réécrites telles quelles, jamais omises", () => {
    const payload = restoreUpdate(emptyState);
    expect(payload).toEqual({
      matched_product_id: null,
      match_status: "unmatched",
      match_method: null,
      match_score: null,
      manual_override: false,
      validated_stage: null,
      pack_factor: 3,
    });
    expect(Object.keys(payload)).toHaveLength(7);
  });

  test("restoreUpdate : un conditionnement absent ou invalide retombe sur 1 (colonne non nulle)", () => {
    expect(restoreUpdate({ ...matchedState, pack_factor: null }).pack_factor).toBe(1);
    expect(restoreUpdate({ ...matchedState, pack_factor: 0 }).pack_factor).toBe(1);
  });

  test("aller-retour : le retrait écrase l'état, la restauration le remet comme avant", () => {
    const before = snapshotForUndo(matchedState);
    const removal = matchUpdate(null, "fournisseur");
    expect(removal.matched_product_id).toBeNull();
    expect(removal.match_status).toBe("unmatched");
    expect(removal.validated_stage).toBeNull();
    expect(restoreUpdate(before)).toEqual({
      matched_product_id: "prod-old",
      match_status: "review",
      match_method: "libellé",
      match_score: 0.72,
      manual_override: false,
      validated_stage: "ozego",
      pack_factor: 6,
    });
  });
});

describe("annulation : restoreLineAction / undeleteLineAction", () => {
  test("restoreLineAction écrit restoreUpdate sur la bonne ligne, sans toucher à product_mappings", async () => {
    const { client, calls } = fakeClient();
    expect(await restoreLineAction(client, line(), matchedState)).toEqual({
      changed: true,
      error: null,
    });
    expect(calls).toEqual([
      {
        table: "invoice_lines",
        op: "update",
        payload: restoreUpdate(matchedState),
        filters: [["eq", "id", "line-1"]],
      },
    ]);
  });

  test("restoreLineAction d'une ligne qui n'avait pas de produit : champs nuls réécrits", async () => {
    const { client, calls } = fakeClient();
    await restoreLineAction(client, line({ matched_product_id: null }), emptyState);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.payload).toEqual(restoreUpdate(emptyState));
  });

  test("restoreLineAction : l'erreur est remontée et rien n'est à rafraîchir", async () => {
    const { client } = fakeClient({ errors: { "invoice_lines.update": "refusé" } });
    expect(await restoreLineAction(client, line(), matchedState)).toEqual({
      changed: false,
      error: "refusé",
    });
  });

  test("undeleteLineAction : excluded = false sur la ligne", async () => {
    const { client, calls } = fakeClient();
    expect(await undeleteLineAction(client, line())).toEqual({ changed: true, error: null });
    expect(calls).toEqual([
      {
        table: "invoice_lines",
        op: "update",
        payload: { excluded: false },
        filters: [["eq", "id", "line-1"]],
      },
    ]);
  });

  test("undeleteLineAction : erreur remontée", async () => {
    const { client } = fakeClient({ errors: { "invoice_lines.update": "nope" } });
    expect(await undeleteLineAction(client, line())).toEqual({ changed: false, error: "nope" });
  });
});
