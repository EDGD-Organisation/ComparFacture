/** Valeur par défaut du coefficient de conditionnement (1 unité facturée = 1 unité catalogue). */
export const DEFAULT_PACK_FACTOR = 1;

/** Toute valeur absente, vide, nulle, négative ou non numérique retombe sur 1. */
export function normalizePackFactor(value: unknown): number {
  const n = typeof value === "string" ? Number(value.trim().replace(",", ".")) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : DEFAULT_PACK_FACTOR;
}

export function comparableUnitPrice(unitPrice: number | null, packFactor: number | null) {
  if (unitPrice === null || unitPrice === undefined) return null;
  return unitPrice / normalizePackFactor(packFactor);
}
