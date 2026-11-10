import { normalizePackFactor } from "./pack";

/** Nombre de décimales de toutes les données de prix (PU, totaux, écarts), à l'écran et dans les exports. */
export const PRICE_DIGITS = 3;

export const euro = (value: number | null | undefined, currency = "EUR") =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency,
        minimumFractionDigits: PRICE_DIGITS,
        maximumFractionDigits: PRICE_DIGITS,
      }).format(value);

/** Prix saisissable (sans symbole ni séparateur de milliers) : « 12,500 ». */
export const priceInput = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : value.toFixed(PRICE_DIGITS).replace(".", ",");

export const percent = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined
    ? "—"
    : `${value > 0 ? "+" : ""}${value.toFixed(digits).replace(".", ",")} %`;

export const shortDate = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value)) : "—";

export const num = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value);

export type LineLike = {
  quantity: number;
  unit_price: number | null;
  matched_product_id: string | null;
};

export function lineGap(
  invoicePrice: number | null,
  catalogPrice: number | null,
  quantity: number,
  packFactor: number | null = 1,
) {
  if (invoicePrice === null || catalogPrice === null) return null;
  const k = normalizePackFactor(packFactor);
  const comparablePrice = invoicePrice / k;
  const unitGap = comparablePrice - catalogPrice;
  const percentGap = catalogPrice === 0 ? null : (unitGap / catalogPrice) * 100;
  return { unitGap, percentGap, totalGap: unitGap * quantity * k, comparablePrice, packFactor: k };
}
