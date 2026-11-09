import { supabase } from "@/integrations/supabase/client";

import { groupRowsByInputId, planOzegoLookup } from "./ozego-key";
import { normalizePackFactor } from "./pack";
import { fetchAllRows, type RangeQuery } from "./paginate";

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
 * Toutes les références actives avec un prix des produits similaires d'un identifiant Ozego (même
 * identifiant privé de son premier segment, voir `ozegoSimilarKey`). C'est la SEULE lecture Ozego du
 * client : la meilleure offre de chaque groupe s'en déduit (`bestByOzegoFromVariants`), et la
 * meilleure offre parmi des fournisseurs préférés aussi (`cheapestAmong`). Une requête par famille
 * d'identifiants (clés tronquées, identifiants sans point), chacune lue par tranches de 1000. La
 * Map est indexée par l'identifiant demandé ; `ozego_id` de chaque valeur est l'identifiant complet
 * de l'offre.
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

/** Offre la moins chère d'un groupe Ozego, avec le nombre de références comparées. */
export type OzegoBest = OzegoVariant & { variants_count: number };

/**
 * Offre la moins chère de `variants` : prix le plus bas, à égalité le plus petit `id` (même règle
 * que l'ancienne RPC `cheapest_by_ozego_key`, `ORDER BY price, id`). Une offre sans prix n'est
 * jamais retenue. `undefined` s'il n'y a aucune offre avec prix.
 *
 * `variants_count` = nombre d'offres avec prix du groupe, c'est-à-dire les références réellement
 * comparées. Écart assumé avec l'ancienne RPC, qui comptait toutes les offres actives du groupe,
 * prix renseigné ou non : la colonne d'export « Références du groupe » peut être plus petite quand
 * le groupe contient des offres sans prix. Les variantes ne les renvoient pas, et un compte qui
 * inclut des offres inutilisables pour l'écart serait plus surprenant que ce chiffre.
 */
export function bestOfVariants(
  variants: readonly OzegoVariant[] | undefined,
): OzegoBest | undefined {
  let best: OzegoVariant | undefined;
  let count = 0;
  for (const variant of variants ?? []) {
    if (variant.price === null) continue;
    count += 1;
    if (
      !best ||
      variant.price < best.price! ||
      (variant.price === best.price && variant.id < best.id)
    ) {
      best = variant;
    }
  }
  return best ? { ...best, variants_count: count } : undefined;
}

/** `bestByOzego` (identifiant demandé -> meilleure offre) déduit des variantes ; groupes sans prix omis. */
export function bestByOzegoFromVariants(
  variantsByOzego: ReadonlyMap<string, readonly OzegoVariant[]>,
): Map<string, OzegoBest> {
  const result = new Map<string, OzegoBest>();
  for (const [ozegoId, variants] of variantsByOzego) {
    const best = bestOfVariants(variants);
    if (best) result.set(ozegoId, best);
  }
  return result;
}

/**
 * Clé de cache des comparaisons Ozego : ensemble d'identifiants trié et dédoublonné, donc le même
 * pour le même ensemble quel que soit l'ordre ou les doublons (pas de requête relancée pour rien).
 */
export function ozegoIdsKey(ids: Iterable<string>): string {
  return [...new Set(ids)]
    .filter((id) => id !== "")
    .sort()
    .join(",");
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
