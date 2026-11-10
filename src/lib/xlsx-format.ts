import { PRICE_DIGITS } from "./format";

/** Format Excel des prix : « 0.000 » (3 décimales ; Excel affiche la virgule selon la langue). */
export const PRICE_NUMBER_FORMAT = `0.${"0".repeat(PRICE_DIGITS)}`;

type Cell = { t?: string; v?: unknown; z?: string };
type SheetLike = Record<string, unknown>;

// Mots qui désignent une donnée de prix dans un intitulé (PU, total, écart, facturé, meilleur prix…).
// Les intitulés en « % » sont exclus : un écart en pourcentage n'est pas un prix.
const PRICE_WORD = /(?<![\p{L}\p{N}])(pu|prix|total|écart|facturé|meilleur)(?![\p{L}\p{N}])/iu;

export function isPriceLabel(label: unknown): boolean {
  return typeof label === "string" && !label.includes("%") && PRICE_WORD.test(label);
}

function parseAddress(address: string): { column: string; row: number } | null {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  return match ? { column: match[1]!, row: Number(match[2]) } : null;
}

function numericCells(sheet: SheetLike) {
  const cells = sheet as Record<string, Cell | undefined>;
  return Object.keys(sheet).flatMap((address) => {
    const cell = cells[address];
    const position = parseAddress(address);
    return cell && position && cell.t === "n" ? [{ cell, ...position }] : [];
  });
}

/**
 * Tableau dont les en-têtes sont sur la ligne `headerRow` (1 pour `json_to_sheet`) : les nombres des
 * lignes suivantes sont mis au format prix quand l'en-tête de leur colonne désigne un prix.
 * Les valeurs ne changent pas, Excel garde la précision complète. Retourne la feuille.
 */
export function formatPriceColumns<T extends SheetLike>(sheet: T, headerRow = 1): T {
  const cells = sheet as Record<string, Cell | undefined>;
  for (const { cell, column, row } of numericCells(sheet)) {
    if (row > headerRow && isPriceLabel(cells[`${column}${headerRow}`]?.v)) {
      cell.z = PRICE_NUMBER_FORMAT;
    }
  }
  return sheet;
}

/** Numéro de la première ligne dont la colonne A contient `label` (0 si absente). */
export function rowOf(sheet: SheetLike, label: string): number {
  const cells = sheet as Record<string, Cell | undefined>;
  const rows = Object.keys(sheet).flatMap((address) => {
    const position = parseAddress(address);
    return position?.column === "A" && cells[address]?.v === label ? [position.row] : [];
  });
  return rows.length === 0 ? 0 : Math.min(...rows);
}

/**
 * Lignes « libellé | valeur » (synthèses, totaux ajoutés sous un tableau) à partir de `fromRow` : un
 * nombre est un prix quand le libellé de la colonne A l'est.
 */
export function formatPriceRows<T extends SheetLike>(sheet: T, fromRow = 1): T {
  const cells = sheet as Record<string, Cell | undefined>;
  for (const { cell, column, row } of numericCells(sheet)) {
    const label = cells[`A${row}`];
    if (row >= fromRow && column !== "A" && label?.t === "s" && isPriceLabel(label.v)) {
      cell.z = PRICE_NUMBER_FORMAT;
    }
  }
  return sheet;
}
