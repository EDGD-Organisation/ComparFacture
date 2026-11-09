import { describe, expect, test } from "bun:test";

import { fetchAllRows, POSTGREST_MAX_ROWS } from "./paginate";

// Faux PostgREST : une réponse ne dépasse jamais `serverMaxRows` lignes, quelle que soit la tranche
// demandée (c'est la valeur mesurée en production le 2026-11-09 : 1000).
function fakeTable(total: number, serverMaxRows = 1000) {
  const calls: Array<[number, number]> = [];
  const build = () => ({
    range(from: number, to: number) {
      calls.push([from, to]);
      const end = Math.min(to, from + serverMaxRows - 1, total - 1);
      const data =
        from > end ? [] : Array.from({ length: end - from + 1 }, (_, i) => ({ id: from + i }));
      return Promise.resolve({ data, error: null });
    },
  });
  return { build, calls };
}

describe("fetchAllRows", () => {
  test("le plafond serveur mesuré est de 1000", () => {
    expect(POSTGREST_MAX_ROWS).toBe(1000);
  });

  // [lignes, requêtes émises] : une page incomplète est la dernière, pas de requête de fin.
  for (const [total, expectedCalls] of [
    [0, 1],
    [1, 1],
    [999, 1],
    [1000, 2],
    [1001, 2],
    [2500, 3],
  ] as const) {
    test(`${total} ligne(s) : toutes récupérées en ${expectedCalls} requête(s)`, async () => {
      const { build, calls } = fakeTable(total);
      const rows = await fetchAllRows(build);
      expect(rows.map((r) => r.id)).toEqual(Array.from({ length: total }, (_, i) => i));
      expect(calls).toHaveLength(expectedCalls);
    });
  }

  test("une page de 1000 lignes (pleine) : on continue", async () => {
    const { build, calls } = fakeTable(1000);
    await fetchAllRows(build);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  test("une page de 999 lignes (incomplète) : on s'arrête sans requête supplémentaire", async () => {
    const { build, calls } = fakeTable(999);
    await fetchAllRows(build);
    expect(calls).toEqual([[0, 999]]);
  });

  test("demande des tranches contiguës de 1000", async () => {
    const { build, calls } = fakeTable(2500);
    await fetchAllRows(build);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("pageSize au-dessus de 1000 est ramené à 1000 : rien n'est tronqué", async () => {
    const { build, calls } = fakeTable(2500);
    const rows = await fetchAllRows(build, 5000);
    expect(rows).toHaveLength(2500);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  test("pageSize plus petit : pages de cette taille, arrêt sur la page incomplète", async () => {
    const { build, calls } = fakeTable(250);
    const rows = await fetchAllRows(build, 100);
    expect(rows).toHaveLength(250);
    expect(calls).toEqual([
      [0, 99],
      [100, 199],
      [200, 299],
    ]);
  });

  test("pageSize invalide : retombe sur 1000", async () => {
    for (const invalid of [0, -5, Number.NaN]) {
      const { build, calls } = fakeTable(10);
      await fetchAllRows(build, invalid);
      expect(calls).toEqual([[0, 999]]);
    }
  });

  test("une erreur Supabase est propagée, jamais avalée", async () => {
    let page = 0;
    const build = () => ({
      range: () => {
        page += 1;
        return Promise.resolve(
          page === 1
            ? { data: [{ id: 1 }], error: null }
            : { data: null, error: { message: "permission denied for table invoice_lines" } },
        );
      },
    });
    let message = "";
    try {
      await fetchAllRows(build, 1);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("permission denied for table invoice_lines");
  });

  test("une erreur dès la première page est propagée", async () => {
    const build = () => ({
      range: () => Promise.resolve({ data: null, error: { message: "boom" } }),
    });
    let message = "";
    try {
      await fetchAllRows(build);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("boom");
  });
});
