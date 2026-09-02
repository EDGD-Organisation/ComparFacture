import { supabase } from "@/integrations/supabase/client";

export type OzegoBest = {
  ozego_id: string;
  id: string;
  reference: string;
  label: string;
  ean: string | null;
  family: string | null;
  unit: string | null;
  price: number | null;
  supplier_name: string | null;
  variants_count: number;
};

/** Pour chaque identifiant Ozego, la référence la moins chère du groupe. */
export async function fetchCheapestByOzego(ids: string[]): Promise<Map<string, OzegoBest>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.rpc("cheapest_by_ozego", { ids: unique });
  if (error) throw new Error(error.message);
  const map = new Map<string, OzegoBest>();
  for (const row of (data ?? []) as OzegoBest[]) map.set(row.ozego_id, row);
  return map;
}

export type OzegoVariant = {
  ozego_id: string;
  id: string;
  reference: string;
  label: string;
  ean: string | null;
  family: string | null;
  unit: string | null;
  price: number | null;
  supplier_name: string | null;
};

/**
 * Toutes les références actives d'un groupe Ozego (pas seulement la moins chère) —
 * nécessaire pour reproduire les 3 cas du comparatif manuel : prix chez le même
 * fournisseur que la facture, moins cher tous fournisseurs, moins cher parmi une
 * liste de fournisseurs préférés. Un seul aller-retour, filtrage fait ensuite en JS
 * avec `cheapestAmong` selon le cas voulu par ligne.
 */
export async function fetchOzegoVariants(ids: string[]): Promise<Map<string, OzegoVariant[]>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, OzegoVariant[]>();
  if (unique.length === 0) return map;
  const { data, error } = await supabase.rpc("catalog_variants_by_ozego", { ids: unique });
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as OzegoVariant[]) {
    const list = map.get(row.ozego_id) ?? [];
    list.push(row);
    map.set(row.ozego_id, list);
  }
  return map;
}

/**
 * La variante la moins chère parmi `variants`, optionnellement restreinte à une liste
 * de fournisseurs (comparaison insensible à la casse). `supplierNames` vide ou absent
 * = pas de restriction (moins cher tous fournisseurs confondus). Retourne `undefined`
 * si aucune variante ne correspond (ex. aucun fournisseur préféré ne propose ce produit).
 */
export function cheapestAmong(
  variants: OzegoVariant[] | undefined,
  supplierNames?: string[] | null,
): OzegoVariant | undefined {
  if (!variants || variants.length === 0) return undefined;
  const allowed = supplierNames?.length
    ? new Set(supplierNames.map((s) => s.trim().toLowerCase()))
    : null;
  const pool = allowed
    ? variants.filter((v) => v.supplier_name && allowed.has(v.supplier_name.trim().toLowerCase()))
    : variants;
  if (pool.length === 0) return undefined;
  return pool.reduce((best, v) =>
    v.price !== null && (best.price === null || v.price < best.price) ? v : best,
  );
}

export type OzegoLine = {
  quantity: number;
  unit_price: number | null;
  pack_factor: number | null;
  catalog_products: { ozego_id?: string | null } | null;
};

/** Écart entre le prix facturé (ramené à l'unité) et le meilleur prix du groupe Ozego. */
export function ozegoGap(line: OzegoLine, best: { price: number | null } | undefined | null) {
  if (!best || best.price === null || line.unit_price === null) return null;
  const k = line.pack_factor && line.pack_factor > 0 ? line.pack_factor : 1;
  const comparablePrice = line.unit_price / k;
  const unitGap = comparablePrice - best.price;
  const percentGap = best.price === 0 ? null : (unitGap / best.price) * 100;
  return {
    unitGap,
    percentGap,
    totalGap: unitGap * line.quantity * k,
    comparablePrice,
    packFactor: k,
    bestPrice: best.price,
  };
}
