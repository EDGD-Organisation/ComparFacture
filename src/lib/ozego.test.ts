import { describe, expect, mock, test } from "bun:test";

import { ozegoSimilarKey } from "./ozego-key";

// Faux client Supabase qui imite PostgREST : une RPC ensembliste ne renvoie jamais plus de 1000
// lignes par réponse, `.order().range()` pagine son résultat, et chaque appel de `.range()` est une
// requête réseau (comptée). Les RPC filtrent comme le SQL : offres actives avec un prix, dont la
// clé tronquée (ou l'identifiant exact) est demandée.
const SERVER_MAX_ROWS = 1000;
type Row = {
  ozego_id: string;
  id: string;
  reference: string;
  label: string;
  ean: string | null;
  family: string | null;
  unit: string | null;
  price: number | null;
  supplier_name: string | null;
  is_active?: boolean;
};

let catalog: Row[] = [];
let rpcError: { message: string } | null = null;
let requests: Array<{ rpc: string; from: number; to: number }> = [];

function offer(ozegoId: string, id: string, price: number | null, supplier = "Fournisseur"): Row {
  return {
    ozego_id: ozegoId,
    id,
    reference: `ref-${id}`,
    label: `Produit ${id}`,
    ean: null,
    family: null,
    unit: "KG",
    price,
    supplier_name: supplier,
  };
}

function rpcRows(name: string, args: Record<string, string[]>): Row[] {
  const active = catalog.filter((row) => row.is_active !== false && row.price !== null);
  if (name === "catalog_variants_by_ozego_key") {
    const keys = new Set(args["keys"]);
    return active.filter((row) => keys.has(ozegoSimilarKey(row.ozego_id) ?? "\u0000"));
  }
  if (name === "catalog_variants_by_ozego") {
    const ids = new Set(args["ids"]);
    return active.filter((row) => ids.has(row.ozego_id));
  }
  throw new Error(`RPC inattendue : ${name}`);
}

function fakeRpc(name: string, args: Record<string, string[]>) {
  let orderColumn: keyof Row | null = null;
  const query = {
    order(column: keyof Row) {
      orderColumn = column;
      return query;
    },
    range(from: number, to: number) {
      requests.push({ rpc: name, from, to });
      if (rpcError) return Promise.resolve({ data: null, error: rpcError });
      const source = rpcRows(name, args);
      const sorted = orderColumn
        ? [...source].sort((a, b) => String(a[orderColumn!]).localeCompare(String(b[orderColumn!])))
        : source;
      const end = Math.min(to, from + SERVER_MAX_ROWS - 1);
      return Promise.resolve({ data: sorted.slice(from, end + 1), error: null });
    },
  };
  return query;
}

mock.module("@/integrations/supabase/client", () => ({ supabase: { rpc: fakeRpc } }));

const { bestByOzegoFromVariants, bestOfVariants, fetchOzegoVariants, ozegoIdsKey } =
  await import("./ozego");

function reset(rows: Row[]) {
  catalog = rows;
  rpcError = null;
  requests = [];
}

/** Meilleure offre telle que l'ancienne RPC SQL la calculait (DISTINCT ON groupe ORDER BY prix, id). */
function legacyBest(ids: string[]) {
  const result = new Map<string, { row: Row; count: number }>();
  for (const inputId of ids) {
    const key = ozegoSimilarKey(inputId);
    const group = catalog.filter(
      (row) =>
        row.is_active !== false &&
        (key === null ? row.ozego_id === inputId : ozegoSimilarKey(row.ozego_id) === key),
    );
    const priced = group
      .filter((row) => row.price !== null)
      .sort((a, b) => a.price! - b.price! || a.id.localeCompare(b.id));
    if (priced[0]) result.set(inputId, { row: priced[0], count: group.length });
  }
  return result;
}

async function derivedBest(ids: string[]) {
  return bestByOzegoFromVariants(await fetchOzegoVariants(ids));
}

describe("bestOfVariants", () => {
  test("aucune offre : undefined", () => {
    expect(bestOfVariants(undefined)).toBeUndefined();
    expect(bestOfVariants([])).toBeUndefined();
  });

  test("égalité de prix : le plus petit id gagne, quel que soit l'ordre d'entrée", () => {
    const a = offer("11.4.1", "id-a", 5);
    const b = offer("12.4.1", "id-b", 5);
    expect(bestOfVariants([b, a])?.id).toBe("id-a");
    expect(bestOfVariants([a, b])?.id).toBe("id-a");
  });

  test("prix nul exclu : jamais retenu, ni compté", () => {
    const best = bestOfVariants([offer("11.4.1", "id-1", null), offer("12.4.1", "id-2", 9)]);
    expect(best?.id).toBe("id-2");
    expect(best?.variants_count).toBe(1);
    expect(bestOfVariants([offer("11.4.1", "id-1", null)])).toBeUndefined();
  });

  test("un prix de 0 est un vrai prix (comme `price IS NOT NULL` en SQL)", () => {
    const best = bestOfVariants([offer("11.4.1", "id-1", 3), offer("12.4.1", "id-2", 0)]);
    expect(best?.id).toBe("id-2");
    expect(best?.price).toBe(0);
  });

  test("nombre de références = offres avec prix du groupe", () => {
    const best = bestOfVariants([
      offer("11.4.1", "id-1", 7),
      offer("12.4.1", "id-2", 4),
      offer("13.4.1", "id-3", 4.5),
    ]);
    expect(best?.variants_count).toBe(3);
    expect(best?.ozego_id).toBe("12.4.1");
  });
});

describe("meilleure offre dérivée des variantes = ancienne meilleure offre", () => {
  test("plusieurs fournisseurs, égalités, clé partagée, identifiant sans point", async () => {
    reset([
      // groupe 4.72.139 : trois fournisseurs, égalité à 2,5 entre deux d'entre eux
      offer("31.4.72.139", "id-0003", 3.1, "A"),
      offer("18.4.72.139", "id-0009", 2.5, "B"),
      offer("22.4.72.139", "id-0002", 2.5, "C"),
      offer("40.4.72.139", "id-0001", null, "D"),
      // groupe 5.1.1 : un seul fournisseur
      offer("31.5.1.1", "id-0100", 12, "A"),
      // groupe 6.2.2 : seulement des offres sans prix
      offer("31.6.2.2", "id-0200", null, "A"),
      // identifiant sans point : recherche exacte
      offer("abc", "id-0300", 8, "A"),
      offer("abc", "id-0301", 7, "B"),
      offer("abcd", "id-0302", 1, "B"),
      // offre inactive moins chère : ignorée
      { ...offer("31.5.1.1", "id-0099", 1, "Z"), is_active: false },
    ]);
    // 31.4.72.139 et 18.4.72.139 partagent la clé 4.72.139
    const ids = ["31.4.72.139", "18.4.72.139", "31.5.1.1", "31.6.2.2", "abc", "inconnu.9.9"];
    const derived = await derivedBest(ids);
    const legacy = legacyBest(ids);

    expect([...derived.keys()].sort()).toEqual([...legacy.keys()].sort());
    for (const [inputId, expected] of legacy) {
      const got = derived.get(inputId)!;
      expect(got.id).toBe(expected.row.id);
      expect(got.price).toBe(expected.row.price);
      expect(got.ozego_id).toBe(expected.row.ozego_id);
      expect(got.supplier_name).toBe(expected.row.supplier_name);
    }
    expect(derived.get("31.4.72.139")?.id).toBe("id-0002");
    expect(derived.get("18.4.72.139")?.id).toBe("id-0002");
    expect(derived.get("abc")?.id).toBe("id-0301");
    expect(derived.has("31.6.2.2")).toBe(false);
  });

  test("variants_count : offres avec prix (l'ancienne RPC comptait aussi celles sans prix)", async () => {
    reset([
      offer("31.4.72.139", "id-1", 3, "A"),
      offer("18.4.72.139", "id-2", 4, "B"),
      offer("22.4.72.139", "id-3", null, "C"),
    ]);
    const derived = await derivedBest(["31.4.72.139"]);
    expect(derived.get("31.4.72.139")?.variants_count).toBe(2);
    expect(legacyBest(["31.4.72.139"]).get("31.4.72.139")?.count).toBe(3);
  });
});

describe("fetchOzegoVariants : nombre de requêtes", () => {
  test("aucun identifiant : aucune requête", async () => {
    reset([]);
    expect((await fetchOzegoVariants([])).size).toBe(0);
    expect((await fetchOzegoVariants([""])).size).toBe(0);
    expect(requests).toHaveLength(0);
  });

  test("clés tronquées seulement : une requête", async () => {
    reset([offer("31.4.72.139", "id-1", 3), offer("18.4.72.139", "id-2", 4)]);
    await fetchOzegoVariants(["31.4.72.139", "18.4.72.139"]);
    expect(requests).toEqual([{ rpc: "catalog_variants_by_ozego_key", from: 0, to: 999 }]);
  });

  test("identifiants sans point seulement : une requête", async () => {
    reset([offer("abc", "id-1", 3)]);
    await fetchOzegoVariants(["abc"]);
    expect(requests).toEqual([{ rpc: "catalog_variants_by_ozego", from: 0, to: 999 }]);
  });

  test("les deux familles : une requête chacune, jamais de RPC cheapest_*", async () => {
    reset([offer("31.4.72.139", "id-1", 3), offer("abc", "id-2", 4)]);
    await fetchOzegoVariants(["31.4.72.139", "abc"]);
    expect(requests.map((r) => r.rpc).sort()).toEqual([
      "catalog_variants_by_ozego",
      "catalog_variants_by_ozego_key",
    ]);
  });

  test("plus de 1000 variantes : aucune perdue, 3 requêtes pour 2400 lignes", async () => {
    reset(
      Array.from({ length: 2400 }, (_, i) =>
        offer(`${10 + (i % 3)}.4.${Math.floor(i / 3)}`, `id-${String(i).padStart(5, "0")}`, 1 + i),
      ),
    );
    const keys = Array.from({ length: 800 }, (_, i) => `10.4.${i}`);
    const result = await fetchOzegoVariants(keys);
    let total = 0;
    for (const variants of result.values()) total += variants.length;
    expect(total).toBe(2400);
    expect(result.get("10.4.799")).toHaveLength(3);
    expect(requests.map(({ from, to }) => [from, to])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("exactement 1000 variantes : une page pleine puis une page vide (2 requêtes)", async () => {
    reset(Array.from({ length: 1000 }, (_, i) => offer(`10.4.${i}`, `id-${i}`, 1 + i)));
    await fetchOzegoVariants(Array.from({ length: 1000 }, (_, i) => `10.4.${i}`));
    expect(requests).toHaveLength(2);
  });

  test("plus de 1000 groupes : tous reçoivent leur meilleure offre", async () => {
    reset(
      Array.from({ length: 1500 }, (_, i) =>
        offer(`11.4.${i}`, `id-${String(i).padStart(5, "0")}`, 2),
      ),
    );
    const derived = await derivedBest(Array.from({ length: 1500 }, (_, i) => `10.4.${i}`));
    expect(derived.size).toBe(1500);
    expect(derived.get("10.4.1499")?.id).toBe("id-01499");
  });

  test("une erreur de RPC est signalée, jamais remplacée par un résultat vide", async () => {
    reset([]);
    rpcError = { message: "boom" };
    let message = "";
    try {
      await fetchOzegoVariants(["10.4.1"]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("Comparaison Ozego indisponible : boom");
  });
});

describe("ozegoIdsKey", () => {
  test("même ensemble, même clé, quel que soit l'ordre et les doublons", () => {
    expect(ozegoIdsKey(["b", "a", "b"])).toBe(ozegoIdsKey(["a", "b"]));
    expect(ozegoIdsKey(["31.4.1", "18.4.1"])).toBe(ozegoIdsKey(["18.4.1", "31.4.1", "18.4.1"]));
  });

  test("ensembles différents, clés différentes ; vide ou identifiants vides : clé vide", () => {
    expect(ozegoIdsKey(["a"])).not.toBe(ozegoIdsKey(["a", "b"]));
    expect(ozegoIdsKey([])).toBe("");
    expect(ozegoIdsKey(["", ""])).toBe("");
  });
});
