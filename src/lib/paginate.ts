export type PageResult<T> = { data: T[] | null; error: { message: string } | null };
export type RangeQuery<T> = { range(from: number, to: number): PromiseLike<PageResult<T>> };

/**
 * PostgREST renvoie au plus 1000 lignes par requête (`max-rows`) : on lit par tranches `.range()`
 * jusqu'à une page vide. Le décalage avance du nombre de lignes réellement reçues, donc un plafond
 * serveur inférieur à `pageSize` ne tronque pas silencieusement le résultat. La requête doit avoir
 * un tri stable (ex. `order("id")`) et est reconstruite à chaque page.
 */
export async function fetchAllRows<T>(
  buildQuery: () => RangeQuery<T>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await buildQuery().range(rows.length, rows.length + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return rows;
    rows.push(...data);
  }
}
