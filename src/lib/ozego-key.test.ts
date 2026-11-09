import { describe, expect, test } from "bun:test";

import { groupRowsByInputId, ozegoSimilarKey, planOzegoLookup } from "./ozego-key";

describe("ozegoSimilarKey", () => {
  test("retire le premier segment", () => {
    expect(ozegoSimilarKey("31.4.72.139")).toBe("4.72.139");
    expect(ozegoSimilarKey("12.4.72.139")).toBe("4.72.139");
    expect(ozegoSimilarKey("9.7.31.1")).toBe("7.31.1");
  });

  test("deux fournisseurs différents donnent la même clé", () => {
    expect(ozegoSimilarKey("25.13.68.9")).toBe(ozegoSimilarKey("18.13.68.9"));
  });

  test("ne confond pas des produits différents", () => {
    expect(ozegoSimilarKey("31.4.72.139")).not.toBe(ozegoSimilarKey("31.4.72.140"));
  });

  test("ignore les espaces autour de l'identifiant", () => {
    expect(ozegoSimilarKey("  31.4.72.139  ")).toBe("4.72.139");
  });

  test("renvoie null pour une valeur absente ou vide", () => {
    expect(ozegoSimilarKey(null)).toBeNull();
    expect(ozegoSimilarKey(undefined)).toBeNull();
    expect(ozegoSimilarKey("")).toBeNull();
    expect(ozegoSimilarKey("   ")).toBeNull();
  });

  test("renvoie null sans point (identifiants non numériques de l'exemple CSV)", () => {
    expect(ozegoSimilarKey("SUPP-VEG-001")).toBeNull();
    expect(ozegoSimilarKey("31")).toBeNull();
  });

  test("renvoie null quand il ne reste rien après le premier segment", () => {
    expect(ozegoSimilarKey("31.")).toBeNull();
    expect(ozegoSimilarKey("31. ")).toBeNull();
    expect(ozegoSimilarKey(".4.72")).toBeNull();
  });

  test("un identifiant à deux segments garde un seul segment", () => {
    expect(ozegoSimilarKey("31.4")).toBe("4");
  });
});

describe("planOzegoLookup", () => {
  test("sépare clés tronquées et identifiants exacts, sans doublons ni vides", () => {
    const plan = planOzegoLookup(["31.4.72.139", "12.4.72.139", "31.4.72.139", "", "SUPP-001"]);
    expect(plan.keys).toEqual(["4.72.139"]);
    expect(plan.exactIds).toEqual(["SUPP-001"]);
    expect(plan.idsByKey.get("4.72.139")).toEqual(["31.4.72.139", "12.4.72.139"]);
  });

  test("liste vide : rien à interroger", () => {
    const plan = planOzegoLookup([]);
    expect(plan.keys).toEqual([]);
    expect(plan.exactIds).toEqual([]);
  });
});

describe("groupRowsByInputId", () => {
  const row = (ozego_id: string, price: number) => ({ ozego_id, price });

  test("rattache chaque offre à tous les identifiants demandés de la même clé", () => {
    const plan = planOzegoLookup(["31.4.72.139", "12.4.72.139", "25.1.2.3"]);
    const grouped = groupRowsByInputId(
      plan,
      [row("31.4.72.139", 5), row("18.4.72.139", 4), row("32.1.2.3", 9)],
      [],
    );
    expect(grouped.get("31.4.72.139")).toEqual([row("31.4.72.139", 5), row("18.4.72.139", 4)]);
    expect(grouped.get("12.4.72.139")).toEqual(grouped.get("31.4.72.139"));
    expect(grouped.get("25.1.2.3")).toEqual([row("32.1.2.3", 9)]);
  });

  test("conserve l'identifiant complet de l'offre, différent de celui demandé", () => {
    const plan = planOzegoLookup(["31.4.72.139"]);
    const grouped = groupRowsByInputId(plan, [row("18.4.72.139", 4)], []);
    expect(grouped.get("31.4.72.139")?.[0]?.ozego_id).toBe("18.4.72.139");
  });

  test("les identifiants non tronquables ne se rattachent que par égalité stricte", () => {
    const plan = planOzegoLookup(["SUPP-001", "7"]);
    const grouped = groupRowsByInputId(plan, [], [row("SUPP-001", 2), row("SUPP-002", 1)]);
    expect(grouped.get("SUPP-001")).toEqual([row("SUPP-001", 2)]);
    expect(grouped.has("SUPP-002")).toBe(false);
    expect(grouped.has("7")).toBe(false);
  });

  test("une offre exacte ne contamine pas un identifiant tronquable", () => {
    const plan = planOzegoLookup(["31.4.72.139"]);
    const grouped = groupRowsByInputId(plan, [], [row("31.4.72.139", 3)]);
    expect(grouped.size).toBe(0);
  });

  test("une offre dont la clé n'a pas été demandée est ignorée", () => {
    const plan = planOzegoLookup(["31.4.72.139"]);
    expect(groupRowsByInputId(plan, [row("31.9.9.9", 1)], []).size).toBe(0);
  });
});
