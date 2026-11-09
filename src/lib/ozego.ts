import { supabase } from "@/integrations/supabase/client";

import { groupRowsByInputId, planOzegoLookup } from "./ozego-key";
import { normalizePackFactor } from "./pack";
import { fetchAllRows, type RangeQuery } from "./paginate";

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

/**
 * Ces RPC renvoient un ensemble de lignes que PostgREST plafonne à 1000 : lecture complète par
 * tranches, triée sur une colonne unique pour que les pages ne se chevauchent pas.
 */
async function readAllRpcRows<T>(build: () => RangeQuery<T>): Promise<T[]> {
  try {
    return await fetchAllRows(build);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Comparaison Ozego indisponible : ${message}`);
  }
}

/**
 * Pour chaque identifiant Ozego, la référence la moins chère des produits similaires (même
 * identifiant privé de son premier segment, voir `ozegoSimilarKey`). La Map est indexée par
 * l'identifiant demandé ; `ozego_id` de chaque valeur est l'identifiant complet de l'offre.
 */
export async function fetchCheapestByOzego(ids: string[]): Promise<Map<string, OzegoBest>> {
  const plan = planOzegoLookup(ids);
  const map = new Map<string, OzegoBest>();
  if (plan.keys.length === 0 && plan.exactIds.length === 0) return map;
  const [keyed, exact] = await Promise.all([
    plan.keys.length > 0
      ? readAllRpcRows<OzegoBest>(
          () =>
            supabase
              .rpc("cheapest_by_ozego_key", { keys: plan.keys })
              .order("ozego_id") as unknown as RangeQuery<OzegoBest>,
        )
      : [],
    plan.exactIds.length > 0
      ? readAllRpcRows<OzegoBest>(
          () =>
            supabase
              .rpc("cheapest_by_ozego", { ids: plan.exactIds })
              .order("ozego_id") as unknown as RangeQuery<OzegoBest>,
        )
      : [],
  ]);
  const grouped = groupRowsByInputId(plan, keyed, exact);
  for (const [inputId, [best]] of grouped) if (best) map.set(inputId, best);
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
 * Toutes les références actives des produits similaires d'un identifiant Ozego (même identifiant
 * privé de son premier segment, voir `ozegoSimilarKey`), pas seulement la moins chère :
 * nécessaire pour reproduire les 2 cas du comparatif manuel : moins cher tous fournisseurs,
 * moins cher parmi une liste de fournisseurs préférés. Un seul aller-retour, filtrage fait ensuite
 * en JS avec `cheapestAmong` selon le cas voulu par ligne. La Map est indexée par l'identifiant
 * demandé ; `ozego_id` de chaque valeur est l'identifiant complet de l'offre.
 */
export async function fetchOzegoVariants(ids: string[]): Promise<Map<string, OzegoVariant[]>> {
  const plan = planOzegoLookup(ids);
  if (plan.keys.length === 0 && plan.exactIds.length === 0) return new Map();
  const [keyed, exact] = await Promise.all([
    plan.keys.length > 0
      ? readAllRpcRows<OzegoVariant>(
          () =>
            supabase
              .rpc("catalog_variants_by_ozego_key", { keys: plan.keys })
              .order("id") as unknown as RangeQuery<OzegoVariant>,
        )
      : [],
    plan.exactIds.length > 0
      ? readAllRpcRows<OzegoVariant>(
          () =>
            supabase
              .rpc("catalog_variants_by_ozego", { ids: plan.exactIds })
              .order("id") as unknown as RangeQuery<OzegoVariant>,
        )
      : [],
  ]);
  return groupRowsByInputId(plan, keyed, exact);
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
  const k = normalizePackFactor(line.pack_factor);
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
