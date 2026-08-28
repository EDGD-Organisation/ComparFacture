/**
 * Coefficient de conditionnement : nombre d'unités catalogue contenues
 * dans une unité facturée (ex. carton de 6 → 6).
 */
export function derivePackFactor(label: string | null, unit: string | null): number {
  const text = `${label ?? ""} ${unit ?? ""}`.toLowerCase().replace(/,/g, ".");

  const patterns: RegExp[] = [
    /(?:colis|carton|caisse|boite|boîte|lot|pack|paquet|bte|cs)\s*(?:de\s*)?(\d{1,4})\b/,
    /\b(?:x|\*)\s*(\d{1,4})\b/,
    /\b(\d{1,4})\s*(?:x|\*)\b/,
    /\b(\d{1,4})\s*(?:pi[eè]ces?|pcs?|un(?:it[eé]s?)?)\b/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 1 && value <= 10000) return value;
    }
  }

  return 1;
}

export function comparableUnitPrice(unitPrice: number | null, packFactor: number | null) {
  if (unitPrice === null || unitPrice === undefined) return null;
  const k = packFactor && packFactor > 0 ? packFactor : 1;
  return unitPrice / k;
}
