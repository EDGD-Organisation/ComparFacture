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

export type GapTone = "gain" | "loss";

/**
 * Convention de couleur UNIQUE des écarts (prix facturé moins prix de référence) : vert = économie
 * possible (on paie plus que la référence, écart positif), rouge = perte (on paie moins que la
 * référence, écart négatif). `null` pour un écart absent ou nul. Tout l'affichage passe par ici.
 */
export function gapTone(gap: number | null | undefined): GapTone | null {
  if (gap === null || gap === undefined || !Number.isFinite(gap) || gap === 0) return null;
  return gap > 0 ? "gain" : "loss";
}

const GAP_TEXT_CLASS: Record<GapTone, string> = { gain: "text-success", loss: "text-destructive" };

/** Classe de couleur du texte d'un écart (chaîne vide si absent ou nul). */
export function gapTextClass(gap: number | null | undefined): string {
  const tone = gapTone(gap);
  return tone ? GAP_TEXT_CLASS[tone] : "";
}

/** Teinte d'une carte « écart total » : vert si économie possible, rouge si perte, neutre à zéro. */
export function gapStatTone(total: number): "good" | "bad" | "neutral" {
  const tone = gapTone(total);
  return tone === "gain" ? "good" : tone === "loss" ? "bad" : "neutral";
}

/**
 * Pourcentage d'écart AFFICHÉ : signe inversé par rapport à l'écart calculé, pour qu'une économie
 * possible (écart positif, en vert) s'affiche en « − » et une perte (en rouge) en « + ».
 * Affichage uniquement : les calculs, les seuils de tolérance et les exports gardent l'écart brut.
 */
export function gapPercentLabel(percentGap: number | null | undefined, digits = 1): string {
  if (percentGap === null || percentGap === undefined || !Number.isFinite(percentGap)) return "—";
  return percent(percentGap === 0 ? 0 : -percentGap, digits);
}

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
