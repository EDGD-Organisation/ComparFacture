import { describe, expect, mock, test } from "bun:test";

// Faux client Supabase : comme PostgREST, une RPC ensembliste ne renvoie jamais plus de 1000 lignes
// par réponse, et `.order().range()` pagine son résultat.
const SERVER_MAX_ROWS = 1000;
type Row = { ozego_id: string; id: string; price: number };
type Rpc = { rows: Row[]; error: { message: string } | null };

let rpcs: Record<string, Rpc> = {};
const rpcCalls: string[] = [];

function fakeRpc(name: string) {
  rpcCalls.push(name);
  const source = rpcs[name] ?? { rows: [], error: null };
  let orderColumn: keyof Row | null = null;
  const query = {
    order(column: keyof Row) {
      orderColumn = column;
      return query;
    },
    range(from: number, to: number) {
      if (source.error) return Promise.resolve({ data: null, error: source.error });
      const sorted = orderColumn
        ? [...source.rows].sort((a, b) =>
            String(a[orderColumn!]).localeCompare(String(b[orderColumn!])),
          )
        : source.rows;
      const end = Math.min(to, from + SERVER_MAX_ROWS - 1);
      return Promise.resolve({ data: sorted.slice(from, end + 1), error: null });
    },
  };
  return query;
}

mock.module("@/integrations/supabase/client", () => ({ supabase: { rpc: fakeRpc } }));

const { fetchCheapestByOzego, fetchOzegoVariants } = await import("./ozego");

function variantRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    ozego_id: `${10 + (i % 3)}.4.${Math.floor(i / 3)}`,
    id: `id-${String(i).padStart(5, "0")}`,
    price: 1 + i,
  }));
}

describe("fetchOzegoVariants", () => {
  test("plus de 1000 variantes : aucune n'est perdue", async () => {
    rpcs = { catalog_variants_by_ozego_key: { rows: variantRows(2400), error: null } };
    const keys = Array.from({ length: 800 }, (_, i) => `10.4.${i}`);
    const result = await fetchOzegoVariants(keys);
    let total = 0;
    for (const variants of result.values()) total += variants.length;
    expect(total).toBe(2400);
    expect(result.get("10.4.799")).toHaveLength(3);
  });

  test("une erreur de RPC est signalée, jamais remplacée par un résultat vide", async () => {
    rpcs = { catalog_variants_by_ozego_key: { rows: [], error: { message: "boom" } } };
    let message = "";
    try {
      await fetchOzegoVariants(["10.4.1"]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("Comparaison Ozego indisponible : boom");
  });

  test("n'appelle que les RPC utiles", async () => {
    rpcs = {};
    rpcCalls.length = 0;
    await fetchOzegoVariants(["abc"]);
    expect(rpcCalls).toEqual(["catalog_variants_by_ozego"]);
  });
});

describe("fetchCheapestByOzego", () => {
  test("plus de 1000 groupes : tous reçoivent leur meilleure offre", async () => {
    const rows: Row[] = Array.from({ length: 1500 }, (_, i) => ({
      ozego_id: `11.4.${i}`,
      id: `id-${String(i).padStart(5, "0")}`,
      price: 2,
    }));
    rpcs = { cheapest_by_ozego_key: { rows, error: null } };
    const keys = rows.map((row) => `10.4.${row.ozego_id.split(".")[2]}`);
    const result = await fetchCheapestByOzego(keys);
    expect(result.size).toBe(1500);
    expect(result.get("10.4.1499")?.id).toBe("id-01499");
  });
});
