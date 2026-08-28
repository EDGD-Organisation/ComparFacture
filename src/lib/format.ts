export const euro = (value: number | null | undefined, currency = "EUR") =>
  value === null || value === undefined
    ? "—"
    : new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value);

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
  const k = packFactor && packFactor > 0 ? packFactor : 1;
  const comparablePrice = invoicePrice / k;
  const unitGap = comparablePrice - catalogPrice;
  const percentGap = catalogPrice === 0 ? null : (unitGap / catalogPrice) * 100;
  return { unitGap, percentGap, totalGap: unitGap * quantity * k, comparablePrice, packFactor: k };
}
