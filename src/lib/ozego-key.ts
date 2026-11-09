/**
 * Clé des produits similaires : l'identifiant Ozego privé de son premier segment
 * ('31.4.72.139' -> '4.72.139'). Le premier segment est le code du fournisseur, le reste identifie
 * le produit. Doit rester identique à la fonction SQL `ozego_similar_key`.
 * Retourne `null` quand il n'y a rien à tronquer (vide, sans point, premier segment vide, rien
 * après le premier point) : l'appelant retombe alors sur l'identifiant complet.
 */
export function ozegoSimilarKey(id: string | null | undefined): string | null {
  const trimmed = id?.trim();
  if (!trimmed) return null;
  const dot = trimmed.indexOf(".");
  if (dot < 1) return null;
  return trimmed.slice(dot + 1) || null;
}

export type OzegoLookupPlan = {
  /** Clés tronquées à interroger (RPC `*_by_ozego_key`). */
  keys: string[];
  /** Identifiants non tronquables, interrogés tels quels (RPC `*_by_ozego`). */
  exactIds: string[];
  /** Identifiants d'entrée rattachés à chaque clé tronquée. */
  idsByKey: Map<string, string[]>;
};

export function planOzegoLookup(ids: Iterable<string>): OzegoLookupPlan {
  const idsByKey = new Map<string, string[]>();
  const exactIds: string[] = [];
  for (const id of new Set(ids)) {
    if (!id) continue;
    const key = ozegoSimilarKey(id);
    if (key === null) {
      exactIds.push(id);
      continue;
    }
    const list = idsByKey.get(key) ?? [];
    list.push(id);
    idsByKey.set(key, list);
  }
  return { keys: [...idsByKey.keys()], exactIds, idsByKey };
}

/**
 * Rattache les lignes renvoyées par les RPC à chaque identifiant d'entrée : par clé tronquée pour
 * `keyedRows`, par égalité stricte pour `exactRows`.
 */
export function groupRowsByInputId<T extends { ozego_id: string }>(
  plan: OzegoLookupPlan,
  keyedRows: T[],
  exactRows: T[],
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  const push = (inputId: string, row: T) => {
    const list = result.get(inputId) ?? [];
    list.push(row);
    result.set(inputId, list);
  };
  for (const row of keyedRows) {
    const key = ozegoSimilarKey(row.ozego_id);
    for (const inputId of (key && plan.idsByKey.get(key)) || []) push(inputId, row);
  }
  const exact = new Set(plan.exactIds);
  for (const row of exactRows) if (exact.has(row.ozego_id)) push(row.ozego_id, row);
  return result;
}
