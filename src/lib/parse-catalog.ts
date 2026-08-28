import * as XLSX from "xlsx";

export type ParsedProduct = {
  reference: string;
  label: string;
  ean: string | null;
  price: number | null;
  unit: string | null;
  family: string | null;
};

const FIELDS: Record<keyof ParsedProduct, string[]> = {
  reference: ["reference", "ref", "code", "codearticle", "sku", "codeproduit", "article"],
  label: ["label", "libelle", "designation", "description", "nom", "produit", "name"],
  ean: ["ean", "gencod", "gencode", "codebarre", "barcode", "ean13"],
  price: ["price", "prix", "prixunitaire", "pu", "tarif", "prixht", "prixachat"],
  unit: ["unit", "unite", "conditionnement", "uv"],
  family: ["family", "famille", "categorie", "category", "rayon"],
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const key of Object.keys(row)) {
    if (keys.includes(normalize(key))) return row[key];
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  const normalized =
    cleaned.includes(",") && cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

const toText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

export async function parseCatalogFile(file: File): Promise<ParsedProduct[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Fichier vide");
  const sheet = workbook.Sheets[sheetName]!;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const products: ParsedProduct[] = [];
  for (const row of rows) {
    const reference = toText(pick(row, FIELDS.reference));
    const label = toText(pick(row, FIELDS.label)) ?? reference;
    if (!reference || !label) continue;
    products.push({
      reference,
      label,
      ean: toText(pick(row, FIELDS.ean)),
      price: toNumber(pick(row, FIELDS.price)),
      unit: toText(pick(row, FIELDS.unit)),
      family: toText(pick(row, FIELDS.family)),
    });
  }
  return products;
}
