export type PageResult<T> = { data: T[] | null; error: { message: string } | null };
export type RangeQuery<T> = { range(from: number, to: number): PromiseLike<PageResult<T>> };

/**
 * Plafond de lignes par réponse de PostgREST (`max-rows`). Mesuré à 1000 sur le projet de production
 * le 2026-11-09 : une demande `.range(0, 4999)` sur un catalogue de 17 782 produits renvoie 1000
 * lignes.
 */
export const POSTGREST_MAX_ROWS = 1000;

/**
 * Lit toutes les lignes d'une requête par tranches `.range()`. La requête doit avoir un tri stable
 * (ex. `order("id")`) et est reconstruite à chaque page.
 *
 * Arrêt : dès qu'une page renvoie MOINS de `pageSize` lignes, sans requête supplémentaire pour
 * constater une page vide (un aller-retour de moins par lecture). Cet arrêt n'est exact que si une
 * page pleine fait vraiment `pageSize` lignes, donc `pageSize` est BORNÉ à `POSTGREST_MAX_ROWS`
 * (1000, valeur mesurée le 2026-11-09) : demander plus que le plafond serveur ferait renvoyer 1000
 * lignes, que l'on prendrait pour une dernière page incomplète, et le résultat serait tronqué
 * sans erreur. Conséquence à connaître : si le plafond serveur de PostgREST baissait un jour sous
 * 1000 (changement de `max-rows` dans la configuration Supabase), une page tronquée serait prise
 * pour la dernière et les lectures seraient silencieusement incomplètes. Il faudrait alors baisser
 * `POSTGREST_MAX_ROWS` en même temps.
 */
export async function fetchAllRows<T>(
  buildQuery: () => RangeQuery<T>,
  pageSize: number = POSTGREST_MAX_ROWS,
): Promise<T[]> {
  const size =
    Number.isFinite(pageSize) && pageSize >= 1
      ? Math.min(Math.floor(pageSize), POSTGREST_MAX_ROWS)
      : POSTGREST_MAX_ROWS;
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await buildQuery().range(rows.length, rows.length + size - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return rows;
    rows.push(...data);
    if (data.length < size) return rows;
  }
}
