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

export type OzegoLine = {
  quantity: number;
  unit_price: number | null;
  pack_factor: number | null;
  catalog_products: { ozego_id?: string | null } | null;
};

/** Écart entre le prix facturé (ramené à l'unité) et le meilleur prix du groupe Ozego. */
export function ozegoGap(line: OzegoLine, best: OzegoBest | undefined | null) {
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
